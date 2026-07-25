-- ============================================================================
-- Migration 0022 — Payment reminders link to where you can actually pay
--   remind_defaulters() sent students to /events, which is the read-only
--   "events & defaulters" overview — it has no pay button. The payable list is
--   /my-events ("My collections"), so the reminder was a dead end: the student
--   reads "you still owe ৳500", taps it, and lands on a page that can't take
--   the payment.
--   Function body is otherwise unchanged (same idempotency guard, same wording).
-- ============================================================================

-- Up Migration

CREATE OR REPLACE FUNCTION remind_defaulters(p_actor BIGINT, p_event BIGINT)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org BIGINT; v_name TEXT; v_count INT;
BEGIN
    SELECT organizer_user_id, name INTO v_org, v_name FROM event WHERE event_id = p_event;
    IF v_org IS NULL THEN RAISE EXCEPTION 'no such event %', p_event; END IF;
    IF NOT (is_admin(p_actor) OR v_org = p_actor) THEN
        RAISE EXCEPTION 'only the organizer or an admin may send reminders' USING ERRCODE = 'insufficient_privilege'; END IF;
    -- Idempotent: skip a defaulter who still has an UNREAD reminder for THIS drive, so a
    -- double-submit (retry, two tabs, organizer+admin) doesn't stack duplicate reminders.
    -- Title carries the drive name, giving per-drive dedup without a schema column.
    INSERT INTO notification (user_id, kind, title, body, link)
        SELECT d.student_id, 'event_reminder',
               'Payment due: ' || v_name,
               'You still owe ৳' || to_char(d.outstanding, 'FM999999990.00') || ' for "' || v_name || '".',
               '/my-events'
          FROM v_event_defaulters d
         WHERE d.event_id = p_event
           AND NOT EXISTS (
               SELECT 1 FROM notification n
                WHERE n.user_id = d.student_id
                  AND n.kind = 'event_reminder'
                  AND n.title = 'Payment due: ' || v_name
                  AND n.read_at IS NULL);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END; $$;

-- Repoint reminders already sitting unread in students' bells, so the fix reaches
-- the people who were reminded before this migration rather than only future ones.
UPDATE notification SET link = '/my-events'
 WHERE kind = 'event_reminder' AND link = '/events';

-- Down Migration

UPDATE notification SET link = '/events'
 WHERE kind = 'event_reminder' AND link = '/my-events';

CREATE OR REPLACE FUNCTION remind_defaulters(p_actor BIGINT, p_event BIGINT)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org BIGINT; v_name TEXT; v_count INT;
BEGIN
    SELECT organizer_user_id, name INTO v_org, v_name FROM event WHERE event_id = p_event;
    IF v_org IS NULL THEN RAISE EXCEPTION 'no such event %', p_event; END IF;
    IF NOT (is_admin(p_actor) OR v_org = p_actor) THEN
        RAISE EXCEPTION 'only the organizer or an admin may send reminders' USING ERRCODE = 'insufficient_privilege'; END IF;
    INSERT INTO notification (user_id, kind, title, body, link)
        SELECT d.student_id, 'event_reminder',
               'Payment due: ' || v_name,
               'You still owe ৳' || to_char(d.outstanding, 'FM999999990.00') || ' for "' || v_name || '".',
               '/events'
          FROM v_event_defaulters d
         WHERE d.event_id = p_event
           AND NOT EXISTS (
               SELECT 1 FROM notification n
                WHERE n.user_id = d.student_id
                  AND n.kind = 'event_reminder'
                  AND n.title = 'Payment due: ' || v_name
                  AND n.read_at IS NULL);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END; $$;
