use std::time::Duration;
use tokio::time::sleep;
use tokio_util::sync::CancellationToken;
use tracing::{debug, error, info};

use crate::jobs::{job::Job, queue::Queue};

#[async_trait::async_trait]
pub trait JobProcessor: Send + Sync + 'static {
    /// Process a job
    /// # Errors
    /// A `anyhow::Error` is returned when failed to process the job. Job will be retried according to its configuration.
    async fn process_job(&self, job: &Job) -> Result<(), anyhow::Error>;
}

pub struct Worker<Q: Queue, Processor: JobProcessor> {
    queue: Q,
    processor: Processor,
    cancellation_token: CancellationToken,
    polling_interval_milliseconds: u64,
}

impl<Q: Queue, Processor: JobProcessor> Worker<Q, Processor> {
    pub fn new(
        queue: Q,
        processor: Processor,
        cancellation_token: CancellationToken,
        polling_interval_milliseconds: u64,
    ) -> Self {
        Worker {
            queue,
            processor,
            cancellation_token,
            polling_interval_milliseconds,
        }
    }

    pub async fn run(&self) -> Result<(), anyhow::Error> {
        loop {
            if self.cancellation_token.is_cancelled() {
                debug!("Received instruction to close");
                break;
            }
            match self.queue.dequeue() {
                Ok(Some(job)) => {
                    info!("Processing job: {:?}", job.id);

                    match self.processor.process_job(&job).await {
                        Ok(()) => {
                            if let Err(e) = self.queue.success(job.id) {
                                error!("Failed to register success for job {}: {e:?}", job.id);
                            }
                        }
                        Err(_e) => {
                            if let Err(e) = self.queue.fail(job.id) {
                                error!("Failed to register failure for job: {:?}: {e:?}", job.id);
                            }
                        }
                    }
                }
                Ok(None) => {
                    sleep(Duration::from_millis(self.polling_interval_milliseconds)).await;
                }
                Err(e) => {
                    error!("Error while dealing with job: {e:?}");
                }
            }
        }
        debug!("Worker exiting the loop!");
        Ok(())
    }
}

// async fn process_job(job: &Job) -> Result<(), anyhow::Error> {
// sleep(Duration::from_millis(250)).await;

// match job.payload {
//     JobPayload::Bob => {
//         info!("dealing with Bob");
//         Ok(())
//     }
//     JobPayload::Jack => {
//         info!("dealing with Jack");
//         Ok(())
//     }
//     JobPayload::Roger => {
//         info!("dealing with Jack");
//         Ok(())
//     }
// }
// }
