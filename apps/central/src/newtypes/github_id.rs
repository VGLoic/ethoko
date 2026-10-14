#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GithubId(u64);

impl GithubId {
    pub fn new(id: u64) -> Self {
        Self(id)
    }

    pub fn as_u64(&self) -> u64 {
        self.0
    }
}
