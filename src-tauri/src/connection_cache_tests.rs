#[cfg(test)]
mod tests {
    use crate::connection_cache::{CacheLookup, ConnectionCache};
    use crate::models::{ConnectionParams, SavedConnection};

    fn make_connection(id: &str, name: &str) -> SavedConnection {
        SavedConnection {
            id: id.to_string(),
            name: name.to_string(),
            params: ConnectionParams::default(),
            group_id: None,
            sort_order: None,
            detect_json_in_text_columns: None,
            appearance: None,
        }
    }

    #[test]
    fn lookup_on_fresh_cache_returns_cold() {
        let cache = ConnectionCache::default();
        assert!(matches!(cache.lookup("any-id"), CacheLookup::Cold));
    }

    #[test]
    fn lookup_after_populate_with_present_id_returns_hit() {
        let cache = ConnectionCache::default();
        cache.populate(&[make_connection("c1", "First")]);

        match cache.lookup("c1") {
            CacheLookup::Hit(conn) => {
                assert_eq!(conn.id, "c1");
                assert_eq!(conn.name, "First");
            }
            other => panic!("expected Hit, got {:?}", discriminant(&other)),
        }
    }

    #[test]
    fn lookup_after_populate_with_absent_id_returns_miss() {
        let cache = ConnectionCache::default();
        cache.populate(&[make_connection("c1", "First")]);

        assert!(matches!(cache.lookup("missing"), CacheLookup::Miss));
    }

    #[test]
    fn populate_with_empty_slice_yields_miss_not_cold() {
        let cache = ConnectionCache::default();
        cache.populate(&[]);

        assert!(matches!(cache.lookup("anything"), CacheLookup::Miss));
    }

    #[test]
    fn populate_replaces_previous_entries() {
        let cache = ConnectionCache::default();
        cache.populate(&[make_connection("c1", "First")]);
        cache.populate(&[make_connection("c2", "Second")]);

        assert!(matches!(cache.lookup("c1"), CacheLookup::Miss));
        assert!(matches!(cache.lookup("c2"), CacheLookup::Hit(_)));
    }

    #[test]
    fn populate_with_duplicate_ids_keeps_last_occurrence() {
        let cache = ConnectionCache::default();
        cache.populate(&[
            make_connection("c1", "First"),
            make_connection("c1", "Override"),
        ]);

        match cache.lookup("c1") {
            CacheLookup::Hit(conn) => assert_eq!(conn.name, "Override"),
            _ => panic!("expected Hit"),
        }
    }

    #[test]
    fn invalidate_after_populate_returns_to_cold() {
        let cache = ConnectionCache::default();
        cache.populate(&[make_connection("c1", "First")]);
        cache.invalidate();

        assert!(matches!(cache.lookup("c1"), CacheLookup::Cold));
    }

    #[test]
    fn invalidate_on_cold_cache_is_noop() {
        let cache = ConnectionCache::default();
        cache.invalidate();

        assert!(matches!(cache.lookup("c1"), CacheLookup::Cold));
    }

    #[test]
    fn lookup_returns_independent_clone() {
        let cache = ConnectionCache::default();
        cache.populate(&[make_connection("c1", "First")]);

        let first_hit = match cache.lookup("c1") {
            CacheLookup::Hit(c) => c,
            _ => panic!("expected Hit"),
        };
        // Mutating the returned clone must not affect what the cache stores.
        let mut mutated = first_hit;
        mutated.name = "Mutated".to_string();

        match cache.lookup("c1") {
            CacheLookup::Hit(c) => assert_eq!(c.name, "First"),
            _ => panic!("expected Hit on second lookup"),
        }
    }

    fn discriminant(lookup: &CacheLookup) -> &'static str {
        match lookup {
            CacheLookup::Hit(_) => "Hit",
            CacheLookup::Miss => "Miss",
            CacheLookup::Cold => "Cold",
        }
    }
}
