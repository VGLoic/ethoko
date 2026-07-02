use crate::jobs::{
    job::{Job, JobRequest},
    queue::{Queue, QueueError, QueueInspector},
};
use chrono::{TimeDelta, Utc};
use sqlx::{Pool, Postgres};
use tracing::{debug, warn};

#[derive(Debug, Clone)]
pub struct PsqlQueue {
    retry_delay_seconds: i64,
    pool: Pool<Postgres>,
}

impl PsqlQueue {
    pub fn new(retry_delay_seconds: i64, pool: Pool<Postgres>) -> Self {
        Self {
            retry_delay_seconds,
            pool,
        }
    }
}

impl PsqlQueue {
    async fn cleanup_timeout_jobs(&self) -> Result<(), QueueError> {
        let mut transaction =
            self.pool.begin().await.map_err(|e| {
                anyhow::anyhow!(e).context("failed to start transaction for cleanup")
            })?;

        let timeout_jobs = sqlx::query_as::<_, Job>(
            r#"
            SELECT
                id,
                topic,
                payload,
                status,
                scheduled_at,
                dequeued_at,
                processing_timeout_at,
                retry_count,
                processing_timeout_seconds,
                max_retries,
                created_at,
                updated_at
            FROM "ethoko_job"
            WHERE status = 'processing' AND now() >= processing_timeout_at
            "#,
        )
        .fetch_all(&mut *transaction)
        .await
        .map_err(|e| anyhow::anyhow!(e).context("failed to fetch timeout jobs from psql queue"))?;

        for timeout_job in timeout_jobs {
            if timeout_job.retry_count >= timeout_job.max_retries {
                warn!(
                    "Job {} has timed out and has retried too much, ending up in DLQ",
                    timeout_job.id
                );
                sqlx::query(
                    r#"
                    UPDATE "ethoko_job"
                    SET status = 'dead'
                    WHERE id = $1 AND status = 'processing'
                    "#,
                )
                .bind(timeout_job.id)
                .execute(&mut *transaction)
                .await
                .map_err(|e| {
                    anyhow::anyhow!(e).context("failed to update job into dead letter queue")
                })?;
            } else {
                warn!(
                    "Job {} has timed out and is scheduled for retry with retry #{}",
                    timeout_job.id, timeout_job.retry_count
                );
                let scheduled_at = timeout_job
                    .dequeued_at
                    .unwrap_or(Utc::now())
                    .checked_add_signed(chrono::Duration::seconds(self.retry_delay_seconds))
                    .ok_or_else(|| {
                        anyhow::anyhow!("failed to compute scheduled_at for retry in clean up")
                    })?;
                sqlx::query(
                    r#"
                    UPDATE "ethoko_job"
                    SET
                        status = 'pending',
                        scheduled_at = $3,
                        dequeued_at = NULL,
                        processing_timeout_at = NULL,
                        retry_count = retry_count + 1
                    WHERE id = $1 AND processing_timeout_at = $2
                    "#,
                )
                .bind(timeout_job.id)
                .bind(timeout_job.processing_timeout_at)
                .bind(scheduled_at)
                .execute(&mut *transaction)
                .await
                .map_err(|e| {
                    anyhow::anyhow!(e).context("failed to update timeout job for retry")
                })?;
            }
        }

        transaction
            .commit()
            .await
            .map_err(|e| anyhow::anyhow!(e).context("failed to commit transaction for cleanup"))?;

        Ok(())
    }
}

#[async_trait::async_trait]
impl Queue for PsqlQueue {
    async fn enqueue(&self, job_request: JobRequest) -> Result<Job, QueueError> {
        let job = sqlx::query_as::<_, Job>(
            r#"
            INSERT INTO "ethoko_job" (
                topic,
                payload,
                scheduled_at,
                processing_timeout_seconds,
                max_retries
            ) VALUES ($1, $2, $3, $4, $5)
             RETURNING
                id,
                topic,
                payload,
                status,
                scheduled_at,
                dequeued_at,
                processing_timeout_at,
                retry_count,
                processing_timeout_seconds,
                max_retries,
                created_at,
                updated_at
            "#,
        )
        .bind(job_request.topic)
        .bind(job_request.payload)
        .bind(job_request.scheduled_at)
        .bind(job_request.processing_timeout_seconds)
        .bind(job_request.max_retries)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| anyhow::anyhow!(e).context("failed to insert job into psql queue"))?;

