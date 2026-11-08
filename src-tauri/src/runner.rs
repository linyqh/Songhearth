//! Executes queued jobs with `audiocpp_cli`, one at a time.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::io::{AsyncBufReadExt, BufReader};
use tokio_util::sync::CancellationToken;

use crate::catalog::ModelDef;
use crate::core::Core;
use crate::jobs::{wants_vocals, Job, JobStatus};
use crate::msg::Coded;
use crate::util::{has_cjk, now_iso, sanitize_filename, unique_path, wav_peaks};

/// Fixed overhead per run: GPU backend init (Metal library / Vulkan pipelines,
/// ~5 s) plus weight loading.
const LOAD_ESTIMATE: f64 = 10.0;

/// Best GPU backend the engine build offers: Metal on macOS, Vulkan on the
/// Windows package, CPU only if nothing else is compiled in. An empty list
/// (old CLI that does not report backends) falls back to the platform default.
pub fn pick_backend(available: &[String]) -> &'static str {
    const PREFERENCE: [&str; 4] = ["metal", "cuda", "vulkan", "cpu"];
    PREFERENCE
        .into_iter()
        .find(|b| available.iter().any(|a| a.eq_ignore_ascii_case(b)))
        .unwrap_or(if cfg!(windows) { "vulkan" } else { "metal" })
}

pub async fn worker(core: Arc<Core>) {
    loop {
        let notified = core.job_notify.notified();
        let next = core
            .jobs
            .lock()
            .unwrap()
            .iter()
            .find(|j| j.status == JobStatus::Queued)
            .map(|j| j.id.clone());
        match next {
            Some(id) => run(&core, &id).await,
            None => notified.await,
        }
    }
}

fn perf_key(job: &Job) -> String {
    match job.params.cot.as_deref() {
        Some(cot) if job.model_id == "yue2-3b" => format!("{}:{cot}", job.model_id),
        _ if job.model_id == "yue2-3b" => format!("{}:full", job.model_id),
        // Covers skip the planner, so they run at a different speed.
        _ if job.params.source_audio.is_some() => format!("{}:cover", job.model_id),
        _ => job.model_id.clone(),
    }
}

/// Expected length of the produced audio. YuE2 stops when the lyrics are
/// sung, so a lyric-based guess beats the configured maximum.
fn expected_audio_secs(job: &Job, model: &ModelDef) -> f64 {
    if model.duration.mode == "max" && wants_vocals(&job.params) {
        let lines = job
            .params
            .lyrics
            .lines()
            .filter(|l| !l.trim().is_empty() && !l.trim().starts_with('['))
            .count() as f64;
        (lines * 5.0 + 40.0).clamp(model.duration.min, job.duration)
    } else {
        job.duration
    }
}

