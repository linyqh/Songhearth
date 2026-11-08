import { convertFileSrc } from "@tauri-apps/api/core";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Job } from "./types";

interface Player {
  current: Job | null;
  playing: boolean;
  time: number;
  duration: number;
  play: (job: Job) => void;
  toggle: (job?: Job) => void;
  seek: (sec: number) => void;
  stop: () => void;
}

const Ctx = createContext<Player | null>(null);

export function PlayerProvider({ children, jobs }: { children: ReactNode; jobs: Job[] }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [current, setCurrent] = useState<Job | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);

  if (!audio.current && typeof Audio !== "undefined") {
    audio.current = new Audio();
    audio.current.preload = "auto";
  }

  useEffect(() => {
    const a = audio.current!;
    const onTime = () => setTime(a.currentTime);
    const onMeta = () => setDuration(a.duration || 0);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("loadedmetadata", onMeta);
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("ended", onPause);
    return () => {
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("loadedmetadata", onMeta);
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("ended", onPause);
    };
  }, []);

  // Stop playback when the playing track is deleted.
  useEffect(() => {
    if (current && !jobs.some((j) => j.id === current.id)) {
      audio.current?.pause();
      setCurrent(null);
    }
  }, [jobs, current]);

  const play = useCallback((job: Job) => {
    if (!job.outputPath) return;
    const a = audio.current!;
    a.src = convertFileSrc(job.outputPath);
    a.currentTime = 0;
    setTime(0);
    setDuration(job.audioDurationSec ?? 0);
    setCurrent(job);
    void a.play();
  }, []);

  const toggle = useCallback(
    (job?: Job) => {
      const a = audio.current!;
      if (job && job.id !== current?.id) return play(job);
      if (!current) return;
      if (a.paused) void a.play();
      else a.pause();
    },
    [current, play],
  );

  const seek = useCallback((sec: number) => {
    const a = audio.current!;
    a.currentTime = Math.max(0, Math.min(sec, a.duration || sec));
    setTime(a.currentTime);
  }, []);

  const stop = useCallback(() => {
    audio.current?.pause();
    setCurrent(null);
  }, []);

  const value = useMemo(
    () => ({ current, playing, time, duration, play, toggle, seek, stop }),
    [current, playing, time, duration, play, toggle, seek, stop],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePlayer(): Player {
  const p = useContext(Ctx);
  if (!p) throw new Error("usePlayer outside PlayerProvider");
  return p;
}
