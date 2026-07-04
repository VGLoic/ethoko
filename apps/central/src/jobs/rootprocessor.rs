use std::collections::HashMap;

use tracing::warn;

use crate::jobs::{job::Job, processor::JobProcessor};

pub struct RootProcessor {
    processors: HashMap<String, Box<dyn JobProcessor>>,
}

impl RootProcessor {
    pub fn new(processors: HashMap<String, Box<dyn JobProcessor>>) -> Self {
        Self { processors }
    }
}

#[async_trait::async_trait]
impl JobProcessor for RootProcessor {
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
