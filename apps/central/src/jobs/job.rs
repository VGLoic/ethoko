use chrono::{TimeDelta, Utc};

#[derive(Debug, Clone)]
pub struct Job {
    pub id: uuid::Uuid,
    pub payload: JobPayload,
    pub scheduled_at: chrono::DateTime<Utc>,
    pub retries: u8,
    pub max_retries: u8,
}

impl Job {
    pub fn new(payload: JobPayload, scheduled_at: chrono::DateTime<Utc>) -> Self {
        let id = uuid::Uuid::new_v4();
        Self {
            id,
            payload,
            scheduled_at,
            retries: 0,
            max_retries: 3,
        }
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

#[derive(Debug, Clone)]
pub enum JobPayload {
    Jack,
    Bob,
    Roger,
}
