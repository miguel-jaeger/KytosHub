-- KytosHub: Redesign residents table
-- Sprint 1: Residents identified by name + document, not user_id

-- Drop the old residents table (it was empty in all tenants)
DROP TABLE IF EXISTS public.residents;

-- Create the new residents table
CREATE TABLE public.residents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    department_id uuid NOT NULL,
    full_name varchar(200) NOT NULL,
    document_type varchar(20) NOT NULL CHECK (document_type IN ('DNI', 'CE', 'PASAPORTE')),
    document_number varchar(30) NOT NULL,
    relationship_type varchar(20) NOT NULL CHECK (relationship_type IN ('PROPIETARIO', 'FAMILIAR', 'INQUILINO')),
    is_primary_contact boolean NOT NULL DEFAULT false,
    email varchar(255),
    phone varchar(30),
    user_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(department_id, document_number)
);

CREATE INDEX idx_residents_dept_id ON public.residents(department_id);
CREATE INDEX idx_residents_user_id ON public.residents(user_id);
CREATE INDEX idx_residents_document ON public.residents(document_number);

-- RLS
ALTER TABLE public.residents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read residents" ON public.residents FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "admin write residents" ON public.residents FOR ALL TO authenticated
    USING (public.is_tenant_admin(
        (SELECT t.tenant_id FROM public.tenant_users t WHERE t.user_id = auth.uid() LIMIT 1)
    ))
    WITH CHECK (public.is_tenant_admin(
        (SELECT t.tenant_id FROM public.tenant_users t WHERE t.user_id = auth.uid() LIMIT 1)
    ));

GRANT SELECT ON public.residents TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.residents TO authenticated;
GRANT ALL ON public.residents TO project_admin;