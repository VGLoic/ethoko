use serde::{Deserialize, Serialize, de::Visitor};
use sqlx::{Database, Decode, Encode};
use validator::ValidateEmail;

#[derive(Clone, PartialEq, Eq, Hash, Debug)]
pub struct Email(String);

impl Email {
    /// Creates an `Email` instance from a string slice, validating its format and mapping it to lowercase.
    /// # Arguments
    /// * `email` - Input email string to be validated and stored.
    /// # Errors
    /// * `EmailError::Empty` - Returned if the input email string is empty after trimming.
    /// * `EmailError::InvalidFormat` - Returned if the input email string does not conform to a valid email format.
    pub fn new(email: &str) -> Result<Self, EmailError> {
        let trimmed = email.trim();
        if trimmed.is_empty() {
            return Err(EmailError::Empty);
        }

        if !trimmed.validate_email() {
            return Err(EmailError::InvalidFormat);
        }

        Ok(Self(trimmed.to_lowercase().to_string()))
    }

    /// Returns a string slice containing the email address.
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Creates an `Email` instance without validating the input string.
    /// # Safety
    /// This function is unsafe because it does not validate the input string.
    /// The caller must ensure that the input string is a valid email address.
    pub fn new_unchecked(email: &str) -> Self {
        Self(email.to_lowercase().to_string())
    }
}

#[derive(Debug)]
pub enum EmailError {
    Empty,
    InvalidFormat,
}

impl std::fmt::Display for Email {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

// #######################################
// ############ SERIALIZATION ############
// #######################################

impl Serialize for Email {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(self.as_str())
    }
}

struct EmailVisitor;

impl<'de> Visitor<'de> for EmailVisitor {
    type Value = Email;

    fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
        formatter.write_str("a valid email address")
    }

    fn visit_str<E>(self, value: &str) -> Result<Email, E>
    where
        E: serde::de::Error,
    {
        Email::new(value).map_err(|err| match err {
            EmailError::Empty => E::custom("email cannot be empty"),
            EmailError::InvalidFormat => E::custom("invalid email format"),
        })
    }
}

impl<'de> Deserialize<'de> for Email {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        deserializer.deserialize_str(EmailVisitor)
    }
}

// ##############################################
// ############ DATABASE INTEGRATION ############
// ##############################################

impl<DB> sqlx::Type<DB> for Email
where
    DB: Database,
    String: sqlx::Type<DB>,
{
    fn type_info() -> DB::TypeInfo {
        String::type_info()
    }
}

impl<'q, DB> Encode<'q, DB> for Email
where
    DB: Database,
    String: Encode<'q, DB>,
{
    // Required method
    fn encode_by_ref(
        &self,
        buf: &mut <DB as Database>::ArgumentBuffer<'q>,
    ) -> Result<sqlx::encode::IsNull, Box<dyn std::error::Error + Sync + Send>> {
        <String as Encode<'q, DB>>::encode_by_ref(&self.0, buf)
    }
}

impl<'r, DB: Database> Decode<'r, DB> for Email
where
    // we want to delegate some of the work to string decoding so let's make sure strings
    // are supported by the database
    &'r str: Decode<'r, DB>,
{
    fn decode(
        value: <DB as Database>::ValueRef<'r>,
    ) -> Result<Email, Box<dyn std::error::Error + 'static + Send + Sync>> {
        // the interface of ValueRef is largely unstable at the moment
        // so this is not directly implementable

        // however, you can delegate to a type that matches the format of the type you want
        // to decode (such as a UTF-8 string)

        let value = <&str as Decode<DB>>::decode(value)?;

        Ok(Email::new_unchecked(value))
    }
}

mod tests {
    use super::*;

    #[test]
    fn test_email_creation() {
        let email = Email::new("test@example.com").unwrap();
        assert_eq!(email.as_str(), "test@example.com");
    }

    #[test]
    fn test_email_creation_with_whitespace() {
        let email = Email::new(" test@example.com ").unwrap();
        assert_eq!(email.as_str(), "test@example.com");
    }

    #[test]
    fn test_email_creation_uppercase() {
        let email = Email::new("TesT@Example.com").unwrap();
        assert_eq!(email.as_str(), "test@example.com");
    }

    #[test]
    fn test_email_creation_empty() {
        let result = Email::new("   ");
        assert!(matches!(result, Err(EmailError::Empty)));
    }

    #[test]
    fn test_email_creation_invalid_format() {
        let invalid_emails = [
            "plainaddress",
            "@missingusername.com",
            "username@.com",
            "username@domain..com",
        ];
        for &invalid_email in &invalid_emails {
            let result = Email::new(invalid_email);
            assert!(
                matches!(result, Err(EmailError::InvalidFormat)),
                "Expected '{}' to be invalid",
                invalid_email
            );
        }
    }

    #[test]
    fn test_email_unchecked_creation() {
        let email = Email::new_unchecked("invalid-email");
        assert_eq!(email.as_str(), "invalid-email");
    }

    #[test]
    fn test_email_serialization() {
        let email = Email::new("test@example.com").unwrap();
        let serialized = serde_json::to_string(&email).unwrap();
        assert_eq!(serialized, "\"test@example.com\"");
    }

    #[test]
    fn test_email_deserialization() {
        let email = Email::new("test@example.com").unwrap();
        let deserialized: Email = serde_json::from_str("\"test@example.com\"").unwrap();
        assert_eq!(email, deserialized);
    }

    #[test]
    fn test_email_failing_deserialization() {
        let deserialized: Result<Email, _> = serde_json::from_str("\"invalid-email\"");
        assert!(deserialized.is_err());
        assert!(
            deserialized
                .err()
                .unwrap()
                .to_string()
                .contains("invalid email format")
        );
    }
}
