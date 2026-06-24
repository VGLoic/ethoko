use std::time::Duration;

use chrono::{Days, TimeDelta, Utc};
use ethoko_central::jobs::{
    job::Job,
    memoryqueue::InMemoryQueue,
    psqlqueue::PsqlQueue,
    queue::{Queue, QueueInspector},
};
use serde::{Deserialize, Serialize};
use sqlx::postgres::PgPoolOptions;
use tokio::time::sleep;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct TestJobPayload {
    pub message: String,
}

const RETRY_DELAY_SECONDS: u64 = 1;

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

    Ok(PsqlQueue::new(RETRY_DELAY_SECONDS.cast_signed(), pool))
}

#[tokio::test]
async fn test_psql_queue() {
    let queue = setup_psql_queue().await.unwrap();
    test_suite(queue).await;
}

#[tokio::test]
async fn test_memory_queue() {
    let queue = InMemoryQueue::new(RETRY_DELAY_SECONDS.cast_signed());
    test_suite(queue).await;
}

async fn test_suite<Q: Queue + QueueInspector + Clone>(queue: Q) {
    test_dequeue_non_ready_job(queue.clone()).await;
    test_dequeue_ready_job(queue.clone()).await;
    test_successive_dequeue_ready_job(queue.clone()).await;
    test_timeout_processing(queue.clone()).await;
    test_success_process(queue.clone()).await;
    test_fail_process(queue.clone()).await;
    test_retry_fail_job(queue.clone()).await;
    test_too_many_retries_fail_job(queue.clone()).await;
    test_retry_dead_job(queue.clone()).await;
    test_dequeued_jobs_in_scheduled_at_order(queue.clone()).await;
}

async fn test_dequeue_non_ready_job<Q: Queue + QueueInspector>(queue: Q) {
    let payload = TestJobPayload {
        message: "Hello, world!".to_string(),
    };
    let job = Job::new("test-topic".to_string(), payload)
        .unwrap()
        .with_scheduled_at(Utc::now().checked_add_days(Days::new(1)).unwrap());

    queue.enqueue(job.clone()).await.unwrap();
    let dequeued_job = queue.dequeue().await.unwrap();
    assert!(dequeued_job.is_none());
    let idle_jobs = queue.idle_jobs().await.unwrap();
    assert!(idle_jobs.iter().any(|j| j.id == job.id));
}

async fn test_dequeue_ready_job<Q: Queue + QueueInspector>(queue: Q) {
    let payload = TestJobPayload {
        message: "Hello, world!".to_string(),
    };
    let job = Job::new("test-topic".to_string(), payload)
        .unwrap()
        .with_scheduled_at(Utc::now());

    queue.enqueue(job.clone()).await.unwrap();
    let dequeued_job = queue.dequeue().await.unwrap();
    assert!(dequeued_job.is_some());
    assert_eq!(dequeued_job.unwrap().id, job.id);
    let ready_jobs = queue.ready_jobs().await.unwrap();
    assert!(ready_jobs.iter().any(|j| j.id == job.id));
}

async fn test_successive_dequeue_ready_job<Q: Queue + QueueInspector>(queue: Q) {
    let payload = TestJobPayload {
        message: "Hello, world!".to_string(),
    };
    let job = Job::new("test-topic".to_string(), payload)
        .unwrap()
        .with_scheduled_at(Utc::now());

    queue.enqueue(job.clone()).await.unwrap();
    let dequeued_job_0 = queue.dequeue().await.unwrap();
    let dequeued_job_1 = queue.dequeue().await.unwrap();
    assert!(dequeued_job_0.is_some());
    assert!(dequeued_job_1.is_none());
}

async fn test_timeout_processing<Q: Queue + QueueInspector>(queue: Q) {
    let processing_timeout_in_seconds = 1;
    let payload = TestJobPayload {
        message: "Hello, world!".to_string(),
    };
    let job = Job::new("test-topic".to_string(), payload)
        .unwrap()
        .with_scheduled_at(Utc::now());

    queue.enqueue(job.clone()).await.unwrap();
    let _ = queue.dequeue().await;
    sleep(Duration::from_secs(processing_timeout_in_seconds)).await;
    let dequeued_job = queue.dequeue().await.unwrap();
    assert!(dequeued_job.is_some());
    let dequeued_job = dequeued_job.unwrap();
    assert_eq!(dequeued_job.id, job.id);
    assert_eq!(dequeued_job.retry_count, 1);
}

