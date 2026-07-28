use crate::drivers::sqlserver::extract::extract_value;
use crate::drivers::sqlserver::pool::BridgeConnection;
use crate::models::{ExplainQueryOutput, RawExplainOutput};

pub async fn explain_query(
    conn: &mut BridgeConnection,
    query: &str,
    analyze: bool,
) -> Result<ExplainQueryOutput, String> {
    let option = if analyze {
        "STATISTICS XML"
    } else {
        "SHOWPLAN_XML"
    };
    conn.simple_query(format!("SET {option} ON"))
        .await
        .map_err(|error| error.to_string())?
        .into_results()
        .await
        .map_err(|error| error.to_string())?;

    // STATISTICS XML intentionally executes the statement, matching the
    // explicit Analyze action used by the other built-in drivers.
    let query_result = match conn.simple_query(query).await {
        Ok(stream) => stream
            .into_results()
            .await
            .map_err(|error| error.to_string()),
        Err(error) => Err(error.to_string()),
    };
    let disable_result = conn
        .simple_query(format!("SET {option} OFF"))
        .await
        .map_err(|error| error.to_string())?
        .into_results()
        .await
        .map_err(|error| error.to_string());

    let result_sets = query_result?;
    disable_result?;
    let payload = result_sets
        .iter()
        .flat_map(|rows| rows.iter())
        .flat_map(|row| (0..row.columns().len()).map(move |index| extract_value(row, index)))
        .find_map(|value| {
            value
                .as_str()
                .filter(|text| text.contains("ShowPlanXML"))
                .map(str::to_string)
        })
        .ok_or_else(|| "SQL Server did not return a SHOWPLAN_XML document".to_string())?;

    Ok(ExplainQueryOutput::Raw {
        raw: RawExplainOutput {
            engine: "sqlserver".into(),
            format: "sqlserver-showplan-xml".into(),
            payload,
            original_query: query.into(),
        },
    })
}
