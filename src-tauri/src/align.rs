//! Lyric timing by forced alignment. The music models emit no timestamps, so
//! the sung audio is aligned against the lyric text with the Qwen3 forced
//! aligner shipped in audio.cpp. The aligner only accepts clips of roughly a
//! minute and a half, so a song is processed in successive windows.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Deserialize;
use tokio_util::sync::CancellationToken;

use crate::catalog::ModelFile;
use crate::core::Core;
use crate::jobs::{wants_vocals, Job, JobStatus};
use crate::models::{file_complete, install_files, DownloadHandle};
use crate::msg::Coded;
use crate::util::has_cjk;

const REPO: &str = "audio-cpp/audio.cpp-gguf";
const ALIGNER: ModelFile = ModelFile {
    remote: "Qwen3-ForcedAligner-0.6B-GGUF/qwen3-forced-aligner-0.6b-q8_0.gguf",
    local: "Qwen3-ForcedAligner-0.6B-GGUF/qwen3-forced-aligner-0.6b-q8_0.gguf",
    size: 1_129_969_856,
};

/// Window length handed to the aligner (its encoder fails somewhere past 90 s).
const WINDOW: f64 = 75.0;
/// Lines ending this close to a window edge are re-aligned in the next window,
/// because the aligner squeezes leftover text into the clip's tail.
const EDGE: f64 = 4.0;

#[derive(Deserialize)]
struct Word {
    start_sample: f64,
    end_sample: f64,
}

/// Lyric lines that get a timestamp: non-empty and not a `[Section]` marker.
/// Must stay in step with `parseLyrics` in the frontend.
pub fn sung_lines(lyrics: &str) -> Vec<String> {
    lyrics
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !(l.starts_with('[') && l.ends_with(']')))
        .map(str::to_string)
        .collect()
}

/// Number of tokens the aligner returns for a line: one per CJK character and
/// one per run of ASCII letters/digits. Punctuation yields none.
fn units(line: &str) -> usize {
    let mut n = 0;
    let mut in_word = false;
    for c in line.chars() {
        if c.is_ascii_alphanumeric() || c == '\'' && in_word {
            if !in_word {
                n += 1;
            }
            in_word = true;
        } else {
            in_word = false;
            if c.is_alphanumeric() {
                n += 1;
            }
        }
    }
    n
}

/// Maps the aligner's word list back to lines. A mismatch between the expected
/// and returned token counts (odd tokenisation) falls back to splitting the
/// words proportionally, which is still far closer than a length estimate.
fn assign(lines: &[String], words: &[Word], rate: f64) -> Vec<Option<[f64; 2]>> {
    let counts: Vec<usize> = lines.iter().map(|l| units(l)).collect();
    let expected: usize = counts.iter().sum();
    let mut out = Vec::with_capacity(lines.len());
    let mut done = 0usize;
    for c in &counts {
        if *c == 0 || words.is_empty() {
            out.push(None);
            continue;
        }
        let (from, to) = if expected == words.len() {
            (done, done + c)
        } else {
            let scale = words.len() as f64 / expected as f64;
            ((done as f64 * scale).round() as usize, (((done + c) as f64) * scale).round() as usize)
        };
        done += c;
        let to = to.min(words.len());
        if from >= to {
            out.push(None);
            continue;
        }
        out.push(Some([words[from].start_sample / rate, words[to - 1].end_sample / rate]));
    }
    out
}

/// Whole song as mono f32 plus its sample rate.
fn load_mono(path: &Path) -> anyhow::Result<(Vec<f32>, u32)> {
    let mut reader = hound::WavReader::open(path)?;
    let spec = reader.spec();
    let ch = spec.channels.max(1) as usize;
    let scale = 1.0 / (1u64 << (spec.bits_per_sample.max(2) - 1)) as f32;
    let raw: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Float => reader.samples::<f32>().collect::<Result<_, _>>()?,
        hound::SampleFormat::Int => reader.samples::<i32>().map(|s| s.map(|v| v as f32 * scale)).collect::<Result<_, _>>()?,
    };
    let mono = raw.chunks(ch).map(|f| f.iter().sum::<f32>() / ch as f32).collect();
    Ok((mono, spec.sample_rate))
}

fn write_window(path: &Path, mono: &[f32], rate: u32, from: f64, to: f64) -> anyhow::Result<()> {
    let a = ((from * rate as f64) as usize).min(mono.len());
    let b = ((to * rate as f64) as usize).clamp(a, mono.len());
    let spec = hound::WavSpec { channels: 1, sample_rate: rate, bits_per_sample: 16, sample_format: hound::SampleFormat::Int };
    let mut w = hound::WavWriter::create(path, spec)?;
    for s in &mono[a..b] {
        w.write_sample((s.clamp(-1.0, 1.0) * 32767.0) as i16)?;
    }
    w.finalize()?;
    Ok(())
}

