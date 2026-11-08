// Mirrors the Rust serde types (camelCase).

/** Backend message: stable `code` + `params`; translate with `translateError`. */
export interface Coded {
  code: string;
  params: Record<string, string>;
  message: string;
}

export type CommercialUse = "yes" | "no" | "conditional";

export interface License {
  name: string;
  commercial: CommercialUse;
  note: string;
  url: string;
}

export interface DurationSpec {
  min: number;
  max: number;
  default: number;
  mode: "exact" | "max";
}

export interface StepsSpec {
  min: number;
  max: number;
  default: number;
}

export type ModelState = "notInstalled" | "partial" | "downloading" | "installed";

export interface ModelStatus {
  state: ModelState;
  downloadedBytes: number;
  totalBytes: number;
  speedBps: number;
  error: Coded | null;
  path: string;
}

export interface Model {
  id: string;
  name: string;
  vendor: string;
  family: string;
  summary: string;
  description: string;
  tags: string[];
  vocals: boolean;
  instrumental: boolean;
  lyricsRequired: boolean;
  languages: string;
  promptHint: string;
  promptExample: string;
  license: License;
  repo: string;
  modelArg: string;
  quality: number;
  speed: number;
  memoryGb: number;
  duration: DurationSpec;
  steps: StepsSpec | null;
  supportsCot: boolean;
  supportsNegativePrompt: boolean;
  recommendedFor: string[];
  totalSize: number;
  status: ModelStatus;
}

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type Cot = "off" | "melody" | "full";

export interface GenParams {
  model: string;
  prompt: string;
  lyrics: string;
  instrumental: boolean;
  duration?: number | null;
  seed?: number | null;
  steps?: number | null;
  cot?: Cot | null;
  negativePrompt?: string | null;
  title?: string | null;
}

export interface Job {
  id: string;
  title: string;
  modelId: string;
  params: GenParams;
  seed: number;
  duration: number;
  status: JobStatus;
  stage: string;
  progress: number;
  etaSec: number | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  outputPath: string | null;
  audioDurationSec: number | null;
  wallSec: number | null;
  peaks: number[] | null;
  error: string | null;
  errorInfo: Coded | null;
  source: "app" | "api";
  favorite: boolean;
}

export interface EngineStatus {
  installed: boolean;
  dir: string | null;
  version: string | null;
  backends: string[];
  source: "custom" | "bundled" | "downloaded" | "system" | null;
  installing: boolean;
  downloadedBytes: number;
  totalBytes: number;
  error: Coded | null;
}

export interface Settings {
  /** `system` or an installed locale code. */
  language: string;
  enginePath: string | null;
  modelsDir: string | null;
  outputDir: string | null;
  threads: number;
  hfEndpoint: string;
  hfToken: string | null;
  apiEnabled: boolean;
  apiPort: number;
  apiLan: boolean;
  apiRequireToken: boolean;
  apiToken: string;
  notifyOnFinish: boolean;
}

export interface ApiStatus {
  running: boolean;
  url: string | null;
  lanUrl: string | null;
  error: Coded | null;
}

export interface SystemInfo {
  totalMemoryGb: number;
  chip: string;
  arch: string;
  osVersion: string;
}

export interface Paths {
  modelsDir: string;
  outputDir: string;
  dataDir: string;
  apiInfo: string;
}

export interface Bootstrap {
  version: string;
  settings: Settings;
  engine: EngineStatus;
  models: Model[];
  jobs: Job[];
  system: SystemInfo;
  api: ApiStatus;
  paths: Paths;
}
