import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { backend, on } from "./backend";
import { LANGUAGE_KEY, setLanguagePreference } from "../i18n";
import { translateError } from "../i18n/translate";
import { notifyJobDone } from "./notify";
import type { ApiStatus, Bootstrap, Cot, EngineStatus, Job, Model, Settings } from "./types";

export type Page = "create" | "library" | "models" | "api" | "settings";

export interface Draft {
  modelId: string;
  title: string;
  prompt: string;
  lyrics: string;
  instrumental: boolean;
  duration: number | null;
  seed: number | null;
  lockSeed: boolean;
  steps: number | null;
  cot: Cot;
  negativePrompt: string;
}

export const emptyDraft: Draft = {
  modelId: "",
  title: "",
  prompt: "",
  lyrics: "",
  instrumental: false,
  duration: null,
  seed: null,
  lockSeed: false,
  steps: null,
  cot: "full",
  negativePrompt: "",
};

export interface Toast {
  id: number;
  kind: "success" | "error" | "info";
  message: string;
  action?: { label: string; run: () => void };
}

interface Store {
  boot: Bootstrap | null;
  loadError: string | null;
  models: Model[];
  jobs: Job[];
  engine: EngineStatus | null;
  api: ApiStatus | null;
  settings: Settings | null;
  page: Page;
  setPage: (p: Page) => void;
  selectedJobId: string | null;
  selectJob: (id: string | null) => void;
  draft: Draft;
  setDraft: (patch: Partial<Draft>) => void;
  replaceDraft: (d: Draft) => void;
  toasts: Toast[];
  toast: (kind: Toast["kind"], message: string, action?: Toast["action"]) => void;
  dismissToast: (id: number) => void;
  /** Runs an async action and surfaces failures as an error toast. */
  run: <T>(fn: () => Promise<T>, success?: string) => Promise<T | undefined>;
  applyBootstrap: (b: Bootstrap) => void;
  modelById: (id: string) => Model | undefined;
}

const Ctx = createContext<Store | null>(null);
const DRAFT_KEY = "songhearth.draft.v1";

function loadDraft(): Draft {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) return { ...emptyDraft, ...JSON.parse(raw) };
  } catch {
    /* corrupted draft: start fresh */
  }
  return emptyDraft;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [models, setModels] = useState<Model[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [engine, setEngine] = useState<EngineStatus | null>(null);
  const [api, setApi] = useState<ApiStatus | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [page, setPage] = useState<Page>("create");
  const [selectedJobId, selectJob] = useState<string | null>(null);
  const [draft, setDraftState] = useState<Draft>(loadDraft);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  const statuses = useRef(new Map<string, string>());
  const notifyEnabled = useRef(true);

  const applyBootstrap = useCallback((b: Bootstrap) => {
    setBoot(b);
    setModels(b.models);
    setJobs(b.jobs);
    setEngine(b.engine);
    setApi(b.api);
    setSettings(b.settings);
    for (const j of b.jobs) statuses.current.set(j.id, j.status);
  }, []);

  // Keep the UI language and the notification flag in step with saved settings.
  useEffect(() => {
    if (!settings) return;
    notifyEnabled.current = settings.notifyOnFinish;
    localStorage.setItem(LANGUAGE_KEY, settings.language);
    void setLanguagePreference(settings.language);
  }, [settings]);

  useEffect(() => {
    backend.bootstrap().then(applyBootstrap).catch((e) => setLoadError(translateError(e)));
    const subs = [
      on("job-updated", (job) => {
        const before = statuses.current.get(job.id);
        statuses.current.set(job.id, job.status);
        if (before && before !== "succeeded" && job.status === "succeeded" && notifyEnabled.current) {
          void notifyJobDone(job);
        }
        setJobs((prev) => {
          const i = prev.findIndex((j) => j.id === job.id);
          if (i === -1) return [...prev, job];
          const next = prev.slice();
          next[i] = job;
          return next;
        });
      }),
      on("job-removed", (id) => {
        statuses.current.delete(id);
        setJobs((prev) => prev.filter((j) => j.id !== id));
      }),
      on("model-updated", (m) => setModels((prev) => prev.map((x) => (x.id === m.id ? m : x)))),
      on("engine-updated", setEngine),
      on("api-updated", setApi),
    ];
    return () => subs.forEach((p) => p.then((un) => un()));
  }, [applyBootstrap]);

  useEffect(() => {
    const t = setTimeout(() => localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)), 300);
    return () => clearTimeout(t);
  }, [draft]);

  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback(
    (kind: Toast["kind"], message: string, action?: Toast["action"]) => {
      const id = ++toastId.current;
      setToasts((t) => [...t.slice(-3), { id, kind, message, action }]);
      setTimeout(() => dismissToast(id), kind === "error" ? 7000 : 3800);
    },
    [dismissToast],
  );

  const run = useCallback(
    async <T,>(fn: () => Promise<T>, success?: string) => {
      try {
        const r = await fn();
        if (success) toast("success", success);
        return r;
      } catch (e) {
        toast("error", translateError(e));
        return undefined;
      }
    },
    [toast],
  );

  const setDraft = useCallback((patch: Partial<Draft>) => setDraftState((d) => ({ ...d, ...patch })), []);
  const modelById = useCallback((id: string) => models.find((m) => m.id === id), [models]);

  const value = useMemo<Store>(
    () => ({
      boot,
      loadError,
      models,
      jobs,
      engine,
      api,
      settings,
      page,
      setPage,
      selectedJobId,
      selectJob,
      draft,
      setDraft,
      replaceDraft: setDraftState,
      toasts,
      toast,
      dismissToast,
      run,
      applyBootstrap,
      modelById,
    }),
    [boot, loadError, models, jobs, engine, api, settings, page, selectedJobId, draft, setDraft, toasts, toast, dismissToast, run, applyBootstrap, modelById],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore outside StoreProvider");
  return s;
}

/** Newest first. */
export function sortedJobs(jobs: Job[]): Job[] {
  return jobs.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
