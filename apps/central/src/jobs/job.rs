use chrono::{TimeDelta, Utc};
use serde::{Serialize, de::DeserializeOwned};

#[derive(Debug, Clone)]
pub struct Job {
    pub id: uuid::Uuid,
    pub payload: String,
    pub scheduled_at: chrono::DateTime<Utc>,
    pub retries: u8,
    pub max_retries: u8,
}

impl Job {
    pub fn new<Payload: Serialize + DeserializeOwned>(
        payload: Payload,
        scheduled_at: chrono::DateTime<Utc>,
    ) -> Result<Self, anyhow::Error> {
        let id = uuid::Uuid::new_v4();
        let serialized_payload = serde_json::to_string(&payload)
            .map_err(|e| anyhow::Error::new(e).context("failed to build new job"))?;
        Ok(Self {
            id,
            payload: serialized_payload,
            scheduled_at,
            retries: 0,
            max_retries: 3,
        })
    }

    pub fn schedule_retry(&mut self) -> &mut Self {
        self.retries += 1;
        self.scheduled_at = Utc::now()
            .checked_add_signed(TimeDelta::seconds(5))
            .unwrap();
        self
    }

    pub fn reset_retries(&mut self) -> &mut Self {
        self.retries = 0;
        self
    }
}
