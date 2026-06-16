#[derive(Debug, Clone, sqlx::Type)]
#[sqlx(type_name = "TEXT")]
pub enum Topic {
    Users,
}
