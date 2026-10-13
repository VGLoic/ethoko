use crate::newtypes::{email::Email, handle::Handle};

#[derive(Debug, Clone, PartialEq, Eq, sqlx::Type)]
#[sqlx(type_name = "text", rename_all = "snake_case")]
pub enum UserLifecycle {
    Pending,
    Registered,
}

impl UserLifecycle {
    pub fn as_str(&self) -> &'static str {
        match self {
            UserLifecycle::Pending => "pending",
            UserLifecycle::Registered => "registered",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, sqlx::FromRow, sqlx::Decode)]
pub struct User {
    pub id: uuid::Uuid,
    pub email: Email,
    pub handle: Option<Handle>,
    pub suggested_handle: Option<String>,
    pub lifecycle: UserLifecycle,
    pub email_verified: bool,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

impl User {
    pub fn registered_handle(&self) -> Option<&Handle> {
        self.handle.as_ref()
    }
}
