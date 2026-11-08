#!/usr/bin/env node
// Verifies every locale against English (the source of truth):
//  - same namespace files, same keys (plural suffixes may differ by language)
//  - same {{placeholders}} per key
//  - `common.json` defines meta.name
// Usage: npm run i18n:check
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "i18n", "locales");
const SOURCE = "en";
const PLURAL = /_(zero|one|two|few|many|other)$/;

const flatten = (obj, prefix = "") =>
  Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" ? flatten(v, `${prefix}${k}.`) : [[`${prefix}${k}`, String(v)]],
  );
const base = (key) => key.replace(PLURAL, "");
const placeholders = (s) => [...s.matchAll(/{{\s*([\w.]+)\s*}}/g)].map((m) => m[1]).sort().join(",");

const langs = readdirSync(root).filter((d) => statSync(join(root, d)).isDirectory());
if (!langs.includes(SOURCE)) throw new Error(`missing source locale "${SOURCE}"`);
const load = (lng, file) => Object.fromEntries(flatten(JSON.parse(readFileSync(join(root, lng, file), "utf8"))));
const files = readdirSync(join(root, SOURCE)).filter((f) => f.endsWith(".json"));

let problems = 0;
const report = (msg) => {
  problems++;
  console.error("  ✗ " + msg);
};

for (const lng of langs) {
  console.log(`${lng}:`);
  const have = readdirSync(join(root, lng)).filter((f) => f.endsWith(".json"));
  for (const f of files) if (!have.includes(f)) report(`${lng}/${f} is missing`);
  for (const f of have) if (!files.includes(f)) report(`${lng}/${f} has no English counterpart`);
  if (lng === SOURCE) continue;
  for (const f of files.filter((f) => have.includes(f))) {
    const src = load(SOURCE, f);
    const dst = load(lng, f);
    const srcBases = new Map();
    for (const [k, v] of Object.entries(src)) srcBases.set(base(k), v);
    const dstBases = new Map();
    for (const [k, v] of Object.entries(dst)) dstBases.set(base(k), v);
    for (const [k, v] of srcBases) {
      if (!dstBases.has(k)) report(`${lng}/${f}: missing key "${k}"`);
      else if (placeholders(v) !== placeholders(dstBases.get(k))) report(`${lng}/${f}: placeholders differ for "${k}"`);
    }
    for (const k of dstBases.keys()) if (!srcBases.has(k)) report(`${lng}/${f}: unknown key "${k}"`);
  }
  const common = load(lng, "common.json");
  if (!common["meta.name"]) report(`${lng}/common.json: meta.name is required`);
}

if (problems) {
  console.error(`\n${problems} problem(s).`);
  process.exit(1);
}
console.log("\nAll locales are consistent.");
