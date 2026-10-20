use crate::{
    auth::{
        models::{
            auth_credential::{AuthCredential, AuthCredentialPayload},
            github_acl::GithubUser,
            oauth_transaction::OauthTransaction,
            opaque_token::{OpaqueToken, OpaqueTokenCreatePayload},
            otp_request::{OtpPurpose, OtpRequest},
            queries::{GetUserByEmailError, GetUserBySessionTokenError},
            requests::{
                register_handle::{RegisterHandleError, RegisterHandleRequest},
                send_email_verification_otp::SendEmailVerificationOtpError,
                signup_email::{SignupEmailError, SignupEmailRequest},
                verify_email::{VerifyEmailError, VerifyEmailRequest},
            },
            user::{User, UserLifecycle, UserLifecycleRow, UserRow},
        },
        requests::{
            login_github_callback::LoginGithubCallbackError,
            login_github_start::LoginGithubStartError, logout::LogoutError,
        },
    },
    config::OtpConfig,
    newtypes::email::Email,
};
use chrono::{TimeDelta, Utc};
use sqlx::{Executor, Pool, Postgres};
use thiserror::Error;

/// Repository trait for auth-related operations
#[async_trait::async_trait]
pub trait AuthRepository: Send + Sync + 'static {
    /// Records a reset hash after delivery, checking eligibility and purpose-specific cooldown.
    /// Returns storage errors; suppressed requests are not recorded.
    async fn register_password_reset(
        &self,
        user_id: uuid::Uuid,
        hash: [u8; 32],
        expires_at: chrono::DateTime<Utc>,
        cooldown_seconds: u16,
    ) -> Result<(), anyhow::Error>;

    /// Atomically consumes the current reset token, replaces the password and revokes sessions.
    /// Returns InvalidToken for unusable tokens or missing password credentials; Unknown for storage errors.
    async fn complete_password_reset(
        &self,
        hash: [u8; 32],
        password: crate::newtypes::password_hash::PasswordHash,
    ) -> Result<(), super::requests::password_recovery::ResetPasswordError>;
    /// Registers a new pending user with the provided email and password hash.
    /// - A new pending user is created with the provided email, no handle, and an unverified email.
    /// - An `auth_credential` is created for the user with the provided password hash.
    /// # Errors
    /// * `SignupEmailError::EmailAlreadyExists` if the email is already registered.
    /// * `SignupEmailError::Unknown` for any other errors that may occur during the process.
    async fn create_user_with_email_auth(
        &self,
        request: SignupEmailRequest,
    ) -> Result<(User, AuthCredential), SignupEmailError>;

    /// Find in a user with their Github account, or creates a new user if one does not exist.
    /// Look first for an existing user with the given Github ID, and if not found, create a new user.
    /// An existing user with the same primary email as the Github user will fail to be created.
    /// # Errors
    /// * `LoginGithubCallbackError::PrimaryEmailCollision` if an existing user with the same primary email as the Github user exists.
    /// * `LoginGithubCallbackError::Unknown` for any other errors that may occur during the process.
    /// # Returns
    /// * `Ok((user, auth_credential, is_new_user))` if the operation succeeds, where `is_new_user` indicates whether a new user was created.
    async fn get_or_create_user_with_github_auth(
        &self,
        github_user: GithubUser,
    ) -> Result<(User, AuthCredential, bool), LoginGithubCallbackError>;

    /// Registers a new email verification OTP for the user.
    /// - A new OTP is created for the user with the provided OTP hash.
    /// # Errors
    /// * `SendEmailVerificationOtpError::NotFound` if the user is not found.
    /// * `SendEmailVerificationOtpError::EmailAlreadyVerified` if the user's email is already verified.
    /// * `SendEmailVerificationOtpError::CooldownNotElapsed` if the cooldown period has not elapsed yet for requesting a new verification code.
    /// * `SendEmailVerificationOtpError::Unknown` for any other errors that may occur during the process.
    async fn register_email_verification_otp(
        &self,
        user_id: uuid::Uuid,
        otp_hash: [u8; 32],
        otp_config: &OtpConfig,
    ) -> Result<OtpRequest, SendEmailVerificationOtpError>;

    /// Verifies the email of the user with the provided OTP hash.
    /// - The user is fetched from the database using the provided user ID.
    /// - The latest OTP request for the user is fetched from the database.
    /// - If the OTP request is found and the provided OTP hash matches the stored OTP hash, the user's email is marked as verified.
    /// - If the OTP request is not found, the provided OTP hash does not match the stored OTP hash, or the OTP request has expired, an appropriate error is returned.
    /// - If the user's email is already verified, an error is returned
    /// # Errors
    /// * `VerifyEmailError::NotFound` if the user is not found
    /// * `VerifyEmailError::InvalidOtp` if the provided OTP is invalid
    /// * `VerifyEmailError::EmailAlreadyVerified` if the user's email is already verified
    /// * `VerifyEmailError::OtpExpired` if the provided OTP has expired
    /// * `VerifyEmailError::Unknown` for any other errors that may occur during the process.
    async fn verify_email_by_otp(
        &self,
        verify_email_request: VerifyEmailRequest,
    ) -> Result<User, VerifyEmailError>;

    /// Gets a user by their email address.
    /// # Errors
    /// * `GetUserByEmailError::NotFound` if the user is not found
    /// * `GetUserByEmailError::Unknown` for any other errors that may occur during the process.
    async fn get_user_by_email(&self, email: &Email) -> Result<User, GetUserByEmailError>;

    /// Gets the last OTP request for a user by their user ID.
    /// # Errors
    /// * `GetLastOtpRequestError::Unknown` for any other errors that may occur during the process.
    async fn get_last_otp_request_by_user_id(
        &self,
        user_id: uuid::Uuid,
        purpose: OtpPurpose,
    ) -> Result<Option<OtpRequest>, GetLastOtpRequestError>;

    /// Gets the user and auth credentials for a user by their email address.
    /// # Errors
    /// * `GetAuthCredentialError::UserNotFound` if the underlying user is not found
    /// * `GetAuthCredentialError::Unknown` for any other errors that may occur during the process.
    async fn get_auth_credentials_by_email(
        &self,
        email: &Email,
    ) -> Result<(User, Vec<AuthCredential>), GetAuthCredentialError>;

    /// Records an opaque session token for the specified user.
    /// # Errors
    /// * `RecordSessionTokenError::UserNotFound` if the user is not found
    /// * `RecordSessionTokenError::Unknown` for any errors that may occur during the process.
    async fn record_session_token(
        &self,
        user_id: uuid::Uuid,
        session_token_payload: OpaqueTokenCreatePayload,
    ) -> Result<OpaqueToken, RecordSessionTokenError>;

    /// Registers a handle for the specified user, transitioning them from a pending user to a registered user.
    /// # Errors
    /// * `RegisterHandleError::HandleAlreadyExists` if the requested handle is already taken.
    /// * `RegisterHandleError::AlreadyRegistered` if the user has already registered a handle.
    /// * `RegisterHandleError::Unknown` for any other errors that may occur during the process.
    async fn register_handle(
        &self,
        user_id: uuid::Uuid,
        request: RegisterHandleRequest,
    ) -> Result<User, RegisterHandleError>;

    /// Gets a user by their opaque token hash.
    /// Updates the last_used_at of the opaque token to now.
    /// # Errors
    /// * `GetUserBySessionTokenError::UserNotFound` if the user is not found
    /// * `GetUserBySessionTokenError::TokenNotFound` if the token is not found
    /// * `GetUserBySessionTokenError::TokenRevoked` if the token has been revoked
    /// * `GetUserBySessionTokenError::TokenExpired` if the token has expired
    /// * `GetUserBySessionTokenError::Unknown` for any other errors that may occur during the process.
    async fn get_user_by_session_token(
        &self,
        token_hash: &[u8; 32],
    ) -> Result<User, GetUserBySessionTokenError>;

    /// Revokes a session token for the specified user by their user ID and token hash.
    /// # Errors
    /// * `LogoutError::TokenNotFound` if the token is not found.
    /// * `LogoutError::Unknown` for any other errors that may occur during the process.
    async fn revoke_session_token(
        &self,
        user_id: uuid::Uuid,
        token_hash: &[u8; 32],
    ) -> Result<(), LogoutError>;

    /// Starts an Oauth transaction with a state hash
    /// # Errors
    /// `LoginGithubStartError::Unknown` for any other errors that may occur during the process
    async fn start_oauth_transaction(
        &self,
        state_hash: &[u8; 32],
        expires_at: chrono::DateTime<chrono::Utc>,
    ) -> Result<(), LoginGithubStartError>;

    /// Finalizes an Oauth transaction for the specified state hash.
    /// The Oauth transaction is deleted.
    /// # Errors
    /// * `LoginGithubCallbackError::OauthTransactionNotFound` if the transaction is not found
    /// * `LoginGithubCallbackError::OauthTransactionExpired` if the transaction is expired
    /// * `LoginGithubCallbackError::Unknown` for any other errors that may occur during the process.
    async fn finish_oauth_transaction(
        &self,
        state_hash: &[u8; 32],
    ) -> Result<(), LoginGithubCallbackError>;
}

