import { useEffect, useRef, useState } from 'react';
import { Copy, MoreHorizontal, Pencil, Trash2, ArrowRightLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function PlanActions({
  title,
  disabled,
  onAction,
  onDelete,
}: {
  title: string;
  disabled: boolean;
  onAction: (action: 'edit' | 'duplicate' | 'move') => void;
  onDelete: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    const cancel = () => setOpen(false);
    document.addEventListener('pointerdown', close);
    window.addEventListener('dayly:cancel-actions', cancel);
    return () => {
      document.removeEventListener('pointerdown', close);
      window.removeEventListener('dayly:cancel-actions', cancel);
    };
  }, []);
  return (
    <div
      ref={root}
      className="plan-actions"
      data-open={open}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          setOpen(false);
          root.current?.querySelector('button')?.focus();
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          if (!open) {
            setOpen(true);
            requestAnimationFrame(() =>
              root.current
                ?.querySelector<HTMLButtonElement>('.plan-actions-menu button:not(:disabled)')
                ?.focus(),
            );
            return;
          }
          const items = Array.from(
            root.current!.querySelectorAll<HTMLButtonElement>(
              '.plan-actions-menu button:not(:disabled)',
            ),
          );
          const index = items.indexOf(document.activeElement as HTMLButtonElement);
          const next =
            index < 0
              ? event.key === 'ArrowDown'
                ? 0
                : items.length - 1
              : (index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
          items[next]?.focus();
        }
      }}
    >
      <button
        type="button"
        className="plan-actions-trigger"
        aria-label={`${title} 추가 작업`}
        title="계획 관리"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <MoreHorizontal size={20} />
      </button>
      {open && (
        <div className="plan-actions-menu" aria-label={`${title} 관리`}>
          {(
            [
              ['edit', '계획 상세', Pencil],
              ['duplicate', '복제', Copy],
              ['move', '다른 공간으로 이동', ArrowRightLeft],
            ] as const
          ).map(([action, label, Icon]) => (
            <Button
              key={action}
              variant="ghost"
              disabled={action !== 'edit' && disabled}
              onClick={() => {
                setOpen(false);
                onAction(action);
              }}
            >
              <Icon size={16} />
              {label}
            </Button>
          ))}
          <Button
            variant="ghost"
            className="danger-text"
            disabled={disabled}
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
          >
            <Trash2 size={16} />
            휴지통으로 이동
          </Button>
        </div>
      )}
    </div>
  );
}
