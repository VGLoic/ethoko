use crate::{
    auth::{
        models::{
            auth_credential::AuthCredential,
            opaque_token::{OpaqueTokenCreatePayload, OpaqueTokenValue},
            queries::{GetUserByEmailError, GetUserBySessionTokenError},
            requests::{
                logout::LogoutError,
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
        repository::{AuthRepository, GetAuthCredentialError, GetLastOtpRequestError},
        requests::login_email::{LoginEmailError, LoginEmailRequest},
    },
    config::OtpConfig,
    newtypes::email::Email,
};
use tracing::{error, info};

#[async_trait::async_trait]
pub trait AuthService: Send + Sync + 'static {
    /// Registers a new user with the provided email, handle and password hash.
    /// - A new user is created with the provided email and handle, the email is marked as not verified.
    /// - An `auth_credential` is created for the user with the provided password hash.
    /// # Errors
    /// * `SignupEmailError::EmailAlreadyExists` if the email is already registered.
    /// * `SignupEmailError::HandleAlreadyExists` if the handle is already taken.
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
    async fn get_user_by_email(&self, email: &Email) -> Result<User, GetUserByEmailError>;

    /// Logs in a user with the provided email and password_hash.
    /// # Errors
    /// * `LoginEmailError::InvalidCredentials` if the provided email and password_hash do not match any user.
    /// * `LoginEmailError::Unknown` for any other errors that may occur during the process.
    async fn login_with_email(
        &self,
        request: LoginEmailRequest,
    ) -> Result<(User, OpaqueTokenValue), LoginEmailError>;

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
}

#[derive(Clone)]
pub struct AuthServiceImpl<R: AuthRepository, N: AuthNotifier> {
    repository: R,
    notifier: N,
    otp_config: OtpConfig,
}

impl<R: AuthRepository, N: AuthNotifier> AuthServiceImpl<R, N> {
    pub fn new(repository: R, notifier: N, otp_config: OtpConfig) -> Self {
        Self {
            repository,
            notifier,
            otp_config,
        }
    }
}

#[async_trait::async_trait]
impl<R: AuthRepository, N: AuthNotifier> AuthService for AuthServiceImpl<R, N> {
    async fn signup_with_email(
        &self,
        request: SignupEmailRequest,
    ) -> Result<(User, AuthCredential), SignupEmailError> {
        let (user, auth_credential) = self.repository.signup_with_email(request).await?;

        if let Err(e) = self
            .notifier
            .user_signed_up_with_email(&user, &auth_credential)
            .await
        {
            error!("Error in user_signed_up_with_email notification: {:?}", e);
        }

        info!(
            "New user with ID {} signed up with email: {} and handle: {}",
            user.id, user.email, user.handle
        );

        Ok((user, auth_credential))
    }

    async fn verify_email(&self, request: VerifyEmailRequest) -> Result<User, VerifyEmailError> {
        let user = self.repository.verify_email_by_otp(request).await?;

        if let Err(e) = self.notifier.user_verified_email(&user).await {
            error!("Error in user_verified_email notification: {:?}", e);
        }

        info!(
            "User with ID {} verified their email: {}",
            user.id, user.email
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
        if user.email_verified {
            return Err(ResendVerificationOtpError::UserAlreadyVerified);
        }
        let last_otp = self
            .repository
            .get_last_otp_request_by_user_id(user.id)
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
            error!(
                "Error in user_requested_resend_verification_otp notification: {:?}",
                e
            );
        }

        info!("Resent verification OTP to email: {}", request.email);

        Ok(())
    }

    async fn get_user_by_email(&self, email: &Email) -> Result<User, GetUserByEmailError> {
        self.repository.get_user_by_email(email).await
    }

    async fn login_with_email(
        &self,
        request: LoginEmailRequest,
    ) -> Result<(User, OpaqueTokenValue), LoginEmailError> {
        let (user, auth_credential) = self
            .repository
            .get_auth_credential_by_email(&request.email)
            .await
            .map_err(|e| match e {
                GetAuthCredentialError::NotFound => LoginEmailError::UserNotFound,
                GetAuthCredentialError::Unknown(err) => err
                    .context("Error fetching auth credential by email")
                    .into(),
            })?;

        if let Err(e) = verify_password(&request.password, &auth_credential.password_hash) {
            error!("Invalid credentials for email: {}: {:?}", request.email, e);
            return Err(LoginEmailError::InvalidCredentials);
        }

        let opaque_session_token_value = OpaqueTokenValue::generate_session_token();
        let session_token_payload = OpaqueTokenCreatePayload::new(&opaque_session_token_value);
        let _ = self
            .repository
            .record_session_token(user.id, session_token_payload)
            .await?;

        if let Err(e) = self.notifier.user_logged_in(&user).await {
            error!("Error in user_logged_in notification: {:?}", e);
        }

        info!("User logged in: {}", user.email);

        Ok((user, opaque_session_token_value))
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
}
