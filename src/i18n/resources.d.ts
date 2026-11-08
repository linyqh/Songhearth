// Typed translation keys: `t("create:title")` is checked against the English
// resources. Add a line here when introducing a new namespace file.
import "i18next";
import type catalog from "./locales/en/catalog.json";
import type common from "./locales/en/common.json";
import type create from "./locales/en/create.json";
import type errors from "./locales/en/errors.json";
import type library from "./locales/en/library.json";
import type models from "./locales/en/models.json";
import type settings from "./locales/en/settings.json";
import type shell from "./locales/en/shell.json";
import type stages from "./locales/en/stages.json";
import type api from "./locales/en/api.json";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "common";
    resources: {
      common: typeof common;
      shell: typeof shell;
      create: typeof create;
      library: typeof library;
      models: typeof models;
      catalog: typeof catalog;
      api: typeof api;
      settings: typeof settings;
      errors: typeof errors;
      stages: typeof stages;
    };
  }
}
