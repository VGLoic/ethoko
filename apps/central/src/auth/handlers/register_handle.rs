use crate::{
    auth::{
        http_responses::UserResponse,
        principal::CentralUiBffWithUser,
        requests::register_handle::{
            HttpRegisterHandleBody, RegisterHandleError, RegisterHandleRequest,
            RegisterHandleRequestError,
        },
    },
    newtypes::handle::HandleError,
    router::{ApiError, AppState, UnprocessableEntityError},
};
use axum::{Json, extract::State, http::StatusCode};

pub async fn handle_register_handle(
    State(state): State<AppState>,
    principal: CentralUiBffWithUser,
    Json(body): Json<HttpRegisterHandleBody>,
) -> Result<(StatusCode, Json<UserResponse>), ApiError> {
    let request = RegisterHandleRequest::new(body.handle)?;

    let user = state
        .auth_service
        .register_handle(principal.user.id(), request)
        .await?;

    Ok((StatusCode::OK, Json(user.into())))
}

impl From<RegisterHandleError> for ApiError {
    fn from(err: RegisterHandleError) -> Self {
        match err {
            RegisterHandleError::HandleAlreadyExists(handle) => UnprocessableEntityError::new(
                "ETKARH01".to_string(),
                format!("The provided handle is already taken: {handle}"),
            )
            .into(),
            RegisterHandleError::AlreadyRegistered => UnprocessableEntityError::new(
                "ETKARH02".to_string(),
                "user already has a registered handle".to_string(),
            )
            .into(),
            RegisterHandleError::Unknown(e) => ApiError::InternalServerError(e),
        }
    }
}

impl From<RegisterHandleRequestError> for ApiError {
    fn from(err: RegisterHandleRequestError) -> Self {
        match err {
            RegisterHandleRequestError::InvalidHandle(e) => match e {
                HandleError::Empty => UnprocessableEntityError::new_body_validation(
                    "handle".to_string(),
                    "empty value not allowed".to_string(),
                )
                .into(),
                HandleError::InvalidFormat => UnprocessableEntityError::new_body_validation(
                    "handle".to_string(),
                    "invalid format, expected only alphanumeric characters and hyphens, length between 4 and 31".to_string(),
                )
                .into(),
                HandleError::InvalidSpecificHandle => UnprocessableEntityError::new(
                    "ETKARH03".to_string(),
                    "The provided handle is not allowed.".to_string(),
                )
                .into(),
            },
        }
    }
}
