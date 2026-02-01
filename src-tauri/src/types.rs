use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JobType {
    Download,
    Transcribe,
    Import,
    Summary,
    Optimize,
    Export,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JobStatus {
    Queued,
    Running,
    Succeeded,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobProgressEvent {
    pub job_id: String,
    pub media_id: String,
    pub job_type: JobType,
    pub status: JobStatus,
    pub progress: f32,
    pub message: Option<String>,
}

pub const EVENT_JOB_PROGRESS: &str = "job_progress";
