//! Tauri commands used by the webview.

use std::path::PathBuf;
use std::sync::Arc;

use serde::Serialize;
use tauri::State;

use crate::core::{ApiStatus, Core, ModelView};
use crate::engine::EngineStatus;
use crate::jobs::{self, GenParams, Job};
use crate::msg::Coded;
use crate::settings::Settings;
use crate::util::{random_token, system_info, SystemInfo};

type CoreState<'a> = State<'a, Arc<Core>>;


#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Paths {
    models_dir: String,
    output_dir: String,
    data_dir: String,
    api_info: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bootstrap {
    version: &'static str,
    settings: Settings,
    engine: EngineStatus,
    models: Vec<ModelView>,
    jobs: Vec<Job>,
    system: SystemInfo,
    api: ApiStatus,
    paths: Paths,
}

fn paths(core: &Core) -> Paths {
    Paths {
        models_dir: core.models_dir().to_string_lossy().into_owned(),
        output_dir: core.output_dir().to_string_lossy().into_owned(),
        data_dir: core.paths.data.to_string_lossy().into_owned(),
        api_info: core.paths.api_info.to_string_lossy().into_owned(),
    }
}

fn snapshot(core: &Core) -> Bootstrap {
    Bootstrap {
        version: env!("CARGO_PKG_VERSION"),
        settings: core.settings(),
        engine: core.engine.read().unwrap().clone(),
        models: core.model_views(),
        jobs: core.jobs.lock().unwrap().clone(),
        system: system_info(),
        api: core.api_status.read().unwrap().clone(),
        paths: paths(core),
    }
}

#[tauri::command]
pub fn bootstrap(core: CoreState<'_>) -> Bootstrap {
    snapshot(&core)
}

#[tauri::command]
pub async fn save_settings(core: CoreState<'_>, settings: Settings) -> Result<Bootstrap, Coded> {
    let core = core.inner().clone();
    let new = settings.normalized();
    let old = core.settings();
    if new == old {
        return Ok(snapshot(&core));
    }
    if new.models_dir != old.models_dir && !core.downloads.lock().unwrap().is_empty() {
        return Err(Coded::new("downloads_active", "Models are downloading; pause them before changing the models folder"));
    }
    crate::core::write_json(&core.paths.settings, &new)
        .map_err(|e| Coded::new("settings_save_failed", format!("Could not save settings: {e}")).with("detail", e))?;
    *core.settings.write().unwrap() = new.clone();
    if new.output_dir != old.output_dir {
        core.allow_output_dir();
    }
    if new.engine_path != old.engine_path {
        crate::engine::refresh(&core).await;
    }
    if (new.api_enabled, new.api_port, new.api_lan, new.api_require_token, &new.api_token)
        != (old.api_enabled, old.api_port, old.api_lan, old.api_require_token, &old.api_token)
    {
        crate::api::restart(core.clone()).await;
    }
    for def in &core.catalog {
        core.emit_model(def.id);
    }
    Ok(snapshot(&core))
}

#[tauri::command]
pub async fn regenerate_api_token(core: CoreState<'_>) -> Result<Bootstrap, Coded> {
    let mut s = core.settings();
    s.api_token = random_token();
    save_settings(core, s).await
}

#[tauri::command]
pub async fn refresh_engine(core: CoreState<'_>) -> Result<EngineStatus, Coded> {
    Ok(crate::engine::refresh(core.inner()).await)
}

#[tauri::command]
pub async fn install_engine(core: CoreState<'_>) -> Result<EngineStatus, Coded> {
    let c = core.inner().clone();
    tauri::async_runtime::spawn(async move {
        let _ = crate::engine::install(c).await;
    });
    Ok(core.engine.read().unwrap().clone())
}

#[tauri::command]
pub fn cancel_engine_install(core: CoreState<'_>) {
    crate::engine::cancel_install(&core);
}

#[tauri::command]
pub fn install_model(core: CoreState<'_>, id: String) -> Result<(), Coded> {
    crate::models::start_install(core.inner(), &id)
}

#[tauri::command]
pub fn pause_model(core: CoreState<'_>, id: String) {
    crate::models::pause(&core, &id);
}

#[tauri::command]
pub fn delete_model(core: CoreState<'_>, id: String) -> Result<(), Coded> {
    crate::models::delete(&core, &id)
}

/// Async + blocking pool: preparing a reference song decodes the whole file,
/// which must not run on the main thread.
#[tauri::command]
pub async fn create_job(core: CoreState<'_>, params: GenParams) -> Result<Job, Coded> {
    let core = core.inner().clone();
    tauri::async_runtime::spawn_blocking(move || jobs::create(&core, params, "app"))
        .await
        .map_err(|e| Coded::new("unknown", e.to_string()))?
}

#[tauri::command]
pub fn cancel_job(core: CoreState<'_>, id: String) -> Result<Job, Coded> {
    jobs::cancel(&core, &id)
}

#[tauri::command]
pub fn delete_job(core: CoreState<'_>, id: String, delete_file: bool) -> Result<(), Coded> {
    jobs::delete(&core, &id, delete_file)
}

#[tauri::command]
pub async fn retry_job(core: CoreState<'_>, id: String, new_seed: bool) -> Result<Job, Coded> {
    let core = core.inner().clone();
    tauri::async_runtime::spawn_blocking(move || jobs::retry(&core, &id, new_seed))
        .await
        .map_err(|e| Coded::new("unknown", e.to_string()))?
}

#[tauri::command]
pub fn update_job_meta(core: CoreState<'_>, id: String, title: Option<String>, favorite: Option<bool>) -> Result<Job, Coded> {
    let job = core
        .update_job(&id, |j| {
            if let Some(t) = title.map(|t| t.trim().to_string()).filter(|t| !t.is_empty()) {
                j.title = t.chars().take(60).collect();
            }
            if let Some(f) = favorite {
                j.favorite = f;
            }
        })
        .ok_or_else(|| Coded::new("not_found", format!("Job not found: {id}")))?;
    core.persist_jobs();
    Ok(job)
}

#[tauri::command]
pub async fn align_job(core: CoreState<'_>, id: String) -> Result<Job, Coded> {
    crate::align::start(core.inner(), &id).await
}

#[tauri::command]
pub fn export_track(core: CoreState<'_>, id: String, dest: String) -> Result<(), Coded> {
    let job = core.job(&id).ok_or_else(|| Coded::new("not_found", format!("Job not found: {id}")))?;
    let src = job.output_path.ok_or_else(|| Coded::new("no_audio", "This job has no audio file"))?;
    std::fs::copy(&src, &dest)
        .map_err(|e| Coded::new("export_failed", format!("Export failed: {e}")).with("detail", e))?;
    Ok(())
}

#[tauri::command]
pub fn install_skill(core: CoreState<'_>, target: String) -> Result<String, Coded> {
    let dir: PathBuf = match target.as_str() {
        "claude" => core.paths.home.join(".claude/skills/songhearth"),
        "codex" => core.paths.home.join(".codex/skills/songhearth"),
        custom => PathBuf::from(custom).join("songhearth"),
    };
    crate::skill::install(&dir)
        .map_err(|e| Coded::new("skill_install_failed", format!("Skill installation failed: {e}")).with("detail", e))?;
    Ok(dir.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn skill_markdown() -> &'static str {
    crate::skill::SKILL_MD
}
