use super::is_safe_relative_path;
use std::collections::BTreeSet;

fn bytes_at(input: &[u8], start: usize, length: usize) -> Result<&[u8], String> {
    let end = start.checked_add(length).ok_or("ZIP offset overflow")?;
    input
        .get(start..end)
        .ok_or_else(|| "Truncated ZIP structure".into())
}

fn word(input: &[u8], offset: usize) -> Result<u16, String> {
    let bytes = bytes_at(input, offset, 2)?;
    Ok(u16::from_le_bytes([bytes[0], bytes[1]]))
}

fn dword(input: &[u8], offset: usize) -> Result<u32, String> {
    let bytes = bytes_at(input, offset, 4)?;
    Ok(u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
}

fn extra_fields(input: &[u8]) -> Result<(), String> {
    let mut position = 0;
    while position < input.len() {
        let tag = word(input, position)?;
        let length = word(input, position + 2)? as usize;
        // These can change sizes, paths or encryption semantics after the
        // central-directory preflight. They are unnecessary for small v1 ZIPs.
        if matches!(tag, 0x0001 | 0x7075 | 0x9901) {
            return Err("Unsupported ZIP64, alternate-path or encryption metadata".into());
        }
        bytes_at(input, position + 4, length)?;
        position += 4 + length;
    }
    Ok(())
}

/// ZipArchive coalesces duplicate names in an IndexMap. Check the original
/// central directory and its count BEFORE constructing that library object.
/// V1 accepts ordinary single-disk stored/deflated ZIPs, not ZIP64 or SFX.
pub(super) fn preflight_zip(input: &[u8], max_entries: usize) -> Result<(usize, u64), String> {
    if input.len() < 22 {
        return Err("Truncated ZIP end record".into());
    }
    let search_start = input.len().saturating_sub(22 + 65535);
    let end = (search_start..=input.len() - 22)
        .rev()
        .find(|&position| {
            input.get(position..position + 4) == Some(b"PK\x05\x06")
                && word(input, position + 20)
                    .is_ok_and(|length| position + 22 + length as usize == input.len())
        })
        .ok_or("Missing ZIP end record or trailing payload")?;
    if end >= 20 && dword(input, end - 20)? == 0x07064b50 {
        return Err("ZIP64 locator metadata is unsupported".into());
    }
    let count = word(input, end + 10)? as usize;
    if count > max_entries {
        return Err("Theme archive exceeds the entry limit".into());
    }
    if word(input, end + 4)? != 0
        || word(input, end + 6)? != 0
        || word(input, end + 8)? as usize != count
        || count == u16::MAX as usize
    {
        return Err("Multi-disk and ZIP64 theme archives are unsupported".into());
    }
    let directory_size = dword(input, end + 12)? as usize;
    let directory_start = dword(input, end + 16)? as usize;
    if directory_start.checked_add(directory_size) != Some(end) {
        return Err("Invalid or unsupported ZIP central directory".into());
    }
    bytes_at(input, directory_start, directory_size)?;
    let mut position = directory_start;
    let mut names = BTreeSet::new();
    let mut spans = Vec::with_capacity(count);
    for _ in 0..count {
        bytes_at(input, position, 46)?;
        if dword(input, position)? != 0x02014b50 {
            return Err("Invalid ZIP central header".into());
        }
        let flags = word(input, position + 8)?;
        let method = word(input, position + 10)?;
        if flags & !0x080e != 0 || !matches!(method, 0 | 8) || word(input, position + 34)? != 0 {
            return Err("Unsupported ZIP flags, compression or disk".into());
        }
        let crc = dword(input, position + 16)?;
        let compressed = dword(input, position + 20)?;
        let expanded = dword(input, position + 24)?;
        if compressed == u32::MAX || expanded == u32::MAX {
            return Err("ZIP64 themes are unsupported".into());
        }
        let name_length = word(input, position + 28)? as usize;
        let extra_length = word(input, position + 30)? as usize;
        let comment_length = word(input, position + 32)? as usize;
        let name_bytes = bytes_at(input, position + 46, name_length)?;
        let name = std::str::from_utf8(name_bytes).map_err(|_| "Invalid ZIP filename encoding")?;
        if !is_safe_relative_path(name.strip_suffix('/').unwrap_or(name)) {
            return Err("Unsafe theme archive path".into());
        }
        if !names.insert(name.to_ascii_lowercase()) {
            return Err("Duplicate or case-colliding ZIP entries".into());
        }
        extra_fields(bytes_at(input, position + 46 + name_length, extra_length)?)?;
        let local = dword(input, position + 42)? as usize;
        if local >= directory_start {
            return Err("Invalid ZIP local header offset".into());
        }
        bytes_at(input, local, 30)?;
        if dword(input, local)? != 0x04034b50
            || word(input, local + 6)? != flags
            || word(input, local + 8)? != method
        {
            return Err("Mismatched ZIP local header".into());
        }
        let local_name_length = word(input, local + 26)? as usize;
        let local_extra_length = word(input, local + 28)? as usize;
        if bytes_at(input, local + 30, local_name_length)? != name_bytes {
            return Err("Mismatched ZIP filenames".into());
        }
        extra_fields(bytes_at(
            input,
            local + 30 + local_name_length,
            local_extra_length,
        )?)?;
        let data_start = local + 30 + local_name_length + local_extra_length;
        let mut data_end = data_start
            .checked_add(compressed as usize)
            .ok_or("ZIP data size overflow")?;
        if data_end > directory_start {
            return Err("ZIP file data exceeds the local section".into());
        }
        if flags & 0x0008 != 0 {
            if dword(input, data_end)? != 0x08074b50
                || dword(input, data_end + 4)? != crc
                || dword(input, data_end + 8)? != compressed
                || dword(input, data_end + 12)? != expanded
            {
                return Err("Missing or mismatched signed ZIP data descriptor".into());
            }
            data_end = data_end
                .checked_add(16)
                .ok_or("ZIP descriptor size overflow")?;
        } else if dword(input, local + 14)? != crc
            || dword(input, local + 18)? != compressed
            || dword(input, local + 22)? != expanded
        {
            return Err("Mismatched ZIP local sizes or checksum".into());
        }
        if data_end > directory_start {
            return Err("Overlapping ZIP file and central directory".into());
        }
        spans.push((local, data_end));
        position += 46 + name_length + extra_length + comment_length;
        if position > end {
            return Err("ZIP central record exceeds directory".into());
        }
    }
    if position != end {
        return Err("ZIP central-directory count mismatch".into());
    }
    spans.sort_unstable();
    let mut next = 0;
    for (start, stop) in spans {
        if start != next {
            return Err("Overlapping, hidden or prefixed ZIP payload".into());
        }
        next = stop;
    }
    if next != directory_start {
        return Err("Unreferenced ZIP payload".into());
    }
    Ok((count, directory_start as u64))
}
