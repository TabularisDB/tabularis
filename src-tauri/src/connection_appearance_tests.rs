#[cfg(test)]
mod tests {
    use crate::connection_appearance::{save_icon_impl, IconError, MAX_ICON_BYTES};
    use std::fs;
    use std::io::Write;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};

    static COUNTER: AtomicU64 = AtomicU64::new(0);

    fn tmp_dir() -> PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let d = std::env::temp_dir().join(format!("tab-icon-test-{}-{}", std::process::id(), n));
        fs::create_dir_all(&d).unwrap();
        d
    }

    fn write_png(p: &Path, size: usize) {
        let mut f = fs::File::create(p).unwrap();
        f.write_all(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]).unwrap();
        f.write_all(&vec![0u8; size.saturating_sub(8)]).unwrap();
    }

    #[test]
    fn accepts_small_png() {
        let dir = tmp_dir();
        let src = dir.join("in.png");
        write_png(&src, 100);
        let rel = save_icon_impl(&dir.join("out"), "abc", &src).unwrap();
        assert!(rel.starts_with("connection-icons/abc-"));
        assert!(rel.ends_with(".png"));
    }

    #[test]
    fn rejects_oversize() {
        let dir = tmp_dir();
        let src = dir.join("big.png");
        write_png(&src, (MAX_ICON_BYTES + 1) as usize);
        let err = save_icon_impl(&dir.join("out"), "abc", &src).unwrap_err();
        assert!(matches!(err, IconError::TooLarge));
    }

    #[test]
    fn rejects_unknown_format() {
        let dir = tmp_dir();
        let src = dir.join("x.txt");
        fs::write(&src, b"hello world").unwrap();
        let err = save_icon_impl(&dir.join("out"), "abc", &src).unwrap_err();
        assert!(matches!(err, IconError::UnsupportedFormat));
    }

    #[test]
    fn rejects_svg_with_script() {
        let dir = tmp_dir();
        let src = dir.join("evil.svg");
        fs::write(&src, b"<svg><script>alert(1)</script></svg>").unwrap();
        let err = save_icon_impl(&dir.join("out"), "abc", &src).unwrap_err();
        assert!(matches!(err, IconError::UnsafeSvg));
    }

    #[test]
    fn rejects_svg_with_onload() {
        let dir = tmp_dir();
        let src = dir.join("evil2.svg");
        fs::write(&src, b"<svg onload=\"alert(1)\"></svg>").unwrap();
        let err = save_icon_impl(&dir.join("out"), "abc", &src).unwrap_err();
        assert!(matches!(err, IconError::UnsafeSvg));
    }

    #[test]
    fn accepts_clean_svg() {
        let dir = tmp_dir();
        let src = dir.join("clean.svg");
        fs::write(&src, b"<svg xmlns=\"http://www.w3.org/2000/svg\"><circle r=\"5\"/></svg>").unwrap();
        let rel = save_icon_impl(&dir.join("out"), "abc", &src).unwrap();
        assert!(rel.ends_with(".svg"));
    }

    #[test]
    fn rejects_bad_connection_id() {
        let dir = tmp_dir();
        let src = dir.join("in.png");
        write_png(&src, 100);
        let err = save_icon_impl(&dir.join("out"), "../etc/passwd", &src).unwrap_err();
        assert!(matches!(err, IconError::InvalidConnectionId));
    }

    #[test]
    fn idempotent_same_content_same_path() {
        let dir = tmp_dir();
        let src = dir.join("in.png");
        write_png(&src, 100);
        let a = save_icon_impl(&dir.join("out"), "abc", &src).unwrap();
        let b = save_icon_impl(&dir.join("out"), "abc", &src).unwrap();
        assert_eq!(a, b);
    }
}
