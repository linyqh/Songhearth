//! Generation jobs: types, validation and queue operations.

use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::catalog::ModelDef;
use crate::core::Core;
use crate::msg::Coded;
use crate::util::{derive_title, now_iso, random_seed};

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum JobStatus {
    Queued,
    Running,
    Succeeded,
    Failed,
    Cancelled,
}

impl JobStatus {
    pub fn is_finished(self) -> bool {
        matches!(self, Self::Succeeded | Self::Failed | Self::Cancelled)
    }
}

/// Request shape shared by the UI and the HTTP API.
#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct GenParams {
    /// Model id, or `auto` / empty to pick the best installed model.
    pub model: String,
    pub prompt: String,
    pub lyrics: String,
    pub instrumental: bool,
    pub duration: Option<f64>,
    pub seed: Option<u64>,
    pub steps: Option<u32>,
    /// YuE2 symbolic planning: `off` | `melody` | `full`.
    pub cot: Option<String>,
    pub negative_prompt: Option<String>,
    pub title: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub id: String,
    pub title: String,
    pub model_id: String,
    pub params: GenParams,
    pub seed: u64,
    pub duration: f64,
    pub status: JobStatus,
    pub stage: String,
    pub progress: f64,
    pub eta_sec: Option<f64>,
    pub created_at: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub output_path: Option<String>,
    pub audio_duration_sec: Option<f64>,
    pub wall_sec: Option<f64>,
    pub peaks: Option<Vec<f32>>,
    /// English summary (API consumers, logs). The app window translates
    /// `error_info` instead.
    pub error: Option<String>,
    #[serde(default)]
    pub error_info: Option<Coded>,
    /// `app` | `api`
    pub source: String,
    #[serde(default)]
    pub favorite: bool,
}

pub type JobError = Coded;

fn err(code: &'static str, message: impl Into<String>) -> JobError {
    Coded::new(code, message)
}

pub fn wants_vocals(p: &GenParams) -> bool {
    !p.instrumental && !p.lyrics.trim().is_empty()
}

/// Best installed model for the request: vocals need a singing model,
/// otherwise prefer dedicated instrumental models.
fn pick_model<'a>(core: &'a Core, p: &GenParams) -> Option<&'a ModelDef> {
    let order: &[&str] = if wants_vocals(p) {
        &["yue2-3b", "minimax-music-3", "ace-step-1.5-turbo"]
    } else {
        &["stable-audio-3-medium", "yue2-3b", "ace-step-1.5-turbo", "stable-audio-3-small"]
    };
    order
        .iter()
        .filter_map(|id| core.model(id))
        .find(|m| core.is_installed(m.id))
}

