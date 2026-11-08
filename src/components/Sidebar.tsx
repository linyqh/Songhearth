import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { translateStage } from "../i18n/translate";
import { formatEta } from "../lib/format";
import { MOD_LABEL } from "../lib/platform";
import { useStore, type Page } from "../lib/store";
import { IconApi, IconCreate, IconModels, IconSettings, IconWorks } from "./icons";
import { Wordmark } from "./Wordmark";
import { ProgressBar } from "./ui";

interface NavEntry {
  page: Page;
  label: string;
  icon: ReactNode;
  key: string;
}

export function Sidebar() {
  const { t } = useTranslation("shell");
  const NAV: NavEntry[] = [
    { page: "create", label: t("nav.create"), icon: <IconCreate />, key: "1" },
    { page: "library", label: t("nav.library"), icon: <IconWorks />, key: "2" },
    { page: "models", label: t("nav.models"), icon: <IconModels />, key: "3" },
  ];
  const NAV_DEV: NavEntry[] = [
    { page: "api", label: t("nav.api"), icon: <IconApi />, key: "4" },
    { page: "settings", label: t("nav.settings"), icon: <IconSettings />, key: "5" },
  ];
  const { page, setPage, jobs, models, engine, api, selectJob } = useStore();
  const running = jobs.find((j) => j.status === "running");
  const queued = jobs.filter((j) => j.status === "queued").length;
  const tracks = jobs.filter((j) => j.status === "succeeded").length;
  const downloading = models.filter((m) => m.status.state === "downloading").length;

  const count = (p: Page) => {
    if (p === "library" && (running || queued)) return <span className="count live">{(running ? 1 : 0) + queued}</span>;
    if (p === "library" && tracks) return <span className="count">{tracks}</span>;
    if (p === "models" && downloading) return <span className="count live">{downloading}</span>;
    if (p === "api" && api?.running) return <span className="count" style={{ color: "var(--green)" }}>●</span>;
    return null;
  };

  const item = (n: NavEntry) => (
    <button
      key={n.page}
      className={`nav-item${page === n.page ? " active" : ""}`}
      onClick={() => {
        // Plain navigation shows the grid, not a stale detail view.
        if (n.page === "library") selectJob(null);
        setPage(n.page);
      }}
      title={`${n.label}  ${MOD_LABEL}${n.key}`}
    >
      {n.icon}
      <span>{n.label}</span>
      {count(n.page)}
    </button>
  );

  const engineDot = engine?.installed ? "var(--green)" : engine?.installing ? "var(--orange)" : "var(--red)";
  const engineText = engine?.installed
    ? `audio.cpp ${engine.version ?? ""}`
    : engine?.installing
      ? t("sidebar.engineInstalling")
      : t("sidebar.engineMissing");

  return (
    <aside className="sidebar">
      <div className="sidebar-top" data-tauri-drag-region />
      <div className="brand" data-tauri-drag-region>
        <Wordmark />
      </div>
      <nav>
        {NAV.map(item)}
        <div className="nav-heading">{t("nav.developers")}</div>
        {NAV_DEV.map(item)}
      </nav>
      <div className="sidebar-foot">
        {running && (
          <button
            className="status-pill"
            style={{ flexDirection: "column", alignItems: "stretch", gap: 7 }}
            onClick={() => {
              selectJob(running.id);
              setPage("library");
            }}
          >
            <div className="hstack" style={{ gap: 8 }}>
              <div className="spinner" />
              <div className="grow">
                <div className="t ellipsis">{running.title}</div>
                <div className="s ellipsis">
                  {running.etaSec != null
                    ? t("sidebar.stageEta", { stage: translateStage(running.stage), eta: formatEta(running.etaSec) })
                    : translateStage(running.stage)}
                </div>
              </div>
            </div>
            <ProgressBar value={running.progress} />
            {queued > 0 && <div className="s">{t("sidebar.queuedMore", { count: queued })}</div>}
          </button>
        )}
        <button className="status-pill" onClick={() => setPage("settings")}>
          <span className="dot" style={{ background: engineDot }} />
          <div className="grow">
            <div className="t">{engineText}</div>
            <div className="s">{t("sidebar.localInference")}</div>
          </div>
        </button>
      </div>
    </aside>
  );
}
