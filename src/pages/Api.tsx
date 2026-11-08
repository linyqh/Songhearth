import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Bot, Check, Copy, Eye, EyeOff, FolderPlus, RefreshCw, Terminal } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Switch } from "../components/ui";
import { translateError } from "../i18n/translate";
import { backend } from "../lib/backend";
import { useStore } from "../lib/store";
import type { Settings } from "../lib/types";

const ENDPOINTS = [
  ["GET", "/api/v1/health", "health"],
  ["GET", "/api/v1/models", "models"],
  ["POST", "/api/v1/models/{id}/install", "install"],
  ["POST", "/api/v1/generations", "create"],
  ["GET", "/api/v1/generations/{id}/wait", "wait"],
  ["GET", "/api/v1/generations/{id}/audio", "audio"],
  ["POST", "/api/v1/generations/{id}/cancel", "cancel"],
  ["GET", "/api/v1/generations", "history"],
] as const;

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (key: string, text: string) => {
    void navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
  };
  return { copied, copy };
}

export function ApiPage() {
  const { t } = useTranslation(["api", "common"]);
  const { settings, api, run, applyBootstrap, boot, toast } = useStore();
  const [showToken, setShowToken] = useState(false);
  const [port, setPort] = useState(String(settings?.apiPort ?? ""));
  const [skillMd, setSkillMd] = useState<string>("");
  const [showSkill, setShowSkill] = useState(false);
  const { copied, copy } = useCopy();

  useEffect(() => setPort(String(settings?.apiPort ?? "")), [settings?.apiPort]);
  useEffect(() => {
    backend.skillMarkdown().then(setSkillMd);
  }, []);
  if (!settings) return null;

  const saveSettings = async (patch: Partial<Settings>) => {
    const b = await run(() => backend.saveSettings({ ...settings, ...patch }));
    if (b) applyBootstrap(b);
  };

  const url = (settings.apiLan && api?.lanUrl) || api?.url || `http://127.0.0.1:${settings.apiPort}`;
  const curlFor = (token: string) =>
    `curl -s ${url}/api/v1/generations${settings.apiRequireToken ? ` \\\n  -H "Authorization: Bearer ${token}"` : ""} \\
  -H 'Content-Type: application/json' \\
  -d '{"prompt":"lofi hip hop, mellow rhodes piano, 80 BPM","instrumental":true,"duration":30}'`;
  const curl = curlFor(settings.apiToken);

  const installSkill = async (target: string) => {
    const path = await run(() => backend.installSkill(target));
    if (path) toast("success", t("skill.installed", { path }), { label: t("common:actions.show"), run: () => revealItemInDir(path + "/SKILL.md") });
  };

  return (
    <>
      <header className="toolbar" data-tauri-drag-region>
        <h1>{t("title")}</h1>
        <span className="subtitle">{t("subtitle")}</span>
        <div className="spacer" data-tauri-drag-region />
      </header>
      <div className="content page-enter narrow">
        <div className="group-title">{t("http.title")}</div>
        <div className="group">
          <div className="row">
            <div className="row-label">
              <div className="title">{t("http.enable")}</div>
              <div className="sub">
                {api?.running ? (
                  <span style={{ color: "var(--green)" }}>{t("http.running", { url: api.lanUrl ?? api.url })}</span>
                ) : api?.error ? (
                  <span style={{ color: "var(--red)" }}>{translateError(api.error)}</span>
                ) : (
                  t("http.disabled")
                )}
              </div>
            </div>
            <Switch on={settings.apiEnabled} onChange={(v) => saveSettings({ apiEnabled: v })} label={t("http.enable")} />
          </div>
          <div className="row">
            <div className="row-label">
              <div className="title">{t("http.lan")}</div>
              <div className="sub">
                {settings.apiLan ? t("http.lanOn") : t("http.lanOff")}
              </div>
            </div>
            <Switch on={settings.apiLan} onChange={(v) => saveSettings({ apiLan: v })} label={t("http.lan")} />
          </div>
          <div className="row">
            <div className="row-label">
              <div className="title">{t("http.port")}</div>
            </div>
            <input
              className="field compact mono"
              style={{ width: 96, textAlign: "right" }}
              value={port}
              onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))}
              onBlur={() => Number(port) !== settings.apiPort && saveSettings({ apiPort: Number(port) })}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            />
          </div>
          <div className="row">
            <div className="row-label">
              <div className="title">{t("http.requireToken")}</div>
              <div className="sub">{t("http.requireTokenHint")}</div>
            </div>
            <Switch on={settings.apiRequireToken} onChange={(v) => saveSettings({ apiRequireToken: v })} label={t("http.requireToken")} />
          </div>
          {settings.apiRequireToken && (
            <div className="row">
              <div className="row-label">
                <div className="title">Token</div>
                <div className="sub mono selectable">{showToken ? settings.apiToken : "•".repeat(28)}</div>
              </div>
              <button className="icon-btn" title={showToken ? t("http.hideToken") : t("common:actions.show")} onClick={() => setShowToken((v) => !v)}>
                {showToken ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
              <button className="icon-btn" title={t("common:actions.copy")} onClick={() => copy("token", settings.apiToken)}>
                {copied === "token" ? <Check size={15} color="var(--green)" /> : <Copy size={15} />}
              </button>
              <button
                className="icon-btn"
                title={t("http.regenerate")}
                onClick={async () => {
                  const b = await run(() => backend.regenerateApiToken(), t("http.tokenRegenerated"));
                  if (b) applyBootstrap(b);
                }}
              >
                <RefreshCw size={15} />
              </button>
            </div>
          )}
          <div className="row">
            <div className="row-label">
              <div className="title">{t("http.discoveryFile")}</div>
              <div className="sub mono selectable">{boot?.paths.apiInfo}</div>
            </div>
            <span className="hint tiny" style={{ maxWidth: 200, textAlign: "right" }}>
              {t("http.discoveryHint")}
            </span>
          </div>
        </div>

        <div className="group-title">
          <Terminal size={14} /> {t("quickStart.title")}
        </div>
        <div className="code-block">
          <pre className="selectable">{showToken ? curl : curlFor("zm_••••••••")}</pre>
          <button className="btn small glass copy" onClick={() => copy("curl", curl)}>
            {copied === "curl" ? <Check size={12} /> : <Copy size={12} />} {t("common:actions.copy")}
          </button>
        </div>
        <div className="group" style={{ marginTop: 12 }}>
          {ENDPOINTS.map(([m, p, d]) => (
            <div className="row endpoint" key={p + m}>
              <span className={`method ${m.toLowerCase()}`}>{m}</span>
              <span className="mono selectable grow">{p}</span>
              <span className="hint">{t(`endpoints.${d}`)}</span>
            </div>
          ))}
        </div>

        <div className="group-title">
          <Bot size={14} /> {t("skill.title")}
        </div>
        <div className="group-desc">
          {t("skill.description")}
        </div>
        <div className="group">
          <div className="row">
            <div className="row-label">
              <div className="title">Claude Code</div>
              <div className="sub mono">~/.claude/skills/songhearth</div>
            </div>
            <button className="btn small" onClick={() => installSkill("claude")}>
              {t("common:actions.install")}
            </button>
          </div>
          <div className="row">
            <div className="row-label">
              <div className="title">Codex</div>
              <div className="sub mono">~/.codex/skills/songhearth</div>
            </div>
            <button className="btn small" onClick={() => installSkill("codex")}>
              {t("common:actions.install")}
            </button>
          </div>
          <div className="row">
            <div className="row-label">
              <div className="title">{t("skill.otherLocation")}</div>
              <div className="sub">{t("skill.otherLocationHint")}</div>
            </div>
            <button
              className="btn small"
              onClick={async () => {
                const dir = await open({ directory: true, title: t("skill.chooseFolderTitle") });
                if (typeof dir === "string") await installSkill(dir);
              }}
            >
              <FolderPlus size={13} /> {t("common:actions.choose")}
            </button>
          </div>
          <div className="row">
            <div className="row-label">
              <div className="title">SKILL.md</div>
              <div className="sub">{t("skill.previewHint")}</div>
            </div>
            <button className="btn small" onClick={() => setShowSkill((v) => !v)}>
              {showSkill ? t("skill.collapse") : t("skill.preview")}
            </button>
          </div>
        </div>
        {showSkill && (
          <div className="code-block" style={{ marginTop: 12 }}>
            <pre className="selectable">{skillMd}</pre>
          </div>
        )}
      </div>
    </>
  );
}
