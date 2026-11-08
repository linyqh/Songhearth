---
name: songhearth
description: Generate songs, instrumentals and BGM locally on this Mac with the Songhearth app (audio.cpp + YuE2 / ACE-Step / MiniMax Music 3 / Stable Audio 3). Use when the user asks to compose, generate or render music, a song from lyrics, background music, a jingle, or to check/install local music models.
---

# Songhearth — local music generation

Songhearth is a desktop app that runs open-weight music models locally and exposes an HTTP API (`127.0.0.1`, and the LAN by default). Use the bundled client; it finds the API URL (and token, if one is enabled) automatically from `~/Library/Application Support/com.songhearth.app/api.json` and launches the app if needed. To reach a Mac from another machine set `SONGHEARTH_URL=http://<mac-lan-ip>:17865` (and `SONGHEARTH_TOKEN` if required).

```bash
python3 scripts/songhearth.py <command> [...]   # path relative to this skill folder
```

All commands print JSON on stdout; progress goes to stderr.

## Workflow

1. `status` — confirm `engine.ready` is true and see `installedModels`.
   - Engine missing → tell the user to open Songhearth → 设置 → 安装引擎 (or `POST /api/v1/engine/install`).
2. `models` — pick a model. If none suits the request, offer `install <id> --wait` (downloads are several GB; ask the user first).
3. `generate` — blocks until finished, prints the job with `outputPath` (WAV already saved in the user's library). Add `--out <path>` to copy the WAV elsewhere.
4. Report the title, model, duration and `outputPath` to the user.

## Choosing a model (`--model`, default `auto`)

| id | Best for | Vocals | Lyrics | License |
|---|---|---|---|---|
| `yue2-3b` | highest-quality songs, Chinese/English lyrics | yes | optional (empty → instrumental) | non-commercial |
| `minimax-music-3` | full pop songs up to 5 min | yes | **required** | conditional commercial |
| `ace-step-1.5-turbo` | fastest songs, 50+ languages, commercial use | yes | optional | MIT (commercial OK) |
| `stable-audio-3-medium` | instrumental BGM / scoring, best instrumental quality | no | not allowed | conditional commercial |
| `stable-audio-3-small` | quick instrumental sketches/loops | no | not allowed | conditional commercial |

`auto` picks the best installed model: singing models when lyrics are given, instrumental models otherwise. If the user needs commercial rights, choose `ace-step-1.5-turbo`.

## Writing inputs

- `--prompt` (required): style description. YuE2 and Stable Audio work best with **English comma-separated tags** (genre, instruments, mood, vocal type, BPM), e.g. `Mandarin, city pop, groovy bass, electric guitar, female vocal`. MiniMax prefers a detailed sentence.
- `--lyrics` / `--lyrics-file`: put structure tags on their own lines: `[Intro]`, `[Verse]`, `[Pre-Chorus]`, `[Chorus]`, `[Bridge]`, `[Outro]`. Write lyrics in the language to be sung.
- `--instrumental`: force no vocals.
- `--duration`: seconds. Exact length for Stable Audio / ACE-Step; *maximum* length for YuE2 / MiniMax (lyrics decide the real length).
- `--seed`: reuse a previous job's `seed` to reproduce it; omit for variety.
- `--cot off|melody|full` (YuE2 only): `full` (default) plans melody+chords for better structure; `off` is ~2× faster.

## Examples

```bash
# Song with lyrics, saved copy next to the project
python3 scripts/songhearth.py generate \
  --prompt "Mandarin, indie pop, warm acoustic guitar, soft drums, female vocal" \
  --lyrics-file lyrics.txt --title "夏夜" --out ./xiaye.wav

# 30-second instrumental BGM
python3 scripts/songhearth.py generate --instrumental --duration 30 \
  --prompt "lofi hip hop, mellow rhodes piano, vinyl crackle, 80 BPM"

# Queue without waiting, then poll
python3 scripts/songhearth.py generate --prompt "..." --no-wait
python3 scripts/songhearth.py wait <id>
```

## Timing expectations (Apple Silicon)

Generation runs one job at a time; each job reloads the model (~10 s). Rough compute per minute of audio: Stable Audio ≈ seconds, ACE-Step ≈ 10–20 s, YuE2 ≈ 40–60 s (`--cot off`) to longer with `full`, MiniMax ≈ 1–2 min. Tell the user when a long song will take minutes; use `--no-wait` for batches.

## Errors

Errors are JSON `{"error": {"code", "message"}}` (exit code 2). Common codes: `engine_missing`, `no_model_installed`, `model_not_installed`, `model_no_vocals` (remove lyrics or switch model), `lyrics_required` (MiniMax), `unauthorized` (token changed — the client rereads `api.json`; restart the app if it persists). A failed generation returns `status: "failed"` with `error` text from audio.cpp.

## Raw HTTP API

See `reference/api.md` for endpoints (`/api/v1/generations`, `/wait`, `/audio`, `/models/{id}/install`, …) when calling without the script.
