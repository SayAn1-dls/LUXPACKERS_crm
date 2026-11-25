import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

type Notify = (message: string, bad?: boolean) => void;
const ToastContext = createContext<Notify>(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ id: number; message: string; bad: boolean } | null>(null);
  const timer = useRef<number>(0);
  const seq = useRef(0);

  const notify = useCallback<Notify>((message, bad = false) => {
    window.clearTimeout(timer.current);
    setToast({ id: ++seq.current, message, bad });
    timer.current = window.setTimeout(() => setToast(null), bad ? 5200 : 2600);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <ToastContext.Provider value={notify}>
      {children}
      <div role="status">{toast && <div key={toast.id} className={`toast${toast.bad ? " bad" : ""}`}>{toast.message}</div>}</div>
    </ToastContext.Provider>
  );
}
