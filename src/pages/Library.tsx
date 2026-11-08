import { save } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  FolderOpen,
  Heart,
  ListMusic,
  MicVocal,
  Pause,
  Play,
  RefreshCw,
  Search,
  Share,
  Shuffle,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Cover } from "../components/Cover";
import { hasLyrics, LyricsPanel } from "../components/Lyrics";
import { Empty, ProgressBar, Segmented, Waveform } from "../components/ui";
import { backend } from "../lib/backend";
import { formatDateTime, formatDuration, formatEta } from "../lib/format";
import { usePersistedFlag } from "../lib/lyrics";
import { usePlayer } from "../lib/player";
import { emptyDraft, sortedJobs, useStore } from "../lib/store";
import type { Job } from "../lib/types";
import { translateError, translateStage } from "../i18n/translate";
import i18n from "i18next";

type Filter = "all" | "favorites" | "active" | "failed";

const DAY = 86_400_000;

type Group = { id: string; kind: "today" | "yesterday" | "week" | "month"; date: Date; items: Job[] };

/** Sections like Photos/Music: today / yesterday / last 7 days / by month. Labels are resolved at render time. */
function groupByDate(jobs: Job[]): Group[] {
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  const groups = new Map<string, Group>();
  for (const j of jobs) {
    const t = new Date(j.createdAt).getTime();
    const d = new Date(t);
    const [kind, id]: [Group["kind"], string] =
      t >= startOfToday
        ? ["today", "today"]
        : t >= startOfToday - DAY
          ? ["yesterday", "yesterday"]
          : t >= startOfToday - 6 * DAY
            ? ["week", "week"]
            : ["month", `${d.getFullYear()}-${d.getMonth()}`];
    const g = groups.get(id) ?? { id, kind, date: d, items: [] };
    g.items.push(j);
    groups.set(id, g);
  }
  return [...groups.values()];
}

const MONTH_GROUP_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = { year: "numeric", month: "long" };

function groupLabel(g: Group): string {
  switch (g.kind) {
    case "today":
      return i18n.t("library:groups.today");
    case "yesterday":
      return i18n.t("library:groups.yesterday");
    case "week":
      return i18n.t("library:groups.last7Days");
    case "month":
      return new Intl.DateTimeFormat(i18n.language, MONTH_GROUP_FORMAT_OPTIONS).format(g.date);
  }
}

function isTyping(e: KeyboardEvent): boolean {
  return !!(e.target as HTMLElement).closest("input, textarea, select");
}

