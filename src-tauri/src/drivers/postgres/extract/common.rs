#[inline]
pub fn advance_buf(buf: &mut &[u8], n: usize) -> Result<(), ()> {
    if buf.len() < n {
        log::error!("Buffer too short: {} < {}", buf.len(), n);
        return Err(());
    }
    *buf = &buf[n..];
    Ok(())
}

pub fn split_at_value_len<'a>(buf: &mut &'a [u8]) -> Result<Option<&'a [u8]>, ()> {
    if buf.len() < 4 {
        log::error!("Buffer too short to read value length");
        return Err(());
    };

    let len = i32::from_be_bytes(match buf[..4].try_into() {
        Ok(bytes) => bytes,
        Err(e) => {
            log::error!("Failed to parse value length: {:?}", e);
            return Err(());
        }
    });

    *buf = &buf[4..];

    if len < 0 {
        return Ok(None);
    };

    match buf.split_at_checked(len as usize) {
        Some((value_buf, rest)) => {
            *buf = rest;
            Ok(Some(value_buf))
        }

        None => {
            log::error!("Failed to split buffer at value length");
            return Err(());
        }
    }
}
