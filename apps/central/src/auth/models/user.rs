use crate::newtypes::{email::Email, handle::Handle};
use thiserror::Error;

#[derive(Debug, Clone, PartialEq, Eq, sqlx::Type)]
#[sqlx(type_name = "user_lifecycle", rename_all = "snake_case")]
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

#[derive(Debug, Clone, PartialEq, Eq, sqlx::Type)]
#[sqlx(type_name = "user_lifecycle", rename_all = "snake_case")]
pub enum UserLifecycleRow {
    Pending,
    Registered,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum User {
    Pending(PendingUser),
    Registered(RegisteredUser),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingUser {
    pub id: uuid::Uuid,
    pub email: Email,
    pub suggested_handle: Option<String>,
    pub email_verified: bool,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RegisteredUser {
    pub id: uuid::Uuid,
    pub email: Email,
    pub handle: Handle,
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
    pub lifecycle: UserLifecycleRow,
    pub email_verified: bool,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Error)]
pub enum UserRowConversionError {
    #[error("pending user row must not contain a registered handle")]
    PendingContainsRegistered,
    #[error("registered user row must contain a handle")]
    RegisteredMissing,
    #[error("registered user row must not contain a suggested handle")]
    RegisteredContainsSuggested,
}

impl User {
    pub fn id(&self) -> uuid::Uuid {
        match self {
            User::Pending(user) => user.id,
            User::Registered(user) => user.id,
        }
    }

    pub fn email(&self) -> &Email {
        match self {
            User::Pending(user) => &user.email,
            User::Registered(user) => &user.email,
        }
    }

    pub fn lifecycle(&self) -> UserLifecycle {
        match self {
            User::Pending(_) => UserLifecycle::Pending,
            User::Registered(_) => UserLifecycle::Registered,
        }
    }

    pub fn email_verified(&self) -> bool {
        match self {
            User::Pending(user) => user.email_verified,
            User::Registered(user) => user.email_verified,
        }
    }

    pub fn created_at(&self) -> chrono::DateTime<chrono::Utc> {
        match self {
            User::Pending(user) => user.created_at,
            User::Registered(user) => user.created_at,
        }
    }

    pub fn updated_at(&self) -> chrono::DateTime<chrono::Utc> {
        match self {
            User::Pending(user) => user.updated_at,
            User::Registered(user) => user.updated_at,
        }
    }

    pub fn as_pending(&self) -> Option<&PendingUser> {
        match self {
            User::Pending(user) => Some(user),
            User::Registered(_) => None,
        }
    }

    pub fn as_registered(&self) -> Option<&RegisteredUser> {
        match self {
            User::Pending(_) => None,
            User::Registered(user) => Some(user),
        }
    }
}

impl TryFrom<UserRow> for User {
    type Error = UserRowConversionError;

    fn try_from(row: UserRow) -> Result<Self, Self::Error> {
        match row.lifecycle {
            UserLifecycleRow::Pending => {
                if row.handle.is_some() {
                    return Err(UserRowConversionError::PendingContainsRegistered);
                }

                Ok(User::Pending(PendingUser {
                    id: row.id,
                    email: row.email,
                    suggested_handle: row.suggested_handle,
                    email_verified: row.email_verified,
                    created_at: row.created_at,
                    updated_at: row.updated_at,
                }))
            }
            UserLifecycleRow::Registered => {
                let handle = row
                    .handle
                    .ok_or(UserRowConversionError::RegisteredMissing)?;

                if row.suggested_handle.is_some() {
                    return Err(UserRowConversionError::RegisteredContainsSuggested);
                }

                Ok(User::Registered(RegisteredUser {
                    id: row.id,
                    email: row.email,
                    handle,
                    email_verified: row.email_verified,
                    created_at: row.created_at,
                    updated_at: row.updated_at,
                }))
            }
        }
    }
}
