-- KytosHub: Dynamic per-tenant schema provisioning
-- Sprint 1: Each condominium gets its own schema condo_{slug}

-- Creates the tenant schema and core_structure tables with RLS + grants.
-- Runs as SECURITY DEFINER (project_admin) so it can CREATE SCHEMA.
CREATE OR REPLACE FUNCTION public.provision_tenant_schema(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_schema_name text;
    v_slug text;
    v_status text;
BEGIN
    SELECT schema_name, slug, status
      INTO v_schema_name, v_slug, v_status
      FROM public.tenants
     WHERE id = p_tenant_id;

    IF v_schema_name IS NULL THEN
        RAISE EXCEPTION 'tenant % not found', p_tenant_id;
    END IF;

    IF v_status IN ('INACTIVE', 'SUSPENDED') THEN
        RAISE EXCEPTION 'tenant is not active';
    END IF;

    -- Create the schema owned by project_admin
    EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I', v_schema_name);

    -- condo_settings: feature flags and module config per condominium
    EXECUTE format('CREATE TABLE IF NOT EXISTS %I.condo_settings (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        module_key varchar(50) NOT NULL UNIQUE,
        is_enabled boolean NOT NULL DEFAULT true,
        config_json jsonb NOT NULL DEFAULT ''{}''::jsonb,
        updated_at timestamptz NOT NULL DEFAULT now()
    )', v_schema_name);

    -- towers
    EXECUTE format('CREATE TABLE IF NOT EXISTS %I.towers (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar(100) NOT NULL,
        code varchar(20) NOT NULL UNIQUE,
        floors_count integer NOT NULL CHECK (floors_count > 0),
        departments_per_floor integer NOT NULL CHECK (departments_per_floor > 0),
        created_at timestamptz NOT NULL DEFAULT now()
    )', v_schema_name);

    -- floors
    EXECUTE format('CREATE TABLE IF NOT EXISTS %I.floors (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tower_id uuid NOT NULL REFERENCES %I.towers(id) ON DELETE CASCADE,
        floor_number integer NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(tower_id, floor_number)
    )', v_schema_name, v_schema_name);

    -- departments
    EXECUTE format('CREATE TABLE IF NOT EXISTS %I.departments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        floor_id uuid NOT NULL REFERENCES %I.floors(id) ON DELETE CASCADE,
        tower_id uuid NOT NULL REFERENCES %I.towers(id) ON DELETE CASCADE,
        department_number varchar(20) NOT NULL,
        status varchar(20) NOT NULL DEFAULT ''HABITADO'' CHECK (status IN (''HABITADO'', ''DESOCUPADO'', ''MANTENIMIENTO'')),
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(tower_id, department_number)
    )', v_schema_name, v_schema_name, v_schema_name);

    -- residents
    EXECUTE format('CREATE TABLE IF NOT EXISTS %I.residents (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        department_id uuid NOT NULL REFERENCES %I.departments(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
        is_owner boolean NOT NULL DEFAULT false,
        relationship_type varchar(20) NOT NULL CHECK (relationship_type IN (''PROPIETARIO'', ''FAMILIAR'', ''INQUILINO'')),
        is_primary_contact boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(department_id, user_id)
    )', v_schema_name, v_schema_name);

    -- Indexes
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%I_floors_tower ON %I.floors(tower_id)', v_slug, v_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%I_depts_floor ON %I.departments(floor_id)', v_slug, v_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%I_depts_tower ON %I.departments(tower_id)', v_slug, v_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%I_residents_dept ON %I.residents(department_id)', v_slug, v_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%I_residents_user ON %I.residents(user_id)', v_slug, v_schema_name);

    -- RLS + grants
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO anon, authenticated', v_schema_name);
    EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA %I TO anon, authenticated', v_schema_name);
    EXECUTE format('GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO authenticated', v_schema_name);
    EXECUTE format('GRANT ALL ON ALL TABLES IN SCHEMA %I TO project_admin', v_schema_name);

    EXECUTE format('ALTER TABLE %I.condo_settings ENABLE ROW LEVEL SECURITY', v_schema_name);
    EXECUTE format('ALTER TABLE %I.towers ENABLE ROW LEVEL SECURITY', v_schema_name);
    EXECUTE format('ALTER TABLE %I.floors ENABLE ROW LEVEL SECURITY', v_schema_name);
    EXECUTE format('ALTER TABLE %I.departments ENABLE ROW LEVEL SECURITY', v_schema_name);
    EXECUTE format('ALTER TABLE %I.residents ENABLE ROW LEVEL SECURITY', v_schema_name);

    -- Admin helpers are SECURITY DEFINER to avoid recursive RLS on public.tenant_users
    -- Read-only for authenticated users (structure is visible to all condominium roles)
    EXECUTE format('CREATE POLICY "read structure" ON %I.towers FOR SELECT TO anon, authenticated USING (true)', v_schema_name);
    EXECUTE format('CREATE POLICY "read structure" ON %I.floors FOR SELECT TO anon, authenticated USING (true)', v_schema_name);
    EXECUTE format('CREATE POLICY "read structure" ON %I.departments FOR SELECT TO anon, authenticated USING (true)', v_schema_name);
    EXECUTE format('CREATE POLICY "read settings" ON %I.condo_settings FOR SELECT TO anon, authenticated USING (true)', v_schema_name);
    EXECUTE format('CREATE POLICY "read residents" ON %I.residents FOR SELECT TO anon, authenticated USING (true)', v_schema_name);

    -- Writes are admin-only, guarded through the admin helper function
    EXECUTE format('CREATE POLICY "admin write" ON %I.towers FOR ALL TO authenticated USING (public.is_tenant_admin(%L::uuid)) WITH CHECK (public.is_tenant_admin(%L::uuid))', v_schema_name, p_tenant_id, p_tenant_id);
    EXECUTE format('CREATE POLICY "admin write" ON %I.floors FOR ALL TO authenticated USING (public.is_tenant_admin(%L::uuid)) WITH CHECK (public.is_tenant_admin(%L::uuid))', v_schema_name, p_tenant_id, p_tenant_id);
    EXECUTE format('CREATE POLICY "admin write" ON %I.departments FOR ALL TO authenticated USING (public.is_tenant_admin(%L::uuid)) WITH CHECK (public.is_tenant_admin(%L::uuid))', v_schema_name, p_tenant_id, p_tenant_id);
    EXECUTE format('CREATE POLICY "admin write" ON %I.condo_settings FOR ALL TO authenticated USING (public.is_tenant_admin(%L::uuid)) WITH CHECK (public.is_tenant_admin(%L::uuid))', v_schema_name, p_tenant_id, p_tenant_id);
    EXECUTE format('CREATE POLICY "admin write" ON %I.residents FOR ALL TO authenticated USING (public.is_tenant_admin(%L::uuid)) WITH CHECK (public.is_tenant_admin(%L::uuid))', v_schema_name, p_tenant_id, p_tenant_id);
END;
$$;

-- Idempotent helper: re-provisions a schema (used after registration retries)
GRANT EXECUTE ON FUNCTION public.provision_tenant_schema(uuid) TO project_admin;

-- Admin role check helper (SECURITY DEFINER to avoid RLS recursion)
CREATE OR REPLACE FUNCTION public.is_tenant_admin(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.tenant_users
        WHERE tenant_id = p_tenant_id
          AND user_id = auth.uid()
          AND role IN ('SUPER_ADMIN', 'ADMIN')
          AND status = 'ACTIVE'
    );
$$;

GRANT EXECUTE ON FUNCTION public.is_tenant_admin(uuid) TO anon, authenticated, project_admin;