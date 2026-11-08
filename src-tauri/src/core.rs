use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Notify;
use tokio_util::sync::CancellationToken;

use crate::catalog::{catalog, ModelDef};
use crate::engine::EngineStatus;
use crate::jobs::Job;
use crate::models::{DownloadHandle, ModelStatus};
use crate::msg::Coded;
use crate::settings::Settings;

pub struct Paths {
    pub data: PathBuf,
    pub home: PathBuf,
    /// The user's Music folder; default parent of the output folder.
    pub music: PathBuf,
    pub settings: PathBuf,
    pub jobs: PathBuf,
    pub perf: PathBuf,
    pub api_info: PathBuf,
    pub engine_dir: PathBuf,
    pub bundled_engine: Option<PathBuf>,
}

#[derive(Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ApiStatus {
    pub running: bool,
    pub url: Option<String>,
    /// Address other devices on the LAN can use; `None` when loopback-only.
    pub lan_url: Option<String>,
    pub error: Option<Coded>,
}

pub struct Core {
    pub app: AppHandle,
    pub paths: Paths,
    pub catalog: Vec<ModelDef>,
    pub settings: RwLock<Settings>,
    pub jobs: Mutex<Vec<Job>>,
    pub job_notify: Notify,
    /// The job currently executing and the token that cancels it.
    pub running: Mutex<Option<(String, CancellationToken)>>,
    pub downloads: Mutex<HashMap<String, Arc<DownloadHandle>>>,
    pub model_errors: Mutex<HashMap<String, Coded>>,
    pub engine: RwLock<EngineStatus>,
    pub engine_install: Mutex<Option<CancellationToken>>,
    /// Measured seconds of compute per second of audio, keyed by model (+cot).
    pub perf: Mutex<HashMap<String, f64>>,
    pub api_shutdown: Mutex<Option<tokio::sync::oneshot::Sender<()>>>,
    pub api_status: RwLock<ApiStatus>,
    pub http: reqwest::Client,
}

fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Option<T> {
    let bytes = std::fs::read(path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

/// Writes through a temp file so a crash never leaves truncated state.
pub fn write_json<T: Serialize>(path: &Path, value: &T) -> anyhow::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(value)?)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}
/// One-time move from the pre-rename "Zimu Music" locations.
fn migrate_legacy(data: &Path, home: &Path) {
    if !data.exists() {
        if let Some(parent) = data.parent() {
            let old = parent.join("com.zimu.music");
            if old.is_dir() {
                let _ = std::fs::rename(&old, data);
            }
        }
    }
    let old_out = home.join("Music").join("Zimu Music");
    let new_out = home.join("Music").join("Songhearth");
    if old_out.is_dir() && !new_out.exists() {
        let _ = std::fs::rename(&old_out, &new_out);
    }
}

/// Rewrites stored output paths that still point into the pre-rename folder.
/// Idempotent (runs every launch) so paths heal even if an earlier run moved
/// the folder without saving. Returns true when anything changed.
fn remap_legacy_paths(jobs: &mut [Job], home: &Path) -> bool {
    let old = home.join("Music").join("Zimu Music");
    let new = home.join("Music").join("Songhearth");
    let mut changed = false;
    for job in jobs.iter_mut() {
        let Some(rest) = job.output_path.as_deref().and_then(|p| Path::new(p).strip_prefix(&old).ok()) else {
            continue;
        };
        job.output_path = Some(new.join(rest).to_string_lossy().into_owned());
        changed = true;
    }
    changed
}

