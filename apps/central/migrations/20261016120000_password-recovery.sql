-- Independent of verification OTPs and session authentication.
CREATE TABLE password_reset (
    user_id UUID PRIMARY KEY REFERENCES ethoko_user(id) ON DELETE CASCADE,
    token_hash BYTEA NOT NULL UNIQUE,
    issued_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ
);
