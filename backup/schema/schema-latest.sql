-- Database Export
-- Generated on: 2026-11-24T16:01:12.295Z
-- Format: SQL
-- Include Data: false
-- Row Limit: 1000 rows per table

-- Table: departments
CREATE TABLE IF NOT EXISTS departments (id uuid NOT NULL DEFAULT gen_random_uuid(), floor_id uuid NOT NULL, tower_id uuid NOT NULL, department_number varchar(20) NOT NULL, status varchar(20) NOT NULL DEFAULT 'HABITADO'::character varying, created_at timestamptz NOT NULL DEFAULT now());

-- Indexes for table: departments
CREATE UNIQUE INDEX departments_tower_id_department_number_key ON public.departments USING btree (tower_id, department_number);
CREATE INDEX idx_departments_floor_id ON public.departments USING btree (floor_id);
CREATE INDEX idx_departments_status ON public.departments USING btree (status);
CREATE INDEX idx_departments_tower_id ON public.departments USING btree (tower_id);
CREATE INDEX idx_departments_tower_number ON public.departments USING btree (tower_id, department_number);

-- Foreign key constraints for table: departments
ALTER TABLE departments ADD CONSTRAINT departments_floor_id_fkey FOREIGN KEY (floor_id) REFERENCES floors (id) ON DELETE CASCADE;
ALTER TABLE departments ADD CONSTRAINT departments_tower_id_fkey FOREIGN KEY (tower_id) REFERENCES towers (id) ON DELETE CASCADE;

-- RLS enabled for table: departments
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;

-- RLS policies for table: departments
CREATE POLICY "Admins can manage departments" ON departments FOR ALL TO public USING ((EXISTS ( SELECT 1
   FROM tenant_users tu
  WHERE ((tu.user_id = auth.uid()) AND ((tu.role)::text = ANY (ARRAY[('SUPER_ADMIN'::character varying)::text, ('ADMIN'::character varying)::text]))))));
CREATE POLICY "Authenticated users can read departments" ON departments FOR SELECT TO public USING ((auth.role() = 'authenticated'::text));

-- Table: floors
CREATE TABLE IF NOT EXISTS floors (id uuid NOT NULL DEFAULT gen_random_uuid(), tower_id uuid NOT NULL, floor_number integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now());

-- Indexes for table: floors
CREATE UNIQUE INDEX floors_tower_id_floor_number_key ON public.floors USING btree (tower_id, floor_number);
CREATE INDEX idx_floors_tower_id ON public.floors USING btree (tower_id);
CREATE INDEX idx_floors_tower_number ON public.floors USING btree (tower_id, floor_number);

-- Foreign key constraints for table: floors
ALTER TABLE floors ADD CONSTRAINT floors_tower_id_fkey FOREIGN KEY (tower_id) REFERENCES towers (id) ON DELETE CASCADE;

-- RLS enabled for table: floors
ALTER TABLE floors ENABLE ROW LEVEL SECURITY;

-- RLS policies for table: floors
CREATE POLICY "Admins can manage floors" ON floors FOR ALL TO public USING ((EXISTS ( SELECT 1
   FROM tenant_users tu
  WHERE ((tu.user_id = auth.uid()) AND ((tu.role)::text = ANY (ARRAY[('SUPER_ADMIN'::character varying)::text, ('ADMIN'::character varying)::text]))))));
CREATE POLICY "Authenticated users can read floors" ON floors FOR SELECT TO public USING ((auth.role() = 'authenticated'::text));

-- Table: keepalive_runs
CREATE TABLE IF NOT EXISTS keepalive_runs (id uuid NOT NULL DEFAULT gen_random_uuid(), source text NOT NULL DEFAULT 'external'::text, status text NOT NULL DEFAULT 'success'::text, http_status integer NOT NULL DEFAULT 200, executed_at timestamptz NOT NULL DEFAULT now(), duration_ms integer, client_ip text, user_agent text, details jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now());

-- Indexes for table: keepalive_runs
CREATE INDEX keepalive_runs_executed_at_idx ON public.keepalive_runs USING btree (executed_at DESC);
CREATE INDEX keepalive_runs_source_executed_at_idx ON public.keepalive_runs USING btree (source, executed_at DESC);

-- RLS enabled for table: keepalive_runs
ALTER TABLE keepalive_runs ENABLE ROW LEVEL SECURITY;

-- Table: residents
CREATE TABLE IF NOT EXISTS residents (id uuid NOT NULL DEFAULT gen_random_uuid(), department_id uuid NOT NULL, full_name varchar(200) NOT NULL, document_type varchar(20) NOT NULL, document_number varchar(30) NOT NULL, relationship_type varchar(20) NOT NULL, is_primary_contact boolean NOT NULL DEFAULT false, email varchar(255), phone varchar(30), user_id uuid, created_at timestamptz NOT NULL DEFAULT now());

-- Indexes for table: residents
CREATE INDEX idx_residents_dept_id ON public.residents USING btree (department_id);
CREATE INDEX idx_residents_document ON public.residents USING btree (document_number);
CREATE INDEX idx_residents_user_id ON public.residents USING btree (user_id);
CREATE UNIQUE INDEX residents_department_id_document_number_key ON public.residents USING btree (department_id, document_number);

-- RLS enabled for table: residents
ALTER TABLE residents ENABLE ROW LEVEL SECURITY;

-- RLS policies for table: residents
CREATE POLICY "admin write residents" ON residents FOR ALL TO authenticated USING (is_tenant_admin(( SELECT t.tenant_id
   FROM tenant_users t
  WHERE (t.user_id = auth.uid())
 LIMIT 1))) WITH CHECK (is_tenant_admin(( SELECT t.tenant_id
   FROM tenant_users t
  WHERE (t.user_id = auth.uid())
 LIMIT 1)));
CREATE POLICY "read residents" ON residents FOR SELECT TO anon, authenticated USING (true);

-- Table: tenant_users
CREATE TABLE IF NOT EXISTS tenant_users (id uuid NOT NULL DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, user_id uuid NOT NULL, role varchar(30) NOT NULL, status varchar(20) NOT NULL DEFAULT 'ACTIVE'::character varying, created_at timestamptz NOT NULL DEFAULT now());

-- Indexes for table: tenant_users
CREATE INDEX idx_tenant_users_role ON public.tenant_users USING btree (role);
CREATE INDEX idx_tenant_users_tenant_id ON public.tenant_users USING btree (tenant_id);
CREATE INDEX idx_tenant_users_user_id ON public.tenant_users USING btree (user_id);
CREATE UNIQUE INDEX tenant_users_tenant_id_user_id_key ON public.tenant_users USING btree (tenant_id, user_id);

-- Foreign key constraints for table: tenant_users
ALTER TABLE tenant_users ADD CONSTRAINT tenant_users_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE;
ALTER TABLE tenant_users ADD CONSTRAINT tenant_users_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE;

-- RLS enabled for table: tenant_users
ALTER TABLE tenant_users ENABLE ROW LEVEL SECURITY;

-- RLS policies for table: tenant_users
CREATE POLICY "Admins can manage tenant users" ON tenant_users FOR ALL TO public USING ((EXISTS ( SELECT 1
   FROM tenant_users tu
  WHERE ((tu.tenant_id = tenant_users.tenant_id) AND (tu.user_id = auth.uid()) AND ((tu.role)::text = ANY (ARRAY[('SUPER_ADMIN'::character varying)::text, ('ADMIN'::character varying)::text]))))));
