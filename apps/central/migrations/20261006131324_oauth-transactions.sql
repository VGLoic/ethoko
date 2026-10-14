-- Add migration script here
CREATE TABLE "oauth_transaction" (
    id              UUID                PRIMARY KEY DEFAULT uuid_generate_v4(),
    state_hash      BYTEA               NOT NULL,
    created_at      TIMESTAMPTZ         NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ         NOT NULL
);

CREATE INDEX "idx_oauth_transaction_state_hash" ON "oauth_transaction" (state_hash);
