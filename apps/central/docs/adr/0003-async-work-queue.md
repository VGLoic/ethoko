# Asynchronous work queue

A single async work queue is used to process all asynchronous work in the system. This includes tasks such as sending emails, processing background jobs, and other long-running operations that should not block the main application flow.

The server binary instantiates:
- a single async work queue,
- a root processor, set up using child processors, that processeses all jobs,
- a worker, set up from the root processor, that poll the queue for new jobs and process them in the background.

Each **bounded context** (e.g. users) defines its unique job topic, its job types and payloads and its child processor. Jobs are enqueued by the bounded context **Notifier** using the single work queue. The child processor is setup with the topic in the root processor.

The queue manages jobs with a PostgreSQL database, jobs are stored in database when enqueued, the worker is in charge of polling for ready jobs.

The design allows for an `at least once delivery` by adding dedicated `success` and `fail` registration methods for a job in the queue.
Each job is created with a specific `max retries`, once reach, the job is considered **dead** and will not be picked up automatically. A dead job can be retried manually.

The PostgreSQL backing is non optimal compared to other technologies but it has been chosen as a pragmatic approach. Another queue can be implemented with a more suited technology when needed.
