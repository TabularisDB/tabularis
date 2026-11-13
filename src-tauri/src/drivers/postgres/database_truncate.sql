DO $tabularis$
DECLARE targets text;
BEGIN
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
               WHERE c.relkind='f' AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema') THEN
        RAISE EXCEPTION 'Database contains foreign tables; no data was changed';
    END IF;
    SELECT string_agg(format('%I.%I', n.nspname, c.relname), ', ' ORDER BY n.nspname, c.relname)
    INTO targets
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p') AND NOT c.relispartition
      AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema';
    IF targets IS NOT NULL THEN
        EXECUTE 'TRUNCATE TABLE ' || targets || ' RESTART IDENTITY';
    END IF;
END
$tabularis$;
