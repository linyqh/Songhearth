import i18n from "i18next";
import { initReactI18next } from "react-i18next";

/**
 * Locale resources are discovered from `src/i18n/locales/<code>/<namespace>.json`.
 * Adding a language = adding a folder with the same files as `en/` (see README);
 * no code changes are needed. `common.json` must define `meta.name` (the
 * language's own name, shown in the language picker).
 */
const modules = import.meta.glob<Record<string, unknown>>("./locales/*/*.json", {
  eager: true,
  import: "default",
});

export const FALLBACK_LANGUAGE = "en";
export const SYSTEM_LANGUAGE = "system";
/** localStorage key caching the saved preference so the first paint is already localised. */
export const LANGUAGE_KEY = "songhearth.language";

type Resources = Record<string, Record<string, Record<string, unknown>>>;

const resources: Resources = {};
for (const [path, json] of Object.entries(modules)) {
  const m = /\.\/locales\/([^/]+)\/([^/]+)\.json$/.exec(path);
  if (!m) continue;
  const [, lng, ns] = m;
  (resources[lng] ??= {})[ns] = json as Record<string, unknown>;
}

export interface LanguageOption {
  code: string;
  name: string;
}

/** Installed languages, English first, then alphabetical by code. */
export const languages: LanguageOption[] = Object.entries(resources)
  .map(([code, ns]) => ({ code, name: (ns.common?.meta as { name?: string } | undefined)?.name ?? code }))
  .sort((a, b) => (a.code === FALLBACK_LANGUAGE ? -1 : b.code === FALLBACK_LANGUAGE ? 1 : a.code.localeCompare(b.code)));

const codes = new Set(languages.map((l) => l.code));

/** Maps a stored preference (`system` or a code) to an installed language. */
export function resolveLanguage(preference: string | null | undefined): string {
  if (preference && preference !== SYSTEM_LANGUAGE && codes.has(preference)) return preference;
  for (const tag of navigator.languages?.length ? navigator.languages : [navigator.language]) {
    if (codes.has(tag)) return tag;
    const lower = tag.toLowerCase();
    const exact = languages.find((l) => l.code.toLowerCase() === lower);
    if (exact) return exact.code;
    // zh-Hans-CN / zh-TW → the first installed zh-* locale, en-GB → en, …
    const base = lower.split("-")[0];
    const regional = languages.find((l) => l.code.toLowerCase().split("-")[0] === base);
    if (regional) return regional.code;
  }
  return FALLBACK_LANGUAGE;
}

function applyDocumentLanguage(lng: string) {
  document.documentElement.lang = lng;
}

export async function initI18n(preference: string | null | undefined): Promise<void> {
  const lng = resolveLanguage(preference);
  await i18n.use(initReactI18next).init({
    resources,
    lng,
    fallbackLng: FALLBACK_LANGUAGE,
    defaultNS: "common",
    ns: Object.keys(resources[FALLBACK_LANGUAGE] ?? {}),
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  applyDocumentLanguage(lng);
}

export async function setLanguagePreference(preference: string | null | undefined): Promise<void> {
  const lng = resolveLanguage(preference);
  if (i18n.language !== lng) await i18n.changeLanguage(lng);
  applyDocumentLanguage(lng);
}

export default i18n;
