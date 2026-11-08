import i18n from "i18next";
import type { Coded } from "../lib/types";

function isCoded(e: unknown): e is Coded {
  return typeof e === "object" && e !== null && typeof (e as Coded).code === "string";
}

/**
 * Turns anything a backend call can reject with into user-facing text in the
 * current language. Backend errors are `Coded` (translated via
 * `errors:<code>`, falling back to the English `message`); plain strings and
 * JS errors pass through.
 */
export function translateError(e: unknown): string {
  if (isCoded(e)) {
    return i18n.t(`errors:${e.code}`, { ...e.params, defaultValue: e.message || e.code });
  }
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return i18n.t("errors:unknown");
}

/** Stage codes come from the backend (`stages:<code>`); unknown ones pass through. */
export function translateStage(stage: string): string {
  return i18n.t(`stages:${stage}`, { defaultValue: stage });
}