async fn run_engine(core: &Core, cli: &Path, wav: &Path, text: &str, zh: bool, out: &Path) -> Result<Vec<Word>, Coded> {
    let model = core.models_dir().join(ALIGNER.local);
    let backend = crate::runner::pick_backend(&core.engine.read().unwrap().backends);
    let mut cmd = tokio::process::Command::new(cli);
    cmd.args(["--task", "align", "--family", "qwen3_forced_aligner", "--backend", backend, "--model"])
        .arg(&model)
        .arg("--audio")
        .arg(wav)
        .args(["--text", text, "--language", if zh { "zh" } else { "en" }, "--words-out"])
        .arg(out)
        .current_dir(cli.parent().unwrap_or(Path::new(".")))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    crate::util::hide_console(&mut cmd);
    let output = cmd
        .output()
        .await
        .map_err(|e| Coded::new("engine_spawn_failed", format!("Could not start audiocpp_cli: {e}")).with("detail", e))?;
    if !output.status.success() {
        let tail = String::from_utf8_lossy(&output.stderr).lines().rev().take(3).collect::<Vec<_>>().join(" | ");
        return Err(Coded::new("align_failed", format!("Lyric alignment failed: {tail}")).with("detail", tail));
    }
    let bytes = std::fs::read(out).map_err(|e| Coded::new("align_failed", format!("Lyric alignment failed: {e}")).with("detail", e))?;
    serde_json::from_slice(&bytes).map_err(|e| Coded::new("align_failed", format!("Lyric alignment failed: {e}")).with("detail", e))
}

/// Aligns every sung line; `progress` receives 0..1.
async fn align_song(
    core: &Core,
    cli: &Path,
    wav: &Path,
    lines: &[String],
    scratch: &Path,
    progress: impl Fn(f64),
) -> Result<Vec<[f64; 2]>, Coded> {
    let load_path = wav.to_path_buf();
    let (mono, rate) = tokio::task::spawn_blocking(move || load_mono(&load_path))
        .await
        .map_err(|e| Coded::new("align_failed", format!("Lyric alignment failed: {e}")).with("detail", e))?
        .map_err(|e| Coded::new("align_failed", format!("Lyric alignment failed: {e}")).with("detail", e))?;
    let total = mono.len() as f64 / rate as f64;
    let mono = Arc::new(mono);
    let zh = has_cjk(&lines.join(""));
    let counts: Vec<usize> = lines.iter().map(|l| units(l)).collect();
    let all_units: usize = counts.iter().sum::<usize>().max(1);
    // Units sung per second; refined after every window.
    let mut speed = all_units as f64 / (total * 0.85).max(1.0);

    let mut times: Vec<Option<[f64; 2]>> = vec![None; lines.len()];
    let (mut cursor, mut start) = (0usize, 0.0f64);
    let clip = scratch.join("window.wav");
    let words_out = scratch.join("words.json");
    while cursor < lines.len() {
        let last = total - start <= WINDOW;
        let end = if last { total } else { start + WINDOW };
        let mut upto = cursor;
        if last {
            upto = lines.len();
        } else {
            let mut budget = (WINDOW - EDGE * 2.0) * speed;
            while upto < lines.len() && (upto == cursor || budget >= counts[upto] as f64) {
                budget -= counts[upto] as f64;
                upto += 1;
            }
        }
        let text = lines[cursor..upto].join("\n");
        let (m, c0, s0, e0) = (Arc::clone(&mono), clip.clone(), start, end);
        tokio::task::spawn_blocking(move || write_window(&c0, &m, rate, s0, e0))
            .await
            .map_err(|e| Coded::new("align_failed", format!("Lyric alignment failed: {e}")).with("detail", e))?
            .map_err(|e| Coded::new("align_failed", format!("Lyric alignment failed: {e}")).with("detail", e))?;
        let words = run_engine(core, cli, &clip, &text, zh, &words_out).await?;
        let local = assign(&lines[cursor..upto], &words, rate as f64);

        // Keep lines safely inside the window; the rest are redone next round.
        let mut kept = 0usize;
        for (i, t) in local.iter().enumerate() {
            let ok = last || t.map(|t| t[1] <= (end - start) - EDGE).unwrap_or(true);
            if !ok {
                break;
            }
            kept = i + 1;
        }
        if kept == 0 {
            kept = 1;
        }
        for i in 0..kept {
            times[cursor + i] = local[i].map(|t| [t[0] + start, t[1] + start]);
        }
        let spans: Vec<[f64; 2]> = times[cursor..cursor + kept].iter().flatten().copied().collect();
        if let (Some(first), Some(lastspan)) = (spans.first(), spans.last()) {
            let sung: usize = counts[cursor..cursor + kept].iter().sum();
            let dur = lastspan[1] - first[0];
            if sung > 0 && dur > 1.0 {
                speed = sung as f64 / dur;
            }
        }
        cursor += kept;
        if !last {
            // Resume right after the last kept line so the next onset is inside the clip.
            let next = times[..cursor].iter().rev().flatten().next().map(|t| t[1]).unwrap_or(start + WINDOW / 2.0);
            start = (next - 0.3).max(start + 1.0);
        }
        progress((cursor as f64 / lines.len() as f64).min(1.0));
    }

    // Lines without sung tokens inherit the previous line's end.
    let mut prev = 0.0;
    Ok(times
        .into_iter()
        .map(|t| {
            let t = t.unwrap_or([prev, prev]);
            prev = t[1];
            t
        })
        .collect())
}