CREATE POLICY "Users can read own tenant assignments" ON tenant_users FOR SELECT TO public USING ((user_id = auth.uid()));

-- Table: tenants
CREATE TABLE IF NOT EXISTS tenants (id uuid NOT NULL DEFAULT gen_random_uuid(), slug varchar(50) NOT NULL, name varchar(255) NOT NULL, schema_name varchar(100) NOT NULL, status varchar(20) NOT NULL DEFAULT 'ACTIVE'::character varying, created_at timestamptz NOT NULL DEFAULT now(), short_name varchar(50), address text, admin_phone varchar(30), image_url text, towers_count integer NOT NULL DEFAULT 0, floors_count integer NOT NULL DEFAULT 0, departments_count integer NOT NULL DEFAULT 0, residents_count integer NOT NULL DEFAULT 0);

-- Indexes for table: tenants
CREATE UNIQUE INDEX idx_tenants_short_name ON public.tenants USING btree (short_name) WHERE (short_name IS NOT NULL);
CREATE INDEX idx_tenants_slug ON public.tenants USING btree (slug);
CREATE INDEX idx_tenants_status ON public.tenants USING btree (status);
CREATE UNIQUE INDEX tenants_schema_name_key ON public.tenants USING btree (schema_name);
CREATE UNIQUE INDEX tenants_slug_key ON public.tenants USING btree (slug);

-- RLS enabled for table: tenants
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;

-- RLS policies for table: tenants
CREATE POLICY "Super admins can manage tenants" ON tenants FOR ALL TO public USING ((EXISTS ( SELECT 1
   FROM users_global
  WHERE ((users_global.id = auth.uid()) AND (users_global.is_superadmin = true)))));

-- Triggers for table: tenants
CREATE TRIGGER tenants_set_slug BEFORE INSERT ON tenants FOR EACH ROW EXECUTE FUNCTION tenants_set_slug();

-- Table: towers
CREATE TABLE IF NOT EXISTS towers (id uuid NOT NULL DEFAULT gen_random_uuid(), name varchar(100) NOT NULL, code varchar(20) NOT NULL, floors_count integer NOT NULL, departments_per_floor integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now());

-- Indexes for table: towers
CREATE INDEX idx_towers_code ON public.towers USING btree (code);
CREATE UNIQUE INDEX towers_code_key ON public.towers USING btree (code);

-- RLS enabled for table: towers
ALTER TABLE towers ENABLE ROW LEVEL SECURITY;

-- RLS policies for table: towers
CREATE POLICY "Admins can manage towers" ON towers FOR ALL TO public USING ((EXISTS ( SELECT 1
   FROM tenant_users tu
  WHERE ((tu.user_id = auth.uid()) AND ((tu.role)::text = ANY (ARRAY[('SUPER_ADMIN'::character varying)::text, ('ADMIN'::character varying)::text]))))));
CREATE POLICY "Authenticated users can read towers" ON towers FOR SELECT TO public USING ((auth.role() = 'authenticated'::text));

-- Table: users_global
CREATE TABLE IF NOT EXISTS users_global (id uuid NOT NULL, email varchar(255) NOT NULL, password_hash varchar(255) NOT NULL, is_superadmin boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), name varchar, document_type varchar(20), document_number varchar(30), phone varchar(30));

-- Indexes for table: users_global
CREATE INDEX idx_users_global_email ON public.users_global USING btree (email);
CREATE UNIQUE INDEX users_global_email_key ON public.users_global USING btree (email);

-- Foreign key constraints for table: users_global
ALTER TABLE users_global ADD CONSTRAINT users_global_id_fkey FOREIGN KEY (id) REFERENCES auth.users (id) ON DELETE CASCADE;

-- RLS enabled for table: users_global
ALTER TABLE users_global ENABLE ROW LEVEL SECURITY;

-- RLS policies for table: users_global
CREATE POLICY "Super admins can manage users" ON users_global FOR ALL TO authenticated USING (is_global_superadmin()) WITH CHECK (is_global_superadmin());
CREATE POLICY "Users can read own data" ON users_global FOR SELECT TO public USING ((id = auth.uid()));

-- Functions and Procedures
-- Function: admin_reset_password
CREATE OR REPLACE FUNCTION public.admin_reset_password(p_user_id uuid, p_password text)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$UPDATE auth.users SET password = crypt(p_password, gen_salt('bf')) WHERE id = p_user_id RETURNING true$function$
;

