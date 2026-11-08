import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { FolderOpen, MicVocal, Pause, Play, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatDuration } from "../lib/format";
import { usePersistedFlag } from "../lib/lyrics";
import { usePlayer } from "../lib/player";
import { useStore } from "../lib/store";
import { Cover } from "./Cover";
import { hasLyrics, LyricsStrip } from "./Lyrics";
import { Waveform } from "./ui";

export function PlayerBar() {
  const { t } = useTranslation("shell");
  const { current, playing, time, duration, toggle, seek, stop } = usePlayer();
  const { modelById, selectJob, setPage } = useStore();
  const [lyricsPref, setLyricsPref] = usePersistedFlag("songhearth.lyricsBar");
  if (!current) return null;
  const canLyrics = hasLyrics(current);
  const lyricsOn = lyricsPref && canLyrics;
  const total = duration || current.audioDurationSec || 0;
  return (
    <>
    {lyricsOn && <LyricsStrip job={current} />}
    <div className="player glass-card">
      {/* Artwork doubles as the play/pause control, like Music's mini player. */}
      <button className={`player-art${playing ? " playing" : ""}`} onClick={() => toggle()} aria-label={playing ? t("player.pause") : t("player.play")}>
        <Cover job={current} size={44} barCount={8} showFavorite={false} />
        <span className="player-art-icon">
          {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" style={{ marginLeft: 2 }} />}
        </span>
      </button>
      <button
        className="player-meta"
        onClick={() => {
          selectJob(current.id);
          setPage("library");
        }}
        title={t("player.viewDetails")}
      >
        <div className="t ellipsis">{current.title}</div>
        <div className="s ellipsis">{modelById(current.modelId)?.name ?? current.modelId}</div>
      </button>
      <span className="time num">{formatDuration(time)}</span>
      <div className="grow">
        <Waveform peaks={current.peaks} bars={120} progress={total ? time / total : 0} height={30} onSeek={(f) => seek(f * total)} />
      </div>
      <span className="time num">{formatDuration(total)}</span>
      {canLyrics && (
        <button className={`icon-btn${lyricsOn ? " on" : ""}`} title={t("player.lyrics")} aria-pressed={lyricsOn} onClick={() => setLyricsPref(!lyricsPref)}>
          <MicVocal size={16} />
        </button>
      )}
      <button className="icon-btn" title={t("revealInFolder")} onClick={() => current.outputPath && revealItemInDir(current.outputPath)}>
        <FolderOpen size={16} />
      </button>
      <button className="icon-btn" title={t("player.close")} onClick={stop}>
        <X size={16} />
      </button>
    </div>
    </>
  );
}