        debug!("enqueued job: {}", job.id);
        Ok(job)
    }

    async fn dequeue(&self) -> Result<Option<Job>, QueueError> {
        self.cleanup_timeout_jobs().await?;

        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|e| anyhow::anyhow!(e).context("failed to start transaction for fail"))?;

        let optional_job = sqlx::query_as::<_, Job>(
            r#"
            SELECT
                id,
                topic,
                payload,
                status,
                scheduled_at,
                dequeued_at,
                processing_timeout_at,
                retry_count,
                processing_timeout_seconds,
                max_retries,
                created_at,
                updated_at
            FROM "ethoko_job"
            WHERE status = 'pending' AND scheduled_at <= now()
            ORDER BY scheduled_at ASC
            LIMIT 1 FOR UPDATE SKIP LOCKED
            "#,
        )
        .fetch_optional(&mut *transaction)
        .await
        .map_err(|e| anyhow::anyhow!(e).context("failed to fetch job from psql queue"))?;

        let mut job = match optional_job {
            None => return Ok(None),
            Some(job) => job,
        };
        let now = Utc::now();
        job.dequeued_at = Some(now);
        job.processing_timeout_at = Some(
            now.checked_add_signed(TimeDelta::seconds(job.processing_timeout_seconds.into()))
                .ok_or(anyhow::anyhow!(
                    "failed to obtain processing timeout datetime"
                ))?,
        );

        sqlx::query(
            r#"
            UPDATE "ethoko_job"
            SET
                status = 'processing',
                dequeued_at = $2,
                processing_timeout_at = $3
            WHERE id = $1 and status = 'pending'
            "#,
        )
        .bind(job.id)
        .bind(job.dequeued_at)
        .bind(job.processing_timeout_at)
        .execute(&mut *transaction)
        .await
        .map_err(|e| anyhow::anyhow!(e).context("failed to update dequeued_at for dequeued_job"))?;

        transaction
            .commit()
            .await
            .map_err(|e| anyhow::anyhow!(e).context("failed to commit transaction for dequeue"))?;

        debug!("job {} dequeued", job.id);

        Ok(Some(job))
    }

    async fn success(&self, id: uuid::Uuid) -> Result<(), QueueError> {
        sqlx::query(
            r#"
            UPDATE "ethoko_job"
            SET status = 'completed'
            WHERE id = $1 AND status = 'processing'
            "#,
        )
        .bind(id)
        .execute(&self.pool)
        .await
        .map_err(|e| {
            anyhow::anyhow!(e).context("failed to delete job from psql queue after success")
        })?;

        debug!("job {} marked as success", id);
        Ok(())
    }

    async fn fail(&self, id: uuid::Uuid) -> Result<(), QueueError> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|e| anyhow::anyhow!(e).context("failed to start transaction for fail"))?;

        let job = sqlx::query_as::<_, Job>(
            r#"
            SELECT
                id,
                topic,
                payload,
                status,
                scheduled_at,
                dequeued_at,
                processing_timeout_at,
                retry_count,
                processing_timeout_seconds,
                max_retries,
                created_at,
                updated_at
            FROM "ethoko_job"
            WHERE id = $1 AND status = 'processing'
            "#,
        )
        .bind(id)
        .fetch_one(&mut *transaction)
        .await
        .map_err(|e| anyhow::anyhow!(e).context("failed to fetch job from queue "))?;

        if job.retry_count >= job.max_retries {
            warn!("Job {} has retried too much, ending up in DLQ", job.id);
            sqlx::query(
                r#"
                UPDATE "ethoko_job"
                SET status = 'dead'
                WHERE id = $1 AND status = 'processing'
                "#,
            )
            .bind(job.id)
            .execute(&mut *transaction)
            .await
            .map_err(|e| {
                anyhow::anyhow!(e).context("failed to update job into dead letter queue")
            })?;
        } else {
            warn!(
                "Job {} scheduled for retry with retry #{}",
                job.id, job.retry_count
            );
            let scheduled_at = Utc::now()
                .checked_add_signed(chrono::Duration::seconds(self.retry_delay_seconds))
                .ok_or_else(|| anyhow::anyhow!("failed to compute scheduled_at for retry"))?;
            sqlx::query(
                r#"
                UPDATE "ethoko_job"
                SET
                    status = 'pending',
                    scheduled_at = $1,
                    retry_count = retry_count + 1,
                    dequeued_at = NULL,
                    processing_timeout_at = NULL
                WHERE id = $2 AND status = 'processing'
                "#,
            )
            .bind(scheduled_at)
            .bind(job.id)
            .execute(&mut *transaction)
            .await
            .map_err(|e| {
                anyhow::anyhow!(e).context("failed to update job for retry in psql queue")
            })?;
        }

        transaction
            .commit()
            .await
            .map_err(|e| anyhow::anyhow!(e).context("failed to commit transaction for fail"))?;

        Ok(())
    }

    async fn retry(&self, id: uuid::Uuid) -> Result<(), QueueError> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|e| anyhow::anyhow!(e).context("failed to start transaction for retry"))?;

        let job = sqlx::query_as::<_, Job>(
            r#"
            SELECT
                id,
                topic,
                payload,
                status,
                scheduled_at,
                dequeued_at,
                processing_timeout_at,
                retry_count,
                processing_timeout_seconds,
                max_retries,
                created_at,
                updated_at
            FROM "ethoko_job"
            WHERE id = $1 AND status = 'dead'
            "#,
        )
        .bind(id)
        .fetch_one(&mut *transaction)
        .await
        .map_err(|e| {
            anyhow::anyhow!(e)
                .context("failed to fetch job from dead letter queue in psql during retry")
        })?;

        sqlx::query(
            r#"
            UPDATE "ethoko_job"
            SET
                scheduled_at = $1,
                retry_count = 0,
                dequeued_at = NULL,
                processing_timeout_at = NULL,
                status = 'pending'
            WHERE id = $2 AND status = 'dead'
            "#,
        )
        .bind(Utc::now())
        .bind(job.id)
        .execute(&mut *transaction)
        .await
        .map_err(|e| {
            anyhow::anyhow!(e).context("failed to insert job into ready queue in psql during retry")
        })?;

        transaction
            .commit()
            .await
            .map_err(|e| anyhow::anyhow!(e).context("failed to commit transaction for retry"))?;

        debug!("Job {} retried from DLQ", id);
        Ok(())
    }
}

