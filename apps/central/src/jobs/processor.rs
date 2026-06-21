use crate::jobs::job::Job;

#[async_trait::async_trait]
pub trait JobProcessor: Send + Sync + 'static {
    /// Process a job
    /// # Errors
    /// A `anyhow::Error` is returned when failed to process the job. Job will be retried according to its configuration.
    async fn process_job(&self, job: &Job) -> Result<(), anyhow::Error>;
}
