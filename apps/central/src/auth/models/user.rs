use crate::newtypes::{email::Email, handle::Handle};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HandleRegistration {
    pub user_id: uuid::Uuid,
    pub handle: Handle,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct User {
    pub id: uuid::Uuid,
    pub email: Email,
    pub handle_registration: Option<HandleRegistration>,
    pub suggested_handle: Option<String>,
    pub email_verified: bool,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq, sqlx::FromRow)]
pub struct UserRow {
    pub id: uuid::Uuid,
    pub email: Email,
    pub handle: Option<Handle>,
    pub suggested_handle: Option<String>,
    pub email_verified: bool,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

impl User {
    pub fn id(&self) -> uuid::Uuid {
        self.id
    }

    pub fn email(&self) -> &Email {
        &self.email
    }

    pub fn email_verified(&self) -> bool {
        self.email_verified
    }
}

impl From<UserRow> for User {
    fn from(row: UserRow) -> Self {
        Self {
            id: row.id,
            email: row.email,
            handle_registration: row.handle.map(|handle| HandleRegistration {
                user_id: row.id,
                handle,
            }),
            suggested_handle: row.suggested_handle,
            email_verified: row.email_verified,
            created_at: row.created_at,
            updated_at: row.updated_at,
        }
    }
}