#[async_trait::async_trait]
impl QueueInspector for PsqlQueue {
    async fn pending_jobs(&self) -> Result<Vec<Job>, QueueError> {
        let jobs = sqlx::query_as::<_, Job>(
            r#"
            SELECT
                id,
                topic,
                payload,
                status,
                scheduled_at,
                dequeued_at,
                processing_timeout_at,
                retry_count,
                processing_timeout_seconds,
                max_retries,
                created_at,
                updated_at
            FROM "ethoko_job"
            WHERE status = 'pending'
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|e| anyhow::anyhow!(e).context("failed to fetch pending jobs from psql queue"))?;

        Ok(jobs)
    }

    async fn processing_jobs(&self) -> Result<Vec<Job>, QueueError> {
        let jobs = sqlx::query_as::<_, Job>(
            r#"
            SELECT
                id,
                topic,
                payload,
                status,
                scheduled_at,
                dequeued_at,
                processing_timeout_at,
                retry_count,
                processing_timeout_seconds,
                max_retries,
                created_at,
                updated_at
            FROM "ethoko_job"
            WHERE status = 'processing'
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|e| {
            anyhow::anyhow!(e).context("failed to fetch processing jobs from psql queue")
        })?;

        Ok(jobs)
    }

    async fn dead_jobs(&self) -> Result<Vec<Job>, QueueError> {
        let jobs = sqlx::query_as::<_, Job>(
            r#"
            SELECT
                id,
                topic,
                payload,
                status,
                scheduled_at,
                dequeued_at,
                processing_timeout_at,
                retry_count,
                processing_timeout_seconds,
                max_retries,
                created_at,
                updated_at
            FROM "ethoko_job"
            WHERE status = 'dead'
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|e| anyhow::anyhow!(e).context("failed to fetch dead jobs from psql queue"))?;

        Ok(jobs)
    }

    async fn completed_jobs(&self) -> Result<Vec<Job>, QueueError> {
        let jobs = sqlx::query_as::<_, Job>(
            r#"
            SELECT
                id,
                topic,
                payload,
                status,
                scheduled_at,
                dequeued_at,
                processing_timeout_at,
                retry_count,
                processing_timeout_seconds,
                max_retries,
                created_at,
                updated_at
            FROM "ethoko_job"
            WHERE status = 'completed'
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|e| {
            anyhow::anyhow!(e).context("failed to fetch completed jobs from psql queue")
        })?;

        Ok(jobs)
    }
}
