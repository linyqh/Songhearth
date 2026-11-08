import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ApiStatus, Bootstrap, EngineStatus, GenParams, Job, Model, Settings } from "./types";

export const backend = {
  bootstrap: () => invoke<Bootstrap>("bootstrap"),
  saveSettings: (settings: Settings) => invoke<Bootstrap>("save_settings", { settings }),
  regenerateApiToken: () => invoke<Bootstrap>("regenerate_api_token"),
  refreshEngine: () => invoke<EngineStatus>("refresh_engine"),
  installEngine: () => invoke<EngineStatus>("install_engine"),
  cancelEngineInstall: () => invoke<void>("cancel_engine_install"),
  installModel: (id: string) => invoke<void>("install_model", { id }),
  pauseModel: (id: string) => invoke<void>("pause_model", { id }),
  deleteModel: (id: string) => invoke<void>("delete_model", { id }),
  createJob: (params: GenParams) => invoke<Job>("create_job", { params }),
  cancelJob: (id: string) => invoke<Job>("cancel_job", { id }),
  deleteJob: (id: string, deleteFile: boolean) => invoke<void>("delete_job", { id, deleteFile }),
  retryJob: (id: string, newSeed: boolean) => invoke<Job>("retry_job", { id, newSeed }),
  updateJobMeta: (id: string, meta: { title?: string; favorite?: boolean }) =>
    invoke<Job>("update_job_meta", { id, title: meta.title ?? null, favorite: meta.favorite ?? null }),
  exportTrack: (id: string, dest: string) => invoke<void>("export_track", { id, dest }),
  installSkill: (target: string) => invoke<string>("install_skill", { target }),
  skillMarkdown: () => invoke<string>("skill_markdown"),
};

export interface BackendEvents {
  "job-updated": Job;
  "job-removed": string;
  "model-updated": Model;
  "engine-updated": EngineStatus;
  "api-updated": ApiStatus;
}

export function on<K extends keyof BackendEvents>(
  event: K,
  handler: (payload: BackendEvents[K]) => void,
): Promise<UnlistenFn> {
  return listen<BackendEvents[K]>(event, (e) => handler(e.payload));
}
