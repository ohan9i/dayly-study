import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import './SwipeAction.css';

type Side = 'add' | 'delete';
type Phase = 'idle' | 'dragging' | 'settling' | 'waiting' | 'working';

/** Finish the swipe, wait one second, then execute. Returning or cancelling aborts it. */
export default function SwipeAction({
  children,
  title,
  scope,
  disabled,
  onAdd,
  onDelete,
  contentClassName = '',
}: {
  children: ReactNode;
  title: string;
  scope: string;
  disabled: boolean;
  onAdd: () => void | Promise<void>;
  onDelete: () => void | Promise<void>;
  contentClassName?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const latest = useRef({ disabled, onAdd, onDelete });
  latest.current = { disabled, onAdd, onDelete };
  const alive = useRef(true);
  const grip = useRef<{ id: number; x: number; y: number; dragging: boolean } | null>(null);
  const distance = useRef(0);
  const phaseRef = useRef<Phase>('idle');
  const [phase, setPhase] = useState<Phase>('idle');
  const [side, setSide] = useState<Side>('add');
  const sideRef = useRef<Side>('add');
  const timer = useRef(0),
    generation = useRef(0);
  const animation = useRef<Animation | null>(null);
  const suppressClick = useRef(false);
  const changePhase = (next: Phase) => {
    phaseRef.current = next;
    if (alive.current) setPhase(next);
  };
  const paint = (value: number) => {
    distance.current = value;
    if (surface.current) surface.current.style.transform = `translate3d(${value}px, 0, 0)`;
    const nextSide = value < 0 ? 'delete' : 'add';
    if (root.current) root.current.dataset.side = nextSide;
    if (sideRef.current !== nextSide) {
      sideRef.current = nextSide;
      if (alive.current) setSide(nextSide);
    }
  };
  const clear = () => {
    generation.current++;
    window.clearTimeout(timer.current);
    animation.current?.cancel();
    animation.current = null;
  };
  const reset = () => {
    clear();
    grip.current = null;
    paint(0);
    changePhase('idle');
  };
  const arm = (next: Side) => {
    if (latest.current.disabled || ['settling', 'waiting', 'working'].includes(phaseRef.current))
      return;
    clear();
    const token = generation.current;
    suppressClick.current = true;
    setSide(next);
    changePhase('settling');
    root.current?.focus({ preventScroll: true });
    const target = (root.current?.clientWidth || 1) * (next === 'add' ? 1 : -1);
    const begin = () => {
      if (generation.current !== token || latest.current.disabled || !alive.current) return;
      paint(target);
      animation.current?.cancel();
      animation.current = null;
      changePhase('waiting');
      timer.current = window.setTimeout(async () => {
        if (generation.current !== token || latest.current.disabled || !alive.current) return;
        changePhase('working');
        try {
          await (next === 'add' ? latest.current.onAdd() : latest.current.onDelete());
        } finally {
          if (alive.current && generation.current === token) reset();
        }
      }, 1000);
    };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) begin();
    else {
      const move = surface.current!.animate(
        [
          { transform: `translate3d(${distance.current}px,0,0)` },
          { transform: `translate3d(${target}px,0,0)` },
        ],
        { duration: 140, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' },
      );
      animation.current = move;
      void move.finished.then(begin, () => {});
    }
  };
  useEffect(() => {
    if (phaseRef.current !== 'working') reset();
  }, [scope, disabled]);
  useEffect(() => {
    alive.current = true;
    const outside = (event: Event) => {
      if (
        root.current &&
        !root.current.contains(event.target as Node) &&
        phaseRef.current !== 'working'
      )
        reset();
    };
    const cancel = () => {
      if (phaseRef.current !== 'working') reset();
    };
    const visibility = () => {
      if (document.hidden) cancel();
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('focusin', outside);
    window.addEventListener('blur', cancel);
    window.addEventListener('scroll', cancel, true);
    window.addEventListener('dayly:cancel-actions', cancel);
    document.addEventListener('visibilitychange', visibility);
    const resize = new ResizeObserver(cancel);
    if (root.current) resize.observe(root.current);
    return () => {
      alive.current = false;
      clear();
      resize.disconnect();
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('focusin', outside);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('scroll', cancel, true);
      window.removeEventListener('dayly:cancel-actions', cancel);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
  const down = (event: PointerEvent<HTMLDivElement>) => {
    suppressClick.current = false;
    if (
      latest.current.disabled ||
      phaseRef.current !== 'idle' ||
      !event.isPrimary ||
      event.button !== 0 ||
      (event.target as Element).closest(
        'input,textarea,select,a,summary,[contenteditable],button:not(.task-title):not(.detail-record-toggle):not(.detail-checkbox)',
      )
    )
      return;
    grip.current = { id: event.pointerId, x: event.clientX, y: event.clientY, dragging: false };
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const current = grip.current;
    if (!current || current.id !== event.pointerId) return;
    const dx = event.clientX - current.x,
      dy = event.clientY - current.y;
    if (phaseRef.current === 'waiting' || phaseRef.current === 'settling') {
      if (Math.abs(dx) < (root.current?.clientWidth || 1) * 0.55) {
        clear();
        changePhase('dragging');
      } else return;
    }
    if (!current.dragging) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
        grip.current = null;
        suppressClick.current = true;
        return;
      }
      if (Math.abs(dx) < 12 || Math.abs(dx) <= Math.abs(dy)) return;
      current.dragging = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      changePhase('dragging');
    }
    const width = root.current?.clientWidth || 1;
    paint(Math.max(-width, Math.min(width, dx)));
    if (Math.abs(dx) >= width - 4) arm(dx > 0 ? 'add' : 'delete');
  };
  const up = (event: PointerEvent<HTMLDivElement>) => {
    const current = grip.current;
    if (!current || current.id !== event.pointerId) return;
    grip.current = null;
    if (!current.dragging) return;
    suppressClick.current = true;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (['waiting', 'settling', 'working'].includes(phaseRef.current)) return;
    if (Math.abs(distance.current) >= (root.current?.clientWidth || 1) * 0.9)
      arm(distance.current > 0 ? 'add' : 'delete');
    else reset();
  };
  return (
    <div
      ref={root}
      className="swipe-action"
      data-phase={phase}
      data-swipe-title={title}
      role="group"
      aria-label={`${title} 밀기 작업`}
      aria-description={
        disabled
          ? '밀기 작업은 편집 권한이 필요합니다. 제목과 기록은 열 수 있습니다.'
          : '오른쪽으로 끝까지 밀면 추가, 왼쪽은 삭제합니다. 완전히 열린 뒤 1초 후 실행합니다. Escape나 취소로 멈출 수 있습니다. 키보드는 오른쪽과 왼쪽 화살표를 사용합니다.'
      }
      tabIndex={disabled ? undefined : 0}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && phaseRef.current !== 'working') {
          event.preventDefault();
          event.stopPropagation();
          reset();
        }
        if (
          event.target === event.currentTarget &&
          !event.repeat &&
          !disabled &&
          (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
        ) {
          event.preventDefault();
          event.stopPropagation();
          arm(event.key === 'ArrowRight' ? 'add' : 'delete');
        }
      }}
      onClickCapture={(event) => {
        if (suppressClick.current && (event.target as Element).closest('.swipe-action__content')) {
          suppressClick.current = false;
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      <div className="swipe-action__rail" aria-hidden={phase === 'idle' || phase === 'dragging'}>
        <span className="swipe-action__copy">
          {side === 'add' ? <Plus size={18} /> : <Trash2 size={18} />}
          {phase === 'working'
            ? '처리 중…'
            : phase === 'waiting'
              ? `1초 후 ${side === 'add' ? '추가' : '삭제'}`
              : '끝까지 밀어 주세요'}
        </span>
        {phase === 'waiting' && (
          <button
            type="button"
            className="swipe-action__cancel"
            aria-label={`${title} 밀기 취소`}
            onClick={reset}
          >
            <X size={16} />
            취소
          </button>
        )}
        {phase === 'waiting' && <span className="swipe-action__countdown" />}
      </div>
      <div
        ref={surface}
        className={`swipe-action__content ${contentClassName}`}
        inert={phase === 'waiting' || phase === 'working'}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={() => {
          suppressClick.current = true;
          reset();
        }}
        onLostPointerCapture={(event) => {
          if (event.target === event.currentTarget && grip.current?.dragging) reset();
        }}
      >
        {children}
      </div>
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {phase === 'waiting'
          ? `1초 후 ${side === 'add' ? '추가' : '삭제'}합니다. 취소할 수 있어요.`
          : ''}
      </span>
    </div>
  );
}
