-- Add migration script here
CREATE TYPE opaque_token_kind as ENUM ('session');

CREATE TABLE "opaque_token" (
    id              UUID                PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID                NOT NULL REFERENCES "ethoko_user"(id) ON DELETE CASCADE,
    kind            opaque_token_kind   NOT NULL,
    token_hash      BYTEA               NOT NULL,
    scopes          TEXT[]              NOT NULL,
    created_at      TIMESTAMPTZ         NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ         NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ         NOT NULL,
    revoked_at      TIMESTAMPTZ,
    last_used_at    TIMESTAMPTZ
);

CREATE INDEX idx_opaque_token_hash ON "opaque_token"(token_hash);

CREATE TRIGGER update_opaque_token_updated_at
BEFORE UPDATE ON "opaque_token"
FOR EACH ROW
EXECUTE FUNCTION moddatetime('updated_at');
