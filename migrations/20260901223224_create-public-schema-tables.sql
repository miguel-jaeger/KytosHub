-- KytosHub: Public schema tables for multi-tenancy
-- Sprint 1: Core structure foundation

-- Tenants table (condominiums)
CREATE TABLE public.tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    schema_name VARCHAR(100) UNIQUE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE', 'SUSPENDED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Global users table
CREATE TABLE public.users_global (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    is_superadmin BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tenant-User relationship with roles
CREATE TABLE public.tenant_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role VARCHAR(30) NOT NULL CHECK (role IN ('SUPER_ADMIN', 'ADMIN', 'SECURITY_AGENT', 'RESIDENT', 'VISITOR')),
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE', 'PENDING')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, user_id)
);

-- Indexes for performance
CREATE INDEX idx_tenants_slug ON public.tenants(slug);
CREATE INDEX idx_tenants_status ON public.tenants(status);
CREATE INDEX idx_users_global_email ON public.users_global(email);
CREATE INDEX idx_tenant_users_tenant_id ON public.tenant_users(tenant_id);
CREATE INDEX idx_tenant_users_user_id ON public.tenant_users(user_id);
CREATE INDEX idx_tenant_users_role ON public.tenant_users(role);

-- Enable RLS
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users_global ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_users ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Tenants: Only super admins can view/modify
CREATE POLICY "Super admins can manage tenants" ON public.tenants
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.users_global
            WHERE users_global.id = auth.uid()
            AND users_global.is_superadmin = TRUE
        )
    );

-- Users global: Users can read their own data, super admins can read all
CREATE POLICY "Users can read own data" ON public.users_global
    FOR SELECT
    USING (id = auth.uid());

CREATE POLICY "Super admins can manage users" ON public.users_global
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.users_global
            WHERE users_global.id = auth.uid()
            AND users_global.is_superadmin = TRUE
        )
    );

-- Tenant users: Admins can manage, users can read their own assignments
CREATE POLICY "Users can read own tenant assignments" ON public.tenant_users
    FOR SELECT
    USING (user_id = auth.uid());

CREATE POLICY "Admins can manage tenant users" ON public.tenant_users
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.tenant_users tu
            WHERE tu.tenant_id = tenant_users.tenant_id
            AND tu.user_id = auth.uid()
            AND tu.role IN ('SUPER_ADMIN', 'ADMIN')
        )
    );

-- Grant permissions to authenticated users
GRANT SELECT ON public.tenants TO authenticated;
GRANT SELECT ON public.users_global TO authenticated;
GRANT SELECT ON public.tenant_users TO authenticated;

-- Grant full access to project_admin for backend operations (migrations run as project_admin)
GRANT ALL ON public.tenants TO project_admin;
GRANT ALL ON public.users_global TO project_admin;
GRANT ALL ON public.tenant_users TO project_admin;
