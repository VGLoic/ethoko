use anyhow::anyhow;
use argon2::{Algorithm, Argon2, Params, Version};
use argon2::{
    PasswordHash,
    password_hash::{PasswordHasher, PasswordVerifier, Salt},
};
use base64::{Engine, prelude::BASE64_STANDARD_NO_PAD};
use fake::rand;

use crate::newtypes::password::Password;

const ARGON2_MEMORY_COST: u32 = Params::DEFAULT_M_COST;
const ARGON2_TIME_COST: u32 = Params::DEFAULT_T_COST;
const ARGON2_PARALLELISM: u32 = Params::DEFAULT_P_COST;

fn argon2_instance() -> Argon2<'static> {
    Argon2::new(
        Algorithm::Argon2id,
        Version::V0x13,
        Params::new(
            ARGON2_MEMORY_COST,
            ARGON2_TIME_COST,
            ARGON2_PARALLELISM,
            None,
        )
        .expect("Invalid Argon2 parameters"),
    )
}

/// Hashes a password using Argon2Id algorithm.
pub fn hash_password(password: &Password) -> Result<String, anyhow::Error> {
    let salt: [u8; 16] = rand::random();
    let base64_salt = BASE64_STANDARD_NO_PAD.encode(salt);
    let argon_salt = Salt::from_b64(&base64_salt)
        .map_err(|e| anyhow!(e).context("failed to build Salt struct from base64 salt string"))?;

    argon2_instance()
        .hash_password(password.as_str().as_bytes(), argon_salt)
        .map_err(|e| anyhow!(e).context("failed to hash password"))
        .map(|v| v.to_string())
}

#[allow(dead_code)]
/// Verifies a password against a stored hash.
pub fn verify_password(password: &Password, hash: &str) -> Result<(), anyhow::Error> {
    let parsed_hash = PasswordHash::new(hash)
        .map_err(|e| anyhow!(e).context("failed to parse stored password hash"))?;
    match argon2_instance().verify_password(password.as_str().as_bytes(), &parsed_hash) {
        Ok(_) => Ok(()),
        Err(argon2::password_hash::Error::Password) => Err(anyhow!("invalid password")),
        Err(e) => Err(anyhow!(e).context("failed to verify password")),
    }
}

#[cfg(test)]
mod tests {
    use fake::{Fake, Faker};

    use super::*;

    #[test]
    fn test_hash_password() {
        let password: Password = Faker.fake();
        let hash = hash_password(&password).unwrap();
        assert!(!hash.is_empty());
    }

    #[test]
    fn test_verify_password() {
        let password: Password = Faker.fake();
        let hash = hash_password(&password).unwrap();
        assert!(verify_password(&password, &hash).is_ok());
    }

    #[test]
    fn test_verify_password_invalid() {
        let password: Password = Faker.fake();
        let hash = hash_password(&password).unwrap();
        let different_password: Password = Faker.fake();
        assert!(verify_password(&different_password, &hash).is_err());
    }
}
