//! Model package downloads: parallel ranged requests, resumable via a
//! sidecar state file, cancellable (= pause) at any point.

use std::os::unix::fs::FileExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;

use crate::catalog::ModelDef;
use crate::core::{write_json, Core};
use crate::msg::Coded;

const SEGMENTS: u64 = 8;
const MIN_SEGMENT: u64 = 16 * 1024 * 1024;
const MAX_ATTEMPTS: u32 = 8;

#[derive(Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ModelStatus {
    /// `notInstalled` | `partial` | `downloading` | `installed`
    pub state: &'static str,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub speed_bps: f64,
    pub error: Option<Coded>,
    pub path: String,
}

pub struct DownloadHandle {
    pub cancel: CancellationToken,
    pub downloaded: AtomicU64,
    pub total: u64,
    pub speed: Mutex<f64>,
}

#[derive(Serialize, Deserialize, Clone)]
struct Segment {
    start: u64,
    end: u64,
    done: u64,
}

#[derive(Serialize, Deserialize)]
struct PartState {
    size: u64,
    segments: Vec<Segment>,
}

fn part_path(dest: &Path) -> PathBuf {
    PathBuf::from(format!("{}.part", dest.display()))
}

fn state_path(dest: &Path) -> PathBuf {
    PathBuf::from(format!("{}.part.json", dest.display()))
}

fn file_complete(dest: &Path, size: u64) -> bool {
    std::fs::metadata(dest).map(|m| m.len() == size).unwrap_or(false)
}

fn partial_bytes(dest: &Path) -> u64 {
    std::fs::read(state_path(dest))
        .ok()
        .and_then(|b| serde_json::from_slice::<PartState>(&b).ok())
        .map(|s| s.segments.iter().map(|g| g.done).sum())
        .unwrap_or(0)
}

pub fn status(core: &Core, def: &ModelDef) -> ModelStatus {
    let root = core.models_dir();
    let total = def.total_size();
    let path = root.join(def.model_arg).to_string_lossy().into_owned();
    let error = core.model_errors.lock().unwrap().get(def.id).cloned();
    if let Some(handle) = core.downloads.lock().unwrap().get(def.id) {
        return ModelStatus {
            state: "downloading",
            downloaded_bytes: handle.downloaded.load(Ordering::Relaxed),
            total_bytes: handle.total,
            speed_bps: *handle.speed.lock().unwrap(),
            error: None,
            path,
        };
    }
    let mut done = 0u64;
    let mut complete = true;
    let mut any = false;
    for f in &def.files {
        let dest = root.join(f.local);
        if file_complete(&dest, f.size) {
            done += f.size;
            any = true;
        } else {
            complete = false;
            let p = partial_bytes(&dest);
            if p > 0 {
                any = true;
                done += p;
            }
        }
    }
    let state = if complete {
        "installed"
    } else if any {
        "partial"
    } else {
        "notInstalled"
    };
    ModelStatus {
        state,
        downloaded_bytes: if complete { total } else { done },
        total_bytes: total,
        speed_bps: 0.0,
        error,
        path,
    }
}

fn unknown_model(id: &str) -> Coded {
    Coded::new("unknown_model", format!("Unknown model: {id}")).with("id", id)
}

pub fn start_install(core: &Arc<Core>, id: &str) -> Result<(), Coded> {
    let def = core.model(id).cloned().ok_or_else(|| unknown_model(id))?;
    if core.is_installed(id) {
        return Ok(());
    }
    let root = core.models_dir();
    let already: u64 = def
        .files
        .iter()
        .map(|f| {
            let dest = root.join(f.local);
            if file_complete(&dest, f.size) { f.size } else { partial_bytes(&dest) }
        })
        .sum();
    let handle = Arc::new(DownloadHandle {
        cancel: CancellationToken::new(),
        downloaded: AtomicU64::new(already),
        total: def.total_size(),
        speed: Mutex::new(0.0),
    });
    {
        let mut downloads = core.downloads.lock().unwrap();
        if downloads.contains_key(id) {
            return Ok(());
        }
        downloads.insert(id.to_string(), handle.clone());
    }
    core.model_errors.lock().unwrap().remove(id);
    core.emit_model(id);

    let core2 = core.clone();
    tauri::async_runtime::spawn(async move {
        let ticker = spawn_ticker(core2.clone(), def.id.to_string(), handle.clone());
        let result = install_files(&core2, &def, &root, &handle).await;
        ticker.abort();
        core2.downloads.lock().unwrap().remove(def.id);
        match result {
            Ok(()) => {}
            Err(_) if handle.cancel.is_cancelled() => {}
            Err(e) => {
                let coded = match e.downcast::<Coded>() {
                    Ok(c) => c,
                    Err(e) => Coded::new("download_failed", format!("Download failed: {e}")).with("detail", e),
                };
                core2.model_errors.lock().unwrap().insert(def.id.to_string(), coded);
            }
        }
        core2.emit_model(def.id);
    });
    Ok(())
}

