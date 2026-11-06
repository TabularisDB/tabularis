use super::model::*;
use super::types::{classify_source, classify_target, plan_conversion};
use crate::models::TableColumn;
use std::collections::{HashMap, HashSet};

pub struct PlanInputs<'a> {
    pub selection: &'a TableSelection,
    pub source_columns: &'a [TableColumn],
    pub target_columns: &'a [TableColumn],
    pub target_dialect: TransferDialect,
    pub estimated_rows: Option<i64>,
    pub same_table: bool,
}

fn display_type(column: &TableColumn) -> String {
    column.full_type.clone().unwrap_or_else(|| column.data_type.clone())
}

fn find_target<'a>(targets: &'a [TableColumn], name: &str) -> Option<&'a TableColumn> {
    if let Some(exact) = targets.iter().find(|c| c.name == name) {
        return Some(exact);
    }
    let mut folded = targets.iter().filter(|c| c.name.eq_ignore_ascii_case(name));
    match (folded.next(), folded.next()) {
        (Some(only), None) => Some(only),
        _ => None,
    }
}

fn finish(
    inputs: &PlanInputs<'_>,
    columns: Vec<ColumnPlan>,
    issues: Vec<PlanIssue>,
    bindings: Vec<ColumnBinding>,
) -> PlannedTable {
    PlannedTable {
        plan: TablePlan {
            source_table: inputs.selection.source_table.clone(),
            target_table: inputs.selection.target_table.clone(),
            blocking: !issues.is_empty(),
            columns,
            issues,
            estimated_rows: inputs.estimated_rows,
        },
        bindings,
    }
}

/// Resolves the column mapping and conversion rules for one table. The
/// result is blocking whenever anything would be dropped, guessed or coerced.
pub fn build_table_plan(inputs: &PlanInputs<'_>) -> PlannedTable {
    let mut issues = Vec::new();
    let mut columns = Vec::new();
    let mut bindings = Vec::new();
    if inputs.same_table {
        issues.push(PlanIssue::new("sourceEqualsTarget", None));
    }
    if inputs.source_columns.is_empty() {
        issues.push(PlanIssue::new("sourceTableNotFound", None));
    }
    if inputs.target_columns.is_empty() {
        issues.push(PlanIssue::new("targetTableNotFound", None));
    }
    if inputs.source_columns.is_empty() || inputs.target_columns.is_empty() {
        return finish(inputs, columns, issues, bindings);
    }

    let explicit: HashMap<&str, Option<&str>> = inputs
        .selection
        .columns
        .iter()
        .map(|m| (m.source_column.as_str(), m.target_column.as_deref()))
        .collect();
    for name in explicit.keys() {
        if !inputs.source_columns.iter().any(|c| c.name == *name) {
            issues.push(PlanIssue::new("unknownSourceColumn", Some(name)));
        }
    }

    let mut used: HashSet<&str> = HashSet::new();
    for source in inputs.source_columns {
        let mut plan = ColumnPlan {
            source_column: source.name.clone(),
            source_type: display_type(source),
            target_column: None,
            target_type: None,
            rule: None,
            skipped: false,
            issue: None,
        };
        let fail = |plan: &mut ColumnPlan, issues: &mut Vec<PlanIssue>, code: &str, column: &str| {
            plan.issue = Some(code.to_string());
            issues.push(PlanIssue::new(code, Some(column)));
        };
        let target = match explicit.get(source.name.as_str()) {
            Some(None) => {
                plan.skipped = true;
                columns.push(plan);
                continue;
            }
            Some(Some(name)) => match inputs.target_columns.iter().find(|c| c.name == *name) {
                Some(target) => target,
                None => {
                    plan.target_column = Some((*name).to_string());
                    fail(&mut plan, &mut issues, "unknownTargetColumn", name);
                    columns.push(plan);
                    continue;
                }
            },
            None => match find_target(inputs.target_columns, &source.name) {
                Some(target) => target,
                None => {
                    fail(&mut plan, &mut issues, "noTargetColumn", &source.name);
                    columns.push(plan);
                    continue;
                }
            },
        };
        plan.target_column = Some(target.name.clone());
        plan.target_type = Some(display_type(target));
        if !used.insert(target.name.as_str()) {
            fail(&mut plan, &mut issues, "duplicateTargetColumn", &target.name);
        } else if target.is_generated {
            fail(&mut plan, &mut issues, "targetColumnGenerated", &target.name);
        } else if let Some(kind) = classify_source(source) {
            match classify_target(inputs.target_dialect, target) {
                None => fail(&mut plan, &mut issues, "unsupportedTargetType", &source.name),
                Some(target_type) => match plan_conversion(kind, &target_type) {
                    Err(code) => fail(&mut plan, &mut issues, code, &source.name),
                    Ok(conversion) => {
                        plan.rule = Some(conversion.rule);
                        bindings.push(ColumnBinding {
                            source_column: source.name.clone(),
                            source_kind: kind,
                            target_column: target.name.clone(),
                            target_type,
                            conversion,
                        });
                    }
                },
            }
        } else {
            fail(&mut plan, &mut issues, "unsupportedSourceType", &source.name);
        }
        columns.push(plan);
    }

    for target in inputs.target_columns {
        let needs_value = !target.is_nullable
            && target.default_value.is_none()
            && !target.is_auto_increment
            && !target.is_generated;
        if needs_value && !used.contains(target.name.as_str()) {
            issues.push(PlanIssue::new("requiredTargetColumnUnmapped", Some(&target.name)));
        }
    }
    if columns.iter().all(|c| c.target_column.is_none()) {
        issues.push(PlanIssue::new("noColumnsMapped", None));
    }
    finish(inputs, columns, issues, bindings)
}
