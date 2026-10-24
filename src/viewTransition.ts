import { flushSync } from 'react-dom';

type TransitionDocument = Document & {
  startViewTransition?: (update: () => void) => { finished: Promise<unknown> };
};

/**
 * Runs a state change as a view transition, tagging the document so CSS can
 * style that one kind of transition. Browsers without the API, and readers who
 * asked for less motion, get the plain update instead.
 */
export function withViewTransition(kind: string, update: () => void) {
  const doc = document as TransitionDocument;
  const root = document.documentElement;
  const reduce =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (typeof doc.startViewTransition !== 'function' || reduce) {
    update();
    return;
  }
  root.dataset.vt = kind;
  const clear = () => {
    if (root.dataset.vt === kind) delete root.dataset.vt;
  };
  try {
    // flushSync lets the browser capture the finished DOM rather than the
    // state React would otherwise commit after the snapshot was taken.
    doc.startViewTransition(() => flushSync(update)).finished.then(clear, clear);
  } catch {
    clear();
    update();
  }
}
