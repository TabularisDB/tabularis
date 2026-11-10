use super::*;

#[test]
fn system_plugins_stay_local_when_data_storage_is_redirected() {
    let mut paths = FixedRuntimePaths::system();
    paths.data_dir = PathBuf::from("/custom/synced/storage");
    assert_eq!(paths.plugins_dir(), crate::paths::get_plugins_dir());
}

#[test]
fn explicit_fixture_paths_keep_plugins_inside_the_fixture() {
    let paths = FixedRuntimePaths::new(PathBuf::from("config"), PathBuf::from("fixture-data"));
    assert_eq!(paths.plugins_dir(), PathBuf::from("fixture-data/plugins"));
}
