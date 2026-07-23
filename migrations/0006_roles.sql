-- ============================================================================
-- Migration 0006 — Roles & authorization  (Phase A: identity foundation)
-- Everyone stays a STUDENT (wallet); elevated powers are SCOPED GRANTS, not a
-- replacement identity. role_grant is the authority (a "student who is also a
-- CR" is a student with a cr grant for their batch). Admin promotes; students
-- request. All privileged writes are admin-guarded in-function (RLS is bypassed
-- by the app's postgres role, so authorization MUST live in the functions).
-- ============================================================================

-- Up Migration

CREATE TABLE role_grant (
    grant_id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id    BIGINT NOT NULL REFERENCES app_user(user_id),
    capability TEXT NOT NULL CHECK (capability IN ('cr','club_exec','institution','admin')),
    scope_kind TEXT NOT NULL DEFAULT 'all'
               CHECK (scope_kind IN ('all','batch','club','institution','department','hall')),
    scope_ref  TEXT,
    granted_by BIGINT REFERENCES app_user(user_id),
    granted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- COALESCE so a NULL scope_ref (e.g. admin/all) still dedups.
CREATE UNIQUE INDEX uq_role_grant ON role_grant (user_id, capability, scope_kind, COALESCE(scope_ref, ''));

CREATE TABLE role_request (
    request_id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id        BIGINT NOT NULL REFERENCES app_user(user_id),
    requested_role TEXT NOT NULL CHECK (requested_role IN ('cr','club_exec','institution')),  -- never 'admin'
    scope_kind     TEXT,
    scope_ref      TEXT,
    justification  TEXT,
    status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied')),
    decided_by     BIGINT REFERENCES app_user(user_id),
    decided_at     TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_pending_request ON role_request (user_id, requested_role) WHERE status = 'pending';

-- ── Authorization helpers ──────────────────────────────────────────────────
CREATE FUNCTION is_admin(p_user BIGINT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (SELECT 1 FROM role_grant WHERE user_id = p_user AND capability = 'admin');
$$;

-- Grant admin to p_user if forced (email allowlisted) OR if no admin exists yet
-- (first-run bootstrap, so a fresh deploy always has one admin).
CREATE FUNCTION ensure_admin(p_user BIGINT, p_force BOOLEAN DEFAULT false) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF p_force OR NOT EXISTS (SELECT 1 FROM role_grant WHERE capability = 'admin') THEN
        INSERT INTO role_grant (user_id, capability, scope_kind, granted_by)
        VALUES (p_user, 'admin', 'all', p_user)
        ON CONFLICT (user_id, capability, scope_kind, COALESCE(scope_ref, '')) DO NOTHING;
        RETURN true;
    END IF;
    RETURN false;
END; $$;

-- Student self-declares a role (never admin). Blocked at the CHECK too.
CREATE FUNCTION request_role(p_user BIGINT, p_role TEXT, p_scope_kind TEXT DEFAULT NULL, p_scope_ref TEXT DEFAULT NULL, p_justification TEXT DEFAULT NULL)
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id BIGINT;
BEGIN
    IF p_role = 'admin' THEN RAISE EXCEPTION 'cannot request the admin role' USING ERRCODE = 'check_violation'; END IF;
    INSERT INTO role_request (user_id, requested_role, scope_kind, scope_ref, justification)
        VALUES (p_user, p_role, p_scope_kind, p_scope_ref, p_justification) RETURNING request_id INTO v_id;
    RETURN v_id;
END; $$;

-- Admin grants a capability (idempotent).
CREATE FUNCTION promote_user(p_actor BIGINT, p_target BIGINT, p_capability TEXT, p_scope_kind TEXT DEFAULT 'all', p_scope_ref TEXT DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NOT is_admin(p_actor) THEN RAISE EXCEPTION 'only an admin can promote users' USING ERRCODE = 'insufficient_privilege'; END IF;
    INSERT INTO role_grant (user_id, capability, scope_kind, scope_ref, granted_by)
        VALUES (p_target, p_capability, COALESCE(p_scope_kind, 'all'), p_scope_ref, p_actor)
        ON CONFLICT (user_id, capability, scope_kind, COALESCE(scope_ref, '')) DO NOTHING;
END; $$;

-- Admin revokes a capability; can never remove the LAST admin.
CREATE FUNCTION demote_user(p_actor BIGINT, p_target BIGINT, p_capability TEXT, p_scope_kind TEXT DEFAULT 'all', p_scope_ref TEXT DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NOT is_admin(p_actor) THEN RAISE EXCEPTION 'only an admin can change roles' USING ERRCODE = 'insufficient_privilege'; END IF;
    IF p_capability = 'admin' AND (SELECT count(*) FROM role_grant WHERE capability = 'admin') <= 1 THEN
        RAISE EXCEPTION 'cannot remove the last admin' USING ERRCODE = 'check_violation';
    END IF;
    DELETE FROM role_grant
     WHERE user_id = p_target AND capability = p_capability
       AND scope_kind = COALESCE(p_scope_kind, 'all')
       AND COALESCE(scope_ref, '') = COALESCE(p_scope_ref, '');
END; $$;

-- Admin approves/denies a pending role request (approve -> grant).
CREATE FUNCTION decide_role_request(p_actor BIGINT, p_request BIGINT, p_approve BOOLEAN)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_req role_request;
BEGIN
    IF NOT is_admin(p_actor) THEN RAISE EXCEPTION 'only an admin can decide role requests' USING ERRCODE = 'insufficient_privilege'; END IF;
    SELECT * INTO v_req FROM role_request WHERE request_id = p_request FOR UPDATE;
    IF v_req.request_id IS NULL THEN RAISE EXCEPTION 'no such role request %', p_request; END IF;
    IF v_req.status <> 'pending' THEN RAISE EXCEPTION 'role request % already decided', p_request USING ERRCODE = 'check_violation'; END IF;

    IF p_approve THEN
        PERFORM promote_user(p_actor, v_req.user_id, v_req.requested_role, v_req.scope_kind, v_req.scope_ref);
        UPDATE role_request SET status = 'approved', decided_by = p_actor, decided_at = now() WHERE request_id = p_request;
    ELSE
        UPDATE role_request SET status = 'denied', decided_by = p_actor, decided_at = now() WHERE request_id = p_request;
    END IF;
END; $$;

-- Audit the privileged tables (reuse the generic audit() trigger from 0002).
CREATE TRIGGER trg_audit_role_grant   AFTER INSERT OR UPDATE OR DELETE ON role_grant   FOR EACH ROW EXECUTE FUNCTION audit();
CREATE TRIGGER trg_audit_role_request AFTER INSERT OR UPDATE OR DELETE ON role_request FOR EACH ROW EXECUTE FUNCTION audit();

-- Grants (RLS is a design artifact today; row scoping is done in the app layer).
GRANT SELECT ON role_grant, role_request TO app_read, app_write, app_admin;
GRANT EXECUTE ON FUNCTION is_admin(BIGINT), ensure_admin(BIGINT, BOOLEAN),
                          request_role(BIGINT, TEXT, TEXT, TEXT, TEXT),
                          promote_user(BIGINT, BIGINT, TEXT, TEXT, TEXT),
                          demote_user(BIGINT, BIGINT, TEXT, TEXT, TEXT),
                          decide_role_request(BIGINT, BIGINT, BOOLEAN)
    TO app_write, app_admin;

-- Down Migration

DROP TRIGGER IF EXISTS trg_audit_role_request ON role_request;
DROP TRIGGER IF EXISTS trg_audit_role_grant   ON role_grant;
DROP FUNCTION IF EXISTS decide_role_request(BIGINT, BIGINT, BOOLEAN);
DROP FUNCTION IF EXISTS demote_user(BIGINT, BIGINT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS promote_user(BIGINT, BIGINT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS request_role(BIGINT, TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS ensure_admin(BIGINT, BOOLEAN);
DROP FUNCTION IF EXISTS is_admin(BIGINT);
DROP TABLE IF EXISTS role_request;
DROP TABLE IF EXISTS role_grant;
