-- Add migration script here

CREATE TYPE job_status AS ENUM ('pending', 'processing', 'successful', 'dead');

CREATE TABLE "ethoko_job" (
    id                         UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    topic                      TEXT         NOT NULL,
    payload                    TEXT         NOT NULL,
    status                     job_status   NOT NULL DEFAULT 'pending',
    scheduled_at               TIMESTAMPTZ  NOT NULL,
    retry_count                INT4         NOT NULL DEFAULT 0,
    processing_timeout_seconds INT4         NOT NULL,
    dequeued_at                TIMESTAMPTZ,
    processing_timeout_at      TIMESTAMPTZ,
    max_retries                INT4         NOT NULL,
    created_at                 TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at                 TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_ethoko_job_status ON "ethoko_job" (status);
CREATE INDEX idx_ethoko_job_processing_timeout ON "ethoko_job" (status, processing_timeout_at) WHERE status = 'processing';
CREATE INDEX idx_ethoko_job_pending_scheduled ON "ethoko_job" (status, scheduled_at) WHERE status = 'pending';

CREATE TRIGGER update_ethoko_job_updated_at
BEFORE UPDATE ON "ethoko_job"
FOR EACH ROW
EXECUTE FUNCTION moddatetime('updated_at');
