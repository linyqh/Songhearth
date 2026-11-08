import { Check, ChevronsUpDown, Download, Pause } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { modelText } from "../i18n/catalog";
import { backend } from "../lib/backend";
import { formatBytes } from "../lib/format";
import { useStore } from "../lib/store";
import type { Model } from "../lib/types";
import { LicenseBadge, Meter } from "./ui";

/** Models able to serve the draft, best quality first; installed ones lead. */
export function compatible(models: Model[], vocals: boolean, reference = false): Model[] {
  return models
    .filter((m) => (vocals ? m.vocals : m.instrumental) && (!reference || m.supportsSourceAudio))
    .sort((a, b) => Number(b.status.state === "installed") - Number(a.status.state === "installed") || b.quality - a.quality);
}

function StateIcon({ model }: { model: Model }) {
  const { t } = useTranslation(["models", "common"]);
  const st = model.status;
  if (st.state === "installed") return <span className="ms-state ok" title={t("picker.downloaded")}><Check size={11} strokeWidth={3.2} /></span>;
  if (st.state === "downloading") {
    const pct = st.totalBytes ? Math.floor((st.downloadedBytes / st.totalBytes) * 100) : 0;
    return <span className="ms-state dl num">{pct}%</span>;
  }
  return <span className="ms-state size num">{st.state === "partial" ? t("picker.incomplete") : formatBytes(model.totalSize)}</span>;
}

/** macOS-style pop-up button listing models; incompatible ones stay visible but disabled. */
export function ModelSelect({ vocals, reference, value, onChange }: { vocals: boolean; reference: boolean; value: string; onChange: (id: string) => void }) {
  const { t } = useTranslation(["models", "common"]);
  const { models, run } = useStore();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const usable = useMemo(() => compatible(models, vocals, reference), [models, vocals, reference]);
  const others = models.filter((m) => !usable.includes(m));
  const selected = models.find((m) => m.id === value);

  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, usable.findIndex((m) => m.id === value)));
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open, usable, value]);

  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === " " || e.key === "Enter") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(usable.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (usable[active]) pick(usable[active].id);
    }
  };

  const st = selected?.status;
  const pct = st && st.totalBytes ? st.downloadedBytes / st.totalBytes : 0;

  return (
    <div className="model-select" ref={wrap}>
      <button
        type="button"
        className={`ms-trigger${open ? " open" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKey}
      >
        <span className="grow ellipsis">
          <span className="ms-name">{selected?.name ?? t("picker.select")}</span>
          {selected && <span className="ms-vendor"> · {selected.vendor}</span>}
        </span>
        {selected && <StateIcon model={selected} />}
        <ChevronsUpDown size={14} className="ms-chevron" />
      </button>

      {open && (
        <div className="ms-popover" role="listbox" aria-label={t("picker.ariaLabel")}>
          {usable.map((m, i) => (
            <div
              key={m.id}
              role="option"
              aria-selected={m.id === value}
              className={`ms-option${i === active ? " active" : ""}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(m.id)}
              title={modelText(m).summary}
            >
              <span className="ms-check">{m.id === value && <Check size={13} strokeWidth={2.8} />}</span>
              <div className="grow ms-text">
                <div className="ms-line">
                  <span className="ms-name">{m.name}</span>
                  {m.recommendedFor.includes(vocals ? "vocals" : "instrumental") && <span className="ms-tag">{t("picker.recommended")}</span>}
                </div>
                <div className="ms-summary ellipsis">{modelText(m).summary}</div>
              </div>
              <StateIcon model={m} />
            </div>
          ))}
          {others.length > 0 && (
            <>
              <div className="ms-sep" />
              <div className="ms-group">{reference ? t("picker.noReference") : vocals ? t("picker.onlyInstrumental") : t("picker.needsLyrics")}</div>
              {others.map((m) => (
                <div key={m.id} className="ms-option disabled" aria-disabled="true">
                  <span className="ms-check" />
                  <span className="ms-name grow">{m.name}</span>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {selected && (
        <div className="ms-detail">
          <div className="hint">{modelText(selected).summary}</div>
          <div className="hstack ms-specs">
            <LicenseBadge commercial={selected.license.commercial} note={t("picker.license", { name: selected.license.name, note: modelText(selected).licenseNote })} />
            <span>{t("picker.quality")} <Meter value={selected.quality} /></span>
            <span>{t("picker.speed")} <Meter value={selected.speed} /></span>
          </div>
          {st && st.state !== "installed" && (
            <div className="ms-install">
              {st.state === "downloading" ? (
                <>
                  <div className="mini-progress grow" style={{ marginTop: 0 }}>
                    <i style={{ width: `${pct * 100}%` }} />
                  </div>
                  <button className="btn small" onClick={() => run(() => backend.pauseModel(selected.id))}>
                    <Pause size={12} /> {t("common:actions.pause")}
                  </button>
                </>
              ) : (
                <>
                  <span className="hint grow">
                    {st.state === "partial" ? t("picker.partialProgress", { percent: Math.floor(pct * 100) }) : t("picker.needsDownload", { memory: selected.memoryGb })}
                  </span>
                  <button className="btn small" onClick={() => run(() => backend.installModel(selected.id))}>
                    <Download size={12} /> {st.state === "partial" ? t("picker.resume") : formatBytes(selected.totalSize)}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
