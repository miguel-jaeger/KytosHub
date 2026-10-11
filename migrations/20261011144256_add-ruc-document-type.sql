-- KytosHub: allow RUC as a document type for residents (and visitors).
-- Widens the document_type CHECK constraints in every schema and updates the
-- provisioning functions so new condominiums get the new list too.

DO $$
DECLARE
    r record;
    v_def text;
BEGIN
    -- 1) Widen existing document_type CHECK constraints on residents/visits.
    FOR r IN
        SELECT n.nspname AS schema_name, c.relname AS table_name, con.conname AS constraint_name
        FROM pg_constraint con
        JOIN pg_class c ON c.oid = con.conrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE con.contype = 'c'
          AND c.relname IN ('residents', 'visits')
          AND pg_get_constraintdef(con.oid) ILIKE '%document_type%'
          AND pg_get_constraintdef(con.oid) ILIKE '%PASAPORTE%'
    LOOP
        EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT IF EXISTS %I', r.schema_name, r.table_name, r.constraint_name);
        EXECUTE format('ALTER TABLE %I.%I ADD CONSTRAINT %I CHECK (document_type IN (''DNI'', ''CE'', ''PASAPORTE'', ''RUC''))', r.schema_name, r.table_name, r.constraint_name);
    END LOOP;

    -- 2) Global users table.
    ALTER TABLE public.users_global DROP CONSTRAINT IF EXISTS users_global_document_type_check;
    ALTER TABLE public.users_global ADD CONSTRAINT users_global_document_type_check CHECK (document_type IN ('DNI', 'CE', 'PASAPORTE', 'RUC'));

    -- 3) Provisioning functions that embed the old list.
    FOR r IN
        SELECT p.oid
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN ('provision_tenant_schema_v2', 'fix_residents_schema', 'seed_visitor_access')
          AND p.prosrc ILIKE '%PASAPORTE%'
    LOOP
        v_def := pg_get_functiondef(r.oid);
        v_def := replace(v_def, '''PASAPORTE''', '''PASAPORTE'', ''RUC''');
        EXECUTE v_def;
    END LOOP;
END $$;
