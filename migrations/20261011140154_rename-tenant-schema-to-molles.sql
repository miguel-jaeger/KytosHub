-- KytosHub: rename the tenant schema from condo_condominio_acasias to
-- condo_condominio_molles. The condominium is "Condominio Villa Los Molles".
-- Two tenant-local functions (refresh_condo_stats, recompute_condo_stats) embed
-- the schema name in their bodies, so they are rebuilt after the rename.

DO $$
DECLARE
    v_old text := 'condo_condominio_acasias';
    v_new text := 'condo_condominio_molles';
    r record;
BEGIN
    -- Only run when the old schema exists and the target name is free.
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = v_old)
       AND NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = v_new) THEN

        EXECUTE format('ALTER SCHEMA %I RENAME TO %I', v_old, v_new);

        UPDATE public.tenants
        SET schema_name = v_new
        WHERE schema_name = v_old;

        -- Rebuild any function whose body still references the old schema name,
        -- now that it lives under the new schema.
        FOR r IN
            SELECT p.oid
            FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = v_new
              AND p.prosrc ILIKE '%' || v_old || '%'
        LOOP
            EXECUTE replace(pg_get_functiondef(r.oid), v_old, v_new);
        END LOOP;
    END IF;
END $$;
