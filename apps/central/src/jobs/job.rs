use chrono::Utc;
use serde::{Serialize, de::DeserializeOwned};
use sqlx::prelude::FromRow;

#[derive(Debug, Clone, Copy, PartialEq, Eq, sqlx::Type)]
#[sqlx(type_name = "job_status", rename_all = "lowercase")]
pub enum JobStatus {
    Pending,
    Processing,
    Successful,
    Dead,
}

#[derive(Debug, Clone, FromRow)]
pub struct Job {
    pub id: uuid::Uuid,
    pub topic: String,
    pub payload: String,
    pub status: JobStatus,
    pub processing_timeout_seconds: i16,
    pub scheduled_at: chrono::DateTime<Utc>,
    pub dequeued_at: Option<chrono::DateTime<Utc>>,
    pub processing_timeout_at: Option<chrono::DateTime<Utc>>,
    pub retry_count: i16,
    pub max_retries: i16,
    pub created_at: chrono::DateTime<Utc>,
    pub updated_at: chrono::DateTime<Utc>,
}

#[derive(Debug, Clone)]
pub struct JobRequest {
    pub topic: String,
    pub payload: String,
    pub processing_timeout_seconds: i16,
    pub scheduled_at: chrono::DateTime<Utc>,
    pub max_retries: i16,
}

impl JobRequest {
    pub fn new<Payload: Serialize + DeserializeOwned>(
        topic: String,
        payload: Payload,
    ) -> Result<Self, anyhow::Error> {
        let serialized_payload = serde_json::to_string(&payload)
            .map_err(|e| anyhow::Error::new(e).context("failed to build new job"))?;
        Ok(Self {
            topic,
            payload: serialized_payload,
            processing_timeout_seconds: 5,
            scheduled_at: Utc::now(),
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
