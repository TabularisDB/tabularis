DO $tabularis$
DECLARE s record; a record;
BEGIN
    FOR s IN SELECT nspname, pg_get_userbyid(nspowner) AS owner, nspowner, nspacl,
                    obj_description(oid, 'pg_namespace') AS comment
             FROM pg_namespace
             WHERE nspname !~ '^pg_' AND nspname <> 'information_schema'
    LOOP
        EXECUTE format('DROP SCHEMA %I CASCADE', s.nspname);
        EXECUTE format('CREATE SCHEMA %I AUTHORIZATION %I', s.nspname, s.owner);
        EXECUTE format('REVOKE ALL ON SCHEMA %I FROM PUBLIC', s.nspname);
        FOR a IN SELECT grantee, privilege_type, is_grantable
                 FROM aclexplode(COALESCE(s.nspacl, acldefault('n', s.nspowner)))
        LOOP
            EXECUTE format('GRANT %s ON SCHEMA %I TO %s%s', a.privilege_type, s.nspname,
                CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(a.grantee)) END,
                CASE WHEN a.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END);
        END LOOP;
        IF s.comment IS NOT NULL THEN
            EXECUTE format('COMMENT ON SCHEMA %I IS %L', s.nspname, s.comment);
        END IF;
    END LOOP;
END
$tabularis$;
