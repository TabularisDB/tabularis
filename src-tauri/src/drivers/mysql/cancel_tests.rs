use super::cancel::pick_connection_id;

#[test]
fn pick_connection_id_takes_the_one_match() {
    assert_eq!(pick_connection_id(&[58], 58), Some(58));
}

#[test]
fn pick_connection_id_takes_a_wider_id_than_the_handshake_announced() {
    // Past 2^32 connections the handshake announces the low half only.
    let full = (3_u64 << 32) | 58;
    assert_eq!(pick_connection_id(&[full], 58), Some(full));
}

#[test]
fn pick_connection_id_falls_back_to_the_announced_id_without_a_match() {
    // A proxy answers the process list from a backend, with other ids.
    assert_eq!(pick_connection_id(&[], 58), Some(58));
}

#[test]
fn pick_connection_id_refuses_to_choose_between_two_matches() {
    let wider = (1_u64 << 32) | 58;
    assert_eq!(pick_connection_id(&[58, wider], 58), None);
}