#[derive(Error, Debug)]
pub enum RecordSessionTokenError {
    #[error(transparent)]
    Unknown(#[from] anyhow::Error),
}

#[derive(Error, Debug)]
pub enum GetAuthCredentialError {
    #[error("Auth credential not found")]
    NotFound,
    #[error(transparent)]
    Unknown(#[from] anyhow::Error),
}

#[derive(Error, Debug)]
pub enum GetLastOtpRequestError {
    #[error(transparent)]
    Unknown(#[from] anyhow::Error),
}

#[derive(Clone)]
pub struct PsqlAuthRepository {
    pool: Pool<Postgres>,
}

impl PsqlAuthRepository {
    pub fn new(pool: Pool<Postgres>) -> Self {
        Self { pool }
    }
}

// 23505 is the PostgreSQL error code for unique_violation
const UNIQUE_VIOLATION_ERROR_CODE: &str = "23505";
const UNIQUE_EMAIL_CONSTRAINT_NAME: &str = "unique_email";
const UNIQUE_REGISTERED_HANDLE_CONSTRAINT_NAME: &str = "unique_registered_handle";

#[derive(sqlx::FromRow)]
struct PasswordResetCompletionRow {
    id: uuid::Uuid,
    otp_hash: Vec<u8>,
    expires_at: chrono::DateTime<Utc>,
    consumed_at: Option<chrono::DateTime<Utc>>,
}

#[async_trait::async_trait]
impl AuthRepository for PsqlAuthRepository {
    async fn register_password_reset(
        &self,
        user_id: uuid::Uuid,
        hash: [u8; 32],
        expires_at: chrono::DateTime<Utc>,
        cooldown_seconds: u16,
    ) -> Result<(), anyhow::Error> {
        let mut transaction = self.pool.begin().await?;
        // Issuance and completion serialize on the User, so completion checks the latest recorded token.
        let exists = sqlx::query_scalar::<_, uuid::Uuid>(
            "SELECT id FROM ethoko_user WHERE id = $1 FOR UPDATE",
        )
        .bind(user_id)
        .fetch_optional(&mut *transaction)
        .await?;
        if exists.is_none() {
            return Ok(());
        }
        let eligible = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM auth_credential WHERE user_id = $1 AND payload->>'type' = 'password_hash')",
        )
        .bind(user_id)
        .fetch_one(&mut *transaction)
        .await?;
        if !eligible {
            return Ok(());
        }
        let last =
            get_last_otp_request_by_user_id(user_id, OtpPurpose::PasswordReset, &mut *transaction)
                .await?;
        if last.is_some_and(|otp| {
            Utc::now().signed_duration_since(otp.created_at)
                < TimeDelta::seconds(cooldown_seconds.into())
        }) {
            return Ok(());
        }
        sqlx::query("INSERT INTO otp_request (user_id, otp_hash, purpose, expires_at) VALUES ($1, $2, 'password_reset', $3)")
            .bind(user_id)
            .bind(hash)
            .bind(expires_at)
            .execute(&mut *transaction)
            .await?;
        transaction.commit().await?;
        Ok(())
    }

