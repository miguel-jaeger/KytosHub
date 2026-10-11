-- Avoid self-referencing users_global in its own RLS policy.
CREATE OR REPLACE FUNCTION public.is_global_superadmin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users_global AS ug
    WHERE ug.id = auth.uid()
      AND ug.is_superadmin IS TRUE
  );
$$;

REVOKE ALL ON FUNCTION public.is_global_superadmin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_global_superadmin() TO authenticated;

DROP POLICY IF EXISTS "Super admins can manage users" ON public.users_global;

CREATE POLICY "Super admins can manage users"
ON public.users_global
FOR ALL
TO authenticated
USING (public.is_global_superadmin())
WITH CHECK (public.is_global_superadmin());
