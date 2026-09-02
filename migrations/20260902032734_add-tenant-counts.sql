-- KytosHub: Add cached counts to tenants table
-- Sprint 1: towers_count, floors_count, departments_count, residents_count

ALTER TABLE public.tenants
    ADD COLUMN towers_count integer NOT NULL DEFAULT 0,
    ADD COLUMN floors_count integer NOT NULL DEFAULT 0,
    ADD COLUMN departments_count integer NOT NULL DEFAULT 0,
    ADD COLUMN residents_count integer NOT NULL DEFAULT 0;

-- Function to refresh counts for a tenant from its schema
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
