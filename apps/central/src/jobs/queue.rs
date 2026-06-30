use thiserror::Error;

use crate::jobs::job::{Job, JobRequest};

// REMIND ME:
// With the current design, we don't support concurrent workers. In order to do so, we need to introduce the notion of `processing`.
// A job given by the `dequeue` should be considered processing, another `dequeue` call would give another job.
// It introduces an issue which is: in case of issue in the worker, not calling `fail` or `success`, we are not stuck with a job in `processing`.
// Ways to solve this:
//  - in PSQL, we can manage all this with a transaction, see https://www.netdata.cloud/academy/update-skip-locked/. It is not clear however how we would implement it with a memory queue.
//  - introducing a timeout for the processing jobs, reverting them to pending after a particular amount of time.
//
// Important considerations:
// - we need to add the tests first -> done unless for
// - we could introduce a ProcessingJob struct that would host the `success` or `fail` methods, it would be needed for the PSQL transaction approach

#[async_trait::async_trait]
/// Trait for async work queue allowing for at least once processing.
///
/// A job lifecycle is as follows:
/// 1. using `enequeue`, a job is enqueued with a specified scheduling time,
/// 2. later on, a worker will call `dequeue`, getting the first ready to be picked up job,
/// 3. the worker is in charge of registering processing success or failure using the methods `success` or `fail`.
///
/// If a job has failed too many times, it is considered `dead` and can be manually retried using the `retry` method.
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
