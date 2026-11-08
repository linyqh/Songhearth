import { AlignLeft } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { translateError } from "../i18n/translate";
import { backend } from "../lib/backend";
import { useStore } from "../lib/store";
import { activeLine, parseLyrics } from "../lib/lyrics";
import { usePlayer } from "../lib/player";
import type { Job } from "../lib/types";

export function hasLyrics(job: Job): boolean {
  return job.status === "succeeded" && !job.params.instrumental && !!job.params.lyrics.trim();
}

function useTimedLyrics(job: Job) {
  const player = usePlayer();
  const isCurrent = player.current?.id === job.id;
  const total = (isCurrent && player.duration) || job.audioDurationSec || 0;
  const lines = useMemo(() => parseLyrics(job.params.lyrics, total, job.lyricTimes), [job.params.lyrics, total, job.lyricTimes]);
  const active = isCurrent ? activeLine(lines, player.time) : -1;
  return { player, isCurrent, lines, active };
}

/** Shows whether timestamps are real or estimated, and lets the user run forced alignment. */
function AlignBar({ job }: { job: Job }) {
  const { t } = useTranslation(["library", "common"]);
  const { run } = useStore();
  const busy = job.alignState != null;
  if (job.lyricTimes && !busy) return null;
  const pct = Math.round(job.alignProgress * 100);
  return (
    <div className="align-bar">
      <span className="grow">
        {job.alignState === "downloading"
          ? t("detail.align.downloading", { pct })
          : busy
            ? t("detail.align.running", { pct })
            : job.alignError
              ? translateError(job.alignError)
              : t("detail.align.estimated")}
      </span>
      {!busy && (
        <button className="btn small" onClick={() => run(() => backend.alignJob(job.id))}>
          <AlignLeft size={13} /> {job.alignError ? t("common:actions.retry") : t("detail.align.action")}
        </button>
      )}
    </div>
  );
}

/** Scrolling lyrics card: the sung line is centred and highlighted; click a line to jump to it. */
export function LyricsPanel({ job }: { job: Job }) {
  const { player, isCurrent, lines, active } = useTimedLyrics(job);
  const box = useRef<HTMLDivElement>(null);
  const refs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const line = active >= 0 ? refs.current[active] : null;
    const top = line ? line.offsetTop - el.clientHeight / 2 + line.clientHeight / 2 : 0;
    el.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }, [active]);

  const jump = (start: number) => {
    if (!isCurrent) player.play(job);
    setTimeout(() => player.seek(start), isCurrent ? 0 : 120);
  };

  return (
    <>
    <AlignBar job={job} />
    <div className="lyrics-scroll" ref={box}>
      <div className="lyrics-pad" />
      {lines.map((l, i) =>
        l.tag ? (
          <div key={i} className="lyric-tag" ref={(el) => void (refs.current[i] = el)}>
            {l.text}
          </div>
        ) : (
          <div
            key={i}
            ref={(el) => void (refs.current[i] = el)}
            className={`lyric-line${i === active ? " active" : active >= 0 && i < active ? " past" : ""}`}
            onClick={() => jump(l.start)}
          >
            {l.text}
          </div>
        ),
      )}
      <div className="lyrics-pad" />
    </div>
    </>
  );
}

/** Two-line karaoke strip for the bottom player bar. */
export function LyricsStrip({ job }: { job: Job }) {
  const { lines, active } = useTimedLyrics(job);
  const sung = lines.filter((l) => !l.tag);
  const idx = sung.findIndex((l) => l === lines[active]);
  const now = idx >= 0 ? sung[idx].text : "♪";
  const next = sung[idx + 1]?.text ?? "";
  return (
    <div className="player-lyrics glass-card">
      <div className="now" key={now + idx}>
        {now}
      </div>
      <div className="next ellipsis">{next}</div>
    </div>
  );
}
