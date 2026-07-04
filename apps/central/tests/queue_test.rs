use std::time::Duration;

use chrono::{Days, TimeDelta, Utc};
use ethoko_central::jobs::{
    job::JobRequest, memoryqueue::InMemoryQueue, psqlqueue::PsqlQueue, queue::Queue,
};
use fake::rand::{self, seq::SliceRandom};
use serde::{Deserialize, Serialize};
use sqlx::{Pool, Postgres};
use tokio::time::sleep;
use tracing::{Level, level_filters::LevelFilter};
use tracing_subscriber::{Layer, layer::SubscriberExt, util::SubscriberInitExt};

#[derive(Debug, Clone, Serialize, Deserialize)]
struct TestJobPayload {
    pub message: String,
}

const RETRY_DELAY_SECONDS: u16 = 1;

#[sqlx::test]
async fn test_psql_dequeue_non_ready_job(pool: Pool<Postgres>) {
    setup();
    let queue = PsqlQueue::new(RETRY_DELAY_SECONDS, pool);
    test_dequeue_non_ready_job(queue).await;
}

#[tokio::test]
async fn test_memory_dequeue_non_ready_job() {
    setup();
    let queue = InMemoryQueue::new(RETRY_DELAY_SECONDS);
    test_dequeue_non_ready_job(queue).await;
}

#[sqlx::test]
async fn test_psql_dequeue_ready_job(pool: Pool<Postgres>) {
    setup();
    let queue = PsqlQueue::new(RETRY_DELAY_SECONDS, pool);
    test_dequeue_ready_job(queue).await;
}

#[tokio::test]
async fn test_memory_dequeue_ready_job() {
    setup();
    let queue = InMemoryQueue::new(RETRY_DELAY_SECONDS);
    test_dequeue_ready_job(queue).await;
}

#[sqlx::test]
async fn test_psql_successive_dequeue_ready_job(pool: Pool<Postgres>) {
    setup();
    let queue = PsqlQueue::new(RETRY_DELAY_SECONDS, pool);
    test_successive_dequeue_ready_job(queue).await;
}

#[tokio::test]
async fn test_memory_successive_dequeue_ready_job() {
    setup();
    let queue = InMemoryQueue::new(RETRY_DELAY_SECONDS);
    test_successive_dequeue_ready_job(queue).await;
}

#[sqlx::test]
async fn test_psql_process_timeout(pool: Pool<Postgres>) {
    setup();
    let queue = PsqlQueue::new(RETRY_DELAY_SECONDS, pool);
    test_process_timeout(queue).await;
}

#[tokio::test]
async fn test_memory_process_timeout() {
    setup();
    let queue = InMemoryQueue::new(RETRY_DELAY_SECONDS);
    test_process_timeout(queue).await;
}

#[sqlx::test]
async fn test_psql_process_timeout_into_dead(pool: Pool<Postgres>) {
    setup();
    let queue = PsqlQueue::new(RETRY_DELAY_SECONDS, pool);
    test_process_timeout_into_dead(queue).await;
}

#[tokio::test]
async fn test_memory_process_timeout_into_dead() {
    setup();
    let queue = InMemoryQueue::new(RETRY_DELAY_SECONDS);
    test_process_timeout_into_dead(queue).await;
}

#[sqlx::test]
async fn test_psql_process_success(pool: Pool<Postgres>) {
    setup();
    let queue = PsqlQueue::new(RETRY_DELAY_SECONDS, pool);
    test_process_success(queue).await;
}

#[tokio::test]
async fn test_memory_process_success() {
    setup();
    let queue = InMemoryQueue::new(RETRY_DELAY_SECONDS);
    test_process_success(queue).await;
}

#[sqlx::test]
async fn test_psql_process_fail_into_success(pool: Pool<Postgres>) {
    setup();
    let queue = PsqlQueue::new(RETRY_DELAY_SECONDS, pool);
    test_process_fail_into_success(queue).await;
}

