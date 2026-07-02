# Asynchronous work queue

A single async work queue is used to process all asynchronous work in the system. This includes tasks such as sending emails, processing background jobs, and other long-running operations that should not block the main application flow.

The server binary instantiates:
- a single async work queue,
- a root processor, set up using child processors, that processeses all jobs,
- a single worker, set up from the root processor, that poll the queue for new jobs and process them in the background.

Each **bounded context** (e.g. users) defines its unique job topic, its job types and payloads and its child processor. Jobs are enqueued by the bounded context **Notifier** using the single work queue. The child processor is setup with the topic in the root processor.

The queue stores jobs when enqueued and manage their lifecycle, the worker is in charge of polling for ready jobs.

The design allows for an `at least once delivery` by adding dedicated `success` and `fail` registration methods for a job in the queue.
Each job is created with a specific `max retries`, once reach, the job is considered **dead** and will not be picked up automatically. A dead job can be retried manually.

## Implementations

- A PostgreSQL backed queue is implemented in `psqlqueue.rs` and is used by default. It uses a single table to store jobs and their lifecycle.
- A memory queue is implemented in `memqueue.rs` and is used for testing purposes. It uses a single `HashMap` to store jobs and their lifecycle.

## Identified optimizations for larger scale

1. Move the queue system to a more performant system such as RabbitMQ or Redis.