fn spawn_ticker(core: Arc<Core>, id: String, handle: Arc<DownloadHandle>) -> tauri::async_runtime::JoinHandle<()> {
    tauri::async_runtime::spawn(async move {
        let mut last = handle.downloaded.load(Ordering::Relaxed);
        let mut last_t = Instant::now();
        loop {
            tokio::time::sleep(Duration::from_millis(500)).await;
            let now = handle.downloaded.load(Ordering::Relaxed);
            let dt = last_t.elapsed().as_secs_f64().max(0.001);
            let inst = (now.saturating_sub(last)) as f64 / dt;
            {
                let mut s = handle.speed.lock().unwrap();
                *s = if *s == 0.0 { inst } else { *s * 0.7 + inst * 0.3 };
            }
            last = now;
            last_t = Instant::now();
            core.emit_model(&id);
        }
    })
}

async fn install_files(core: &Arc<Core>, def: &ModelDef, root: &Path, handle: &Arc<DownloadHandle>) -> anyhow::Result<()> {
    let settings = core.settings();
    for f in &def.files {
        let dest = root.join(f.local);
        if file_complete(&dest, f.size) {
            continue;
        }
        let url = format!(
            "{}/{}/resolve/main/{}",
            settings.hf_endpoint,
            def.repo,
            f.remote.split('/').map(encode_segment).collect::<Vec<_>>().join("/")
        );
        download_file(core, handle, &url, settings.hf_token.as_deref(), &dest, f.size).await?;
    }
    Ok(())
}

fn encode_segment(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

async fn download_file(
    core: &Arc<Core>,
    handle: &Arc<DownloadHandle>,
    url: &str,
    token: Option<&str>,
    dest: &Path,
    size: u64,
) -> anyhow::Result<()> {
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let part = part_path(dest);
    let state_file = state_path(dest);
    let state = std::fs::read(&state_file)
        .ok()
        .and_then(|b| serde_json::from_slice::<PartState>(&b).ok())
        .filter(|s| s.size == size && part.exists());
    let segments = match state {
        Some(s) => s.segments,
        None => {
            let n = (size / MIN_SEGMENT).clamp(1, SEGMENTS);
            let chunk = size.div_ceil(n);
            (0..n)
                .map(|i| Segment { start: i * chunk, end: ((i + 1) * chunk).min(size), done: 0 })
                .filter(|s| s.start < s.end)
                .collect()
        }
    };
    let file = Arc::new(std::fs::OpenOptions::new().read(true).write(true).create(true).truncate(false).open(&part)?);
    file.set_len(size)?;

    let done: Arc<Vec<AtomicU64>> = Arc::new(segments.iter().map(|s| AtomicU64::new(s.done)).collect());
    let save = {
        let segments = segments.clone();
        let done = done.clone();
        let state_file = state_file.clone();
        move || {
            let snapshot = PartState {
                size,
                segments: segments
                    .iter()
                    .enumerate()
                    .map(|(i, s)| Segment { done: done[i].load(Ordering::Relaxed), ..s.clone() })
                    .collect(),
            };
            let _ = write_json(&state_file, &snapshot);
        }
    };
    save();

    // Child token: a failing segment stops its siblings without being
    // mistaken for a user pause (which cancels the parent).
    let stop = handle.cancel.child_token();
    let mut tasks = Vec::new();
    for (i, seg) in segments.iter().enumerate() {
        if seg.done >= seg.end - seg.start {
            continue;
        }
        let client = core.http.clone();
        let url = url.to_string();
        let token = token.map(str::to_string);
        let file = file.clone();
        let done = done.clone();
        let handle = handle.clone();
        let stop = stop.clone();
        let seg = seg.clone();
        tasks.push(tokio::spawn(async move {
            let r = fetch_segment(&client, &url, token.as_deref(), &file, &seg, &done[i], &handle, &stop, size).await;
            if r.is_err() {
                stop.cancel();
            }
            r
        }));
    }

    let saver = {
        let save = save.clone();
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(2)).await;
                save();
            }
        })
    };
    let mut first_err = None;
    for t in tasks {
        match t.await {
            Ok(Ok(())) => {}
            Ok(Err(e)) => {
                // Prefer the real failure over the "cancelled" echoes it caused.
                let is_echo = e.to_string() == "cancelled";
                if first_err.is_none() || (!is_echo && first_err.as_ref().map(|f: &anyhow::Error| f.to_string() == "cancelled").unwrap_or(false)) {
                    first_err = Some(e);
                }
            }
            Err(e) => first_err = first_err.or(Some(anyhow::anyhow!(e))),
        }
    }
    saver.abort();
    save();
    if let Some(e) = first_err {
        return Err(e);
    }
    if handle.cancel.is_cancelled() {
        anyhow::bail!("cancelled");
    }
    file.sync_all()?;
    drop(file);
    std::fs::rename(&part, dest)?;
    let _ = std::fs::remove_file(&state_file);
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn fetch_segment(
    client: &reqwest::Client,
    url: &str,
    token: Option<&str>,
    file: &std::fs::File,
    seg: &Segment,
    done: &AtomicU64,
    handle: &DownloadHandle,
    stop: &CancellationToken,
    size: u64,
) -> anyhow::Result<()> {
    let len = seg.end - seg.start;
    let mut attempts = 0u32;
    loop {
        let pos = done.load(Ordering::Relaxed);
        if pos >= len {
            return Ok(());
        }
        if stop.is_cancelled() {
            anyhow::bail!("cancelled");
        }
        let from = seg.start + pos;
        let mut req = client
            .get(url)
            .header(reqwest::header::RANGE, format!("bytes={}-{}", from, seg.end - 1));
        if let Some(t) = token {
            req = req.bearer_auth(t);
        }
        let result: anyhow::Result<()> = async {
            let resp = req.send().await?;
            let status = resp.status();
            if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
                return Err(Coded::new("download_denied", format!("Download denied (HTTP {}); set a Hugging Face access token in Settings", status.as_u16()))
                    .with("status", status.as_u16())
                    .into());
            }
            if status == reqwest::StatusCode::NOT_FOUND {
                return Err(Coded::new("download_not_found", "The remote file does not exist (HTTP 404); check the download source").into());
            }
            if !status.is_success() {
                anyhow::bail!("HTTP {}", status.as_u16());
            }
            let ranged = status == reqwest::StatusCode::PARTIAL_CONTENT;
            if !ranged && !(from == 0 && seg.end == size) {
                return Err(Coded::new("download_no_range", "The download server does not support ranged requests").into());
            }
            let mut offset = from;
            let mut stream = resp.bytes_stream();
            loop {
                let next = tokio::select! {
                    _ = stop.cancelled() => anyhow::bail!("cancelled"),
                    n = tokio::time::timeout(Duration::from_secs(60), stream.next()) => n,
                };
                let chunk = match next {
                    Err(_) => anyhow::bail!("connection timed out"),
                    Ok(None) => break,
                    Ok(Some(c)) => c?,
                };
                let remaining = (seg.end - offset) as usize;
                let slice = &chunk[..chunk.len().min(remaining)];
                file.write_all_at(slice, offset)?;
                offset += slice.len() as u64;
                done.fetch_add(slice.len() as u64, Ordering::Relaxed);
                handle.downloaded.fetch_add(slice.len() as u64, Ordering::Relaxed);
                if offset >= seg.end {
                    break;
                }
            }
            Ok(())
        }
        .await;
        match result {
            Ok(()) => attempts = 0,
            Err(e) => {
                if stop.is_cancelled() || e.to_string() == "cancelled" {
                    anyhow::bail!("cancelled");
                }
                // A `Coded` error is a definitive failure (denied, missing…): retrying cannot help.
                if e.downcast_ref::<Coded>().is_some() {
                    return Err(e);
                }
                let msg = e.to_string();
                attempts += 1;
                if attempts >= MAX_ATTEMPTS {
                    return Err(Coded::new("download_network", format!("Network error after {MAX_ATTEMPTS} attempts: {msg}"))
                        .with("attempts", MAX_ATTEMPTS)
                        .with("detail", msg)
                        .into());
                }
                tokio::select! {
                    _ = stop.cancelled() => anyhow::bail!("cancelled"),
                    _ = tokio::time::sleep(Duration::from_millis(500 * 2u64.pow(attempts.min(5)))) => {}
                }
            }
        }
    }
}

