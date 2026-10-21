import { useEffect, useRef } from 'react';
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
  const root = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) root.current.open = false;
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);
  return (
    <details
      ref={root}
      className="plan-actions"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          root.current!.open = false;
          root.current?.querySelector('summary')?.focus();
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          root.current!.open = true;
          const items = Array.from(
            root.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
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
      onToggle={(event) => {
        if (event.currentTarget.open)
          document.querySelectorAll<HTMLDetailsElement>('.plan-actions[open]').forEach((other) => {
            if (other !== root.current) other.open = false;
          });
      }}
    >
      <summary aria-label={`${title} 추가 작업`} title="계획 관리">
        <MoreHorizontal size={20} />
      </summary>
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
              root.current!.open = false;
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
            root.current!.open = false;
            onDelete();
          }}
        >
          <Trash2 size={16} />
          휴지통으로 이동
        </Button>
      </div>
    </details>
  );
}
