use crate::auth::handlers::html_templates::HtmlTemplate;
use askama::Template;

use super::html_templates::TemplateError;

#[derive(Template)]
#[template(path = "login.html")]
pub struct LoginTemplate {
    err: Option<String>,
}

impl LoginTemplate {
    pub fn new(err: Option<String>) -> Self {
        Self { err }
    }
}

pub async fn handle_render_login_email_form() -> Result<HtmlTemplate<LoginTemplate>, TemplateError>
{
    Ok(HtmlTemplate::new(LoginTemplate::new(None)))
}
