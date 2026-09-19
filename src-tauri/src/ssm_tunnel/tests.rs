use super::*;

fn parameters_of(args: &[String]) -> serde_json::Value {
    let index = args.iter().position(|a| a == "--parameters").unwrap();
    serde_json::from_str(&args[index + 1]).unwrap()
}

fn flag_of<'a>(args: &'a [String], flag: &str) -> Option<&'a String> {
    args.iter().position(|a| a == flag).map(|i| &args[i + 1])
}

fn document_of(args: &[String]) -> &String {
    flag_of(args, "--document-name").unwrap()
}

mod normalize_tests {
    use super::*;

    #[test]
    fn none_stays_none() {
        assert_eq!(normalize(None), None);
    }

    #[test]
    fn blank_becomes_none() {
        assert_eq!(normalize(Some("")), None);
        assert_eq!(normalize(Some("  \t ")), None);
    }

    #[test]
    fn content_is_trimmed() {
        assert_eq!(normalize(Some("  eu-west-1 ")), Some("eu-west-1".into()));
    }
}

mod is_node_local_tests {
    use super::*;

    #[test]
    fn loopback_names_are_node_local() {
        assert!(is_node_local(""));
        assert!(is_node_local("  "));
        assert!(is_node_local("localhost"));
        assert!(is_node_local(" 127.0.0.1 "));
        assert!(is_node_local("::1"));
    }

    #[test]
    fn other_hosts_are_not_node_local() {
        assert!(!is_node_local("db.eu-west-1.rds.amazonaws.com"));
        assert!(!is_node_local("10.0.1.15"));
    }
}

mod build_start_session_args_tests {
    use super::*;

    #[test]
    fn forwards_to_the_node_for_a_loopback_host() {
        let args = build_start_session_args("i-0abc", None, None, "localhost", 5432, 54321);

        assert_eq!(document_of(&args), "AWS-StartPortForwardingSession");
        assert_eq!(
            parameters_of(&args),
            serde_json::json!({
                "portNumber": ["5432"],
                "localPortNumber": ["54321"],
            })
        );
    }

    #[test]
    fn forwards_through_the_node_for_any_other_host() {
        let args = build_start_session_args(
            "i-0abc",
            None,
            None,
            " db.eu-west-1.rds.amazonaws.com ",
            3306,
            54321,
        );

        assert_eq!(
            document_of(&args),
            "AWS-StartPortForwardingSessionToRemoteHost"
        );
        assert_eq!(
            parameters_of(&args),
            serde_json::json!({
                "host": ["db.eu-west-1.rds.amazonaws.com"],
                "portNumber": ["3306"],
                "localPortNumber": ["54321"],
            })
        );
    }

    #[test]
    fn starts_with_the_ssm_subcommand_and_target() {
        let args = build_start_session_args("  i-0abc  ", None, None, "localhost", 5432, 54321);

        assert_eq!(args[0], "ssm");
        assert_eq!(args[1], "start-session");
        assert_eq!(flag_of(&args, "--target"), Some(&"i-0abc".to_string()));
    }

    #[test]
    fn omits_profile_and_region_when_blank() {
        let args = build_start_session_args("i-0abc", Some("  "), None, "localhost", 5432, 54321);

        assert!(!args.iter().any(|a| a == "--profile"));
        assert!(!args.iter().any(|a| a == "--region"));
    }

    #[test]
    fn includes_profile_and_region_when_set() {
        let args = build_start_session_args(
            "i-0abc",
            Some(" prod "),
            Some("eu-west-1"),
            "localhost",
            5432,
            54321,
        );

        assert_eq!(flag_of(&args, "--profile"), Some(&"prod".to_string()));
        assert_eq!(flag_of(&args, "--region"), Some(&"eu-west-1".to_string()));
    }
}

mod is_ready_line_tests {
    use super::*;

    #[test]
    fn recognises_the_plugin_readiness_lines() {
        assert!(is_ready_line("Waiting for connections..."));
        assert!(is_ready_line(
            "Port 54321 opened for sessionId user-0123456789abcdef."
        ));
    }

    #[test]
    fn ignores_the_surrounding_chatter() {
        assert!(!is_ready_line(""));
        assert!(!is_ready_line(
            "Starting session with SessionId: user-0123456789abcdef"
        ));
        assert!(!is_ready_line("Connection accepted for session"));
        // A TCP probe would call this ready; the plugin has said no such thing.
        assert!(!is_ready_line("bind: address already in use"));
    }
}

