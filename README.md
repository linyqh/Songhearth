<div align="center">

<img src="src-tauri/icons/icon.png" width="112" alt="Songhearth logo" />

# Songhearth

**A local-first AI music generation desktop app**

Run open-source music models offline on your own GPU (Apple Silicon Metal, or Vulkan on Windows). No cloud, no subscription.<br/>
Ships with a local HTTP API and an Agent Skill so Claude Code, Codex and other agents can drive it.

![Platform](https://img.shields.io/badge/platform-macOS%20(Apple%20Silicon)%20%7C%20Windows%20x64-black?logo=apple)
![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![Rust](https://img.shields.io/badge/Rust-stable-DEA584?logo=rust&logoColor=black)

[English](README.md) · [简体中文](README.zh-CN.md)

</div>

---

## Features

- 🎼 **Create**: style prompt + lyrics editor (one-click section tags), vocal / instrumental toggle, model picker (quality, speed, license at a glance), duration, seed lock, and advanced options (YuE2 score planning, sampling steps, negative prompt). **Reference song** (ACE-Step): pick an mp3/wav/flac/m4a/ogg, keep its melody and structure, and re-sing it with your own lyrics and style. `⌘↩` (`Ctrl+↵` on Windows) to generate; drafts autosave.
- ⏳ **Queue**: jobs run in submission order with live stage, progress and ETA; cancel any time; system notification on completion.
- 🎧 **Library**: waveform playback with click-to-seek, favorites, rename, search, reuse parameters, re-roll with a new seed, export, reveal in Finder / Explorer; failed jobs show the audio.cpp error and can be retried in one click.
- 📦 **Model manager**: 8-way parallel segmented download, resume, pause/continue, mirror (hf-mirror), delete; warns when RAM is tight.
- 🤖 **API & Skill**: REST API and discovery file generated automatically; install the Skill into Claude Code / Codex / any directory in one click.
- 🌍 **i18n**: English / 简体中文; adding a language needs no code changes.
- 🎨 **Native look**: macOS liquid-glass styling following system accent color and light/dark mode; Windows uses the native title bar with the same light/dark theme.

## Quick start

> **macOS (Apple Silicon)** and **Windows 10/11 (x64)**. Windows runs on the audio.cpp Vulkan build, which works with NVIDIA, AMD and Intel GPUs (up-to-date graphics drivers required).

1. Install and open the app. If the audio.cpp engine isn't found, first launch offers to download it (35–85 MB).
2. Download a model on the Models page (`yue2-3b`, 2.9 GB, is a good start).
3. Enter a style prompt and lyrics on Create, then press `⌘↩` (`Ctrl+↵` on Windows).

Models live in the app data folder by default (`~/Library/Application Support/com.songhearth.app/models` on macOS, `%LOCALAPPDATA%\com.songhearth.app\models` on Windows; settings can point to an existing audio.cpp `models` directory). Tracks are saved to `Music/Songhearth` in your user folder.

## Supported models

Model files come from the official audio.cpp GGUF packs on Hugging Face. **Check each model's license against your use case.**

| id | Model | Vocals | License | Size |
|---|---|---|---|---|
| `yue2-3b` | YuE2 3B (Q4) | ✓ (empty lyrics → instrumental) | CC BY-NC 4.0, non-commercial | 2.9 GB |
| `ace-step-1.5-turbo` | ACE-Step 1.5 Turbo (BF16) | ✓ | MIT, commercial OK | 10.1 GB |
| `minimax-music-3` | MiniMax Music 3 (Q4/Q8 mix) | ✓ (lyrics required) | Community license, conditional commercial use | 8.5 GB |
| `stable-audio-3-medium` | Stable Audio 3 Medium (Q8) | ✗ instrumental | Stability community license | 3.6 GB |
| `stable-audio-3-small` | Stable Audio 3 Small Music (Q8) | ✗ instrumental | Stability community license | 1.7 GB |

## HTTP API & Agent Skill

The API listens on `0.0.0.0:17865` by default: `http://127.0.0.1:17865` locally, or this machine's IP from the LAN (shown on the in-app API & Skill page).

> ⚠️ By default the API is **open to the LAN with no token**. On untrusted networks, disable LAN access or enable the Bearer token in the app.

Address and token are written to `api.json` in the app data folder (`~/Library/Application Support/com.songhearth.app/` on macOS, `%LOCALAPPDATA%\com.songhearth.app\` on Windows). Full reference: [skills/songhearth/reference/api.md](skills/songhearth/reference/api.md).

```bash
python3 skills/songhearth/scripts/songhearth.py status
python3 skills/songhearth/scripts/songhearth.py generate \
  --prompt "Mandarin, indie pop, warm acoustic guitar, female vocal" \
  --lyrics-file lyrics.txt --title "Summer Night" --out ./summer-night.wav
```

The client has zero dependencies, reads the discovery file automatically, and starts the app if it isn't running (`open -b com.songhearth.app` on macOS, the per-user install under `%LOCALAPPDATA%\Songhearth` on Windows).

## Architecture

```
src/                      React + TypeScript UI
src-tauri/src/
  core.rs                 shared state, persistence (settings/jobs/perf.json), event push
  catalog.rs              model catalog (files, parameter ranges, license, recommended use)
  engine.rs               locate / download audio.cpp
  models.rs               model download: 8-way segments, .part + state file resume
  jobs.rs                 job validation, auto model pick, queue ops
  runner.rs               runs audiocpp_cli one job at a time; parses logs for stage/progress/ETA; cancellable
  api.rs                  axum HTTP API + api.json discovery file
  commands.rs             Tauri commands (called by the UI)
skills/songhearth/        Agent Skill: SKILL.md, zero-dependency Python client, API docs
```

Each job spawns one `audiocpp_cli` (`--backend metal` on macOS, `vulkan` on Windows): cancel kills the process, and a crash can't take the app down. The cost is ~5–10 s model load per job. ETA starts from built-in estimates and calibrates to measured speed after each track.

Engine lookup order: custom path in settings → bundled (`resources/engine`) → auto-downloaded (`<app data>/engine/current`) → `/opt/homebrew/bin`, `/usr/local/bin` (macOS only).

## Internationalization

UI uses [i18next](https://www.i18next.com) + react-i18next. Supported: English (`en`, source) and Simplified Chinese (`zh-CN`). Settings → Language offers "Follow system" or a fixed language.

<details>
<summary><b>Adding a language (e.g. Japanese <code>ja</code>)</b></summary>

1. Copy `src/i18n/locales/en` to `src/i18n/locales/ja` and translate the JSON values (keep `{{variables}}`; adjust `_one/_other` plural suffixes to the language's plural rules).
2. Set `meta.name` in `ja/common.json` to the language's own name (e.g. "日本語"); it appears in the language list automatically.
3. Run `npm run i18n:check` to verify files, keys and placeholders match. `npm run build` runs it first.

No code changes needed: languages are discovered via `import.meta.glob`. The backend emits no UI text, only stable error codes + params (`errors:<code>`) and stage codes (`stages:<code>`); `message` in HTTP responses stays English for agents.

</details>

## Development

Requires Node 20+ and Rust (stable), plus Xcode command line tools on macOS or Visual Studio Build Tools (C++ desktop workload) on Windows.

```bash
npm install
npm run fetch-engine        # download the audio.cpp build for this OS (macOS Metal / Windows Vulkan portable) into src-tauri/resources/engine; bundled into the app
npx tauri dev               # develop
npx tauri build             # macOS: .app / .dmg · Windows: NSIS installer (.exe)
```

| Command | Purpose |
|---|---|
| `npm run typecheck` | TypeScript type check |
| `npm run i18n:check` | Validate translation files |
| `cd src-tauri && cargo test --lib` | Rust unit tests |

## Releasing

- **Windows**: publishing a (non-draft, non-pre-release) GitHub Release triggers [`.github/workflows/release-windows.yml`](.github/workflows/release-windows.yml), which builds the NSIS installer on `windows-latest` and attaches `*-setup.exe` to that release. Run it manually for an existing tag via *Actions → Release (Windows) → Run workflow*. The installer is unsigned, so Windows SmartScreen will warn on first run.
- **macOS**: not built in CI (macOS runners are expensive). Build the `.dmg` locally and upload it to the same release:

```bash
npm run fetch-engine
npm run tauri build -- --bundles dmg
gh release upload <tag> src-tauri/target/release/bundle/dmg/*.dmg
```

## Acknowledgements

- [audio.cpp](https://github.com/0xShug0/audio.cpp): inference engine
- [Tauri](https://tauri.app): desktop framework
- The authors and communities of YuE, ACE-Step, MiniMax Music and Stable Audio
