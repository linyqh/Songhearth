import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { Download, ExternalLink, FolderOpen, MemoryStick, Pause, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { LicenseBadge, Meter, ProgressBar, Sheet } from "../components/ui";
import { modelText } from "../i18n/catalog";
import { translateError } from "../i18n/translate";
import { backend } from "../lib/backend";
import { downloadEta, formatBytes, formatSpeed } from "../lib/format";
import { useStore } from "../lib/store";
import type { Model } from "../lib/types";

export function ModelsPage() {
  const { t } = useTranslation(["models", "common"]);
  const { models, boot } = useStore();
  const mem = boot?.system.totalMemoryGb ?? 0;
  const installedBytes = models.filter((m) => m.status.state === "installed").reduce((s, m) => s + m.totalSize, 0);
  return (
    <>
      <header className="toolbar" data-tauri-drag-region>
        <h1>{t("page.title")}</h1>
        <span className="subtitle">{t("page.subtitle", { size: formatBytes(installedBytes) })}</span>
        <div className="spacer" data-tauri-drag-region />
      </header>
      <div className="content page-enter">
        <div className="sys-banner glass-card">
          <MemoryStick size={18} />
          <div className="grow">
            <div style={{ fontWeight: 600 }}>
              {t("page.system", { chip: boot?.system.chip ?? "", memory: mem })}
            </div>
            <div className="hint">
              {mem >= 24 ? t("page.memoryPlenty") : mem >= 16 ? t("page.memoryOk") : t("page.memoryLow")}
            </div>
          </div>
        </div>
        <div className="model-grid">
          {models.map((m) => (
            <ModelCard key={m.id} model={m} memoryGb={mem} />
          ))}
        </div>
        <p className="hint" style={{ marginTop: 18 }}>
          {t("page.footer")}
        </p>
      </div>
    </>
  );
}

function ModelCard({ model: m, memoryGb }: { model: Model; memoryGb: number }) {
  const { t } = useTranslation(["models", "common"]);
  const { run } = useStore();
  const [confirm, setConfirm] = useState(false);
  const st = m.status;
  const pct = st.totalBytes ? st.downloadedBytes / st.totalBytes : 0;
  const tight = memoryGb > 0 && m.memoryGb > memoryGb * 0.75;
  const text = modelText(m);

  return (
    <div className={`card model-card${st.state === "installed" ? " installed" : ""}`}>
      <div className="hstack" style={{ alignItems: "flex-start" }}>
        <div className="grow">
          <div className="hstack" style={{ gap: 8 }}>
            <h3>{m.name}</h3>
            {st.state === "installed" && <span className="badge green">{t("card.installed")}</span>}
          </div>
          <div className="hint tiny">{m.vendor}</div>
        </div>
        <LicenseBadge commercial={m.license.commercial} note={text.licenseNote} />
      </div>
      <div className="model-summary">{text.summary}</div>
      <p className="hint" style={{ margin: 0 }}>
        {text.description}
      </p>
      <div className="chips">
        {text.tags.map((tag) => (
          <span key={tag} className="badge">
            {tag}
          </span>
        ))}
      </div>
      <div className="spec-grid">
        <div>
          <span className="muted">{t("card.quality")}</span> <Meter value={m.quality} />
        </div>
        <div>
          <span className="muted">{t("card.speed")}</span> <Meter value={m.speed} />
        </div>
        <div>
          <span className="muted">{t("card.size")}</span> {formatBytes(m.totalSize)}
        </div>
        <div style={tight ? { color: "var(--orange)" } : undefined}>
          <span className="muted">{t("card.memory")}</span> {tight ? t("card.memoryTight", { memory: m.memoryGb }) : t("card.memoryValue", { memory: m.memoryGb })}
        </div>
        <div>
          <span className="muted">{t("card.languages")}</span> {text.languages}
        </div>
        <div>
          <span className="muted">{t("card.duration")}</span> {t("card.durationRange", { min: m.duration.min, max: m.duration.max })}
        </div>
      </div>
      <div className="license-line hint tiny">
        {t("card.license", { name: m.license.name, note: text.licenseNote })}
        <button className="link" onClick={() => openUrl(m.license.url)}>
          {t("common:actions.view")} <ExternalLink size={10} />
        </button>
      </div>

      <div className="model-actions">
        {st.state === "downloading" ? (
          <div className="vstack grow" style={{ gap: 6 }}>
            <ProgressBar value={pct} />
            <div className="hstack hint tiny num">
              <span className="grow">
                {t("card.progress", { done: formatBytes(st.downloadedBytes), total: formatBytes(st.totalBytes), speed: formatSpeed(st.speedBps) })}
              </span>
              <span>{downloadEta(st.totalBytes - st.downloadedBytes, st.speedBps)}</span>
              <button className="btn small" onClick={() => run(() => backend.pauseModel(m.id))}>
                <Pause size={12} /> {t("common:actions.pause")}
              </button>
            </div>
          </div>
        ) : st.state === "installed" ? (
          <>
            <button className="btn small" onClick={() => revealItemInDir(st.path)}>
              <FolderOpen size={13} /> {t("card.showInFolder")}
            </button>
            <div className="grow" />
            <button className="icon-btn" title={t("card.deleteTitle")} onClick={() => setConfirm(true)}>
              <Trash2 size={15} />
            </button>
          </>
        ) : (
          <>
            {st.state === "partial" && (
              <div className="vstack grow" style={{ gap: 6 }}>
                <ProgressBar value={pct} />
                <span className="hint tiny">{t("card.partialProgress", { percent: Math.floor(pct * 100) })}</span>
              </div>
            )}
            {st.state !== "partial" && <div className="grow" />}
            {st.state === "partial" && (
              <button className="icon-btn" title={t("card.discardTitle")} onClick={() => setConfirm(true)}>
                <Trash2 size={15} />
              </button>
            )}
            <button className="btn primary small" onClick={() => run(() => backend.installModel(m.id))}>
              <Download size={13} /> {st.state === "partial" ? t("card.resume") : t("card.download", { size: formatBytes(m.totalSize) })}
            </button>
          </>
        )}
      </div>
      {st.error && <div className="hint error">{translateError(st.error)}</div>}

      {confirm && (
        <Sheet onClose={() => setConfirm(false)}>
          <h2>{t("card.deleteTitleConfirm", { name: m.name })}</h2>
          <p>{t("card.deleteBody", { size: formatBytes(st.downloadedBytes || m.totalSize) })}</p>
          <div className="actions">
            <button className="btn" onClick={() => setConfirm(false)}>
              {t("common:actions.cancel")}
            </button>
            <button
              className="btn primary"
              style={{ background: "var(--red)" }}
              onClick={async () => {
                setConfirm(false);
                await run(() => backend.deleteModel(m.id), t("card.deleted", { name: m.name }));
              }}
            >
              {t("common:actions.delete")}
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
