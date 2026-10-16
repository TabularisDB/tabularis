use super::protocol::*;

mod escape_tests {
    use super::*;

    #[test]
    fn test_plain_text_unchanged() {
        assert_eq!(escape("Enter PIN for key:"), "Enter PIN for key:");
        assert_eq!(unescape("Enter PIN for key:"), "Enter PIN for key:");
    }

    #[test]
    fn test_newlines_escaped() {
        assert_eq!(escape("line1\nline2"), "line1\\nline2");
        assert_eq!(escape("a\r\nb"), "a\\r\\nb");
    }

    #[test]
    fn test_backslash_escaped() {
        assert_eq!(escape("C:\\path"), "C:\\\\path");
    }

    #[test]
    fn test_roundtrip() {
        let inputs = [
            "simple",
            "with\nnewline",
            "with\\backslash",
            "mixed \\n literal and \n real",
            "trailing\\",
            "",
        ];
        for input in inputs {
            assert_eq!(unescape(&escape(input)), input, "roundtrip of {:?}", input);
        }
    }

    #[test]
    fn test_unescape_unknown_sequence_kept() {
        assert_eq!(unescape("a\\tb"), "a\\tb");
    }

    #[test]
    fn test_unescape_trailing_backslash() {
        assert_eq!(unescape("abc\\"), "abc\\");
    }
}

mod prompt_kind_tests {
    use super::*;

    #[test]
    fn test_parse_roundtrip() {
        for kind in [PromptKind::Secret, PromptKind::Confirm, PromptKind::Notify] {
            assert_eq!(PromptKind::parse(kind.as_str()), Some(kind));
        }
    }

    #[test]
    fn test_parse_unknown() {
        assert_eq!(PromptKind::parse("bogus"), None);
    }

    #[test]
    fn test_from_ssh_env() {
        assert_eq!(PromptKind::from_ssh_env(None), PromptKind::Secret);
        assert_eq!(
            PromptKind::from_ssh_env(Some("confirm")),
            PromptKind::Confirm
        );
        assert_eq!(PromptKind::from_ssh_env(Some("none")), PromptKind::Notify);
        assert_eq!(PromptKind::from_ssh_env(Some("other")), PromptKind::Secret);
    }
}

mod request_codec_tests {
    use super::*;

    #[test]
    fn test_request_roundtrip() {
        let encoded = encode_request(PromptKind::Secret, "Enter PIN for ED25519-SK key:");
        assert_eq!(
            decode_request(&encoded),
            Some((
                PromptKind::Secret,
                "Enter PIN for ED25519-SK key:".to_string()
            ))
        );
    }

    #[test]
    fn test_request_with_newline_in_prompt() {
        let encoded = encode_request(PromptKind::Confirm, "Allow?\nyes/no");
        assert_eq!(
            decode_request(&encoded),
            Some((PromptKind::Confirm, "Allow?\nyes/no".to_string()))
        );
        assert!(!encoded.contains('\n'));
    }

    #[test]
    fn test_request_empty_prompt() {
        let encoded = encode_request(PromptKind::Notify, "");
        assert_eq!(
            decode_request(&encoded),
            Some((PromptKind::Notify, String::new()))
        );
    }

    #[test]
    fn test_decode_malformed_request() {
        assert_eq!(decode_request("nonsense"), None);
        assert_eq!(decode_request("ASK bogus prompt"), None);
        assert_eq!(decode_request(""), None);
    }
}

mod response_codec_tests {
    use super::*;

    #[test]
    fn test_answer_roundtrip() {
        let encoded = encode_response(Some("s3cret"));
        assert_eq!(decode_response(&encoded), Some(Some("s3cret".to_string())));
    }

    #[test]
    fn test_empty_answer() {
        let encoded = encode_response(Some(""));
        assert_eq!(decode_response(&encoded), Some(Some(String::new())));
    }

    #[test]
    fn test_cancel_roundtrip() {
        let encoded = encode_response(None);
        assert_eq!(decode_response(&encoded), Some(None));
    }

