import { CircleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { EngineSetup } from "./components/EngineSetup";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { PlayerBar } from "./components/PlayerBar";
import { Sidebar } from "./components/Sidebar";
import { Toasts } from "./components/Toasts";
import { Sheet } from "./components/ui";
import { PlayerProvider } from "./lib/player";
import { isMod } from "./lib/platform";
import { StoreProvider, useStore, type Page } from "./lib/store";
import { ApiPage } from "./pages/Api";
import { CreatePage } from "./pages/Create";
import { LibraryPage } from "./pages/Library";
import { ModelsPage } from "./pages/Models";
import { SettingsPage } from "./pages/Settings";

const PAGES: Page[] = ["create", "library", "models", "api", "settings"];

function Shell() {
  const { t } = useTranslation(["shell", "common"]);
  const { boot, loadError, page, setPage, selectJob, engine, jobs } = useStore();
  const [engineSheetDismissed, setEngineSheetDismissed] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isMod(e) || e.altKey) return;
      const idx = Number(e.key) - 1;
      if (idx >= 0 && idx < PAGES.length) {
        e.preventDefault();
        if (PAGES[idx] === "library") selectJob(null);
        setPage(PAGES[idx]);
      }
      if (e.key === ",") {
        e.preventDefault();
        setPage("settings");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setPage, selectJob]);

  if (loadError) {
    return (
      <div className="boot-error">
        <CircleAlert size={28} />
        <div>{t("app.initFailed")}</div>
        <div className="hint selectable">{loadError}</div>
      </div>
    );
  }
  if (!boot) return <div className="boot-loading" data-tauri-drag-region />;

  const showEngineSheet = engine && !engine.installed && !engineSheetDismissed && page !== "settings";

  return (
    <PlayerProvider jobs={jobs}>
      <div className="app">
        <Sidebar />
        <main className="main">
          <ErrorBoundary resetKey={page}>
            {page === "create" && <CreatePage />}
            {page === "library" && <LibraryPage />}
            {page === "models" && <ModelsPage />}
            {page === "api" && <ApiPage />}
            {page === "settings" && <SettingsPage />}
          </ErrorBoundary>
          <ErrorBoundary resetKey="player">
            <PlayerBar />
          </ErrorBoundary>
        </main>
      </div>
      <Toasts />
      {showEngineSheet && (
        <Sheet onClose={() => setEngineSheetDismissed(true)}>
          <h2>{t("app.welcome.title")}</h2>
          <p>{t("app.welcome.body")}</p>
          <EngineSetup compact />
          <div className="actions">
            <button className="btn plain" onClick={() => setEngineSheetDismissed(true)}>
              {t("common:actions.later")}
            </button>
          </div>
        </Sheet>
      )}
    </PlayerProvider>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
