CREATE TYPE otp_purpose AS ENUM ('email_verification', 'password_reset');

CREATE TABLE "otp_request" (
    id                         UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id                    UUID         NOT NULL REFERENCES "ethoko_user"(id) ON DELETE CASCADE,
    otp_hash                   BYTEA        NOT NULL,
    purpose                    otp_purpose  NOT NULL,
    expires_at                 TIMESTAMPTZ  NOT NULL,
    created_at                 TIMESTAMPTZ  NOT NULL DEFAULT now(),
    UNIQUE (user_id, purpose)
);