impl Core {
    pub fn init(app: AppHandle) -> anyhow::Result<Arc<Self>> {
        // Local (not roaming) app data: models are multi-GB and must not sync
        // with a Windows roaming profile. Identical to app_data_dir on macOS.
        let data = app.path().app_local_data_dir()?;
        let home = app.path().home_dir()?;
        let music = app.path().audio_dir().unwrap_or_else(|_| home.join("Music"));
        migrate_legacy(&data, &home);
        std::fs::create_dir_all(&data)?;
        let bundled_engine = app
            .path()
            .resource_dir()
            .ok()
            .map(|d| d.join("engine"))
            .filter(|d| d.join(crate::engine::CLI_NAME).is_file());
        let paths = Paths {
            settings: data.join("settings.json"),
            jobs: data.join("jobs.json"),
            perf: data.join("perf.json"),
            api_info: data.join("api.json"),
            engine_dir: data.join("engine"),
            bundled_engine,
            home,
            music,
            data,
        };

        let settings: Settings = read_json::<Settings>(&paths.settings)
            .unwrap_or_default()
            .normalized();
        write_json(&paths.settings, &settings)?;

        let mut jobs: Vec<Job> = read_json(&paths.jobs).unwrap_or_default();
        if remap_legacy_paths(&mut jobs, &paths.home) {
            let _ = write_json(&paths.jobs, &jobs);
        }
        // A job cannot survive an app restart mid-run; queued work resumes.
        for job in jobs.iter_mut() {
            if job.status == crate::jobs::JobStatus::Running {
                job.status = crate::jobs::JobStatus::Failed;
                job.error = Some("The app quit while this job was running; retry to generate it again.".into());
                job.error_info = Some(Coded::new("job_interrupted", job.error.clone().unwrap_or_default()));
                job.stage = "interrupted".into();
                job.eta_sec = None;
            }
        }
        let perf: HashMap<String, f64> = read_json(&paths.perf).unwrap_or_default();

        let http = reqwest::Client::builder()
            .user_agent(concat!("Songhearth/", env!("CARGO_PKG_VERSION")))
            .connect_timeout(std::time::Duration::from_secs(20))
            .build()?;

        let core = Arc::new(Self {
            app,
            paths,
            catalog: catalog(),
            settings: RwLock::new(settings),
            jobs: Mutex::new(jobs),
            job_notify: Notify::new(),
            running: Mutex::new(None),
            downloads: Mutex::new(HashMap::new()),
            model_errors: Mutex::new(HashMap::new()),
            engine: RwLock::new(EngineStatus::default()),
            engine_install: Mutex::new(None),
            perf: Mutex::new(perf),
            api_shutdown: Mutex::new(None),
            api_status: RwLock::new(ApiStatus::default()),
            http,
        });
        core.allow_output_dir();
        Ok(core)
    }

    pub fn settings(&self) -> Settings {
        self.settings.read().unwrap().clone()
    }

    pub fn models_dir(&self) -> PathBuf {
        self.settings()
            .models_dir
            .map(PathBuf::from)
            .unwrap_or_else(|| self.paths.data.join("models"))
    }

    pub fn output_dir(&self) -> PathBuf {
        self.settings()
            .output_dir
            .map(PathBuf::from)
            .unwrap_or_else(|| self.paths.music.join("Songhearth"))
    }

    /// The webview plays files through the asset protocol; custom output
    /// folders need to be added to its scope at runtime.
    pub fn allow_output_dir(&self) {
        let dir = self.output_dir();
        let _ = std::fs::create_dir_all(&dir);
        let _ = self.app.asset_protocol_scope().allow_directory(&dir, true);
    }

    pub fn model(&self, id: &str) -> Option<&ModelDef> {
        self.catalog.iter().find(|m| m.id == id)
    }

    pub fn persist_jobs(&self) {
        let jobs = self.jobs.lock().unwrap().clone();
        if let Err(e) = write_json(&self.paths.jobs, &jobs) {
            eprintln!("failed to persist jobs: {e}");
        }
    }

    pub fn persist_perf(&self) {
        let perf = self.perf.lock().unwrap().clone();
        let _ = write_json(&self.paths.perf, &perf);
    }

    pub fn job(&self, id: &str) -> Option<Job> {
        self.jobs.lock().unwrap().iter().find(|j| j.id == id).cloned()
    }

    pub fn update_job<F: FnOnce(&mut Job)>(&self, id: &str, f: F) -> Option<Job> {
        let updated = {
            let mut jobs = self.jobs.lock().unwrap();
            let job = jobs.iter_mut().find(|j| j.id == id)?;
            f(job);
            job.clone()
        };
        self.emit_job(&updated);
        Some(updated)
    }

    pub fn emit_job(&self, job: &Job) {
        let _ = self.app.emit("job-updated", job);
    }

    pub fn emit_job_removed(&self, id: &str) {
        let _ = self.app.emit("job-removed", id);
    }

    pub fn emit_model(&self, id: &str) {
        if let Some(def) = self.model(id) {
            let _ = self.app.emit("model-updated", self.model_view(def));
        }
    }

    pub fn emit_engine(&self) {
        let status = self.engine.read().unwrap().clone();
        let _ = self.app.emit("engine-updated", status);
    }

    pub fn emit_api_status(&self) {
        let status = self.api_status.read().unwrap().clone();
        let _ = self.app.emit("api-updated", status);
    }

    pub fn model_status(&self, def: &ModelDef) -> ModelStatus {
        crate::models::status(self, def)
    }

    pub fn model_view(&self, def: &ModelDef) -> ModelView {
        ModelView {
            def: def.clone(),
            total_size: def.total_size(),
            status: self.model_status(def),
        }
    }

    pub fn model_views(&self) -> Vec<ModelView> {
        self.catalog.iter().map(|d| self.model_view(d)).collect()
    }

    pub fn is_installed(&self, id: &str) -> bool {
        self.model(id)
            .map(|d| self.model_status(d).state == "installed")
            .unwrap_or(false)
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelView {
    #[serde(flatten)]
    pub def: ModelDef,
    pub total_size: u64,
    pub status: ModelStatus,
}
