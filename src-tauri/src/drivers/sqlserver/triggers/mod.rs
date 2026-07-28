use crate::drivers::sqlserver::helpers::qualify;
use crate::drivers::sqlserver::pool::BridgeConnection;
use crate::models::TriggerInfo;

const LIST_TRIGGERS: &str = r#"
SELECT tr.[name], tb.[name],
       STUFF((
           SELECT N' OR ' + te.[type_desc]
           FROM sys.trigger_events te
           WHERE te.[object_id] = tr.[object_id]
           ORDER BY te.[type_desc]
           FOR XML PATH(N''), TYPE
       ).value(N'.', N'nvarchar(max)'), 1, 4, N''),
       CASE WHEN tr.[is_instead_of_trigger] = 1 THEN N'INSTEAD OF' ELSE N'AFTER' END,
       sm.[definition]
FROM sys.triggers tr
JOIN sys.tables tb ON tb.[object_id] = tr.[parent_id]
JOIN sys.schemas sc ON sc.[schema_id] = tb.[schema_id]
LEFT JOIN sys.sql_modules sm ON sm.[object_id] = tr.[object_id]
WHERE sc.[name] = @P1 AND tr.[is_ms_shipped] = 0
ORDER BY tb.[name], tr.[name]
"#;

pub async fn get_triggers(
    conn: &mut BridgeConnection,
    schema: Option<&str>,
) -> Result<Vec<TriggerInfo>, String> {
    let schema = schema.unwrap_or("dbo");
    let rows = conn
        .query(LIST_TRIGGERS, &[&schema])
        .await
        .map_err(|error| error.to_string())?
        .into_first_result()
        .await
        .map_err(|error| error.to_string())?;

    Ok(rows
        .into_iter()
        .filter_map(|row| {
            Some(TriggerInfo {
                name: row.get::<&str, _>(0)?.to_string(),
                table_name: row.get::<&str, _>(1)?.to_string(),
                event: row.get::<&str, _>(2).unwrap_or("").replace("_", " "),
                timing: row.get::<&str, _>(3).unwrap_or("AFTER").to_string(),
                definition: row.get::<&str, _>(4).map(str::to_string),
            })
        })
        .collect())
}

pub fn drop_trigger_sql(trigger_name: &str, schema: Option<&str>) -> String {
    format!("DROP TRIGGER {}", qualify(schema, trigger_name))
}

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
