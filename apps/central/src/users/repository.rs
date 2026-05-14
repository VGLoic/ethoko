use crate::users::models::{
    auth_credential::AuthCredential,
    email_signup::{EmailSignupError, EmailSignupRequest},
    user::User,
};
use sqlx::{Pool, Postgres};

/// Repository trait for user-related operations
#[async_trait::async_trait]
pub trait UsersRepository: Send + Sync + 'static {
    /// Registers a new user with the provided email, handle and password hash.
    /// - A new user is created with the provided email and handle, the email is marked as not verified.
    /// - An `auth_credential` is created for the user with the provided password hash.
    /// # Errors
    /// * `EmailSignupError::EmailAlreadyExists` if the email is already registered.
    /// * `EmailSignupError::HandleAlreadyExists` if the handle is already taken.
    /// * `EmailSignupError::Unknown` for any other errors that may occur during the process.
    async fn signup_with_email(
        &self,
        request: EmailSignupRequest,
    ) -> Result<(User, AuthCredential), EmailSignupError>;
}

#[derive(Clone)]
pub struct PsqlAccountsRepository {
    pool: Pool<Postgres>,
}

impl PsqlAccountsRepository {
    pub fn new(pool: Pool<Postgres>) -> Self {
        Self { pool }
    }
}

// 23505 is the PostgreSQL error code for unique_violation
const UNIQUE_VIOLATION_ERROR_CODE: &str = "23505";
const UNIQUE_EMAIL_CONSTRAINT_NAME: &str = "unique_email";
const UNIQUE_HANDLE_CONSTRAINT_NAME: &str = "unique_handle";

#[async_trait::async_trait]
impl UsersRepository for PsqlAccountsRepository {
    async fn signup_with_email(
        &self,
        request: EmailSignupRequest,
    ) -> Result<(User, AuthCredential), EmailSignupError> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|e| anyhow::anyhow!(e).context("failed to start transaction"))?;

        let user = sqlx::query_as::<_, User>(
            r#"
            INSERT INTO "ethoko_user" (
                email,
                handle,
                email_verified
            ) VALUES ($1, $2, $3)
            RETURNING
                id,
                email,
                handle,
                email_verified,
                created_at,
                updated_at
            "#,
        )
        .bind(&request.email)
        .bind(&request.handle)
        .bind(false)
        .fetch_one(&mut *transaction)
        .await
        .map_err(|e| {
            if let sqlx::Error::Database(db_err) = &e
                && db_err.code() == Some(UNIQUE_VIOLATION_ERROR_CODE.into())
            {
                if db_err.message().contains(UNIQUE_EMAIL_CONSTRAINT_NAME) {
                    return EmailSignupError::EmailAlreadyExists(request.email.to_string());
                } else if db_err.message().contains(UNIQUE_HANDLE_CONSTRAINT_NAME) {
                    return EmailSignupError::HandleAlreadyExists(request.handle.to_string());
                }
            }
            anyhow::anyhow!(e).context("failed to create user").into()
        })?;

        let auth_credential = sqlx::query_as::<_, AuthCredential>(
            r#"
            INSERT INTO auth_credential (
                user_id,
                password_hash
            ) VALUES ($1, $2)
            RETURNING
                id,
                user_id,
                password_hash,
                created_at,
                updated_at
            "#,
        )
        .bind(user.id)
        .bind(request.password_hash)
        .fetch_one(&mut *transaction)
        .await
        .map_err(|e| anyhow::anyhow!(e).context("failed to create auth credential"))?;

        transaction
            .commit()
            .await
            .map_err(|e| anyhow::anyhow!(e).context("failed to commit transaction"))?;

        Ok((user, auth_credential))
    }
}
