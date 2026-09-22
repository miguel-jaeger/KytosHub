-- KytosHub: Sprint 5.2 - Store variable data captured per department/period
-- The detailed maintenance receipt mixes fixed concepts with values that vary
-- per department (water meter readings, consumption m3, unit price, and the
-- department share of each concept). This column persists that per-invoice
-- capture so the admin can fill a grid by tower/period and then generate each
-- department's receipt.

CREATE OR REPLACE FUNCTION public.seed_billing_variable_data(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_schema text;
BEGIN
    SELECT schema_name INTO v_schema FROM public.tenants WHERE id = p_tenant_id;
    IF v_schema IS NULL THEN RETURN; END IF;

    EXECUTE format('ALTER TABLE %I.invoices ADD COLUMN IF NOT EXISTS variable_data jsonb', v_schema);
END;
$$;

GRANT EXECUTE ON FUNCTION public.seed_billing_variable_data(uuid) TO project_admin;

-- Backfill all existing condominiums
DO $$
DECLARE t record;
BEGIN
    FOR t IN SELECT id FROM public.tenants LOOP
        PERFORM public.seed_billing_variable_data(t.id);
    END LOOP;
END $$;