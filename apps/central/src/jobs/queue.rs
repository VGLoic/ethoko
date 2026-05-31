use chrono::Utc;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};
use thiserror::Error;

use crate::jobs::job::Job;

// NEXT STEPS:
// - fit in existing codebase --> check
// - define job payload --> check
// - handle testing
// - work on job structure
// - update logging
// - use database for jobs

pub trait Queue: Send + Sync + 'static {
    /// Enqueue a job
    fn enqueue(&self, job: Job) -> Result<(), QueueError>;
    /// Dequeue a job if any
    fn dequeue(&self) -> Result<Option<Job>, QueueError>;
    /// Register success for a processing job
    fn success(&self, id: uuid::Uuid) -> Result<(), QueueError>;
    /// Register failure for a processing job
    /// Job is retried if it has not reached its max retries
    /// Else, job is put in the DLQ
    fn fail(&self, id: uuid::Uuid) -> Result<(), QueueError>;
    /// Retry job from DLQ
    /// Job is moved from DLQ to ready_jobs
    fn retry(&self, id: uuid::Uuid) -> Result<(), QueueError>;
    /// Get jobs in DLQ
    fn dlq_jobs(&self) -> Result<Vec<Job>, QueueError>;
}

#[derive(Debug, Error)]
pub enum QueueError {
    #[error(transparent)]
    Unknown(#[from] anyhow::Error),
}

#[derive(Debug, Clone)]
pub struct InMemoryQueue {
    idle_jobs: Arc<Mutex<HashMap<uuid::Uuid, Job>>>,
    ready_jobs: Arc<Mutex<HashMap<uuid::Uuid, Job>>>,
    dead_jobs: Arc<Mutex<HashMap<uuid::Uuid, Job>>>,
}

impl Default for InMemoryQueue {
    fn default() -> Self {
        Self {
            idle_jobs: Arc::new(Mutex::new(HashMap::new())),
            ready_jobs: Arc::new(Mutex::new(HashMap::new())),
            dead_jobs: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

impl Queue for InMemoryQueue {
    fn enqueue(&self, job: Job) -> Result<(), QueueError> {
        let mut idle_jobs = self.idle_jobs.lock().map_err(|e| {
            anyhow::anyhow!("{e}").context("failed to aquire idle_jobs lock during enqueue")
        })?;
        idle_jobs.insert(job.id, job);

        Ok(())
    }

    fn dequeue(&self) -> Result<Option<Job>, QueueError> {
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

    fn success(&self, id: uuid::Uuid) -> Result<(), QueueError> {
        let mut ready_jobs = self.ready_jobs.lock().map_err(|e| {
            anyhow::anyhow!("{e}").context("failed to aquire ready_jobs lock during dequeue")
        })?;
        let _successfull_job = ready_jobs
            .remove(&id)
            .ok_or_else(|| anyhow::anyhow!("Job {id} not found"))?;

        println!("Job {id} successfully handled");
        Ok(())
    }

    fn fail(&self, id: uuid::Uuid) -> Result<(), QueueError> {
        let mut ready_jobs = self.ready_jobs.lock().map_err(|e| {
            anyhow::anyhow!("{e}").context("failed to aquire ready_jobs lock during dequeue")
        })?;

        let mut job = ready_jobs
            .remove(&id)
            .ok_or_else(|| anyhow::anyhow!("job {id} not found"))?;

        if job.retries >= job.max_retries {
            println!("Job {:?} has retried too much, ending up in DLQ", job.id);
            let mut dead_jobs = self.dead_jobs.lock().map_err(|e| {
                anyhow::anyhow!("{e}").context("failed to aquire idle_jobs lock during dequeue")
            })?;
            dead_jobs.insert(id, job);
        } else {
            println!(
                "Job {:?} scheduled for retry with retry #{}",
                job.id, job.retries
            );
            job.schedule_retry();

            let mut idle_jobs = self.idle_jobs.lock().map_err(|e| {
                anyhow::anyhow!("{e}").context("failed to aquire idle_jobs lock during dequeue")
            })?;

            idle_jobs.insert(id, job);
        }

        Ok(())
    }

    fn retry(&self, id: uuid::Uuid) -> Result<(), QueueError> {
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
        ready_jobs.insert(id, job);
        Ok(())
    }

    fn dlq_jobs(&self) -> Result<Vec<Job>, QueueError> {
        let dead_jobs = self.dead_jobs.lock().map_err(|e| {
            anyhow::anyhow!("{e}").context("failed to aquire dead_jobs lock during dequeue")
        })?;
        Ok(dead_jobs.values().cloned().collect())
    }
}
