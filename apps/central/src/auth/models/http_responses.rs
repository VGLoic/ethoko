use crate::{
    auth::models::user::User,
    newtypes::{email::Email, handle::Handle},
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct HandleRegistrationResponse {
    pub handle: Handle,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserResponse {
    pub email: Email,
    #[serde(rename = "handle_registration")]
    pub handle_registration: Option<HandleRegistrationResponse>,
    pub suggested_handle: Option<String>,
    pub email_verified: bool,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

impl From<User> for UserResponse {
    fn from(user: User) -> Self {
        Self {
            email: user.email,
            handle_registration: user.handle_registration.map(|registration| {
                HandleRegistrationResponse {
                    handle: registration.handle,
                }
            }),
            suggested_handle: user.suggested_handle,
            email_verified: user.email_verified,
            created_at: user.created_at,
            updated_at: user.updated_at,
        }
    }
}
