// Adapted from React Bits / David Haz, SpringCheck.
// https://github.com/DavidHDev/react-bits — license: docs/licenses/ReactBits-LICENSE.md
// Dayly preserves separate title/detail actions and supports wrapped strike text.
'use client';

import React, {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { animate, useMotionValue, useMotionValueEvent } from 'motion/react';

import './SpringCheck.css';

export type StrikeSide = 'left' | 'center' | 'right' | 'none';

export interface SpringCheckProps {
  label?: ReactNode;
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  color?: string;
  fillColor?: string;
  checkColor?: string;
  boxSize?: number;
  boxRadius?: number;
  fontSize?: number;
  bounce?: number;
  strikeLag?: number;
  doneOpacity?: number;
  strike?: StrikeSide;
  ariaLabel?: string;
  className?: string;
  labelSelector?: string;
}

const VISUAL_DURATION = 0.2;
const motionPreference =
  typeof window === 'undefined' ? null : window.matchMedia('(prefers-reduced-motion: reduce)');
const subscribeMotion = (notify: () => void) => {
  motionPreference?.addEventListener('change', notify);
  return () => motionPreference?.removeEventListener('change', notify);
};
const readMotion = () => motionPreference?.matches ?? false;
const RULE_END = 0.84;
const SWELL = 0.35;
const TICK_PATH = 'M5 12l4 4L19 6';
const ORIGIN: Record<StrikeSide, string> = {
  left: 'left center',
  center: 'center',
  right: 'right center',
  none: 'left center',
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
// Generated decoration keeps the title's DOM/accessibility text singular.
const strikeCopy = (label: ReactNode) =>
  typeof label === 'string' || typeof label === 'number'
    ? { 'data-text': String(label) }
    : { children: label };
const zetaOf = (bounce: number) =>
  bounce <= 0 ? 1 : -Math.log(bounce) / Math.sqrt(Math.PI ** 2 + Math.log(bounce) ** 2);

const readings = (
  t: number,
  doneOpacity: number,
  strikeLag: number,
  strike: StrikeSide = 'left',
) => {
  const held = clamp01(t);
  const remaining = (1 - clamp01((held - strikeLag) / Math.max(0.01, RULE_END - strikeLag))) * 100;
  return {
    fill: `scale(${Math.max(t, 0)})`,
    box: `scale(${1 + SWELL * Math.max(0, t - 1)})`,
    tick: 1 - held,
    word: 1 - (1 - doneOpacity) * held,
    rule:
      strike === 'right'
        ? `inset(0 0 0 ${remaining}%)`
        : strike === 'center'
          ? `inset(0 ${remaining / 2}% 0 ${remaining / 2}%)`
          : `inset(0 ${remaining}% 0 0)`,
  };
};

const SpringCheck: React.FC<SpringCheckProps> = ({
  label,
  checked,
  defaultChecked = false,
  onChange,
  disabled = false,
  color = 'var(--text)',
  fillColor = 'var(--accent-solid)',
  checkColor = 'var(--on-accent)',
  boxSize = 22,
  boxRadius = 5,
  fontSize = 18,
  bounce = 0.2,
  strikeLag = 0.12,
  doneOpacity = 0.42,
  strike = 'left',
  ariaLabel,
  className = '',
  labelSelector,
}) => {
  const controlled = checked !== undefined;
  const [inner, setInner] = useState(defaultChecked);
  const on = controlled ? checked : inner;
  const reduce = useSyncExternalStore(subscribeMotion, readMotion, () => false);

  const t = useMotionValue(on ? 1 : 0);
  const viaPointer = useRef(false);
  const instant = useRef(false);
  const rowRef = useRef<HTMLButtonElement>(null);
  const boxRef = useRef<HTMLSpanElement>(null);
  const fillRef = useRef<HTMLSpanElement>(null);
  const tickRef = useRef<SVGPathElement>(null);
  const wordRef = useRef<HTMLSpanElement>(null);
  const ruleRef = useRef<HTMLSpanElement>(null);
  const cfg = useRef({ doneOpacity, strikeLag, strike });
  cfg.current = { doneOpacity, strikeLag, strike };

  const write = (value: number) => {
    const r = readings(value, cfg.current.doneOpacity, cfg.current.strikeLag, cfg.current.strike);
    if (fillRef.current) fillRef.current.style.transform = r.fill;
    if (boxRef.current) boxRef.current.style.transform = r.box;
    if (tickRef.current) tickRef.current.style.strokeDashoffset = String(r.tick);
    if (wordRef.current) wordRef.current.style.opacity = String(r.word);
    if (ruleRef.current) ruleRef.current.style.clipPath = r.rule;
  };
  useMotionValueEvent(t, 'change', write);
  useLayoutEffect(() => {
    if (labelSelector) {
      const label = rowRef.current?.parentElement?.querySelector(labelSelector);
      wordRef.current = label?.querySelector<HTMLSpanElement>('.spring-check__word') || null;
      ruleRef.current = label?.querySelector<HTMLSpanElement>('.spring-check__rule') || null;
    }
    write(t.get());
  });

  useEffect(() => {
    const target = on ? 1 : 0;
    if (
      reduce ||
      instant.current ||
      document.documentElement.dataset.interaction === 'keyboard' ||
      document.hidden ||
      rowRef.current?.closest('[hidden], [inert]')
    ) {
      instant.current = false;
      t.jump(target);
      return undefined;
    }
    if (t.get() === target && t.getVelocity() === 0) return undefined;
    const controls = animate(t, target, {
      type: 'spring',
      visualDuration: VISUAL_DURATION,
      bounce: 1 - zetaOf(bounce),
    });
    return () => controls.stop();
  }, [on, reduce, bounce, t]);

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 || disabled) return;
    viaPointer.current = true;
    if (!reduce && rowRef.current) rowRef.current.dataset.pressed = '';
  };
  const handlePointerUp = () => {
    if (rowRef.current) delete rowRef.current.dataset.pressed;
  };
  const handlePointerCancel = () => {
    viaPointer.current = false;
    handlePointerUp();
  };
  const toggle = () => {
    if (disabled) return;
    instant.current = !viaPointer.current;
    viaPointer.current = false;
    const next = !on;
    if (!controlled) setInner(next);
    onChange?.(next);
  };

  const r = readings(t.get(), doneOpacity, strikeLag, strike);
  const ring = boxSize >= 24 ? 2 : 1.5;
  const gap = Math.min(16, Math.max(8, Math.round(boxSize * 0.43)));
  const ruleHeight = Math.max(1.5, Math.round(fontSize / 6) / 2);

  const cssVars = {
    '--sc-ink': color,
    '--sc-fill': fillColor,
    '--sc-check': checkColor,
    '--sc-box': `${boxSize}px`,
    '--sc-radius': `${boxRadius}px`,
    '--sc-font': `${fontSize}px`,
    '--sc-ring': `${ring}px`,
    '--sc-gap': `${gap}px`,
    '--sc-row': `${Math.max(44, boxSize + 16)}px`,
    '--sc-rule': `${ruleHeight}px`,
    '--sc-origin': ORIGIN[strike] || ORIGIN.left,
  } as CSSProperties;

  return (
    <button
      ref={rowRef}
      type="button"
      role="checkbox"
      aria-checked={on}
      aria-label={ariaLabel}
      disabled={disabled}
      className={`spring-check${className ? ` ${className}` : ''}`}
      style={cssVars}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onPointerLeave={handlePointerCancel}
      onBlur={handlePointerCancel}
      onClick={toggle}
    >
      <span className="spring-check__press">
        <span ref={boxRef} className="spring-check__box" style={{ transform: r.box }}>
          <span className="spring-check__ring" aria-hidden="true" />
          <span ref={fillRef} className="spring-check__fill" style={{ transform: r.fill }} />
          <svg className="spring-check__tick" viewBox="0 0 24 24" aria-hidden="true">
            <path
              ref={tickRef}
              d={TICK_PATH}
              pathLength={1}
              strokeDasharray={1}
              style={{ strokeDashoffset: r.tick }}
            />
          </svg>
        </span>
      </span>
      {label !== undefined && !labelSelector && (
        <span className="spring-check__label">
          <span ref={wordRef} className="spring-check__word" style={{ opacity: r.word }}>
            {label}
          </span>
          {strike !== 'none' ? (
            <span
              ref={ruleRef}
              className="spring-check__rule"
              aria-hidden="true"
              style={{ clipPath: r.rule }}
              {...strikeCopy(label)}
            />
          ) : null}
        </span>
      )}
    </button>
  );
};

export default SpringCheck;

export function SpringCheckLabel({
  children,
  checked,
  color = 'var(--text)',
  doneOpacity = 0.72,
}: {
  children: ReactNode;
  checked: boolean;
  color?: string;
  doneOpacity?: number;
}) {
  return (
    <span className="spring-check__label" style={{ '--sc-ink': color } as CSSProperties}>
      <span className="spring-check__word" style={{ opacity: checked ? doneOpacity : 1 }}>
        {children}
      </span>
      <span
        className="spring-check__rule"
        aria-hidden="true"
        style={{ clipPath: checked ? 'inset(0 0 0 0)' : 'inset(0 100% 0 0)' }}
        {...strikeCopy(children)}
      />
    </span>
  );
}
