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
        let mut stream = UnixStream::connect(server.endpoint()).expect("connect to server");
        stream
            .write_all(format!("{}\n", request).as_bytes())
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
                    "{}\n",
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