async fn test_success_process<Q: Queue + QueueInspector>(queue: Q) {
    let payload = TestJobPayload {
        message: "Hello, world!".to_string(),
    };
    let job = Job::new("test-topic".to_string(), payload)
        .unwrap()
        .with_scheduled_at(Utc::now());

    queue.enqueue(job.clone()).await.unwrap();
    let dequeued_job = queue.dequeue().await.unwrap().unwrap();
    queue.success(dequeued_job.id).await.unwrap();

    let ready_jobs = queue.ready_jobs().await.unwrap();
    assert!(ready_jobs.iter().all(|j| j.id != job.id));
    let idle_jobs = queue.idle_jobs().await.unwrap();
    assert!(idle_jobs.iter().all(|j| j.id != job.id));
}

async fn test_fail_process<Q: Queue + QueueInspector>(queue: Q) {
    let payload = TestJobPayload {
        message: "Hello, world!".to_string(),
    };
    let job = Job::new("test-topic".to_string(), payload)
        .unwrap()
        .with_scheduled_at(Utc::now());

    queue.enqueue(job.clone()).await.unwrap();
    let dequeued_job = queue.dequeue().await.unwrap().unwrap();
    queue.fail(dequeued_job.id).await.unwrap();
    let dequeued_job = queue.dequeue().await.unwrap();

    assert!(dequeued_job.is_none());
    let idle_jobs = queue.idle_jobs().await.unwrap();
    assert!(idle_jobs.iter().any(|j| j.id == job.id));
}

async fn test_retry_fail_job<Q: Queue + QueueInspector>(queue: Q) {
    let payload = TestJobPayload {
        message: "Hello, world!".to_string(),
    };
    let job = Job::new("test-topic".to_string(), payload)
        .unwrap()
        .with_scheduled_at(Utc::now());

    queue.enqueue(job.clone()).await.unwrap();
    let dequeued_job = queue.dequeue().await.unwrap().unwrap();
    queue.fail(dequeued_job.id).await.unwrap();
    sleep(Duration::from_secs(RETRY_DELAY_SECONDS)).await;
    let dequeued_job = queue.dequeue().await.unwrap();

    assert!(dequeued_job.is_some());
    let ready_jobs = queue.ready_jobs().await.unwrap();
    assert!(ready_jobs.iter().any(|j| j.id == job.id));
}

async fn test_too_many_retries_fail_job<Q: Queue + QueueInspector>(queue: Q) {
    let payload = TestJobPayload {
        message: "Hello, world!".to_string(),
    };
    let job = Job::new("test-topic".to_string(), payload)
        .unwrap()
        .with_scheduled_at(Utc::now())
        .with_max_retries(1);

    queue.enqueue(job.clone()).await.unwrap();
    let dequeued_job = queue.dequeue().await.unwrap().unwrap();
    queue.fail(dequeued_job.id).await.unwrap();
    sleep(Duration::from_secs(RETRY_DELAY_SECONDS)).await;
    let dequeued_job = queue.dequeue().await.unwrap().unwrap();
    queue.fail(dequeued_job.id).await.unwrap();
    sleep(Duration::from_secs(RETRY_DELAY_SECONDS)).await;
    let dequeued_job = queue.dequeue().await.unwrap();

    assert!(dequeued_job.is_none());
    let dead_jobs = queue.dead_jobs().await.unwrap();
    assert!(dead_jobs.iter().any(|j| j.id == job.id));
}

async fn test_retry_dead_job<Q: Queue + QueueInspector>(queue: Q) {
    let payload = TestJobPayload {
        message: "Hello, world!".to_string(),
    };
    let job = Job::new("test-topic".to_string(), payload)
        .unwrap()
        .with_scheduled_at(Utc::now())
        .with_max_retries(0);

    queue.enqueue(job.clone()).await.unwrap();
    let dequeued_job = queue.dequeue().await.unwrap().unwrap();
    queue.fail(dequeued_job.id).await.unwrap();
    sleep(Duration::from_secs(RETRY_DELAY_SECONDS)).await;
    queue.retry(job.id).await.unwrap();
    let dequeued_job = queue.dequeue().await.unwrap().unwrap();
    assert_eq!(dequeued_job.id, job.id);
    assert_eq!(dequeued_job.retry_count, 0);
}