    async fn complete_password_reset(
        &self,
        hash: [u8; 32],
        password: crate::newtypes::password_hash::PasswordHash,
    ) -> Result<(), super::requests::password_recovery::ResetPasswordError> {
        use super::requests::password_recovery::ResetPasswordError;
        // Keep the transaction boundary here: no credential/session mutation can escape a failed reset.
        let mut transaction = self.pool.begin().await.map_err(anyhow::Error::from)?;
        let user_id = sqlx::query_scalar::<_, uuid::Uuid>(
            "SELECT user_id FROM otp_request WHERE otp_hash = $1 AND purpose = 'password_reset'",
        )
        .bind(hash)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(anyhow::Error::from)?
        .ok_or(ResetPasswordError::InvalidToken)?;

        sqlx::query("SELECT id FROM ethoko_user WHERE id = $1 FOR UPDATE")
            .bind(user_id)
            .execute(&mut *transaction)
            .await
            .map_err(anyhow::Error::from)?;
        let current = sqlx::query_as::<_, PasswordResetCompletionRow>(
            r#"
            SELECT id, otp_hash, expires_at, consumed_at
            FROM otp_request
            WHERE user_id = $1 AND purpose = 'password_reset'
            ORDER BY issuance_order DESC
            LIMIT 1 FOR UPDATE
            "#,
        )
        .bind(user_id)
        .fetch_one(&mut *transaction)
        .await
        .map_err(anyhow::Error::from)?;
        if current.otp_hash != hash
            || current.expires_at <= Utc::now()
            || current.consumed_at.is_some()
        {
            return Err(ResetPasswordError::InvalidToken);
        }

        let updated = sqlx::query(
            "UPDATE auth_credential SET payload = $2, updated_at = NOW() WHERE user_id = $1 AND payload->>'type' = 'password_hash'",
        )
        .bind(user_id)
        .bind(AuthCredentialPayload::from_password_hash(password))
        .execute(&mut *transaction)
        .await
        .map_err(anyhow::Error::from)?;
        if updated.rows_affected() == 0 {
            return Err(ResetPasswordError::InvalidToken);
        }
        sqlx::query("UPDATE otp_request SET consumed_at = NOW() WHERE id = $1")
            .bind(current.id)
            .execute(&mut *transaction)
            .await
            .map_err(anyhow::Error::from)?;
        sqlx::query("UPDATE opaque_token SET revoked_at = NOW() WHERE user_id = $1 AND kind = 'session' AND revoked_at IS NULL")
            .bind(user_id)
            .execute(&mut *transaction)
            .await
            .map_err(anyhow::Error::from)?;
        transaction.commit().await.map_err(anyhow::Error::from)?;
        Ok(())
    }
    async fn create_user_with_email_auth(
        &self,
        request: SignupEmailRequest,
    ) -> Result<(User, AuthCredential), SignupEmailError> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|e| anyhow::anyhow!(e).context("failed to start transaction"))?;

