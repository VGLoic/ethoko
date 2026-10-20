ALTER TABLE otp_request ADD COLUMN consumed_at TIMESTAMPTZ;
-- Keep consumed requests in history so older reset links never become current again.
ALTER TABLE otp_request ADD COLUMN issuance_order BIGINT GENERATED ALWAYS AS IDENTITY;
CREATE INDEX otp_request_user_purpose_order ON otp_request (user_id, purpose, issuance_order DESC);
CREATE INDEX otp_request_reset_hash ON otp_request (otp_hash) WHERE purpose = 'password_reset';
