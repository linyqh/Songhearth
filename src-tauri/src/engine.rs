//! Locates and installs the audio.cpp CLI that performs inference.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use serde::Serialize;
use tokio_util::sync::CancellationToken;

use crate::core::Core;
use crate::msg::Coded;

pub const ENGINE_VERSION: &str = "0.9.4";
pub const CLI_NAME: &str = "audiocpp_cli";

#[derive(Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    pub installed: bool,
    /// Directory containing `audiocpp_cli`.
    pub dir: Option<String>,
    pub version: Option<String>,
    pub backends: Vec<String>,
    /// `custom` | `bundled` | `downloaded` | `system`
    pub source: Option<String>,
    pub installing: bool,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub error: Option<Coded>,
}

impl EngineStatus {
    pub fn cli(&self) -> Option<PathBuf> {
        self.dir.as_ref().map(|d| Path::new(d).join(CLI_NAME))
    }
}

fn normalize_candidate(path: &Path) -> PathBuf {
    if path.file_name().map(|n| n == CLI_NAME).unwrap_or(false) {
        path.parent().map(Path::to_path_buf).unwrap_or_default()
    } else {
        path.to_path_buf()
    }
}

/// Runs `audiocpp_cli --version`; returns (version, backends).
async fn probe(dir: &Path) -> Option<(String, Vec<String>)> {
    let cli = dir.join(CLI_NAME);
    if !cli.is_file() {
        return None;
    }
    let fut = tokio::process::Command::new(&cli)
        .arg("--version")
        .current_dir(dir)
        .kill_on_drop(true)
        .output();
    let out = tokio::time::timeout(Duration::from_secs(15), fut).await.ok()?.ok()?;
    let text = format!(
        "{}\n{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    let version = text
        .lines()
        .find_map(|l| l.trim().strip_prefix("audio.cpp "))
        .map(|v| v.trim().to_string())?;
    let backends = text
        .lines()
        .find_map(|l| l.trim().strip_prefix("backends:"))
        .map(|b| b.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect())
        .unwrap_or_default();
    Some((version, backends))
}

pub async fn refresh(core: &Arc<Core>) -> EngineStatus {
    let settings = core.settings();
    let mut candidates: Vec<(PathBuf, &str)> = Vec::new();
    if let Some(custom) = settings.engine_path.as_deref() {
        candidates.push((normalize_candidate(Path::new(custom)), "custom"));
    }
    if let Some(bundled) = core.paths.bundled_engine.clone() {
        candidates.push((bundled, "bundled"));
    }
    candidates.push((core.paths.engine_dir.join("current"), "downloaded"));
    for sys in ["/opt/homebrew/bin", "/usr/local/bin"] {
        candidates.push((PathBuf::from(sys), "system"));
    }

    let mut found = None;
    let mut custom_error = None;
    for (dir, source) in candidates {
        match probe(&dir).await {
            Some((version, backends)) => {
                found = Some((dir, source, version, backends));
                break;
            }
            None if source == "custom" => {
                custom_error = Some(
                    Coded::new("engine_custom_not_found", format!("No runnable audiocpp_cli in {}", dir.display()))
                        .with("dir", dir.display()),
                );
            }
            None => {}
        }
    }

    let mut status = core.engine.write().unwrap();
    let installing = status.installing;
    *status = match found {
        Some((dir, source, version, backends)) => EngineStatus {
            installed: true,
            dir: Some(dir.to_string_lossy().into_owned()),
            version: Some(version),
            backends,
            source: Some(source.into()),
            installing,
            error: custom_error,
            ..Default::default()
        },
        None => EngineStatus {
            installing,
            error: custom_error,
            ..Default::default()
        },
    };
    let snapshot = status.clone();
    drop(status);
    core.emit_engine();
    snapshot
}

fn release_url() -> String {
    let arch = if cfg!(target_arch = "aarch64") { "arm64" } else { "x64" };
    format!(
        "https://github.com/0xShug0/audio.cpp/releases/download/v{v}/audio-v{v}-bin-macos-{arch}-metal.tar.gz",
        v = ENGINE_VERSION
    )
}

/// Only the CLI, its model specs and the licence are needed at runtime.
fn wanted(path: &Path) -> bool {
    let s = path.to_string_lossy();
    let s = s.trim_start_matches("./");
    s == CLI_NAME || s == "LICENSE" || s.starts_with("model_specs/") || s == "model_specs"
}

fn extract(archive: &Path, dest: &Path) -> anyhow::Result<()> {
    let staging = dest.with_extension("staging");
    let _ = std::fs::remove_dir_all(&staging);
    std::fs::create_dir_all(&staging)?;
    let file = std::fs::File::open(archive)?;
    let mut tar = tar::Archive::new(flate2::read::GzDecoder::new(file));
    tar.set_preserve_permissions(true);
    for entry in tar.entries()? {
        let mut entry = entry?;
        let path = entry.path()?.into_owned();
        if wanted(&path) {
            entry.unpack_in(&staging)?;
        }
    }
    if !staging.join(CLI_NAME).is_file() {
        anyhow::bail!("the archive does not contain audiocpp_cli");
    }
    let _ = std::fs::remove_dir_all(dest);
    std::fs::rename(&staging, dest)?;
    Ok(())
}

pub async fn install(core: Arc<Core>) -> anyhow::Result<()> {
    let token = CancellationToken::new();
    {
        let mut slot = core.engine_install.lock().unwrap();
        if slot.is_some() {
            return Ok(());
        }
        *slot = Some(token.clone());
    }
    {
        let mut st = core.engine.write().unwrap();
        st.installing = true;
        st.error = None;
        st.downloaded_bytes = 0;
        st.total_bytes = 0;
    }
    core.emit_engine();

    let result = download_and_extract(&core, &token).await;
    *core.engine_install.lock().unwrap() = None;
    {
        let mut st = core.engine.write().unwrap();
        st.installing = false;
        if let Err(e) = &result {
            st.error = Some(if token.is_cancelled() {
                Coded::new("engine_install_cancelled", "Engine installation was cancelled")
            } else {
                Coded::new("engine_install_failed", format!("Engine installation failed: {e}")).with("detail", e)
            });
        }
    }
    refresh(&core).await;
    result
}

async fn download_and_extract(core: &Arc<Core>, token: &CancellationToken) -> anyhow::Result<()> {
    std::fs::create_dir_all(&core.paths.engine_dir)?;
    let archive = core.paths.engine_dir.join(format!("audio-v{ENGINE_VERSION}.tar.gz.part"));
    let resp = core.http.get(release_url()).send().await?.error_for_status()?;
    let total = resp.content_length().unwrap_or(0);
    core.engine.write().unwrap().total_bytes = total;
    let mut file = std::fs::File::create(&archive)?;
    let mut stream = resp.bytes_stream();
    let mut downloaded = 0u64;
    let mut last_emit = Instant::now();
    loop {
        let chunk = tokio::select! {
            _ = token.cancelled() => anyhow::bail!("cancelled"),
            c = stream.next() => c,
        };
        let Some(chunk) = chunk else { break };
        let chunk = chunk?;
        file.write_all(&chunk)?;
        downloaded += chunk.len() as u64;
        if last_emit.elapsed() > Duration::from_millis(250) {
            core.engine.write().unwrap().downloaded_bytes = downloaded;
            core.emit_engine();
            last_emit = Instant::now();
        }
    }
    file.flush()?;
    drop(file);
    let dest = core.paths.engine_dir.join("current");
    let archive2 = archive.clone();
    tokio::task::spawn_blocking(move || extract(&archive2, &dest)).await??;
    let _ = std::fs::remove_file(&archive);
    Ok(())
}

pub fn cancel_install(core: &Core) {
    if let Some(token) = core.engine_install.lock().unwrap().as_ref() {
        token.cancel();
    }
}