export function LibraryPage() {
  const { t } = useTranslation(["library", "common", "shell"]);
  const { jobs, selectedJobId, selectJob, setPage } = useStore();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sortedJobs(jobs).filter((j) => {
      if (filter === "favorites" && !j.favorite) return false;
      if (filter === "active" && j.status !== "running" && j.status !== "queued") return false;
      if (filter === "failed" && j.status !== "failed" && j.status !== "cancelled") return false;
      if (!q) return true;
      return [j.title, j.params.prompt, j.params.lyrics].some((s) => s.toLowerCase().includes(q));
    });
  }, [jobs, filter, query]);

  // Queue position for queued cards, oldest first.
  const queueOrder = useMemo(
    () =>
      jobs
        .filter((j) => j.status === "queued")
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map((j) => j.id),
    [jobs],
  );

  const sections = useMemo(() => groupByDate(list), [list]);
  const selectedIndex = list.findIndex((j) => j.id === selectedJobId);
  const selected = selectedIndex >= 0 ? list[selectedIndex] : jobs.find((j) => j.id === selectedJobId) ?? null;
  const activeCount = jobs.filter((j) => j.status === "running" || j.status === "queued").length;
  const doneCount = jobs.filter((j) => j.status === "succeeded").length;

  return (
    <>
      <header className="toolbar" data-tauri-drag-region>
        <h1>{t("title")}</h1>
        <span className="subtitle">{t("totalSongs", { count: doneCount })}</span>
        <div className="spacer" data-tauri-drag-region />
        <Segmented<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: t("common:actions.all") },
            { value: "favorites", label: t("filters.favorites") },
            { value: "active", label: activeCount ? t("filters.activeCount", { count: activeCount }) : t("filters.active") },
            { value: "failed", label: t("filters.failed") },
          ]}
        />
        <div className="search">
          <Search size={13} />
          <input placeholder={t("search.placeholder")} value={query} onChange={(e) => setQuery(e.target.value)} />
          {query && (
            <button className="icon-btn sm" onClick={() => setQuery("")} aria-label={t("search.clear")}>
              <X size={12} />
            </button>
          )}
        </div>
      </header>
      <div className="content page-enter">
        {jobs.length === 0 ? (
          <Empty
            icon={<ListMusic size={30} />}
            title={t("empty.title")}
            action={
              <button className="btn primary" onClick={() => setPage("create")}>
                {t("empty.cta")}
              </button>
            }
          >
            {t("empty.body")}
          </Empty>
        ) : list.length === 0 ? (
          <Empty icon={<Search size={28} />} title={t("empty.noMatchTitle")}>
            {t("empty.noMatchBody", { all: t("common:actions.all") })}
          </Empty>
        ) : (
          sections.map((s) => (
            <section key={s.id} className="works-section">
              <h2>
                {groupLabel(s)}
                <span>{t("sectionCount", { count: s.items.length })}</span>
              </h2>
              <div className="works-grid">
                {s.items.map((j) => (
                  <WorkCard key={j.id} job={j} queuePos={queueOrder.indexOf(j.id)} onOpen={() => selectJob(j.id)} />
                ))}
              </div>
            </section>
          ))
        )}
      </div>
      {selected && (
        <WorkDetail
          key={selected.id}
          job={selected}
          position={selectedIndex >= 0 ? `${selectedIndex + 1} / ${list.length}` : ""}
          onPrev={selectedIndex > 0 ? () => selectJob(list[selectedIndex - 1].id) : undefined}
          onNext={selectedIndex >= 0 && selectedIndex < list.length - 1 ? () => selectJob(list[selectedIndex + 1].id) : undefined}
          onClose={() => selectJob(null)}
        />
      )}
    </>
  );
}

