#!/usr/bin/env node
// Downloads the audio.cpp release for the current platform and stages the
// files the app bundles (CLI, runtime DLLs on Windows, model specs, licence)
// into src-tauri/resources/engine.
//
//   macOS    audio-v<ver>-bin-macos-<arm64|x64>-metal.tar.gz
//   Windows  audio-v<ver>-bin-windows-x64-vulkan-portable.zip
//
// Keep VERSION in sync with ENGINE_VERSION in src-tauri/src/engine.rs.
// AUDIOCPP_VERSION / AUDIOCPP_ASSET override the version and the asset suffix
// (e.g. AUDIOCPP_ASSET=windows-x64-cpu-portable.zip).
import { execFileSync } from "node:child_process";
import { cpSync, createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = process.env.AUDIOCPP_VERSION ?? "0.9.4";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dest = join(root, "src-tauri", "resources", "engine");

function defaultAsset() {
  if (process.platform === "darwin") {
    if (process.arch === "arm64") return "macos-arm64-metal.tar.gz";
    if (process.arch === "x64") return "macos-x64-metal.tar.gz";
  }
  if (process.platform === "win32" && process.arch === "x64") return "windows-x64-vulkan-portable.zip";
  throw new Error(`unsupported platform: ${process.platform}/${process.arch}`);
}

const asset = process.env.AUDIOCPP_ASSET ?? defaultAsset();
const isZip = asset.endsWith(".zip");
const cliName = asset.startsWith("windows") ? "audiocpp_cli.exe" : "audiocpp_cli";
const url = `https://github.com/0xShug0/audio.cpp/releases/download/v${VERSION}/audio-v${VERSION}-bin-${asset}`;

function alreadyStaged() {
  const cli = join(dest, cliName);
  if (!existsSync(cli) || process.env.AUDIOCPP_ASSET) return false;
  try {
    return execFileSync(cli, ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).includes(`audio.cpp ${VERSION}`);
  } catch {
    return false;
  }
}

if (alreadyStaged()) {
  console.log(`audio.cpp ${VERSION} already staged in ${dest}`);
  process.exit(0);
}

// bsdtar reads both .tar.gz and .zip. On Windows use the system one: Git
// Bash puts GNU tar first on PATH, and GNU tar cannot read zip.
const tar = process.platform === "win32" ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";

const tmp = mkdtempSync(join(tmpdir(), "audiocpp-"));
try {
  const archive = join(tmp, isZip ? "engine.zip" : "engine.tar.gz");
  console.log(`Downloading ${url}`);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`download failed: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(archive));

  const members = [cliName, "LICENSE", "model_specs"];
  if (cliName.endsWith(".exe")) members.push("*.dll");
  execFileSync(tar, ["-xf", archive, "-C", tmp, ...members], { stdio: "inherit" });

  mkdirSync(dest, { recursive: true });
  for (const name of readdirSync(dest)) {
    if (name !== ".gitkeep") rmSync(join(dest, name), { recursive: true, force: true });
  }
  for (const name of readdirSync(tmp)) {
    if (name !== (isZip ? "engine.zip" : "engine.tar.gz")) cpSync(join(tmp, name), join(dest, name), { recursive: true });
  }
  if (!existsSync(join(dest, cliName))) throw new Error(`${cliName} missing from the archive`);
  console.log(`Staged into ${dest}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
