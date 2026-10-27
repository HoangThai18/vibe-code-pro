-- Runs inside the writing transaction; delivered only on COMMIT. Ids only: any DB session can LISTEN.
CREATE OR REPLACE FUNCTION notify_app_event() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  r jsonb := to_jsonb(COALESCE(NEW, OLD));
BEGIN
  PERFORM pg_notify('app_events', jsonb_strip_nulls(jsonb_build_object(
    'tenantId', r->>'tenant_id',
    'type',     TG_ARGV[0],
    'id',       r->>'id',
    'version',  r->'version',
    'userId',   r->>'user_id'      -- per-user rows only: delivered to that user alone
  ))::text);
  RETURN NULL;
END $$;

CREATE TRIGGER appointments_notify AFTER INSERT OR UPDATE OR DELETE ON appointments
  FOR EACH ROW EXECUTE FUNCTION notify_app_event('appointment.changed');
CREATE TRIGGER user_notifications_notify AFTER INSERT ON user_notifications
  FOR EACH ROW EXECUTE FUNCTION notify_app_event('notification.created');
CREATE TRIGGER memberships_notify AFTER UPDATE OR DELETE ON memberships
  FOR EACH ROW EXECUTE FUNCTION notify_app_event('membership.changed');
