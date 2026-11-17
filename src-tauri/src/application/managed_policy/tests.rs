use super::*;

const ALL_ACTIONS: [ConnectionAction; 10] = [
    ConnectionAction::Use,
    ConnectionAction::Create,
    ConnectionAction::Update,
    ConnectionAction::Delete,
    ConnectionAction::Duplicate,
    ConnectionAction::Import,
    ConnectionAction::Export,
    ConnectionAction::TestWithParams,
    ConnectionAction::EditBranding,
    ConnectionAction::EditOrganization,
];

const MUTATING: [ConnectionAction; 7] = [
    ConnectionAction::Create,
    ConnectionAction::Update,
    ConnectionAction::Delete,
    ConnectionAction::Duplicate,
    ConnectionAction::Import,
    ConnectionAction::Export,
    ConnectionAction::TestWithParams,
];

#[test]
fn default_policy_is_standalone() {
    assert_eq!(
        ManagedConnectionPolicy::default().mode(),
        ConnectionPolicyMode::Standalone
    );
    assert_eq!(
        ManagedConnectionPolicy::standalone(),
        ManagedConnectionPolicy::default()
    );
    assert!(!ManagedConnectionPolicy::default().is_managed_only());
}

#[test]
fn standalone_permits_every_action_whatever_the_marker() {
    let policy = ManagedConnectionPolicy::standalone();
    for action in ALL_ACTIONS {
        for marker in [false, true] {
            assert_eq!(policy.authorize(action, marker), Ok(()), "{action:?}");
        }
    }
}

#[test]
fn managed_only_denies_connection_management_whatever_the_marker() {
    let policy = ManagedConnectionPolicy::managed_only();
    for action in MUTATING {
        for marker in [false, true] {
            assert_eq!(
                policy.authorize(action, marker),
                Err(PolicyDenial { action }),
                "{action:?} with marker {marker}"
            );
        }
    }
}

#[test]
fn managed_only_protects_a_connection_whose_marker_is_false() {
    let policy = ManagedConnectionPolicy::managed_only();
    assert!(policy.protects(false));
    assert!(policy.authorize(ConnectionAction::Delete, false).is_err());
    assert!(policy.authorize(ConnectionAction::Update, false).is_err());
}

#[test]
fn managed_only_protects_a_connection_without_a_stored_marker() {
    let connection: crate::models::SavedConnection = serde_json::from_str(
        r#"{"id":"c1","name":"Legacy","params":{"driver":"postgres","database":"app"}}"#,
    )
    .unwrap();
    assert!(!connection.managed);
    let policy = ManagedConnectionPolicy::managed_only();
    assert!(policy.protects(connection.managed));
    assert!(policy
        .authorize(ConnectionAction::Update, connection.managed)
        .is_err());
}

#[test]
fn managed_only_keeps_managed_connections_usable() {
    let policy = ManagedConnectionPolicy::managed_only();
    for marker in [false, true] {
        assert_eq!(policy.authorize(ConnectionAction::Use, marker), Ok(()));
    }
}

#[test]
fn branding_and_organization_default_to_denied() {
    let policy = ManagedConnectionPolicy::managed_only();
    for marker in [false, true] {
        assert!(policy
            .authorize(ConnectionAction::EditBranding, marker)
            .is_err());
        assert!(policy
            .authorize(ConnectionAction::EditOrganization, marker)
            .is_err());
    }
}

#[test]
fn branding_and_organization_switches_are_independent() {
    let branding = ManagedConnectionPolicy::managed_only().with_branding_allowed(true);
    assert_eq!(
        branding.authorize(ConnectionAction::EditBranding, false),
        Ok(())
    );
    assert!(branding
        .authorize(ConnectionAction::EditOrganization, false)
        .is_err());

    let organization = ManagedConnectionPolicy::managed_only().with_organization_allowed(true);
    assert_eq!(
        organization.authorize(ConnectionAction::EditOrganization, false),
        Ok(())
    );
    assert!(organization
        .authorize(ConnectionAction::EditBranding, false)
        .is_err());
}

#[test]
fn the_switches_never_open_connection_management() {
    let policy = ManagedConnectionPolicy::managed_only()
        .with_branding_allowed(true)
        .with_organization_allowed(true);
    for action in MUTATING {
        assert!(policy.authorize(action, true).is_err(), "{action:?}");
    }
}

#[test]
fn denials_carry_the_stable_code() {
    let denial = ManagedConnectionPolicy::managed_only()
        .authorize(ConnectionAction::Delete, true)
        .unwrap_err();
    assert_eq!(denial.code(), "managed_connection_denied");
    assert!(denial.to_string().starts_with("managed_connection_denied"));
}

#[test]
fn marker_round_trips_and_is_omitted_when_false() {
    let mut connection: crate::models::SavedConnection = serde_json::from_str(
        r#"{"id":"c1","name":"A","params":{"driver":"postgres","database":"app"},"managed":true}"#,
    )
    .unwrap();
    assert!(connection.managed);
    let json = serde_json::to_value(&connection).unwrap();
    assert_eq!(json["managed"], true);

    connection.managed = false;
    let json = serde_json::to_value(&connection).unwrap();
    assert!(json.get("managed").is_none());
}

#[test]
fn standalone_capabilities_allow_everything() {
    let capabilities = ManagedConnectionPolicy::standalone().capabilities();
    assert!(!capabilities.managed);
    assert!(capabilities.can_create && capabilities.can_update && capabilities.can_delete);
    assert!(capabilities.can_duplicate && capabilities.can_import && capabilities.can_export);
    assert!(capabilities.can_test);
    assert!(capabilities.can_edit_branding && capabilities.can_edit_organization);
}

#[test]
fn managed_only_capabilities_follow_the_switches() {
    let capabilities = ManagedConnectionPolicy::managed_only().capabilities();
    assert!(capabilities.managed);
    assert!(!capabilities.can_create && !capabilities.can_update && !capabilities.can_delete);
    assert!(!capabilities.can_duplicate && !capabilities.can_import && !capabilities.can_export);
    assert!(!capabilities.can_test);
    assert!(!capabilities.can_edit_branding && !capabilities.can_edit_organization);

    let capabilities = ManagedConnectionPolicy::managed_only()
        .with_organization_allowed(true)
        .capabilities();
    assert!(capabilities.can_edit_organization && !capabilities.can_edit_branding);
    assert!(!capabilities.can_create);
}

#[test]
fn capabilities_serialize_in_camel_case() {
    let json =
        serde_json::to_value(ManagedConnectionPolicy::managed_only().capabilities()).unwrap();
    assert_eq!(json["managed"], true);
    assert_eq!(json["canEditBranding"], false);
    assert_eq!(json["canTest"], false);
}