async fn test_dequeued_jobs_in_scheduled_at_order<Q: Queue + QueueInspector>(queue: Q) {
    let payload_0 = TestJobPayload {
        message: "Hello, world!".to_string(),
    };
    let ready_job_0 = Job::new("test-topic".to_string(), payload_0)
        .unwrap()
        .with_scheduled_at(
            Utc::now()
                .checked_add_signed(TimeDelta::milliseconds(1))
                .unwrap(),
        );
    let payload_1 = TestJobPayload {
        message: "Bye bye, world!".to_string(),
    };
    let ready_job_1 = Job::new("test-topic".to_string(), payload_1)
        .unwrap()
        .with_scheduled_at(Utc::now());
    let payload_2 = TestJobPayload {
        message: "Hello again, world!".to_string(),
    };
    let future_job = Job::new("test-topic".to_string(), payload_2)
        .unwrap()
        .with_scheduled_at(
            Utc::now()
                .checked_add_signed(TimeDelta::seconds(1))
                .unwrap(),
        );

    queue.enqueue(future_job.clone()).await.unwrap();
    queue.enqueue(ready_job_1.clone()).await.unwrap();
    queue.enqueue(ready_job_0.clone()).await.unwrap();
    let dequeued_job_0 = queue.dequeue().await.unwrap();
    let dequeued_job_1 = queue.dequeue().await.unwrap();
    let dequeued_job_2 = queue.dequeue().await.unwrap();

    assert!(dequeued_job_0.is_some());
    let dequeued_job_0 = dequeued_job_0.unwrap();
    assert_eq!(dequeued_job_0.id, ready_job_0.id);
    assert!(dequeued_job_1.is_some());
    let dequeued_job_1 = dequeued_job_1.unwrap();
    assert_eq!(dequeued_job_1.id, ready_job_1.id);
    assert!(dequeued_job_2.is_none());
    let ready_jobs = queue.ready_jobs().await.unwrap();
    assert!(ready_jobs.iter().any(|j| j.id == dequeued_job_0.id));
    assert!(ready_jobs.iter().any(|j| j.id == dequeued_job_1.id));
    let idle_jobs = queue.idle_jobs().await.unwrap();
    assert!(idle_jobs.iter().any(|j| j.id == future_job.id));
}

// #[tokio::test]
// async fn test_enqueue_single_job_psql_queue() {
//     let queue = setup_psql_queue().await.unwrap();
//     test_enqueue_single_job(queue).await;
// }

// #[tokio::test]
// async fn test_enqueue_single_job_memory_queue() {
//     let queue = InMemoryQueue::new(RETRY_DELAY_SECONDS.cast_signed());
//     test_enqueue_single_job(queue).await;
// }

// async fn test_enqueue_single_job<Q: Queue + QueueInspector>(queue: Q) {
//     let payload = TestJobPayload {
//         message: "Hello, world!".to_string(),
//     };
//     let job = Job::new("test-topic".to_string(), payload)
//         .unwrap()
//         .with_scheduled_at(Utc::now().checked_add_days(Days::new(1)).unwrap());

//     queue.enqueue(job.clone()).await.unwrap();
//     let idle_jobs = queue.idle_jobs().await.unwrap();
//     assert!(idle_jobs.iter().any(|j| j.id == job.id));
// }

// #[tokio::test]
// async fn test_enqueue_multiple_jobs_psql_queue() {
//     let queue = setup_psql_queue().await.unwrap();
//     test_enqueue_multiple_jobs(queue).await;
// }

// #[tokio::test]
// async fn test_enqueue_multiple_jobs_memory_queue() {
//     let queue = InMemoryQueue::new(RETRY_DELAY_SECONDS.cast_signed());
//     test_enqueue_multiple_jobs(queue).await;
// }

// async fn test_enqueue_multiple_jobs<Q: Queue + QueueInspector>(queue: Q) {
//     let payload1 = TestJobPayload {
//         message: "Hello, world!".to_string(),
//     };
//     let payload2 = TestJobPayload {
//         message: "Goodbye, world!".to_string(),
//     };
//     let job1 = Job::new("test-topic".to_string(), payload1)
//         .unwrap()
//         .with_scheduled_at(Utc::now().checked_add_signed(TimeDelta::days(1)).unwrap());
//     let job2 = Job::new("test-topic".to_string(), payload2)
//         .unwrap()
//         .with_scheduled_at(Utc::now().checked_add_signed(TimeDelta::days(1)).unwrap());

//     queue.enqueue(job1.clone()).await.unwrap();
//     queue.enqueue(job2.clone()).await.unwrap();
//     let idle_jobs = queue.idle_jobs().await.unwrap();
//     assert!(idle_jobs.len() >= 2);
//     assert!(idle_jobs.iter().any(|j| j.id == job1.id));
//     assert!(idle_jobs.iter().any(|j| j.id == job2.id));
// }

