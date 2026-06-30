use chrono::{TimeDelta, Utc};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};
use tracing::{debug, info, warn};

use crate::jobs::{
    job::Job,
    queue::QueueError,
    queue::{Queue, QueueInspector},
};

#[derive(Debug, Clone)]
/// An in-memory queue for jobs
/// It defines three hash maps protected by Mutext for storing the jobs in their different states
/// `idle_jobs` contain jobs waiting to be ready,
/// `ready_jobs` contain jobs ready to be picked,
/// `processing_jobs` contain jobs that have been picked and in process,
/// `dead_jobs` contain jobs that have failed too many times and are considered dead
///
/// Because of locking constraints in multi-threaded environments, a consistent order for the lock MUST be applied:
/// 1. idle_jobs,
/// 2. ready_jobs,
/// 3. processing_jobs,
/// 4. dead_jobs.
pub struct InMemoryQueue {
    retry_delay_seconds: i64,
    idle_jobs: Arc<Mutex<HashMap<uuid::Uuid, Job>>>,
    ready_jobs: Arc<Mutex<HashMap<uuid::Uuid, Job>>>,
    processing_jobs: Arc<Mutex<HashMap<uuid::Uuid, Job>>>,
    dead_jobs: Arc<Mutex<HashMap<uuid::Uuid, Job>>>,
}
impl InMemoryQueue {
    pub fn new(retry_delay_seconds: i64) -> Self {
        Self {
            retry_delay_seconds,
            idle_jobs: Arc::new(Mutex::new(HashMap::new())),
            ready_jobs: Arc::new(Mutex::new(HashMap::new())),
            processing_jobs: Arc::new(Mutex::new(HashMap::new())),
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
        let mut idle_jobs = self.idle_jobs.lock().map_err(|e| {
            anyhow::anyhow!("{e}").context("failed to aquire idle_jobs lock during dequeue")
        })?;
        let mut ready_jobs = self.ready_jobs.lock().map_err(|e| {
            anyhow::anyhow!("{e}").context("failed to aquire ready_jobs lock during dequeue")
        })?;
        let mut processing_jobs = self.processing_jobs.lock().map_err(|e| {
            anyhow::anyhow!("{e}").context("failed to aquire processing_jobs lock during dequeue")
        })?;
        let mut dead_jobs = self.dead_jobs.lock().map_err(|e| {
            anyhow::anyhow!("{e}").context("failed to aquire dead_jobs lock during dequeue")
        })?;
        let now = Utc::now();

        // Moving timeout `processing` jobs from processing to `idle`
        let timeout_ids = processing_jobs
            .values()
            .filter(|j| j.processing_timeout_at.is_some_and(|t| now >= t))
            .map(|j| j.id)
            .collect::<Vec<uuid::Uuid>>();
        debug!(
            "moving {} timed out processing jobs to idle_jobs",
            timeout_ids.len()
        );
        for id in timeout_ids {
            let job = processing_jobs.remove(&id);
            if let Some(mut j) = job {
                if j.retry_count >= j.max_retries {
                    warn!(
                        "Job {} has timed out and has retried too much, ending up in DLQ",
                        j.id
                    );
                    dead_jobs.insert(id, j);
                } else {
                    warn!(
                        "Job {} has timed out and is scheduled for retry with retry #{}",
                        j.id, j.retry_count
                    );
                    let scheduled_at = j
                        .dequeued_at
                        .unwrap_or(Utc::now())
                        .checked_add_signed(chrono::Duration::seconds(self.retry_delay_seconds))
                        .ok_or_else(|| {
                            anyhow::anyhow!("failed to compute scheduled_at for retry")
                        })?;
                    j.scheduled_at = scheduled_at;
                    j.retry_count += 1;
                    j.dequeued_at = None;
                    j.processing_timeout_at = None;
                    idle_jobs.insert(id, j);
                }
            }
        }

        // Moving new ready jobs from `idle` to `ready`
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

        let dequeued_job = ready_jobs
            .values()
            .reduce(|acc, j| {
                if j.scheduled_at < acc.scheduled_at {
                    return j;
                }
                if j.scheduled_at == acc.scheduled_at && j.id > acc.id {
                    return j;
                }
                acc
            })
            .cloned();

        let mut dequeued_job = match dequeued_job {
            Some(j) => j,
            None => {
                return Ok(None);
            }
        };

        let _ = ready_jobs.remove(&dequeued_job.id).ok_or(anyhow::anyhow!(
            "failed to remove job to be processed from the ready_jobs"
        ))?;
        let processing_timeout_at = now
            .checked_add_signed(TimeDelta::seconds(
                dequeued_job.processing_timeout_seconds.into(),
            ))
            .ok_or(anyhow::anyhow!(
                "failed to obtain processing timeout datetime"
            ))?;
        dequeued_job.dequeued_at = Some(now);
        dequeued_job.processing_timeout_at = Some(processing_timeout_at);
        processing_jobs.insert(dequeued_job.id, dequeued_job.clone());

        Ok(Some(dequeued_job))
    }

    async fn success(&self, id: uuid::Uuid) -> Result<(), QueueError> {
        let mut processing_jobs = self.processing_jobs.lock().map_err(|e| {
            anyhow::anyhow!("{e}").context("failed to aquire processing_jobs lock during dequeue")
        })?;
        let _successfull_job = processing_jobs
            .remove(&id)
            .ok_or_else(|| anyhow::anyhow!("Job {id} not found"))?;

        info!("Job {id} successfully handled");
        Ok(())
    }

    async fn fail(&self, id: uuid::Uuid) -> Result<(), QueueError> {
        let mut idle_jobs = self.idle_jobs.lock().map_err(|e| {
            anyhow::anyhow!("{e}").context("failed to aquire idle_jobs lock during dequeue")
        })?;

        let mut processing_jobs = self.processing_jobs.lock().map_err(|e| {
            anyhow::anyhow!("{e}").context("failed to aquire processing_jobs lock during dequeue")
        })?;

        let mut job = processing_jobs
            .remove(&id)
            .ok_or_else(|| anyhow::anyhow!("job {id} not found"))?;

        if job.retry_count >= job.max_retries {
            warn!("Job {} has retried too much, ending up in DLQ", job.id);
            let mut dead_jobs = self.dead_jobs.lock().map_err(|e| {
                anyhow::anyhow!("{e}").context("failed to aquire idle_jobs lock during dequeue")
            })?;
            dead_jobs.insert(id, job);
        } else {
            warn!(
                "Job {} scheduled for retry with retry #{}",
                job.id, job.retry_count
            );
            let scheduled_at = job
                .dequeued_at
                .unwrap_or(Utc::now())
                .checked_add_signed(chrono::Duration::seconds(self.retry_delay_seconds))
                .ok_or_else(|| anyhow::anyhow!("failed to compute scheduled_at for retry"))?;
            job.scheduled_at = scheduled_at;
            job.retry_count += 1;
            job.dequeued_at = None;
            job.processing_timeout_at = None;

            idle_jobs.insert(id, job);
        }

        Ok(())
    }

    async fn retry(&self, id: uuid::Uuid) -> Result<(), QueueError> {
        let mut ready_jobs = self.ready_jobs.lock().map_err(|e| {
            anyhow::anyhow!("{e}").context("failed to aquire ready_jobs lock during dequeue")
        })?;
        let mut dead_jobs = self.dead_jobs.lock().map_err(|e| {
            anyhow::anyhow!("{e}").context("failed to aquire dead_jobs lock during dequeue")
        })?;
        let mut job = dead_jobs
            .remove(&id)
            .ok_or_else(|| anyhow::anyhow!("job {id} not found"))?;
        job.scheduled_at = Utc::now();
        job.retry_count = 0;
        job.dequeued_at = None;
        job.processing_timeout_at = None;
        info!("Job {} retried from DLQ", job.id);
        ready_jobs.insert(id, job);
        Ok(())
    }
}

#[async_trait::async_trait]
impl QueueInspector for InMemoryQueue {
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
