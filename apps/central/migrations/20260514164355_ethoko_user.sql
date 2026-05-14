-- Add migration script here
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "moddatetime";

CREATE TABLE "ethoko_user" (
    id             UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    email          TEXT         NOT NULL,
    handle         TEXT         NOT NULL,
    email_verified BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TRIGGER update_ethoko_user_updated_at
BEFORE UPDATE ON "ethoko_user"
FOR EACH ROW
EXECUTE FUNCTION moddatetime('updated_at');

CREATE UNIQUE INDEX unique_email ON "ethoko_user" (email);
CREATE UNIQUE INDEX unique_handle ON "ethoko_user" (handle);

CREATE TABLE "auth_credential" (
    id             UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id        UUID         NOT NULL,
    password_hash  TEXT         NOT NULL,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    FOREIGN KEY (user_id) REFERENCES "ethoko_user" (id) ON DELETE CASCADE
);

CREATE TRIGGER update_auth_credential_updated_at
BEFORE UPDATE ON "auth_credential"
FOR EACH ROW
EXECUTE FUNCTION moddatetime('updated_at');
