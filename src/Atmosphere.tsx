import { useEffect, useId, useRef, useState, type PointerEvent } from 'react';
import { Check, Moon, Sun } from 'lucide-react';

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
      ?.setAttribute('content', atmosphere === 'night' ? '#132638' : '#d4eaff');
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
  return [atmosphere, setAtmosphere] as const;
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
          type="button"
          className="atmosphere-option"
          aria-pressed={value === theme}
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

// A lightweight SVG scene: only the illustration responds to the pointer.
export function StudyScene() {
  const id = useId().replace(/:/g, '');
  const illustration = useRef<SVGSVGElement>(null);
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (
      event.pointerType !== 'mouse' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    )
      return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!illustration.current) return;
    const x = ((event.clientX - rect.left) / rect.width - 0.5) * 6;
    const y = ((event.clientY - rect.top) / rect.height - 0.5) * 4;
    illustration.current.style.transform = `translate(${x}px, ${y}px)`;
  };
  const reset = () => {
    if (illustration.current) illustration.current.style.transform = '';
  };
  return (
    <div className="study-scene" aria-hidden="true" onPointerMove={move} onPointerLeave={reset}>
      <svg ref={illustration} viewBox="0 0 260 150" fill="none" className="study-illustration">
        <defs>
          <linearGradient
            id={`${id}-book`}
            x1="65"
            y1="105"
            x2="163"
            y2="134"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="var(--book-light)" />
            <stop offset="1" stopColor="var(--book-dark)" />
          </linearGradient>
          <radialGradient id={`${id}-light`}>
            <stop stopColor="#ffe4a3" stopOpacity=".55" />
            <stop offset="1" stopColor="#ffe4a3" stopOpacity="0" />
          </radialGradient>
          <linearGradient
            id={`${id}-metal`}
            x1="160"
            y1="55"
            x2="203"
            y2="114"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="var(--lamp-light)" />
            <stop offset="1" stopColor="var(--lamp-dark)" />
          </linearGradient>
        </defs>
        <ellipse cx="130" cy="134" rx="98" ry="7" fill="var(--scene-shadow)" />
        <ellipse
          className="lamp-glow"
          cx="159"
          cy="100"
          rx="66"
          ry="43"
          fill={`url(#${id}-light)`}
        />
        <path d="M54 120L126 107L169 119L97 135L54 125Z" fill="var(--book-dark)" />
        <path d="M57 120L126 108L165 119L96 132L57 124Z" fill="var(--book-paper)" />
        <path d="M54 117L126 104L169 117L97 131Z" fill={`url(#${id}-book)`} />
        <path
          d="M96 130L96 135M65 122L94 129M66 124L94 131"
          stroke="var(--book-line)"
          strokeWidth="1"
        />
        <path d="M82 112L123 105L147 112L105 120Z" fill="var(--book-paper)" />
        <path d="M94 111L124 106M99 114L137 108" stroke="var(--book-line)" strokeOpacity=".5" />
        <path d="M110 119L117 121L115 130L111 127L107 130Z" fill="#dbad9a" />
        <ellipse cx="191" cy="124" rx="24" ry="6" fill="var(--lamp-dark)" />
        <ellipse cx="191" cy="122" rx="24" ry="6" fill="var(--lamp-light)" />
        <path
          d="M192 120V77L174 60"
          stroke={`url(#${id}-metal)`}
          strokeWidth="6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="192" cy="77" r="4" fill="var(--lamp-dark)" />
        <path d="M164 49C167 46 172 46 175 49L191 65L156 78L159 55Z" fill={`url(#${id}-metal)`} />
        <ellipse
          cx="173"
          cy="71"
          rx="19"
          ry="4"
          transform="rotate(-20 173 71)"
          fill="var(--lamp-dark)"
        />
        <ellipse cx="173" cy="72" rx="14" ry="2" transform="rotate(-20 173 72)" fill="#f8dfaa" />
        <path d="M42 134H220" stroke="var(--line)" strokeLinecap="round" />
      </svg>
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
