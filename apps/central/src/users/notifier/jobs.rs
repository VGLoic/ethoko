use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug)]
pub enum UsersJob {
    DummyJob(DummyJobPayload),
}

#[derive(Serialize, Deserialize, Debug)]
pub struct DummyJobPayload {
    pub user_id: uuid::Uuid,
}

impl DummyJobPayload {
    pub fn new(user_id: uuid::Uuid) -> Self {
        Self { user_id }
    }
}
