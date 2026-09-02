-- KytosHub: Add tenant registration fields for condominiums
-- Sprint 1: Condominium registration (name, image, address, admin phone)

ALTER TABLE public.tenants
    ADD COLUMN short_name VARCHAR(50),
    ADD COLUMN address TEXT,
    ADD COLUMN admin_phone VARCHAR(30),
    ADD COLUMN image_url TEXT;

-- short_name is used as the Cloudinary folder identifier for the condominium
CREATE UNIQUE INDEX idx_tenants_short_name ON public.tenants(short_name) WHERE short_name IS NOT NULL;

-- Enrich the slug generation from the tenant name at insert time
CREATE OR REPLACE FUNCTION public.normalize_tenant_slug(input_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    normalized TEXT;
BEGIN
    normalized := lower(unaccent(coalesce(input_name, '')));
    normalized := regexp_replace(normalized, '[^a-z0-9]+', '-', 'g');
    normalized := trim(both '-' from normalized);
    RETURN left(normalized, 50);
END;
$$;

-- Auto-normalize slug and derive short_name when not provided
CREATE OR REPLACE FUNCTION public.tenants_set_slug()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
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
$$;

DROP TRIGGER IF EXISTS tenants_set_slug ON public.tenants;
CREATE TRIGGER tenants_set_slug
    BEFORE INSERT ON public.tenants
    FOR EACH ROW
    EXECUTE FUNCTION public.tenants_set_slug();

-- unaccent extension is used by normalize_tenant_slug
CREATE EXTENSION IF NOT EXISTS unaccent;