use std::path::{Path, PathBuf};

use serde::Serialize;

pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// Seeds stay inside u32 because ACE-Step rejects larger values.
pub fn random_seed() -> u64 {
    (uuid::Uuid::new_v4().as_u128() % 4_294_967_295) as u64
}

pub fn random_token() -> String {
    format!(
        "zm_{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}

pub fn has_cjk(text: &str) -> bool {
    text.chars().any(|c| {
        matches!(c as u32,
            0x4E00..=0x9FFF | 0x3400..=0x4DBF | 0x3040..=0x30FF | 0xAC00..=0xD7AF)
    })
}

/// Title shown in the library when the user did not provide one: first sung
/// lyric line, else the first phrase of the style prompt.
pub fn derive_title(lyrics: &str, prompt: &str) -> String {
    let from_lyrics = lyrics
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty() && !(l.starts_with('[') && l.ends_with(']')));
    let raw = from_lyrics.unwrap_or_else(|| {
        prompt
            .split([',', '，', '。', '.', ';', '；', '\n'])
            .map(str::trim)
            .find(|s| !s.is_empty())
            .unwrap_or("")
    });
    let title: String = raw.chars().take(24).collect();
    let title = title.trim().to_string();
    if title.is_empty() {
        "Untitled".to_string()
    } else {
        title
    }
}

pub fn sanitize_filename(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\n' | '\r' | '\t' => ' ',
            c => c,
        })
        .collect();
    let collapsed = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed: String = collapsed.chars().take(40).collect();
    let trimmed = trimmed.trim_matches(|c: char| c == '.' || c.is_whitespace());
    if trimmed.is_empty() {
        "track".to_string()
    } else {
        trimmed.to_string()
    }
}

pub fn unique_path(dir: &Path, stem: &str, ext: &str) -> PathBuf {
    let mut candidate = dir.join(format!("{stem}.{ext}"));
    let mut n = 2;
    while candidate.exists() {
        candidate = dir.join(format!("{stem}-{n}.{ext}"));
        n += 1;
    }
    candidate
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    pub total_memory_gb: f64,
    pub chip: String,
    pub arch: String,
    /// Human-readable OS name and version, e.g. "macOS 15.2" or "Windows 11 Pro".
    pub os: String,
}

pub fn system_info() -> SystemInfo {
    use sysinfo::{CpuRefreshKind, MemoryRefreshKind, RefreshKind, System};
    let sys = System::new_with_specifics(
        RefreshKind::nothing()
            .with_memory(MemoryRefreshKind::nothing().with_ram())
            .with_cpu(CpuRefreshKind::nothing()),
    );
    let chip = sys
        .cpus()
        .first()
        .map(|c| c.brand().trim().to_string())
        .filter(|b| !b.is_empty())
        .unwrap_or_else(|| "Unknown".into());
    SystemInfo {
        total_memory_gb: (sys.total_memory() as f64 / 1024f64.powi(3)).round(),
        chip,
        arch: std::env::consts::ARCH.to_string(),
        os: System::long_os_version().unwrap_or_else(|| std::env::consts::OS.to_string()),
    }
}

/// Sets Unix permission bits. No-op on Windows, where files under the
/// per-user app data folder already inherit user-only ACLs.
#[cfg(unix)]
pub fn set_unix_mode(path: &Path, mode: u32) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode))
}

#[cfg(not(unix))]
pub fn set_unix_mode(_path: &Path, _mode: u32) -> std::io::Result<()> {
    Ok(())
}

/// Keeps `audiocpp_cli` from flashing a console window when the GUI app
/// (Windows subsystem) spawns it.
pub fn hide_console(cmd: &mut tokio::process::Command) -> &mut tokio::process::Command {
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    cmd
}

/// Peak envelope for the library waveform; reads 16/24/32-bit PCM or float WAV.
pub fn wav_peaks(path: &Path, buckets: usize) -> Option<(Vec<f32>, f64)> {
    let mut reader = hound::WavReader::open(path).ok()?;
    let spec = reader.spec();
    let channels = spec.channels.max(1) as usize;
    let total_frames = reader.duration() as usize;
    if total_frames == 0 {
        return Some((vec![0.0; buckets], 0.0));
    }
    let duration = total_frames as f64 / spec.sample_rate as f64;
    let frames_per_bucket = total_frames.div_ceil(buckets).max(1);
    let mut peaks = vec![0f32; buckets];
    let scale = match spec.sample_format {
        hound::SampleFormat::Float => 1.0,
        hound::SampleFormat::Int => 1.0 / (1u64 << (spec.bits_per_sample - 1)) as f32,
    };
    let mut idx = 0usize;
    let mut push = |v: f32, idx: usize| {
        let b = (idx / channels) / frames_per_bucket;
        if b < buckets {
            let a = v.abs();
            if a > peaks[b] {
                peaks[b] = a;
            }
        }
    };
    match spec.sample_format {
        hound::SampleFormat::Float => {
            for s in reader.samples::<f32>().map_while(Result::ok) {
                push(s, idx);
                idx += 1;
            }
        }
        hound::SampleFormat::Int => {
            for s in reader.samples::<i32>().map_while(Result::ok) {
                push(s as f32 * scale, idx);
                idx += 1;
            }
        }
    }
    let max = peaks.iter().cloned().fold(0f32, f32::max).max(1e-6);
    let peaks = peaks
        .into_iter()
        .map(|p| ((p / max) * 1000.0).round() / 1000.0)
        .collect();
    Some((peaks, duration))
}
