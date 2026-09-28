use std::{net::IpAddr, sync::Arc, time::Duration};

use crate::{auth, config::RateLimitConfig};
use anyhow::Context;
use axum::{
    Json, Router,
    body::Body,
    extract::{MatchedPath, Request},
    http::StatusCode,
    http::header::HeaderName,
    response::{IntoResponse, Response},
    routing::get,
};
use governor::{clock::QuantaInstant, middleware::NoOpMiddleware};
use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;
use tower_governor::GovernorLayer;
use tower_governor::governor::{GovernorConfigBuilder, SharedRateLimiter};
use tower_http::{
    request_id::{MakeRequestUuid, PropagateRequestIdLayer, SetRequestIdLayer},
    timeout::TimeoutLayer,
    trace::TraceLayer,
};
use tracing::{Span, debug, error, info, info_span};

const REQUEST_ID_HEADER: &str = "x-request-id";
const TIMEOUT_SECONDS: u64 = 10;

#[derive(Clone)]
pub struct IpRateLimiter {
    limiter: SharedRateLimiter<IpAddr, NoOpMiddleware<QuantaInstant>>,
}

impl IpRateLimiter {
    pub fn new(limiter: SharedRateLimiter<IpAddr, NoOpMiddleware<QuantaInstant>>) -> Self {
        Self { limiter }
    }

    fn retain_recent(&self) {
        self.limiter.retain_recent();
    }
}

pub struct IpRateLimiters {
    limiters: Vec<IpRateLimiter>,
}

impl IpRateLimiters {
    pub fn new(limiters: Vec<IpRateLimiter>) -> Self {
        Self { limiters }
    }

    pub async fn run_cleanup_old_routine(
        &self,
        cancellation_token: CancellationToken,
    ) -> Result<(), anyhow::Error> {
        let cleanup_interval = Duration::from_secs(60);
        loop {
            tokio::select! {
                _ = tokio::time::sleep(cleanup_interval) => {
                    for limiter in &self.limiters {
                        limiter.retain_recent();
                    }
                }
                _ = cancellation_token.cancelled() => {
                    info!("Cancelling limiter cleanup task");
                    break;
                }
            }
        }
        Ok(())
    }
}

pub fn app_router(
    global_rate_limit_config: RateLimitConfig,
    auth_rate_limit_config: RateLimitConfig,
    central_ui_bff_shared_secret: String,
    auth_service: impl auth::AuthService,
) -> Result<(Router, IpRateLimiters), anyhow::Error> {
    let x_request_id = HeaderName::from_static(REQUEST_ID_HEADER);

    let global_governor_conf = GovernorConfigBuilder::default()
        .per_second(global_rate_limit_config.replenishment_per_second)
        .burst_size(global_rate_limit_config.max_burst_size)
        .finish()
        .ok_or_else(|| anyhow::anyhow!("Error while building the global governor configuration"))?;

    let auth_service = Arc::new(auth_service);
    let state = AppState {
        auth_service,
        central_ui_bff_shared_secret: Arc::new(central_ui_bff_shared_secret),
    };

    let (auth_router, auth_ip_rate_limiter) =
        auth::router(auth_rate_limit_config).context("failed to build auth router")?;
    let limiters = IpRateLimiters::new(vec![
        IpRateLimiter::new(global_governor_conf.limiter().clone()),
        auth_ip_rate_limiter,
    ]);

    let global_governor_layer = GovernorLayer::new(global_governor_conf);
    let router = Router::new()
        .route("/health", get(get_healthcheck))
        .nest("/auth", auth_router)
        .fallback(not_found)
        .with_state(state)
        .layer((
            // Set `x-request-id` header for every request
            SetRequestIdLayer::new(x_request_id.clone(), MakeRequestUuid),
            // Log request and response
            TraceLayer::new_for_http()
                .make_span_with(|request: &Request<_>| {
                    let matched_path = request
                        .extensions()
                        .get::<MatchedPath>()
                        .map(MatchedPath::as_str);

                    let request_id = request.headers().get(REQUEST_ID_HEADER);

                    match request_id {
                        Some(v) => info_span!(
                            "http_request",
                            event = "http.request",
                            method = ?request.method(),
                            matched_path,
                            request_id = ?v
                        ),
                        None => {
                            error!(
                                event = "http.request_id.missing",
                                "Failed to extract request id header"
                            );
                            info_span!(
                                "http_request",
                                event = "http.request",
                                method = ?request.method(),
                                matched_path,
                            )
                        }
                    }
                })
                .on_response(
                    |response: &Response<Body>, latency: Duration, _span: &Span| {
                        if response.status().is_server_error() {
                            error!(
                                event = "http.request.completed",
                                status = %response.status(),
                                latency_ms = latency.as_millis(),
                                "HTTP request completed with server error"
                            )
                        } else {
                            debug!(
                                event = "http.request.completed",
                                status = %response.status(),
                                latency_ms = latency.as_millis(),
                                "HTTP request completed"
                            )
                        }
                    },
                ),
            // Apply rate limiting to all requests
            global_governor_layer,
            // Timeout requests at constant duration
            TimeoutLayer::with_status_code(
                StatusCode::REQUEST_TIMEOUT,
                Duration::from_secs(TIMEOUT_SECONDS),
            ),
            // Propagate the `x-request-id` header to responses
            PropagateRequestIdLayer::new(x_request_id),
        ));
    Ok((router, limiters))
}

