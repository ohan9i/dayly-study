import { useEffect, useRef, useState } from 'react';
import { Check, Moon, Sun } from 'lucide-react';
import { flushSync } from 'react-dom';

export type Atmosphere = 'morning' | 'night';
const storageKey = 'dayly.atmosphere';

export function useAtmosphere() {
  const [atmosphere, setAtmosphere] = useState<Atmosphere>(() =>
    document.documentElement.dataset.atmosphere === 'night' ? 'night' : 'morning',
  );
  useEffect(() => {
    document.documentElement.dataset.atmosphere = atmosphere;
    document.documentElement.style.colorScheme = atmosphere === 'night' ? 'dark' : 'light';
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', atmosphere === 'night' ? '#202329' : '#f0efeb');
    try {
      localStorage.setItem(storageKey, atmosphere);
    } catch {
      // The theme still works when browser storage is unavailable.
    }
  }, [atmosphere]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null) {
        setAtmosphere(event.newValue === 'night' ? 'night' : 'morning');
      }
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  useEffect(() => {
    const keyboard = () => {
      document.documentElement.dataset.interaction = 'keyboard';
    };
    const pointer = () => {
      document.documentElement.dataset.interaction = 'pointer';
    };
    window.addEventListener('keydown', keyboard, true);
    window.addEventListener('pointerdown', pointer, true);
    return () => {
      window.removeEventListener('keydown', keyboard, true);
      window.removeEventListener('pointerdown', pointer, true);
    };
  }, []);
  const changeAtmosphere = (next: Atmosphere) => {
    if (next === atmosphere) return;
    if (
      document.startViewTransition &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches &&
      document.documentElement.dataset.interaction !== 'keyboard'
    ) {
      document.startViewTransition(() => {
        flushSync(() => setAtmosphere(next));
      });
    } else setAtmosphere(next);
  };
  return [atmosphere, changeAtmosphere] as const;
}

export function AtmospherePicker({
  value,
  onChange,
  compact = false,
}: {
  value: Atmosphere;
  onChange: (value: Atmosphere) => void;
  compact?: boolean;
}) {
  return (
    <div
      className={`atmosphere-picker ${compact ? 'compact' : ''}`}
      role="group"
      aria-label="공부 공간 분위기"
    >
      {(
        [
          ['morning', '아침 창가', '맑은 빛, 가벼운 시작', Sun],
          ['night', '밤 공부', '낮은 조명, 깊은 몰입', Moon],
        ] as const
      ).map(([theme, label, description, Icon]) => (
        <button
          key={theme}
          className="atmosphere-option"
          aria-pressed={value === theme}
          aria-label={label}
          type="button"
          onClick={() => onChange(theme)}
        >
          <Icon size={17} strokeWidth={1.6} aria-hidden="true" />
          <span>
            <strong>{label}</strong>
            {!compact && <small>{description}</small>}
          </span>
          {!compact && value === theme && (
            <Check className="atmosphere-check" size={17} aria-hidden="true" />
          )}
        </button>
      ))}
    </div>
  );
}

export function CompletionSparkles({
  done,
  total,
  scope,
  ready,
}: {
  done: number;
  total: number;
  scope: string;
  ready: boolean;
}) {
  const previous = useRef({ done, total, scope, ready });
  const [celebrating, setCelebrating] = useState(false);
  useEffect(() => {
    const before = previous.current;
    previous.current = { done, total, scope, ready };
    if (
      ready &&
      before.ready &&
      before.scope === scope &&
      before.total === total &&
      total > 0 &&
      before.done < total &&
      done === total
    ) {
      setCelebrating(true);
      const timer = window.setTimeout(() => setCelebrating(false), 900);
      return () => window.clearTimeout(timer);
    }
    setCelebrating(false);
  }, [done, total, scope, ready]);
  return celebrating ? (
    <span className="completion-sparkles" aria-hidden="true">
      <i>✦</i>
      <i>✧</i>
      <i>✦</i>
    </span>
  ) : null;
}