    #[test]
    fn test_decode_malformed_response() {
        assert_eq!(decode_response("nonsense"), None);
        assert_eq!(decode_response(""), None);
    }
}

#[cfg(unix)]
mod server_tests {
    use super::super::protocol::{decode_response, encode_request, PromptKind};
    use super::super::server::{AskpassServer, AskpassUi};
    use std::io::{BufRead, BufReader, Write};
    use std::os::unix::net::UnixStream;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    /// Test double that answers every prompt with a fixed response and
    /// records notification activity.
    struct StubUi {
        answer: Option<String>,
        seen_prompts: Mutex<Vec<String>>,
        notifications_dismissed: AtomicU64,
    }

    impl StubUi {
        fn new(answer: Option<&str>) -> Self {
            Self {
                answer: answer.map(|s| s.to_string()),
                seen_prompts: Mutex::new(Vec::new()),
                notifications_dismissed: AtomicU64::new(0),
            }
        }
    }

    impl AskpassUi for StubUi {
        fn request(&self, _kind: PromptKind, prompt: &str) -> Option<String> {
            self.seen_prompts.lock().unwrap().push(prompt.to_string());
            self.answer.clone()
        }

        fn show_notification(&self, prompt: &str) -> u64 {
            self.seen_prompts.lock().unwrap().push(prompt.to_string());
            42
        }

        fn dismiss_notification(&self, _id: u64) {
            self.notifications_dismissed.fetch_add(1, Ordering::Relaxed);
        }
    }

    fn exchange(server: &AskpassServer, request: &str) -> String {
        authed_exchange(server, server.token(), request)
    }

    fn authed_exchange(server: &AskpassServer, token: &str, request: &str) -> String {
        let mut stream = UnixStream::connect(server.endpoint()).expect("connect to server");
        stream
            .write_all(format!("AUTH {}\n{}\n", token, request).as_bytes())
            .expect("send request");
        let mut line = String::new();
        BufReader::new(stream)
            .read_line(&mut line)
            .expect("read response");
        line.trim_end_matches('\n').to_string()
    }

    #[test]
    fn test_secret_prompt_answered() {
        let ui = Arc::new(StubUi::new(Some("1234")));
        let server = AskpassServer::start(ui.clone()).expect("start server");

        let reply = exchange(&server, &encode_request(PromptKind::Secret, "Enter PIN:"));
        assert_eq!(decode_response(&reply), Some(Some("1234".to_string())));
        assert_eq!(*ui.seen_prompts.lock().unwrap(), vec!["Enter PIN:"]);
    }

    #[test]
    fn test_cancelled_prompt() {
        let ui = Arc::new(StubUi::new(None));
        let server = AskpassServer::start(ui).expect("start server");

        let reply = exchange(&server, &encode_request(PromptKind::Secret, "Enter PIN:"));
        assert_eq!(decode_response(&reply), Some(None));
    }

    #[test]
    fn test_notification_dismissed_on_disconnect() {
        let ui = Arc::new(StubUi::new(None));
        let server = AskpassServer::start(ui.clone()).expect("start server");

        let mut stream = UnixStream::connect(server.endpoint()).expect("connect to server");
        stream
            .write_all(
                format!(
                    "AUTH {}\n{}\n",
                    server.token(),
                    encode_request(PromptKind::Notify, "Confirm user presence")
                )
                .as_bytes(),
            )
            .expect("send request");

        // Wait until the notification is shown, then drop the connection as
        // ssh does when the key was touched.
        wait_until(|| !ui.seen_prompts.lock().unwrap().is_empty());
        drop(stream);
        wait_until(|| ui.notifications_dismissed.load(Ordering::Relaxed) == 1);
    }

    #[test]
    fn test_socket_path_fits_macos_sun_path() {
        let path = super::super::server::askpass_socket_path().expect("socket path");
        let len = path.to_string_lossy().len();
        assert!(
            len <= 103,
            "askpass socket path is {len} bytes, which cannot bind on macOS: {}",
            path.display()
        );
    }