fn build_args(core: &Core, job: &Job, model: &ModelDef, out: &Path) -> Vec<String> {
    let settings = core.settings();
    let model_path = core.models_dir().join(model.model_arg);
    let p = &job.params;
    let mut a: Vec<String> = vec![
        "--task".into(), "gen".into(),
        "--family".into(), model.family.into(),
        "--model".into(), model_path.to_string_lossy().into_owned(),
        "--backend".into(), pick_backend(&core.engine.read().unwrap().backends).into(),
        "--threads".into(), settings.threads.to_string(),
        "--seed".into(), job.seed.to_string(),
        "--log".into(),
        "--metrics".into(),
        "--out".into(), out.to_string_lossy().into_owned(),
    ];
    // Request options collected separately so arms can also push flags.
    let mut req: Vec<(&str, String)> = Vec::new();
    let one_line = |s: &str| s.replace(['\n', '\r'], " ");
    let negative = p.negative_prompt.as_deref().filter(|s| !s.trim().is_empty());
    let vocals = wants_vocals(p);
    match model.family {
        "yue2" => {
            req.push(("style", one_line(&p.prompt)));
            req.push(("cot", p.cot.clone().unwrap_or_else(|| "full".into())));
            // 25 semantic frames per second caps the song length.
            let max_tokens = (job.duration * 25.0).round() as u64;
            req.push(("semantic_max_tokens", max_tokens.to_string()));
            req.push(("semantic_min_tokens", max_tokens.min(200).to_string()));
            if let Some(steps) = p.steps {
                req.push(("num_inference_steps", steps.to_string()));
            }
            a.push("--lyrics".into());
            a.push(if vocals { p.lyrics.clone() } else { "[instrumental]".into() });
        }
        "ace_step" => {
            let cover = p.source_audio.is_some();
            a.extend(["--task-route".into(), if cover { "cover" } else { "text2music" }.into()]);
            a.extend(["--text".into(), p.prompt.clone()]);
            a.push("--lyrics".into());
            a.push(if vocals { p.lyrics.clone() } else { "[Instrumental]".into() });
            if cover {
                // Output length is locked to the reference song.
                a.extend(["--audio".into(), crate::jobs::source_wav(core, &job.id).to_string_lossy().into_owned()]);
                if let Some(strength) = p.cover_strength {
                    req.push(("audio_cover_strength", format!("{strength:.2}")));
                }
            } else {
                a.extend(["--duration-seconds".into(), format!("{:.0}", job.duration)]);
            }
            if vocals {
                a.extend(["--language".into(), if has_cjk(&p.lyrics) { "zh".into() } else { "en".into() }]);
            }
            if let Some(neg) = negative {
                req.push(("negative_prompt", one_line(neg)));
            }
        }
        "minimax_music3" => {
            a.extend(["--text".into(), p.prompt.clone()]);
            req.push(("lyrics", p.lyrics.clone()));
            req.push(("duration_sec", format!("{:.0}", job.duration)));
            req.push(("num_inference_steps", p.steps.unwrap_or(30).to_string()));
        }
        "stable_audio" => {
            a.extend(["--text".into(), p.prompt.clone()]);
            a.extend(["--duration-seconds".into(), format!("{:.0}", job.duration)]);
            a.extend(["--num-inference-steps".into(), p.steps.unwrap_or(8).to_string()]);
            if let Some(neg) = negative {
                req.push(("negative_prompt", one_line(neg)));
            }
        }
        _ => {}
    }
    for (k, v) in req {
        a.push("--request-option".into());
        a.push(format!("{k}={v}"));
    }
    for (k, v) in &model.session_options {
        a.push("--session-option".into());
        a.push(format!("{k}={v}"));
    }
    a
}

/// Maps log lines to a stage code (translated by the UI: `stages:<code>`).
/// Returns (stage, phase) where phase 0 = loading, 1 = generating, 2 = decoding.
fn classify(line: &str, family: &str) -> Option<(&'static str, u8)> {
    // "loaded" must be checked first: it also contains "phase load".
    if line.contains("runtime.load.phase loaded") {
        return Some(if family == "yue2" { ("composing", 1) } else { ("generating", 1) });
    }
    if line.contains("runtime.load.phase load") {
        return Some(("loading", 0));
    }
    match family {
        "yue2" if line.contains("yue2.semantic_ms") => Some(("rendering", 1)),
        "yue2" if line.contains("yue2.nar_ms") => Some(("decoding", 2)),
        _ if line.contains("vae") && line.contains("decode") => Some(("decoding", 2)),
        _ if line.contains("vocoder") => Some(("decoding", 2)),
        _ => None,
    }
}

fn metric(line: &str, key: &str) -> Option<f64> {
    line.trim().strip_prefix(key)?.strip_prefix('=')?.trim().parse().ok()
}

fn summarize_failure(lines: &[String]) -> String {
    let important: Vec<&String> = lines
        .iter()
        .filter(|l| {
            let lower = l.to_lowercase();
            lower.contains("error") || lower.contains("failed") || lower.contains("assert") || lower.contains("invalid")
        })
        .collect();
    let picked: Vec<&String> = if important.is_empty() {
        lines.iter().rev().take(6).collect::<Vec<_>>().into_iter().rev().collect()
    } else {
        important.into_iter().rev().take(6).collect::<Vec<_>>().into_iter().rev().collect()
    };
    picked.iter().map(|s| s.trim()).collect::<Vec<_>>().join("\n")
}

