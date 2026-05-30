use std::time::Duration;
use tokio::time::sleep;
use tokio_util::sync::CancellationToken;
use tracing::{debug, error, info};

use crate::jobs::{
    job::{Job, JobPayload},
    queue::Queue,
};

pub struct Worker<Q: Queue> {
    queue: Q,
    cancellation_token: CancellationToken,
    polling_interval_milliseconds: u64,
}

impl<Q: Queue> Worker<Q> {
    pub fn new(
        queue: Q,
        cancellation_token: CancellationToken,
        polling_interval_milliseconds: u64,
    ) -> Self {
        Worker {
            queue,
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
                    match process_job(&job).await {
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

async fn process_job(job: &Job) -> Result<(), anyhow::Error> {
    sleep(Duration::from_millis(250)).await;

    match job.payload {
        JobPayload::Bob => {
            info!("dealing with Bob");
            Ok(())
        }
        JobPayload::Jack => {
            info!("dealing with Jack");
            Ok(())
        }
        JobPayload::Roger => {
            info!("dealing with Jack");
            Ok(())
        }
    }
}
