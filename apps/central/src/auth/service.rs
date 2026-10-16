use crate::{
    auth::{
        acls::{github::AuthGithubPort, oauth::AuthOauthClientPort},
        models::{
            auth_credential::{AuthCredential, AuthCredentialPayload},
            opaque_token::{OpaqueTokenCreatePayload, OpaqueTokenValue},
            queries::{GetUserByEmailError, GetUserBySessionTokenError},
            requests::{
                logout::LogoutError,
                register_handle::{RegisterHandleError, RegisterHandleRequest},
                resend_verification_otp::{
                    ResendVerificationOtpError, ResendVerificationOtpRequest,
                },
                signup_email::{SignupEmailError, SignupEmailRequest},
                verify_email::{VerifyEmailError, VerifyEmailRequest},
            },
            user::User,
        },
        notifier::AuthNotifier,
        password_hasher::verify_password,
        repository::{
            AuthRepository, GetAuthCredentialError, GetLastOtpRequestError, RecordSessionTokenError,
        },
        requests::{
            login_email::{LoginEmailError, LoginEmailRequest},
            login_github_callback::{LoginGithubCallbackError, LoginGithubCallbackRequest},
            login_github_start::{LoginGithubStart, LoginGithubStartError},
        },
    },
    config::OtpConfig,
    newtypes::email::Email,
    operational_tracing::{error_chain, error_classification},
};
use sha2::Digest;
use tracing::{debug, error};

#[async_trait::async_trait]
pub trait AuthService: Send + Sync + 'static {
    /// Registers a new pending user with the provided email and password hash.
    /// - A new pending user is created with the provided email, no handle, and an unverified email.
    /// - An `auth_credential` is created for the user with the provided password hash.
    /// # Errors
    /// * `SignupEmailError::EmailAlreadyExists` if the email is already registered.
    /// * `SignupEmailError::Unknown` for any other errors that may occur during the process.
    async fn signup_with_email(
        &self,
        request: SignupEmailRequest,
    ) -> Result<(User, AuthCredential), SignupEmailError>;

    /// Verifies the email of a user with the provided OTP.
    /// - If the OTP is valid and not expired, the user's email is marked as verified
    /// # Errors
    /// * `VerifyEmailError::EmailAlreadyVerified` if the email is already verified.
    /// * `VerifyEmailError::InvalidOtp` if the provided OTP is invalid.
    /// * `VerifyEmailError::OtpExpired` if the provided OTP has expired.
    /// * `VerifyEmailError::NotFound` if the user with the provided email is not found.
    /// * `VerifyEmailError::Unknown` for any other errors that may occur during the process.
    async fn verify_email(&self, request: VerifyEmailRequest) -> Result<User, VerifyEmailError>;

    /// Resends the verification OTP to the user's email.
    /// - If the user's email is already verified, an error is returned.
    /// - The service only checks the condition for resend, the actual sending of the OTP is handled by the notifier.
    /// # Errors
    /// * `ResendVerificationOtpError::UserNotFound` if the user with the provided email is not found.
    /// * `ResendVerificationOtpError::UserAlreadyVerified` if the user's email is already verified.
    /// * `ResendVerificationOtpError::CooldownNotElapsed` if the cooldown period has not elapsed yet for requesting a new verification code.
    /// * `ResendVerificationOtpError::Unknown` for any other errors that may occur during the process.
    async fn resend_verification_otp(
        &self,
        request: ResendVerificationOtpRequest,
    ) -> Result<(), ResendVerificationOtpError>;

    /// Fetches a user by their email.
    /// # Errors
    /// * `GetUserByEmailError::NotFound` if the user with the provided email is not found.
    /// * `GetUserByEmailError::Unknown` for any other errors that may occur during the process.
    #[allow(dead_code)] // Retiring unused service seams is separate from hiding the implementation.
    async fn get_user_by_email(&self, email: &Email) -> Result<User, GetUserByEmailError>;

    /// Logs in a user with the provided email and password_hash.
    /// # Errors
    /// * `LoginEmailError::InvalidCredentials` if the provided email and password_hash do not match any user.
    /// * `LoginEmailError::Unknown` for any other errors that may occur during the process.
    async fn login_with_email(
        &self,
        request: LoginEmailRequest,
    ) -> Result<OpaqueTokenValue, LoginEmailError>;

    /// Registers a handle for the specified user, transitionning it from a pending user to a registered user.
    /// # Errors
    /// * `RegisterHandleError::HandleAlreadyExists` if the requested handle is already taken.
    /// * `RegisterHandleError::AlreadyRegistered` if the user has already registered a handle.
    /// * `RegisterHandleError::Unknown` for any other errors that may occur during the process.
    async fn register_handle(
        &self,
        user_id: uuid::Uuid,
        request: RegisterHandleRequest,
    ) -> Result<User, RegisterHandleError>;

    /// Fetches a user by their session token hash.
    /// The resolution will only succeed if the underlying token is valid and associated with an existing user.
    /// # Errors
    /// * `GetUserBySessionTokenError::UserNotFound` if the user with the provided token is not found.
    /// * `GetUserBySessionTokenError::TokenNotFound` if the provided token is not found.
    /// * `GetUserBySessionTokenError::TokenRevoked` if the provided token has been revoked.
    /// * `GetUserBySessionTokenError::TokenExpired` if the provided token has expired.
    /// * `GetUserBySessionTokenError::Unknown` for any other errors that may occur during the process.
    async fn get_user_by_session_token(
        &self,
        token_hash: &[u8; 32],
    ) -> Result<User, GetUserBySessionTokenError>;

    /// Revokes a session token by its hash.
    /// # Errors
    /// * `LogoutError::TokenNotFound` if the token is not found.
    /// * `LogoutError::Unknown` for any other errors that may occur during the process.
    async fn revoke_session_token(
        &self,
        user_id: uuid::Uuid,
        token_hash: &[u8; 32],
    ) -> Result<(), LogoutError>;

    /// Start Oauth2 flow with Github.
    /// A CSRF token is generated and the authorization URI is returned.
    /// # Errors
    /// * `LoginGithubStartError::Unknown` for any other errors that may occur during the process
    async fn start_login_with_github(&self) -> Result<LoginGithubStart, LoginGithubStartError>;

    /// Handles callback branch of Oauth2 flow with GitHub.
    /// # Errors
    /// * `LoginGithubCallbackError::PrimaryEmailCollision` if the Github primary email collides with an existing Ethoko user
    /// * `LoginGithubCallbackError::Unknown` for any other errors that may occur during the process
    async fn authorize_login_with_github(
        &self,
        request: LoginGithubCallbackRequest,
    ) -> Result<OpaqueTokenValue, LoginGithubCallbackError>;
}

