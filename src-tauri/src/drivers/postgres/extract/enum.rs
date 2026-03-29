use serde_json::Value as JsonValue;

#[inline(always)]
pub fn extract_or_null(buf: &[u8]) -> JsonValue {
    match std::str::from_utf8(buf) {
        Ok(s) => JsonValue::String(s.to_string()),
        Err(_) => JsonValue::Null,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_utf8() {
        let buf = b"active";
        assert_eq!(
            extract_or_null(buf),
            JsonValue::String("active".to_string())
        );
    }

    #[test]
    fn test_empty_buffer() {
        let buf = b"";
        assert_eq!(extract_or_null(buf), JsonValue::String("".to_string()));
    }

    #[test]
    fn test_invalid_utf8_returns_null() {
        let buf = [0xff, 0xfe, 0xfd];
        assert_eq!(extract_or_null(&buf), JsonValue::Null);
    }

    #[test]
    fn test_single_char() {
        let buf = b"A";
        assert_eq!(extract_or_null(buf), JsonValue::String("A".to_string()));
    }

    #[test]
    fn test_unicode() {
        let buf = "héllo".as_bytes();
        assert_eq!(extract_or_null(buf), JsonValue::String("héllo".to_string()));
    }

    #[test]
    fn test_truncated_utf8_returns_null() {
        // 0xC3 is a valid UTF-8 lead byte but incomplete without continuation
        let buf = [0xC3];
        assert_eq!(extract_or_null(&buf), JsonValue::Null);
    }
}