async fn run(core: &Arc<Core>, id: &str) {
    let Some(job) = core.job(id) else { return };
    let Some(model) = core.model(&job.model_id).cloned() else { return };
    let engine = core.engine.read().unwrap().clone();
    let fail = |err: Coded| {
        core.update_job(id, |j| {
            j.status = JobStatus::Failed;
            j.stage = "failed".into();
            j.error = Some(err.message.clone());
            j.error_info = Some(err);
            j.eta_sec = None;
            j.finished_at = Some(now_iso());
        });
        core.persist_jobs();
    };
    let Some(cli) = engine.cli().filter(|_| engine.installed) else {
        return fail(Coded::new("engine_unavailable", "The audio.cpp engine is unavailable; install or select it in Settings"));
    };
    if !core.is_installed(&model.id.to_string()) {
        return fail(Coded::new("model_incomplete", format!("Model {} is not installed or incomplete", model.name)).with("name", model.name));
    }
    if job.params.source_audio.is_some() && !crate::jobs::source_wav(core, id).is_file() {
        return fail(Coded::new("source_audio_missing", "The reference song copy is gone; retry the job to prepare it again"));
    }
    let out_dir = core.output_dir();
    if let Err(e) = std::fs::create_dir_all(&out_dir) {
        return fail(
            Coded::new("output_dir_failed", format!("Cannot create the output folder {}: {e}", out_dir.display()))
                .with("dir", out_dir.display())
                .with("detail", e),
        );
    }
    let tmp_out = out_dir.join(format!(".{}.partial.wav", job.id));

    let token = CancellationToken::new();
    *core.running.lock().unwrap() = Some((id.to_string(), token.clone()));
    let started = Instant::now();
    core.update_job(id, |j| {
        j.status = JobStatus::Running;
        j.stage = "starting".into();
        j.progress = 0.01;
        j.started_at = Some(now_iso());
        j.error = None;
        j.error_info = None;
    });
    core.persist_jobs();

    let result = execute(core, &job, &model, &cli, &tmp_out, &token, started).await;
    *core.running.lock().unwrap() = None;
    let wall = started.elapsed().as_secs_f64();

    match result {
        Outcome::Cancelled => {
            let _ = std::fs::remove_file(&tmp_out);
            core.update_job(id, |j| {
                j.status = JobStatus::Cancelled;
                j.stage = "cancelled".into();
                j.eta_sec = None;
                j.finished_at = Some(now_iso());
            });
            core.persist_jobs();
        }
        Outcome::Failed(msg) => {
            let _ = std::fs::remove_file(&tmp_out);
            fail(msg);
        }
        Outcome::Done { audio_secs, gen_secs } => {
            let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
            let final_path = unique_path(&out_dir, &format!("{stamp} {}", sanitize_filename(&job.title)), "wav");
            if let Err(e) = std::fs::rename(&tmp_out, &final_path) {
                return fail(Coded::new("save_failed", format!("Could not save the audio: {e}")).with("detail", e));
            }
            let fp = final_path.clone();
            let (peaks, wav_secs) = tokio::task::spawn_blocking(move || wav_peaks(&fp, 160))
                .await
                .ok()
                .flatten()
                .map(|(p, d)| (Some(p), Some(d)))
                .unwrap_or((None, None));
            let audio = audio_secs.or(wav_secs);
            if let (Some(a), Some(g)) = (audio, gen_secs) {
                if a > 1.0 {
                    let key = perf_key(&job);
                    let measured = g / a;
                    let mut perf = core.perf.lock().unwrap();
                    let v = perf.get(&key).map(|old| old * 0.5 + measured * 0.5).unwrap_or(measured);
                    perf.insert(key, v);
                }
                core.persist_perf();
            }
            let done = core.update_job(id, |j| {
                j.status = JobStatus::Succeeded;
                j.stage = "done".into();
                j.progress = 1.0;
                j.eta_sec = None;
                j.finished_at = Some(now_iso());
                j.output_path = Some(final_path.to_string_lossy().into_owned());
                j.audio_duration_sec = audio;
                j.wall_sec = Some(wall);
                j.peaks = peaks;
            });
            core.persist_jobs();
            let _ = done; // completion notifications are raised by the webview (localised)
            if wants_vocals(&job.params) {
                crate::align::auto_start(core, id).await;
            }
        }
    }
}

enum Outcome {
    Done { audio_secs: Option<f64>, gen_secs: Option<f64> },
    Failed(Coded),
    Cancelled,
}

