use crate::{
    auth::models::user::User,
    newtypes::{email::Email, handle::Handle},
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct HandleRegistrationResponse {
    pub handle: Handle,
}

// Temporary wire compatibility for the UI; registration presence is authoritative.
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "state")]
pub enum UserResponse {
    #[serde(rename = "pending", rename_all = "camelCase")]
    Pending {
        email: Email,
        #[serde(rename = "handle_registration")]
        handle_registration: Option<HandleRegistrationResponse>,
        suggested_handle: Option<String>,
        email_verified: bool,
        created_at: chrono::DateTime<chrono::Utc>,
        updated_at: chrono::DateTime<chrono::Utc>,
    },
    #[serde(rename = "registered", rename_all = "camelCase")]
    Registered {
        email: Email,
        handle: Handle,
        #[serde(rename = "handle_registration")]
        handle_registration: Option<HandleRegistrationResponse>,
        email_verified: bool,
        created_at: chrono::DateTime<chrono::Utc>,
        updated_at: chrono::DateTime<chrono::Utc>,
    },
}

impl From<User> for UserResponse {
    fn from(user: User) -> Self {
        match user.handle_registration {
            None => UserResponse::Pending {
                email: user.email,
                handle_registration: None,
                suggested_handle: user.suggested_handle,
                email_verified: user.email_verified,
                created_at: user.created_at,
                updated_at: user.updated_at,
            },
            Some(registration) => UserResponse::Registered {
                email: user.email,
                handle: registration.handle.clone(),
                handle_registration: Some(HandleRegistrationResponse {
                    handle: registration.handle,
                }),
                email_verified: user.email_verified,
                created_at: user.created_at,
                updated_at: user.updated_at,
            },
        }
    }
}
