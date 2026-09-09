-- KytosHub: Sprint 2 - cart gates and cart types
-- carts gain gate (puerta) and cart_type (CARGA/COMPRA)
-- cart_lending module config gains gates_count and carts_per_gate

-- Idempotent helper updated for gates support (also backfills existing schemas)
CREATE OR REPLACE FUNCTION public.seed_condo_modules(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_schema text;
    v_has_depts boolean := false;
BEGIN
    SELECT schema_name INTO v_schema FROM public.tenants WHERE id = p_tenant_id;
    IF v_schema IS NULL THEN RETURN; END IF;

    EXECUTE format('CREATE TABLE IF NOT EXISTS %I.condo_settings (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        module_key varchar(50) NOT NULL UNIQUE,
        is_enabled boolean NOT NULL DEFAULT true,
        config_json jsonb NOT NULL DEFAULT ''{}''::jsonb,
        updated_at timestamptz NOT NULL DEFAULT now()
    )', v_schema);

    SELECT EXISTS (
        SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = v_schema AND c.relname = 'departments' AND c.relkind = 'r'
    ) INTO v_has_depts;

    IF v_has_depts THEN
        EXECUTE format('CREATE TABLE IF NOT EXISTS %I.carts (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            code_identifier varchar(50) NOT NULL UNIQUE,
            qr_code_hash varchar(100),
            status varchar(20) NOT NULL DEFAULT ''DISPONIBLE'' CHECK (status IN (''DISPONIBLE'', ''PRESTADO'', ''MANTENIMIENTO'')),
            gate integer,
            cart_type varchar(20) NOT NULL DEFAULT ''CARGA'' CHECK (cart_type IN (''CARGA'', ''COMPRA'')),
            notes text,
            created_at timestamptz NOT NULL DEFAULT now()
        )', v_schema);
        -- Backfill for schemas created before the gate/type columns existed
        EXECUTE format('ALTER TABLE %I.carts ADD COLUMN IF NOT EXISTS gate integer', v_schema);
        EXECUTE format('ALTER TABLE %I.carts ADD COLUMN IF NOT EXISTS cart_type varchar(20) NOT NULL DEFAULT ''CARGA''', v_schema);

        EXECUTE format('CREATE TABLE IF NOT EXISTS %I.cart_loans (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            cart_id uuid NOT NULL REFERENCES %I.carts(id) ON DELETE CASCADE,
            department_id uuid NOT NULL REFERENCES %I.departments(id) ON DELETE CASCADE,
            requested_by_user_id uuid,
            guard_checkout_user_id uuid,
            guard_checkin_user_id uuid,
            checkout_time timestamptz NOT NULL DEFAULT now(),
            due_time timestamptz NOT NULL,
            checkin_time timestamptz,
            status varchar(20) NOT NULL DEFAULT ''ACTIVO'' CHECK (status IN (''ACTIVO'', ''DEVUELTO'', ''ATRASADO'')),
            penalty_amount numeric(10,2) NOT NULL DEFAULT 0,
            penalty_status varchar(20) NOT NULL DEFAULT ''NINGUNA'' CHECK (penalty_status IN (''NINGUNA'', ''PENDIENTE'', ''COBRADA'', ''EXONERADA'')),
            created_at timestamptz NOT NULL DEFAULT now()
        )', v_schema, v_schema, v_schema);

        EXECUTE format('CREATE INDEX IF NOT EXISTS idx_cart_loans_cart ON %I.cart_loans(cart_id)', v_schema);
        EXECUTE format('CREATE INDEX IF NOT EXISTS idx_cart_loans_dept ON %I.cart_loans(department_id)', v_schema);

        EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA %I TO anon, authenticated', v_schema);
        EXECUTE format('GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO authenticated', v_schema);
        EXECUTE format('GRANT ALL ON ALL TABLES IN SCHEMA %I TO project_admin', v_schema);

        EXECUTE format('ALTER TABLE %I.carts ENABLE ROW LEVEL SECURITY', v_schema);
        EXECUTE format('ALTER TABLE %I.cart_loans ENABLE ROW LEVEL SECURITY', v_schema);

        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = v_schema AND tablename = 'carts' AND policyname = 'read carts') THEN
            EXECUTE format('CREATE POLICY "read carts" ON %I.carts FOR SELECT TO anon, authenticated USING (true)', v_schema);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = v_schema AND tablename = 'cart_loans' AND policyname = 'read loans') THEN
            EXECUTE format('CREATE POLICY "read loans" ON %I.cart_loans FOR SELECT TO anon, authenticated USING (true)', v_schema);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = v_schema AND tablename = 'carts' AND policyname = 'admin write carts') THEN
            EXECUTE format('CREATE POLICY "admin write carts" ON %I.carts FOR ALL TO authenticated USING (public.is_tenant_admin(%L::uuid)) WITH CHECK (public.is_tenant_admin(%L::uuid))', v_schema, p_tenant_id, p_tenant_id);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = v_schema AND tablename = 'cart_loans' AND policyname = 'admin write loans') THEN
            EXECUTE format('CREATE POLICY "admin write loans" ON %I.cart_loans FOR ALL TO authenticated USING (public.is_tenant_admin(%L::uuid)) WITH CHECK (public.is_tenant_admin(%L::uuid))', v_schema, p_tenant_id, p_tenant_id);
        END IF;
    END IF;

    -- Feature flag defaults (Sprint 1 ON, new modules OFF) + cart gates config
    EXECUTE format('INSERT INTO %I.condo_settings (module_key, is_enabled, config_json) VALUES
        (''core_structure'', true, ''{}''::jsonb),
        (''residents'', true, ''{}''::jsonb),
        (''users'', true, ''{}''::jsonb),
        (''condominiums'', true, ''{}''::jsonb),
        (''cart_lending'', false, ''{"max_loan_minutes":60,"fine_enabled":true,"fine_type":"FIXED_OR_PER_INTERVAL","grace_period_minutes":10,"fine_amount":5.00,"fine_interval_minutes":30,"gates_count":2,"carts_per_gate":5}''::jsonb)
        ON CONFLICT (module_key) DO NOTHING', v_schema);

    EXECUTE format('UPDATE %I.condo_settings SET config_json = config_json || ''{"gates_count":2,"carts_per_gate":5}''::jsonb WHERE module_key = ''cart_lending'' AND NOT (config_json ? ''gates_count'')', v_schema);

    EXECUTE format('GRANT SELECT ON %I.condo_settings TO anon, authenticated', v_schema);
    EXECUTE format('GRANT INSERT, UPDATE, DELETE ON %I.condo_settings TO authenticated', v_schema);
    EXECUTE format('GRANT ALL ON %I.condo_settings TO project_admin', v_schema);
    EXECUTE format('ALTER TABLE %I.condo_settings ENABLE ROW LEVEL SECURITY', v_schema);

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = v_schema AND tablename = 'condo_settings' AND policyname = 'read settings') THEN
        EXECUTE format('CREATE POLICY "read settings" ON %I.condo_settings FOR SELECT TO anon, authenticated USING (true)', v_schema);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = v_schema AND tablename = 'condo_settings' AND policyname = 'admin write settings') THEN
        EXECUTE format('CREATE POLICY "admin write settings" ON %I.condo_settings FOR ALL TO authenticated USING (public.is_tenant_admin(%L::uuid)) WITH CHECK (public.is_tenant_admin(%L::uuid))', v_schema, p_tenant_id, p_tenant_id);
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.seed_condo_modules(uuid) TO project_admin;

-- Backfill existing condominiums (columns + gate config)
DO $$
DECLARE t record;
BEGIN
    FOR t IN SELECT id FROM public.tenants LOOP
        PERFORM public.seed_condo_modules(t.id);
    END LOOP;
END $$;