import { Heart, Mic2, Music } from "lucide-react";
import type { Job } from "../lib/types";

/** Stable per-work hue so a track keeps its colour everywhere it appears. */
function hueOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return (h >>> 0) % 360;
}

function bars(peaks: number[] | null, n: number): number[] {
  if (!peaks?.length) return Array.from({ length: n }, (_, i) => 0.35 + 0.3 * Math.abs(Math.sin(i * 1.7)));
  return Array.from({ length: n }, (_, i) => {
    const from = Math.floor((i * peaks.length) / n);
    const to = Math.max(from + 1, Math.floor(((i + 1) * peaks.length) / n));
    return Math.max(...peaks.slice(from, to));
  });
}

/** Generated artwork: gradient seeded by the job id plus the track's own waveform. */
export function Cover({
  job,
  size,
  barCount = 18,
  showFavorite = true,
  children,
}: {
  job: Job;
  size?: number;
  barCount?: number;
  showFavorite?: boolean;
  children?: React.ReactNode;
}) {
  const h = hueOf(job.id);
  const h2 = (h + 38 + (h % 50)) % 360;
  const pending = job.status === "running" || job.status === "queued";
  const failed = job.status === "failed" || job.status === "cancelled";
  const vocals = !job.params.instrumental && !!job.params.lyrics.trim();
  const showWave = job.status === "succeeded" || pending;
  return (
    <div
      className={`cover${pending ? " pending" : ""}${failed ? " muted-cover" : ""}`}
      style={{
        width: size,
        background: `linear-gradient(140deg, hsl(${h} 78% 62%), hsl(${h2} 72% 44%))`,
      }}
    >
      {showWave ? (
        <div className="cover-wave">
          {bars(job.peaks, barCount).map((p, i) => (
            <i key={i} style={{ height: `${Math.max(8, p * 100)}%`, ["--i" as string]: i }} />
          ))}
        </div>
      ) : (
        <div className="cover-glyph">{vocals ? <Mic2 size={size ? size / 4 : 40} /> : <Music size={size ? size / 4 : 40} />}</div>
      )}
      {showFavorite && job.favorite && (
        <Heart className="cover-fav" size={16} fill="#fff" color="#fff" />
      )}
      {children}
    </div>
  );
}
