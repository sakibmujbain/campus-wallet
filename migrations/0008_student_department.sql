-- ============================================================================
-- Migration 0008 — Admin sets a student's department  (Phase C support)
-- Enables department-scoped fees: an admin assigns student.department so
-- assess_fees(scope_kind='department') can resolve a cohort. Audited (the
-- student table already carries the generic audit() trigger from 0002).
-- ============================================================================

-- Up Migration

CREATE FUNCTION set_student_department(p_actor BIGINT, p_student BIGINT, p_department TEXT)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NOT is_admin(p_actor) THEN RAISE EXCEPTION 'only an admin can set a department' USING ERRCODE = 'insufficient_privilege'; END IF;
    UPDATE student SET department = NULLIF(trim(p_department), '') WHERE student_id = p_student;
    IF NOT FOUND THEN RAISE EXCEPTION 'no such student %', p_student; END IF;
END; $$;

GRANT EXECUTE ON FUNCTION set_student_department(BIGINT, BIGINT, TEXT) TO app_write, app_admin;

-- Down Migration

DROP FUNCTION IF EXISTS set_student_department(BIGINT, BIGINT, TEXT);
