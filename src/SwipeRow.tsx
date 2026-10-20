import { useEffect, useId, useRef, type ReactNode, type PointerEvent } from 'react';
import { animate, motion, useMotionValue } from 'motion/react';
import { Plus, Trash2 } from 'lucide-react';
import HoldButton from './HoldButton';
import './SwipeRow.css';

type Side = 'add' | 'delete' | null;

/** A natural-height row: swiping reveals actions without committing a change. */
export default function SwipeRow({
  children,
  title,
  open,
  onOpenChange,
  onAdd,
  onDelete,
  disabled,
  contentClassName = '',
  addLabel,
  deleteLabel,
}: {
  children: ReactNode;
  title: string;
  open: Side;
  onOpenChange: (side: Side) => void;
  onAdd: () => void;
  onDelete: () => void;
  disabled: boolean;
  contentClassName?: string;
  addLabel?: string;
  deleteLabel?: string;
}) {
  const x = useMotionValue(0);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const grip = useRef<{
    id: number;
    startX: number;
    startY: number;
    origin: number;
    dragging: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  const change = useRef(onOpenChange);
  change.current = onOpenChange;
  const width = 100;
  const settle = (target: number) => {
    x.stop();
    if (
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      document.documentElement.dataset.interaction === 'keyboard'
    )
      x.set(target);
    else animate(x, target, { type: 'spring', stiffness: 430, damping: 36 });
  };
  const releaseCapture = () => {
    const current = grip.current;
    grip.current = null;
    if (root.current) delete root.current.dataset.dragging;
    if (current && surface.current?.hasPointerCapture(current.id))
      surface.current.releasePointerCapture(current.id);
  };
  useEffect(() => {
    settle(disabled ? 0 : open === 'add' ? width : open === 'delete' ? -width : 0);
    if (disabled) releaseCapture();
    if (open && !disabled && document.documentElement.dataset.interaction === 'keyboard') {
      root.current?.querySelector<HTMLButtonElement>(`.swipe-row__rail--${open} button`)?.focus();
    }
  }, [open, disabled]); // Motion values update outside React's render loop.
  useEffect(() => {
    const cancel = () => {
      releaseCapture();
      change.current(null);
      settle(0);
    };
    window.addEventListener('blur', cancel);
    return () => {
      window.removeEventListener('blur', cancel);
      releaseCapture();
      x.stop();
    };
  }, [x]);
  const down = (event: PointerEvent<HTMLDivElement>) => {
    suppressClick.current = false;
    if (
      disabled ||
      !event.isPrimary ||
      event.button !== 0 ||
      (event.target as Element).closest('.swipe-row') !== root.current ||
      (event.target as HTMLElement).closest('input, textarea, select, [contenteditable]')
    )
      return;
    grip.current = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: x.get(),
      dragging: false,
    };
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const current = grip.current;
    if (!current || current.id !== event.pointerId) return;
    const dx = event.clientX - current.startX,
      dy = event.clientY - current.startY;
    if (!current.dragging) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
        suppressClick.current = true;
        releaseCapture();
        return;
      }
      if (Math.abs(dx) < 10 || Math.abs(dx) <= Math.abs(dy)) return;
      current.dragging = true;
      if (root.current) root.current.dataset.dragging = 'true';
      x.stop();
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    const next = current.origin + dx;
    x.set(
      Math.abs(next) <= width
        ? next
        : Math.sign(next) * (width + Math.min(30, (Math.abs(next) - width) * 0.3)),
    );
  };
  const up = (event: PointerEvent<HTMLDivElement>) => {
    const current = grip.current;
    if (!current || current.id !== event.pointerId) return;
    const dragged = current.dragging;
    releaseCapture();
    if (!dragged) return;
    suppressClick.current = true;
    const side = Math.abs(x.get()) > width * 0.38 ? (x.get() > 0 ? 'add' : 'delete') : null;
    onOpenChange(side);
    settle(side === 'add' ? width : side === 'delete' ? -width : 0);
  };
  return (
    <div
      ref={root}
      className="swipe-row"
      data-open={open || 'closed'}
      role="group"
      aria-label={`${title} 작업 메뉴`}
      aria-description="왼쪽으로 밀면 삭제, 오른쪽으로 밀면 추가. 키보드에서는 왼쪽·오른쪽 화살표로 열고 Escape로 닫습니다."
      tabIndex={disabled ? undefined : 0}
      onKeyDown={(event) => {
        if (
          !disabled &&
          event.target === event.currentTarget &&
          (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
        ) {
          event.preventDefault();
          event.stopPropagation();
          onOpenChange(event.key === 'ArrowLeft' ? 'delete' : 'add');
        }
        if (event.key === 'Escape' && open) {
          event.preventDefault();
          event.stopPropagation();
          onOpenChange(null);
          settle(0);
          root.current?.focus({ preventScroll: true });
        }
      }}
    >
      <div
        id={`${id}-add`}
        className="swipe-row__rail swipe-row__rail--add"
        inert={disabled || open !== 'add'}
        aria-hidden={disabled || open !== 'add'}
      >
        <button
          type="button"
          aria-label={addLabel || `${title} 옆에 계획 추가`}
          onClick={onAdd}
          disabled={disabled}
        >
          <Plus size={22} aria-hidden="true" />
          추가
        </button>
      </div>
      <div
        id={`${id}-delete`}
        className="swipe-row__rail swipe-row__rail--delete"
        inert={disabled || open !== 'delete'}
        aria-hidden={disabled || open !== 'delete'}
      >
        <HoldButton
          aria-label={deleteLabel || `${title} 휴지통으로`}
          title="2초 눌러 삭제 확인"
          disabled={disabled || open !== 'delete'}
          backgroundColor="#a63339"
          radius={12}
          doneLabel="삭제 확인"
          icon={<Trash2 size={18} aria-hidden="true" />}
          onHold={onDelete}
        >
          2초 · 삭제
        </HoldButton>
      </div>
      <motion.div
        ref={surface}
        className={`swipe-row__surface ${contentClassName}`}
        style={{ x }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={() => {
          releaseCapture();
          onOpenChange(null);
          settle(0);
        }}
        onLostPointerCapture={(event) => {
          // Touch starts with implicit capture on the child. Its release bubbles
          // when this surface takes over; only losing our own capture cancels.
          if (event.target === event.currentTarget && grip.current) {
            releaseCapture();
            onOpenChange(null);
            settle(0);
          }
        }}
        onClickCapture={(event) => {
          if (suppressClick.current) {
            suppressClick.current = false;
            event.preventDefault();
            event.stopPropagation();
          }
        }}
      >
        {children}
      </motion.div>
    </div>
  );
}
