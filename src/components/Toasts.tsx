import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useStore } from "../lib/store";

export function Toasts() {
  const { t: tr } = useTranslation();
  const { toasts, dismissToast } = useStore();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.kind === "error" ? <CircleAlert size={17} /> : t.kind === "success" ? <CircleCheck size={17} /> : <Info size={17} />}
          <span className="msg">{t.message}</span>
          {t.action && (
            <button
              className="btn small plain"
              onClick={() => {
                t.action!.run();
                dismissToast(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button className="icon-btn sm" onClick={() => dismissToast(t.id)} aria-label={tr("actions.close")}>
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
