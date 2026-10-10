'use client';

import { CircleAlert } from 'lucide-react';
import {
  createContext,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

export interface ToastOptions {
  message: string;
  tone?: 'default' | 'error';
  /** One follow-up, e.g. Undo. Clicking it also closes the toast. */
  action?: { label: string; onClick: () => void };
}

type ShowToast = (toast: ToastOptions) => void;

const ToastContext = createContext<ShowToast>(() => undefined);

/** One toast at a time, at the bottom of the screen; a new one replaces the last. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<(ToastOptions & { id: number }) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const nextId = useRef(0);

  const show = useCallback<ShowToast>((options) => {
    clearTimeout(timer.current);
    nextId.current += 1;
    setToast({ ...options, id: nextId.current });
    timer.current = setTimeout(() => setToast(null), options.action ? 6000 : 4500);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  const close = () => {
    clearTimeout(timer.current);
    setToast(null);
  };

  return (
    <ToastContext value={show}>
      {children}
      {/* The live region is always there, so screen readers announce each toast put into it. */}
      <div
        role="status"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        {toast && (
          <div
            key={toast.id}
            className="pointer-events-auto flex max-w-full animate-toast items-center gap-3 rounded-xl bg-ink py-2 pr-2 pl-4 text-sm text-surface shadow-float"
          >
            {toast.tone === 'error' && <CircleAlert size={16} className="shrink-0" aria-hidden />}
            <span className="min-w-0 py-1">{toast.message}</span>
            {toast.action ? (
              <button
                type="button"
                data-toast-action
                onClick={() => {
                  close();
                  toast.action?.onClick();
                }}
                className="shrink-0 rounded-lg bg-surface/15 px-3 py-1 font-semibold transition-colors hover:bg-surface/25"
              >
                {toast.action.label}
              </button>
            ) : (
              <span className="w-2" />
            )}
          </div>
        )}
      </div>
    </ToastContext>
  );
}

export function useToast(): ShowToast {
  return use(ToastContext);
}