async fn execute(
    core: &Arc<Core>,
    job: &Job,
    model: &ModelDef,
    cli: &PathBuf,
    out: &Path,
    token: &CancellationToken,
    started: Instant,
) -> Outcome {
    let args = build_args(core, job, model, out);
    let mut cmd = tokio::process::Command::new(cli);
    cmd.args(&args)
        .current_dir(cli.parent().unwrap_or(Path::new(".")))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    crate::util::hide_console(&mut cmd);
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            return Outcome::Failed(
                Coded::new("engine_spawn_failed", format!("Could not start audiocpp_cli: {e}")).with("detail", e),
            )
        }
    };

    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    if let Some(out) = child.stdout.take() {
        let tx = tx.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(out).lines();
            while let Ok(Some(l)) = lines.next_line().await {
                let _ = tx.send(l);
            }
        });
    }
    if let Some(err) = child.stderr.take() {
        let tx = tx.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(err).lines();
            while let Ok(Some(l)) = lines.next_line().await {
                let _ = tx.send(l);
            }
        });
    }
    drop(tx);

    let factor = core
        .perf
        .lock()
        .unwrap()
        .get(&perf_key(job))
        .copied()
        .unwrap_or(model.compute_factor);
    let expected_gen = (factor * expected_audio_secs(job, model)).max(3.0);
    let mut phase = 0u8;
    let mut stage: &str = "loading";
    let mut gen_started: Option<Instant> = None;
    let mut tail: Vec<String> = Vec::new();
    let mut audio_ms: Option<f64> = None;
    let mut ticker = tokio::time::interval(Duration::from_millis(500));
    let mut stdout_open = true;

    let status = loop {
        tokio::select! {
            _ = token.cancelled() => {
                let _ = child.kill().await;
                return Outcome::Cancelled;
            }
            line = rx.recv(), if stdout_open => {
                match line {
                    Some(line) => {
                        if let Some((label, ph)) = classify(&line, model.family) {
                            stage = label;
                            if ph >= 1 && gen_started.is_none() { gen_started = Some(Instant::now()); }
                            phase = phase.max(ph);
                        }
                        if let Some(v) = metric(&line, "metrics.audio_duration_ms") { audio_ms = Some(v); }
                        if !line.contains("ggml_metal") && !line.contains("ggml_vulkan") && !line.trim().is_empty() {
                            tail.push(line);
                            if tail.len() > 200 { tail.drain(..100); }
                        }
                    }
                    None => stdout_open = false,
                }
            }
            _ = ticker.tick() => {
                let elapsed = started.elapsed().as_secs_f64();
                let (progress, eta) = match (phase, gen_started) {
                    (0, _) => ((elapsed / LOAD_ESTIMATE).min(1.0) * 0.08, expected_gen + (LOAD_ESTIMATE - elapsed).max(2.0)),
                    (1, Some(g)) => {
                        let t = g.elapsed().as_secs_f64() / expected_gen;
                        (0.08 + 0.84 * t.min(0.98), (expected_gen - g.elapsed().as_secs_f64()).max(3.0))
                    }
                    _ => (0.94, 3.0),
                };
                let label = stage.to_string();
                core.update_job(&job.id, |j| {
                    if j.stage != "cancelling" { j.stage = label; }
                    j.progress = progress.max(j.progress);
                    j.eta_sec = Some(eta.round());
                });
            }
            status = child.wait(), if !stdout_open => break status,
        }
    };

    match status {
        Ok(s) if s.success() && out.is_file() => Outcome::Done {
            audio_secs: audio_ms.map(|ms| ms / 1000.0),
            gen_secs: gen_started.map(|g| g.elapsed().as_secs_f64()),
        },
        Ok(s) => {
            let detail = summarize_failure(&tail);
            let code = s.code().map(|c| c.to_string()).unwrap_or_else(|| "signal".into());
            Outcome::Failed(if detail.is_empty() {
                Coded::new("engine_exit_silent", format!("audiocpp_cli exited (code {code}) without producing audio"))
                    .with("code", &code)
            } else {
                Coded::new("engine_exit", format!("audiocpp_cli exited (code {code}):\n{detail}"))
                    .with("code", &code)
                    .with("detail", detail)
            })
        }
        Err(e) => Outcome::Failed(
            Coded::new("engine_wait_failed", format!("Waiting for audiocpp_cli failed: {e}")).with("detail", e),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::classify;

    #[test]
    fn yue2_log_lines_advance_stages() {
        let log = [
            "[TRACE ts=1] runtime.load.phase load",
            "[TRACE ts=1] runtime.load.phase loaded",
            "[TIMING ts=1] yue2.semantic_ms 52475.6",
            "[TIMING ts=1] yue2.nar_ms 43324.0",
        ];
        let phases: Vec<u8> = log.iter().filter_map(|l| classify(l, "yue2")).map(|(_, p)| p).collect();
        assert_eq!(phases, vec![0, 1, 1, 2]);
    }

    #[test]
    fn generic_family_detects_decode_after_load() {
        assert_eq!(classify("runtime.load.phase loaded", "stable_audio").map(|c| c.1), Some(1));
        assert_eq!(classify("framework.oobleck_audio_vae.decode.total_ms 1", "stable_audio").map(|c| c.1), Some(2));
        assert_eq!(classify("yue2.vae_tile_frames 1024", "yue2"), None);
    }
}
