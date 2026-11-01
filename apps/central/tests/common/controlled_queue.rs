use ethoko_central::jobs::{
    job::{Job, JobRequest},
    memoryqueue::InMemoryQueue,
    queue::{Queue, QueueError},
};
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

#[derive(Clone)]
pub struct ControlledQueue {
    pub inner: InMemoryQueue,
    pub fail_enqueue: Arc<AtomicBool>,
}

impl ControlledQueue {
    pub fn new() -> Self {
        Self {
            inner: InMemoryQueue::new(2),
            fail_enqueue: Arc::new(AtomicBool::new(false)),
        }
    }
}

#[async_trait::async_trait]
impl Queue for ControlledQueue {
    async fn enqueue(&self, job: JobRequest) -> Result<Job, QueueError> {
        if self.fail_enqueue.load(Ordering::SeqCst) {
            return Err(anyhow::anyhow!("injected enqueue failure").into());
        }
        self.inner.enqueue(job).await
    }
    async fn dequeue(&self) -> Result<Option<Job>, QueueError> {
        self.inner.dequeue().await
    }
    async fn success(&self, id: uuid::Uuid) -> Result<(), QueueError> {
        self.inner.success(id).await
    }
    async fn fail(&self, id: uuid::Uuid) -> Result<(), QueueError> {
        self.inner.fail(id).await
    }
    async fn retry(&self, id: uuid::Uuid) -> Result<(), QueueError> {
        self.inner.retry(id).await
    }
    async fn cleanup_timeout_jobs(&self) -> Result<(), QueueError> {
        self.inner.cleanup_timeout_jobs().await
    }
}
