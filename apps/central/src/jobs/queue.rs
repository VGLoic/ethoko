use thiserror::Error;

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