-- Function: drop_tenant_schema
CREATE OR REPLACE FUNCTION public.drop_tenant_schema(p_schema text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$ BEGIN EXECUTE format('DROP SCHEMA IF EXISTS %I CASCADE', p_schema); END; $function$
;

-- Function: ensure_tenant_count_sync
CREATE OR REPLACE FUNCTION public.ensure_tenant_count_sync(p_tenant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
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
$function$
;

-- Function: fix_residents_owner
CREATE OR REPLACE FUNCTION public.fix_residents_owner(p_schema text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$ BEGIN EXECUTE format('ALTER TABLE %I.residents ALTER COLUMN is_owner SET DEFAULT false', p_schema); END; $function$
;

-- Function: fix_residents_schema
CREATE OR REPLACE FUNCTION public.fix_residents_schema(p_schema text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$ BEGIN EXECUTE format('ALTER TABLE %I.residents ADD COLUMN IF NOT EXISTS full_name varchar(200)', p_schema); EXECUTE format('ALTER TABLE %I.residents ADD COLUMN IF NOT EXISTS document_type varchar(20)', p_schema); EXECUTE format('ALTER TABLE %I.residents ADD COLUMN IF NOT EXISTS document_number varchar(30)', p_schema); EXECUTE format('ALTER TABLE %I.residents ADD COLUMN IF NOT EXISTS email varchar(255)', p_schema); EXECUTE format('ALTER TABLE %I.residents ADD COLUMN IF NOT EXISTS phone varchar(30)', p_schema); EXECUTE format('ALTER TABLE %I.residents ALTER COLUMN user_id DROP NOT NULL', p_schema); EXECUTE format('ALTER TABLE %I.residents ADD COLUMN IF NOT EXISTS is_owner boolean', p_schema); END; $function$
;

-- Function: fix_residents_user
CREATE OR REPLACE FUNCTION public.fix_residents_user(p_schema text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$ BEGIN EXECUTE format('ALTER TABLE %I.residents ALTER COLUMN user_id DROP NOT NULL', p_schema); END; $function$
;

-- Function: is_global_superadmin
CREATE OR REPLACE FUNCTION public.is_global_superadmin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.users_global AS ug
    WHERE ug.id = auth.uid()
      AND ug.is_superadmin IS TRUE
  );
$function$
;

-- Function: is_tenant_admin
CREATE OR REPLACE FUNCTION public.is_tenant_admin(p_tenant_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
    SELECT EXISTS (
        SELECT 1
        FROM public.tenant_users
        WHERE tenant_id = p_tenant_id
          AND user_id = auth.uid()
          AND role IN ('SUPER_ADMIN', 'ADMIN')
          AND status = 'ACTIVE'
    );
$function$
;

-- Function: normalize_tenant_slug
CREATE OR REPLACE FUNCTION public.normalize_tenant_slug(input_name text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$ DECLARE normalized TEXT; BEGIN normalized := lower(unaccent(coalesce(input_name, ''))); normalized := regexp_replace(normalized, '[^a-z0-9]+', '_', 'g'); normalized := trim(both '_' from normalized); RETURN left(normalized, 50); END; $function$
;

-- Function: provision_parking_layout
CREATE OR REPLACE FUNCTION public.provision_parking_layout(p_tenant_id uuid, p_rows integer, p_spots_per_row integer[], p_row_names text[] DEFAULT NULL::text[], p_orientation text DEFAULT 'HORIZONTAL'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
    v_schema text;
    v_total int;
    v_index int;
    v_row int;
    v_col int;
    v_count int;
    v_num text;
    v_flag boolean;
    v_created int := 0;
    v_updated int := 0;
    v_leftovers int;
    v_counts integer[];
    v_names text[];
    v_orientation text;
BEGIN
    SELECT schema_name INTO v_schema FROM public.tenants WHERE id = p_tenant_id;
    IF v_schema IS NULL THEN
        RETURN jsonb_build_object('created', 0, 'updated', 0, 'error', 'tenant_not_found');
    END IF;

    IF p_rows IS NULL OR p_rows < 1 OR p_spots_per_row IS NULL OR cardinality(p_spots_per_row) < 1 THEN
        RETURN jsonb_build_object('created', 0, 'updated', 0, 'error', 'invalid_layout');
    END IF;

    v_orientation := CASE WHEN upper(btrim(p_orientation)) = 'VERTICAL' THEN 'VERTICAL' ELSE 'HORIZONTAL' END;
    EXECUTE format('ALTER TABLE %I.parking_spots ADD COLUMN IF NOT EXISTS spot_row integer', v_schema);
    EXECUTE format('ALTER TABLE %I.parking_spots ADD COLUMN IF NOT EXISTS spot_index integer', v_schema);
    EXECUTE format('INSERT INTO %I.condo_settings (module_key, is_enabled, config_json) VALUES
        (''parking_control'', true, ''{}''::jsonb)
        ON CONFLICT (module_key) DO NOTHING', v_schema);

    v_counts := p_spots_per_row;
    IF cardinality(v_counts) < p_rows THEN
        v_counts := v_counts || array_fill(1, ARRAY[p_rows - cardinality(v_counts)]);
    ELSIF cardinality(v_counts) > p_rows THEN
        v_counts := v_counts[1:p_rows];
    END IF;

    v_names := ARRAY[]::text[];
    FOR v_row IN 1..p_rows LOOP
        IF p_row_names IS NOT NULL AND v_row <= cardinality(p_row_names)
           AND p_row_names[v_row] IS NOT NULL AND btrim(p_row_names[v_row]) <> '' THEN
            v_names := v_names || btrim(left(p_row_names[v_row], 60));
        ELSE
            v_names := v_names || ('Fila ' || v_row);
        END IF;
    END LOOP;

    v_total := 0;
    FOR v_row IN 1..p_rows LOOP
        v_total := v_total + greatest(1, coalesce(v_counts[v_row], 1));
    END LOOP;
    IF v_total > 999 THEN
        RAISE EXCEPTION 'Parking layout exceeds the three-digit limit of 999 spots';
    END IF;

    v_index := 1;
    FOR v_row IN 1..p_rows LOOP
        v_count := greatest(1, coalesce(v_counts[v_row], 1));
        FOR v_col IN 1..v_count LOOP
            v_num := lpad(v_index::text, 3, '0');
            EXECUTE format(
                'INSERT INTO %I.parking_spots (spot_number, type, status, spot_row, spot_index)
                 VALUES (%L, ''PROPIO'', ''DISPONIBLE'', %s, %s)
                 ON CONFLICT (spot_number) DO UPDATE
                 SET spot_row = EXCLUDED.spot_row, spot_index = EXCLUDED.spot_index
                 RETURNING (xmax = 0) AS inserted',
                v_schema, v_num, v_row, v_col
            ) INTO v_flag;
            IF v_flag THEN v_created := v_created + 1; ELSE v_updated := v_updated + 1; END IF;
            v_index := v_index + 1;
        END LOOP;
    END LOOP;

    EXECUTE format('UPDATE %I.parking_spots SET spot_number = ''tmp-'' || id::text', v_schema);
    v_index := 1;
    FOR v_row IN 1..p_rows LOOP
        v_count := greatest(1, coalesce(v_counts[v_row], 1));
        FOR v_col IN 1..v_count LOOP
            v_num := lpad(v_index::text, 3, '0');
            EXECUTE format(
                'UPDATE %I.parking_spots SET spot_number = %L WHERE spot_row = %s AND spot_index = %s',
                v_schema, v_num, v_row, v_col
            );
            v_index := v_index + 1;
        END LOOP;
    END LOOP;

    EXECUTE format('SELECT count(*) FROM %I.parking_spots WHERE spot_number LIKE ''tmp-%%''', v_schema) INTO v_leftovers;
    IF v_total + v_leftovers > 999 THEN
        RAISE EXCEPTION 'Parking layout and preserved extra spots exceed the three-digit limit of 999';
    END IF;
    EXECUTE format(
        'WITH leftover AS (
             SELECT id FROM %I.parking_spots WHERE spot_number LIKE ''tmp-%%'' ORDER BY created_at, id
         ), numbered AS (
             SELECT id, row_number() OVER () AS rn FROM leftover
         )
         UPDATE %I.parking_spots AS s
         SET spot_number = lpad((%s + numbered.rn)::text, 3, ''0'')
         FROM numbered WHERE s.id = numbered.id',
        v_schema, v_schema, v_total
    );

    EXECUTE format(
        'UPDATE %I.condo_settings SET config_json = config_json || %L::jsonb, updated_at = now()
         WHERE module_key = ''parking_control''',
        v_schema, jsonb_build_object('layout',
            jsonb_build_object('rows', p_rows, 'spots_per_row', v_counts, 'row_names', v_names, 'orientation', v_orientation))
    );

    RETURN jsonb_build_object('rows', p_rows, 'spots_per_row', v_counts, 'row_names', v_names, 'orientation', v_orientation, 'total', v_total, 'created', v_created, 'updated', v_updated);
END;
$function$
;

-- Function: provision_tenant_schema
CREATE OR REPLACE FUNCTION public.provision_tenant_schema(p_tenant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
    v_schema_name text;
    v_status text;
BEGIN
    SELECT schema_name, status
      INTO v_schema_name, v_status
      FROM public.tenants
     WHERE id = p_tenant_id;

    IF v_schema_name IS NULL THEN
        RAISE EXCEPTION 'tenant % not found', p_tenant_id;
    END IF;

    IF v_status IN ('INACTIVE', 'SUSPENDED') THEN
        RAISE EXCEPTION 'tenant is not active';
    END IF;

    EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I', v_schema_name);

    EXECUTE format('CREATE TABLE IF NOT EXISTS %I.condo_settings (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        module_key varchar(50) NOT NULL UNIQUE,
        is_enabled boolean NOT NULL DEFAULT true,
        config_json jsonb NOT NULL DEFAULT ''{}''::jsonb,
        updated_at timestamptz NOT NULL DEFAULT now()
    )', v_schema_name);

    EXECUTE format('CREATE TABLE IF NOT EXISTS %I.towers (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar(100) NOT NULL,
        code varchar(20) NOT NULL UNIQUE,
        floors_count integer NOT NULL CHECK (floors_count > 0),
        departments_per_floor integer NOT NULL CHECK (departments_per_floor > 0),
        created_at timestamptz NOT NULL DEFAULT now()
    )', v_schema_name);

    EXECUTE format('CREATE TABLE IF NOT EXISTS %I.floors (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tower_id uuid NOT NULL REFERENCES %I.towers(id) ON DELETE CASCADE,
        floor_number integer NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(tower_id, floor_number)
    )', v_schema_name, v_schema_name);

    EXECUTE format('CREATE TABLE IF NOT EXISTS %I.departments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        floor_id uuid NOT NULL REFERENCES %I.floors(id) ON DELETE CASCADE,
        tower_id uuid NOT NULL REFERENCES %I.towers(id) ON DELETE CASCADE,
        department_number varchar(20) NOT NULL,
        status varchar(20) NOT NULL DEFAULT ''HABITADO'' CHECK (status IN (''HABITADO'', ''DESOCUPADO'', ''MANTENIMIENTO'')),
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(tower_id, department_number)
    )', v_schema_name, v_schema_name, v_schema_name);

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

    -- Indexes with generic names (names are unique within each schema)
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_towers_code ON %I.towers(code)', v_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_floors_tower_id ON %I.floors(tower_id)', v_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_depts_floor_id ON %I.departments(floor_id)', v_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_depts_tower_id ON %I.departments(tower_id)', v_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_residents_dept_id ON %I.residents(department_id)', v_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_residents_user_id ON %I.residents(user_id)', v_schema_name);

    EXECUTE format('GRANT USAGE ON SCHEMA %I TO anon, authenticated', v_schema_name);
    EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA %I TO anon, authenticated', v_schema_name);
    EXECUTE format('GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO authenticated', v_schema_name);
    EXECUTE format('GRANT ALL ON ALL TABLES IN SCHEMA %I TO project_admin', v_schema_name);

    EXECUTE format('ALTER TABLE %I.condo_settings ENABLE ROW LEVEL SECURITY', v_schema_name);
    EXECUTE format('ALTER TABLE %I.towers ENABLE ROW LEVEL SECURITY', v_schema_name);
    EXECUTE format('ALTER TABLE %I.floors ENABLE ROW LEVEL SECURITY', v_schema_name);
    EXECUTE format('ALTER TABLE %I.departments ENABLE ROW LEVEL SECURITY', v_schema_name);
    EXECUTE format('ALTER TABLE %I.residents ENABLE ROW LEVEL SECURITY', v_schema_name);

    EXECUTE format('CREATE POLICY "read structure" ON %I.towers FOR SELECT TO anon, authenticated USING (true)', v_schema_name);
    EXECUTE format('CREATE POLICY "read structure" ON %I.floors FOR SELECT TO anon, authenticated USING (true)', v_schema_name);
    EXECUTE format('CREATE POLICY "read structure" ON %I.departments FOR SELECT TO anon, authenticated USING (true)', v_schema_name);
    EXECUTE format('CREATE POLICY "read settings" ON %I.condo_settings FOR SELECT TO anon, authenticated USING (true)', v_schema_name);
    EXECUTE format('CREATE POLICY "read residents" ON %I.residents FOR SELECT TO anon, authenticated USING (true)', v_schema_name);

    EXECUTE format('CREATE POLICY "admin write" ON %I.towers FOR ALL TO authenticated USING (public.is_tenant_admin(%L::uuid)) WITH CHECK (public.is_tenant_admin(%L::uuid))', v_schema_name, p_tenant_id, p_tenant_id);
    EXECUTE format('CREATE POLICY "admin write" ON %I.floors FOR ALL TO authenticated USING (public.is_tenant_admin(%L::uuid)) WITH CHECK (public.is_tenant_admin(%L::uuid))', v_schema_name, p_tenant_id, p_tenant_id);
    EXECUTE format('CREATE POLICY "admin write" ON %I.departments FOR ALL TO authenticated USING (public.is_tenant_admin(%L::uuid)) WITH CHECK (public.is_tenant_admin(%L::uuid))', v_schema_name, p_tenant_id, p_tenant_id);
    EXECUTE format('CREATE POLICY "admin write" ON %I.condo_settings FOR ALL TO authenticated USING (public.is_tenant_admin(%L::uuid)) WITH CHECK (public.is_tenant_admin(%L::uuid))', v_schema_name, p_tenant_id, p_tenant_id);
    EXECUTE format('CREATE POLICY "admin write" ON %I.residents FOR ALL TO authenticated USING (public.is_tenant_admin(%L::uuid)) WITH CHECK (public.is_tenant_admin(%L::uuid))', v_schema_name, p_tenant_id, p_tenant_id);
END;
$function$
;

-- Function: provision_tenant_schema_v2
CREATE OR REPLACE FUNCTION public.provision_tenant_schema_v2(p_tenant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$ DECLARE v text; DECLARE s text; BEGIN SELECT schema_name, slug INTO v, s FROM public.tenants WHERE id = p_tenant_id; IF v IS NULL THEN RAISE EXCEPTION 'not found'; END IF; EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I', v); EXECUTE format('CREATE TABLE IF NOT EXISTS %I.towers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name varchar(100) NOT NULL, code varchar(20) NOT NULL UNIQUE, floors_count integer NOT NULL DEFAULT 0, departments_per_floor integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now())', v); EXECUTE format('CREATE TABLE IF NOT EXISTS %I.floors (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tower_id uuid NOT NULL REFERENCES %I.towers(id) ON DELETE CASCADE, floor_number integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tower_id, floor_number))', v, v); EXECUTE format('CREATE TABLE IF NOT EXISTS %I.departments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), floor_id uuid NOT NULL REFERENCES %I.floors(id) ON DELETE CASCADE, tower_id uuid NOT NULL REFERENCES %I.towers(id) ON DELETE CASCADE, department_number varchar(20) NOT NULL, status varchar(20) NOT NULL DEFAULT ''DESOCUPADO'', created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tower_id, department_number))', v, v, v); EXECUTE format('CREATE TABLE IF NOT EXISTS %I.residents (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), department_id uuid NOT NULL REFERENCES %I.departments(id) ON DELETE CASCADE, full_name varchar(200) NOT NULL DEFAULT '''' , document_type varchar(20) NOT NULL DEFAULT ''DNI'' CHECK (document_type IN (''DNI'',''CE'',''PASAPORTE', 'RUC'')), document_number varchar(30) NOT NULL DEFAULT '''' , relationship_type varchar(20) NOT NULL DEFAULT ''INQUILINO'' CHECK (relationship_type IN (''PROPIETARIO'',''FAMILIAR'',''INQUILINO'')), is_primary_contact boolean NOT NULL DEFAULT false, email varchar(255), phone varchar(30), user_id uuid, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(department_id, document_number))', v, v); EXECUTE format('GRANT USAGE ON SCHEMA %I TO anon, authenticated', v); EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO anon, authenticated, project_admin', v); EXECUTE format('ALTER TABLE %I.towers ENABLE ROW LEVEL SECURITY', v); EXECUTE format('ALTER TABLE %I.floors ENABLE ROW LEVEL SECURITY', v); EXECUTE format('ALTER TABLE %I.departments ENABLE ROW LEVEL SECURITY', v); EXECUTE format('ALTER TABLE %I.residents ENABLE ROW LEVEL SECURITY', v); EXECUTE format('CREATE POLICY read_t ON %I.towers FOR SELECT TO anon, authenticated USING (true)', v); EXECUTE format('CREATE POLICY read_f ON %I.floors FOR SELECT TO anon, authenticated USING (true)', v); EXECUTE format('CREATE POLICY read_d ON %I.departments FOR SELECT TO anon, authenticated USING (true)', v); EXECUTE format('CREATE POLICY read_r ON %I.residents FOR SELECT TO anon, authenticated USING (true)', v); EXECUTE format('CREATE POLICY write_t ON %I.towers FOR ALL TO authenticated USING (true) WITH CHECK (true)', v); EXECUTE format('CREATE POLICY write_f ON %I.floors FOR ALL TO authenticated USING (true) WITH CHECK (true)', v); EXECUTE format('CREATE POLICY write_d ON %I.departments FOR ALL TO authenticated USING (true) WITH CHECK (true)', v); EXECUTE format('CREATE POLICY write_r ON %I.residents FOR ALL TO authenticated USING (true) WITH CHECK (true)', v); END; $function$
;

-- Function: refresh_tenant_counts
CREATE OR REPLACE FUNCTION public.refresh_tenant_counts(p_tenant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
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
$function$
;

-- Function: seed_billing_maintenance
CREATE OR REPLACE FUNCTION public.seed_billing_maintenance(p_tenant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
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
$function$
;

-- Function: seed_billing_receipt_data
CREATE OR REPLACE FUNCTION public.seed_billing_receipt_data(p_tenant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
    v_schema text;
BEGIN
    SELECT schema_name INTO v_schema FROM public.tenants WHERE id = p_tenant_id;
    IF v_schema IS NULL THEN RETURN; END IF;

    EXECUTE format('ALTER TABLE %I.invoices ADD COLUMN IF NOT EXISTS receipt_data jsonb', v_schema);
END;
$function$
;

-- Function: seed_billing_variable_data
CREATE OR REPLACE FUNCTION public.seed_billing_variable_data(p_tenant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
    v_schema text;
BEGIN
    SELECT schema_name INTO v_schema FROM public.tenants WHERE id = p_tenant_id;
    IF v_schema IS NULL THEN RETURN; END IF;

    EXECUTE format('ALTER TABLE %I.invoices ADD COLUMN IF NOT EXISTS variable_data jsonb', v_schema);
END;
$function$
;

-- Function: seed_condo_gates
CREATE OR REPLACE FUNCTION public.seed_condo_gates(p_tenant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
    v_schema text;
    v_gates_count int := 2;
    v_default_carts int := 5;
    v_idx int;
    v_gate_id uuid;
BEGIN
    SELECT schema_name INTO v_schema FROM public.tenants WHERE id = p_tenant_id;
    IF v_schema IS NULL THEN RETURN; END IF;

    EXECUTE format('CREATE TABLE IF NOT EXISTS %I.condo_gates (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar(80) NOT NULL,
        code varchar(30),
        is_entry_exit boolean NOT NULL DEFAULT true,
        carts_carga int NOT NULL DEFAULT 0,
        carts_compra int NOT NULL DEFAULT 0,
        sort_order int NOT NULL DEFAULT 0,
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now()
    )', v_schema);

    -- Read existing cart_lending config to seed sensible capacity defaults
    BEGIN
        EXECUTE format('SELECT (config_json->>''gates_count'')::int, (config_json->>''carts_per_gate'')::int
            FROM %I.condo_settings WHERE module_key = ''cart_lending'' LIMIT 1', v_schema)
            INTO v_gates_count, v_default_carts;
        IF v_gates_count IS NULL OR v_gates_count <= 0 THEN v_gates_count := 2; END IF;
        IF v_default_carts IS NULL OR v_default_carts <= 0 THEN v_default_carts := 5; END IF;
    EXCEPTION WHEN OTHERS THEN
        v_gates_count := 2; v_default_carts := 5;
    END;

    -- Seed default gates if none exist
    EXECUTE format('SELECT count(*) FROM %I.condo_gates', v_schema) INTO v_idx;
    IF v_idx = 0 THEN
        FOR v_idx IN 1..v_gates_count LOOP
            EXECUTE format('INSERT INTO %I.condo_gates (name, code, is_entry_exit, carts_carga, carts_compra, sort_order)
                VALUES (%L, %L, true, %L, %L, %L) RETURNING id',
                v_schema,
                'Puerta ' || v_idx,
                'P' || v_idx,
                (v_idx % 2 = 1)::int * v_default_carts,
                (v_idx % 2 = 0)::int * v_default_carts,
                v_idx)
                INTO v_gate_id;
        END LOOP;
    END IF;

    -- Convert carts.gate (integer) to gate_id (uuid FK). The carts table may
    -- not exist yet in some schemas (it is created by seed_condo_modules once
    -- the base structure exists), so guard the migration.
    IF EXISTS (
        SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = v_schema AND c.relname = 'carts' AND c.relkind = 'r'
    ) THEN
        EXECUTE format('ALTER TABLE %I.carts ADD COLUMN IF NOT EXISTS gate_id uuid REFERENCES %I.condo_gates(id)', v_schema, v_schema);

        -- Backfill gate_id from the old integer gate position
        EXECUTE format('UPDATE %I.carts c SET gate_id = g.id
            FROM %I.condo_gates g
            WHERE c.gate_id IS NULL AND c.gate IS NOT NULL
              AND g.sort_order = c.gate', v_schema, v_schema);
    END IF;

    EXECUTE format('GRANT SELECT ON %I.condo_gates TO anon, authenticated', v_schema);
    EXECUTE format('GRANT INSERT, UPDATE, DELETE ON %I.condo_gates TO authenticated', v_schema);
    EXECUTE format('GRANT ALL ON %I.condo_gates TO project_admin', v_schema);
    EXECUTE format('ALTER TABLE %I.condo_gates ENABLE ROW LEVEL SECURITY', v_schema);

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = v_schema AND tablename = 'condo_gates' AND policyname = 'read gates') THEN
        EXECUTE format('CREATE POLICY "read gates" ON %I.condo_gates FOR SELECT TO anon, authenticated USING (true)', v_schema);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = v_schema AND tablename = 'condo_gates' AND policyname = 'admin write gates') THEN
        EXECUTE format('CREATE POLICY "admin write gates" ON %I.condo_gates FOR ALL TO authenticated USING (public.is_tenant_admin(%L::uuid)) WITH CHECK (public.is_tenant_admin(%L::uuid))', v_schema, p_tenant_id, p_tenant_id);
    END IF;
END;
$function$
;

-- Function: seed_condo_modules
CREATE OR REPLACE FUNCTION public.seed_condo_modules(p_tenant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
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
$function$
;

-- Function: seed_condo_stats
CREATE OR REPLACE FUNCTION public.seed_condo_stats(p_tenant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
    v_schema text;
BEGIN
    SELECT schema_name INTO v_schema FROM public.tenants WHERE id = p_tenant_id;
    IF v_schema IS NULL THEN RETURN; END IF;

    EXECUTE format('CREATE TABLE IF NOT EXISTS %I.condo_stats (
        id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        access_total bigint NOT NULL DEFAULT 0,
        access_inside bigint NOT NULL DEFAULT 0,
        access_entry_today bigint NOT NULL DEFAULT 0,
        access_exit_total bigint NOT NULL DEFAULT 0,
        access_exit_today bigint NOT NULL DEFAULT 0,
        vehicles_total bigint NOT NULL DEFAULT 0,
        spots_total bigint NOT NULL DEFAULT 0,
        spots_occupied bigint NOT NULL DEFAULT 0,
        parking_loans_total bigint NOT NULL DEFAULT 0,
        parking_loans_active bigint NOT NULL DEFAULT 0,
        carts_total bigint NOT NULL DEFAULT 0,
        carts_disponible bigint NOT NULL DEFAULT 0,
        carts_prestado bigint NOT NULL DEFAULT 0,
        carts_mantenimiento bigint NOT NULL DEFAULT 0,
        cart_loans_total bigint NOT NULL DEFAULT 0,
        cart_loans_active bigint NOT NULL DEFAULT 0,
        updated_at timestamptz NOT NULL DEFAULT now()
    )', v_schema);

    EXECUTE format('GRANT SELECT ON %I.condo_stats TO anon, authenticated', v_schema);
    EXECUTE format('GRANT INSERT, UPDATE, DELETE ON %I.condo_stats TO authenticated', v_schema);
    EXECUTE format('GRANT ALL ON %I.condo_stats TO project_admin', v_schema);
    EXECUTE format('ALTER TABLE %I.condo_stats ENABLE ROW LEVEL SECURITY', v_schema);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = v_schema AND tablename = 'condo_stats' AND policyname = 'read stats') THEN
        EXECUTE format('CREATE POLICY "read stats" ON %I.condo_stats FOR SELECT TO anon, authenticated USING (true)', v_schema);
    END IF;

    -- Refresh function: recomputes every counter (safe to call directly).
    EXECUTE format($f1$
CREATE OR REPLACE FUNCTION %1$I.refresh_condo_stats()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $f2$
DECLARE
    v_cfg_layout jsonb;
    v_access_total bigint;
    v_access_inside bigint;
    v_access_entry_today bigint;
    v_access_exit_total bigint;
    v_access_exit_today bigint;
    v_vehicles_total bigint;
    v_spots_total bigint;
    v_spots_occupied bigint;
    v_parking_loans_total bigint;
    v_parking_loans_active bigint;
    v_carts_total bigint := 0;
    v_carts_disponible bigint := 0;
    v_carts_prestado bigint := 0;
    v_carts_mantenimiento bigint := 0;
    v_cart_loans_total bigint := 0;
    v_cart_loans_active bigint := 0;
BEGIN
    SELECT COUNT(*) INTO v_access_total FROM %1$I.parking_access_logs;
    SELECT COUNT(*) INTO v_access_inside FROM %1$I.parking_access_logs WHERE exit_time IS NULL;
    SELECT COUNT(*) INTO v_access_entry_today FROM %1$I.parking_access_logs WHERE entry_time::date = CURRENT_DATE;
    SELECT COUNT(*) INTO v_access_exit_total FROM %1$I.parking_access_logs WHERE exit_time IS NOT NULL;
    SELECT COUNT(*) INTO v_access_exit_today FROM %1$I.parking_access_logs WHERE exit_time IS NOT NULL AND exit_time::date = CURRENT_DATE;
    SELECT COUNT(*) INTO v_vehicles_total FROM %1$I.vehicles;

    -- spots_total = sum of spots_per_row of the configured layout (not the raw row
    -- count, which includes leftover spots from previous layouts).
    SELECT config_json -> 'layout' INTO v_cfg_layout FROM %1$I.condo_settings WHERE module_key = 'parking_control' LIMIT 1;
    IF v_cfg_layout IS NULL OR (v_cfg_layout ->> 'rows') IS NULL OR (v_cfg_layout ->> 'rows')::int < 1 THEN
        SELECT COUNT(*) INTO v_spots_total FROM %1$I.parking_spots;
    ELSIF jsonb_typeof(v_cfg_layout -> 'spots_per_row') = 'array' THEN
        SELECT COALESCE(SUM(l.value::int), 0) INTO v_spots_total
        FROM jsonb_array_elements_text(v_cfg_layout -> 'spots_per_row') AS l(value);
    ELSIF (v_cfg_layout -> 'spots_per_row') IS NOT NULL AND (v_cfg_layout ->> 'spots_per_row')::int > 0 THEN
        SELECT ((v_cfg_layout ->> 'rows')::bigint * (v_cfg_layout ->> 'spots_per_row')::int) INTO v_spots_total;
    ELSE
        SELECT COUNT(*) INTO v_spots_total FROM %1$I.parking_spots;
    END IF;
    IF v_spots_total IS NULL OR v_spots_total = 0 THEN
        SELECT COUNT(*) INTO v_spots_total FROM %1$I.parking_spots;
    END IF;

    SELECT COUNT(*) INTO v_spots_occupied FROM %1$I.parking_spots
        WHERE status = 'OCUPADO' OR id IN (SELECT spot_id FROM %1$I.parking_access_logs WHERE exit_time IS NULL AND spot_id IS NOT NULL);
    SELECT COUNT(*) INTO v_parking_loans_total FROM %1$I.parking_loans;
    SELECT COUNT(*) INTO v_parking_loans_active FROM %1$I.parking_loans WHERE status = 'ACTIVO';

    IF to_regclass(%2$L) IS NOT NULL THEN
        SELECT COUNT(*) INTO v_carts_total FROM %1$I.carts;
        SELECT COUNT(*) INTO v_carts_disponible FROM %1$I.carts WHERE status = 'DISPONIBLE';
        SELECT COUNT(*) INTO v_carts_prestado FROM %1$I.carts WHERE status = 'PRESTADO';
        SELECT COUNT(*) INTO v_carts_mantenimiento FROM %1$I.carts WHERE status = 'MANTENIMIENTO';
        SELECT COUNT(*) INTO v_cart_loans_total FROM %1$I.cart_loans;
        SELECT COUNT(*) INTO v_cart_loans_active FROM %1$I.cart_loans WHERE status IN ('ACTIVO', 'ATRASADO');
    END IF;

    INSERT INTO %1$I.condo_stats (id, access_total, access_inside, access_entry_today, access_exit_total, access_exit_today,
        vehicles_total, spots_total, spots_occupied, parking_loans_total, parking_loans_active,
        carts_total, carts_disponible, carts_prestado, carts_mantenimiento, cart_loans_total, cart_loans_active, updated_at)
    VALUES (1, v_access_total, v_access_inside, v_access_entry_today, v_access_exit_total, v_access_exit_today,
        v_vehicles_total, v_spots_total, v_spots_occupied, v_parking_loans_total, v_parking_loans_active,
        v_carts_total, v_carts_disponible, v_carts_prestado, v_carts_mantenimiento, v_cart_loans_total, v_cart_loans_active, now())
    ON CONFLICT (id) DO UPDATE SET
        access_total = EXCLUDED.access_total,
        access_inside = EXCLUDED.access_inside,
        access_entry_today = EXCLUDED.access_entry_today,
        access_exit_total = EXCLUDED.access_exit_total,
        access_exit_today = EXCLUDED.access_exit_today,
        vehicles_total = EXCLUDED.vehicles_total,
        spots_total = EXCLUDED.spots_total,
        spots_occupied = EXCLUDED.spots_occupied,
        parking_loans_total = EXCLUDED.parking_loans_total,
        parking_loans_active = EXCLUDED.parking_loans_active,
        carts_total = EXCLUDED.carts_total,
        carts_disponible = EXCLUDED.carts_disponible,
        carts_prestado = EXCLUDED.carts_prestado,
        carts_mantenimiento = EXCLUDED.carts_mantenimiento,
        cart_loans_total = EXCLUDED.cart_loans_total,
        cart_loans_active = EXCLUDED.cart_loans_active,
        updated_at = now();
END;
$f2$
$f1$, v_schema, v_schema || '.carts');
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.refresh_condo_stats() TO public', v_schema);

    -- Statement-level trigger wrapper (fires once per statement, even multi-row)
    EXECUTE format($t1$
CREATE OR REPLACE FUNCTION %1$I.recompute_condo_stats()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $t2$
BEGIN
    PERFORM %1$I.refresh_condo_stats();
    RETURN NULL;
END;
$t2$
$t1$, v_schema);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.recompute_condo_stats() TO public', v_schema);

    EXECUTE format('DROP TRIGGER IF EXISTS trg_condo_stats_access ON %I.parking_access_logs', v_schema);
    EXECUTE format('CREATE TRIGGER trg_condo_stats_access AFTER INSERT OR UPDATE OR DELETE ON %I.parking_access_logs FOR EACH STATEMENT EXECUTE FUNCTION %I.recompute_condo_stats()', v_schema, v_schema);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_condo_stats_spots ON %I.parking_spots', v_schema);
    EXECUTE format('CREATE TRIGGER trg_condo_stats_spots AFTER INSERT OR UPDATE OR DELETE ON %I.parking_spots FOR EACH STATEMENT EXECUTE FUNCTION %I.recompute_condo_stats()', v_schema, v_schema);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_condo_stats_vehicles ON %I.vehicles', v_schema);
    EXECUTE format('CREATE TRIGGER trg_condo_stats_vehicles AFTER INSERT OR UPDATE OR DELETE ON %I.vehicles FOR EACH STATEMENT EXECUTE FUNCTION %I.recompute_condo_stats()', v_schema, v_schema);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_condo_stats_parking_loans ON %I.parking_loans', v_schema);
    EXECUTE format('CREATE TRIGGER trg_condo_stats_parking_loans AFTER INSERT OR UPDATE OR DELETE ON %I.parking_loans FOR EACH STATEMENT EXECUTE FUNCTION %I.recompute_condo_stats()', v_schema, v_schema);

    IF to_regclass(v_schema || '.carts') IS NOT NULL THEN
        EXECUTE format('DROP TRIGGER IF EXISTS trg_condo_stats_carts ON %I.carts', v_schema);
        EXECUTE format('CREATE TRIGGER trg_condo_stats_carts AFTER INSERT OR UPDATE OR DELETE ON %I.carts FOR EACH STATEMENT EXECUTE FUNCTION %I.recompute_condo_stats()', v_schema, v_schema);
        EXECUTE format('DROP TRIGGER IF EXISTS trg_condo_stats_cart_loans ON %I.cart_loans', v_schema);
        EXECUTE format('CREATE TRIGGER trg_condo_stats_cart_loans AFTER INSERT OR UPDATE OR DELETE ON %I.cart_loans FOR EACH STATEMENT EXECUTE FUNCTION %I.recompute_condo_stats()', v_schema, v_schema);
    END IF;

    -- Backfill: capture current values once
    EXECUTE format('SELECT %I.refresh_condo_stats()', v_schema);
END;
$function$
;

-- Function: seed_parking_control
CREATE OR REPLACE FUNCTION public.seed_parking_control(p_tenant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
    v_schema text;
    v_tbl text;
BEGIN
    SELECT schema_name INTO v_schema FROM public.tenants WHERE id = p_tenant_id;
    IF v_schema IS NULL THEN RETURN; END IF;

    EXECUTE format('CREATE TABLE IF NOT EXISTS %I.parking_spots (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        spot_number varchar(20) NOT NULL UNIQUE,
        type varchar(20) NOT NULL DEFAULT ''PROPIO'' CHECK (type IN (''PROPIO'', ''VISITA'', ''DISCAPACITADOS'')),
        department_id uuid REFERENCES %I.departments(id) ON DELETE SET NULL,
        status varchar(20) NOT NULL DEFAULT ''DISPONIBLE'' CHECK (status IN (''DISPONIBLE'', ''OCUPADO'')),
        created_at timestamptz NOT NULL DEFAULT now()
    )', v_schema, v_schema);

    EXECUTE format('CREATE TABLE IF NOT EXISTS %I.vehicles (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        department_id uuid NOT NULL REFERENCES %I.departments(id) ON DELETE CASCADE,
        license_plate varchar(20) NOT NULL,
        brand varchar(60),
        model varchar(60),
        color varchar(30),
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(department_id, license_plate)
    )', v_schema, v_schema);

    -- Idempotent column add (fresh tables above already omit it from the template).
    EXECUTE format('ALTER TABLE %I.vehicles ADD COLUMN IF NOT EXISTS spot_id uuid REFERENCES %I.parking_spots(id) ON DELETE SET NULL', v_schema, v_schema);

    EXECUTE format('CREATE TABLE IF NOT EXISTS %I.parking_loans (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        spot_id uuid NOT NULL REFERENCES %I.parking_spots(id) ON DELETE CASCADE,
        lender_department_id uuid REFERENCES %I.departments(id) ON DELETE CASCADE,
        borrower_department_id uuid REFERENCES %I.departments(id) ON DELETE CASCADE,
        borrower_vehicle_plate varchar(20),
        start_time timestamptz NOT NULL,
        end_time timestamptz NOT NULL,
        status varchar(20) NOT NULL DEFAULT ''PENDIENTE'' CHECK (status IN (''PENDIENTE'', ''ACTIVO'', ''FINALIZADO'', ''CANCELADO'')),
        created_at timestamptz NOT NULL DEFAULT now()
    )', v_schema, v_schema, v_schema, v_schema);

    EXECUTE format('CREATE TABLE IF NOT EXISTS %I.parking_access_logs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        spot_id uuid REFERENCES %I.parking_spots(id) ON DELETE SET NULL,
        license_plate varchar(20) NOT NULL,
        driver_name varchar(120),
        entry_time timestamptz NOT NULL DEFAULT now(),
        exit_time timestamptz,
        entry_gate_id uuid REFERENCES %I.condo_gates(id) ON DELETE SET NULL,
        exit_gate_id uuid REFERENCES %I.condo_gates(id) ON DELETE SET NULL,
        authorized_by_user_id uuid,
        guard_user_id uuid,
        created_at timestamptz NOT NULL DEFAULT now()
    )', v_schema, v_schema, v_schema, v_schema);

    EXECUTE format('CREATE TABLE IF NOT EXISTS %I.guard_gate_sessions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL,
        gate_id uuid NOT NULL REFERENCES %I.condo_gates(id) ON DELETE CASCADE,
        started_at timestamptz NOT NULL DEFAULT now(),
        ended_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
    )', v_schema, v_schema);

    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_park_spots_dept ON %I.parking_spots(department_id)', v_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_vehicles_dept ON %I.vehicles(department_id)', v_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_vehicles_plate ON %I.vehicles(license_plate)', v_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_vehicles_spot ON %I.vehicles(spot_id)', v_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_park_loans_spot ON %I.parking_loans(spot_id)', v_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_park_loans_borrower ON %I.parking_loans(borrower_department_id)', v_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_park_logs_plate ON %I.parking_access_logs(license_plate)', v_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_park_logs_open ON %I.parking_access_logs(exit_time) WHERE exit_time IS NULL', v_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_guard_sessions_user ON %I.guard_gate_sessions(user_id)', v_schema);

    EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA %I TO anon, authenticated', v_schema);
    EXECUTE format('GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO authenticated', v_schema);
    EXECUTE format('GRANT ALL ON ALL TABLES IN SCHEMA %I TO project_admin', v_schema);

    FOREACH v_tbl IN ARRAY ARRAY['parking_spots', 'vehicles', 'parking_loans', 'parking_access_logs', 'guard_gate_sessions']
    LOOP
        EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', v_schema, v_tbl);
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = v_schema AND tablename = v_tbl AND policyname = 'read parking') THEN
            EXECUTE format('CREATE POLICY "read parking" ON %I.%I FOR SELECT TO anon, authenticated USING (true)', v_schema, v_tbl);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = v_schema AND tablename = v_tbl AND policyname = 'admin write parking') THEN
            EXECUTE format('CREATE POLICY "admin write parking" ON %I.%I FOR ALL TO authenticated USING (public.is_tenant_admin(%L::uuid)) WITH CHECK (public.is_tenant_admin(%L::uuid))', v_schema, v_tbl, p_tenant_id, p_tenant_id);
        END IF;
    END LOOP;

    EXECUTE format('INSERT INTO %I.condo_settings (module_key, is_enabled, config_json) VALUES
        (''parking_control'', true, ''{}''::jsonb)
        ON CONFLICT (module_key) DO NOTHING', v_schema);
END;
$function$
;

-- Function: seed_tower_general_boards
CREATE OR REPLACE FUNCTION public.seed_tower_general_boards(p_tenant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
    v_schema text;
    v_tbl text;
BEGIN
    SELECT schema_name INTO v_schema FROM public.tenants WHERE id = p_tenant_id;
    IF v_schema IS NULL THEN RETURN; END IF;

    EXECUTE format('CREATE TABLE IF NOT EXISTS %I.tower_boards (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tower_id uuid NOT NULL REFERENCES %I.towers(id) ON DELETE CASCADE,
        start_date date NOT NULL,
        end_date date NOT NULL,
        is_active boolean NOT NULL DEFAULT false,
        notes text,
        created_at timestamptz NOT NULL DEFAULT now()
    )', v_schema, v_schema);

    EXECUTE format('CREATE TABLE IF NOT EXISTS %I.tower_board_members (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        board_id uuid NOT NULL REFERENCES %I.tower_boards(id) ON DELETE CASCADE,
        resident_id uuid NOT NULL REFERENCES %I.residents(id) ON DELETE CASCADE,
        role varchar(20) NOT NULL CHECK (role IN (''PRESIDENTE'', ''SECRETARIO'', ''TESORERO'')),
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(board_id, role)
    )', v_schema, v_schema, v_schema);

    EXECUTE format('CREATE TABLE IF NOT EXISTS %I.general_boards (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        start_date date NOT NULL,
        end_date date NOT NULL,
        is_active boolean NOT NULL DEFAULT false,
        notes text,
        created_at timestamptz NOT NULL DEFAULT now()
    )', v_schema);

    EXECUTE format('CREATE TABLE IF NOT EXISTS %I.general_board_members (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        board_id uuid NOT NULL REFERENCES %I.general_boards(id) ON DELETE CASCADE,
        board_member_id uuid NOT NULL REFERENCES %I.tower_board_members(id) ON DELETE CASCADE,
        role varchar(20) NOT NULL CHECK (role IN (''PRESIDENTE'', ''SECRETARIO'', ''TESORERO'')),
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(board_id, role)
    )', v_schema, v_schema, v_schema);

    -- At most one active board per tower (tower boards)
    EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS uq_tower_boards_active ON %I.tower_boards(tower_id) WHERE is_active', v_schema);
    -- At most one active general board
    EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS uq_general_boards_active ON %I.general_boards(is_active) WHERE is_active', v_schema);

    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_tower_boards_tower ON %I.tower_boards(tower_id)', v_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_tower_board_members_board ON %I.tower_board_members(board_id)', v_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_tower_board_members_resident ON %I.tower_board_members(resident_id)', v_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_general_board_members_board ON %I.general_board_members(board_id)', v_schema);

    EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA %I TO anon, authenticated', v_schema);
    EXECUTE format('GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO authenticated', v_schema);
    EXECUTE format('GRANT ALL ON ALL TABLES IN SCHEMA %I TO project_admin', v_schema);

    FOREACH v_tbl IN ARRAY ARRAY['tower_boards', 'tower_board_members', 'general_boards', 'general_board_members']
    LOOP
        EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', v_schema, v_tbl);
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = v_schema AND tablename = v_tbl AND policyname = 'read boards') THEN
            EXECUTE format('CREATE POLICY "read boards" ON %I.%I FOR SELECT TO anon, authenticated USING (true)', v_schema, v_tbl);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = v_schema AND tablename = v_tbl AND policyname = 'admin write boards') THEN
            EXECUTE format('CREATE POLICY "admin write boards" ON %I.%I FOR ALL TO authenticated USING (public.is_tenant_admin(%L::uuid)) WITH CHECK (public.is_tenant_admin(%L::uuid))', v_schema, v_tbl, p_tenant_id, p_tenant_id);
        END IF;
    END LOOP;

    -- Feature flags: off by default, like other optional modules
    EXECUTE format('INSERT INTO %I.condo_settings (module_key, is_enabled, config_json) VALUES
        (''tower_boards'', false, ''{"term_months":12}''::jsonb),
        (''general_board'', false, ''{"term_months":12}''::jsonb)
        ON CONFLICT (module_key) DO NOTHING', v_schema);
END;
$function$
;

-- Function: seed_visitor_access
CREATE OR REPLACE FUNCTION public.seed_visitor_access(p_tenant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
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
        document_type varchar(20) NOT NULL DEFAULT ''DNI'' CHECK (document_type IN (''DNI'', ''CE'', ''PASAPORTE', 'RUC'')),
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
$function$
;

-- Function: sync_auth_email
CREATE OR REPLACE FUNCTION public.sync_auth_email(p_user_id uuid, p_email text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
BEGIN
    UPDATE auth.users SET email = p_email, email_verified = true WHERE id = p_user_id;
END;
$function$
;

-- Function: sync_tenant_counts_on_resident_change
CREATE OR REPLACE FUNCTION public.sync_tenant_counts_on_resident_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
    v_tenant_id uuid;
BEGIN
    SELECT id INTO v_tenant_id FROM public.tenants WHERE schema_name = TG_TABLE_SCHEMA;
    IF v_tenant_id IS NOT NULL THEN
        PERFORM public.refresh_tenant_counts(v_tenant_id);
    END IF;
    RETURN NULL;
END;
$function$
;

-- Function: tenants_set_slug
CREATE OR REPLACE FUNCTION public.tenants_set_slug()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF NEW.slug IS NULL OR NEW.slug = '' THEN
        NEW.slug := public.normalize_tenant_slug(NEW.name);
    END IF;
    IF NEW.short_name IS NULL OR NEW.short_name = '' THEN
        NEW.short_name := NEW.slug;
    END IF;
    IF NEW.schema_name IS NULL OR NEW.schema_name = '' THEN
        NEW.schema_name := 'condo_' || NEW.slug;
    END IF;
    RETURN NEW;
END;
$function$
;

-- Views
-- View: keepalive_status
CREATE OR REPLACE VIEW keepalive_status AS  SELECT DISTINCT ON (keepalive_runs.source) keepalive_runs.source,
    keepalive_runs.executed_at AS last_run_at,
    keepalive_runs.status AS last_status,
    keepalive_runs.http_status AS last_http_status,
    keepalive_runs.duration_ms AS last_duration_ms,
    keepalive_runs.client_ip AS last_client_ip,
    keepalive_runs.user_agent AS last_user_agent,
    keepalive_runs.details AS last_details,
    (now() - keepalive_runs.executed_at) AS time_since_last_run,
    ((now() - keepalive_runs.executed_at) > '36:00:00'::interval) AS is_stale
   FROM keepalive_runs
  ORDER BY keepalive_runs.source, keepalive_runs.executed_at DESC;
