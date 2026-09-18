-- KytosHub: Sprint 5.1 - Visitor Access module
-- Anticipated visitor registrations, unique QR passes, and package/delivery
-- control at the guard stand, plus the `visitor_access` feature flag.

CREATE OR REPLACE FUNCTION public.seed_visitor_access(p_tenant_id uuid)
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

    EXECUTE format('CREATE TABLE IF NOT EXISTS %I.visits (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        department_id uuid REFERENCES %I.departments(id) ON DELETE SET NULL,
        full_name varchar(200) NOT NULL,
        document_type varchar(20) NOT NULL DEFAULT ''DNI'' CHECK (document_type IN (''DNI'', ''CE'', ''PASAPORTE'')),
        document_number varchar(30) NOT NULL,
        vehicle_plate varchar(20),
        vehicle_type varchar(10) NOT NULL DEFAULT ''AUTO'' CHECK (vehicle_type IN (''AUTO'', ''MOTO'')),
        scheduled_start timestamptz NOT NULL DEFAULT now(),
        scheduled_end timestamptz,
        entry_time timestamptz,
        exit_time timestamptz,
        status varchar(20) NOT NULL DEFAULT ''PENDIENTE'' CHECK (status IN (''PENDIENTE'', ''ACTIVO'', ''EXPIRADO'', ''CANCELADO'')),
        access_code varchar(10) NOT NULL UNIQUE,
        created_by_user_id uuid,
        created_at timestamptz NOT NULL DEFAULT now()
    )', v_schema, v_schema);

    EXECUTE format('CREATE TABLE IF NOT EXISTS %I.visitor_packages (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        department_id uuid REFERENCES %I.departments(id) ON DELETE SET NULL,
        description text NOT NULL,
        carrier varchar(80),
        received_at timestamptz NOT NULL DEFAULT now(),
        notified boolean NOT NULL DEFAULT false,
        delivered_at timestamptz,
        created_by_user_id uuid,
        created_at timestamptz NOT NULL DEFAULT now()
    )', v_schema, v_schema);

    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_visits_dept ON %I.visits(department_id)', v_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_visits_status ON %I.visits(status)', v_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_visits_code ON %I.visits(access_code)', v_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_packages_dept ON %I.visitor_packages(department_id)', v_schema);

    EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA %I TO anon, authenticated', v_schema);
    EXECUTE format('GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO authenticated', v_schema);
    EXECUTE format('GRANT ALL ON ALL TABLES IN SCHEMA %I TO project_admin', v_schema);

    FOREACH v_tbl IN ARRAY ARRAY['visits', 'visitor_packages']
    LOOP
        EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', v_schema, v_tbl);
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = v_schema AND tablename = v_tbl AND policyname = 'read visitor') THEN
            EXECUTE format('CREATE POLICY "read visitor" ON %I.%I FOR SELECT TO anon, authenticated USING (true)', v_schema, v_tbl);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = v_schema AND tablename = v_tbl AND policyname = 'admin write visitor') THEN
            EXECUTE format('CREATE POLICY "admin write visitor" ON %I.%I FOR ALL TO authenticated USING (public.is_tenant_admin(%L::uuid)) WITH CHECK (public.is_tenant_admin(%L::uuid))', v_schema, v_tbl, p_tenant_id, p_tenant_id);
        END IF;
    END LOOP;

    -- Feature flag: off by default, like other optional modules
    EXECUTE format('INSERT INTO %I.condo_settings (module_key, is_enabled, config_json) VALUES
        (''visitor_access'', false, ''{"max_simultaneous_per_department":2}''::jsonb)
        ON CONFLICT (module_key) DO NOTHING', v_schema);
END;
$$;

GRANT EXECUTE ON FUNCTION public.seed_visitor_access(uuid) TO project_admin;

-- Backfill all existing condominiums
DO $$
DECLARE t record;
BEGIN
    FOR t IN SELECT id FROM public.tenants LOOP
        PERFORM public.seed_visitor_access(t.id);
    END LOOP;
END $$;