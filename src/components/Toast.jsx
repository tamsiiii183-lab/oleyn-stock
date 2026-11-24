// Small message at the top of the screen for 4 seconds (success or error). Use: const toast = useToast(); toast('Saved').
import { createContext, useContext, useState, useCallback } from 'react';

const ToastContext = createContext(() => {});

export function ToastProvider({ children }) {
  const [msg, setMsg] = useState(null);
  const show = useCallback((text, kind = 'ok') => {
    setMsg({ text, kind, id: Date.now() });
    setTimeout(() => setMsg((m) => (m && m.text === text ? null : m)), 4000);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      {msg && (
        <div role="status" className="fixed inset-x-0 top-2 z-50 mx-auto max-w-[440px] px-4">
          <div className={`rounded-xl px-4 py-3 font-semibold shadow ${msg.kind === 'error' ? 'bg-accent-tint text-accent-ink' : 'bg-brand-dark text-white'}`}>
            {msg.kind === 'error' ? '⚠ ' : '✓ '}{msg.text}
          </div>
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
