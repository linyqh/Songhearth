import { CircleAlert } from "lucide-react";
import { Component, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

function ErrorFallback({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const { t } = useTranslation(["shell", "common"]);
  return (
    <div className="content">
      <div className="empty">
        <div className="glyph" style={{ color: "var(--red)" }}>
          <CircleAlert size={30} />
        </div>
        <h3>{t("errorBoundary.title")}</h3>
        <p className="selectable mono tiny">{error.message}</p>
        <button className="btn" onClick={onRetry}>
          {t("common:actions.retry")}
        </button>
      </div>
    </div>
  );
}

/** Keeps a crashing page from blanking the whole window. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <ErrorFallback error={this.state.error} onRetry={() => this.setState({ error: null })} />;
  }
}