    #[test]
    fn test_stored_passphrase_and_password_skip_ui() {
        let ui = Arc::new(StubUi::new(Some("should-not-be-used")));
        let server = AskpassServer::start_with(
            ui.clone(),
            super::super::server::AskpassOptions {
                password: Some("account-secret".to_string()),
                key_passphrase: Some("key-secret".to_string()),
                key_path: Some("/tmp/id_ed25519".to_string()),
                allow_ui: false,
            },
        )
        .expect("start server");

        let passphrase = exchange(
            &server,
            &encode_request(
                PromptKind::Secret,
                "Enter passphrase for key '/tmp/id_ed25519': ",
            ),
        );
        assert_eq!(
            decode_response(&passphrase),
            Some(Some("key-secret".to_string()))
        );

        let password = exchange(
            &server,
            &encode_request(PromptKind::Secret, "ploi@host's password: "),
        );
        assert_eq!(
            decode_response(&password),
            Some(Some("account-secret".to_string()))
        );
        assert!(ui.seen_prompts.lock().unwrap().is_empty());
    }

    #[test]
    fn test_stored_secret_requires_token() {
        let ui = Arc::new(StubUi::new(Some("should-not-be-used")));
        let server = AskpassServer::start_with(
            ui.clone(),
            super::super::server::AskpassOptions {
                key_passphrase: Some("key-secret".to_string()),
                key_path: Some("/tmp/id_ed25519".to_string()),
                allow_ui: false,
                ..super::super::server::AskpassOptions::default()
            },
        )
        .expect("start server");

        let prompt = encode_request(
            PromptKind::Secret,
            "Enter passphrase for key '/tmp/id_ed25519': ",
        );
        let missing = authed_exchange(&server, "", &prompt);
        assert!(
            missing.is_empty(),
            "a connection without the token must not receive the passphrase"
        );
        let wrong = authed_exchange(&server, "not-the-token", &prompt);
        assert!(
            wrong.is_empty(),
            "a connection with the wrong token must not receive the passphrase"
        );
        assert!(ui.seen_prompts.lock().unwrap().is_empty());

        let authed = exchange(&server, &prompt);
        assert_eq!(
            decode_response(&authed),
            Some(Some("key-secret".to_string()))
        );
    }

    #[test]
    fn test_unmatched_prompt_cancelled_when_ui_disabled() {
        let ui = Arc::new(StubUi::new(Some("typed-by-user")));
        let server = AskpassServer::start_with(
            ui.clone(),
            super::super::server::AskpassOptions {
                password: Some("account-secret".to_string()),
                key_passphrase: Some("key-secret".to_string()),
                key_path: Some("/tmp/id_ed25519".to_string()),
                allow_ui: false,
            },
        )
        .expect("start server");

        // A PIN prompt is neither OpenSSH's local key prompt nor a password
        // prompt, so neither stored secret may be disclosed.
        let reply = exchange(&server, &encode_request(PromptKind::Secret, "Enter PIN:"));
        assert_eq!(decode_response(&reply), Some(None));
        assert!(ui.seen_prompts.lock().unwrap().is_empty());
    }

    #[test]
    fn test_socket_removed_on_drop() {
        let ui = Arc::new(StubUi::new(None));
        let server = AskpassServer::start(ui).expect("start server");
        let path = std::path::PathBuf::from(server.endpoint());
        assert!(path.exists());
        drop(server);
        assert!(!path.exists());
    }

