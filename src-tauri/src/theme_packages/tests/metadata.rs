use super::http_fixture::RegistryServer;
use crate::plugins::tabularium;
use serde_json::json;

#[tokio::test]
async fn screenshots_are_bounded_metadata_without_fetching_media_or_changing_driver_dto() {
    let server = RegistryServer::new(vec![]);
    server.state.lock().unwrap().screenshots = (0..20).map(|index| json!({"url":format!("https://example.invalid/{index}.png"),"alt":"Screenshot","caption":"Dark and light preview"})).collect();
    let detail = tabularium::fetch_theme_detail(&server.base, "fixture-theme")
        .await
        .unwrap();
    assert_eq!(detail.screenshots.len(), 16);
    assert_eq!(
        detail.screenshots[0].caption.as_deref(),
        Some("Dark and light preview")
    );
    let wire = serde_json::to_value(detail).unwrap();
    assert_eq!(wire["id"], "fixture-theme");
    assert_eq!(wire["kind"], "theme");
    assert!(server.tracked().is_empty());
    assert!(server.requests.lock().unwrap().iter().all(|path| path
        .starts_with("/api/plugins/fixture-theme")
        || path.starts_with("/api/kinds")));
    let driver_shape = serde_json::to_value(
        tabularium::fetch_plugin_detail(&server.base, "fixture-theme")
            .await
            .unwrap(),
    )
    .unwrap();
    assert!(driver_shape.get("screenshots").is_none());
    server.state.lock().unwrap().screenshots =
        vec![json!({"url":"https://example.invalid/image.png","caption":"x".repeat(2049)})];
    assert!(
        tabularium::fetch_theme_detail(&server.base, "fixture-theme")
            .await
            .unwrap()
            .screenshots
            .is_empty()
    );
    server.state.lock().unwrap().tags = vec!["driver".into()];
    assert!(
        tabularium::fetch_theme_detail(&server.base, "fixture-theme")
            .await
            .is_err()
    );
}
