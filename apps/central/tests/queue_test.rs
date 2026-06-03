use std::time::Duration;

use chrono::{TimeDelta, Utc};
use ethoko_central::jobs::{
    job::{Job, Topic},
    queue::{InMemoryQueue, Queue},
};
use serde::{Deserialize, Serialize};
use tokio::time::sleep;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct TestJobPayload {
    pub message: String,
}

#[tokio::test]
async fn test_enqueue_single_job() {
    let memory_queue = InMemoryQueue::new(1);
    let payload = TestJobPayload {
        message: "Hello, world!".to_string(),
    };
    let job = Job::new(Topic::Users, payload).unwrap();

    memory_queue.enqueue(job.clone()).await.unwrap();
    let idle_jobs = memory_queue.idle_jobs().await.unwrap();
    assert_eq!(idle_jobs.len(), 1);
    assert_eq!(idle_jobs[0].id, job.id);
}

#[tokio::test]
async fn test_enqueue_multiple_jobs() {
    let memory_queue = InMemoryQueue::new(1);
    let payload1 = TestJobPayload {
        message: "Hello, world!".to_string(),
    };
    let payload2 = TestJobPayload {
        message: "Goodbye, world!".to_string(),
    };
    let job1 = Job::new(Topic::Users, payload1).unwrap();
    let job2 = Job::new(Topic::Users, payload2).unwrap();

    memory_queue.enqueue(job1.clone()).await.unwrap();
    memory_queue.enqueue(job2.clone()).await.unwrap();
    let idle_jobs = memory_queue.idle_jobs().await.unwrap();
    assert_eq!(idle_jobs.len(), 2);
    assert!(idle_jobs.iter().any(|j| j.id == job1.id));
    assert!(idle_jobs.iter().any(|j| j.id == job2.id));
}

#[tokio::test]
async fn test_dequeue_ready_job() {
    let memory_queue = InMemoryQueue::new(1);
    let payload = TestJobPayload {
        message: "Hello, world!".to_string(),
    };
    let job = Job::new(Topic::Users, payload).unwrap().with_scheduled_at(
        Utc::now()
            .checked_sub_signed(TimeDelta::seconds(1))
            .unwrap(),
    );
    memory_queue.enqueue(job.clone()).await.unwrap();
    let dequeued_job = memory_queue.dequeue().await.unwrap().unwrap();
    assert_eq!(dequeued_job.id, job.id);
}

#[tokio::test]
async fn test_dequeue_not_ready_job() {
    let memory_queue = InMemoryQueue::new(1);
    let payload = TestJobPayload {
        message: "Hello, world!".to_string(),
    };
    let job = Job::new(Topic::Users, payload).unwrap().with_scheduled_at(
        Utc::now()
            .checked_add_signed(TimeDelta::seconds(20))
            .unwrap(),
    );
    memory_queue.enqueue(job.clone()).await.unwrap();
    let dequeued_job = memory_queue.dequeue().await.unwrap();
    assert!(dequeued_job.is_none());
}

#[tokio::test]
async fn test_success_process() {
    let memory_queue = InMemoryQueue::new(1);
    let payload = TestJobPayload {
        message: "Hello, world!".to_string(),
    };
    let job = Job::new(Topic::Users, payload).unwrap().with_scheduled_at(
        Utc::now()
            .checked_sub_signed(TimeDelta::seconds(1))
            .unwrap(),
    );
    memory_queue.enqueue(job.clone()).await.unwrap();
    let dequeued_job = memory_queue.dequeue().await.unwrap().unwrap();

    memory_queue.success(dequeued_job.id).await.unwrap();
    let dequeued_job = memory_queue.dequeue().await.unwrap();
    assert!(dequeued_job.is_none());
}

#[tokio::test]
async fn test_fail_process() {
    let memory_queue = InMemoryQueue::new(1);
    let payload = TestJobPayload {
        message: "Hello, world!".to_string(),
    };
    let job = Job::new(Topic::Users, payload)
        .unwrap()
        .with_scheduled_at(
            Utc::now()
                .checked_sub_signed(TimeDelta::seconds(1))
                .unwrap(),
        )
        .with_max_retries(3);
    memory_queue.enqueue(job.clone()).await.unwrap();
    let dequeued_job = memory_queue.dequeue().await.unwrap().unwrap();

    memory_queue.fail(dequeued_job.id).await.unwrap();
    sleep(Duration::from_secs(1)).await;
    let dequeued_job = memory_queue.dequeue().await.unwrap().unwrap();
    assert!(dequeued_job.id == job.id);
    assert!(dequeued_job.retries == 1);
}

#[tokio::test]
async fn test_fail_process_exceeding_retries() {
    let memory_queue = InMemoryQueue::new(1);
    let payload = TestJobPayload {
        message: "Hello, world!".to_string(),
    };
    let job = Job::new(Topic::Users, payload)
        .unwrap()
        .with_scheduled_at(
            Utc::now()
                .checked_sub_signed(TimeDelta::seconds(1))
                .unwrap(),
        )
        .with_max_retries(1);
    memory_queue.enqueue(job.clone()).await.unwrap();
    let dequeued_job_0 = memory_queue.dequeue().await.unwrap().unwrap();

    memory_queue.fail(job.id).await.unwrap();
    sleep(Duration::from_secs(1)).await;
    let dequeued_job_1 = memory_queue.dequeue().await.unwrap().unwrap();
    memory_queue.fail(job.id).await.unwrap();

    let dead_jobs = memory_queue.dead_jobs().await.unwrap();
    assert!(dead_jobs.len() == 1);
    assert!(dead_jobs[0].id == job.id);
    assert_eq!(dead_jobs[0].retries, 1);
    assert!(job.id == dequeued_job_0.id && job.id == dequeued_job_1.id);
}

#[tokio::test]
async fn test_fail_into_success() {
    let memory_queue = InMemoryQueue::new(1);
    let payload = TestJobPayload {
        message: "Hello, world!".to_string(),
    };
    let job = Job::new(Topic::Users, payload)
        .unwrap()
        .with_scheduled_at(
            Utc::now()
                .checked_sub_signed(TimeDelta::seconds(1))
                .unwrap(),
        )
        .with_max_retries(3);
    memory_queue.enqueue(job.clone()).await.unwrap();
    let dequeued_job_0 = memory_queue.dequeue().await.unwrap().unwrap();

    memory_queue.fail(job.id).await.unwrap();
    sleep(Duration::from_secs(1)).await;
    let dequeued_job_1 = memory_queue.dequeue().await.unwrap().unwrap();

    memory_queue.success(job.id).await.unwrap();
    let dequeued_job_2 = memory_queue.dequeue().await.unwrap();
    assert!(dequeued_job_0.id == job.id && dequeued_job_1.id == job.id);
    assert!(dequeued_job_1.retries == 1);
    assert!(dequeued_job_2.is_none());
}
