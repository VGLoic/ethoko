use crate::{
    auth::{
        models::requests::send_email_verification_otp::SendEmailVerificationOtpError,
        notifier::jobs::{AuthJob, SendEmailVerificationOtpPayload},
        repository::AuthRepository,
    },
    config::OtpConfig,
    externalcom::email::{EmailService, EmailVerificationCodePayload},
    jobs::{job::Job, processor::JobProcessor},
    newtypes::otp::Otp,
    operational_tracing::{error_chain, error_classification},
};
use tracing::{debug, error, warn};

#[derive(Debug, Clone)]
pub struct AuthJobProcessor<R: AuthRepository, E: EmailService> {
    auth_repository: R,
    email_service: E,
    otp_config: OtpConfig,
}
impl<R: AuthRepository, E: EmailService> AuthJobProcessor<R, E> {
    pub fn new(auth_repository: R, email_service: E, otp_config: OtpConfig) -> Self {
        Self {
            auth_repository,
            email_service,
            otp_config,
        }
    }
}

#[async_trait::async_trait]
impl<R: AuthRepository, E: EmailService> JobProcessor for AuthJobProcessor<R, E> {
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

impl<R: AuthRepository, E: EmailService> AuthJobProcessor<R, E> {
    async fn process_send_email_verification_otp(
        &self,
        payload: SendEmailVerificationOtpPayload,
    ) -> Result<(), anyhow::Error> {
        let otp = Otp::generate()?;

        let otp_hash = otp.hash();

        let email_template_payload =
            EmailVerificationCodePayload::new(payload.user_email.clone(), payload.user_handle, otp);
        self.email_service
            .send_email(payload.user_email, email_template_payload.into())
            .await
            .map_err(|e| e.context("failed to send email verification OTP"))?;

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
                        "Email verification OTP was sent but not recorded"
                    );
                }
                SendEmailVerificationOtpError::EmailAlreadyVerified => {
                    warn!(
                        event = "auth.email_verification_otp.recording_rejected",
                        user_id = %payload.user_id,
                        reason = "email_already_verified",
                        "Email verification OTP was sent but not recorded"
                    );
                }
                SendEmailVerificationOtpError::NotFound => {
                    warn!(
                        event = "auth.email_verification_otp.recording_rejected",
                        user_id = %payload.user_id,
                        reason = "user_not_found",
                        "Email verification OTP was sent but not recorded"
                    );
                }
                SendEmailVerificationOtpError::Unknown(err) => {
                    error!(
                        event = "auth.email_verification_otp.recording_failed",
                        user_id = %payload.user_id,
                        error_class = error_classification(&err),
                        error_chain = %error_chain(&err),
                        "Failed to record email verification OTP after delivery"
                    );
                    return Err(
                        err.context("failed to register email verification in database in job")
                    );
                }
            }
        };

        debug!(
            event = "auth.email_verification_otp.sent",
            user_id = %payload.user_id,
            "Sent email verification OTP"
        );

        Ok(())
    }
}
