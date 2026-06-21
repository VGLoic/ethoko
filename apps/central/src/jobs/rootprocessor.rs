use std::collections::HashMap;

use tracing::warn;

use crate::jobs::{job::Job, processor::JobProcessor};

pub struct RootProcessor<P: JobProcessor> {
    processors: HashMap<String, P>,
}

impl<P: JobProcessor> RootProcessor<P> {
    pub fn new(processors: HashMap<String, P>) -> Self {
        Self { processors }
    }
}

#[async_trait::async_trait]
impl<P: JobProcessor> JobProcessor for RootProcessor<P> {
    async fn process_job(&self, job: &Job) -> Result<(), anyhow::Error> {
        let processor = self.processors.get(&job.topic);
        if let Some(processor) = processor {
            processor.process_job(job).await
        } else {
            warn!("No processor found for topic: {}", job.topic);
            Err(anyhow::anyhow!(
                "No processor found for topic: {}",
                job.topic
            ))
        }
    }
}
