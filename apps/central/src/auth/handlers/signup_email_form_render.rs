use crate::auth::handlers::html_templates::HtmlTemplate;
use askama::Template;

use super::html_templates::TemplateError;

#[derive(Template)]
#[template(path = "signup.html")]
pub struct SignupTemplate {
    err: Option<String>,
}

impl SignupTemplate {
    pub fn new(err: Option<String>) -> Self {
        Self { err }
    }
}

pub async fn handle_render_signup_email_form() -> Result<HtmlTemplate<SignupTemplate>, TemplateError>
{
    Ok(HtmlTemplate::new(SignupTemplate::new(None)))
}