pub fn pause(core: &Core, id: &str) {
    if let Some(h) = core.downloads.lock().unwrap().get(id) {
        h.cancel.cancel();
    }
}

pub fn delete(core: &Core, id: &str) -> Result<(), Coded> {
    let def = core.model(id).ok_or_else(|| unknown_model(id))?;
    if core.downloads.lock().unwrap().contains_key(id) {
        return Err(Coded::new("model_busy_download", "Pause the download before deleting"));
    }
    if let Some((job_id, _)) = core.running.lock().unwrap().as_ref() {
        if core.job(job_id).map(|j| j.model_id == id).unwrap_or(false) {
            return Err(Coded::new("model_in_use", "The model is generating music; wait for it or cancel first"));
        }
    }
    let root = core.models_dir();
    let mut dirs = std::collections::BTreeSet::new();
    for f in &def.files {
        let dest = root.join(f.local);
        for p in [dest.clone(), part_path(&dest), state_path(&dest)] {
            let _ = std::fs::remove_file(p);
        }
        let mut dir = dest.parent().map(Path::to_path_buf);
        while let Some(d) = dir {
            if d == root || !d.starts_with(&root) {
                break;
            }
            dirs.insert(d.clone());
            dir = d.parent().map(Path::to_path_buf);
        }
    }
    // Deepest first; remove_dir only succeeds on empty directories, so
    // folders shared with other packages survive.
    for d in dirs.iter().rev() {
        let _ = std::fs::remove_dir(d);
    }
    core.model_errors.lock().unwrap().remove(id);
    core.emit_model(id);
    Ok(())
}