#[tokio::test]
async fn test_memory_process_fail_into_success() {
    setup();
    let queue = InMemoryQueue::new(RETRY_DELAY_SECONDS);
    test_process_fail_into_success(queue).await;
}

#[sqlx::test]
async fn test_psql_process_fail_into_dead(pool: Pool<Postgres>) {
    setup();
    let queue = PsqlQueue::new(RETRY_DELAY_SECONDS, pool);
    test_process_fail_into_dead(queue).await;
}

#[tokio::test]
async fn test_memory_process_fail_into_dead() {
    setup();
    let queue = InMemoryQueue::new(RETRY_DELAY_SECONDS);
    test_process_fail_into_dead(queue).await;
}

#[sqlx::test]
async fn test_psql_retry_dead_job(pool: Pool<Postgres>) {
    setup();
    let queue = PsqlQueue::new(RETRY_DELAY_SECONDS, pool);
    test_retry_dead_job(queue).await;
}

#[tokio::test]
async fn test_memory_retry_dead_job() {
    setup();
    let queue = InMemoryQueue::new(RETRY_DELAY_SECONDS);
    test_retry_dead_job(queue).await;
}

#[sqlx::test]
async fn test_psql_dequeued_jobs_in_scheduled_at_order(pool: Pool<Postgres>) {
    setup();
    let queue = PsqlQueue::new(RETRY_DELAY_SECONDS, pool);
    test_dequeued_jobs_in_scheduled_at_order(queue).await;
}

#[tokio::test]
async fn test_memory_dequeued_jobs_in_scheduled_at_order() {
    setup();
    let queue = InMemoryQueue::new(RETRY_DELAY_SECONDS);
    test_dequeued_jobs_in_scheduled_at_order(queue).await;
}

fn dummy_job() -> JobRequest {
    let payload = TestJobPayload {
        message: "Hello, world!".to_string(),
    };
    JobRequest::new("test-topic".to_string(), payload)
        .unwrap()
        // We substract a few milliseconds because the PSQL queue does not pick up the job otherwise
        // The dequeue query contains a "<=" so it is strange
        // There may be a clock issue between the database and the application, but it is not clear
        .with_scheduled_at(
            Utc::now()
                .checked_sub_signed(TimeDelta::milliseconds(10))
                .unwrap(),
        )
}

fn setup() {
    let _ = tracing_subscriber::registry()
        .with(tracing_subscriber::fmt::layer().with_filter(LevelFilter::from_level(Level::INFO)))
        .try_init();
}

async fn test_dequeue_non_ready_job<Q: Queue>(queue: Q) {
    let job_request =
        dummy_job().with_scheduled_at(Utc::now().checked_add_days(Days::new(1)).unwrap());

    let _ = queue.enqueue(job_request).await.unwrap();
    let dequeued_job = queue.dequeue().await.unwrap();

    assert!(dequeued_job.is_none(), "dequeued_job must be none");
}

async fn test_dequeue_ready_job<Q: Queue>(queue: Q) {
    let job_request = dummy_job();

    let job = queue.enqueue(job_request).await.unwrap();
    let dequeued_job = queue.dequeue().await.unwrap();
    assert!(dequeued_job.is_some(), "dequeued job must be some");
    let dequeued_job = dequeued_job.unwrap();
    assert_eq!(
        dequeued_job.id, job.id,
        "dequeued job must have expected ID {}, got {}",
        dequeued_job.id, job.id
    );
}

async fn test_successive_dequeue_ready_job<Q: Queue>(queue: Q) {
    let job_request = dummy_job();

    let _ = queue.enqueue(job_request).await.unwrap();
    let dequeued_job_0 = queue.dequeue().await.unwrap();
    let dequeued_job_1 = queue.dequeue().await.unwrap();
    assert!(dequeued_job_0.is_some(), "first dequeue must be some");
    assert!(dequeued_job_1.is_none(), "second dequeue must be none");
}

