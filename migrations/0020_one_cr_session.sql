-- ============================================================================
-- Migration 0020 — A class representative represents exactly ONE session
--   Before this, uq_role_grant keyed on (user_id, capability, scope_kind, scope_ref),
--   so the same student could accumulate a 'cr' grant per session (observed live:
--   one user holding both '2022' and '2023').
--   • collapses existing duplicates to each user's most recent cr grant
--   • a partial unique index makes a second cr grant impossible
--   • request_role/promote_user refuse a second session with a readable message,
--     and now require a non-empty batch scope (a CR of "nothing" could never match
--     organizer_covers, so it was silently useless)
-- ============================================================================

-- Up Migration

-- 1. Collapse duplicates: keep each user's most recently granted cr row, drop the rest.
--    (Deterministic via (granted_at, grant_id); required before the unique index below.)
DELETE FROM role_grant g
 WHERE g.capability = 'cr'
   AND EXISTS (
       SELECT 1 FROM role_grant k
        WHERE k.capability = 'cr'
          AND k.user_id    = g.user_id
          AND (k.granted_at, k.grant_id) > (g.granted_at, g.grant_id));

-- 2. Structural guarantee: at most one cr grant per user, whatever its scope.
CREATE UNIQUE INDEX one_cr_grant_per_user ON role_grant (user_id) WHERE capability = 'cr';

-- 3. Requests: block a second CR outright, and require the session to be named.
CREATE OR REPLACE FUNCTION request_role(p_user BIGINT, p_role TEXT, p_scope_kind TEXT DEFAULT NULL, p_scope_ref TEXT DEFAULT NULL, p_justification TEXT DEFAULT NULL)
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id BIGINT;
BEGIN
    IF p_role = 'admin' THEN RAISE EXCEPTION 'cannot request the admin role' USING ERRCODE = 'check_violation'; END IF;

    IF p_role = 'cr' THEN
        IF NULLIF(trim(COALESCE(p_scope_ref, '')), '') IS NULL THEN
            RAISE EXCEPTION 'choose the session you represent' USING ERRCODE = 'check_violation'; END IF;
        IF EXISTS (SELECT 1 FROM role_grant WHERE user_id = p_user AND capability = 'cr') THEN
            RAISE EXCEPTION 'you already represent a session — a student can be CR for only one session, so ask an admin to change it'
                USING ERRCODE = 'check_violation'; END IF;
    END IF;

    INSERT INTO role_request (user_id, requested_role, scope_kind, scope_ref, justification)
        VALUES (p_user, p_role, p_scope_kind, p_scope_ref, p_justification) RETURNING request_id INTO v_id;
    RETURN v_id;
END; $$;

-- 4. Grants (also the approval path, via decide_role_request -> promote_user).
CREATE OR REPLACE FUNCTION promote_user(p_actor BIGINT, p_target BIGINT, p_capability TEXT, p_scope_kind TEXT DEFAULT 'all', p_scope_ref TEXT DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NOT is_admin(p_actor) THEN RAISE EXCEPTION 'only an admin can promote users' USING ERRCODE = 'insufficient_privilege'; END IF;

    IF p_capability = 'cr' THEN
        IF NULLIF(trim(COALESCE(p_scope_ref, '')), '') IS NULL THEN
            RAISE EXCEPTION 'a class representative needs the session they represent' USING ERRCODE = 'check_violation'; END IF;
        -- re-granting the SAME session stays idempotent; a different one is refused
        IF EXISTS (SELECT 1 FROM role_grant
                    WHERE user_id = p_target AND capability = 'cr'
                      AND COALESCE(scope_ref, '') <> COALESCE(p_scope_ref, '')) THEN
            RAISE EXCEPTION 'that student already represents another session — revoke their existing CR role first'
                USING ERRCODE = 'check_violation'; END IF;
    END IF;

    INSERT INTO role_grant (user_id, capability, scope_kind, scope_ref, granted_by)
        VALUES (p_target, p_capability, COALESCE(p_scope_kind, 'all'), p_scope_ref, p_actor)
        ON CONFLICT (user_id, capability, scope_kind, COALESCE(scope_ref, '')) DO NOTHING;
END; $$;

-- Down Migration

DROP INDEX IF EXISTS one_cr_grant_per_user;

CREATE OR REPLACE FUNCTION request_role(p_user BIGINT, p_role TEXT, p_scope_kind TEXT DEFAULT NULL, p_scope_ref TEXT DEFAULT NULL, p_justification TEXT DEFAULT NULL)
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id BIGINT;
BEGIN
    IF p_role = 'admin' THEN RAISE EXCEPTION 'cannot request the admin role' USING ERRCODE = 'check_violation'; END IF;
    INSERT INTO role_request (user_id, requested_role, scope_kind, scope_ref, justification)
        VALUES (p_user, p_role, p_scope_kind, p_scope_ref, p_justification) RETURNING request_id INTO v_id;
    RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION promote_user(p_actor BIGINT, p_target BIGINT, p_capability TEXT, p_scope_kind TEXT DEFAULT 'all', p_scope_ref TEXT DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NOT is_admin(p_actor) THEN RAISE EXCEPTION 'only an admin can promote users' USING ERRCODE = 'insufficient_privilege'; END IF;
    INSERT INTO role_grant (user_id, capability, scope_kind, scope_ref, granted_by)
        VALUES (p_target, p_capability, COALESCE(p_scope_kind, 'all'), p_scope_ref, p_actor)
        ON CONFLICT (user_id, capability, scope_kind, COALESCE(scope_ref, '')) DO NOTHING;
END; $$;
