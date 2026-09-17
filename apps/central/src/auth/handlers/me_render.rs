use crate::{
    auth::{
        authenticated_user::AuthenticatedUserPages,
        handlers::html_templates::{HtmlTemplate, TemplateError},
    },
    newtypes::{email::Email, handle::Handle},
};
use askama::Template;

#[derive(Template)]
#[template(path = "me.html")]
pub struct MeTemplate {
    email: Email,
    handle: Handle,
}

pub async fn handle_render_me(
    authenticated_user: AuthenticatedUserPages,
) -> Result<HtmlTemplate<MeTemplate>, TemplateError> {
    Ok(HtmlTemplate::new(MeTemplate {
        email: authenticated_user.user.email,
        handle: authenticated_user.user.handle,
    }))
}
