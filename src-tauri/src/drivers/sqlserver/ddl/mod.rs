use crate::drivers::sqlserver::helpers::{bracket_quote, escape_single_quoted, qualify};
use crate::models::ColumnDefinition;

pub fn alter_column_sql(
    table: &str,
    old: &ColumnDefinition,
    new: &ColumnDefinition,
    schema: Option<&str>,
) -> Result<Vec<String>, String> {
    if old.is_auto_increment != new.is_auto_increment {
        return Err("SQL Server cannot add or remove IDENTITY with ALTER COLUMN".into());
    }
    if old.is_pk != new.is_pk {
        return Err(
            "SQL Server primary-key membership cannot be changed safely from a single-column editor"
                .into(),
        );
    }
    if old.is_pk && (old.data_type != new.data_type || old.is_nullable != new.is_nullable) {
        return Err(
            "Change the primary-key constraint explicitly before changing its column type or nullability"
                .into(),
        );
    }

    let schema = schema.unwrap_or("dbo");
    let table_ref = qualify(Some(schema), table);
    let mut statements = Vec::new();

    if old.name != new.name {
        let object = format!(
            "{}.{}.{}",
            bracket_quote(schema),
            bracket_quote(table),
            bracket_quote(&old.name)
        );
        statements.push(format!(
            "EXEC sp_rename N'{}', N'{}', N'COLUMN'",
            escape_single_quoted(&object),
            escape_single_quoted(&new.name)
        ));
    }

    if old.data_type != new.data_type || old.is_nullable != new.is_nullable {
        statements.push(format!(
            "ALTER TABLE {table_ref} ALTER COLUMN {} {} {}",
            bracket_quote(&new.name),
            new.data_type,
            if new.is_nullable { "NULL" } else { "NOT NULL" }
        ));
    }

    if old.default_value != new.default_value {
        statements.push(drop_default_constraint_sql(schema, table, &new.name));
        if let Some(default) = new
            .default_value
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            statements.push(format!(
                "ALTER TABLE {table_ref} ADD CONSTRAINT {} DEFAULT {default} FOR {}",
                bracket_quote(&constraint_name("DF", table, &new.name)),
                bracket_quote(&new.name)
            ));
        }
    }

    Ok(statements)
}

fn constraint_name(prefix: &str, table: &str, column: &str) -> String {
    let name = format!("{prefix}_{table}_{column}");
    if name.chars().count() <= 128 {
        return name;
    }
    let hash = name.bytes().fold(0xcbf29ce484222325_u64, |hash, byte| {
        (hash ^ u64::from(byte)).wrapping_mul(0x100000001b3)
    });
    let head = name.chars().take(111).collect::<String>();
    format!("{head}_{hash:016x}")
}

fn drop_default_constraint_sql(schema: &str, table: &str, column: &str) -> String {
    format!(
        "DECLARE @tabularis_default sysname, @tabularis_sql nvarchar(max);\n\
         SELECT @tabularis_default = dc.[name]\n\
         FROM sys.default_constraints dc\n\
         JOIN sys.columns c ON c.[object_id] = dc.[parent_object_id] AND c.[column_id] = dc.[parent_column_id]\n\
         WHERE dc.[parent_object_id] = OBJECT_ID(N'{}') AND c.[name] = N'{}';\n\
         IF @tabularis_default IS NOT NULL BEGIN\n\
             SET @tabularis_sql = N'ALTER TABLE {} DROP CONSTRAINT ' + QUOTENAME(@tabularis_default);\n\
             EXEC sys.sp_executesql @tabularis_sql;\n\
         END",
        escape_single_quoted(&format!(
            "{}.{}",
            bracket_quote(schema),
            bracket_quote(table)
        )),
        escape_single_quoted(column),
        qualify(Some(schema), table)
    )
}

pub fn create_foreign_key_sql(
    table: &str,
    fk_name: &str,
    column: &str,
    ref_table: &str,
    ref_column: &str,
    on_delete: Option<&str>,
    on_update: Option<&str>,
    schema: Option<&str>,
) -> Result<Vec<String>, String> {
    let action = |value: Option<&str>| -> Result<Option<String>, String> {
        match value.map(str::trim).filter(|value| !value.is_empty()) {
            None => Ok(None),
            Some(value)
                if ["NO ACTION", "CASCADE", "SET NULL", "SET DEFAULT"]
                    .iter()
                    .any(|allowed| value.eq_ignore_ascii_case(allowed)) =>
            {
                Ok(Some(value.to_ascii_uppercase()))
            }
            Some(value) => Err(format!("Unsupported foreign-key action: {value}")),
        }
    };

    let schema = schema.unwrap_or("dbo");
    let mut sql = format!(
        "ALTER TABLE {} ADD CONSTRAINT {} FOREIGN KEY ({}) REFERENCES {} ({})",
        qualify(Some(schema), table),
        bracket_quote(fk_name),
        bracket_quote(column),
        qualify(Some(schema), ref_table),
        bracket_quote(ref_column)
    );
    if let Some(value) = action(on_delete)? {
        sql.push_str(&format!(" ON DELETE {value}"));
    }
    if let Some(value) = action(on_update)? {
        sql.push_str(&format!(" ON UPDATE {value}"));
    }
    Ok(vec![sql])
}

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
