use super::InstanceState;
use ethoko_central::newtypes::email::Email;

/// Database fault injection is scoped to a randomized email, so parallel HTTP
/// tests sharing the integration database are unaffected. No row assertions.
#[allow(dead_code)]
impl InstanceState {
    pub async fn fail_otp_writes(&self, email: &Email, operation: &str) -> String {
        assert!(matches!(operation, "INSERT" | "UPDATE"));
        let name = format!("otp_fault_{}", uuid::Uuid::new_v4().simple());
        let email = email.to_string().replace('\'', "''");
        let sql = format!(
            "CREATE FUNCTION {name}() RETURNS trigger LANGUAGE plpgsql AS $$
             BEGIN
               IF EXISTS (SELECT 1 FROM ethoko_user WHERE id = NEW.user_id AND email = '{email}') THEN
                 RAISE EXCEPTION 'injected otp persistence failure';
               END IF;
               RETURN NEW;
             END; $$;
             CREATE TRIGGER {name} BEFORE {operation} ON otp_request
             FOR EACH ROW EXECUTE FUNCTION {name}();"
        );
        sqlx::raw_sql(&sql).execute(&self.pool).await.unwrap();
        name
    }

    pub async fn clear_otp_fault(&self, name: &str) {
        assert!(
            name.starts_with("otp_fault_")
                && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
        );
        sqlx::raw_sql(&format!(
            "DROP TRIGGER {name} ON otp_request; DROP FUNCTION {name}();"
        ))
        .execute(&self.pool)
        .await
        .unwrap();
    }
}
