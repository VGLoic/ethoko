use thiserror::Error;

use crate::jobs::job::{Job, JobRequest};

#[async_trait::async_trait]
/// Trait for async work queue allowing for at least once processing.
///
/// A job lifecycle is as follows:
/// 1. using `enequeue`, a job is enqueued as `pending` with a specified scheduling time,
/// 2. later on, a worker will call `dequeue`, getting the first ready to be picked up job. Job transitions to `processing` and the worker is in charge of processing it,
/// 3. once processing successes or fails, the worker is in charge of registering the result using the methods `success` or `fail`.
///    In case of success, the job transitions to `completed`.
///    In case of failure, the job transitions to `pending` if it has not reached its max retries, else it transitions to `dead`.
///
/// When a job is in `processing`, it has a timeout. If the worker does not register the result before the timeout, the job transitions back to `pending` or `dead depending on its retry count.
///
/// If a job is in `dead`, it can be retried using the `retry` method, which transitions it back to `pending`.
pub trait Queue: Send + Sync + 'static {
    /// Enqueue a job
    async fn enqueue(&self, job: JobRequest) -> Result<Job, QueueError>;
    /// Dequeue a job if any
    async fn dequeue(&self) -> Result<Option<Job>, QueueError>;
    /// Register success for a processing job
    async fn success(&self, id: uuid::Uuid) -> Result<(), QueueError>;
    /// Register failure for a processing job
    /// Job is retried if it has not reached its max retries
    /// Else, job is put in the DLQ
    async fn fail(&self, id: uuid::Uuid) -> Result<(), QueueError>;
    /// Retry a dead job
    /// Job is moved from dead jobs to ready jobs
    async fn retry(&self, id: uuid::Uuid) -> Result<(), QueueError>;
}

#[async_trait::async_trait]
/// Trait for inspecting the content of a job queue
pub trait QueueInspector: Send + Sync + 'static {
    /// Get pending jobs
    async fn pending_jobs(&self) -> Result<Vec<Job>, QueueError>;
    /// Get processing jobs
    async fn processing_jobs(&self) -> Result<Vec<Job>, QueueError>;
    /// Get dead jobs
    async fn dead_jobs(&self) -> Result<Vec<Job>, QueueError>;
    /// Get completed jobs
    async fn completed_jobs(&self) -> Result<Vec<Job>, QueueError>;
}

#[derive(Debug, Error)]
pub enum QueueError {
    #[error(transparent)]
    Unknown(#[from] anyhow::Error),
}
