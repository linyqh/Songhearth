#!/usr/bin/env python3
"""Command-line client for the Songhearth local API (stdlib only).

Discovers the API URL and token from the app's discovery file, launches the
app when it is not running, and prints JSON on stdout for agents to parse.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

BUNDLE_ID = "com.songhearth.app"
DEFAULT_URL = "http://127.0.0.1:17865"


def _discovery_file() -> Path:
    """Where the app writes api.json: its per-user local data folder."""
    if sys.platform == "win32":
        base = Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local")
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    else:
        base = Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share")
    return base / BUNDLE_ID / "api.json"


DISCOVERY = _discovery_file()


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(f"{code}: {message}")
        self.status, self.code, self.message = status, code, message


def discover() -> tuple[str, str | None]:
    url = os.environ.get("SONGHEARTH_URL")
    token = os.environ.get("SONGHEARTH_TOKEN")
    if DISCOVERY.exists():
        try:
            info = json.loads(DISCOVERY.read_text())
            url = url or info.get("url")
            token = token or info.get("token")
        except (OSError, ValueError):
            pass
    return (url or DEFAULT_URL).rstrip("/"), token


def request(method: str, path: str, body: dict | None = None, timeout: float = 30, raw: bool = False):
    url, token = discover()
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url + path, data=data, method=method)
    req.add_header("Accept", "application/json")
    if data is not None:
        req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            payload = resp.read()
            if raw:
                return payload
            return json.loads(payload) if payload else {}
    except urllib.error.HTTPError as e:
        try:
            err = json.loads(e.read()).get("error", {})
        except ValueError:
            err = {}
        raise ApiError(e.code, err.get("code", "http_error"), err.get("message", str(e))) from None


def launch_app() -> bool:
    """Starts the app without stealing focus where the OS allows it; False if it cannot be found."""
    if sys.platform == "darwin":
        subprocess.run(["open", "-g", "-b", BUNDLE_ID], check=False)
        return True
    if sys.platform == "win32":
        roots = [os.environ.get("LOCALAPPDATA"), os.environ.get("PROGRAMFILES")]
        for root in filter(None, roots):
            # Per-user NSIS install (default) first, then per-machine.
            for rel in ("Songhearth", "Programs/Songhearth"):
                exe = Path(root) / rel / "Songhearth.exe"
                if exe.exists():
                    subprocess.Popen([str(exe)], creationflags=0x00000008 | 0x00000200, close_fds=True)  # DETACHED_PROCESS | NEW_PROCESS_GROUP
                    return True
    return False


def ensure_running(launch: bool = True, wait_s: float = 30) -> dict:
    try:
        return request("GET", "/api/v1/health", timeout=3)
    except (urllib.error.URLError, ConnectionError, TimeoutError):
        if not launch or not launch_app():
            raise
    deadline = time.time() + wait_s
    while time.time() < deadline:
        time.sleep(1)
        try:
            return request("GET", "/api/v1/health", timeout=3)
        except (urllib.error.URLError, ConnectionError, TimeoutError):
            continue
    raise SystemExit("Songhearth is not reachable. Open the app and enable the API in 接口 settings.")


def out(obj) -> None:
    print(json.dumps(obj, ensure_ascii=False, indent=2))


def cmd_status(_args) -> None:
    out(ensure_running())


def cmd_models(args) -> None:
    ensure_running()
    models = request("GET", "/api/v1/models")["models"]
    if not args.full:
        models = [
            {
                "id": m["id"],
                "name": m["name"],
                "installed": m["status"]["state"] == "installed",
                "state": m["status"]["state"],
                "vocals": m["vocals"],
                "instrumental": m["instrumental"],
                "lyricsRequired": m["lyricsRequired"],
                "duration": m["duration"],
                "license": m["license"]["name"],
                "commercial": m["license"]["commercial"],
                "sizeGB": round(m["totalSize"] / 1e9, 2),
                "summary": m["summary"],
                "promptHint": m["promptHint"],
            }
            for m in models
        ]
    out(models)


def cmd_install(args) -> None:
    ensure_running()
    model = request("POST", f"/api/v1/models/{args.model}/install")
    if not args.wait:
        out(model["status"])
        return
    while True:
        st = poll("GET", f"/api/v1/models/{args.model}")["status"]
        if st["state"] == "installed":
            out(st)
            return
        if st["state"] == "partial" and not st.get("error"):
            # Paused (e.g. the app restarted): resume from the saved offset.
            request("POST", f"/api/v1/models/{args.model}/install")
        elif st["state"] != "downloading":
            raise SystemExit(f"download stopped: {st.get('error') or st['state']}")
        pct = 100 * st["downloadedBytes"] / max(st["totalBytes"], 1)
        print(f"downloading {pct:.1f}%", file=sys.stderr)
        time.sleep(5)


def poll(method: str, path: str, timeout: float = 30, outage_s: float = 90):
    """`request` that rides out short app restarts instead of failing."""
    deadline = time.time() + outage_s
    while True:
        try:
            return request(method, path, timeout=timeout)
        except (urllib.error.URLError, ConnectionError, TimeoutError):
            if time.time() >= deadline:
                raise SystemExit("lost connection to Songhearth")
            time.sleep(2)


def read_text(value: str | None, file: str | None) -> str:
    if file:
        return Path(file).read_text(encoding="utf-8")
    return value or ""


def finish(job: dict, out_path: str | None) -> dict:
    if job.get("status") == "succeeded" and out_path:
        data = request("GET", f"/api/v1/generations/{job['id']}/audio", timeout=120, raw=True)
        Path(out_path).expanduser().write_bytes(data)
        job["savedTo"] = str(Path(out_path).expanduser().resolve())
    return job


def cmd_generate(args) -> None:
    ensure_running()
    body = {
        "model": args.model,
        "prompt": args.prompt,
        "lyrics": read_text(args.lyrics, args.lyrics_file),
        "instrumental": args.instrumental,
        "title": args.title,
        "duration": args.duration,
        "seed": args.seed,
        "steps": args.steps,
        "cot": args.cot,
        "negativePrompt": args.negative_prompt,
        "sourceAudio": str(Path(args.source_audio).expanduser().resolve()) if args.source_audio else None,
        "coverStrength": args.cover_strength,
    }
    body = {k: v for k, v in body.items() if v not in (None, "")}
    job = request("POST", "/api/v1/generations", body)
    if args.no_wait:
        out(job)
        return
    job = wait_for(job["id"], args.timeout)
    out(finish(job, args.out))
    if job["status"] != "succeeded":
        sys.exit(1)


def wait_for(job_id: str, timeout: float) -> dict:
    deadline = time.time() + timeout
    while True:
        remaining = max(1, int(deadline - time.time()))
        job = poll("GET", f"/api/v1/generations/{job_id}/wait?timeout={min(remaining, 120)}", timeout=min(remaining, 120) + 15)
        if job["status"] in ("succeeded", "failed", "cancelled") or time.time() >= deadline:
            return job
        eta = job.get("etaSec")
        print(f"{job['stage']} {job['progress'] * 100:.0f}%" + (f" eta {eta:.0f}s" if eta else ""), file=sys.stderr)


def cmd_wait(args) -> None:
    ensure_running()
    out(finish(wait_for(args.id, args.timeout), args.out))


def cmd_get(args) -> None:
    ensure_running()
    out(finish(request("GET", f"/api/v1/generations/{args.id}"), args.out))


def cmd_list(args) -> None:
    ensure_running()
    q = f"?limit={args.limit}" + (f"&status={args.status}" if args.status else "")
    out(request("GET", "/api/v1/generations" + q)["generations"])


def cmd_cancel(args) -> None:
    ensure_running()
    out(request("POST", f"/api/v1/generations/{args.id}/cancel"))


def main() -> None:
    p = argparse.ArgumentParser(prog="songhearth", description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("status", help="health, engine and installed models").set_defaults(fn=cmd_status)

    m = sub.add_parser("models", help="list models and install state")
    m.add_argument("--full", action="store_true")
    m.set_defaults(fn=cmd_models)

    i = sub.add_parser("install", help="download a model")
    i.add_argument("model")
    i.add_argument("--wait", action="store_true")
    i.set_defaults(fn=cmd_install)

    g = sub.add_parser("generate", help="generate a track and wait for it")
    g.add_argument("--prompt", required=True, help="style / music description")
    g.add_argument("--lyrics")
    g.add_argument("--lyrics-file")
    g.add_argument("--instrumental", action="store_true")
    g.add_argument("--model", default="auto")
    g.add_argument("--title")
    g.add_argument("--duration", type=float, help="seconds (max length for YuE2/MiniMax)")
    g.add_argument("--seed", type=int)
    g.add_argument("--steps", type=int)
    g.add_argument("--cot", choices=["off", "melody", "full"], help="YuE2 score planning")
    g.add_argument("--negative-prompt")
    g.add_argument("--source-audio", help="reference song (local to the app's machine): keeps its melody, re-sings with --lyrics (ACE-Step cover)")
    g.add_argument("--cover-strength", type=float, help="0..1 closeness to the reference song (default 1)")
    g.add_argument("--out", help="also copy the WAV to this path")
    g.add_argument("--timeout", type=float, default=1800)
    g.add_argument("--no-wait", action="store_true")
    g.set_defaults(fn=cmd_generate)

    w = sub.add_parser("wait", help="wait for a generation")
    w.add_argument("id")
    w.add_argument("--out")
    w.add_argument("--timeout", type=float, default=1800)
    w.set_defaults(fn=cmd_wait)

    gt = sub.add_parser("get", help="show one generation")
    gt.add_argument("id")
    gt.add_argument("--out")
    gt.set_defaults(fn=cmd_get)

    ls = sub.add_parser("list", help="recent generations")
    ls.add_argument("--limit", type=int, default=20)
    ls.add_argument("--status", choices=["queued", "running", "succeeded", "failed", "cancelled"])
    ls.set_defaults(fn=cmd_list)

    c = sub.add_parser("cancel", help="cancel a queued or running generation")
    c.add_argument("id")
    c.set_defaults(fn=cmd_cancel)

    args = p.parse_args()
    try:
        args.fn(args)
    except ApiError as e:
        out({"error": {"status": e.status, "code": e.code, "message": e.message}})
        sys.exit(2)


if __name__ == "__main__":
    main()