        let user_row = sqlx::query_as::<_, UserRow>(
            r#"
            INSERT INTO "ethoko_user" (
                email,
                handle,
                suggested_handle,
                lifecycle,
                email_verified
            ) VALUES ($1, $2, $3, $4, $5)
            RETURNING
                id,
                email,
                handle,
                suggested_handle,
                lifecycle,
                email_verified,
                created_at,
                updated_at
            "#,
        )
        .bind(&request.email)
        .bind(Option::<String>::None)
        .bind(Option::<String>::None)
        .bind(UserLifecycleRow::Pending)
        .bind(false)
        .fetch_one(&mut *transaction)
        .await
        .map_err(|e| {
            if let sqlx::Error::Database(db_err) = &e
                && db_err.code() == Some(UNIQUE_VIOLATION_ERROR_CODE.into())
                && db_err.message().contains(UNIQUE_EMAIL_CONSTRAINT_NAME)
            {
                return SignupEmailError::EmailAlreadyExists(request.email.to_string());
            }
            anyhow::anyhow!(e).context("failed to create user").into()
        })?;
        let user: User = user_row.try_into().map_err(|e| {
            SignupEmailError::Unknown(anyhow::Error::new(e).context("created invalid user row"))
        })?;

        let auth_credential = sqlx::query_as::<_, AuthCredential>(
            r#"
            INSERT INTO auth_credential (
                user_id,
                payload
            ) VALUES ($1, $2)
            RETURNING
                id,
                user_id,
                payload,
                created_at,
                updated_at
            "#,
        )
        .bind(user.id())
        .bind(AuthCredentialPayload::from_password_hash(
            request.password_hash,
        ))
        .fetch_one(&mut *transaction)
        .await
        .map_err(|e| anyhow::anyhow!(e).context("failed to create auth credential"))?;

        transaction
            .commit()
            .await
            .map_err(|e| anyhow::anyhow!(e).context("failed to commit transaction"))?;

