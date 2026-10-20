// Adapted from React Bits / David Haz, HoldButton.
// https://github.com/DavidHDev/react-bits — license: docs/licenses/ReactBits-LICENSE.md
'use client';

import React, {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';

import './HoldButton.css';
import { Button } from '@/components/ui/button';

export type HoldButtonSize = 'sm' | 'md' | 'lg';
export type HoldButtonDirection = 'right' | 'up';

export interface HoldButtonProps extends Pick<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-label' | 'aria-pressed' | 'aria-describedby' | 'title' | 'id' | 'tabIndex'
> {
  children?: ReactNode;
  doneLabel?: ReactNode;
  icon?: ReactNode;
  doneIcon?: ReactNode;
  backgroundColor?: string;
  fillColor?: string;
  textColor?: string;
  fillTextColor?: string;
  size?: HoldButtonSize;
  radius?: number;
  fillDirection?: HoldButtonDirection;
  holdTime?: number;
  releaseTime?: number;
  pressScale?: number;
  wave?: boolean;
  waveAmplitude?: number;
  glow?: boolean;
  resetAfter?: number;
  disabled?: boolean;
  onHold?: () => void;
  onTap?: () => void;
  className?: string;
}

type Phase = 'idle' | 'holding' | 'done';
type Input = 'pointer' | 'key' | null;

interface Motion {
  raf: number;
  p: number;
  from: number;
  to: number;
  start: number;
}

interface Gesture {
  pointerId: number | null;
  start: number;
  rect: DOMRect | null;
}

interface ReleaseOptions {
  drifted?: boolean;
}

const TAP_MS = 250;
const HIT_PAD = 10;
const LINEAR = (t: number) => t;
const EASE_OUT = (t: number) => 1 - Math.pow(1 - t, 3);

const HoldButton: React.FC<HoldButtonProps> = ({
  children = 'Hold to delete',
  doneLabel = 'Deleted',
  icon = null,
  doneIcon = null,
  backgroundColor = 'var(--surface-solid)',
  fillColor = 'var(--accent-solid)',
  textColor = 'var(--text)',
  fillTextColor = 'var(--on-accent)',
  size = 'md',
  radius = 6,
  fillDirection = 'right',
  holdTime = 2000,
  releaseTime = 200,
  pressScale = 0.97,
  wave = false,
  waveAmplitude = 6,
  glow = false,
  resetAfter = 1200,
  disabled = false,
  onHold,
  onTap,
  className = '',
  ...buttonProps
}) => {
  const [phase, setPhase] = useState<Phase>('idle');
  const [input, setInput] = useState<Input>(null);
  const phaseRef = useRef<Phase>('idle');
  const inputRef = useRef<Input>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const gesture = useRef<Gesture>({ pointerId: null, start: 0, rect: null });
  const timers = useRef({ complete: 0, reset: 0 });
  const hintId = useId();
  const current = useRef({ disabled, onHold, onTap });
  current.current = { disabled, onHold, onTap };

  const go = (next: Phase, kind: Input = null) => {
    phaseRef.current = next;
    inputRef.current = kind;
    setPhase(next);
    setInput(kind);
  };

  const clearTimers = () => {
    clearTimeout(timers.current.complete);
    clearTimeout(timers.current.reset);
  };

  const motion = useRef<Motion>({ raf: 0, p: 0, from: 0, to: 0, start: 0 });
  const drive = (to: number, duration: number, ease: (t: number) => number) => {
    const m = motion.current;
    cancelAnimationFrame(m.raf);
    m.from = m.p;
    m.to = to;
    m.start = performance.now();
    const step = (now: number) => {
      const t = duration > 0 ? Math.min(1, (now - m.start) / duration) : 1;
      m.p = m.from + (m.to - m.from) * ease(t);
      buttonRef.current?.style.setProperty('--hb-p', m.p.toFixed(4));
      if (t < 1) {
        m.raf = requestAnimationFrame(step);
        return;
      }
      m.raf = 0;
      if (m.to === 1) complete();
    };
    m.raf = requestAnimationFrame(step);
  };

  const complete = (accessible = false) => {
    if (!accessible && phaseRef.current !== 'holding') return;
    if (!accessible && performance.now() - gesture.current.start < holdTime) return;
    if (
      current.current.disabled ||
      document.hidden ||
      !buttonRef.current?.isConnected ||
      buttonRef.current.closest('[hidden], [inert]')
    ) {
      releaseRef.current({ drifted: true });
      return;
    }
    clearTimers();
    cancelAnimationFrame(motion.current.raf);
    motion.current.raf = 0;
    motion.current.p = 1;
    buttonRef.current.style.setProperty('--hb-p', '1');
    go('done', inputRef.current);
    current.current.onHold?.();
    if (resetAfter > 0) {
      timers.current.reset = window.setTimeout(() => {
        go('idle');
        drive(0, releaseTime, EASE_OUT);
      }, resetAfter);
    }
  };

  const begin = (kind: Input) => {
    if (disabled || phaseRef.current !== 'idle') return false;
    const button = buttonRef.current;
    if (!button) return false;
    gesture.current.start = performance.now();
    gesture.current.rect = button.getBoundingClientRect();
    go('holding', kind);
    drive(1, holdTime, LINEAR);
    timers.current.complete = window.setTimeout(() => complete(), holdTime + 100);
    return true;
  };

  const release = ({ drifted = false }: ReleaseOptions = {}) => {
    if (phaseRef.current !== 'holding') return;
    // A busy frame must not discard a genuinely completed physical hold.
    if (!drifted && performance.now() - gesture.current.start >= holdTime) {
      complete();
      return;
    }
    clearTimers();
    const held = performance.now() - gesture.current.start;
    go('idle');
    drive(0, releaseTime, EASE_OUT);
    if (!drifted && held < TAP_MS) current.current.onTap?.();
  };
  const releaseRef = useRef(release);
  releaseRef.current = release;

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 || !e.isPrimary || gesture.current.pointerId !== null) return;
    if (!begin('pointer')) return;
    gesture.current.pointerId = e.pointerId;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
  };

  const endPointer = (e: React.PointerEvent<HTMLButtonElement>, options?: ReleaseOptions) => {
    if (e.pointerId !== gesture.current.pointerId) return;
    gesture.current.pointerId = null;
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId))
        e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
    release(options);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerId !== gesture.current.pointerId) return;
    const r = gesture.current.rect;
    if (!r) return;
    const out =
      e.clientX < r.left - HIT_PAD ||
      e.clientX > r.right + HIT_PAD ||
      e.clientY < r.top - HIT_PAD ||
      e.clientY > r.bottom + HIT_PAD;
    if (out) endPointer(e, { drifted: true });
  };

  const handlePointerLeave = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType !== 'touch') endPointer(e, { drifted: true });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Escape') {
      release({ drifted: true });
      return;
    }
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (!e.repeat) begin('key');
    }
  };

  const handleKeyUp = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (inputRef.current === 'key') release();
    }
  };

  useLayoutEffect(() => {
    const button = buttonRef.current;
    if (!button) return undefined;
    const measure = () => {
      button.style.setProperty('--hb-w', `${button.offsetWidth}px`);
      button.style.setProperty('--hb-h', `${button.offsetHeight}px`);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(button);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (phase !== 'holding') return undefined;
    const cancel = () => releaseRef.current({ drifted: true });
    const onVisibility = () => {
      if (document.hidden) cancel();
    };
    window.addEventListener('blur', cancel);
    window.addEventListener('scroll', cancel, true);
    window.addEventListener('resize', cancel);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('blur', cancel);
      window.removeEventListener('scroll', cancel, true);
      window.removeEventListener('resize', cancel);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [phase]);

  useEffect(() => {
    if (disabled) releaseRef.current({ drifted: true });
  }, [disabled]);

  useEffect(() => {
    const t = timers.current;
    const m = motion.current;
    return () => {
      clearTimeout(t.complete);
      clearTimeout(t.reset);
      cancelAnimationFrame(m.raf);
    };
  }, []);

  const direction: HoldButtonDirection = fillDirection === 'up' ? 'up' : 'right';
  const labels = (
    <>
      <span className="hold-button__idle" aria-hidden={phase === 'done'}>
        {icon ? <span className="hold-button__icon">{icon}</span> : null}
        {children}
      </span>
      <span className="hold-button__done" aria-hidden={phase !== 'done'}>
        {doneIcon ? <span className="hold-button__icon">{doneIcon}</span> : null}
        {doneLabel}
      </span>
    </>
  );

  const cssVars = {
    '--hb-radius': `${radius}px`,
    '--hb-bg': backgroundColor,
    '--hb-fill': fillColor,
    '--hb-text': textColor,
    '--hb-fill-text': fillTextColor,
    '--hb-hold': `${holdTime}ms`,
    '--hb-cycles': holdTime / 1100,
    '--hb-release': `${releaseTime}ms`,
    '--hb-press': pressScale,
    '--hb-wave': `${wave ? waveAmplitude : 0}px`,
  } as CSSProperties;

  return (
    <Button
      variant="outline"
      {...buttonProps}
      ref={buttonRef}
      type="button"
      disabled={disabled}
      className={`hold-button hold-button--${size}${className ? ` ${className}` : ''}`}
      data-phase={phase}
      data-input={input ?? undefined}
      data-direction={direction}
      data-glow={glow ? 'true' : undefined}
      aria-describedby={[hintId, buttonProps['aria-describedby']].filter(Boolean).join(' ')}
      style={cssVars}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={(e) => endPointer(e)}
      onPointerCancel={(e) => endPointer(e, { drifted: true })}
      onLostPointerCapture={(e) => endPointer(e, { drifted: true })}
      onPointerLeave={handlePointerLeave}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      onBlur={() => release({ drifted: true })}
      onClick={(e) => {
        // Screen readers and switch controls synthesize click without a physical
        // key/pointer hold. Preserve an activation path; deletion still confirms.
        if (e.detail === 0 && phaseRef.current === 'idle') complete(true);
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span className="hold-button__pulse" aria-hidden="true" />
      <span className="hold-button__label">{labels}</span>
      <span className="hold-button__clip" aria-hidden="true">
        <span className="hold-button__fill">
          <span className="hold-button__label hold-button__label--fill">{labels}</span>
        </span>
        <span className="hold-button__crest" aria-hidden="true">
          <span className="hold-button__label hold-button__label--fill">{labels}</span>
        </span>
      </span>
      <span id={hintId} className="hold-button__sr">
        {Math.round(holdTime / 100) / 10}초 동안 길게 눌러 실행합니다. 손을 떼거나 Escape를 누르면
        취소합니다.
      </span>
      <span className="hold-button__sr" aria-live="polite" aria-atomic="true">
        {phase === 'done' ? doneLabel : ''}
      </span>
    </Button>
  );
};

export default HoldButton;
