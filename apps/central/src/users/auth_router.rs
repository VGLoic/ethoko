use axum::{Json, Router, http::StatusCode, response::IntoResponse, routing::post};
use serde::{Deserialize, Serialize};

use crate::newtypes::{email::Email, handle::Handle};

pub fn auth_router() -> Router {
    Router::new().route("/signup/email", post(handle_signup_email))
}

#[derive(Deserialize, Serialize)]
pub struct SignupEmailBody {
    pub email: String,
    pub handle: String,
    pub password: String,
}

async fn handle_signup_email(Json(body): Json<SignupEmailBody>) -> impl IntoResponse {
    let email = match Email::new(&body.email) {
        Ok(email) => email,
        Err(_) => return (StatusCode::BAD_REQUEST, "Invalid email format").into_response(),
    };
    let handle = match Handle::new(&body.handle) {
        Ok(handle) => handle,
        Err(_) => return (StatusCode::BAD_REQUEST, "Invalid handle format").into_response(),
    };

    (StatusCode::CREATED, "Signup email endpoint").into_response()
}
