use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
pub struct HttpForgotPasswordBody {
    pub email: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpForgotPasswordResponse {
    pub message: &'static str,
    pub cooldown_seconds: u16,
}
