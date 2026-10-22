use super::*;

#[test]
fn cached_and_remote_catalogs_retire_only_legacy_minimax_text_choices() {
    let mut models = HashMap::from([
        (
            "minimax".into(),
            vec![
                "MiniMax-M2.7".into(),
                "MiniMax-M3".into(),
                "MiniMax-Text-01".into(),
                "speech-02-hd".into(),
            ],
        ),
        (
            "openrouter".into(),
            vec![
                "openai/gpt-4o".into(),
                "minimax/minimax-m3".into(),
                "minimax/minimax-m2.7".into(),
                "anthropic/claude-sonnet-4-6".into(),
                "minimax/minimax-m3.1-flash:free".into(),
                "minimax/speech-02-hd".into(),
                "minimax/minimax-music-2.5".into(),
            ],
        ),
        (
            "requesty".into(),
            vec![
                "openai/gpt-4o-mini".into(),
                "minimax-m3@eu".into(),
                "minimaxi/minimax-m2.7".into(),
                "minimax-m3.1-flash".into(),
                "minimaxi/minimax-m3.1-flash".into(),
                "fireworks/minimax-m3".into(),
                "bedrock/minimax-m2.5@eu-central-1".into(),
            ],
        ),
        ("custom-openai".into(), vec!["MiniMax-M2.7".into()]),
        ("anthropic".into(), vec!["claude-sonnet-4-6".into()]),
    ]);
    normalize_minimax_models(&mut models);
    assert_eq!(
        models["minimax"],
        ["MiniMax-M3.1-Flash", "MiniMax-M3", "speech-02-hd"]
    );
    assert_eq!(
        models["openrouter"],
        [
            "openai/gpt-4o",
            "minimax/minimax-m3.1-flash:free",
            "anthropic/claude-sonnet-4-6",
            "minimax/minimax-m3",
            "minimax/speech-02-hd",
            "minimax/minimax-music-2.5",
        ]
    );
    assert_eq!(
        models["requesty"],
        [
            "openai/gpt-4o-mini",
            "minimax-m3.1-flash",
            "minimaxi/minimax-m3.1-flash",
            "minimax-m3@eu",
            "fireworks/minimax-m3",
            "minimax-m3",
        ]
    );
    assert_eq!(models["custom-openai"], ["MiniMax-M2.7"]);
    assert_eq!(models["anthropic"], ["claude-sonnet-4-6"]);
    let normalized = models.clone();
    normalize_minimax_models(&mut models);
    assert_eq!(models, normalized);
}

#[test]
fn normalization_does_not_invent_gateway_routes() {
    let mut models = HashMap::from([(
        "openrouter".into(),
        vec![
            "minimax/minimax-m3.1-flash".into(),
            "minimax/minimax-m3".into(),
        ],
    )]);
    normalize_minimax_models(&mut models);
    assert_eq!(
        models["openrouter"],
        ["minimax/minimax-m3.1-flash:free", "minimax/minimax-m3"]
    );
    assert!(!models.contains_key("requesty"));
}

#[tokio::test]
async fn default_selection_preserves_explicit_legacy_and_custom_models() {
    let config = config::AppConfig::default();
    assert_eq!(
        resolve_model("minimax", "", &config, 11434).await.unwrap(),
        "MiniMax-M3.1-Flash"
    );
    for (provider, model) in [
        ("minimax", "MiniMax-M3"),
        ("minimax", "MiniMax-M2.7"),
        ("minimax", "MiniMax-M2.7-highspeed"),
        ("openrouter", "minimax/minimax-m2.7"),
        ("requesty", "minimaxi/minimax-m2.7"),
        ("custom-openai", "my-custom-model"),
    ] {
        assert_eq!(
            resolve_model(provider, model, &config, 11434)
                .await
                .unwrap(),
            model
        );
    }
    for provider in ["openai", "anthropic", "openrouter", "requesty"] {
        assert_eq!(
            resolve_model(provider, "", &config, 11434).await.unwrap(),
            load_default_models()[provider][0]
        );
    }
}
