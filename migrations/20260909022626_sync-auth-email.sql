-- KytosHub: Sync a user's auth identity email after a managed profile email change
-- Prevents the divergence where users_global.email and auth.users.email differ,
-- which previously made the account unable to authenticate after an email edit.

CREATE OR REPLACE FUNCTION public.sync_auth_email(p_user_id uuid, p_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
    UPDATE auth.users SET email = p_email, email_verified = true WHERE id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_auth_email(uuid, text) TO project_admin;