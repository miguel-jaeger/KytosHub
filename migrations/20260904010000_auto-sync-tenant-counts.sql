-- KytosHub: Auto-sync cached tenant counts on resident changes
-- Self-contained: also (re)creates refresh_tenant_counts in case the
-- add-tenant-counts migration was never tracked/applied on this project.

-- Recreate cached-count refresh function (idempotent).
CREATE OR REPLACE FUNCTION public.refresh_tenant_counts(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_schema text;
    v_towers int := 0;
    v_floors int := 0;
    v_departments int := 0;
    v_residents int := 0;
BEGIN
    SELECT schema_name INTO v_schema FROM public.tenants WHERE id = p_tenant_id;
    IF v_schema IS NULL THEN RETURN; END IF;

    EXECUTE format('SELECT count(*) FROM %I.towers', v_schema) INTO v_towers;
    EXECUTE format('SELECT count(*) FROM %I.floors', v_schema) INTO v_floors;
    EXECUTE format('SELECT count(*) FROM %I.departments', v_schema) INTO v_departments;
    EXECUTE format('SELECT count(*) FROM %I.residents', v_schema) INTO v_residents;

    UPDATE public.tenants SET
        towers_count = v_towers,
        floors_count = v_floors,
        departments_count = v_departments,
        residents_count = v_residents
    WHERE id = p_tenant_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_tenant_counts(uuid) TO project_admin;

-- Trigger function: resolves the tenant from the schema where the event runs.
CREATE OR REPLACE FUNCTION public.sync_tenant_counts_on_resident_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_tenant_id uuid;
BEGIN
    SELECT id INTO v_tenant_id FROM public.tenants WHERE schema_name = TG_TABLE_SCHEMA;
    IF v_tenant_id IS NOT NULL THEN
        PERFORM public.refresh_tenant_counts(v_tenant_id);
    END IF;
    RETURN NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_tenant_counts_on_resident_change() TO project_admin;

-- Ensures the trigger exists on a tenant's residents table and refreshes its counts.
CREATE OR REPLACE FUNCTION public.ensure_tenant_count_sync(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_schema text;
    v_has_trigger boolean;
BEGIN
    SELECT schema_name INTO v_schema FROM public.tenants WHERE id = p_tenant_id;
    IF v_schema IS NULL THEN RETURN; END IF;

    SELECT EXISTS (
        SELECT 1
        FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = v_schema
          AND c.relname = 'residents'
          AND t.tgname = 'trg_sync_tenant_counts'
    ) INTO v_has_trigger;

    IF NOT v_has_trigger THEN
        -- Only attach the trigger when the residents table exists in the schema.
        PERFORM 1
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = v_schema AND c.relname = 'residents' AND c.relkind = 'r';

        IF FOUND THEN
            EXECUTE format(
                'CREATE TRIGGER trg_sync_tenant_counts
                 AFTER INSERT OR DELETE OR UPDATE ON %I.residents
                 FOR EACH ROW EXECUTE FUNCTION public.sync_tenant_counts_on_resident_change()',
                v_schema
            );
        END IF;
    END IF;

    BEGIN
        PERFORM public.refresh_tenant_counts(p_tenant_id);
    EXCEPTION WHEN OTHERS THEN
        NULL;
    END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_tenant_count_sync(uuid) TO project_admin;

-- Attach triggers and refresh counts for all existing tenants now.
DO $$
DECLARE
    t record;
BEGIN
    FOR t IN SELECT id FROM public.tenants WHERE schema_name IS NOT NULL LOOP
        PERFORM public.ensure_tenant_count_sync(t.id);
    END LOOP;
END;
$$;