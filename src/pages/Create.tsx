import { Boxes, Dices, Download, Lock, LockOpen, Music2, Sparkles, Timer, Wand2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { compatible, ModelSelect } from "../components/ModelPicker";
import { Segmented, Slider } from "../components/ui";
import { modelText } from "../i18n/catalog";
import { backend } from "../lib/backend";
import { formatBytes, formatDuration } from "../lib/format";
import { useStore, type Draft } from "../lib/store";
import type { Cot, GenParams } from "../lib/types";

/** Chip labels live in `create:presets.<key>`; the tag strings are prompt text and stay English. */
const STYLE_PRESETS = [
  { key: "mandarinPop", tags: "Mandarin, C-pop" },
  { key: "cityPop", tags: "city pop, groovy bass, electric guitar, synth" },
  { key: "lofi", tags: "lofi hip hop, mellow rhodes piano, vinyl crackle" },
  { key: "rock", tags: "rock, distorted guitars, powerful drums" },
  { key: "folk", tags: "folk, warm acoustic guitar" },
  { key: "electronic", tags: "EDM, big synth drops, four-on-the-floor" },
  { key: "jazz", tags: "jazz, upright bass, brushed drums, saxophone" },
  { key: "guofeng", tags: "Chinese traditional, guzheng, erhu, bamboo flute" },
  { key: "rap", tags: "hip hop, trap beat, rap vocal" },
  { key: "cinematic", tags: "cinematic orchestral, epic strings" },
  { key: "ambient", tags: "ambient, atmospheric pads" },
  { key: "femaleVocal", tags: "female vocal" },
  { key: "maleVocal", tags: "male vocal" },
] as const;

const SECTION_TAGS = ["[Intro]", "[Verse]", "[Pre-Chorus]", "[Chorus]", "[Bridge]", "[Outro]"];

function toggleTag(prompt: string, tags: string): string {
  const parts = prompt.split(",").map((s) => s.trim()).filter(Boolean);
  const add = tags.split(",").map((s) => s.trim());
  const has = add.every((t) => parts.some((p) => p.toLowerCase() === t.toLowerCase()));
  if (has) return parts.filter((p) => !add.some((t) => t.toLowerCase() === p.toLowerCase())).join(", ");
  return [...parts, ...add.filter((t) => !parts.some((p) => p.toLowerCase() === t.toLowerCase()))].join(", ");
}

export function CreatePage() {
  const { t, i18n } = useTranslation(["create", "common"]);
  const { draft, setDraft, models, modelById, engine, jobs, run, toast, setPage, selectJob, page } = useStore();
  const lyricsRef = useRef<HTMLTextAreaElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const vocals = !draft.instrumental;
  const model = modelById(draft.modelId);
  const candidates = useMemo(() => compatible(models, vocals), [models, vocals]);

  // Keep the selected model valid for the current mode.
  useEffect(() => {
    if (!models.length) return;
    if (!model || !(vocals ? model.vocals : model.instrumental)) {
      const next = candidates[0];
      if (next && next.id !== draft.modelId) setDraft({ modelId: next.id, duration: null, steps: null });
    }
  }, [models.length, model, vocals, candidates, draft.modelId, setDraft]);

  const duration = model ? Math.min(model.duration.max, Math.max(model.duration.min, draft.duration ?? model.duration.default)) : 60;
  const steps = model?.steps ? draft.steps ?? model.steps.default : null;
  const installed = model?.status.state === "installed";
  const downloading = model?.status.state === "downloading";
  const lyricLines = draft.lyrics.split("\n").filter((l) => l.trim() && !/^\[.*\]$/.test(l.trim())).length;

  const problems: string[] = [];
  if (!draft.prompt.trim()) problems.push(t("problems.prompt"));
  if (vocals && !draft.lyrics.trim()) problems.push(model?.lyricsRequired ? t("problems.lyricsRequired", { name: model.name }) : t("problems.lyrics"));
  if (!engine?.installed) problems.push(t("problems.engine"));

  const canGenerate = !!model && installed && problems.length === 0 && !submitting;

  const generate = async () => {
    if (!model || !canGenerate) return;
    setSubmitting(true);
    const params: GenParams = {
      model: model.id,
      prompt: draft.prompt,
      lyrics: vocals ? draft.lyrics : "",
      instrumental: !vocals,
      duration,
      seed: draft.lockSeed ? draft.seed : null,
      steps,
      cot: model.supportsCot ? draft.cot : null,
      negativePrompt: model.supportsNegativePrompt ? draft.negativePrompt : null,
      title: draft.title.trim() || null,
    };
    const job = await run(() => backend.createJob(params));
    setSubmitting(false);
    if (!job) return;
    if (!draft.lockSeed) setDraft({ seed: job.seed });
    const ahead = jobs.filter((j) => j.status === "queued" || j.status === "running").length;
    toast("success", ahead ? t("toast.queued", { title: job.title, count: ahead }) : t("toast.started", { title: job.title }), {
      label: t("common:actions.view"),
      run: () => {
        selectJob(job.id);
        setPage("library");
      },
    });
  };

  useEffect(() => {
    if (page !== "create") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === "Enter") {
        e.preventDefault();
        void generate();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const insertTag = (tag: string) => {
    const el = lyricsRef.current;
    const text = draft.lyrics;
    const start = el?.selectionStart ?? text.length;
    const before = text.slice(0, start);
    const insert = `${before && !before.endsWith("\n") ? "\n" : ""}${before.trim() ? "\n" : ""}${tag}\n`;
    const next = before + insert + text.slice(el?.selectionEnd ?? start);
    setDraft({ lyrics: next });
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const pos = before.length + insert.length;
      el.setSelectionRange(pos, pos);
    });
  };

  return (
    <>
      <header className="toolbar" data-tauri-drag-region>
        <h1>{t("title")}</h1>
        <span className="subtitle">{t("subtitle")}</span>
        <div className="spacer" data-tauri-drag-region />
      </header>
      <div className="content page-enter">
        {/* Full-width title row so both columns start on the same line. */}
        <input
          className="title-input"
          placeholder={t("titlePlaceholder")}
          value={draft.title}
          maxLength={60}
          onChange={(e) => setDraft({ title: e.target.value })}
        />
        <div className="create">
          <section className="composer">
            <div className="card pad">
              <div className="label">
                <Wand2 size={13} /> {t("style.label")}
                <span className="aside">{draft.prompt.length}/2000</span>
              </div>
              <textarea
                className="field"
                rows={3}
                placeholder={model?.promptExample ?? t("style.placeholderFallback")}
                value={draft.prompt}
                onChange={(e) => setDraft({ prompt: e.target.value })}
              />
              <div className="chips" style={{ marginTop: 10 }}>
                {STYLE_PRESETS.map((p) => {
                  const on = p.tags.split(",").every((tag) => draft.prompt.toLowerCase().includes(tag.trim().toLowerCase()));
                  return (
                    <button key={p.key} className={`chip${on ? " on" : ""}`} onClick={() => setDraft({ prompt: toggleTag(draft.prompt, p.tags) })}>
                      {t(`presets.${p.key}`)}
                    </button>
                  );
                })}
              </div>
              {model && (
                <div className="hint" style={{ marginTop: 10 }}>
                  {modelText(model).promptHint}{" "}
                  {!draft.prompt && (
                    <button className="link" onClick={() => setDraft({ prompt: model.promptExample })}>
                      {t("style.useExample")}
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="card pad lyrics-card">
              <div className="hstack" style={{ marginBottom: 10 }}>
                <div className="label" style={{ margin: 0 }}>
                  <Music2 size={13} /> {t("lyrics.label")}
                </div>
                <div className="grow" />
                <Segmented
                  value={vocals ? "vocals" : "inst"}
                  onChange={(v) => setDraft({ instrumental: v === "inst" })}
                  options={[
                    { value: "vocals", label: t("lyrics.modeVocals") },
                    { value: "inst", label: t("lyrics.modeInstrumental") },
                  ]}
                />
              </div>
              {vocals ? (
                <>
                  <div className="chips" style={{ marginBottom: 8 }}>
                    {SECTION_TAGS.map((tag) => (
                      <button key={tag} className="chip mono" onClick={() => insertTag(tag)} title={t("lyrics.insertTagTitle")}>
                        {tag}
                      </button>
                    ))}
                  </div>
                  <textarea
                    ref={lyricsRef}
                    className="field lyrics"
                    placeholder={t("lyrics.placeholder")}
                    value={draft.lyrics}
                    onChange={(e) => setDraft({ lyrics: e.target.value })}
                    spellCheck={false}
                  />
                  <div className="hint" style={{ marginTop: 8, display: "flex" }}>
                    <span className="grow">{t("lyrics.hint")}</span>
                    <span className="num">
                      {t("lyrics.stats", { lines: t("lyrics.lineCount", { count: lyricLines }), chars: t("lyrics.charCount", { count: draft.lyrics.length }) })}
                    </span>
                  </div>
                </>
              ) : (
                <div className="inst-note">
                  <Sparkles size={18} />
                  <div>
                    <div style={{ fontWeight: 600 }}>{t("instrumental.title")}</div>
                    <div className="hint">{t("instrumental.note")}</div>
                  </div>
                </div>
              )}
            </div>
          </section>

          <aside className="inspector">
            <div className="card pad">
              <div className="label">
                <Boxes size={13} /> {t("model.label")}
              </div>
              <ModelSelect vocals={vocals} value={draft.modelId} onChange={(id) => setDraft({ modelId: id, duration: null, steps: null })} />
            </div>

            {model && (
              <div className="card pad vstack" style={{ gap: 16 }}>
                <div>
                  <div className="label">
                    <Timer size={13} /> {model.duration.mode === "max" ? t("duration.labelMax") : t("duration.label")}
                    <span className="aside">{formatDuration(duration)}</span>
                  </div>
                  <Slider value={duration} min={model.duration.min} max={model.duration.max} step={5} onChange={(v) => setDraft({ duration: v })} />
                  {model.duration.mode === "max" && <div className="hint tiny">{t("duration.maxHint")}</div>}
                </div>

                <SeedControl draft={draft} setDraft={setDraft} />

                <button className="disclosure" onClick={() => setShowAdvanced((v) => !v)} aria-expanded={showAdvanced}>
                  <span className={`chev${showAdvanced ? " open" : ""}`}>›</span> {t("advanced.toggle")}
                </button>
                {showAdvanced && (
                  <div className="vstack" style={{ gap: 16 }}>
                    {model.supportsCot && (
                      <div>
                        <div className="label">{t("cot.label")}</div>
                        <Segmented<Cot>
                          block
                          value={draft.cot}
                          onChange={(cot) => setDraft({ cot })}
                          options={[
                            { value: "off", label: t("cot.off"), title: t("cot.offTitle") },
                            { value: "melody", label: t("cot.melody") },
                            { value: "full", label: t("cot.full") },
                          ]}
                        />
                        <div className="hint tiny" style={{ marginTop: 6 }}>
                          {t("cot.hint")}
                        </div>
                      </div>
                    )}
                    {model.steps && steps != null && (
                      <div>
                        <div className="label">
                          {t("steps.label")} <span className="aside">{steps}</span>
                        </div>
                        <Slider value={steps} min={model.steps.min} max={model.steps.max} onChange={(v) => setDraft({ steps: v })} />
                      </div>
                    )}
                    {model.supportsNegativePrompt && (
                      <div>
                        <div className="label">{t("negative.label")}</div>
                        <input
                          className="field compact"
                          placeholder={t("negative.placeholder")}
                          value={draft.negativePrompt}
                          onChange={(e) => setDraft({ negativePrompt: e.target.value })}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="generate-box">
              {model && !installed ? (
                <button
                  className="btn primary large block"
                  disabled={downloading}
                  onClick={() => run(() => backend.installModel(model.id), t("generate.downloadStarted", { name: model.name }))}
                >
                  <Download size={16} />
                  {downloading
                    ? t("generate.downloading", { percent: Math.floor((model.status.downloadedBytes / Math.max(1, model.status.totalBytes)) * 100) })
                    : t("generate.download", { size: formatBytes(model.totalSize) })}
                </button>
              ) : (
                <button className="btn primary large block" disabled={!canGenerate} onClick={generate}>
                  {submitting ? <div className="spinner" /> : <Sparkles size={16} />}
                  {t("generate.button")}
                  <span className="kbd">⌘↩</span>
                </button>
              )}
              {problems.length > 0 && installed && (
                <div className="hint center">{t("generate.needs", { items: new Intl.ListFormat(i18n.language, { type: "conjunction" }).format(problems) })}</div>
              )}
              {model && !installed && <div className="hint center">{t("generate.firstRun")}</div>}
            </div>
          </aside>
        </div>
      </div>
    </>
  );
}

function SeedControl({ draft, setDraft }: { draft: Draft; setDraft: (p: Partial<Draft>) => void }) {
  const { t } = useTranslation(["create", "common"]);
  return (
    <div>
      <div className="label">
        {t("seed.label")}
        <span className="aside">{draft.lockSeed ? t("seed.locked") : t("seed.random")}</span>
      </div>
      <div className="hstack">
        <input
          className="field compact mono grow"
          type="number"
          min={0}
          placeholder={t("seed.placeholder")}
          value={draft.seed ?? ""}
          onChange={(e) => setDraft({ seed: e.target.value === "" ? null : Math.max(0, Math.floor(Number(e.target.value))), lockSeed: e.target.value !== "" })}
        />
        <button className="icon-btn" title={t("seed.reroll")} onClick={() => setDraft({ seed: Math.floor(Math.random() * 4294967295), lockSeed: true })}>
          <Dices size={16} />
        </button>
        <button
          className={`icon-btn${draft.lockSeed ? " on" : ""}`}
          title={draft.lockSeed ? t("seed.lockedTitle") : t("seed.unlockedTitle")}
          onClick={() => setDraft({ lockSeed: !draft.lockSeed })}
        >
          {draft.lockSeed ? <Lock size={15} /> : <LockOpen size={15} />}
        </button>
      </div>
    </div>
  );
}