pub fn aligner_installed(core: &Core) -> bool {
    file_complete(&core.models_dir().join(ALIGNER.local), ALIGNER.size)
}

fn set_state(core: &Core, id: &str, state: Option<&str>, progress: f64) {
    core.update_job(id, |j| {
        j.align_state = state.map(str::to_string);
        j.align_progress = progress;
    });
}

fn finish_err(core: &Core, id: &str, err: Coded) {
    core.update_job(id, |j| {
        j.align_state = None;
        j.align_progress = 0.0;
        j.align_error = Some(err);
    });
}

async fn download_aligner(core: &Arc<Core>, id: &str) -> anyhow::Result<()> {
    let handle = Arc::new(DownloadHandle {
        cancel: CancellationToken::new(),
        downloaded: std::sync::atomic::AtomicU64::new(0),
        total: ALIGNER.size,
        speed: Mutex::new(0.0),
    });
    let ticker = {
        let (core, id, handle) = (core.clone(), id.to_string(), handle.clone());
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_millis(500)).await;
                let done = handle.downloaded.load(Ordering::Relaxed) as f64 / handle.total as f64;
                set_state(&core, &id, Some("downloading"), done.min(1.0));
            }
        })
    };
    let root = core.models_dir();
    let r = install_files(core, REPO, &[ALIGNER], &root, &handle).await;
    ticker.abort();
    r
}

async fn run(core: Arc<Core>, id: String, cli: PathBuf, wav: PathBuf, lines: Vec<String>) {
    if !aligner_installed(&core) {
        set_state(&core, &id, Some("downloading"), 0.0);
        if let Err(e) = download_aligner(&core, &id).await {
            let coded = match e.downcast::<Coded>() {
                Ok(c) => c,
                Err(e) => Coded::new("download_failed", format!("Download failed: {e}")).with("detail", e),
            };
            finish_err(&core, &id, coded);
            core.persist_jobs();
            return;
        }
    }
    set_state(&core, &id, Some("aligning"), 0.0);
    let scratch = std::env::temp_dir().join(format!("songhearth-align-{id}"));
    let result = match std::fs::create_dir_all(&scratch) {
        Ok(()) => {
            let c = core.clone();
            let jid = id.clone();
            align_song(&core, &cli, &wav, &lines, &scratch, move |p| set_state(&c, &jid, Some("aligning"), p)).await
        }
        Err(e) => Err(Coded::new("align_failed", format!("Lyric alignment failed: {e}")).with("detail", e)),
    };
    let _ = std::fs::remove_dir_all(&scratch);
    match result {
        Ok(times) => {
            core.update_job(&id, |j| {
                j.lyric_times = Some(times);
                j.align_state = None;
                j.align_progress = 0.0;
                j.align_error = None;
            });
        }
        Err(e) => finish_err(&core, &id, e),
    }
    core.persist_jobs();
}

/// Starts aligning a finished song's lyrics in the background.
pub async fn start(core: &Arc<Core>, id: &str) -> Result<Job, Coded> {
    let job = core.job(id).ok_or_else(|| Coded::new("not_found", format!("Job not found: {id}")))?;
    if job.status != JobStatus::Succeeded || !wants_vocals(&job.params) {
        return Err(Coded::new("align_no_lyrics", "Only finished songs with lyrics can be aligned"));
    }
    let wav = job.output_path.clone().map(PathBuf::from).filter(|p| p.is_file());
    let Some(wav) = wav else {
        return Err(Coded::new("align_no_audio", "The audio file is missing"));
    };
    let engine = core.engine.read().unwrap().clone();
    let Some(cli) = engine.cli().filter(|_| engine.installed) else {
        return Err(Coded::new("engine_unavailable", "The audio.cpp engine is unavailable; install or select it in Settings"));
    };
    let lines = sung_lines(&job.params.lyrics);
    if lines.is_empty() {
        return Err(Coded::new("align_no_lyrics", "Only finished songs with lyrics can be aligned"));
    }
    {
        let mut busy = false;
        core.update_job(id, |j| {
            if j.align_state.is_some() {
                busy = true;
            } else {
                j.align_state = Some("preparing".into());
                j.align_progress = 0.0;
                j.align_error = None;
            }
        });
        if busy {
            return Ok(core.job(id).unwrap_or(job));
        }
    }
    let job = core.job(id).unwrap_or(job);
    tokio::spawn(run(core.clone(), id.to_string(), cli, wav, lines));
    Ok(job)
}

/// Aligns right after generation when the aligner is already installed.
pub async fn auto_start(core: &Arc<Core>, id: &str) {
    if aligner_installed(core) {
        let _ = start(core, id).await;
    }
}
