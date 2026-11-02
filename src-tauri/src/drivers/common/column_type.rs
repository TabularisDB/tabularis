/// Returns the full declared type of a column (`varchar(255)`,
/// `decimal(10,2)`, `int unsigned`) when it says more than the base
/// `data_type`, and `None` when it is empty or only repeats it, so
/// `TableColumn::full_type` stays absent for plain types like `text` (#1277).
pub fn full_type_if_distinct(data_type: &str, full_type: Option<String>) -> Option<String> {
    let full_type = full_type?;
    let full_type = full_type.trim();
    if full_type.is_empty() || full_type.eq_ignore_ascii_case(data_type.trim()) {
        return None;
    }
    Some(full_type.to_string())
}
