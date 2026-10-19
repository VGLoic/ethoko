use ethoko_central::{
    externalcom::email::{EmailService, EmailVerificationCodePayload, LocalEmailService},
    newtypes::{email::Email, otp::Otp},
};

#[tokio::test]
async fn deliveries_capture_readable_verification_messages_in_separate_files() {
    let directory = std::env::temp_dir().join(format!("central-email-{}", uuid::Uuid::new_v4()));
    let service = LocalEmailService::new("https://app.example.com".into(), directory.clone());
    let email = Email::new("reader+local@example.com").unwrap();
    let before = chrono::Utc::now();
    for _ in 0..2 {
        service
            .send_email(
                email.clone(),
                EmailVerificationCodePayload::new(email.clone(), Otp::from("123456")).into(),
            )
            .await
            .unwrap();
    }
    let files: Vec<_> = std::fs::read_dir(&directory).unwrap().collect();
    assert_eq!(files.len(), 2);
    for file in files {
        let path = file.unwrap().path();
        assert_eq!(path.extension().unwrap(), "json");
        let content = std::fs::read_to_string(path).unwrap();
        assert!(content.contains('\n'), "capture is human-readable");
        let message: serde_json::Value = serde_json::from_str(&content).unwrap();
        assert_eq!(message["recipient"], "reader+local@example.com");
        assert_eq!(message["kind"], "email-verification-code");
        let timestamp =
            chrono::DateTime::parse_from_rfc3339(message["delivered_at"].as_str().unwrap())
                .unwrap();
        assert!(timestamp >= before && timestamp <= chrono::Utc::now());
        assert_eq!(
            message["verification_url"],
            "https://app.example.com/verify-email?email=reader%2Blocal%40example.com&otp=123456"
        );
    }
    std::fs::remove_dir_all(directory).unwrap();
}

#[tokio::test]
async fn capture_write_failures_are_returned_to_the_job_processor() {
    let path = std::env::temp_dir().join(format!("central-email-{}", uuid::Uuid::new_v4()));
    std::fs::write(&path, "not a directory").unwrap();
    let service = LocalEmailService::new("https://app.example.com".into(), path.clone());
    let email = Email::new("reader@example.com").unwrap();
    let result = service
        .send_email(
            email.clone(),
            EmailVerificationCodePayload::new(email, Otp::from("123456")).into(),
        )
        .await;
    assert!(
        result.is_err(),
        "failed capture must not acknowledge delivery"
    );
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "not a directory");
    std::fs::remove_file(path).unwrap();
}
