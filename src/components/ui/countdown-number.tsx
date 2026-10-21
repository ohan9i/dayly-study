import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import './countdown-number.css';

// Inspired by daisyUI Countdown's vertical number transition. Animate transforms
// with WAAPI rather than its layout-changing top/width transitions.
const preference =
  typeof window === 'undefined' ? null : window.matchMedia('(prefers-reduced-motion: reduce)');
const subscribe = (notify: () => void) => {
  preference?.addEventListener('change', notify);
  return () => preference?.removeEventListener('change', notify);
};
const readPreference = () => preference?.matches ?? false;

export function CountdownNumber({
  value,
  direction,
  animate,
}: {
  value: string;
  direction: 'up' | 'down';
  animate: boolean;
}) {
  const previous = useRef(value);
  const incoming = useRef<HTMLSpanElement>(null);
  const outgoing = useRef<HTMLSpanElement>(null);
  const reduce = useSyncExternalStore(subscribe, readPreference, () => false);
  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = value;
    const next = incoming.current!;
    const old = outgoing.current!;
    old.style.visibility = 'hidden';
    if (before === value || !animate || reduce) return;
    old.textContent = before;
    old.style.visibility = 'visible';
    const offset = direction === 'up' ? 100 : -100;
    const timing = {
      duration: 280,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      fill: 'both' as const,
    };
    const entering = next.animate(
      [{ transform: `translateY(${offset}%)` }, { transform: 'translateY(0)' }],
      timing,
    );
    const leaving = old.animate(
      [{ transform: 'translateY(0)' }, { transform: `translateY(${-offset}%)` }],
      timing,
    );
    leaving.onfinish = () => {
      old.style.visibility = 'hidden';
    };
    return () => {
      entering.cancel();
      leaving.cancel();
      old.style.visibility = 'hidden';
    };
  }, [value, direction, animate, reduce]);
  return (
    <span className="countdown-number" aria-hidden="true">
      <span className="countdown-number-old" ref={outgoing} />
      <span className="countdown-number-current" ref={incoming}>
        {value}
      </span>
    </span>
  );
}
