use tracing::warn;

use crate::jobs::job::{Job, Topic};

#[async_trait::async_trait]
pub trait JobProcessor: Send + Sync + 'static {
    /// Process a job
    /// # Errors
    /// A `anyhow::Error` is returned when failed to process the job. Job will be retried according to its configuration.
    async fn process_job(&self, job: &Job) -> Result<(), anyhow::Error>;
}

pub struct RootProcessor<P: JobProcessor> {
    users_processor: Option<P>,
}
impl<P: JobProcessor> RootProcessor<P> {
    pub fn new(users_processor: Option<P>) -> Self {
        Self { users_processor }
    }
}

#[async_trait::async_trait]
impl<P: JobProcessor> JobProcessor for RootProcessor<P> {
    async fn process_job(&self, job: &Job) -> Result<(), anyhow::Error> {
        match job.topic {
            Topic::Users => {
                if let Some(processor) = &self.users_processor {
                    processor.process_job(job).await
                } else {
                    warn!("Received job for users topic, but no processor is configured");
                    Ok(())
                }
            }
        }
    }
}
