-- KytosHub: Sprint 5.2 - Billing & Maintenance module
-- 1) billing_cycles: monthly invoicing periods for maintenance fees.
-- 2) department_fees: per-department maintenance fee configuration (each
--    department can have its own fee or be exempt).
-- 3) invoices: generated receivables per cycle and department with manual
--    payment tracking.
-- 4) billing_fines: operating/cart penalties linked to the department's
--    account (estado de cuenta), source CART_LOAN or OPERATIVE.
-- 5) Feature flag `billing_maintenance` in condo_settings (off by default).

CREATE OR REPLACE FUNCTION public.seed_billing_maintenance(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_schema text;
    v_tbl text;
BEGIN
    SELECT schema_name INTO v_schema FROM public.tenants WHERE id = p_tenant_id;
    IF v_schema IS NULL THEN RETURN; END IF;

    EXECUTE format('CREATE TABLE IF NOT EXISTS %I.billing_cycles (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        cycle_key varchar(20) NOT NULL UNIQUE,
        label varchar(80) NOT NULL,
        start_date date NOT NULL,
        end_date date NOT NULL,
        due_date date NOT NULL,
        is_closed boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(start_date, end_date)
    )', v_schema);

    EXECUTE format('CREATE TABLE IF NOT EXISTS %I.department_fees (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        department_id uuid NOT NULL REFERENCES %I.departments(id) ON DELETE CASCADE,
        amount numeric(10,2) NOT NULL DEFAULT 0,
        is_exempt boolean NOT NULL DEFAULT false,
        notes text,
        updated_at timestamptz NOT NULL DEFAULT now(),
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(department_id)
    )', v_schema, v_schema);

    EXECUTE format('CREATE TABLE IF NOT EXISTS %I.invoices (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        cycle_id uuid NOT NULL REFERENCES %I.billing_cycles(id) ON DELETE CASCADE,
        department_id uuid NOT NULL REFERENCES %I.departments(id) ON DELETE CASCADE,
        amount numeric(10,2) NOT NULL DEFAULT 0,
        paid_amount numeric(10,2) NOT NULL DEFAULT 0,
        status varchar(20) NOT NULL DEFAULT ''PENDIENTE'' CHECK (status IN (''PENDIENTE'', ''PARCIAL'', ''PAGADA'', ''ANULADA'')),
        due_date date NOT NULL,
        paid_at timestamptz,
        notes text,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(cycle_id, department_id)
    )', v_schema, v_schema, v_schema);

    EXECUTE format('CREATE TABLE IF NOT EXISTS %I.billing_fines (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        invoice_id uuid REFERENCES %I.invoices(id) ON DELETE CASCADE,
        department_id uuid NOT NULL REFERENCES %I.departments(id) ON DELETE CASCADE,
        source varchar(20) NOT NULL CHECK (source IN (''CART_LOAN'', ''OPERATIVE'')),
        cart_loan_id uuid,
        concept text NOT NULL,
        amount numeric(10,2) NOT NULL DEFAULT 0,
        status varchar(20) NOT NULL DEFAULT ''PENDIENTE'' CHECK (status IN (''PENDIENTE'', ''PAGADA'', ''ANULADA'')),
        created_at timestamptz NOT NULL DEFAULT now()
    )', v_schema, v_schema, v_schema);

    EXECUTE format('CREATE TABLE IF NOT EXISTS %I.billing_payments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        invoice_id uuid NOT NULL REFERENCES %I.invoices(id) ON DELETE CASCADE,
        department_id uuid NOT NULL REFERENCES %I.departments(id) ON DELETE CASCADE,
        amount numeric(10,2) NOT NULL DEFAULT 0,
        payment_date date NOT NULL DEFAULT CURRENT_DATE,
        notes text,
        registered_by_user_id uuid,
        created_at timestamptz NOT NULL DEFAULT now()
    )', v_schema, v_schema, v_schema);

    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_billing_cycles_key ON %I.billing_cycles(cycle_key)', v_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_department_fees_department ON %I.department_fees(department_id)', v_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_invoices_cycle ON %I.invoices(cycle_id)', v_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_invoices_department ON %I.invoices(department_id)', v_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_invoices_status ON %I.invoices(status)', v_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_billing_fines_department ON %I.billing_fines(department_id)', v_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_billing_fines_invoice ON %I.billing_fines(invoice_id)', v_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_billing_fines_cart_loan ON %I.billing_fines(cart_loan_id)', v_schema);
    EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS uq_billing_fines_cart_loan ON %I.billing_fines(cart_loan_id) WHERE cart_loan_id IS NOT NULL', v_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_billing_payments_invoice ON %I.billing_payments(invoice_id)', v_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_billing_payments_department ON %I.billing_payments(department_id)', v_schema);

    EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA %I TO anon, authenticated', v_schema);
    EXECUTE format('GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO authenticated', v_schema);
    EXECUTE format('GRANT ALL ON ALL TABLES IN SCHEMA %I TO project_admin', v_schema);

    FOREACH v_tbl IN ARRAY ARRAY['billing_cycles', 'department_fees', 'invoices', 'billing_fines', 'billing_payments']
    LOOP
        EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', v_schema, v_tbl);
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = v_schema AND tablename = v_tbl AND policyname = 'read billing') THEN
            EXECUTE format('CREATE POLICY "read billing" ON %I.%I FOR SELECT TO anon, authenticated USING (true)', v_schema, v_tbl);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = v_schema AND tablename = v_tbl AND policyname = 'admin write billing') THEN
            EXECUTE format('CREATE POLICY "admin write billing" ON %I.%I FOR ALL TO authenticated USING (public.is_tenant_admin(%L::uuid)) WITH CHECK (public.is_tenant_admin(%L::uuid))', v_schema, v_tbl, p_tenant_id, p_tenant_id);
        END IF;
    END LOOP;

    EXECUTE format('INSERT INTO %I.condo_settings (module_key, is_enabled, config_json) VALUES
        (''billing_maintenance'', false, ''{"default_fee":150.00,"due_days":5,"autolink_cart_fines":true}''::jsonb)
        ON CONFLICT (module_key) DO NOTHING', v_schema);
END;
$$;

GRANT EXECUTE ON FUNCTION public.seed_billing_maintenance(uuid) TO project_admin;

-- Backfill all existing condominiums
DO $$
DECLARE t record;
BEGIN
    FOR t IN SELECT id FROM public.tenants LOOP
        PERFORM public.seed_billing_maintenance(t.id);
    END LOOP;
END $$;