async fn test_process_timeout<Q: Queue>(queue: Q) {
    let processing_timeout_in_seconds = 1_u16;
    let job_request = dummy_job().with_processing_timeout(processing_timeout_in_seconds);

    let job = queue.enqueue(job_request).await.unwrap();
    let _ = queue.dequeue().await.unwrap();
    let seconds_to_wait = RETRY_DELAY_SECONDS.max(processing_timeout_in_seconds);
    sleep(Duration::from_secs(seconds_to_wait.into())).await;
    queue.cleanup_timeout_jobs().await.unwrap();
    let dequeued_job = queue.dequeue().await.unwrap();

    assert!(dequeued_job.is_some(), "dequeued job must be some");
    let dequeued_job = dequeued_job.unwrap();
    assert_eq!(
        dequeued_job.id, job.id,
        "dequeued job has not the same ID as the original one"
    );
    assert_eq!(
        dequeued_job.retry_count, 1,
        "dequeued job should have an increasing retry count"
    );
}

async fn test_process_timeout_into_dead<Q: Queue>(queue: Q) {
    let processing_timeout_in_seconds = 1_u16;
    let job_request = dummy_job()
        .with_processing_timeout(processing_timeout_in_seconds)
        .with_max_retries(1);

    let _ = queue.enqueue(job_request).await.unwrap();
    let _ = queue.dequeue().await.unwrap();
    let seconds_to_wait = RETRY_DELAY_SECONDS.max(processing_timeout_in_seconds);
    sleep(Duration::from_secs(seconds_to_wait.into())).await;
    queue.cleanup_timeout_jobs().await.unwrap();
    let _ = queue.dequeue().await.unwrap();
    sleep(Duration::from_secs(seconds_to_wait.into())).await;
    queue.cleanup_timeout_jobs().await.unwrap();
    let dequeued_job = queue.dequeue().await.unwrap();

    assert!(dequeued_job.is_none(), "dequeued job must be none");
}

async fn test_process_success<Q: Queue>(queue: Q) {
    let job_request = dummy_job();

    let job = queue.enqueue(job_request).await.unwrap();
    let _ = queue.dequeue().await.unwrap().unwrap();
    queue.success(job.id).await.unwrap();
    let dequeued_job = queue.dequeue().await.unwrap();

    assert!(dequeued_job.is_none(), "dequeued job must be none");
}

async fn test_process_fail_into_success<Q: Queue>(queue: Q) {
    let job_request = dummy_job().with_max_retries(1);

    let job = queue.enqueue(job_request).await.unwrap();
    let dequeued_job_0 = queue.dequeue().await.unwrap().unwrap();
    queue.fail(job.id).await.unwrap();
    sleep(Duration::from_secs(RETRY_DELAY_SECONDS.into())).await;
    let dequeued_job_1 = queue.dequeue().await.unwrap().unwrap();
    queue.success(job.id).await.unwrap();
    let dequeued_job_2 = queue.dequeue().await.unwrap();

    assert_eq!(dequeued_job_0.id, job.id);
    assert_eq!(dequeued_job_1.id, job.id);
    assert_eq!(dequeued_job_1.retry_count, 1);
    assert!(dequeued_job_2.is_none(), "dequeued job must be none");
}

async fn test_process_fail_into_dead<Q: Queue>(queue: Q) {
    let job_request = dummy_job().with_max_retries(1);

    let job = queue.enqueue(job_request).await.unwrap();
    let dequeued_job_0 = queue.dequeue().await.unwrap().unwrap();
    queue.fail(job.id).await.unwrap();
    sleep(Duration::from_secs(RETRY_DELAY_SECONDS.into())).await;
    let dequeued_job_1 = queue.dequeue().await.unwrap().unwrap();
    queue.fail(job.id).await.unwrap();
    sleep(Duration::from_secs(RETRY_DELAY_SECONDS.into())).await;
    let dequeued_job_2 = queue.dequeue().await.unwrap();

    assert_eq!(dequeued_job_0.id, job.id);
    assert_eq!(dequeued_job_0.retry_count, 0);
    assert_eq!(dequeued_job_1.id, job.id);
    assert_eq!(dequeued_job_1.retry_count, 1);
    assert!(dequeued_job_2.is_none(), "dequeued job must be none");
}

