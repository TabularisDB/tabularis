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
    fn rejects_svg_with_spaced_onclick() {
        let dir = tmp_dir();
        let src = dir.join("evil3.svg");
        std::fs::write(&src, b"<svg onclick = \"alert(1)\"></svg>").unwrap();
        let err = save_icon_impl(&dir.join("out"), "abc", &src).unwrap_err();
        assert!(matches!(err, IconError::UnsafeSvg));
    }

    #[test]
    fn rejects_svg_with_chained_onload() {
        let dir = tmp_dir();
        let src = dir.join("evil4.svg");
        std::fs::write(&src, b"<svg x=onload=alert(1)></svg>").unwrap();
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

    #[test]
    fn cascade_delete_removes_image_icon() {
        use crate::models::{IconOverride, ConnectionAppearance};
        let dir = tmp_dir();
        // Create the file under <dir>/connection-icons/foo.png
        let icons_dir = dir.join("connection-icons");
        std::fs::create_dir_all(&icons_dir).unwrap();
        let file = icons_dir.join("foo.png");
        std::fs::write(&file, b"x").unwrap();
        assert!(file.exists());

        let appearance = ConnectionAppearance {
            icon: Some(IconOverride::Image { path: "connection-icons/foo.png".into() }),
            accent_color: None,
        };
        crate::connection_appearance::cascade_delete_if_image(&dir, Some(&appearance)).unwrap();
        assert!(!file.exists());
    }

    #[test]
    fn cascade_delete_noop_when_no_image() {
        use crate::models::{IconOverride, ConnectionAppearance};
        let dir = tmp_dir();
        // Pack variant — should not touch any file.
        let appearance = ConnectionAppearance {
            icon: Some(IconOverride::Pack { id: "server".into() }),
            accent_color: Some("#ff0000".into()),
        };
        crate::connection_appearance::cascade_delete_if_image(&dir, Some(&appearance)).unwrap();
        // No-op cases also: appearance is None, or icon is None.
        crate::connection_appearance::cascade_delete_if_image(&dir, None).unwrap();
    }

    #[test]
    fn cascade_delete_silently_ignores_missing_file() {
        use crate::models::{IconOverride, ConnectionAppearance};
        let dir = tmp_dir();
        let appearance = ConnectionAppearance {
            icon: Some(IconOverride::Image { path: "connection-icons/does-not-exist.png".into() }),
            accent_color: None,
        };
        // Should NOT return an error — deleting a connection should not fail just because its icon vanished.
        crate::connection_appearance::cascade_delete_if_image(&dir, Some(&appearance)).unwrap();
    }

    #[test]
    fn cascade_delete_rejects_path_traversal() {
        use crate::models::{IconOverride, ConnectionAppearance};
        use crate::connection_appearance::cascade_delete_if_image;
        let dir = tmp_dir();
        let icons_dir = dir.join("connection-icons");
        std::fs::create_dir_all(&icons_dir).unwrap();
        // Create a "victim" file outside the icons dir
        let outside = dir.join("victim.txt");
        std::fs::write(&outside, b"important").unwrap();
        assert!(outside.exists());

        let appearance = ConnectionAppearance {
            icon: Some(IconOverride::Image { path: "../victim.txt".into() }),
            accent_color: None,
        };
        cascade_delete_if_image(&dir, Some(&appearance)).unwrap();
        // Victim must still exist — path-traversal attack must be blocked
        assert!(outside.exists(), "path-traversal attack should not delete files outside icons dir");
    }

    #[test]
    fn copy_icon_for_duplicate_produces_new_filename() {
        let dir = tmp_dir();
        let icons_dir = dir.join("connection-icons");
        std::fs::create_dir_all(&icons_dir).unwrap();
        // Set up a fake source icon (a tiny PNG)
        let src_rel = "connection-icons/original-abcd.png";
        let src_path = dir.join(src_rel);
        std::fs::write(&src_path, &[0x89, b'P', b'N', b'G', 0, 0, 0, 0, 0, 0, 0, 0]).unwrap();

        let new_rel = crate::connection_appearance::copy_icon_for_duplicate(&dir, src_rel, "newid").unwrap();
        assert_ne!(new_rel, src_rel);
        assert!(new_rel.starts_with("connection-icons/newid-"));
        // Both files must exist: original is preserved, duplicate has its own copy
        assert!(src_path.exists());
        assert!(dir.join(&new_rel).exists());
    }

    #[test]
    fn copy_icon_for_duplicate_rejects_path_traversal() {
        use crate::connection_appearance::{copy_icon_for_duplicate, IconError};
        let dir = tmp_dir();
        std::fs::create_dir_all(dir.join("connection-icons")).unwrap();
        std::fs::write(dir.join("victim.txt"), b"important").unwrap();
        let err = copy_icon_for_duplicate(&dir, "../victim.txt", "newid").unwrap_err();
        assert!(matches!(err, IconError::InvalidConnectionId | IconError::Io(_)));
    }
}
