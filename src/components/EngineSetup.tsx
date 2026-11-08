import { open } from "@tauri-apps/plugin-dialog";
import { Cpu, Download, FolderSearch, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { translateError } from "../i18n/translate";
import { backend } from "../lib/backend";
import { formatBytes } from "../lib/format";
import { useStore } from "../lib/store";
import { ProgressBar } from "./ui";

/** Engine status + install/locate actions; used by onboarding and Settings. */
export function EngineSetup({ compact }: { compact?: boolean }) {
  const { t } = useTranslation(["shell", "common"]);
  const { engine, settings, run, applyBootstrap } = useStore();
  if (!engine || !settings) return null;

  const chooseFolder = async () => {
    const dir = await open({ directory: true, title: t("engine.chooseFolderTitle") });
    if (typeof dir !== "string") return;
    const b = await run(() => backend.saveSettings({ ...settings, enginePath: dir }));
    if (b) applyBootstrap(b);
  };

  if (engine.installing) {
    const pct = engine.totalBytes ? engine.downloadedBytes / engine.totalBytes : 0;
    return (
      <div className="vstack" style={{ gap: 10 }}>
        <div className="hstack">
          <div className="spinner" />
          <span className="grow">
            {engine.totalBytes
              ? t("engine.downloadingProgress", { done: formatBytes(engine.downloadedBytes), total: formatBytes(engine.totalBytes) })
              : t("engine.downloading")}
          </span>
          <button className="btn small" onClick={() => run(backend.cancelEngineInstall)}>
            {t("common:actions.cancel")}
          </button>
        </div>
        <ProgressBar value={pct} indeterminate={!engine.totalBytes} />
      </div>
    );
  }

  if (engine.installed) {
    return (
      <div className="hstack" style={{ gap: 12 }}>
        <div className="engine-icon ok">
          <Cpu size={18} />
        </div>
        <div className="grow">
          <div style={{ fontWeight: 600 }}>audio.cpp {engine.version}</div>
          <div className="hint ellipsis selectable" title={engine.dir ?? ""}>
            {engine.source ? t(`engine.source.${engine.source}`) : ""} · {engine.backends.join(" / ")} · {engine.dir}
          </div>
          {engine.error && <div className="hint warn">{translateError(engine.error)}</div>}
        </div>
        {!compact && (
          <>
            <button className="btn small" onClick={chooseFolder}>
              <FolderSearch size={14} /> {t("common:actions.change")}
            </button>
            <button className="icon-btn" title={t("engine.recheck")} onClick={() => run(backend.refreshEngine)}>
              <RefreshCw size={15} />
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="vstack" style={{ gap: 12 }}>
      <div className="hstack" style={{ gap: 12, alignItems: "flex-start" }}>
        <div className="engine-icon">
          <Cpu size={18} />
        </div>
        <div className="grow">
          <div style={{ fontWeight: 600 }}>{t("engine.needed")}</div>
          <div className="hint">
            {t("engine.neededBody")}
          </div>
          {engine.error && <div className="hint error">{translateError(engine.error)}</div>}
        </div>
      </div>
      <div className="hstack">
        <button className="btn primary" onClick={() => run(backend.installEngine)}>
          <Download size={14} /> {t("engine.downloadInstall")}
        </button>
        <button className="btn" onClick={chooseFolder}>
          <FolderSearch size={14} /> {t("engine.chooseExisting")}
        </button>
      </div>
    </div>
  );
}