        Ok((user, auth_credential))
    }

    async fn get_or_create_user_with_github_auth(
        &self,
        github_user: GithubUser,
    ) -> Result<(User, AuthCredential, bool), LoginGithubCallbackError> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|e| anyhow::anyhow!(e).context("failed to start transaction"))?;

        let auth_credential = sqlx::query_as::<_, AuthCredential>(
            r#"
            SELECT
                id,
                user_id,
                payload,
                created_at,
                updated_at
            FROM auth_credential
            WHERE payload->>'github_id' = $1
            "#,
        )
        .bind(github_user.id.as_u64().to_string())
        .fetch_optional(&mut *transaction)
        .await
        .map_err(|e| anyhow::anyhow!(e).context("failed to fetch auth credential by github id"))?;

        if let Some(auth_credential) = auth_credential {
            let user = get_user_by_id(auth_credential.user_id, &mut *transaction)
                .await
                .map_err(|e| anyhow::anyhow!(e).context("failed to fetch user by id"))?
                .ok_or(anyhow::anyhow!(
                    "user not found for auth_credential.user_id: {}",
                    auth_credential.user_id
                ))?;

            transaction
                .commit()
                .await
                .map_err(|e| anyhow::anyhow!(e).context("failed to commit transaction"))?;
            return Ok((user, auth_credential, false));
        }

        let user_row = sqlx::query_as::<_, UserRow>(
            r#"
            INSERT INTO "ethoko_user" (
                email,
                handle,
                suggested_handle,
                lifecycle,
                email_verified
            )
            VALUES ($1, $2, $3, $4, $5)
            RETURNING
                id,
                email,
                handle,
                suggested_handle,
                lifecycle,
                email_verified,
                created_at,
                updated_at
            "#,
        )
        .bind(&github_user.primary_email)
        .bind(Option::<String>::None)
        .bind(Some(github_user.username.clone()))
        .bind(UserLifecycleRow::Pending)
        .bind(github_user.email_verified)
        .fetch_one(&mut *transaction)
        .await
        .map_err(|e| {
            if let sqlx::Error::Database(db_err) = &e
                && db_err.code() == Some(UNIQUE_VIOLATION_ERROR_CODE.into())
                && db_err.message().contains(UNIQUE_EMAIL_CONSTRAINT_NAME)
            {
                return LoginGithubCallbackError::PrimaryEmailCollision;
            }
            anyhow::anyhow!(e).context("failed to create user").into()
        })?;
        let user: User = user_row.try_into().map_err(|e| {
            LoginGithubCallbackError::Unknown(
                anyhow::Error::new(e).context("created invalid user row"),
            )
        })?;

        let auth_credential = sqlx::query_as::<_, AuthCredential>(
            r#"
            INSERT INTO auth_credential (
                user_id,
                payload
            )
            VALUES ($1, $2)
            RETURNING
                id,
                user_id,
                payload,
                created_at,
                updated_at
            "#,
        )
        .bind(user.id())
        .bind(AuthCredentialPayload::from_github_oauth(github_user.id))
        .fetch_one(&mut *transaction)
        .await
        .map_err(|e| anyhow::anyhow!(e).context("failed to create auth credential"))?;

        transaction
            .commit()
            .await
            .map_err(|e| anyhow::anyhow!(e).context("failed to commit transaction"))?;

        Ok((user, auth_credential, true))
    }

    async fn register_email_verification_otp(
        &self,
        user_id: uuid::Uuid,
        otp_hash: [u8; 32],
        otp_config: &OtpConfig,
    ) -> Result<OtpRequest, SendEmailVerificationOtpError> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|e| anyhow::anyhow!(e).context("failed to start transaction"))?;

        let user = get_user_by_id(user_id, &mut *transaction)
            .await
            .map_err(|e| anyhow::anyhow!(e).context("failed to fetch user"))?;

        let user = match user {
            Some(user) => user,
            None => return Err(SendEmailVerificationOtpError::NotFound),
        };
        if user.email_verified() {
            return Err(SendEmailVerificationOtpError::EmailAlreadyVerified);
        }

        let last_otp_request = get_last_otp_request_by_user_id(
            user_id,
            OtpPurpose::EmailVerification,
            &mut *transaction,
        )
        .await
        .map_err(|e| anyhow::anyhow!(e).context("failed to fetch last otp request"))?;

        if let Some(otp_request) = last_otp_request {
            let cooldown_limit = otp_request
                .created_at
                .checked_add_signed(TimeDelta::seconds(otp_config.cooldown_seconds.into()))
                .ok_or(anyhow::anyhow!("failed to compute cooldown limit"))?;
            if Utc::now() < cooldown_limit {
                return Err(SendEmailVerificationOtpError::CooldownNotElapsed);
            }
        }

        let expires_at = Utc::now()
            .checked_add_signed(TimeDelta::seconds(otp_config.ttl_seconds.into()))
            .ok_or(anyhow::anyhow!("failed to compute expires_at"))?;
        let otp_request = sqlx::query_as::<_, OtpRequest>(
            r#"
            INSERT INTO otp_request (
                user_id,
                otp_hash,
                purpose,
                expires_at
            ) VALUES ($1, $2, $3, $4)
            RETURNING
                id,
                user_id,
                otp_hash,
                purpose,
                created_at,
                expires_at
            "#,
        )
        .bind(user_id)
        .bind(otp_hash)
        .bind(OtpPurpose::EmailVerification)
        .bind(expires_at)
        .fetch_one(&mut *transaction)
        .await
        .map_err(|e| anyhow::anyhow!(e).context("failed to create otp request"))?;

        transaction
            .commit()
            .await
            .map_err(|e| anyhow::anyhow!(e).context("failed to commit transaction"))?;

        Ok(otp_request)
    }

    async fn verify_email_by_otp(
        &self,
        verify_email_request: VerifyEmailRequest,
    ) -> Result<User, VerifyEmailError> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|e| anyhow::anyhow!(e).context("failed to start transaction"))?;

        let user = get_user_by_email(&verify_email_request.email, &mut *transaction)
            .await
            .map_err(|e| anyhow::anyhow!(e).context("failed to fetch user"))?;

        let user = match user {
            Some(user) => user,
            None => return Err(VerifyEmailError::NotFound),
        };
        if user.email_verified() {
            return Err(VerifyEmailError::EmailAlreadyVerified);
        }

        let otp_request = get_last_otp_request_by_user_id(
            user.id(),
            OtpPurpose::EmailVerification,
            &mut *transaction,
        )
        .await
        .map_err(|e| anyhow::anyhow!(e).context("failed to fetch last otp request"))?;

        let otp_request = match otp_request {
            Some(otp_request) => otp_request,
            None => return Err(VerifyEmailError::InvalidOtp),
        };

        if Utc::now() > otp_request.expires_at {
            return Err(VerifyEmailError::OtpExpired);
        }

        if let OtpPurpose::EmailVerification = otp_request.purpose {
        } else {
            return Err(VerifyEmailError::InvalidOtp);
        }

        if otp_request.otp_hash != verify_email_request.otp_hash {
            return Err(VerifyEmailError::InvalidOtp);
        }

        sqlx::query(
            r#"
            UPDATE "ethoko_user"
            SET email_verified = true
            WHERE id = $1
            "#,
        )
        .bind(user.id())
        .execute(&mut *transaction)
        .await
        .map_err(|e| anyhow::anyhow!(e).context("failed to update user email_verified"))?;

        let updated_user = get_user_by_id(user.id(), &mut *transaction)
            .await
            .map_err(|e| anyhow::anyhow!(e).context("failed to fetch updated user"))?
            .ok_or(anyhow::anyhow!("failed to fetch updated user"))?;

        transaction
            .commit()
            .await
            .map_err(|e| anyhow::anyhow!(e).context("failed to commit transaction"))?;

        Ok(updated_user)
    }

    async fn get_user_by_email(&self, email: &Email) -> Result<User, GetUserByEmailError> {
        let user = get_user_by_email(email, &self.pool)
            .await
            .map_err(|e| anyhow::anyhow!(e).context("failed to fetch user by email"))?;

        match user {
            Some(user) => Ok(user),
            None => Err(GetUserByEmailError::NotFound),
        }
    }

    async fn get_last_otp_request_by_user_id(
        &self,
        user_id: uuid::Uuid,
        purpose: OtpPurpose,
    ) -> Result<Option<OtpRequest>, GetLastOtpRequestError> {
        get_last_otp_request_by_user_id(user_id, purpose, &self.pool)
            .await
            .map_err(|e| {
                anyhow::anyhow!(e)
                    .context("failed to fetch last otp request")
                    .into()
            })
    }

    async fn get_auth_credentials_by_email(
        &self,
        email: &Email,
    ) -> Result<(User, Vec<AuthCredential>), GetAuthCredentialError> {
        let user = get_user_by_email(email, &self.pool)
            .await
            .map_err(|e| anyhow::anyhow!(e).context("failed to fetch user by email"))?
            .ok_or(GetAuthCredentialError::NotFound)?;
        let auth_credentials = sqlx::query_as::<_, AuthCredential>(
            r#"
            SELECT
                id,
                user_id,
                payload,
                created_at,
                updated_at
            FROM auth_credential
            WHERE user_id = $1
            "#,
        )
        .bind(user.id())
        .fetch_all(&self.pool)
        .await
        .map_err(|e| anyhow::anyhow!(e).context("failed to fetch auth credential by email"))?;

        if auth_credentials.is_empty() {
            Err(GetAuthCredentialError::NotFound)
        } else {
            Ok((user, auth_credentials))
        }
    }

    async fn record_session_token(
        &self,
        user_id: uuid::Uuid,
        session_token_payload: OpaqueTokenCreatePayload,
    ) -> Result<OpaqueToken, RecordSessionTokenError> {
        let opaque_token = sqlx::query_as::<_, OpaqueToken>(
            r#"
            INSERT INTO opaque_token (
                user_id,
                kind,
                token_hash,
                scopes,
                expires_at
            )
            VALUES ($1, $2, $3, $4, $5)
            RETURNING
                id,
                user_id,
                kind,
                token_hash,
                scopes,
                created_at,
                updated_at,
                expires_at,
                revoked_at,
                last_used_at
            "#,
        )
        .bind(user_id)
        .bind(session_token_payload.kind)
        .bind(session_token_payload.token_hash)
        .bind(session_token_payload.scopes)
        .bind(session_token_payload.expires_at)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| anyhow::anyhow!(e).context("failed to record session token"))?;

        Ok(opaque_token)
    }

    async fn register_handle(
        &self,
        user_id: uuid::Uuid,
        request: RegisterHandleRequest,
    ) -> Result<User, RegisterHandleError> {
        let user = sqlx::query_as::<_, UserRow>(
            r#"
            UPDATE "ethoko_user"
            SET handle = $2,
                suggested_handle = NULL,
                lifecycle = 'registered'
            WHERE id = $1 AND lifecycle = 'pending'
            RETURNING
                id,
                email,
                handle,
                suggested_handle,
                lifecycle,
                email_verified,
                created_at,
                updated_at
            "#,
        )
        .bind(user_id)
        .bind(&request.handle)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| {
            if let sqlx::Error::Database(db_err) = &e
                && db_err.code() == Some(UNIQUE_VIOLATION_ERROR_CODE.into())
                && db_err
                    .message()
                    .contains(UNIQUE_REGISTERED_HANDLE_CONSTRAINT_NAME)
            {
                return RegisterHandleError::HandleAlreadyExists(request.handle.to_string());
            }
            RegisterHandleError::Unknown(anyhow::anyhow!(e).context("failed to register handle"))
        })?
        .map(TryInto::try_into)
        .transpose()
        .map_err(|e| {
            RegisterHandleError::Unknown(
                anyhow::Error::new(e).context("updated invalid user row during register handle"),
            )
        })?;

        match user {
            Some(user) => Ok(user),
            None => {
                let existing_user = get_user_by_id(user_id, &self.pool)
                    .await
                    .map_err(|e| {
                        anyhow::anyhow!(e)
                            .context("failed to fetch user after register handle attempt")
                    })?
                    .ok_or_else(|| {
                        RegisterHandleError::Unknown(anyhow::anyhow!(
                            "user not found for register handle"
                        ))
                    })?;

                if existing_user.lifecycle() == UserLifecycle::Registered {
                    Err(RegisterHandleError::AlreadyRegistered)
                } else {
                    Err(RegisterHandleError::Unknown(anyhow::anyhow!(
                        "register handle update did not affect any row"
                    )))
                }
            }
        }
    }

    async fn get_user_by_session_token(
        &self,
        token_hash: &[u8; 32],
    ) -> Result<User, GetUserBySessionTokenError> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|e| anyhow::anyhow!(e).context("failed to begin transaction"))?;

        let opaque_token = sqlx::query_as::<_, OpaqueToken>(
            r#"
            UPDATE opaque_token
            SET last_used_at = NOW()
            WHERE token_hash = $1 AND kind = 'session'
            RETURNING
                id,
                user_id,
                kind,
                token_hash,
                scopes,
                created_at,
                updated_at,
                expires_at,
                revoked_at,
                last_used_at
            "#,
        )
        .bind(token_hash)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(|e| anyhow::anyhow!(e).context("failed to fetch opaque token by token hash"))?
        .ok_or(GetUserBySessionTokenError::TokenNotFound)?;

        if opaque_token.revoked_at.is_some() {
            return Err(GetUserBySessionTokenError::TokenRevoked);
        }
        if opaque_token.expires_at <= chrono::Utc::now() {
            return Err(GetUserBySessionTokenError::TokenExpired);
        }

        let user = get_user_by_id(opaque_token.user_id, &mut *transaction)
            .await
            .map_err(|e| anyhow::anyhow!(e).context("failed to fetch user by ID"))?
            .ok_or(GetUserBySessionTokenError::UserNotFound)?;

        transaction
            .commit()
            .await
            .map_err(|e| anyhow::anyhow!(e).context("failed to commit transaction"))?;

        Ok(user)
    }

    async fn revoke_session_token(
        &self,
        user_id: uuid::Uuid,
        token_hash: &[u8; 32],
    ) -> Result<(), LogoutError> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|e| anyhow::anyhow!(e).context("failed to begin transaction"))?;

        let result = sqlx::query(
            r#"
            UPDATE opaque_token
            SET revoked_at = NOW()
            WHERE user_id = $1 AND token_hash = $2 AND kind = 'session'
            "#,
        )
        .bind(user_id)
        .bind(token_hash)
        .execute(&mut *transaction)
        .await
        .map_err(|e| anyhow::anyhow!(e).context("failed to revoke session token"))?;

        if result.rows_affected() == 0 {
            return Err(LogoutError::TokenNotFound);
        }

        transaction
            .commit()
            .await
            .map_err(|e| anyhow::anyhow!(e).context("failed to commit transaction"))?;

        Ok(())
    }

    async fn start_oauth_transaction(
        &self,
        state_hash: &[u8; 32],
        expires_at: chrono::DateTime<chrono::Utc>,
    ) -> Result<(), LoginGithubStartError> {
        let _oauth_transaction = sqlx::query_as::<_, OauthTransaction>(
            r#"
            INSERT INTO oauth_transaction (state_hash, expires_at)
            VALUES ($1, $2)
            RETURNING
                id,
                state_hash,
                created_at,
                expires_at
            "#,
        )
        .bind(state_hash)
        .bind(expires_at)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| anyhow::anyhow!(e).context("failed to start OAuth transaction"))?;

        Ok(())
    }

    async fn finish_oauth_transaction(
        &self,
        state_hash: &[u8; 32],
    ) -> Result<(), LoginGithubCallbackError> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|e| anyhow::anyhow!(e).context("failed to begin transaction"))?;

        let oauth_transaction = sqlx::query_as::<_, OauthTransaction>(
            r#"
            SELECT
                id,
                state_hash,
                created_at,
                expires_at
            FROM oauth_transaction
            WHERE state_hash = $1
            FOR UPDATE
            "#,
        )
        .bind(state_hash)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(|e| anyhow::anyhow!(e).context("failed to fetch OAuth transaction"))?
        .ok_or(LoginGithubCallbackError::OauthTransactionNotFound)?;

        // Delete the OAuth transaction
        sqlx::query(
            r#"
            DELETE FROM oauth_transaction
            WHERE id = $1
            "#,
        )
        .bind(oauth_transaction.id)
        .execute(&mut *transaction)
        .await
        .map_err(|e| anyhow::anyhow!(e).context("failed to delete OAuth transaction"))?;

        transaction
            .commit()
            .await
            .map_err(|e| anyhow::anyhow!(e).context("failed to commit transaction"))?;

        if oauth_transaction.expires_at < chrono::Utc::now() {
            return Err(LoginGithubCallbackError::OauthTransactionExpired);
        }

        Ok(())
    }
}

