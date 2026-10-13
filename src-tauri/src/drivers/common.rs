mod blob;
mod pooled;
mod query;
mod routines;
mod safe_int;

#[cfg(test)]
mod tests;

pub use blob::{
    decode_blob_wire_format, encode_blob, encode_blob_full, resolve_blob_file_ref,
    DEFAULT_MAX_BLOB_SIZE, MAX_BLOB_PREVIEW_SIZE,
};
pub use pooled::DetachOnDrop;
pub use query::{
    build_paginated_query, calculate_offset, extract_user_limit, extract_user_offset,
    is_explainable_query,
    is_select_query, returns_result_set, strip_leading_sql_comments, strip_limit_offset,
    transaction_effect, TransactionEffect,
};
pub use routines::{
    generic_drop_routine_sql, generic_routine_call_sql, quote_qualified, render_sql_literal,
};
pub use safe_int::{
    i64_to_json, parse_unsafe_bigint_string, u64_to_json, JS_MAX_SAFE_INTEGER, JS_MAX_SAFE_UINT,
};

// Preserve the shortest f32 decimal instead of widening its binary approximation.
pub(crate) fn float4_to_json_f64(v: f32) -> Option<f64> {
    v.to_string().parse::<f64>().ok().map(|decimal| {
        // Avoid double rounding when the decimal lands on an f32 midpoint.
        if decimal as f32 == v {
            decimal
        } else {
            f64::from(v)
        }
    })
}
