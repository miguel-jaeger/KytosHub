-- KytosHub: materialize physical carts from gate cart capacities
-- Gate capacity (carts_carga / carts_compra) previously only defined a limit,
-- but the security agent lends actual carts rows. This creates one physical
-- cart record per unit of capacity for each active gate, so the Garita panel
-- shows available carts.

DO $$
DECLARE
    s text;
    r record;
    i int;
    v_base text;
    v_gate_code text;
BEGIN
    FOR s IN SELECT schema_name FROM public.tenants LOOP
        FOR r IN EXECUTE format(
            'SELECT g.id AS gate_id, g.sort_order, g.code, g.carts_carga, g.carts_compra
             FROM %I.condo_gates g
             WHERE g.is_active = true
             ORDER BY g.sort_order',
            s
        ) LOOP
            IF r.carts_carga IS NULL OR r.carts_compra IS NULL THEN CONTINUE; END IF;
            v_gate_code := coalesce(nullif(r.code, ''), 'G' || r.sort_order);
            v_base := v_gate_code;

            -- Carga carts
            IF r.carts_carga > 0 THEN
                FOR i IN 1..r.carts_carga LOOP
                    EXECUTE format(
                        'INSERT INTO %I.carts (code_identifier, status, gate_id, cart_type, notes)
                         VALUES (%L, %L, %L, %L, %L)
                         ON CONFLICT (code_identifier) DO NOTHING',
                        s,
                        v_base || '_CARGA_' || i,
                        'DISPONIBLE',
                        r.gate_id,
                        'CARGA',
                        null
                    );
                END LOOP;
            END IF;

            IF r.carts_compra > 0 THEN
                FOR i IN 1..r.carts_compra LOOP
                    EXECUTE format(
                        'INSERT INTO %I.carts (code_identifier, status, gate_id, cart_type, notes)
                         VALUES (%L, %L, %L, %L, %L)
                         ON CONFLICT (code_identifier) DO NOTHING',
                        s,
                        v_base || '_COMPRA_' || i,
                        'DISPONIBLE',
                        r.gate_id,
                        'COMPRA',
                        null
                    );
                END LOOP;
            END IF;
        END LOOP;
    END LOOP;
END $$;