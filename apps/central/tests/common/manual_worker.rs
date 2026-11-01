use tracing::{error, info};

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

    pub async fn process_job(
        &self,
        job: &ethoko_central::jobs::job::Job,
    ) -> Result<(), anyhow::Error> {
        self.processor.process_job(job).await
    }

    pub async fn consume_jobs(&self) -> Result<(), anyhow::Error> {
        while let Some(job) = self.queue.dequeue().await? {
            info!("Processing job: {:?}", job.id);
            match self.processor.process_job(&job).await {
                Ok(()) => {
                    if let Err(e) = self.queue.success(job.id).await {
                        error!("Failed to register success for job {}: {e:?}", job.id);
                    }
                    info!("Successfully processed job: {:?}", job.id);
                }
                Err(process_e) => {
                    if let Err(e) = self.queue.fail(job.id).await {
                        error!("Failed to register failure for job: {:?}: {e:?}", job.id);
                    }
                    error!("Failed to process job: {:?}: {process_e:?}", job.id);
                }
            }
        }
        Ok(())
    }
}
