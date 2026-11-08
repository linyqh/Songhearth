import { useCallback, useState } from "react";

export interface LyricLine {
  text: string;
  /** Section marker such as [Verse]; shown as a small header, never "active". */
  tag: boolean;
  start: number;
  end: number;
}

/** Characters a section marker is worth: the pause/instrumental gap between sections. */
const TAG_WEIGHT = 8;
const MIN_LINE_WEIGHT = 4;

/**
 * With `times` (forced alignment, one [start, end] per sung line) the lines get
 * their real timestamps. Without it the generator gives no timing, so it is
 * estimated: the track
 * (minus a short intro/outro) is divided between lines in proportion to their
 * length, with each section marker reserving a small gap. Good enough to
 * follow along; it is not word-accurate.
 */
export function parseLyrics(raw: string, duration: number, times?: [number, number][] | null): LyricLine[] {
  const items = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((text) => {
      const tag = /^\[.*\]$/.test(text);
      return { text: tag ? text.slice(1, -1) : text, tag, weight: tag ? TAG_WEIGHT : Math.max(MIN_LINE_WEIGHT, text.length) };
    });
  if (!items.length) return [];

  const sung = items.filter((i) => !i.tag).length;
  if (times && times.length === sung) {
    let k = 0;
    return items.map((i) => {
      if (i.tag) {
        const next = times[k] ?? times[times.length - 1];
        return { text: i.text, tag: true, start: next[0], end: next[0] };
      }
      const [start, end] = times[k++];
      return { text: i.text, tag: false, start, end };
    });
  }

  const total = Math.max(duration, 1);
  const intro = Math.min(10, total * 0.06);
  const outro = Math.min(8, total * 0.04);
  const span = Math.max(total - intro - outro, 1);
  const weightSum = items.reduce((s, i) => s + i.weight, 0);

  let t = intro;
  return items.map((i) => {
    const len = (i.weight / weightSum) * span;
    const line = { text: i.text, tag: i.tag, start: t, end: t + len };
    t += len;
    return line;
  });
}

/** Index of the lyric line being sung at `time`, or -1 before the first line. */
export function activeLine(lines: LyricLine[], time: number): number {
  let active = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].tag) continue;
    if (lines[i].start <= time) active = i;
    else break;
  }
  return active;
}

/** Boolean preference persisted in localStorage. */
export function usePersistedFlag(key: string, initial = false): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState(() => {
    const raw = localStorage.getItem(key);
    return raw == null ? initial : raw === "1";
  });
  const set = useCallback(
    (v: boolean) => {
      setValue(v);
      localStorage.setItem(key, v ? "1" : "0");
    },
    [key],
  );
  return [value, set];
}
