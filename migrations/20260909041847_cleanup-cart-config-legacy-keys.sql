-- KytosHub: remove legacy gate configuration keys from the cart_lending module
-- Since gates moved to the condo_gates table, gates_count/carts_per_gate in
-- the module config are obsolete and made the module look misconfigured.

DO $$
DECLARE
    s text;
BEGIN
    FOR s IN SELECT schema_name FROM public.tenants LOOP
        EXECUTE format(
            'UPDATE %I.condo_settings
             SET config_json = config_json - ''gates_count'' - ''carts_per_gate''
             WHERE module_key = ''cart_lending''',
            s
        );
    END LOOP;
END $$;