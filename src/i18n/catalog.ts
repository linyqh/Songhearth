import i18n from "i18next";
import type { Model } from "../lib/types";

/** i18next treats `.` as a key separator, so model ids (`ace-step-1.5-turbo`) are normalised. */
export function modelKey(id: string): string {
  return id.replace(/[.\-]/g, "_");
}

export interface ModelText {
  summary: string;
  description: string;
  tags: string[];
  languages: string;
  promptHint: string;
  licenseNote: string;
}

/**
 * Translated catalog copy for a model. The backend ships English text
 * (also served to API clients); `catalog:<modelKey>.*` overrides it per
 * language and falls back to the English the backend sent.
 */
export function modelText(m: Model): ModelText {
  const k = modelKey(m.id);
  const tags: unknown = (i18n.t as (key: string, o: object) => unknown)(`catalog:${k}.tags`, {
    returnObjects: true,
    defaultValue: m.tags,
  });
  return {
    summary: (i18n.t as (key: string, o: object) => string)(`catalog:${k}.summary`, { defaultValue: m.summary }),
    description: (i18n.t as (key: string, o: object) => string)(`catalog:${k}.description`, { defaultValue: m.description }),
    tags: Array.isArray(tags) ? (tags as string[]) : m.tags,
    languages: (i18n.t as (key: string, o: object) => string)(`catalog:${k}.languages`, { defaultValue: m.languages }),
    promptHint: (i18n.t as (key: string, o: object) => string)(`catalog:${k}.promptHint`, { defaultValue: m.promptHint }),
    licenseNote: (i18n.t as (key: string, o: object) => string)(`catalog:${k}.licenseNote`, { defaultValue: m.license.note }),
  };
}
