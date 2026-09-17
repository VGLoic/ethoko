use crate::{
    auth::{
        authenticated_user::{AuthenticatedUserPages, SESSION_COOKIE_NAME},
        handlers::html_templates::TemplateError,
        requests::logout::LogoutError,
    },
    router::AppState,
};
use axum::{
    extract::State,
    http::HeaderValue,
    response::{IntoResponse, Redirect},
};
use reqwest::header::SET_COOKIE;

pub struct RedirectToLogin;

impl IntoResponse for RedirectToLogin {
    fn into_response(self) -> axum::response::Response {
        let mut response = Redirect::to("/auth/pages/login").into_response();
        let cleanup_cookie_value = format!("{SESSION_COOKIE_NAME}=; Max-Age=0; Path=/; Secure");
        let cleanup_cookie = HeaderValue::from_str(&cleanup_cookie_value).unwrap();
        response.headers_mut().insert(SET_COOKIE, cleanup_cookie);
        response
    }
}

pub async fn handle_logout_form_action(
    State(state): State<AppState>,
    authenticated_user: AuthenticatedUserPages,
) -> Result<RedirectToLogin, TemplateError> {
    state
        .auth_service
        .revoke_session_token(
            authenticated_user.user.id,
            &authenticated_user.session_token_hash,
        )
        .await
        .map_err(|e| match e {
            LogoutError::TokenNotFound => TemplateError::NotFound,
            LogoutError::Unknown(_e) => TemplateError::InternalServerError,
        })?;
    Ok(RedirectToLogin)
}
