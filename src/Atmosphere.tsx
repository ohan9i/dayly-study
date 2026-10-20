import { useEffect, useRef, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import SquishSwitch from './SquishSwitch';

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
    setAtmosphere(next);
  };
  return [atmosphere, changeAtmosphere] as const;
}

export function AtmosphereSwitch({
  value,
  onChange,
  toolbar = false,
}: {
  value: Atmosphere;
  onChange: (value: Atmosphere) => void;
  toolbar?: boolean;
}) {
  return (
    <SquishSwitch
      checked={value === 'night'}
      onChange={(night) => onChange(night ? 'night' : 'morning')}
      ariaLabel="밤 공부"
      className={toolbar ? 'atmosphere-switch atmosphere-switch--toolbar' : 'atmosphere-switch'}
      trackColor="#27272a"
      trackOnColor="#f5f5f5"
      thumbColor="#f5f5f5"
      thumbOnColor="#27272a"
      width={76}
      height={38}
      radius={19}
      speed={50}
      stretch={36}
      hoverScale={1.035}
      colorDuration={320}
      thumbContent={value === 'night' ? <Moon size={15} /> : <Sun size={15} />}
    />
  );
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
      <span className="atmosphere-caption" data-active={value === 'morning'}>
        <Sun size={16} aria-hidden="true" />
        <span>아침 창가{!compact && <small>맑은 빛, 가벼운 시작</small>}</span>
      </span>
      <AtmosphereSwitch value={value} onChange={onChange} />
      <span className="atmosphere-caption" data-active={value === 'night'}>
        <Moon size={16} aria-hidden="true" />
        <span>밤 공부{!compact && <small>낮은 조명, 깊은 몰입</small>}</span>
      </span>
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
