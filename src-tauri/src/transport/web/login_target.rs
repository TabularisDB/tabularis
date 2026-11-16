//! Where password login sends the browser once it succeeds.
//!
//! A link into the Web UI must survive the redirect to `/login`, but the
//! return target comes from the request, so it is restricted to the Web UI's
//! own connection routes. Anything else falls back to `/`, which rules out
//! open redirects (`//host`, absolute URLs, backslashes, encoded slashes).

/// The query parameter on `/login` and the form field on the login POST.
pub(crate) const LOGIN_TARGET_PARAM: &str = "next";

/// Returns `raw` when it is a link the Web UI may resume after login,
/// i.e. exactly `/connections/<id>/editor` (optionally with a trailing `/`).
/// The id may contain only URL-unreserved characters and `%XX` escapes, so
/// the result is safe to place in a `Location` header and an HTML attribute.
pub(crate) fn login_return_target(raw: &str) -> Option<&str> {
    let rest = raw.strip_prefix("/connections/")?;
    let id = rest
        .strip_suffix("/editor")
        .or_else(|| rest.strip_suffix("/editor/"))?;
    valid_connection_id_segment(id).then_some(raw)
}

/// One path segment of unreserved characters and `%XX` escapes. Rejects
/// empty, `.` and `..` (also when escaped), and escaped `/` or `\`, which
/// could change how the browser resolves the path.
fn valid_connection_id_segment(segment: &str) -> bool {
    let bytes = segment.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'%' => {
                let Some(&[high, low]) = bytes.get(index + 1..index + 3) else {
                    return false;
                };
                let (Some(high), Some(low)) = (hex_value(high), hex_value(low)) else {
                    return false;
                };
                let byte = (high << 4) | low;
                if byte == b'/' || byte == b'\\' {
                    return false;
                }
                decoded.push(byte);
                index += 3;
            }
            byte if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') => {
                decoded.push(byte);
                index += 1;
            }
            _ => return false,
        }
    }
    !matches!(decoded.as_slice(), b"" | b"." | b"..")
}

fn hex_value(digit: u8) -> Option<u8> {
    (digit as char).to_digit(16).map(|value| value as u8)
}
