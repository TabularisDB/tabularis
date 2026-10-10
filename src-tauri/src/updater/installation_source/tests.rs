use super::*;

#[test]
fn custom_package_manager_requires_source_and_name() {
    assert_eq!(
        detect_installation_source_with(Some("eopkg"), Some("Solus")).as_deref(),
        Some("Solus")
    );
    assert_eq!(custom_package_manager_name(None, Some("Solus")), None);
    assert_eq!(custom_package_manager_name(Some("eopkg"), None), None);
    assert_eq!(custom_package_manager_name(Some(""), Some("Solus")), None);
    assert_eq!(custom_package_manager_name(Some("eopkg"), Some(" ")), None);
}

#[test]
fn custom_package_manager_trims_display_name() {
    assert_eq!(
        custom_package_manager_name(Some(" eopkg "), Some(" Solus ")).as_deref(),
        Some("Solus")
    );
}

#[test]
fn embedded_custom_package_manager_is_detected_when_configured() {
    let Some(expected_name) =
        custom_package_manager_name(CUSTOM_PACKAGE_MANAGER_SOURCE, CUSTOM_PACKAGE_MANAGER_NAME)
    else {
        return;
    };

    assert_eq!(
        detect_installation_source().as_deref(),
        Some(expected_name.as_str())
    );
}

// Environment mutations must be serialized across parallel tests.
#[cfg(target_os = "linux")]
static ENV_MUTEX: std::sync::LazyLock<std::sync::Mutex<()>> =
    std::sync::LazyLock::new(|| std::sync::Mutex::new(()));

#[cfg(target_os = "linux")]
#[test]
fn detects_snap_installation() {
    let _lock = ENV_MUTEX.lock().unwrap();
    std::env::remove_var("FLATPAK_ID");
    std::env::set_var("SNAP", "/snap/tabularis/current");
    let source = detect_installation_source_with(None, None);
    std::env::remove_var("SNAP");
    assert_eq!(source.as_deref(), Some("snap"));
}

#[cfg(target_os = "linux")]
#[test]
fn detects_flatpak_installation() {
    let _lock = ENV_MUTEX.lock().unwrap();
    std::env::remove_var("SNAP");
    std::env::set_var("FLATPAK_ID", "io.github.debba.tabularis");
    let source = detect_installation_source_with(None, None);
    std::env::remove_var("FLATPAK_ID");
    assert_eq!(source.as_deref(), Some("flatpak"));
}

#[cfg(target_os = "linux")]
#[test]
fn detects_direct_installation() {
    let _lock = ENV_MUTEX.lock().unwrap();
    std::env::remove_var("SNAP");
    std::env::remove_var("FLATPAK_ID");
    let source = detect_installation_source_with(None, None);
    // A release test host may have tabularis-bin installed through AUR.
    assert!(source.is_none() || source.as_deref() == Some("aur"));
}

#[test]
fn detects_winget_from_localappdata_packages_dir() {
    let source = detect_winget_with(
        Some(r"C:\Users\test\AppData\Local"),
        None,
        None,
        |dir| dir == r"C:\Users\test\AppData\Local\Microsoft\WinGet\Packages",
        None,
    );
    assert_eq!(source.as_deref(), Some("winget"));
}

#[test]
fn detects_winget_from_program_files_packages_dir() {
    let source = detect_winget_with(
        None,
        Some(r"C:\Program Files"),
        None,
        |dir| dir == r"C:\Program Files\WinGet\Packages",
        None,
    );
    assert_eq!(source.as_deref(), Some("winget"));
}

#[test]
fn detects_winget_from_program_files_x86_packages_dir() {
    let source = detect_winget_with(
        None,
        None,
        Some(r"C:\Program Files (x86)"),
        |dir| dir == r"C:\Program Files (x86)\WinGet\Packages",
        None,
    );
    assert_eq!(source.as_deref(), Some("winget"));
}

#[test]
fn detects_winget_from_portable_exe_path() {
    let source = detect_winget_with(
        None,
        None,
        None,
        |_| false,
        Some(
            r"C:\Users\test\AppData\Local\Microsoft\WinGet\Packages\Debba.Tabularis_Microsoft.Winget.Source_8wekyb3d8bbwe\tabularis.exe",
        ),
    );
    assert_eq!(source.as_deref(), Some("winget"));
}

#[test]
fn detects_winget_from_forward_slash_exe_path() {
    let source = detect_winget_with(
        None,
        None,
        None,
        |_| false,
        Some(
            r"C:/Users/test/AppData/Local/Microsoft/WinGet/Packages/Debba.Tabularis_msstore/tabularis.exe",
        ),
    );
    assert_eq!(source.as_deref(), Some("winget"));
}

#[test]
fn winget_undetected_without_markers() {
    let source = detect_winget_with(
        Some(r"C:\Users\test\AppData\Local"),
        Some(r"C:\Program Files"),
        Some(r"C:\Program Files (x86)"),
        |_| false,
        Some(r"C:\Program Files\Tabularis\tabularis.exe"),
    );
    assert_eq!(source, None);
}

#[test]
fn winget_ignores_empty_env_roots() {
    let source = detect_winget_with(Some(""), Some(""), Some(""), |_| true, None);
    assert_eq!(source, None);
}

#[test]
fn exe_path_looks_like_winget_requires_package_prefix() {
    assert!(exe_path_looks_like_winget(
        r"C:\Users\a\AppData\Local\Microsoft\WinGet\Packages\Debba.Tabularis_x\app.exe"
    ));
    assert!(!exe_path_looks_like_winget(
        r"C:\Users\a\AppData\Local\Microsoft\WinGet\Packages\Other.App\app.exe"
    ));
    assert!(!exe_path_looks_like_winget(
        r"C:\Program Files\Tabularis\tabularis.exe"
    ));
}

#[test]
fn winget_packages_dir_has_tabularis_reads_injected_layout() {
    let dir = tempfile_winget_packages_dir();
    let packages = dir.path().join("Packages");
    std::fs::create_dir_all(&packages).unwrap();
    std::fs::create_dir_all(packages.join("Debba.Tabularis_Microsoft.Winget.Source_8wekyb3d8bbwe"))
        .unwrap();
    std::fs::create_dir_all(packages.join("Other.App_source")).unwrap();

    assert!(winget_packages_dir_has_tabularis(
        packages.to_str().expect("utf-8 temp path")
    ));

    let empty = dir.path().join("Empty");
    std::fs::create_dir_all(&empty).unwrap();
    assert!(!winget_packages_dir_has_tabularis(
        empty.to_str().expect("utf-8 temp path")
    ));
    assert!(!winget_packages_dir_has_tabularis(
        dir.path()
            .join("missing")
            .to_str()
            .expect("utf-8 temp path")
    ));
}

fn tempfile_winget_packages_dir() -> tempfile::TempDir {
    tempfile::tempdir().expect("temp dir")
}
