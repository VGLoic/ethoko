use crate::jobs::{
    job::Job,
    queue::QueueError,
    queue::{Queue, QueueInspector},
};
use chrono::Utc;
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

#[async_trait::async_trait]
impl Queue for PsqlQueue {
    async fn enqueue(&self, job: Job) -> Result<(), QueueError> {
        sqlx::query(
            r#"
            INSERT INTO "ethoko_job" (
                id,
                topic,
                payload,
                scheduled_at,
                retry_count,
                max_retries
            ) VALUES ($1, $2, $3, $4, $5, $6)
            "#,
        )
        .bind(job.id)
        .bind(job.topic)
        .bind(job.payload)
        .bind(job.scheduled_at)
        .bind(job.retry_count)
        .bind(job.max_retries)
        .execute(&self.pool)
        .await
        .map_err(|e| anyhow::anyhow!(e).context("failed to insert job into psql queue"))?;

        debug!("enqueued job: {}", job.id);
        Ok(())
    }

    async fn dequeue(&self) -> Result<Option<Job>, QueueError> {
        let job = sqlx::query_as::<_, Job>(
            r#"
            SELECT
                id,
                topic,
                payload,
                scheduled_at,
                retry_count,
                max_retries
            FROM "ethoko_job"
            WHERE dead = FALSE AND scheduled_at <= now()
            ORDER BY scheduled_at ASC
            LIMIT 1
            "#,
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| anyhow::anyhow!(e).context("failed to fetch job from psql queue"))?;

        Ok(job)
    }

    async fn success(&self, id: uuid::Uuid) -> Result<(), QueueError> {
        sqlx::query(
            r#"
            DELETE FROM "ethoko_job"
            WHERE id = $1 AND dead = FALSE
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

        let mut job = sqlx::query_as::<_, Job>(
            r#"
            SELECT
                id,
                topic,
                payload,
                scheduled_at,
                retry_count,
                max_retries
            FROM "ethoko_job"
            WHERE id = $1 AND dead = FALSE
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
                SET dead = TRUE
                WHERE id = $1 AND dead = FALSE
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
            job.schedule_retry(scheduled_at);
            sqlx::query(
                r#"
                UPDATE "ethoko_job"
                SET
                    scheduled_at = $1,
                    retry_count = retry_count + 1
                WHERE id = $2 AND dead = FALSE
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

        let mut job = sqlx::query_as::<_, Job>(
            r#"
            SELECT
                id,
                topic,
                payload,
                scheduled_at,
                retry_count,
                max_retries
            FROM "ethoko_job"
            WHERE id = $1 AND dead = TRUE
            "#,
        )
        .bind(id)
        .fetch_one(&mut *transaction)
        .await
        .map_err(|e| {
            anyhow::anyhow!(e)
                .context("failed to fetch job from dead letter queue in psql during retry")
        })?;

        job.reset_retries();

        sqlx::query(
            r#"
            UPDATE "ethoko_job"
            SET
                scheduled_at = $1,
                retry_count = $2,
                dead = FALSE
            WHERE id = $3 AND dead = TRUE
            "#,
        )
        .bind(Utc::now())
        .bind(job.retry_count)
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
    async fn idle_jobs(&self) -> Result<Vec<Job>, QueueError> {
        let jobs = sqlx::query_as::<_, Job>(
            r#"
            SELECT
                id,
                topic,
                payload,
                scheduled_at,
                retry_count,
                max_retries
            FROM "ethoko_job"
            WHERE dead = FALSE AND scheduled_at > now()
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|e| anyhow::anyhow!(e).context("failed to fetch idle jobs from psql queue"))?;

        Ok(jobs)
    }

    async fn ready_jobs(&self) -> Result<Vec<Job>, QueueError> {
        let jobs = sqlx::query_as::<_, Job>(
            r#"
            SELECT
                id,
                topic,
                payload,
                scheduled_at,
                retry_count,
                max_retries
            FROM "ethoko_job"
            WHERE dead = FALSE AND scheduled_at <= now()
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|e| anyhow::anyhow!(e).context("failed to fetch ready jobs from psql queue"))?;

        Ok(jobs)
    }

    async fn dead_jobs(&self) -> Result<Vec<Job>, QueueError> {
        let jobs = sqlx::query_as::<_, Job>(
            r#"
            SELECT
                id,
                topic,
                payload,
                scheduled_at,
                retry_count,
                max_retries
            FROM "ethoko_job"
            WHERE dead = TRUE
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|e| anyhow::anyhow!(e).context("failed to fetch dead jobs from psql queue"))?;

        Ok(jobs)
    }
}
