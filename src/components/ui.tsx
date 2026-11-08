import { useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { CommercialUse } from "../lib/types";

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  block,
}: {
  value: T;
  options: { value: T; label: ReactNode; disabled?: boolean; title?: string }[];
  onChange: (v: T) => void;
  block?: boolean;
}) {
  return (
    <div className={`segmented${block ? " block" : ""}`} role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={o.value === value}
          className={o.value === value ? "on" : ""}
          disabled={o.disabled}
          title={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ on, onChange, disabled, label }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`switch${on ? " on" : ""}`}
      disabled={disabled}
      onClick={() => onChange(!on)}
    />
  );
}

export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  disabled,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <input
      type="range"
      className="slider"
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      style={{ ["--pct" as string]: `${pct}%` }}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}

export function Meter({ value, max = 5, title }: { value: number; max?: number; title?: string }) {
  return (
    <span className="meter" title={title}>
      {Array.from({ length: max }, (_, i) => (
        <i key={i} className={i < value ? "on" : ""} />
      ))}
    </span>
  );
}

const LICENSE_CLASS: Record<CommercialUse, string> = {
  yes: "green",
  conditional: "orange",
  no: "red",
};

export function LicenseBadge({ commercial, note }: { commercial: CommercialUse; note?: string }) {
  const { t } = useTranslation("shell");
  return (
    <span className={`badge ${LICENSE_CLASS[commercial]}`} title={note}>
      {t(`license.${commercial}`)}
    </span>
  );
}

export function ProgressBar({ value, indeterminate }: { value: number; indeterminate?: boolean }) {
  return (
    <div className={`progress${indeterminate ? " indeterminate" : ""}`}>
      <i style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` }} />
    </div>
  );
}

/** Bars rendered from the peaks computed in Rust; `progress` tints played part. */
export function Waveform({
  peaks,
  progress = 0,
  height = 40,
  onSeek,
  dim,
  bars = 160,
}: {
  peaks: number[] | null;
  progress?: number;
  height?: number;
  onSeek?: (fraction: number) => void;
  dim?: boolean;
  /** Bars to draw; peaks are max-pooled so narrow slots never overflow. */
  bars?: number;
}) {
  const src = peaks && peaks.length ? peaks : null;
  const n = src ? Math.min(bars, src.length) : Math.min(bars, 80);
  const data = src
    ? Array.from({ length: n }, (_, i) => {
        const from = Math.floor((i * src.length) / n);
        const to = Math.max(from + 1, Math.floor(((i + 1) * src.length) / n));
        return Math.max(...src.slice(from, to));
      })
    : Array.from({ length: n }, () => 0.06);
  return (
    <div
      className={`waveform${onSeek ? " seekable" : ""}${dim ? " dim" : ""}`}
      style={{ height }}
      onClick={(e) => {
        if (!onSeek) return;
        const r = e.currentTarget.getBoundingClientRect();
        onSeek((e.clientX - r.left) / r.width);
      }}
    >
      {data.map((p, i) => (
        <i
          key={i}
          className={i / data.length < progress ? "played" : ""}
          style={{ height: `${Math.max(6, p * 100)}%` }}
        />
      ))}
    </div>
  );
}

export function Sheet({ children, onClose }: { children: ReactNode; onClose?: () => void }) {
  useEffect(() => {
    if (!onClose) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="sheet" role="dialog" aria-modal="true">
        {children}
      </div>
    </div>
  );
}

export function Empty({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="glyph">{icon}</div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action && <div style={{ marginTop: 8 }}>{action}</div>}
    </div>
  );
}
