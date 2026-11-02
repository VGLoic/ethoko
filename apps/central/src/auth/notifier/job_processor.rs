use crate::{
    auth::{notifier::jobs::AuthJob, service::AuthService},
    externalcom::email::{EmailService, EmailVerificationCodePayload},
    jobs::{job::Job, processor::JobProcessor},
    newtypes::otp::Otp,
};
use std::sync::Arc;
use tracing::debug;

#[derive(Clone)]
pub struct AuthJobProcessor<S: AuthService, E: EmailService> {
    auth_service: Arc<S>,
    email_service: E,
}
impl<S: AuthService, E: EmailService> AuthJobProcessor<S, E> {
    pub fn new(auth_service: Arc<S>, email_service: E) -> Self {
        Self {
            auth_service,
            email_service,
        }
    }
}

#[async_trait::async_trait]
impl<S: AuthService, E: EmailService> JobProcessor for AuthJobProcessor<S, E> {
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
        }
    }
}
