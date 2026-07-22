-- Demo seed: an opening treasury + two student wallets, funded via real
-- double-entry postings. Safe to re-run (only seeds when no student account exists).
DO $$
DECLARE
    v_open  BIGINT;
    v_alice BIGINT;
    v_bob   BIGINT;
BEGIN
    IF EXISTS (SELECT 1 FROM account WHERE account_kind = 'student') THEN
        RAISE NOTICE 'seed skipped — student accounts already exist';
        RETURN;
    END IF;

    INSERT INTO account (account_kind, currency, overdraft_floor)
        VALUES ('system', 'BDT', -1000000000000000) RETURNING account_id INTO v_open;   -- opening treasury
    INSERT INTO account (account_kind, currency, overdraft_floor)
        VALUES ('student', 'BDT', 0) RETURNING account_id INTO v_alice;
    INSERT INTO account (account_kind, currency, overdraft_floor)
        VALUES ('student', 'BDT', 0) RETURNING account_id INTO v_bob;

    -- Fund the demo wallets from the treasury (balanced, double-entry).
    PERFORM make_transfer(v_open, v_alice, 1000.00, 'BDT', gen_random_uuid(), 'opening balance');
    PERFORM make_transfer(v_open, v_bob,    500.00, 'BDT', gen_random_uuid(), 'opening balance');

    RAISE NOTICE 'seeded: treasury=% alice=% (1000 BDT) bob=% (500 BDT)', v_open, v_alice, v_bob;
END $$;