pub fn create(core: &Arc<Core>, mut p: GenParams, source: &str) -> Result<Job, JobError> {
    p.prompt = p.prompt.trim().to_string();
    p.lyrics = p.lyrics.trim().to_string();
    if !core.engine.read().unwrap().installed {
        return Err(err("engine_missing", "The audio.cpp engine is not installed; install it in Settings first"));
    }
    let model = if p.model.is_empty() || p.model == "auto" {
        pick_model(core, &p).ok_or_else(|| err("no_model_installed", "No installed model can serve this request; download one first"))?
    } else {
        let m = core
            .model(&p.model)
            .ok_or_else(|| err("unknown_model", format!("Unknown model: {}", p.model)).with("id", &p.model))?;
        if !core.is_installed(m.id) {
            return Err(err("model_not_installed", format!("Model {} is not downloaded", m.name)).with("name", m.name));
        }
        m
    };
    if p.prompt.is_empty() {
        return Err(err("prompt_required", "A style description (prompt) is required"));
    }
    if p.prompt.chars().count() > 2000 || p.lyrics.chars().count() > 12000 {
        return Err(err("input_too_long", "The prompt is limited to 2000 characters and the lyrics to 12000"));
    }
    if wants_vocals(&p) && !model.vocals {
        return Err(err("model_no_vocals", format!("{} generates instrumentals only; remove the lyrics or pick a vocal model", model.name)).with("name", model.name));
    }
    if model.lyrics_required && !wants_vocals(&p) {
        return Err(err("lyrics_required", format!("{} requires lyrics", model.name)).with("name", model.name));
    }
    if !model.instrumental && p.instrumental {
        return Err(err("no_instrumental", format!("{} does not support instrumental mode", model.name)).with("name", model.name));
    }
    if let Some(cot) = p.cot.as_deref() {
        if !matches!(cot, "off" | "melody" | "full") {
            return Err(err("invalid_cot", "cot must be off, melody or full"));
        }
    }
    let duration = p
        .duration
        .unwrap_or(model.duration.default)
        .clamp(model.duration.min, model.duration.max);
    if let (Some(steps), Some(spec)) = (p.steps, model.steps.as_ref()) {
        p.steps = Some(steps.clamp(spec.min, spec.max));
    }
    let seed = p.seed.unwrap_or_else(random_seed) % 4_294_967_295;
    let title = p
        .title
        .clone()
        .map(|t| t.trim().chars().take(60).collect::<String>())
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| derive_title(if p.instrumental { "" } else { &p.lyrics }, &p.prompt));
    p.model = model.id.to_string();

    let job = Job {
        id: uuid::Uuid::new_v4().simple().to_string()[..12].to_string(),
        title,
        model_id: model.id.to_string(),
        params: p,
        seed,
        duration,
        status: JobStatus::Queued,
        stage: "queued".into(),
        progress: 0.0,
        eta_sec: None,
        created_at: now_iso(),
        started_at: None,
        finished_at: None,
        output_path: None,
        audio_duration_sec: None,
        wall_sec: None,
        peaks: None,
        error: None,
        error_info: None,
        source: source.to_string(),
        favorite: false,
    };
    core.jobs.lock().unwrap().push(job.clone());
    core.persist_jobs();
    core.emit_job(&job);
    core.job_notify.notify_one();
    Ok(job)
}

pub fn cancel(core: &Core, id: &str) -> Result<Job, JobError> {
    let job = core.job(id).ok_or_else(|| err("not_found", format!("Job not found: {id}")))?;
    match job.status {
        JobStatus::Queued => {
            let job = core
                .update_job(id, |j| {
                    j.status = JobStatus::Cancelled;
                    j.stage = "cancelled".into();
                    j.finished_at = Some(now_iso());
                })
                .unwrap();
            core.persist_jobs();
            Ok(job)
        }
        JobStatus::Running => {
            if let Some((rid, token)) = core.running.lock().unwrap().as_ref() {
                if rid == id {
                    token.cancel();
                }
            }
            core.update_job(id, |j| j.stage = "cancelling".into());
            Ok(core.job(id).unwrap())
        }
        _ => Ok(job),
    }
}

pub fn delete(core: &Core, id: &str, delete_file: bool) -> Result<(), JobError> {
    let job = core.job(id).ok_or_else(|| err("not_found", format!("Job not found: {id}")))?;
    if job.status == JobStatus::Running {
        return Err(err("busy", "The job is running; cancel it first"));
    }
    if delete_file {
        if let Some(path) = &job.output_path {
            let _ = std::fs::remove_file(path);
        }
    }
    core.jobs.lock().unwrap().retain(|j| j.id != id);
    core.persist_jobs();
    core.emit_job_removed(id);
    Ok(())
}

/// Re-queues a finished job; `new_seed` gives a fresh variation.
pub fn retry(core: &Arc<Core>, id: &str, new_seed: bool) -> Result<Job, JobError> {
    let job = core.job(id).ok_or_else(|| err("not_found", format!("Job not found: {id}")))?;
    let mut params = job.params.clone();
    params.seed = if new_seed { None } else { Some(job.seed) };
    params.duration = Some(job.duration);
    params.title = Some(job.title.clone());
    create(core, params, &job.source)
}
