//! Declarative theme contracts. No executable plugin activation belongs here.
mod archive;
mod catalog;
mod catalog_models;
pub mod commands;
mod files;
mod json;
mod legacy;
mod lifecycle;
mod locations;
mod personal;
pub(crate) use json::parse_bounded_json;

pub use catalog::read_theme_catalog;
pub use catalog_models::{ThemeCatalog, ThemeContribution};
pub use personal::{
    create_personal_definition, duplicate_personal_theme, export_personal_theme,
    import_legacy_theme, import_legacy_theme_named, remove_personal_theme, save_legacy_theme,
    update_personal_definition,
};
mod snapshot;
mod storage;
mod transport;
pub use snapshot::{create_personal_snapshot, standalone_theme_source, update_personal_snapshot};
mod validation;
mod zip_layout;

pub use archive::{validate_theme_archive, ValidatedThemePackage};
pub use storage::{install_validated_theme, recover_theme_transactions, ThemeCommit};

pub use validation::{
    is_package_slug, is_registry_namespace, is_safe_relative_path, package_id, registry_key,
    validate_definition_json, validate_manifest_json, validate_runtime_version,
};

#[cfg(test)]
mod tests;
