import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { FolderOpen, FolderSearch, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { EngineSetup } from "../components/EngineSetup";
import { Segmented, Slider, Switch } from "../components/ui";
import { backend } from "../lib/backend";
import { languages, SYSTEM_LANGUAGE } from "../i18n";
import { useStore } from "../lib/store";
import type { Settings } from "../lib/types";

const HF = "https://huggingface.co";
const MIRROR = "https://hf-mirror.com";

export function SettingsPage() {
  const { t } = useTranslation(["settings", "common", "shell"]);
  const { settings, boot, run, applyBootstrap } = useStore();
  const [threads, setThreads] = useState(settings?.threads ?? 8);
  const [customEndpoint, setCustomEndpoint] = useState(settings?.hfEndpoint ?? HF);
  const [token, setToken] = useState(settings?.hfToken ?? "");

  useEffect(() => {
    if (!settings) return;
    setThreads(settings.threads);
    setCustomEndpoint(settings.hfEndpoint);
    setToken(settings.hfToken ?? "");
  }, [settings]);

  if (!settings || !boot) return null;

  const save = async (patch: Partial<Settings>) => {
    const b = await run(() => backend.saveSettings({ ...settings, ...patch }));
    if (b) applyBootstrap(b);
  };

  const pickDir = async (key: "modelsDir" | "outputDir", title: string) => {
    const dir = await open({ directory: true, title });
    if (typeof dir === "string") await save({ [key]: dir });
  };

  const source = settings.hfEndpoint === HF ? "hf" : settings.hfEndpoint === MIRROR ? "mirror" : "custom";

  return (
    <>
      <header className="toolbar" data-tauri-drag-region>
        <h1>{t("title")}</h1>
        <div className="spacer" data-tauri-drag-region />
      </header>
      <div className="content page-enter narrow">
        <div className="group-title">{t("language.title")}</div>
        <div className="group">
          <div className="row">
            <div className="row-label">
              <div className="title">{t("language.label")}</div>
              <div className="sub">{t("language.hint")}</div>
            </div>
            <select
              className="field compact"
              style={{ width: 180, flexShrink: 0 }}
              value={settings.language}
              aria-label={t("language.label")}
              onChange={(e) => void save({ language: e.target.value })}
            >
              <option value={SYSTEM_LANGUAGE}>{t("language.system")}</option>
              {languages.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="group-title">{t("engine.title")}</div>
        <div className="group">
          <div className="row" style={{ padding: 14 }}>
            <div className="grow">
              <EngineSetup />
            </div>
          </div>
          {settings.enginePath && (
            <div className="row">
              <div className="row-label">
                <div className="title">{t("engine.customPath")}</div>
                <div className="sub mono">{settings.enginePath}</div>
              </div>
              <button className="btn small" onClick={() => save({ enginePath: null })}>
                <RotateCcw size={12} /> {t("common:actions.reset")}
              </button>
            </div>
          )}
          <div className="row">
            <div className="row-label">
              <div className="title">{t("engine.threads")}</div>
              <div className="sub">{t("engine.threadsHint")}</div>
            </div>
            <div style={{ width: 160 }}>
              <Slider value={threads} min={1} max={16} onChange={setThreads} />
            </div>
            <span
              className="num"
              style={{ width: 22, textAlign: "right" }}
            >
              {threads}
            </span>
            {threads !== settings.threads && (
              <button className="btn small" onClick={() => save({ threads })}>
                {t("common:actions.apply")}
              </button>
            )}
          </div>
        </div>

        <div className="group-title">{t("storage.title")}</div>
        <div className="group">
          <DirRow
            title={t("storage.outputDir")}
            path={boot.paths.outputDir}
            isDefault={!settings.outputDir}
            onPick={() => pickDir("outputDir", t("storage.outputDirPick"))}
            onReset={() => save({ outputDir: null })}
          />
          <DirRow
            title={t("storage.modelsDir")}
            path={boot.paths.modelsDir}
            isDefault={!settings.modelsDir}
            onPick={() => pickDir("modelsDir", t("storage.modelsDirPick"))}
            onReset={() => save({ modelsDir: null })}
          />
        </div>

        <div className="group-title">{t("download.title")}</div>
        <div className="group">
          <div className="row">
            <div className="row-label">
              <div className="title">{t("download.server")}</div>
              <div className="sub">{t("download.serverHint")}</div>
            </div>
            <Segmented
              value={source}
              onChange={(v) => {
                if (v === "hf") void save({ hfEndpoint: HF });
                else if (v === "mirror") void save({ hfEndpoint: MIRROR });
                else setCustomEndpoint(settings.hfEndpoint === HF || settings.hfEndpoint === MIRROR ? "https://" : settings.hfEndpoint);
              }}
              options={[
                { value: "hf", label: "Hugging Face" },
                { value: "mirror", label: "hf-mirror" },
                { value: "custom", label: t("download.custom") },
              ]}
            />
          </div>
          {(source === "custom" || (customEndpoint !== HF && customEndpoint !== MIRROR)) && (
            <div className="row">
              <div className="row-label">
                <div className="title">{t("download.customUrl")}</div>
              </div>
              <input
                className="field compact mono"
                style={{ width: 300 }}
                value={customEndpoint}
                onChange={(e) => setCustomEndpoint(e.target.value)}
                onBlur={() => customEndpoint !== settings.hfEndpoint && save({ hfEndpoint: customEndpoint })}
              />
            </div>
          )}
          <div className="row">
            <div className="row-label">
              <div className="title">{t("download.token")}</div>
              <div className="sub">{t("download.tokenHint")}</div>
            </div>
            <input
              className="field compact mono"
              type="password"
              style={{ width: 300 }}
              placeholder="hf_…"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              onBlur={() => token !== (settings.hfToken ?? "") && save({ hfToken: token || null })}
            />
          </div>
        </div>

        <div className="group-title">{t("notifications.title")}</div>
        <div className="group">
          <div className="row">
            <div className="row-label">
              <div className="title">{t("notifications.onFinish")}</div>
              <div className="sub">{t("notifications.onFinishHint")}</div>
            </div>
            <Switch on={settings.notifyOnFinish} onChange={(v) => save({ notifyOnFinish: v })} label={t("notifications.onFinish")} />
          </div>
        </div>

        <div className="group-title">{t("about.title")}</div>
        <div className="group">
          <div className="row">
            <div className="row-label">
              <div className="title">Songhearth {boot.version}</div>
              <div className="sub">
                {boot.system.chip} · {boot.system.totalMemoryGb} GB · {boot.system.os}
              </div>
            </div>
            <button className="btn small" onClick={() => revealItemInDir(boot.paths.dataDir)}>
              <FolderOpen size={13} /> {t("about.dataDir")}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function DirRow({ title, path, isDefault, onPick, onReset }: { title: string; path: string; isDefault: boolean; onPick: () => void; onReset: () => void }) {
  const { t } = useTranslation(["settings", "common", "shell"]);
  return (
    <div className="row">
      <div className="row-label">
        <div className="title">
          {title} {isDefault && <span className="badge">{t("common:state.default")}</span>}
        </div>
        <div className="sub mono selectable">{path}</div>
      </div>
      <button className="icon-btn" title={t("shell:revealInFolder")} onClick={() => revealItemInDir(path)}>
        <FolderOpen size={15} />
      </button>
      {!isDefault && (
        <button className="icon-btn" title={t("common:actions.reset")} onClick={onReset}>
          <RotateCcw size={15} />
        </button>
      )}
      <button className="btn small" onClick={onPick}>
        <FolderSearch size={13} /> {t("common:actions.change")}
      </button>
    </div>
  );
}
