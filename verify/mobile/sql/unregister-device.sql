-- DELETE /v1/devices/:pushToken (logout)
DELETE FROM devices WHERE push_token = $1 AND user_id = $2;
