use crate::newtypes::email::Email;

pub struct GithubUser {
    pub id: u64,
    pub username: String,
    pub primary_email: Email,
    pub email_verified: bool,
}
