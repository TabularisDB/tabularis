use super::*;
use serde_json::json;

fn request(include: ColumnStatsParts) -> ColumnStatsRequest {
    ColumnStatsRequest {
        table: "orders".into(),
        schema: None,
        column: "status".into(),
        data_type: Some("string".into()),
        filter: None,
        top_values_limit: 2,
        include,
    }
}

const ALL: ColumnStatsParts = ColumnStatsParts {
    distinct: true,
    min_max: true,
    top_values: true,
};

const COUNTS_ONLY: ColumnStatsParts = ColumnStatsParts {
    distinct: false,
    min_max: false,
    top_values: false,
};

fn full_result() -> ColumnStatsResult {
    serde_json::from_value(json!({
        "row_count": 10,
        "null_count": 2,
        "distinct_count": 3,
        "min": "a",
        "max": "c",
        "top_values": [
            {"value": "a", "count": 5},
            {"value": null, "count": 2},
            {"value": "b", "count": 2},
            {"value": "c", "count": 1}
        ],
        "sample_size": 8
    }))
    .unwrap()
}

#[test]
fn optional_parts_default_to_none() {
    let result: ColumnStatsResult =
        serde_json::from_value(json!({"row_count": 3, "null_count": 0})).unwrap();
    assert_eq!(result.distinct_count, None);
    assert_eq!(result.min, None);
    assert_eq!(result.top_values, None);
    assert_eq!(result.sample_size, None);
    assert!(serde_json::to_value(&result)
        .unwrap()
        .get("sample_size")
        .is_none());
}

#[test]
fn keeps_requested_parts_and_caps_top_values_without_nulls() {
    let result = restrict_column_stats(full_result(), &request(ALL)).unwrap();
    assert_eq!(result.distinct_count, Some(3));
    assert_eq!(result.min, Some(json!("a")));
    assert_eq!(result.max, Some(json!("c")));
    assert_eq!(
        result.top_values.unwrap(),
        vec![
            ColumnTopValue {
                value: json!("a"),
                count: 5
            },
            ColumnTopValue {
                value: json!("b"),
                count: 2
            },
        ]
    );
    assert_eq!(result.sample_size, Some(8));
}

#[test]
fn drops_parts_the_host_did_not_ask_for() {
    // A masked column asks for the distinct count only.
    let masked = ColumnStatsParts {
        distinct: true,
        min_max: false,
        top_values: false,
    };
    let result = restrict_column_stats(full_result(), &request(masked)).unwrap();
    assert_eq!(result.distinct_count, Some(3));
    assert_eq!(result.min, None);
    assert_eq!(result.max, None);
    assert_eq!(result.top_values, None);

    let result = restrict_column_stats(full_result(), &request(COUNTS_ONLY)).unwrap();
    assert_eq!((result.row_count, result.null_count), (10, 2));
    assert_eq!(result.distinct_count, None);
    assert_eq!(result.sample_size, None);
}

#[test]
fn rejects_more_nulls_than_rows() {
    let mut result = full_result();
    result.null_count = 11;
    assert!(restrict_column_stats(result, &request(ALL))
        .unwrap_err()
        .contains("null_count"));
}

#[test]
fn rejects_negative_or_missing_counts() {
    for bad in [
        json!({"row_count": -1, "null_count": 0}),
        json!({"null_count": 0}),
        json!({"row_count": 1, "null_count": 0, "top_values": [{"value": 1}]}),
    ] {
        assert!(serde_json::from_value::<ColumnStatsResult>(bad).is_err());
    }
}