    fn wait_until(condition: impl Fn() -> bool) {
        for _ in 0..100 {
            if condition() {
                return;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        panic!("condition not met within timeout");
    }
}

mod take_for_prompt_tests {
    use super::super::server::{
        openssh_key_passphrase_prompt, StoredSecrets, OPENSSH_KEY_PATH_PROMPT_BYTES,
    };

    fn secrets(
        password: Option<&str>,
        passphrase: Option<&str>,
        key_path: Option<&str>,
    ) -> StoredSecrets {
        StoredSecrets {
            password: password.map(str::to_string),
            key_passphrase: passphrase.map(str::to_string),
            key_path: key_path.map(str::to_string),
        }
    }

    #[test]
    fn exact_local_prompt_returns_passphrase_once() {
        let path = "/tmp/id_ed25519";
        let mut stored = secrets(Some("account"), Some("key-secret"), Some(path));
        let prompt = openssh_key_passphrase_prompt(path);
        assert_eq!(prompt, "Enter passphrase for key '/tmp/id_ed25519': ");
        assert_eq!(
            stored.take_for_prompt(&prompt).as_deref(),
            Some("key-secret")
        );
        assert_eq!(stored.take_for_prompt(&prompt), None);
    }

    #[test]
    fn passphrase_prompt_without_selected_path_is_ignored() {
        let mut stored = secrets(None, Some("key-secret"), Some("/tmp/id_ed25519"));
        assert_eq!(stored.take_for_prompt("Enter passphrase for key:"), None);
        assert_eq!(
            stored.take_for_prompt("Enter passphrase for key '/tmp/other': "),
            None
        );
        assert_eq!(stored.key_passphrase.as_deref(), Some("key-secret"));
    }

    #[test]
    fn generic_prompt_does_not_use_the_only_stored_secret() {
        let mut passphrase_only = secrets(None, Some("key-secret"), Some("/tmp/id_ed25519"));
        assert_eq!(passphrase_only.take_for_prompt("Verification code:"), None);
        assert_eq!(
            passphrase_only.key_passphrase.as_deref(),
            Some("key-secret")
        );

        let mut password_only = secrets(Some("account-secret"), None, None);
        assert_eq!(password_only.take_for_prompt("Verification code:"), None);
        assert_eq!(password_only.password.as_deref(), Some("account-secret"));
    }

    #[test]
    fn password_prompt_returns_account_password() {
        let mut stored = secrets(
            Some("account-secret"),
            Some("key-secret"),
            Some("/tmp/id_ed25519"),
        );
        assert_eq!(
            stored.take_for_prompt("user@host's password: ").as_deref(),
            Some("account-secret")
        );
        assert_eq!(stored.key_passphrase.as_deref(), Some("key-secret"));
    }

    #[test]
    fn long_path_matches_openssh_truncated_prompt() {
        let path = format!("/tmp/{}", "k".repeat(120));
        assert!(path.len() > OPENSSH_KEY_PATH_PROMPT_BYTES);
        let mut stored = secrets(None, Some("key-secret"), Some(&path));
        let prompt = openssh_key_passphrase_prompt(&path);
        let shown = &path[..OPENSSH_KEY_PATH_PROMPT_BYTES];
        assert_eq!(prompt, format!("Enter passphrase for key '{shown}': "));
        assert_eq!(
            stored.take_for_prompt(&prompt).as_deref(),
            Some("key-secret")
        );
    }

    #[test]
    fn missing_key_path_does_not_release_passphrase() {
        let mut stored = secrets(None, Some("key-secret"), None);
        assert_eq!(
            stored.take_for_prompt("Enter passphrase for key '/tmp/id_ed25519': "),
            None
        );
    }

    #[test]
    fn tilde_key_path_matches_expanded_home_prompt() {
        let home = directories::BaseDirs::new()
            .expect("home directory")
            .home_dir()
            .to_string_lossy()
            .into_owned();
        let mut stored = secrets(None, Some("key-secret"), Some("~/.ssh/id_ed25519"));
        let expanded = format!("Enter passphrase for key '{home}/.ssh/id_ed25519': ");
        assert_eq!(
            stored.take_for_prompt(&expanded).as_deref(),
            Some("key-secret")
        );

        let mut stored = secrets(None, Some("key-secret"), Some("~/.ssh/id_ed25519"));
        assert_eq!(
            stored.take_for_prompt("Enter passphrase for key '~/.ssh/id_ed25519': "),
            None
        );
    }
}
