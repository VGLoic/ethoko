use std::time::Duration;

use chrono::{Days, TimeDelta, Utc};
use ethoko_central::jobs::{
    job::Job, memoryqueue::InMemoryQueue, psqlqueue::PsqlQueue, queue::Queue,
};
use serde::{Deserialize, Serialize};
use sqlx::postgres::PgPoolOptions;
use tokio::time::sleep;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct TestJobPayload {
    pub message: String,
}

async fn setup_psql_queue() -> Result<PsqlQueue, anyhow::Error> {
    let pool = match PgPoolOptions::new()
        .max_connections(5)
        .acquire_timeout(Duration::from_secs(5))
        .connect("postgresql://admin:admin@localhost:5433/central")
        .await
    {
        Ok(c) => c,
        Err(e) => {
            let err = format!("Failed to establish connection to database {e}");
            return Err(anyhow::anyhow!(err));
        }
    };

    if let Err(e) = sqlx::migrate!("./migrations").run(&pool).await {
        let err = format!("Failed to run database migrations: {e}");
        return Err(anyhow::anyhow!(err));
    };

    Ok(PsqlQueue::new(1, pool))
}

#[tokio::test]
async fn test_enqueue_single_job_psql_queue() {
    let queue = setup_psql_queue().await.unwrap();
    test_enqueue_single_job(queue).await;
}

#[tokio::test]
async fn test_enqueue_single_job_memory_queue() {
    let queue = InMemoryQueue::new(1);
    test_enqueue_single_job(queue).await;
}

async fn test_enqueue_single_job<Q: Queue>(queue: Q) {
    let payload = TestJobPayload {
        message: "Hello, world!".to_string(),
    };
    let job = Job::new("test-topic".to_string(), payload)
        .unwrap()
        .with_scheduled_at(Utc::now().checked_add_days(Days::new(1)).unwrap());

    queue.enqueue(job.clone()).await.unwrap();
    let idle_jobs = queue.idle_jobs().await.unwrap();
    assert!(idle_jobs.iter().any(|j| j.id == job.id));
}

#[tokio::test]
async fn test_enqueue_multiple_jobs_psql_queue() {
    let queue = setup_psql_queue().await.unwrap();
    test_enqueue_multiple_jobs(queue).await;
}

#[tokio::test]
async fn test_enqueue_multiple_jobs_memory_queue() {
    let queue = InMemoryQueue::new(1);
    test_enqueue_multiple_jobs(queue).await;
}

async fn test_enqueue_multiple_jobs<Q: Queue>(queue: Q) {
    let payload1 = TestJobPayload {
        message: "Hello, world!".to_string(),
    };
    let payload2 = TestJobPayload {
        message: "Goodbye, world!".to_string(),
    };
    let job1 = Job::new("test-topic".to_string(), payload1)
        .unwrap()
        .with_scheduled_at(Utc::now().checked_add_signed(TimeDelta::days(1)).unwrap());
    let job2 = Job::new("test-topic".to_string(), payload2)
        .unwrap()
        .with_scheduled_at(Utc::now().checked_add_signed(TimeDelta::days(1)).unwrap());

    queue.enqueue(job1.clone()).await.unwrap();
    queue.enqueue(job2.clone()).await.unwrap();
    let idle_jobs = queue.idle_jobs().await.unwrap();
    assert!(idle_jobs.len() >= 2);
    assert!(idle_jobs.iter().any(|j| j.id == job1.id));
    assert!(idle_jobs.iter().any(|j| j.id == job2.id));
}

#[tokio::test]
async fn test_dequeue_ready_job_psql_queue() {
    let queue = setup_psql_queue().await.unwrap();
    test_dequeue_ready_job(queue).await;
}

#[tokio::test]
async fn test_dequeue_ready_job_memory_queue() {
    let queue = InMemoryQueue::new(1);
    test_dequeue_ready_job(queue).await;
}

async fn test_dequeue_ready_job<Q: Queue>(queue: Q) {
    let payload = TestJobPayload {
        message: "Hello, world!".to_string(),
    };
    let job = Job::new("test-topic".to_string(), payload)
        .unwrap()
        .with_scheduled_at(
            Utc::now()
                .checked_sub_signed(TimeDelta::seconds(1))
                .unwrap(),
        );
    queue.enqueue(job.clone()).await.unwrap();
    let _ = queue.dequeue().await.unwrap();
    assert!(
        queue
            .idle_jobs()
            .await
            .unwrap()
            .iter()
            .all(|j| j.id != job.id)
    );
    assert!(
        queue
            .ready_jobs()
            .await
            .unwrap()
            .iter()
            .any(|j| j.id == job.id)
    );
}

#[tokio::test]
async fn test_dequeue_not_ready_job_psql_queue() {
    let queue = setup_psql_queue().await.unwrap();
    test_dequeue_not_ready_job(queue).await;
}

#[tokio::test]
async fn test_dequeue_not_ready_job_memory_queue() {
    let queue = InMemoryQueue::new(1);
    test_dequeue_not_ready_job(queue).await;
}

async fn test_dequeue_not_ready_job<Q: Queue>(queue: Q) {
    let payload = TestJobPayload {
        message: "Hello, world!".to_string(),
    };
    let job = Job::new("test-topic".to_string(), payload)
        .unwrap()
        .with_scheduled_at(
            Utc::now()
                .checked_add_signed(TimeDelta::seconds(20))
                .unwrap(),
        );
    queue.enqueue(job.clone()).await.unwrap();
    let _ = queue.dequeue().await.unwrap();
    assert!(
        queue
            .idle_jobs()
            .await
            .unwrap()
            .iter()
            .any(|j| j.id == job.id)
    );
    assert!(
        queue
            .ready_jobs()
            .await
            .unwrap()
            .iter()
            .all(|j| j.id != job.id)
    );
}

