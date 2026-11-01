CREATE TYPE otp_purpose AS ENUM ('email_verification', 'password_reset');

CREATE TABLE "otp_request" (
    id                         UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id                    UUID         NOT NULL REFERENCES "ethoko_user"(id) ON DELETE CASCADE,
    -- NULL represents Unfilled; a 32-byte hash represents Filled.
    otp_hash                   BYTEA        CONSTRAINT otp_request_hash_length CHECK (
        otp_hash IS NULL OR octet_length(otp_hash) = 32
    ),
    purpose                    otp_purpose  NOT NULL,
    expires_at                 TIMESTAMPTZ  NOT NULL,
    consumed_at                TIMESTAMPTZ,
    created_at                 TIMESTAMPTZ  NOT NULL DEFAULT now(),
    UNIQUE (user_id, purpose)
);
