use chrono::Utc;
use serde::{Serialize, de::DeserializeOwned};
use sqlx::{Decode, Encode, Type, prelude::FromRow};

#[derive(Debug, Clone, Copy, PartialEq, Eq, sqlx::Type)]
#[sqlx(type_name = "job_status", rename_all = "lowercase")]
pub enum JobStatus {
    Pending,
    Processing,
    Successful,
    Dead,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct U16(i32);

impl std::fmt::Display for U16 {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl From<U16> for i64 {
    fn from(value: U16) -> Self {
        value.0.into()
    }
}

impl std::ops::Add<u16> for U16 {
    type Output = Self;

    fn add(self, other: u16) -> Self {
        let other_i32: i32 = other.into();
        U16(self.0 + other_i32)
    }
}

impl std::ops::AddAssign<u16> for U16 {
    fn add_assign(&mut self, other: u16) {
        let other_i32: i32 = other.into();
        self.0 += other_i32;
    }
}

impl From<u16> for U16 {
    fn from(value: u16) -> Self {
        U16(value.into())
    }
}

impl PartialEq<u16> for U16 {
    fn eq(&self, other: &u16) -> bool {
        let other_i32: i32 = (*other).into();
        self.0 == other_i32
    }
}

impl Type<sqlx::postgres::Postgres> for U16 {
    fn type_info() -> sqlx::postgres::PgTypeInfo {
        <i32 as Type<sqlx::postgres::Postgres>>::type_info()
    }
}

impl Encode<'_, sqlx::postgres::Postgres> for U16 {
    fn encode_by_ref(
        &self,
        buf: &mut sqlx::postgres::PgArgumentBuffer,
    ) -> Result<sqlx::encode::IsNull, Box<dyn std::error::Error + 'static + Send + Sync>> {
        let i: i32 = self.0;
        Encode::<sqlx::postgres::Postgres>::encode_by_ref(&i, buf)
    }
}

impl Decode<'_, sqlx::postgres::Postgres> for U16 {
    fn decode(
        value: sqlx::postgres::PgValueRef<'_>,
    ) -> Result<Self, Box<dyn std::error::Error + 'static + Send + Sync>> {
        let i: i32 = Decode::<sqlx::postgres::Postgres>::decode(value)?;
        if i.is_negative() {
            return Err("negative value cannot be converted to U16".into());
        }
        Ok(U16(i))
    }
}

#[derive(Debug, Clone, FromRow)]
pub struct Job {
    pub id: uuid::Uuid,
    pub topic: String,
    pub payload: String,
    pub status: JobStatus,
    pub processing_timeout_seconds: U16,
    pub scheduled_at: chrono::DateTime<Utc>,
    pub dequeued_at: Option<chrono::DateTime<Utc>>,
    pub processing_timeout_at: Option<chrono::DateTime<Utc>>,
    pub retry_count: U16,
    pub max_retries: U16,
    pub created_at: chrono::DateTime<Utc>,
    pub updated_at: chrono::DateTime<Utc>,
}

const DEFAULT_PROCESSING_TIMEOUT_SECONDS: U16 = U16(5);
const DEFAULT_MAX_RETRIES: U16 = U16(3);

#[derive(Debug, Clone)]
pub struct JobRequest {
    pub topic: String,
    pub payload: String,
    pub processing_timeout_seconds: U16,
    pub scheduled_at: chrono::DateTime<Utc>,
    pub max_retries: U16,
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
            processing_timeout_seconds: DEFAULT_PROCESSING_TIMEOUT_SECONDS,
            scheduled_at: Utc::now(),
            max_retries: DEFAULT_MAX_RETRIES,
        })
    }

    pub fn with_scheduled_at(mut self, scheduled_at: chrono::DateTime<Utc>) -> Self {
        self.scheduled_at = scheduled_at;
        self
    }

    pub fn with_max_retries(mut self, max_retries: u16) -> Self {
        self.max_retries = max_retries.into();
        self
    }

    pub fn with_processing_timeout(mut self, processing_timeout: u16) -> Self {
        self.processing_timeout_seconds = processing_timeout.into();
        self
    }
}
