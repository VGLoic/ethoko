use std::time::Duration;
use tokio::time::sleep;
use tokio_util::sync::CancellationToken;
use tracing::{debug, error, info, info_span};

use crate::{
    jobs::{processor::JobProcessor, queue::Queue},
    operational_tracing::{error_chain, error_classification},
};

pub struct Worker<Q: Queue, Processor: JobProcessor> {
    queue: Q,
    processor: Processor,
    polling_interval_milliseconds: u64,
}

impl<Q: Queue, Processor: JobProcessor> Worker<Q, Processor> {
    pub fn new(queue: Q, processor: Processor, polling_interval_milliseconds: u64) -> Self {
        Worker {
            queue,
            processor,
            polling_interval_milliseconds,
        }
    }

    pub async fn run(&self, cancellation_token: CancellationToken) -> Result<(), anyhow::Error> {
        loop {
            if cancellation_token.is_cancelled() {
                debug!(
                    event = "jobs.worker.stopping",
                    "Received instruction to stop worker loop"
                );
                break;
            }
            match self.queue.dequeue().await {
                Ok(Some(job)) => {
                    let span = info_span!(
                        "job_processing_attempt",
                        job_id = %job.id,
                        topic = %job.topic,
                        attempt = %job.retry_count,
                    );

                    tokio::select! {
                        process_result = async {
                            let _entered = span.enter();
                            self.processor.process_job(&job).await
                        } => {
                            match process_result {
                                Ok(()) => {
                                    if let Err(e) = self.queue.success(job.id).await {
                                        let err: anyhow::Error = e.into();
                                        error!(
                                            event = "jobs.processing.outcome_registration_failed",
                                            job_id = %job.id,
                                            topic = %job.topic,
                                            outcome = "success",
                                            error_class = error_classification(&err),
                                            error_chain = %error_chain(&err),
                                            "Failed to register successful job outcome"
                                        );
                                    }
                                    debug!(
                                        event = "jobs.processing.succeeded",
                                        job_id = %job.id,
                                        topic = %job.topic,
                                        "Successfully processed job"
                                    );
                                }
                                Err(process_e) => {
                                    if let Err(e) = self.queue.fail(job.id).await {
                                        let err: anyhow::Error = e.into();
                                        error!(
                                            event = "jobs.processing.outcome_registration_failed",
                                            job_id = %job.id,
                                            topic = %job.topic,
                                            outcome = "failure",
                                            error_class = error_classification(&err),
                                            error_chain = %error_chain(&err),
                                            "Failed to register failed job outcome"
                                        );
                                    }
                                    error!(
                                        event = "jobs.processing.failed",
                                        job_id = %job.id,
                                        topic = %job.topic,
                                        error_class = error_classification(&process_e),
                                        error_chain = %error_chain(&process_e),
                                        "Job processing failed"
                                    );

                                }
                            }
                        }
                        _ = sleep(Duration::from_secs(job.processing_timeout_seconds.into())) => {
                            error!(
                                event = "jobs.processing.timed_out",
                                job_id = %job.id,
                                topic = %job.topic,
                                timeout_seconds = %job.processing_timeout_seconds,
                                "Job processing timed out"
                            );
                        }
                        _ = cancellation_token.cancelled() => {
                            info!(
                                event = "jobs.processing.cancelled",
                                job_id = %job.id,
                                topic = %job.topic,
                                "Worker received stop signal during job processing"
                            );
                            break;
                        }
                    }
                }
                Ok(None) => {
                    sleep(Duration::from_millis(self.polling_interval_milliseconds)).await;
                }
                Err(e) => {
                    let err: anyhow::Error = e.into();
                    error!(
                        event = "jobs.dequeue.failed",
                        error_class = error_classification(&err),
                        error_chain = %error_chain(&err),
                        "Failed to dequeue job"
                    );
                }
            }
        }
        info!(event = "jobs.worker.stopped", "Worker loop exited");
        Ok(())
    }
}