// // #[tokio::test]
// // async fn test_dequeue_ready_job_psql_queue() {
// //     let queue = setup_psql_queue().await.unwrap();
// //     test_dequeue_ready_job(queue).await;
// // }

// // #[tokio::test]
// // async fn test_dequeue_ready_job_memory_queue() {
// //     let queue = InMemoryQueue::new(RETRY_DELAY_SECONDS.cast_signed());
// //     test_dequeue_ready_job(queue).await;
// // }

// async fn test_dequeue_ready_job<Q: Queue + QueueInspector>(queue: Q) {
//     let payload = TestJobPayload {
//         message: "Hello, world!".to_string(),
//     };
//     let job = Job::new("test-topic".to_string(), payload)
//         .unwrap()
//         .with_scheduled_at(
//             Utc::now()
//                 .checked_sub_signed(TimeDelta::seconds(1))
//                 .unwrap(),
//         );
//     queue.enqueue(job.clone()).await.unwrap();
//     let _ = queue.dequeue().await.unwrap();
//     assert!(
//         queue
//             .idle_jobs()
//             .await
//             .unwrap()
//             .iter()
//             .all(|j| j.id != job.id)
//     );
//     assert!(
//         queue
//             .ready_jobs()
//             .await
//             .unwrap()
//             .iter()
//             .any(|j| j.id == job.id)
//     );
// }

// // #[tokio::test]
// // async fn test_dequeue_not_ready_job_psql_queue() {
// //     let queue = setup_psql_queue().await.unwrap();
// //     test_dequeue_not_ready_job(queue).await;
// // }

// // #[tokio::test]
// // async fn test_dequeue_not_ready_job_memory_queue() {
// //     let queue = InMemoryQueue::new(RETRY_DELAY_SECONDS.cast_signed());
// //     test_dequeue_not_ready_job(queue).await;
// // }

// async fn test_dequeue_not_ready_job<Q: Queue + QueueInspector>(queue: Q) {
//     let payload = TestJobPayload {
//         message: "Hello, world!".to_string(),
//     };
//     let job = Job::new("test-topic".to_string(), payload)
//         .unwrap()
//         .with_scheduled_at(
//             Utc::now()
//                 .checked_add_signed(TimeDelta::seconds(20))
//                 .unwrap(),
//         );
//     queue.enqueue(job.clone()).await.unwrap();
//     let _ = queue.dequeue().await.unwrap();
//     assert!(
//         queue
//             .idle_jobs()
//             .await
//             .unwrap()
//             .iter()
//             .any(|j| j.id == job.id)
//     );
//     assert!(
//         queue
//             .ready_jobs()
//             .await
//             .unwrap()
//             .iter()
//             .all(|j| j.id != job.id)
//     );
// }

// #[tokio::test]
// async fn test_success_process_psql_queue() {
//     let queue = setup_psql_queue().await.unwrap();
//     test_success_process(queue).await;
// }

// #[tokio::test]
// async fn test_success_process_memory_queue() {
//     let queue = InMemoryQueue::new(RETRY_DELAY_SECONDS.cast_signed());
//     test_success_process(queue).await;
// }

// async fn test_success_process<Q: Queue + QueueInspector>(queue: Q) {
//     let payload = TestJobPayload {
//         message: "Hello, world!".to_string(),
//     };
//     let job = Job::new("test-topic".to_string(), payload)
//         .unwrap()
//         .with_scheduled_at(
//             Utc::now()
//                 .checked_sub_signed(TimeDelta::seconds(1))
//                 .unwrap(),
//         );
//     queue.enqueue(job.clone()).await.unwrap();
//     let _ = queue.dequeue().await.unwrap().unwrap();

//     queue.success(job.id).await.unwrap();
//     assert!(
//         queue
//             .idle_jobs()
//             .await
//             .unwrap()
//             .iter()
//             .all(|j| j.id != job.id)
//     );
//     assert!(
//         queue
//             .ready_jobs()
//             .await
//             .unwrap()
//             .iter()
//             .all(|j| j.id != job.id)
//     );
// }

// #[tokio::test]
// async fn test_fail_process_memory_queue() {
//     let queue = InMemoryQueue::new(RETRY_DELAY_SECONDS.cast_signed());
//     test_fail_process(queue).await;
// }
// #[tokio::test]
// async fn test_fail_process_psql_queue() {
//     let queue = setup_psql_queue().await.unwrap();
//     test_fail_process(queue).await;
// }

