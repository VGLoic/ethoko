-- Add migration script here

CREATE TABLE "ethoko_job" (
    id             UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    topic          TEXT         NOT NULL,
    payload        TEXT         NOT NULL,
    scheduled_at   TIMESTAMPTZ  NOT NULL,
    retry_count    INT2         NOT NULL DEFAULT 0,
    max_retries    INT2         NOT NULL,
    dead           BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_ethoko_job_dead ON "ethoko_job" (dead);

CREATE TRIGGER update_ethoko_job_updated_at
BEFORE UPDATE ON "ethoko_job"
FOR EACH ROW
EXECUTE FUNCTION moddatetime('updated_at');
