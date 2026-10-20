import { useEffect, useRef, useState } from 'react';

/** Background refresh never occupies space above the planner. */
export default function LoadingStatus({ loading }: { loading: boolean }) {
  const [visible, setVisible] = useState(false);
  const shownAt = useRef(0);
  useEffect(() => {
    const delay = loading
      ? visible
        ? 0
        : 500
      : Math.max(0, 600 - (performance.now() - shownAt.current));
    const timer = window.setTimeout(() => {
      if (loading && !visible) shownAt.current = performance.now();
      setVisible(loading);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [loading, visible]);
  return visible ? (
    <div className="loading-note" role="status" aria-live="polite">
      공유 기록을 불러오는 중이에요.
    </div>
  ) : null;
}
