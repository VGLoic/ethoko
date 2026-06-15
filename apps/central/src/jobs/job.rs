use super::topic::Topic;
use chrono::Utc;
use serde::{Serialize, de::DeserializeOwned};

#[derive(Debug, Clone)]
pub struct Job {
    pub id: uuid::Uuid,
    pub topic: Topic,
    pub payload: String,
    pub scheduled_at: chrono::DateTime<Utc>,
    pub retries: u8,
    pub max_retries: u8,
}

impl Job {
    pub fn new<Payload: Serialize + DeserializeOwned>(
        topic: Topic,
        payload: Payload,
    ) -> Result<Self, anyhow::Error> {
        let id = uuid::Uuid::new_v4();
        let serialized_payload = serde_json::to_string(&payload)
            .map_err(|e| anyhow::Error::new(e).context("failed to build new job"))?;
        Ok(Self {
            id,
            topic,
            payload: serialized_payload,
            scheduled_at: Utc::now(),
            retries: 0,
            max_retries: 3,
        })
    }

    pub fn with_scheduled_at(mut self, scheduled_at: chrono::DateTime<Utc>) -> Self {
        self.scheduled_at = scheduled_at;
        self
    }

    pub fn with_max_retries(mut self, max_retries: u8) -> Self {
        self.max_retries = max_retries;
        self
    }

    pub fn schedule_retry(&mut self, scheduled_at: chrono::DateTime<Utc>) -> &mut Self {
        self.retries += 1;
        self.scheduled_at = scheduled_at;
        self
    }

    pub fn reset_retries(&mut self) -> &mut Self {
        self.retries = 0;
        self
    }
}
