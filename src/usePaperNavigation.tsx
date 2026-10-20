import { lazy, Suspense, useEffect, useRef, useState, type RefObject } from 'react';
import type { PaperFrame } from './PaperTransition';

let modulePromise: Promise<typeof import('./PaperTransition')> | undefined;
function loadPaper() {
  return (modulePromise ??= import('./PaperTransition').catch((error) => {
    modulePromise = undefined;
    throw error;
  }));
}
const Transition = lazy(loadPaper);
const motionAllowed = () =>
  !matchMedia('(prefers-reduced-motion: reduce)').matches &&
  document.documentElement.dataset.interaction !== 'keyboard' &&
  !document.hidden;

export function usePaperNavigation(isHome: boolean, paper: RefObject<HTMLElement | null>) {
  const [frame, setFrame] = useState<(PaperFrame & { navigationId: number }) | null>(null);
  const generation = useRef(0);
  const pending = useRef<{ commit: () => void; cancel: () => void } | null>(null);
  useEffect(() => {
    // Lazy load after the opening sequence; no WebGL scene runs while idle.
    const timer = setTimeout(() => {
      if (isHome && motionAllowed()) void loadPaper().catch(() => {});
    }, 2200);
    return () => clearTimeout(timer);
  }, [isHome]);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const cancel = () => {
      generation.current++;
      pending.current?.commit();
      setFrame(null);
    };
    const onVisibility = () => {
      if (document.hidden) cancel();
    };
    media.addEventListener('change', cancel);
    window.addEventListener('resize', cancel);
    window.addEventListener('scroll', cancel, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('keydown', cancel);
    return () => {
      generation.current++;
      pending.current?.cancel();
      media.removeEventListener('change', cancel);
      window.removeEventListener('resize', cancel);
      window.removeEventListener('scroll', cancel);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('keydown', cancel);
    };
  }, []);
  const navigate = (update: () => void, changed = true) => {
    pending.current?.cancel();
    const id = ++generation.current;
    setFrame(null);
    const element = paper.current;
    if (!changed) return;
    if (!isHome || !element || !motionAllowed()) return update();
    // A slow capture must never hold up the chosen destination. New clicks supersede old captures.
    let committed = false;
    const commit = () => {
      if (committed) return;
      committed = true;
      clearTimeout(timeout);
      pending.current = null;
      update();
    };
    const timeout = setTimeout(commit, 240);
    pending.current = {
      commit,
      cancel: () => {
        committed = true;
        clearTimeout(timeout);
        pending.current = null;
      },
    };
    void loadPaper()
      .then(({ capturePaper }) => {
        if (id !== generation.current || committed) return null;
        return capturePaper(element);
      })
      .then((snapshot) => {
        if (id !== generation.current || committed) return;
        if (snapshot && motionAllowed()) setFrame({ ...snapshot, navigationId: id });
        commit();
      })
      .catch(() => {
        if (id === generation.current) commit();
      });
  };
  const overlay = frame ? (
    <Suspense fallback={null}>
      <Transition
        key={frame.navigationId}
        frame={frame}
        onDone={() => {
          setFrame((current) => (current?.navigationId === frame.navigationId ? null : current));
        }}
      />
    </Suspense>
  ) : null;
  return { navigate, overlay };
}
