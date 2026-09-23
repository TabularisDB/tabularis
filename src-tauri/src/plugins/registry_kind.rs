/// Tabularium folds the validated manifest kind into tags. Only operator-defined
/// kind keys identify kinds; arbitrary tags must never become driver/theme types.
pub(super) fn classify(tags: &[String], kinds: &[String]) -> Option<String> {
    let mut matches = kinds.iter().filter(|kind| tags.contains(kind));
    let first = matches.next()?.clone();
    if matches.any(|kind| kind != &first) {
        Some("unsupported:ambiguous-kind".into())
    } else {
        Some(first)
    }
}

#[cfg(test)]
#[path = "registry_kind_tests.rs"]
mod tests;
