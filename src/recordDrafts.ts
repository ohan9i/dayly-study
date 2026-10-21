import { useEffect, useSyncExternalStore } from 'react';

type Draft = {
  body: string;
  files: File[];
  adding: boolean;
  working: boolean;
  pendingId: string | null;
  error: string;
  message: string;
};
const drafts = new Map<string, Draft>();
const listeners = new Set<() => void>();
const prefix = 'dayly.record-draft.v1:';
function read(key: string): Draft {
  if (!drafts.has(key)) {
    let saved: Partial<Draft> = {};
    try {
      const value = JSON.parse(sessionStorage.getItem(prefix + key) || '{}');
      if (value && typeof value === 'object') saved = value;
    } catch {
      /* Memory still protects drafts. */
    }
    drafts.set(key, {
      body: typeof saved.body === 'string' ? saved.body : '',
      files: [],
      adding: Boolean(saved.adding),
      working: false,
      pendingId: typeof saved.pendingId === 'string' ? saved.pendingId : null,
      error: '',
      message: '',
    });
  }
  return drafts.get(key)!;
}
export function updateRecordDraft(key: string, patch: Partial<Draft>) {
  const next = { ...read(key), ...patch };
  drafts.set(key, next);
  try {
    if (!next.body && !next.pendingId) sessionStorage.removeItem(prefix + key);
    else
      sessionStorage.setItem(
        prefix + key,
        JSON.stringify({ body: next.body, adding: next.adding, pendingId: next.pendingId }),
      );
  } catch {
    /* Storage can be unavailable; keep the in-memory draft. */
  }
  listeners.forEach((notify) => notify());
}
export function useRecordDraft(key: string) {
  return useSyncExternalStore(
    (notify) => {
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
      };
    },
    () => read(key),
  );
}

export function useDraftUnloadGuard() {
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if ([...drafts.values()].some((draft) => draft.files.length || draft.working || draft.body))
        event.preventDefault();
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, []);
}
