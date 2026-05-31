use std::sync::{Arc, Mutex};

use ethoko_central::{
    jobs::{job::Job, worker::JobProcessor},
    newtypes::{email::Email, handle::Handle},
    users::notifier::jobs::UsersJob,
};

#[derive(Clone, Debug)]
pub struct FakeUserJobProcessor {
    dummy_job_users: Arc<Mutex<Vec<(uuid::Uuid, Email, Handle)>>>,
}

impl Default for FakeUserJobProcessor {
    fn default() -> Self {
        Self {
            dummy_job_users: Arc::new(Mutex::new(vec![])),
        }
    }
}

#[async_trait::async_trait]
#[async_trait::async_trait]
impl JobProcessor for FakeUserJobProcessor {
    async fn process_job(&self, job: &Job) -> Result<(), anyhow::Error> {
        let payload: UsersJob = serde_json::from_str(&job.payload).map_err(|e| {
            anyhow::Error::new(e).context("failed to deserialized users job payload")
        })?;

        match payload {
            UsersJob::DummyJob(p) => {
                self.dummy_job_users
                    .lock()
                    .unwrap()
                    .push((p.user_id, p.user_email, p.user_handle));
                Ok(())
            }
        }
    }
}

impl FakeUserJobProcessor {
    #[allow(dead_code)]
    pub fn has_email(&self, email: &Email) -> bool {
        self.dummy_job_users
            .lock()
            .unwrap()
            .iter()
            .any(|u| &u.1 == email)
    }
}
