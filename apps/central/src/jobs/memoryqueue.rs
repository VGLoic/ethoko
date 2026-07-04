use chrono::{TimeDelta, Utc};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};
use tracing::{debug, info, warn};

use crate::jobs::{
    job::{Job, JobRequest, JobStatus},
    queue::{Queue, QueueError, QueueInspector},
};

#[derive(Debug, Clone)]
/// An in-memory queue for jobs
/// It defines a hash map protected by Mutext for storing the jobs in their different states: pending, processing, successful or dead.
pub struct InMemoryQueue {
    retry_delay_seconds: u16,
    jobs: Arc<Mutex<HashMap<uuid::Uuid, Job>>>,
}
impl InMemoryQueue {
    pub fn new(retry_delay_seconds: u16) -> Self {
        Self {
            retry_delay_seconds,
            jobs: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

impl From<JobRequest> for Job {
    fn from(value: JobRequest) -> Self {
        Job {
            id: uuid::Uuid::new_v4(),
            topic: value.topic,
            payload: value.payload,
            status: JobStatus::Pending,
            processing_timeout_seconds: value.processing_timeout_seconds,
            scheduled_at: value.scheduled_at,
            dequeued_at: None,
            processing_timeout_at: None,
            retry_count: 0.into(),
            max_retries: value.max_retries,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }
}

#[async_trait::async_trait]
impl Queue for InMemoryQueue {
    async fn enqueue(&self, job_request: JobRequest) -> Result<Job, QueueError> {
        let mut jobs = self.jobs.lock().map_err(|e| {
            anyhow::anyhow!("{e}").context("failed to acquire jobs lock during enqueue")
        })?;
        let job = Job::from(job_request);
        debug!("Job {} enqueued", job.id);
        jobs.insert(job.id, job.clone());

        Ok(job)
    }

    async fn dequeue(&self) -> Result<Option<Job>, QueueError> {
        let mut jobs = self.jobs.lock().map_err(|e| {
            anyhow::anyhow!("{e}").context("failed to acquire jobs lock during dequeue")
        })?;
        let now = Utc::now();

        let dequeued_job_id = jobs
            .values()
            .filter(|j| j.status == JobStatus::Pending && j.scheduled_at <= Utc::now())
            .reduce(|acc, j| {
                if j.scheduled_at < acc.scheduled_at {
                    return j;
                }
                if j.scheduled_at == acc.scheduled_at && j.id > acc.id {
                    return j;
                }
                acc
            })
            .map(|j| j.id);

        let dequeued_job = match dequeued_job_id.and_then(|id| jobs.get_mut(&id)) {
            Some(j) => j,
            None => {
                return Ok(None);
            }
        };

        let processing_timeout_at = now
            .checked_add_signed(TimeDelta::seconds(
                dequeued_job.processing_timeout_seconds.into(),
            ))
            .ok_or(anyhow::anyhow!(
                "failed to obtain processing timeout datetime"
            ))?;
        dequeued_job.dequeued_at = Some(now);
        dequeued_job.processing_timeout_at = Some(processing_timeout_at);
        dequeued_job.status = JobStatus::Processing;
        dequeued_job.updated_at = Utc::now();

        Ok(Some(dequeued_job.clone()))
    }

    async fn success(&self, id: uuid::Uuid) -> Result<(), QueueError> {
        let mut jobs = self.jobs.lock().map_err(|e| {
            anyhow::anyhow!("{e}").context("failed to acquire jobs lock during dequeue")
        })?;
        let successful_job = jobs
            .get_mut(&id)
            .ok_or_else(|| anyhow::anyhow!("Job {id} not found"))?;
        if successful_job.status != JobStatus::Processing {
            return Err(anyhow::anyhow!(
                "Job {id} is not in processing state, cannot mark as success"
            )
            .into());
        }
        successful_job.status = JobStatus::Successful;
        successful_job.updated_at = Utc::now();

        info!("Job {id} successfully handled");
        Ok(())
    }

    async fn fail(&self, id: uuid::Uuid) -> Result<(), QueueError> {
        let mut jobs = self.jobs.lock().map_err(|e| {
            anyhow::anyhow!("{e}").context("failed to acquire jobs lock during dequeue")
        })?;

        let job = jobs
            .get_mut(&id)
            .ok_or_else(|| anyhow::anyhow!("job {id} not found"))?;

        if job.status != JobStatus::Processing {
            return Err(anyhow::anyhow!(
                "Job {id} is not in processing state, cannot mark as failed"
            )
            .into());
        }

        if job.retry_count >= job.max_retries {
            warn!("Job {} has retried too much, ending up in DLQ", job.id);
            job.status = JobStatus::Dead;
            job.updated_at = Utc::now();
        } else {
            warn!(
                "Job {} scheduled for retry with retry #{}",
                job.id, job.retry_count
            );
            let scheduled_at = job
                .dequeued_at
                .unwrap_or(Utc::now())
                .checked_add_signed(chrono::Duration::seconds(self.retry_delay_seconds.into()))
                .ok_or_else(|| anyhow::anyhow!("failed to compute scheduled_at for retry"))?;
            job.scheduled_at = scheduled_at;
            job.retry_count += 1;
            job.dequeued_at = None;
            job.processing_timeout_at = None;
            job.status = JobStatus::Pending;
            job.updated_at = Utc::now();
        }

        Ok(())
    }

    async fn retry(&self, id: uuid::Uuid) -> Result<(), QueueError> {
        let mut jobs = self.jobs.lock().map_err(|e| {
            anyhow::anyhow!("{e}").context("failed to acquire jobs lock during dequeue")
        })?;
        let job = jobs
            .get_mut(&id)
            .ok_or_else(|| anyhow::anyhow!("job {id} not found"))?;
        if job.status != JobStatus::Dead {
            return Err(anyhow::anyhow!("Job {id} is not in dead state, cannot retry").into());
        }
        job.scheduled_at = Utc::now();
        job.retry_count = 0.into();
        job.dequeued_at = None;
        job.processing_timeout_at = None;
        job.status = JobStatus::Pending;
        job.updated_at = Utc::now();
        info!("Job {} retried from DLQ", job.id);
        Ok(())
    }

    async fn cleanup_timeout_jobs(&self) -> Result<(), QueueError> {
        let mut jobs = self.jobs.lock().map_err(|e| {
            anyhow::anyhow!("{e}").context("failed to acquire jobs lock during dequeue")
        })?;
        let now = Utc::now();

        // Moving timeout `processing` jobs from processing to `pending`
        let timeout_ids = jobs
            .values()
            .filter(|j| {
                j.status == JobStatus::Processing
                    && j.processing_timeout_at.is_some_and(|t| now >= t)
            })
            .map(|j| j.id)
            .collect::<Vec<uuid::Uuid>>();
        debug!(
            "moving {} timed out processing jobs to pending_jobs",
            timeout_ids.len()
        );
        for id in timeout_ids {
            let job = jobs.get_mut(&id);
            if let Some(j) = job {
                if j.retry_count >= j.max_retries {
                    warn!(
                        "Job {} has timed out and has retried too much, ending up in DLQ",
                        j.id
                    );
                    j.status = JobStatus::Dead;
                    j.updated_at = Utc::now();
                } else {
                    warn!(
                        "Job {} has timed out and is scheduled for retry with retry #{}",
                        j.id, j.retry_count
                    );
                    let scheduled_at = j
                        .dequeued_at
                        .unwrap_or(Utc::now())
                        .checked_add_signed(chrono::Duration::seconds(
                            self.retry_delay_seconds.into(),
                        ))
                        .ok_or_else(|| {
                            anyhow::anyhow!("failed to compute scheduled_at for retry")
                        })?;
                    j.scheduled_at = scheduled_at;
                    j.retry_count += 1;
                    j.dequeued_at = None;
                    j.processing_timeout_at = None;
                    j.status = JobStatus::Pending;
                    j.updated_at = Utc::now();
                }
            }
        }
        Ok(())
    }
}

#[async_trait::async_trait]
impl QueueInspector for InMemoryQueue {
    async fn pending_jobs(&self) -> Result<Vec<Job>, QueueError> {
        let jobs = self.jobs.lock().map_err(|e| {
            anyhow::anyhow!("{e}").context("failed to acquire jobs lock during dequeue")
        })?;
        Ok(jobs
            .values()
            .filter(|j| j.status == JobStatus::Pending)
            .cloned()
            .collect())
    }

    async fn processing_jobs(&self) -> Result<Vec<Job>, QueueError> {
        let jobs = self.jobs.lock().map_err(|e| {
            anyhow::anyhow!("{e}").context("failed to acquire jobs lock during dequeue")
        })?;
        Ok(jobs
            .values()
            .filter(|j| j.status == JobStatus::Processing)
            .cloned()
            .collect())
    }

    async fn successful_jobs(&self) -> Result<Vec<Job>, QueueError> {
        let jobs = self.jobs.lock().map_err(|e| {
            anyhow::anyhow!("{e}").context("failed to acquire jobs lock during dequeue")
        })?;
        Ok(jobs
            .values()
            .filter(|j| j.status == JobStatus::Successful)
            .cloned()
            .collect())
    }

    async fn dead_jobs(&self) -> Result<Vec<Job>, QueueError> {
        let jobs = self.jobs.lock().map_err(|e| {
            anyhow::anyhow!("{e}").context("failed to acquire jobs lock during dequeue")
        })?;
        Ok(jobs
            .values()
            .filter(|j| j.status == JobStatus::Dead)
            .cloned()
            .collect())
    }
}
