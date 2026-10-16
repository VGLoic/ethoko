use std::sync::Arc;

use super::service::AuthService;

#[derive(Clone)]
pub(crate) struct AuthState {
    pub auth_service: Arc<dyn AuthService>,
    pub central_ui_bff_shared_secret: Arc<String>,
}
