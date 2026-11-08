# Songhearth HTTP API (v1)

Base URL: `http://127.0.0.1:17865` locally, or `http://<lan-ip>:17865` from other devices on the same network (listening on all interfaces is the default; it can be limited to loopback in the app: 接口 → 允许局域网访问). The port is configurable. The local URL (and the token, if enabled) is written to `api.json` while the API runs: `~/Library/Application Support/com.songhearth.app/api.json` (mode 0600) on macOS, `%LOCALAPPDATA%\com.songhearth.app\api.json` on Windows.

Authentication: none by default. If 要求 Token is switched on in the app, send `Authorization: Bearer <token>` (or `X-Api-Key: <token>`) on every endpoint except `/api/v1/health`.

All bodies are JSON (camelCase). Errors: `{"error": {"code": "...", "message": "..."}}`.

## Health & engine

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/health` | `{ok, version, engine:{ready, version}, installedModels:[...], authRequired}` |
| GET | `/api/v1/engine` | audio.cpp engine status |
| POST | `/api/v1/engine/install` | download the audio.cpp release (≈35 MB); 202 |

## Models

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/models` | `{models: [Model]}` |
| GET | `/api/v1/models/{id}` | one model |
| POST | `/api/v1/models/{id}/install` | start/resume download; 202 |
| DELETE | `/api/v1/models/{id}` | remove files; 204 |

`Model` fields: `id, name, vendor, family, summary, description, tags, vocals, instrumental, lyricsRequired, languages, promptHint, promptExample, license{name, commercial: yes|no|conditional, note, url}, files, quality(1-5), speed(1-5), memoryGb, duration{min,max,default,mode: exact|max}, steps{min,max,default}|null, supportsCot, supportsNegativePrompt, totalSize, status{state: notInstalled|partial|downloading|installed, downloadedBytes, totalBytes, speedBps, error, path}`.

## Generations

| Method | Path | Notes |
|---|---|---|
| POST | `/api/v1/generations` | queue a job; 202 with `Generation` |
| GET | `/api/v1/generations?limit=50&status=succeeded` | newest first |
| GET | `/api/v1/generations/{id}` | one job |
| GET | `/api/v1/generations/{id}/wait?timeout=600` | long-poll until finished or timeout (max 3600 s) |
| GET | `/api/v1/generations/{id}/audio` | WAV bytes (`audio/wav`) |
| POST | `/api/v1/generations/{id}/cancel` | cancel queued/running job |
| DELETE | `/api/v1/generations/{id}?deleteFile=true` | remove from library (optionally delete WAV) |

Request body:

```json
{
  "model": "auto",
  "prompt": "Mandarin, city pop, groovy bass, female vocal",
  "lyrics": "[Verse]\n...\n[Chorus]\n...",
  "instrumental": false,
  "title": "optional",
  "duration": 120,
  "seed": 1234,
  "steps": 8,
  "cot": "full",
  "negativePrompt": "optional (ACE-Step / Stable Audio)"
}
```

Only `prompt` is required. `duration` is clamped to the model range. `seed` is random when omitted (returned in the response).

`Generation` fields: `id, title, modelId, params, seed, duration, status (queued|running|succeeded|failed|cancelled), stage, progress (0..1), etaSec, createdAt, startedAt, finishedAt, outputPath, audioUrl, audioDurationSec, wallSec, error, source (app|api), favorite`.

Jobs run sequentially in creation order (one GPU job at a time).

## curl

```bash
TOKEN=$(python3 -c 'import json,os,sys;d={"win32":os.environ.get("LOCALAPPDATA",""),"darwin":os.path.expanduser("~/Library/Application Support")}.get(sys.platform,os.path.expanduser("~/.local/share"));print(json.load(open(os.path.join(d,"com.songhearth.app","api.json"))).get("token") or "")')  # empty when token is off
AUTH=${TOKEN:+-H "Authorization: Bearer $TOKEN"}
ID=$(curl -s $AUTH -H 'Content-Type: application/json' \
  -d '{"prompt":"lofi hip hop, rhodes piano, 80 BPM","instrumental":true,"duration":30}' \
  http://127.0.0.1:17865/api/v1/generations | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')
curl -s $AUTH "http://127.0.0.1:17865/api/v1/generations/$ID/wait?timeout=900"
curl -s $AUTH -o track.wav "http://127.0.0.1:17865/api/v1/generations/$ID/audio"
```
