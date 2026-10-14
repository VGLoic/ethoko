use crate::newtypes::{email::Email, github_id::GithubId};

pub struct GithubUser {
    pub id: GithubId,
    pub username: String,
    pub primary_email: Email,
    pub email_verified: bool,
}
