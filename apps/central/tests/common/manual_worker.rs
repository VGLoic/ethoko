use tracing::error;

use ethoko_central::jobs::{processor::JobProcessor, queue::Queue};

#[allow(dead_code)]
pub struct ManualWorker<Q: Queue, Processor: JobProcessor> {
    queue: Q,
    processor: Processor,
}

#[allow(dead_code)]
impl<Q: Queue, Processor: JobProcessor> ManualWorker<Q, Processor> {
    pub fn new(queue: Q, processor: Processor) -> Self {
        Self { queue, processor }
    }

    pub async fn consume_jobs(&self) -> Result<(), anyhow::Error> {
        while let Some(job) = self.queue.dequeue().await? {
            match self.processor.process_job(&job).await {
                Ok(()) => {
                    if let Err(e) = self.queue.success(job.id).await {
                        error!("Failed to register success for job {}: {e:?}", job.id);
                    }
                }
                Err(_e) => {
                    if let Err(e) = self.queue.fail(job.id).await {
                        error!("Failed to register failure for job: {:?}: {e:?}", job.id);
                    }
                }
            }
        }
        Ok(())
    }
}
