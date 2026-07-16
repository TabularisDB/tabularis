use crate::ai_schema_context::format_for_prompt;
use crate::models::{AiSchemaContext, ForeignKey, TableColumn, TableSchema};

fn column(name: &str, data_type: &str, is_pk: bool, is_nullable: bool) -> TableColumn {
    TableColumn {
        name: name.to_string(),
        data_type: data_type.to_string(),
        is_pk,
        is_nullable,
        is_auto_increment: false,
        default_value: None,
        character_maximum_length: None,
    }
}

#[test]
fn formats_columns_relationships_and_truncation() {
    let context = AiSchemaContext {
        tables: vec![TableSchema {
            name: "users".to_string(),
            columns: vec![
                column("id", "bigint", true, false),
                column("team_id", "bigint", false, false),
            ],
            foreign_keys: vec![ForeignKey {
                name: "users_team_id_fkey".to_string(),
                column_name: "team_id".to_string(),
                ref_table: "teams".to_string(),
                ref_column: "id".to_string(),
                on_delete: None,
                on_update: None,
            }],
        }],
        total_table_count: 3,
    };

    let prompt = format_for_prompt(&context, "\"");

    assert!(prompt.contains("Table: \"users\""));
    assert!(prompt.contains("  - id bigint PK NOT NULL"));
    assert!(prompt.contains("  FK: team_id -> teams.id"));
    assert!(prompt.contains("... and 2 more tables (not shown)"));
}

#[test]
fn uses_double_quotes_when_driver_quote_is_empty() {
    let context = AiSchemaContext {
        tables: vec![TableSchema {
            name: "events".to_string(),
            columns: Vec::new(),
            foreign_keys: Vec::new(),
        }],
        total_table_count: 1,
    };

    assert_eq!(format_for_prompt(&context, ""), "Table: \"events\"");
}