function WorkCard({ job, queuePos, onOpen }: { job: Job; queuePos: number; onOpen: () => void }) {
  const { t } = useTranslation(["library", "common", "shell"]);
  const { modelById } = useStore();
  const player = usePlayer();
  const isCurrent = player.current?.id === job.id;
  const playing = isCurrent && player.playing;
  const model = modelById(job.modelId)?.name ?? job.modelId;

  const subtitle =
    job.status === "succeeded"
      ? `${model} · ${formatDuration(job.audioDurationSec)}`
      : job.status === "running"
        ? translateStage(job.stage)
        : job.status === "queued"
          ? t("card.queued", { position: queuePos + 1 })
          : job.status === "failed"
            ? t("card.failed")
            : t("card.cancelled");

  return (
    <button className="work-card" onClick={onOpen} title={job.title}>
      <Cover job={job}>
        {job.source === "api" && <span className="cover-tag">API</span>}
        {job.status === "succeeded" && (
          <span
            role="button"
            tabIndex={-1}
            className={`cover-play${isCurrent ? " active" : ""}`}
            aria-label={playing ? t("shell:player.pause") : t("shell:player.play")}
            onClick={(e) => {
              e.stopPropagation();
              player.toggle(job);
            }}
          >
            {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" style={{ marginLeft: 2 }} />}
          </span>
        )}
        {job.status === "running" && (
          <div className="cover-state">
            <span>
              {Math.round(job.progress * 100)}%{job.etaSec != null ? ` · ${formatEta(job.etaSec)}` : ""}
            </span>
            <ProgressBar value={job.progress} />
          </div>
        )}
      </Cover>
      <div className="meta-line">
        <div className="t">
          {isCurrent && (
            <span className={`eq${player.playing ? "" : " paused"}`}>
              <i />
              <i />
              <i />
            </span>
          )}
          <span className="ellipsis">{job.title}</span>
        </div>
        <div className="s ellipsis" style={job.status === "failed" ? { color: "var(--red)" } : undefined}>
          {subtitle}
        </div>
      </div>
    </button>
  );
}

function WorkDetail({
  job,
  position,
  onPrev,
  onNext,
  onClose,
}: {
  job: Job;
  position: string;
  onPrev?: () => void;
  onNext?: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation(["library", "common", "shell"]);
  const { modelById, run, replaceDraft, setPage, toast } = useStore();
  const player = usePlayer();
  const [title, setTitle] = useState(job.title);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteFile, setDeleteFile] = useState(true);
  const model = modelById(job.modelId);
  const isCurrent = player.current?.id === job.id;
  const total = job.audioDurationSec ?? 0;
  const vocals = !job.params.instrumental && !!job.params.lyrics.trim();
  const [lyricsPref, setLyricsPref] = usePersistedFlag("songhearth.lyricsPanel");
  const lyricsOn = lyricsPref && hasLyrics(job);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (confirmDelete) setConfirmDelete(false);
        else onClose();
        return;
      }
      if (isTyping(e)) return;
      if (e.key === "ArrowLeft" && onPrev) onPrev();
      if (e.key === "ArrowRight" && onNext) onNext();
      if (e.key === " " && job.status === "succeeded") {
        e.preventDefault();
        player.toggle(job);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmDelete, onClose, onPrev, onNext, job, player]);

  const reuse = () => {
    replaceDraft({
      ...emptyDraft,
      modelId: job.modelId,
      title: job.title,
      prompt: job.params.prompt,
      lyrics: job.params.lyrics,
      instrumental: job.params.instrumental,
      duration: job.duration,
      seed: job.seed,
      lockSeed: true,
      steps: job.params.steps ?? null,
      cot: job.params.cot ?? "full",
      negativePrompt: job.params.negativePrompt ?? "",
    });
    onClose();
    setPage("create");
    toast("info", t("detail.toasts.reused"));
  };

  const exportTrack = async () => {
    const dest = await save({ defaultPath: `${job.title}.wav`, filters: [{ name: t("detail.exportFilter"), extensions: ["wav"] }] });
    if (dest) await run(() => backend.exportTrack(job.id, dest), t("detail.toasts.exported"));
  };

  const commitTitle = () => {
    const t = title.trim();
    if (!t) setTitle(job.title);
    else if (t !== job.title) void run(() => backend.updateJobMeta(job.id, { title: t }));
  };

  return (
    <div className="work-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="work-modal" role="dialog" aria-modal="true" aria-label={job.title}>
        <div className="work-modal-head">
          <button className="icon-btn" onClick={onClose} title={t("detail.close")}>
            <X size={17} />
          </button>
          <div className="grow" />
          {position && <span className="pos num">{position}</span>}
          <button className="icon-btn" disabled={!onPrev} onClick={onPrev} title={t("detail.previous")}>
            <ChevronLeft size={18} />
          </button>
          <button className="icon-btn" disabled={!onNext} onClick={onNext} title={t("detail.next")}>
            <ChevronRight size={18} />
          </button>
        </div>

        <div className="work-modal-body">
          <div className="work-side">
            <Cover job={job} barCount={28} showFavorite={false}>
              {job.status === "succeeded" && (
                <button
                  className="cover-play active"
                  style={{ width: 52, height: 52, right: 14, bottom: 14 }}
                  onClick={() => player.toggle(job)}
                  aria-label={isCurrent && player.playing ? t("shell:player.pause") : t("shell:player.play")}
                >
                  {isCurrent && player.playing ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" style={{ marginLeft: 3 }} />}
                </button>
              )}
            </Cover>
            {job.status === "succeeded" && (
              <div>
                <Waveform
                  peaks={job.peaks}
                  bars={72}
                  height={44}
                  progress={isCurrent ? player.time / (player.duration || total || 1) : 0}
                  onSeek={(f) => {
                    if (!isCurrent) player.play(job);
                    setTimeout(() => player.seek(f * total), isCurrent ? 0 : 120);
                  }}
                />
                <div className="hstack tiny muted num" style={{ marginTop: 6 }}>
                  <span>{isCurrent ? formatDuration(player.time) : "0:00"}</span>
                  <div className="grow" />
                  <span>{formatDuration(total)}</span>
                </div>
              </div>
            )}
          </div>

          <div className={`work-main${lyricsOn ? " lyrics-mode" : ""}`}>
            <div>
              <input
                className="work-title"
                value={title}
                maxLength={60}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={commitTitle}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                title={t("detail.rename")}
              />
              <div className="hint">
                {model?.name ?? job.modelId} · {vocals ? t("detail.kindVocals") : t("detail.kindInstrumental")} · {formatDateTime(job.createdAt)}
              </div>
            </div>

            <div className="work-actions">
              {job.status === "succeeded" && (
                <>
                  <button className="btn" onClick={reuse}>
                    <Copy size={14} /> {t("detail.reuse")}
                  </button>
                  <button className="btn" onClick={() => run(() => backend.retryJob(job.id, true), t("detail.toasts.retryNewSeed"))}>
                    <Shuffle size={14} /> {t("detail.another")}
                  </button>
                  <button className="btn" onClick={exportTrack}>
                    <Share size={14} /> {t("detail.export")}
                  </button>
                  <button className="icon-btn" title={t("shell:revealInFolder")} onClick={() => job.outputPath && revealItemInDir(job.outputPath)}>
                    <FolderOpen size={16} />
                  </button>
                </>
              )}
              {(job.status === "running" || job.status === "queued") && (
                <button className="btn danger" onClick={() => run(() => backend.cancelJob(job.id))}>
                  <X size={14} /> {t("detail.cancelJob")}
                </button>
              )}
              {(job.status === "failed" || job.status === "cancelled") && (
                <>
                  <button className="btn primary" onClick={() => run(() => backend.retryJob(job.id, false), t("detail.toasts.retried"))}>
                    <RefreshCw size={14} /> {t("common:actions.retry")}
                  </button>
                  <button className="btn" onClick={reuse}>
                    <Copy size={14} /> {t("detail.editParams")}
                  </button>
                </>
              )}
              <div className="grow" />
              {hasLyrics(job) && (
                <button
                  className={`icon-btn${lyricsOn ? " on" : ""}`}
                  title={t("detail.lyricsToggle")}
                  aria-pressed={lyricsOn}
                  onClick={() => setLyricsPref(!lyricsPref)}
                >
                  <MicVocal size={17} />
                </button>
              )}
              <button
                className={`icon-btn${job.favorite ? " on" : ""}`}
                title={job.favorite ? t("detail.unfavorite") : t("detail.favorite")}
                onClick={() => run(() => backend.updateJobMeta(job.id, { favorite: !job.favorite }))}
              >
                <Heart size={17} fill={job.favorite ? "var(--pink)" : "none"} color={job.favorite ? "var(--pink)" : "currentColor"} />
              </button>
              {job.status !== "running" && (
                <button className="icon-btn" title={t("common:actions.delete")} onClick={() => setConfirmDelete(true)}>
                  <Trash2 size={16} />
                </button>
              )}
            </div>

            {confirmDelete && (
              <div className="work-confirm">
                <span style={{ fontWeight: 600 }}>{t("detail.confirmDelete.title")}</span>
                {job.outputPath && (
                  <label className="hstack tiny" style={{ cursor: "pointer", gap: 5 }}>
                    <input type="checkbox" checked={deleteFile} onChange={(e) => setDeleteFile(e.target.checked)} />
                    {t("detail.confirmDelete.alsoFile")}
                  </label>
                )}
                <div className="grow" />
                <button className="btn small" onClick={() => setConfirmDelete(false)}>
                  {t("common:actions.cancel")}
                </button>
                <button
                  className="btn small primary"
                  style={{ background: "var(--red)" }}
                  onClick={async () => {
                    const deleted = await run(async () => {
                      await backend.deleteJob(job.id, deleteFile && !!job.outputPath);
                      return true;
                    }, t("detail.toasts.deleted"));
                    if (deleted) (onNext ?? onPrev ?? onClose)();
                  }}
                >
                  {t("common:actions.delete")}
                </button>
              </div>
            )}

            {(job.status === "running" || job.status === "queued") && (
              <div className="card pad vstack" style={{ gap: 8 }}>
                <ProgressBar value={job.progress} indeterminate={job.status === "queued"} />
                <div className="hstack hint">
                  <span className="grow">{job.status === "queued" ? t("detail.queuedWaiting") : translateStage(job.stage)}</span>
                  {job.etaSec != null && job.status === "running" && <span>{t("detail.remaining", { eta: formatEta(job.etaSec) })}</span>}
                </div>
              </div>
            )}

            {(job.status === "failed" || job.status === "cancelled") && (
              <div className={`error-box${job.status === "cancelled" ? " neutral" : ""}`}>
                <div style={{ fontWeight: 600 }}>{job.status === "failed" ? t("detail.failedTitle") : t("detail.cancelledTitle")}</div>
                {(job.errorInfo || job.error) && <pre className="selectable">{job.errorInfo ? translateError(job.errorInfo) : job.error}</pre>}
              </div>
            )}

            {lyricsOn ? (
              <div className="card lyrics-panel">
                <LyricsPanel job={job} />
              </div>
            ) : (
              <>
            <div className="meta-grid card">
              <Meta label={t("detail.meta.model")} value={model?.name ?? job.modelId} />
              <Meta label={t("detail.meta.duration")} value={job.audioDurationSec ? formatDuration(job.audioDurationSec) : `≤ ${formatDuration(job.duration)}`} />
              <Meta label={t("detail.meta.seed")} value={String(job.seed)} mono />
              <Meta label={t("detail.meta.wallTime")} value={job.wallSec ? t("detail.wallSeconds", { seconds: Math.round(job.wallSec) }) : "—"} />
              <Meta label={t("detail.meta.cot")} value={job.params.cot ? t(`detail.cot.${job.params.cot}`) : "—"} />
              <Meta label={t("detail.meta.source")} value={job.source === "api" ? t("detail.source.api") : t("detail.source.app")} />
            </div>

            <div className="card pad">
              <div className="label">{t("detail.sections.style")}</div>
              <div className="selectable prose">{job.params.prompt}</div>
              {job.params.negativePrompt && (
                <>
                  <div className="label" style={{ marginTop: 14 }}>
                    {t("detail.sections.negativePrompt")}
                  </div>
                  <div className="selectable prose">{job.params.negativePrompt}</div>
                </>
              )}
            </div>

            {vocals && (
              <div className="card pad">
                <div className="label">{t("detail.sections.lyrics")}</div>
                <pre className="selectable lyrics-view">{job.params.lyrics}</pre>
              </div>
            )}

            {job.outputPath && (
              <div className="selectable mono tiny muted" style={{ wordBreak: "break-all", padding: "0 2px" }}>
                {job.outputPath}
              </div>
            )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="meta">
      <div className="tiny muted">{label}</div>
      <div className={`selectable${mono ? " mono" : ""}`}>{value}</div>
    </div>
  );
}
