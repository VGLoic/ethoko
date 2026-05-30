use std::time::Duration;

use tokio::time::sleep;

use crate::{
    jobs::{job::Job, worker::JobProcessor},
    users::notifier::jobs::UsersJob,
};

pub struct UsersJobProcessor;

#[async_trait::async_trait]
impl JobProcessor for UsersJobProcessor {
    async fn process_job(&self, job: &Job) -> Result<(), anyhow::Error> {
        sleep(Duration::from_millis(250)).await;

        let payload: UsersJob = serde_json::from_str(&job.payload).map_err(|e| {
            anyhow::Error::new(e).context("failed to deserialized users job payload")
        })?;

        match payload {
            UsersJob::DummyJob(p) => {
                println!("Got payload: {p:?}");
                Ok(())
            }
        }
    }
}
