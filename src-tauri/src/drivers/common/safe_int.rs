use serde_json::Value as JsonValue;

/// Largest integer that round-trips exactly through a JavaScript `number`
/// (IEEE 754 double). Equal to `Number.MAX_SAFE_INTEGER` (`2^53 - 1`).
pub const JS_MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;

/// Mirror of [`JS_MAX_SAFE_INTEGER`] for unsigned values.
pub const JS_MAX_SAFE_UINT: u64 = 9_007_199_254_740_991;

/// Serialize an `i64` as a JSON number when it fits in JavaScript's safe
/// integer range, and as a JSON string otherwise.
///
/// The frontend uses the standard `JSON.parse`, which loses precision for
/// integers outside ±(2^53 - 1). Returning a string for out-of-range values
/// keeps the exact decimal representation intact while leaving small ids,
/// counts and timestamps as ordinary numbers.
#[inline]
pub fn i64_to_json(value: i64) -> JsonValue {
    if value > JS_MAX_SAFE_INTEGER || value < -JS_MAX_SAFE_INTEGER {
        JsonValue::String(value.to_string())
    } else {
        JsonValue::from(value)
    }
}

/// Serialize a `u64` as a JSON number when it fits in JavaScript's safe
/// integer range, and as a JSON string otherwise. See [`i64_to_json`].
#[inline]
pub fn u64_to_json(value: u64) -> JsonValue {
    if value > JS_MAX_SAFE_UINT {
        JsonValue::String(value.to_string())
    } else {
        JsonValue::from(value)
    }
}

/// Parse a JSON-string value back into an `i64` *only* when it represents an
/// integer outside JavaScript's safe range — that is, when it matches the
/// shape of a value emitted by [`i64_to_json`] / [`u64_to_json`].
///
/// This is the write-back counterpart used by the row editor: large bigints
/// arrive from the UI as JSON strings (because that's the only lossless
/// way to send them through `JSON.parse`), and need to be bound as native
/// integers when the underlying column is BIGINT/INTEGER.
///
/// The heuristic deliberately ignores small numeric strings (under 2^53)
/// because those round-trip as regular JSON numbers; treating them as ints
/// would silently coerce text like `"42"` typed into a VARCHAR column.
#[inline]
pub fn parse_unsafe_bigint_string(s: &str) -> Option<i64> {
    let parsed: i64 = s.parse().ok()?;
    if parsed > JS_MAX_SAFE_INTEGER || parsed < -JS_MAX_SAFE_INTEGER {
        Some(parsed)
    } else {
        None
    }
}
