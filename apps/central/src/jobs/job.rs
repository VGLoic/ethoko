use chrono::Utc;
use serde::{Serialize, de::DeserializeOwned};
use sqlx::prelude::FromRow;

#[derive(Debug, Clone, FromRow)]
pub struct Job {
    pub id: uuid::Uuid,
    pub topic: String,
    pub payload: String,
    pub processing_timeout_seconds: i16,
    pub scheduled_at: chrono::DateTime<Utc>,
    pub dequeued_at: Option<chrono::DateTime<Utc>>,
    pub processing_timeout_at: Option<chrono::DateTime<Utc>>,
    pub retry_count: i16,
    pub max_retries: i16,
}

impl Job {
    pub fn new<Payload: Serialize + DeserializeOwned>(
        topic: String,
        payload: Payload,
    ) -> Result<Self, anyhow::Error> {
        let id = uuid::Uuid::new_v4();
        let serialized_payload = serde_json::to_string(&payload)
            .map_err(|e| anyhow::Error::new(e).context("failed to build new job"))?;
        Ok(Self {
            id,
            topic,
            payload: serialized_payload,
            processing_timeout_seconds: 5,
            scheduled_at: Utc::now(),
            dequeued_at: None,
            processing_timeout_at: None,
            retry_count: 0,
            max_retries: 3,
        })
    }

    pub fn with_scheduled_at(mut self, scheduled_at: chrono::DateTime<Utc>) -> Self {
        self.scheduled_at = scheduled_at;
        self
    }

    pub fn with_max_retries(mut self, max_retries: i16) -> Self {
        self.max_retries = max_retries;
        self
    }

    pub fn with_processing_timeout(mut self, processing_timeout: i16) -> Self {
        self.processing_timeout_seconds = processing_timeout;
        self
    }
}
