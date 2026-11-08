import i18n from "i18next";

const lng = () => i18n.language;

function number(value: number, fractionDigits: number): string {
  return new Intl.NumberFormat(lng(), { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits }).format(value);
}

export function formatBytes(bytes: number): string {
  if (!bytes) return "0 MB";
  const gb = bytes / 1e9;
  if (gb >= 1) return `${number(gb, gb >= 10 ? 1 : 2)} GB`;
  return `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

export function formatSpeed(bps: number): string {
  if (!bps) return "—";
  const mb = bps / 1e6;
  return mb >= 1 ? `${number(mb, 1)} MB/s` : `${Math.round(bps / 1e3)} KB/s`;
}

export function formatDuration(sec: number | null | undefined): string {
  if (sec == null || !isFinite(sec)) return "--:--";
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

/** Human ETA: "about 40 sec" / "about 3 min". */
export function formatEta(sec: number | null | undefined): string {
  if (sec == null || !isFinite(sec)) return "";
  if (sec < 60) return i18n.t("shell:format.etaSeconds", { count: Math.max(1, Math.round(sec)) });
  return i18n.t("shell:format.etaMinutes", { count: Math.round(sec / 60) });
}

export function relativeTime(iso: string): string {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return i18n.t("shell:format.justNow");
  const rtf = new Intl.RelativeTimeFormat(lng(), { numeric: "always" });
  if (diff < 3600) return rtf.format(-Math.floor(diff / 60), "minute");
  if (diff < 86400) return rtf.format(-Math.floor(diff / 3600), "hour");
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return new Intl.DateTimeFormat(lng(), sameYear ? { month: "short", day: "numeric" } : { dateStyle: "medium" }).format(d);
}

/** Absolute, locale-formatted timestamp, e.g. "Nov 8, 2026, 3:04 PM". */
export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat(lng(), { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

export function downloadEta(remaining: number, bps: number): string {
  if (!bps) return "";
  return formatEta(remaining / bps);
}