async fn get_last_otp_request_by_user_id<'a, E: Executor<'a, Database = Postgres>>(
    user_id: uuid::Uuid,
    purpose: OtpPurpose,
    executor: E,
) -> Result<Option<OtpRequest>, sqlx::Error> {
    let otp_request = sqlx::query_as::<_, OtpRequest>(
        r#"
        SELECT
            id,
            user_id,
            otp_hash,
            purpose,
            created_at,
            expires_at
        FROM otp_request
        WHERE user_id = $1 AND purpose = $2
        -- Preserve verification ordering for rows issued before issuance_order existed.
        ORDER BY CASE WHEN purpose = 'email_verification' THEN created_at END DESC,
                 issuance_order DESC
        LIMIT 1
        "#,
    )
    .bind(user_id)
    .bind(purpose)
    .fetch_optional(executor)
    .await?;

    Ok(otp_request)
}

async fn get_user_by_email<'a, E: Executor<'a, Database = Postgres>>(
    email: &Email,
    executor: E,
) -> Result<Option<User>, sqlx::Error> {
    let user = sqlx::query_as::<_, UserRow>(
        r#"
            SELECT
                id,
                email,
                handle,
                suggested_handle,
                lifecycle,
                email_verified,
                created_at,
                updated_at
        FROM "ethoko_user"
        WHERE email = $1
        "#,
    )
    .bind(email)
    .fetch_optional(executor)
    .await?
    .map(TryInto::try_into)
    .transpose()
    .map_err(|e| sqlx::Error::Decode(Box::new(e)))?;

    Ok(user)
}

async fn get_user_by_id<'a, E: Executor<'a, Database = Postgres>>(
    user_id: uuid::Uuid,
    executor: E,
) -> Result<Option<User>, sqlx::Error> {
    let user = sqlx::query_as::<_, UserRow>(
        r#"
            SELECT
                id,
                email,
                handle,
                suggested_handle,
                lifecycle,
                email_verified,
                created_at,
                updated_at
        FROM "ethoko_user"
        WHERE id = $1
        "#,
    )
    .bind(user_id)
    .fetch_optional(executor)
    .await?
    .map(TryInto::try_into)
    .transpose()
    .map_err(|e| sqlx::Error::Decode(Box::new(e)))?;

    Ok(user)
}
