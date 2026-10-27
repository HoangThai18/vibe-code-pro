-- PUT /v1/devices: the device belongs to whoever registered last on it ($2: user from the session, never the body)
INSERT INTO devices (push_token, user_id, platform) VALUES ($1, $2, $3)
ON CONFLICT (push_token) DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, last_seen_at = now();
