use crate::{
    auth::{
        models::requests::send_email_verification_otp::SendEmailVerificationOtpError,
        notifier::jobs::{AuthJob, SendEmailVerificationOtpPayload},
        repository::AuthRepository,
        service::AuthService,
    },
    config::OtpConfig,
    externalcom::email::{EmailService, EmailVerificationCodePayload},
    jobs::{job::Job, processor::JobProcessor},
    newtypes::otp::Otp,
    operational_tracing::{error_chain, error_classification},
};
use std::sync::Arc;
use tracing::{debug, error, warn};

#[derive(Clone)]
pub struct AuthJobProcessor<R: AuthRepository, S: AuthService, E: EmailService> {
    auth_repository: R,
    auth_service: Arc<S>,
    email_service: E,
    otp_config: OtpConfig,
}
impl<R: AuthRepository, S: AuthService, E: EmailService> AuthJobProcessor<R, S, E> {
    pub fn new(
        auth_repository: R,
        auth_service: Arc<S>,
        email_service: E,
        otp_config: OtpConfig,
    ) -> Self {
        Self {
            auth_repository,
            auth_service,
            email_service,
            otp_config,
        }
    }
}

#[async_trait::async_trait]
impl<R: AuthRepository, S: AuthService, E: EmailService> JobProcessor
    for AuthJobProcessor<R, S, E>
{
    async fn process_job(&self, job: &Job) -> Result<(), anyhow::Error> {
        debug!(
            event = "auth.job.started",
            job_id = %job.id,
            topic = %job.topic,
            "Started auth job"
        );

        let payload: AuthJob = serde_json::from_str(&job.payload)
            .map_err(|e| anyhow::Error::new(e).context("failed to deserialized job payload"))?;

        match payload {
            AuthJob::FillEmailVerificationOtp(p) => {
                let otp = Otp::generate()?;
                if !self
                    .auth_service
                    .fill_email_verification_otp(p.user_id, p.otp_request_id, otp.hash())
                    .await?
                {
                    debug!(event = "auth.email_verification_otp.filling_skipped",
                        user_id = %p.user_id, otp_request_id = %p.otp_request_id,
                        "Linked request is ineligible; skipping delivery");
                    return Ok(());
                }
                // Assignment has committed. Sending never mutates the request.
                let template = EmailVerificationCodePayload::new(p.user_email.clone(), otp);
                self.email_service
                    .send_email(p.user_email, template.into())
                    .await
                    .map_err(|e| e.context("failed to send email verification OTP"))?;
                debug!(event = "auth.email_verification_otp.sent", user_id = %p.user_id,
                    otp_request_id = %p.otp_request_id, "Sent email verification OTP");
                Ok(())
            }
            AuthJob::SendEmailVerificationOtp(p) => {
                self.process_send_email_verification_otp(p)
                    .await
                    .map_err(|e| {
                        anyhow::anyhow!(e).context("failed to send email verification OTP")
                    })?;
                Ok(())
            }
        }
    }
}

impl<R: AuthRepository, S: AuthService, E: EmailService> AuthJobProcessor<R, S, E> {
    async fn process_send_email_verification_otp(
        &self,
        payload: SendEmailVerificationOtpPayload,
    ) -> Result<(), anyhow::Error> {
        let otp = Otp::generate()?;

        let otp_hash = otp.hash();

        if let Err(e) = self
            .auth_repository
            .register_email_verification_otp(payload.user_id, otp_hash, &self.otp_config)
            .await
        {
            match e {
                SendEmailVerificationOtpError::CooldownNotElapsed => {
                    warn!(
                        event = "auth.email_verification_otp.recording_rejected",
                        user_id = %payload.user_id,
                        reason = "cooldown_not_elapsed",
                        "Email verification OTP was not recorded; skipping delivery"
                    );
                }
                SendEmailVerificationOtpError::EmailAlreadyVerified => {
                    warn!(
                        event = "auth.email_verification_otp.recording_rejected",
                        user_id = %payload.user_id,
                        reason = "email_already_verified",
                        "Email verification OTP was not recorded; skipping delivery"
                    );
                }
                SendEmailVerificationOtpError::NotFound => {
                    warn!(
                        event = "auth.email_verification_otp.recording_rejected",
                        user_id = %payload.user_id,
                        reason = "user_not_found",
                        "Email verification OTP was not recorded; skipping delivery"
                    );
                }
                SendEmailVerificationOtpError::Unknown(err) => {
                    error!(
                        event = "auth.email_verification_otp.recording_failed",
                        user_id = %payload.user_id,
                        error_class = error_classification(&err),
                        error_chain = %error_chain(&err),
                        "Failed to record email verification OTP before delivery"
                    );
                    return Err(
                        err.context("failed to register email verification in database in job")
                    );
                }
            }
            return Ok(());
        };

        let email_template_payload =
            EmailVerificationCodePayload::new(payload.user_email.clone(), otp);
        self.email_service
            .send_email(payload.user_email, email_template_payload.into())
            .await
            .map_err(|e| e.context("failed to send email verification OTP"))?;

        debug!(
            event = "auth.email_verification_otp.sent",
            user_id = %payload.user_id,
            "Sent email verification OTP"
        );

        Ok(())
    }
}
