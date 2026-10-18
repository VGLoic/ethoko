use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use ethoko_central::{
    externalcom::email::{EmailService, EmailTemplate},
    newtypes::email::Email,
};
use tracing::debug;

#[derive(Debug, Clone)]
pub struct FakeEmailService {
    pub emails_sent: Arc<Mutex<Vec<(Email, EmailTemplate)>>>,
    pub email_attempts: Arc<Mutex<Vec<(Email, EmailTemplate)>>>,
    failures_remaining: Arc<AtomicUsize>,
}

impl Default for FakeEmailService {
    fn default() -> Self {
        Self {
            emails_sent: Arc::new(Mutex::new(vec![])),
            email_attempts: Arc::new(Mutex::new(vec![])),
            failures_remaining: Arc::new(AtomicUsize::new(0)),
        }
    }
}

impl FakeEmailService {
    #[allow(dead_code)]
    pub fn fail_next_emails(&self, count: usize) {
        self.failures_remaining.store(count, Ordering::SeqCst);
    }

    #[allow(dead_code)]
    pub fn get_attempts_to(&self, email: &Email) -> Vec<EmailTemplate> {
        self.email_attempts
            .lock()
            .unwrap()
            .iter()
            .filter(|(recipient, _)| recipient == email)
            .map(|(_, template)| template.clone())
            .collect()
    }
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
        self.email_attempts
            .lock()
            .unwrap()
            .push((email.clone(), template.clone()));
        if self
            .failures_remaining
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |remaining| {
                remaining.checked_sub(1)
            })
            .is_ok()
        {
            return Err(anyhow::anyhow!("simulated delivery failure"));
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
