// One bar at the bottom for short messages, with an optional undo. Used
// instead of confirmation dialogs (spec: reversible actions never ask).
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { onRejected } from "../lib/queue";
import { t } from "../strings";

interface Toast { message: string; actionLabel?: string; onAction?: () => void }
type Show = (toast: Toast) => void;

const ToastContext = createContext<Show>(() => {});
const SHOW_MS = 5000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const show = useCallback<Show>((next) => {
    clearTimeout(timer.current);
    setToast(next);
    timer.current = setTimeout(() => setToast(null), SHOW_MS);
  }, []);

  useEffect(() => onRejected(() => show({ message: t.rejectedChange })), [show]);

  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast && (
        <div className="toast" role="status">
          <span>{toast.message}</span>
          {toast.onAction && (
            <button className="toast-action" onClick={() => { toast.onAction!(); setToast(null); }}>
              {toast.actionLabel ?? t.undo}
            </button>
          )}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

/** Runs a server action; on failure shows the generic error instead of throwing. */
export function useAction() {
  const show = useToast();
  return useCallback(async (action: () => Promise<unknown>, after?: () => unknown) => {
    try {
      await action();
      await after?.();
    } catch {
      show({ message: t.genericError });
    }
  }, [show]);
}