async fn test_retry_dead_job<Q: Queue>(queue: Q) {
    let job_request = dummy_job().with_max_retries(1);

    let job = queue.enqueue(job_request).await.unwrap();
    let _ = queue.dequeue().await.unwrap().unwrap();
    queue.fail(job.id).await.unwrap();
    sleep(Duration::from_secs(RETRY_DELAY_SECONDS.into())).await;
    let dequeued_job_0 = queue.dequeue().await.unwrap().unwrap();
    queue.fail(job.id).await.unwrap();
    queue.retry(job.id).await.unwrap();
    let dequeued_job_1 = queue.dequeue().await.unwrap().unwrap();

    assert_eq!(dequeued_job_0.id, job.id);
    assert_eq!(dequeued_job_0.retry_count, 1);
    assert_eq!(dequeued_job_1.id, job.id);
    assert_eq!(dequeued_job_1.retry_count, 0);
}

async fn test_dequeued_jobs_in_scheduled_at_order<Q: Queue>(queue: Q) {
    let scheduled_at_0 = Utc::now()
        .checked_sub_signed(TimeDelta::seconds(2))
        .unwrap();
    let ready_job_0_request = dummy_job().with_scheduled_at(scheduled_at_0);
    let scheduled_at_1 = Utc::now()
        .checked_sub_signed(TimeDelta::seconds(1))
        .unwrap();
    let ready_job_1_request = dummy_job().with_scheduled_at(scheduled_at_1);

    let future_scheduled_at = Utc::now()
        .checked_add_signed(TimeDelta::seconds(1))
        .unwrap();
    let future_job_request = dummy_job().with_scheduled_at(future_scheduled_at);

    let mut job_requests = [ready_job_0_request, ready_job_1_request, future_job_request];
    let mut rng = rand::rng();
    job_requests.shuffle(&mut rng);

    let mut jobs = vec![];
    for j in job_requests {
        let job = queue.enqueue(j).await.unwrap();
        jobs.push(job);
    }

    println!("Job scheduled_at values:");
    for j in &jobs {
        println!("Job ID: {}, scheduled_at: {}", j.id, j.scheduled_at);
    }
    println!("Expected scheduled_at values:");
    println!("Ready job 0 scheduled_at: {}", scheduled_at_0);
    println!("Ready job 1 scheduled_at: {}", scheduled_at_1);
    println!("Future job scheduled_at: {}", future_scheduled_at);

    let ready_job_0 = jobs
        .iter()
        .find(|j| j.scheduled_at == scheduled_at_0)
        .cloned()
        .unwrap();
    let ready_job_1 = jobs
        .iter()
        .find(|j| j.scheduled_at == scheduled_at_1)
        .cloned()
        .unwrap();
    let _future_job = jobs
        .iter()
        .find(|j| j.scheduled_at == future_scheduled_at)
        .cloned()
        .unwrap();

    let dequeued_job_0 = queue.dequeue().await.unwrap();
    let dequeued_job_1 = queue.dequeue().await.unwrap();
    let dequeued_job_2 = queue.dequeue().await.unwrap();

    assert!(dequeued_job_0.is_some(), "first dequeued job must be some");
    let dequeued_job_0 = dequeued_job_0.unwrap();
    assert_eq!(
        dequeued_job_0.id, ready_job_0.id,
        "first dequeued job must have the expected ID"
    );
    assert!(dequeued_job_1.is_some(), "second dequeued job must be some");
    let dequeued_job_1 = dequeued_job_1.unwrap();
    assert_eq!(dequeued_job_1.id, ready_job_1.id);
    assert!(dequeued_job_2.is_none(), "third dequeued job must be none");
}