#[tokio::test]
async fn test_success_process_psql_queue() {
    let queue = setup_psql_queue().await.unwrap();
    test_success_process(queue).await;
}

#[tokio::test]
async fn test_success_process_memory_queue() {
    let queue = InMemoryQueue::new(1);
    test_success_process(queue).await;
}

async fn test_success_process<Q: Queue>(queue: Q) {
    let payload = TestJobPayload {
        message: "Hello, world!".to_string(),
    };
    let job = Job::new("test-topic".to_string(), payload)
        .unwrap()
        .with_scheduled_at(
            Utc::now()
                .checked_sub_signed(TimeDelta::seconds(1))
                .unwrap(),
        );
    queue.enqueue(job.clone()).await.unwrap();
    let _ = queue.dequeue().await.unwrap().unwrap();

    queue.success(job.id).await.unwrap();
    assert!(
        queue
            .idle_jobs()
            .await
            .unwrap()
            .iter()
            .all(|j| j.id != job.id)
    );
    assert!(
        queue
            .ready_jobs()
            .await
            .unwrap()
            .iter()
            .all(|j| j.id != job.id)
    );
}

#[tokio::test]
async fn test_fail_process_memory_queue() {
    let queue = InMemoryQueue::new(1);
    test_fail_process(queue).await;
}
#[tokio::test]
async fn test_fail_process_psql_queue() {
    let queue = setup_psql_queue().await.unwrap();
    test_fail_process(queue).await;
}

async fn test_fail_process<Q: Queue>(queue: Q) {
    let payload = TestJobPayload {
        message: "Hello, world!".to_string(),
    };
    let job = Job::new("test-topic".to_string(), payload)
        .unwrap()
        .with_scheduled_at(
            Utc::now()
                .checked_sub_signed(TimeDelta::seconds(1))
                .unwrap(),
        )
        .with_max_retries(3);
    queue.enqueue(job.clone()).await.unwrap();
    let _ = queue.dequeue().await.unwrap().unwrap();

    queue.fail(job.id).await.unwrap();
    sleep(Duration::from_secs(2)).await;
    let _ = queue.dequeue().await.unwrap().unwrap();

    assert!(
        queue
            .idle_jobs()
            .await
            .unwrap()
            .iter()
            .all(|j| j.id != job.id)
    );
    assert!(
        queue
            .ready_jobs()
            .await
            .unwrap()
            .iter()
            .any(|j| j.id == job.id)
    );
}

#[tokio::test]
async fn test_fail_process_exceeding_retries_memory_queue() {
    let queue = InMemoryQueue::new(1);
    test_fail_process_exceeding_retries(queue).await;
}

#[tokio::test]
async fn test_fail_process_exceeding_retries_psql_queue() {
    let queue = setup_psql_queue().await.unwrap();
    test_fail_process_exceeding_retries(queue).await;
}

async fn test_fail_process_exceeding_retries<Q: Queue>(queue: Q) {
    let payload = TestJobPayload {
        message: "Hello, world!".to_string(),
    };
    let job = Job::new("test-topic".to_string(), payload)
        .unwrap()
        .with_scheduled_at(
            Utc::now()
                .checked_sub_signed(TimeDelta::seconds(1))
                .unwrap(),
        )
        .with_max_retries(1);
    queue.enqueue(job.clone()).await.unwrap();

    let _ = queue.dequeue().await.unwrap().unwrap();
    queue.fail(job.id).await.unwrap();
    sleep(Duration::from_secs(1)).await;
    let _ = queue.dequeue().await.unwrap().unwrap();
    queue.fail(job.id).await.unwrap();

    let dead_jobs = queue.dead_jobs().await.unwrap();
    assert!(!dead_jobs.is_empty());
    assert!(dead_jobs.iter().any(|j| j.id == job.id));
}

#[tokio::test]
async fn test_fail_into_success_memory_queue() {
    let queue = InMemoryQueue::new(1);
    test_fail_into_success(queue).await;
}

#[tokio::test]
async fn test_fail_into_success_psql_queue() {
    let queue = setup_psql_queue().await.unwrap();
    test_fail_into_success(queue).await;
}

async fn test_fail_into_success<Q: Queue>(queue: Q) {
    let payload = TestJobPayload {
        message: "Hello, world!".to_string(),
    };
    let job = Job::new("test-topic".to_string(), payload)
        .unwrap()
        .with_scheduled_at(
            Utc::now()
                .checked_sub_signed(TimeDelta::seconds(1))
                .unwrap(),
        )
        .with_max_retries(3);
    queue.enqueue(job.clone()).await.unwrap();

    let _ = queue.dequeue().await.unwrap().unwrap();
    queue.fail(job.id).await.unwrap();
    sleep(Duration::from_secs(1)).await;
    let _ = queue.dequeue().await.unwrap().unwrap();

    queue.success(job.id).await.unwrap();
    let _ = queue.dequeue().await.unwrap();
    assert!(
        queue
            .idle_jobs()
            .await
            .unwrap()
            .iter()
            .all(|j| j.id != job.id)
    );
    assert!(
        queue
            .ready_jobs()
            .await
            .unwrap()
            .iter()
            .all(|j| j.id != job.id)
    );
}
