use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};

use ethoko_central::{
    externalcom::email::{EmailService, EmailTemplate},
    newtypes::email::Email,
};
use tracing::debug;

#[derive(Debug, Clone)]
pub struct FakeEmailService {
    pub emails_sent: Arc<Mutex<Vec<(Email, EmailTemplate)>>>,
    pub fail_sending: Arc<AtomicBool>,
    pub attempts: Arc<Mutex<Vec<(Email, EmailTemplate)>>>,
}

impl Default for FakeEmailService {
    fn default() -> Self {
        Self {
            emails_sent: Arc::new(Mutex::new(vec![])),
            fail_sending: Arc::new(AtomicBool::new(false)),
            attempts: Arc::new(Mutex::new(vec![])),
        }
    }
}

impl FakeEmailService {
    #[allow(dead_code)]
    pub fn has_sent_email_to(&self, email: &Email) -> bool {
        let emails_sent = self
            .emails_sent
            .lock()
            .map_err(|e| anyhow::anyhow!("{e}").context("failed to acquire lock for emails_sent"))
            .unwrap();
        emails_sent.iter().any(|(e, _)| e == email)
    }

    #[allow(dead_code)]
    pub fn get_emails_sent_to(&self, email: &Email) -> Vec<EmailTemplate> {
        let emails_sent = self
            .emails_sent
            .lock()
            .map_err(|e| anyhow::anyhow!("{e}").context("failed to acquire lock for emails_sent"))
            .unwrap();
        emails_sent
            .iter()
            .filter_map(|(e, template)| {
                if e == email {
                    Some(template.clone())
                } else {
                    None
                }
            })
            .collect()
    }
}

#[async_trait::async_trait]
impl EmailService for FakeEmailService {
    async fn send_email(&self, email: Email, template: EmailTemplate) -> Result<(), anyhow::Error> {
        self.attempts
            .lock()
            .unwrap()
            .push((email.clone(), template.clone()));
        if self.fail_sending.load(Ordering::SeqCst) {
            return Err(anyhow::anyhow!("injected email sending failure"));
        }
        debug!(
            "FakeEmailService: Sending email to {} with template: {:?}",
            email, template
        );
        let mut emails_sent = self.emails_sent.lock().map_err(|e| {
            anyhow::anyhow!("{e}").context("failed to acquire lock for emails_sent")
        })?;
        emails_sent.push((email, template));
        Ok(())
    }
}
