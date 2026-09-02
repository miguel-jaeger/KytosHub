-- Recreate residents table in existing tenant schema
DROP TABLE IF EXISTS condo_condominio-las-gardenias.residents;

CREATE TABLE condo_condominio-las-gardenias.residents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    department_id uuid NOT NULL REFERENCES condo_condominio-las-gardenias.departments(id) ON DELETE CASCADE,
    full_name varchar(200) NOT NULL,
    document_type varchar(20) NOT NULL CHECK (document_type IN ('DNI','CE','PASAPORTE')),
    document_number varchar(30) NOT NULL,
    relationship_type varchar(20) NOT NULL CHECK (relationship_type IN ('PROPIETARIO','FAMILIAR','INQUILINO')),
    is_primary_contact boolean NOT NULL DEFAULT false,
    email varchar(255),
    phone varchar(30),
    user_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(department_id, document_number)
);

CREATE INDEX idx_residents_dept_id ON condo_condominio-las-gardenias.residents(department_id);
CREATE INDEX idx_residents_user_id ON condo_condominio-las-gardenias.residents(user_id);
ALTER TABLE condo_condominio-las-gardenias.residents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read residents" ON condo_condominio-las-gardenias.residents FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "admin write residents" ON condo_condominio-las-gardenias.residents FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT ON condo_condominio-las-gardenias.residents TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON condo_condominio-las-gardenias.residents TO authenticated;
GRANT ALL ON condo_condominio-las-gardenias.residents TO project_admin;