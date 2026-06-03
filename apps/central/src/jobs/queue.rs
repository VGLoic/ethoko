use chrono::Utc;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};
use thiserror::Error;
use tracing::{debug, info, warn};

use crate::jobs::job::Job;

// NEXT STEPS:
// - fit in existing codebase --> check
// - define job payload --> check
// - handle testing --> check
// - work on job structure --> check
// - update logging --> check
// - add a series of test --> check
// - add a version with database
// - add ADR
// - PR

#[async_trait::async_trait]
pub trait Queue: Send + Sync + 'static {
    /// Enqueue a job
    async fn enqueue(&self, job: Job) -> Result<(), QueueError>;
    /// Dequeue a job if any
    async fn dequeue(&self) -> Result<Option<Job>, QueueError>;
    /// Register success for a processing job
    async fn success(&self, id: uuid::Uuid) -> Result<(), QueueError>;
    /// Register failure for a processing job
    /// Job is retried if it has not reached its max retries
    /// Else, job is put in the DLQ
    async fn fail(&self, id: uuid::Uuid) -> Result<(), QueueError>;
    /// Retry job from DLQ
    /// Job is moved from DLQ to ready_jobs
    async fn retry(&self, id: uuid::Uuid) -> Result<(), QueueError>;
    /// Get idle jobs
    async fn idle_jobs(&self) -> Result<Vec<Job>, QueueError>;
    /// Get ready jobs
    async fn ready_jobs(&self) -> Result<Vec<Job>, QueueError>;
    /// Get dead jobs
    async fn dead_jobs(&self) -> Result<Vec<Job>, QueueError>;
}

#[derive(Debug, Error)]
pub enum QueueError {
    #[error(transparent)]
    Unknown(#[from] anyhow::Error),
}

#[derive(Debug, Clone)]
pub struct InMemoryQueue {
    retry_delay_seconds: i64,
    idle_jobs: Arc<Mutex<HashMap<uuid::Uuid, Job>>>,
    ready_jobs: Arc<Mutex<HashMap<uuid::Uuid, Job>>>,
    dead_jobs: Arc<Mutex<HashMap<uuid::Uuid, Job>>>,
}
impl InMemoryQueue {
    pub fn new(retry_delay_seconds: i64) -> Self {
        Self {
            retry_delay_seconds,
            idle_jobs: Arc::new(Mutex::new(HashMap::new())),
            ready_jobs: Arc::new(Mutex::new(HashMap::new())),
            dead_jobs: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

#[async_trait::async_trait]
impl Queue for InMemoryQueue {
    async fn enqueue(&self, job: Job) -> Result<(), QueueError> {
        let mut idle_jobs = self.idle_jobs.lock().map_err(|e| {
            anyhow::anyhow!("{e}").context("failed to aquire idle_jobs lock during enqueue")
        })?;
        debug!("Job {} enqueued", job.id);
        idle_jobs.insert(job.id, job);

        Ok(())
    }

    async fn dequeue(&self) -> Result<Option<Job>, QueueError> {
        let mut ready_jobs = self.ready_jobs.lock().map_err(|e| {
            anyhow::anyhow!("{e}").context("failed to aquire ready_jobs lock during dequeue")
        })?;
        let mut idle_jobs = self.idle_jobs.lock().map_err(|e| {
            anyhow::anyhow!("{e}").context("failed to aquire idle_jobs lock during dequeue")
        })?;
        let now = Utc::now();
        let new_ready_ids = idle_jobs
            .values()
            .filter(|j| j.scheduled_at < now)
            .map(|j| j.id)
            .collect::<Vec<uuid::Uuid>>();
        debug!("moving {} jobs to ready_jobs", new_ready_ids.len());
        for id in new_ready_ids {
            let job = idle_jobs.remove(&id);
            if let Some(j) = job {
                ready_jobs.insert(id, j);
            }
        }
        Ok(ready_jobs
            .values()
            .take(1)
            .collect::<Vec<&Job>>()
            .pop()
            .cloned())
    }

    async fn success(&self, id: uuid::Uuid) -> Result<(), QueueError> {
        let mut ready_jobs = self.ready_jobs.lock().map_err(|e| {
            anyhow::anyhow!("{e}").context("failed to aquire ready_jobs lock during dequeue")
        })?;
        let _successfull_job = ready_jobs
            .remove(&id)
            .ok_or_else(|| anyhow::anyhow!("Job {id} not found"))?;

        info!("Job {id} successfully handled");
        Ok(())
    }

    async fn fail(&self, id: uuid::Uuid) -> Result<(), QueueError> {
        let mut ready_jobs = self.ready_jobs.lock().map_err(|e| {
            anyhow::anyhow!("{e}").context("failed to aquire ready_jobs lock during dequeue")
        })?;

        let mut job = ready_jobs
            .remove(&id)
            .ok_or_else(|| anyhow::anyhow!("job {id} not found"))?;

        if job.retries >= job.max_retries {
            warn!("Job {} has retried too much, ending up in DLQ", job.id);
            let mut dead_jobs = self.dead_jobs.lock().map_err(|e| {
                anyhow::anyhow!("{e}").context("failed to aquire idle_jobs lock during dequeue")
            })?;
            dead_jobs.insert(id, job);
        } else {
            warn!(
                "Job {} scheduled for retry with retry #{}",
                job.id, job.retries
            );
            let scheduled_at = Utc::now()
                .checked_add_signed(chrono::Duration::seconds(self.retry_delay_seconds))
                .ok_or_else(|| anyhow::anyhow!("failed to compute scheduled_at for retry"))?;
            job.schedule_retry(scheduled_at);

            let mut idle_jobs = self.idle_jobs.lock().map_err(|e| {
                anyhow::anyhow!("{e}").context("failed to aquire idle_jobs lock during dequeue")
            })?;

            idle_jobs.insert(id, job);
        }

        Ok(())
    }

    async fn retry(&self, id: uuid::Uuid) -> Result<(), QueueError> {
        let mut dead_jobs = self.dead_jobs.lock().map_err(|e| {
            anyhow::anyhow!("{e}").context("failed to aquire dead_jobs lock during dequeue")
        })?;
        let mut job = dead_jobs
            .remove(&id)
            .ok_or_else(|| anyhow::anyhow!("job {id} not found"))?;
        job.reset_retries();
        let mut ready_jobs = self.ready_jobs.lock().map_err(|e| {
            anyhow::anyhow!("{e}").context("failed to aquire ready_jobs lock during dequeue")
        })?;
        info!("Job {} retried from DLQ", job.id);
        ready_jobs.insert(id, job);
        Ok(())
    }

    async fn idle_jobs(&self) -> Result<Vec<Job>, QueueError> {
        let idle_jobs = self.idle_jobs.lock().map_err(|e| {
            anyhow::anyhow!("{e}").context("failed to aquire idle_jobs lock during dequeue")
        })?;
        Ok(idle_jobs.values().cloned().collect())
    }

    async fn ready_jobs(&self) -> Result<Vec<Job>, QueueError> {
        let ready_jobs = self.ready_jobs.lock().map_err(|e| {
            anyhow::anyhow!("{e}").context("failed to aquire ready_jobs lock during dequeue")
        })?;
        Ok(ready_jobs.values().cloned().collect())
    }

    async fn dead_jobs(&self) -> Result<Vec<Job>, QueueError> {
        let dead_jobs = self.dead_jobs.lock().map_err(|e| {
            anyhow::anyhow!("{e}").context("failed to aquire dead_jobs lock during dequeue")
        })?;
        Ok(dead_jobs.values().cloned().collect())
    }
}
