use fake::{Dummy, Fake, rand};
use serde::{Deserialize, Serialize, de::Visitor};
use sqlx::{Database, Decode, Encode};

#[derive(Clone, PartialEq, Eq, Hash, Debug)]
pub struct Handle(String);

const INVALID_HANDLES: &[&str] = &["admin", "user", "test"];

impl Handle {
    /// Creates an `Handle` instance from a string slice, validating its format and mapping it to lowercase.
    /// # Arguments
    /// * `handle` - Input handle string to be validated and stored.
    /// # Errors
    /// * `HandleError::Empty` - Returned if the input handle string is empty after trimming.
    /// * `HandleError::InvalidFormat` - Returned if the input handle string does not conform to a valid format.
    pub fn new(handle: &str) -> Result<Self, HandleError> {
        let trimmed = handle.trim();
        if trimmed.is_empty() {
            return Err(HandleError::Empty);
        }

        // Matches only letters, numbers and hyphens, no spaces or special characters
        if !trimmed
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-')
        {
            return Err(HandleError::InvalidFormat);
        }

        if INVALID_HANDLES.contains(&trimmed) {
            return Err(HandleError::InvalidSpecificHandle);
        }

        if trimmed.len() > 30 || trimmed.len() < 4 {
            return Err(HandleError::InvalidFormat);
        }

        Ok(Self(trimmed.to_lowercase().to_string()))
    }

    /// Returns a string slice containing the handle.
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Creates an `Handle` instance without validating the input string.
    /// # Safety
    /// This function is unsafe because it does not validate the input string.
    /// The caller must ensure that the input string is a valid handle.
    pub fn new_unchecked(handle: &str) -> Self {
        Self(handle.to_lowercase().to_string())
    }
}

#[derive(Debug)]
pub enum HandleError {
    Empty,
    InvalidFormat,
    InvalidSpecificHandle,
}

impl std::fmt::Display for Handle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

// #######################################
// ############ SERIALIZATION ############
// #######################################

impl Serialize for Handle {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(self.as_str())
    }
}

struct HandleVisitor;

impl<'de> Visitor<'de> for HandleVisitor {
    type Value = Handle;

    fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
        formatter.write_str("a valid handle")
    }

    fn visit_str<E>(self, value: &str) -> Result<Handle, E>
    where
        E: serde::de::Error,
    {
        Handle::new(value).map_err(|err| match err {
            HandleError::Empty => E::custom("handle cannot be empty"),
            HandleError::InvalidFormat => E::custom("invalid handle format"),
            HandleError::InvalidSpecificHandle => E::custom("invalid specific handle"),
        })
    }
}

impl<'de> Deserialize<'de> for Handle {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        deserializer.deserialize_str(HandleVisitor)
    }
}

// ##############################################
// ############ DATABASE INTEGRATION ############
// ##############################################

impl<DB> sqlx::Type<DB> for Handle
where
    DB: Database,
    String: sqlx::Type<DB>,
{
    fn type_info() -> DB::TypeInfo {
        String::type_info()
    }
}

impl<'q, DB> Encode<'q, DB> for Handle
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

impl<'r, DB: Database> Decode<'r, DB> for Handle
where
    // we want to delegate some of the work to string decoding so let's make sure strings
    // are supported by the database
    &'r str: Decode<'r, DB>,
{
    fn decode(
        value: <DB as Database>::ValueRef<'r>,
    ) -> Result<Handle, Box<dyn std::error::Error + 'static + Send + Sync>> {
        // the interface of ValueRef is largely unstable at the moment
        // so this is not directly implementable

        // however, you can delegate to a type that matches the format of the type you want
        // to decode (such as a UTF-8 string)

        let value = <&str as Decode<DB>>::decode(value)?;

        Ok(Handle::new_unchecked(value))
    }
}

impl<T> Dummy<T> for Handle {
    fn dummy_with_rng<R: rand::Rng + ?Sized>(_: &T, rng: &mut R) -> Self {
        let handle: String = (5..10).fake_with_rng(rng);
        Handle::new(&handle).unwrap()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_handle_creation() {
        let handle = Handle::new("test-handle").unwrap();
        assert_eq!(handle.as_str(), "test-handle");
    }

    #[test]
    fn test_handle_creation_with_whitespace() {
        let handle = Handle::new(" test-handle ").unwrap();
        assert_eq!(handle.as_str(), "test-handle");
    }

    #[test]
    fn test_handle_creation_uppercase() {
        let handle = Handle::new("TEST-HANDLE").unwrap();
        assert_eq!(handle.as_str(), "test-handle");
    }

    #[test]
    fn test_handle_creation_empty() {
        let result = Handle::new("   ");
        assert!(matches!(result, Err(HandleError::Empty)));
    }

    #[test]
    fn test_handle_creation_invalid_length() {
        let result = Handle::new("ab");
        assert!(matches!(result, Err(HandleError::InvalidFormat)));

        let result = Handle::new("a".repeat(31).as_str());
        assert!(matches!(result, Err(HandleError::InvalidFormat)));
    }

    #[test]
    fn test_handle_creation_invalid_specific_handle() {
        let result = Handle::new("admin");
        assert!(matches!(result, Err(HandleError::InvalidSpecificHandle)));
    }

    #[test]
    fn test_handle_creation_invalid_format() {
        let invalid_handles = [
            "invalid_handle_with_underscores",
            "invalid.handle.with.dots",
            "invalid handle with spaces",
        ];
        for &invalid_handle in &invalid_handles {
            let result = Handle::new(invalid_handle);
            assert!(
                matches!(result, Err(HandleError::InvalidFormat)),
                "Expected '{}' to be invalid",
                invalid_handle
            );
        }
    }

    #[test]
    fn test_handle_unchecked_creation() {
        let handle = Handle::new_unchecked("invalid-handle");
        assert_eq!(handle.as_str(), "invalid-handle");
    }

    #[test]
    fn test_handle_serialization() {
        let handle = Handle::new("testhandle").unwrap();
        let serialized = serde_json::to_string(&handle).unwrap();
        assert_eq!(serialized, "\"testhandle\"");
    }

    #[test]
    fn test_handle_deserialization() {
        let handle = Handle::new("testhandle").unwrap();
        let deserialized: Handle = serde_json::from_str("\"testhandle\"").unwrap();
        assert_eq!(handle, deserialized);
    }

    #[test]
    fn test_handle_failing_deserialization() {
        let deserialized: Result<Handle, _> = serde_json::from_str("\"invalid_handle\"");
        assert!(deserialized.is_err());
        assert!(
            deserialized
                .err()
                .unwrap()
                .to_string()
                .contains("invalid handle format")
        );
    }
}