// async fn test_fail_process<Q: Queue + QueueInspector>(queue: Q) {
//     let payload = TestJobPayload {
//         message: "Hello, world!".to_string(),
//     };
//     let job = Job::new("test-topic".to_string(), payload)
//         .unwrap()
//         .with_scheduled_at(
//             Utc::now()
//                 .checked_sub_signed(TimeDelta::seconds(1))
//                 .unwrap(),
//         )
//         .with_max_retries(3);
//     queue.enqueue(job.clone()).await.unwrap();
//     let _ = queue.dequeue().await.unwrap().unwrap();

//     queue.fail(job.id).await.unwrap();
//     sleep(Duration::from_secs(RETRY_DELAY_SECONDS)).await;
//     let _ = queue.dequeue().await.unwrap().unwrap();

//     assert!(
//         queue
//             .idle_jobs()
//             .await
//             .unwrap()
//             .iter()
//             .all(|j| j.id != job.id)
//     );
//     assert!(
//         queue
//             .ready_jobs()
//             .await
//             .unwrap()
//             .iter()
//             .any(|j| j.id == job.id)
//     );
// }

// #[tokio::test]
// async fn test_fail_process_exceeding_retries_memory_queue() {
//     let queue = InMemoryQueue::new(RETRY_DELAY_SECONDS.cast_signed());
//     test_fail_process_exceeding_retries(queue).await;
// }

// #[tokio::test]
// async fn test_fail_process_exceeding_retries_psql_queue() {
//     let queue = setup_psql_queue().await.unwrap();
//     test_fail_process_exceeding_retries(queue).await;
// }

// async fn test_fail_process_exceeding_retries<Q: Queue + QueueInspector>(queue: Q) {
//     let payload = TestJobPayload {
//         message: "Hello, world!".to_string(),
//     };
//     let job = Job::new("test-topic".to_string(), payload)
//         .unwrap()
//         .with_scheduled_at(
//             Utc::now()
//                 .checked_sub_signed(TimeDelta::seconds(1))
//                 .unwrap(),
//         )
//         .with_max_retries(1);
//     queue.enqueue(job.clone()).await.unwrap();

//     let _ = queue.dequeue().await.unwrap().unwrap();
//     queue.fail(job.id).await.unwrap();
//     sleep(Duration::from_secs(RETRY_DELAY_SECONDS)).await;
//     let _ = queue.dequeue().await.unwrap().unwrap();
//     queue.fail(job.id).await.unwrap();

//     let dead_jobs = queue.dead_jobs().await.unwrap();
//     assert!(!dead_jobs.is_empty());
//     assert!(dead_jobs.iter().any(|j| j.id == job.id));
// }

// #[tokio::test]
// async fn test_fail_into_success_memory_queue() {
//     let queue = InMemoryQueue::new(RETRY_DELAY_SECONDS.cast_signed());
//     test_fail_into_success(queue).await;
// }

// #[tokio::test]
// async fn test_fail_into_success_psql_queue() {
//     let queue = setup_psql_queue().await.unwrap();
//     test_fail_into_success(queue).await;
// }

// async fn test_fail_into_success<Q: Queue + QueueInspector>(queue: Q) {
//     let payload = TestJobPayload {
//         message: "Hello, world!".to_string(),
//     };
//     let job = Job::new("test-topic".to_string(), payload)
//         .unwrap()
//         .with_scheduled_at(
//             Utc::now()
//                 .checked_sub_signed(TimeDelta::seconds(1))
//                 .unwrap(),
//         )
//         .with_max_retries(3);
//     queue.enqueue(job.clone()).await.unwrap();

//     let _ = queue.dequeue().await.unwrap().unwrap();
//     queue.fail(job.id).await.unwrap();
//     sleep(Duration::from_secs(RETRY_DELAY_SECONDS)).await;
//     let _ = queue.dequeue().await.unwrap().unwrap();

//     queue.success(job.id).await.unwrap();
//     let _ = queue.dequeue().await.unwrap();
//     assert!(
//         queue
//             .idle_jobs()
//             .await
//             .unwrap()
//             .iter()
//             .all(|j| j.id != job.id)
//     );
//     assert!(
//         queue
//             .ready_jobs()
//             .await
//             .unwrap()
//             .iter()
//             .all(|j| j.id != job.id)
//     );
// }
