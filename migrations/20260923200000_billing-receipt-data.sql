-- KytosHub: Sprint 5.2 - Persist detailed maintenance receipt per invoice
-- Adds a receipt_data jsonb column to invoices so the admin can create and
-- save the detailed maintenance receipt per department (concepts by category,
-- meter reading evidence, payment instructions and monthly highlights).

CREATE OR REPLACE FUNCTION public.seed_billing_receipt_data(p_tenant_id uuid)
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

    EXECUTE format('ALTER TABLE %I.invoices ADD COLUMN IF NOT EXISTS receipt_data jsonb', v_schema);
END;
$$;

GRANT EXECUTE ON FUNCTION public.seed_billing_receipt_data(uuid) TO project_admin;

-- Backfill all existing condominiums
DO $$
DECLARE t record;
BEGIN
    FOR t IN SELECT id FROM public.tenants LOOP
        PERFORM public.seed_billing_receipt_data(t.id);
    END LOOP;
END $$;