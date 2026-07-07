#[cfg(test)]
mod tests {
    use crate::connection_window::window_label;

    #[test]
    fn uuid_like_id_is_preserved() {
        let id = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
        assert_eq!(
            window_label(id),
            "connection-window-3f2504e0-4f89-41d3-9a0c-0305e82c3301"
        );
    }

    #[test]
    fn alphanumeric_underscore_and_hyphen_survive() {
        assert_eq!(window_label("Abc_123-XY"), "connection-window-Abc_123-XY");
    }

    #[test]
    fn disallowed_characters_are_replaced_with_underscore() {
        // Slashes, spaces, dots and colons are not valid in window labels here.
        assert_eq!(
            window_label("a/b c.d:e"),
            "connection-window-a_b_c_d_e"
        );
    }

    #[test]
    fn empty_id_still_yields_prefix() {
        assert_eq!(window_label(""), "connection-window-");
    }
}
