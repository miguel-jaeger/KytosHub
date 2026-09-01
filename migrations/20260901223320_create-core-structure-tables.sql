-- KytosHub: Core structure tables (towers, floors, departments, residents)
-- Sprint 1: Physical structure and resident registry

-- Towers table
CREATE TABLE public.towers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    code VARCHAR(20) UNIQUE NOT NULL,
    floors_count INTEGER NOT NULL CHECK (floors_count > 0),
    departments_per_floor INTEGER NOT NULL CHECK (departments_per_floor > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Floors table
CREATE TABLE public.floors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tower_id UUID NOT NULL REFERENCES public.towers(id) ON DELETE CASCADE,
    floor_number INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tower_id, floor_number)
);

-- Departments table
CREATE TABLE public.departments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    floor_id UUID NOT NULL REFERENCES public.floors(id) ON DELETE CASCADE,
    tower_id UUID NOT NULL REFERENCES public.towers(id) ON DELETE CASCADE,
    department_number VARCHAR(20) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'HABITADO' CHECK (status IN ('HABITADO', 'DESOCUPADO', 'MANTENIMIENTO')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tower_id, department_number)
);

-- Residents table
CREATE TABLE public.residents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    department_id UUID NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    is_owner BOOLEAN NOT NULL DEFAULT FALSE,
    relationship_type VARCHAR(20) NOT NULL CHECK (relationship_type IN ('PROPIETARIO', 'FAMILIAR', 'INQUILINO')),
    is_primary_contact BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(department_id, user_id)
);

-- Indexes for performance
CREATE INDEX idx_towers_code ON public.towers(code);
CREATE INDEX idx_floors_tower_id ON public.floors(tower_id);
CREATE INDEX idx_floors_tower_number ON public.floors(tower_id, floor_number);
CREATE INDEX idx_departments_floor_id ON public.departments(floor_id);
CREATE INDEX idx_departments_tower_id ON public.departments(tower_id);
CREATE INDEX idx_departments_tower_number ON public.departments(tower_id, department_number);
CREATE INDEX idx_departments_status ON public.departments(status);
CREATE INDEX idx_residents_department_id ON public.residents(department_id);
CREATE INDEX idx_residents_user_id ON public.residents(user_id);
CREATE INDEX idx_residents_is_owner ON public.residents(is_owner);

-- Enable RLS
ALTER TABLE public.towers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.floors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.residents ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Towers: Admins can manage, authenticated users can read
CREATE POLICY "Authenticated users can read towers" ON public.towers
    FOR SELECT
    USING (auth.role() = 'authenticated');

CREATE POLICY "Admins can manage towers" ON public.towers
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.tenant_users tu
            WHERE tu.user_id = auth.uid()
            AND tu.role IN ('SUPER_ADMIN', 'ADMIN')
        )
    );

-- Floors: Same as towers
CREATE POLICY "Authenticated users can read floors" ON public.floors
    FOR SELECT
    USING (auth.role() = 'authenticated');

CREATE POLICY "Admins can manage floors" ON public.floors
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.tenant_users tu
            WHERE tu.user_id = auth.uid()
            AND tu.role IN ('SUPER_ADMIN', 'ADMIN')
        )
    );

-- Departments: Same as towers
CREATE POLICY "Authenticated users can read departments" ON public.departments
    FOR SELECT
    USING (auth.role() = 'authenticated');

CREATE POLICY "Admins can manage departments" ON public.departments
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.tenant_users tu
            WHERE tu.user_id = auth.uid()
            AND tu.role IN ('SUPER_ADMIN', 'ADMIN')
        )
    );

-- Residents: Admins can manage, residents can read their own
CREATE POLICY "Residents can read own data" ON public.residents
    FOR SELECT
    USING (user_id = auth.uid());

CREATE POLICY "Admins can manage residents" ON public.residents
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.tenant_users tu
            WHERE tu.user_id = auth.uid()
            AND tu.role IN ('SUPER_ADMIN', 'ADMIN')
        )
    );

-- Grant permissions
GRANT SELECT ON public.towers TO authenticated;
GRANT SELECT ON public.floors TO authenticated;
GRANT SELECT ON public.departments TO authenticated;
GRANT SELECT ON public.residents TO authenticated;

GRANT ALL ON public.towers TO project_admin;
GRANT ALL ON public.floors TO project_admin;
GRANT ALL ON public.departments TO project_admin;
GRANT ALL ON public.residents TO project_admin;