#[derive(Clone)]
pub struct AppState {
    pub auth_service: Arc<dyn auth::AuthService>,
    pub central_ui_bff_shared_secret: Arc<String>,
}

#[derive(Serialize, Deserialize)]
pub struct GetHealthcheckResponse {
    pub ok: bool,
}
async fn get_healthcheck() -> (StatusCode, Json<GetHealthcheckResponse>) {
    (StatusCode::OK, Json(GetHealthcheckResponse { ok: true }))
}

async fn not_found() -> impl IntoResponse {
    ApiError::NotFound
}

// ############################################
// ################## ERRORS ##################
// ############################################

#[derive(Serialize, Deserialize, Debug)]

pub struct UnprocessableEntityError {
    pub code: String,
    pub reason: String,
}

impl UnprocessableEntityError {
    pub fn new(code: String, reason: String) -> Self {
        Self { code, reason }
    }

    pub fn new_body_validation(field: String, reason: String) -> Self {
        Self {
            code: "ETKAG01".to_string(),
            reason: format!("invalid submitted field \"{field}\": {reason}"),
        }
    }
}

impl From<UnprocessableEntityError> for ApiError {
    fn from(err: UnprocessableEntityError) -> Self {
        ApiError::UnprocessableEntity(err)
    }
}

#[derive(Debug)]
pub enum ApiError {
    NotFound,
    InternalServerError(anyhow::Error),
    UnprocessableEntity(UnprocessableEntityError),
    BadRequest(String),
    Unauthorized(anyhow::Error),
}

impl From<anyhow::Error> for ApiError {
    fn from(err: anyhow::Error) -> Self {
        ApiError::InternalServerError(err)
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        match self {
            Self::NotFound => (StatusCode::NOT_FOUND, "Not found").into_response(),
            Self::InternalServerError(e) => {
                error!(event = "http.request.failed", error = %e, "Request failed with internal server error");
                (StatusCode::INTERNAL_SERVER_ERROR, "Internal server error").into_response()
            }
            Self::Unauthorized(_error) => StatusCode::UNAUTHORIZED.into_response(),
            Self::BadRequest(msg) => (StatusCode::BAD_REQUEST, msg).into_response(),
            Self::UnprocessableEntity(err) => {
                (StatusCode::UNPROCESSABLE_ENTITY, Json(err)).into_response()
            }
        }
    }
}