mod classify_failure_tests {
    use super::*;

    fn hint(output: &str) -> &'static str {
        classify_failure(output).expect("expected a classified failure")
    }

    #[test]
    fn missing_plugin() {
        assert!(hint("SessionManagerPlugin is not found. Please refer to install")
            .contains("Session Manager plugin is not installed"));
    }

    #[test]
    fn expired_sso_credentials_name_the_fix() {
        assert!(hint("Error when retrieving token from sso: Token has expired and refresh failed")
            .contains("aws sso login"));
    }

    #[test]
    fn absent_credentials_are_distinct_from_expired_ones() {
        assert!(hint("Unable to locate credentials. You can configure credentials by running")
            .contains("No AWS credentials"));
    }

    #[test]
    fn target_not_connected() {
        assert!(
            hint("An error occurred (TargetNotConnected) when calling the StartSession operation")
                .contains("SSM Agent")
        );
    }

    #[test]
    fn iam_denial_names_the_permission() {
        assert!(hint(
            "An error occurred (AccessDeniedException): User is not authorized to perform: ssm:StartSession"
        )
        .contains("ssm:StartSession"));
    }

    #[test]
    fn local_port_conflict() {
        assert!(hint("listen tcp 127.0.0.1:54321: bind: address already in use")
            .contains("Retry the connection"));
    }

    #[test]
    fn wrong_region_or_bad_target() {
        assert!(hint("An error occurred (InvalidInstanceId) when calling StartSession")
            .contains("region"));
    }

    #[test]
    fn unrecognised_output_is_left_unclassified() {
        assert_eq!(classify_failure("something entirely unexpected"), None);
        assert_eq!(classify_failure(""), None);
    }

    #[test]
    fn describe_failure_keeps_the_raw_output_alongside_the_hint() {
        let raw = "An error occurred (TargetNotConnected) when calling StartSession";
        let described = describe_failure("Session ended.", raw);
        assert!(described.contains("Session ended."));
        assert!(described.contains("SSM Agent"));
        assert!(described.contains(raw));
    }
}

mod resolved_document_tests {
    use super::*;

    #[test]
    fn matches_what_the_arguments_actually_carry() {
        for host in ["localhost", "127.0.0.1", "", "db.eu-west-1.rds.amazonaws.com"] {
            let args = build_start_session_args("i-0abc", None, None, host, 3306, 54321);
            assert_eq!(document_of(&args), resolved_document(host), "host={host}");
        }
    }
}

mod build_tunnel_key_tests {
    use super::*;

    #[test]
    fn blank_and_absent_optionals_collide() {
        assert_eq!(
            build_tunnel_key("i-0abc", Some(""), Some("  "), "localhost", 3306),
            build_tunnel_key("i-0abc", None, None, " localhost ", 3306)
        );
    }

    #[test]
    fn different_profiles_do_not_collide() {
        assert_ne!(
            build_tunnel_key("i-0abc", Some("prod"), None, "localhost", 3306),
            build_tunnel_key("i-0abc", Some("staging"), None, "localhost", 3306)
        );
    }

    #[test]
    fn different_remote_hosts_do_not_collide() {
        assert_ne!(
            build_tunnel_key("i-0abc", None, None, "a.rds", 3306),
            build_tunnel_key("i-0abc", None, None, "b.rds", 3306)
        );
    }

    #[test]
    fn target_whitespace_is_ignored() {
        assert_eq!(
            build_tunnel_key(" i-0abc ", None, None, "localhost", 3306),
            build_tunnel_key("i-0abc", None, None, "localhost", 3306)
        );
    }
}

#[cfg(unix)]
mod is_alive_tests {
    use super::*;
    use std::process::{Command, Stdio};

    fn tunnel_running(script: &str) -> SsmTunnel {
        let child = Command::new("sh")
            .args(["-c", script])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        SsmTunnel {
            local_port: 54321,
            child: Arc::new(Mutex::new(child)),
        }
    }

    #[test]
    fn a_running_session_is_alive() {
        let tunnel = tunnel_running("sleep 30");
        assert!(tunnel.is_alive());
        tunnel.stop();
    }

    #[test]
    fn an_ended_session_is_not_alive() {
        let tunnel = tunnel_running("exit 0");
        tunnel.child.lock().unwrap().wait().unwrap();
        assert!(!tunnel.is_alive());
    }
}