#[derive(Clone)]
pub struct AuthServiceImpl<
    R: AuthRepository,
    N: AuthNotifier,
    GhPort: AuthGithubPort,
    GhOauth: AuthOauthClientPort,
> {
    repository: R,
    notifier: N,
    otp_config: OtpConfig,
    github_oauth_client_port: GhOauth,
    github_oauth_transaction_ttl_seconds: u16,
    github_port: GhPort,
}

impl<R: AuthRepository, N: AuthNotifier, GhPort: AuthGithubPort, GhOauth: AuthOauthClientPort>
    AuthServiceImpl<R, N, GhPort, GhOauth>
{
    pub fn new(
        repository: R,
        notifier: N,
        otp_config: OtpConfig,
        github_oauth_client_port: GhOauth,
        oauth_transaction_ttl_seconds: u16,
        github_port: GhPort,
    ) -> Self {
        Self {
            repository,
            notifier,
            otp_config,
            github_oauth_client_port,
            github_oauth_transaction_ttl_seconds: oauth_transaction_ttl_seconds,
            github_port,
        }
    }
}

#[async_trait::async_trait]
impl<R: AuthRepository, N: AuthNotifier, GhPort: AuthGithubPort, GhOauth: AuthOauthClientPort>
    AuthService for AuthServiceImpl<R, N, GhPort, GhOauth>
{
    async fn signup_with_email(
        &self,
        request: SignupEmailRequest,
    ) -> Result<(User, AuthCredential), SignupEmailError> {
        let (user, auth_credential) = self.repository.create_user_with_email_auth(request).await?;

        if let Err(e) = self
            .notifier
            .user_signed_up_with_email(&user, &auth_credential)
            .await
        {
            match &e {
                SignupEmailError::Unknown(err) => {
                    error!(
                        event = "auth.signup.notification_failed",
                        user_id = %user.id(),
                        error_class = error_classification(err),
                        error_chain = %error_chain(err),
                        "Failed to enqueue signup notification"
                    );
                }
                SignupEmailError::EmailAlreadyExists(_) => {
                    error!(
                        event = "auth.signup.notification_failed",
                        user_id = %user.id(),
                        error_class = "unexpected",
                        "Failed to enqueue signup notification"
                    );
                }
            }
        }

        debug!(
            event = "auth.signup.succeeded",
            user_id = %user.id(),
            lifecycle = ?user.lifecycle(),
            "Completed signup with email"
        );

        Ok((user, auth_credential))
    }

    async fn verify_email(&self, request: VerifyEmailRequest) -> Result<User, VerifyEmailError> {
        let user = self.repository.verify_email_by_otp(request).await?;

        if let Err(e) = self.notifier.user_verified_email(&user).await {
            match &e {
                VerifyEmailError::Unknown(err) => {
                    error!(
                        event = "auth.verify_email.notification_failed",
                        user_id = %user.id(),
                        error_class = error_classification(err),
                        error_chain = %error_chain(err),
                        "Failed to handle email-verified notification"
                    );
                }
                VerifyEmailError::EmailAlreadyVerified
                | VerifyEmailError::InvalidOtp
                | VerifyEmailError::OtpExpired
                | VerifyEmailError::NotFound => {
                    error!(
                        event = "auth.verify_email.notification_failed",
                        user_id = %user.id(),
                        error_class = "unexpected",
                        "Failed to handle email-verified notification"
                    );
                }
            }
        }

        debug!(
            event = "auth.verify_email.succeeded",
            user_id = %user.id(),
            "Verified email"
        );

        Ok(user)
    }

    async fn resend_verification_otp(
        &self,
        request: ResendVerificationOtpRequest,
    ) -> Result<(), ResendVerificationOtpError> {
        let user = self
            .repository
            .get_user_by_email(&request.email)
            .await
            .map_err(|e| match e {
                GetUserByEmailError::NotFound => ResendVerificationOtpError::UserNotFound,
                GetUserByEmailError::Unknown(err) => {
                    err.context("Error fetching user by email").into()
                }
            })?;
        if user.email_verified() {
            return Err(ResendVerificationOtpError::UserAlreadyVerified);
        }
        let last_otp = self
            .repository
            .get_last_otp_request_by_user_id(user.id())
            .await
            .map_err(|e| match e {
                GetLastOtpRequestError::Unknown(err) => {
                    err.context("Error fetching last OTP request by user ID")
                }
            })?;
        if let Some(last_otp) = last_otp {
            let now = chrono::Utc::now();
            let elapsed = now.signed_duration_since(last_otp.created_at);
            if elapsed < chrono::Duration::seconds(self.otp_config.cooldown_seconds.into()) {
                return Err(ResendVerificationOtpError::CooldownNotElapsed);
            }
        }

        if let Err(e) = self
            .notifier
            .user_requested_resend_verification_otp(&user)
            .await
        {
            match &e {
                ResendVerificationOtpError::Unknown(err) => {
                    error!(
                        event = "auth.resend_verification_otp.notification_failed",
                        user_id = %user.id(),
                        error_class = error_classification(err),
                        error_chain = %error_chain(err),
                        "Failed to enqueue resend verification OTP notification"
                    );
                }
                ResendVerificationOtpError::UserNotFound
                | ResendVerificationOtpError::UserAlreadyVerified
                | ResendVerificationOtpError::CooldownNotElapsed => {
                    error!(
                        event = "auth.resend_verification_otp.notification_failed",
                        user_id = %user.id(),
                        error_class = "unexpected",
                        "Failed to enqueue resend verification OTP notification"
                    );
                }
            }
        }

        debug!(
            event = "auth.resend_verification_otp.succeeded",
            user_id = %user.id(),
            "Accepted resend verification OTP request"
        );

        Ok(())
    }

    async fn get_user_by_email(&self, email: &Email) -> Result<User, GetUserByEmailError> {
        self.repository.get_user_by_email(email).await
    }

    async fn login_with_email(
        &self,
        request: LoginEmailRequest,
    ) -> Result<OpaqueTokenValue, LoginEmailError> {
        let (user, auth_credentials) = self
            .repository
            .get_auth_credentials_by_email(&request.email)
            .await
            .map_err(|e| match e {
                GetAuthCredentialError::NotFound => LoginEmailError::UserNotFound,
                GetAuthCredentialError::Unknown(err) => err
                    .context("Error fetching auth credential by email")
                    .into(),
            })?;

        let password_hash = match auth_credentials
            .iter()
            .find(|cred| matches!(cred.payload, AuthCredentialPayload::PasswordHash { .. }))
        {
            Some(cred) => match &cred.payload {
                AuthCredentialPayload::PasswordHash { hash } => hash,
                _ => return Err(LoginEmailError::InvalidCredentials),
            },
            None => return Err(LoginEmailError::InvalidCredentials),
        };

        if let Err(_e) = verify_password(&request.password, password_hash) {
            return Err(LoginEmailError::InvalidCredentials);
        }

        let opaque_session_token_value = OpaqueTokenValue::generate_session_token();
        let session_token_payload = OpaqueTokenCreatePayload::new(&opaque_session_token_value);
        let _ = self
            .repository
            .record_session_token(user.id(), session_token_payload)
            .await
            .map_err(|e| match e {
                RecordSessionTokenError::Unknown(err) => {
                    err.context("Error recording session token")
                }
            })?;

        if let Err(e) = self.notifier.user_logged_in_with_email(&user).await {
            match &e {
                LoginEmailError::Unknown(err) => {
                    error!(
                        event = "auth.login_with_email.notification_failed",
                        error_class = error_classification(err),
                        error_chain = %error_chain(err),
                        error_class = error_classification(err),
                        error_chain = %error_chain(err),
                        "Failed to handle login notification"
                    );
                }
                LoginEmailError::UserNotFound | LoginEmailError::InvalidCredentials => {
                    error!(
                        event = "auth.login_with_email.notification_failed",
                        user_id = %user.id(),
                        error_class = "unexpected",
                        "Failed to handle login notification"
                    );
                }
            }
        }

        debug!(
            event = "auth.login_with_email.succeeded",
            user_id = %user.id(),
            "Completed login with email"
        );

        Ok(opaque_session_token_value)
    }

    async fn register_handle(
        &self,
        user_id: uuid::Uuid,
        request: RegisterHandleRequest,
    ) -> Result<User, RegisterHandleError> {
        self.repository.register_handle(user_id, request).await
    }

    async fn get_user_by_session_token(
        &self,
        token_hash: &[u8; 32],
    ) -> Result<User, GetUserBySessionTokenError> {
        self.repository.get_user_by_session_token(token_hash).await
    }

    async fn revoke_session_token(
        &self,
        user_id: uuid::Uuid,
        token_hash: &[u8; 32],
    ) -> Result<(), LogoutError> {
        self.repository
            .revoke_session_token(user_id, token_hash)
            .await
    }

    async fn start_login_with_github(&self) -> Result<LoginGithubStart, LoginGithubStartError> {
        let authorization_url = self
            .github_oauth_client_port
            .generate_authorization_url(vec!["read:user", "user:email"])
            .await
            .map_err(|e| e.context("failed to generate authorization url"))?;

        let expires_at = chrono::Utc::now()
            + chrono::Duration::seconds(self.github_oauth_transaction_ttl_seconds.into());
        self.repository
            .start_oauth_transaction(&authorization_url.state.hash(), expires_at)
            .await?;

        Ok(LoginGithubStart {
            auth_url: authorization_url.url,
            state: authorization_url.state,
        })
    }

    async fn authorize_login_with_github(
        &self,
        request: LoginGithubCallbackRequest,
    ) -> Result<OpaqueTokenValue, LoginGithubCallbackError> {
        let state_hash = sha2::Sha256::digest(request.state.as_bytes());
        self.repository
            .finish_oauth_transaction(&state_hash.into())
            .await?;

        let access_token = self
            .github_oauth_client_port
            .exchange_code_for_token(&request.code)
            .await
            .map_err(|e| e.context("failed to exchange code for github token"))?;

        let github_user = self.github_port.get_user(&access_token).await?;

        let (user, _auth_credential, is_new_user) = self
            .repository
            .get_or_create_user_with_github_auth(github_user)
            .await?;

        let opaque_session_token_value = OpaqueTokenValue::generate_session_token();
        let session_token_payload = OpaqueTokenCreatePayload::new(&opaque_session_token_value);
        let _ = self
            .repository
            .record_session_token(user.id(), session_token_payload)
            .await
            .map_err(|e| match e {
                RecordSessionTokenError::Unknown(err) => {
                    err.context("Error recording session token")
                }
            })?;

        if let Err(e) = if is_new_user {
            self.notifier
                .user_signed_up_with_github(&user, &_auth_credential)
                .await
        } else {
            self.notifier.user_logged_in_with_github(&user).await
        } {
            match &e {
                LoginGithubCallbackError::Unknown(err) => {
                    error!(
                        event = "auth.login_with_github.notification_failed",
                        user_id = %user.id(),
                        error_class = error_classification(err),
                        error_chain = %error_chain(err),
                        "Error occurred while sending Github auth notification"
                    )
                }
                _ => {
                    error!(
                        event = "auth.login_with_github.notification_failed",
                        user_id = %user.id(),
                        error_class = "unexpected",
                        "Error occurred while sending Github auth notification"
                    );
                }
            }
        }

        Ok(opaque_session_token_value)
    }
}
