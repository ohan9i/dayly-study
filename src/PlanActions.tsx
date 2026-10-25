import { useEffect, useRef, useState } from 'react';
import { Copy, MoreHorizontal, Pencil, Trash2, ArrowRightLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { addDays } from './domain';

export default function PlanActions({
  title,
  date,
  disabled,
  onAction,
  onDuplicate,
  onDelete,
}: {
  title: string;
  /** The plan's own date; a copy defaults to the day after it. */
  date: string;
  disabled: boolean;
  onAction: (action: 'edit' | 'move') => void;
  onDuplicate: (date: string) => Promise<unknown>;
  onDelete: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  // The menu turns into the date picker in place, so a copy is two taps away.
  const [copying, setCopying] = useState(false);
  const [copyDate, setCopyDate] = useState(() => addDays(date, 1));
  const [copyBusy, setCopyBusy] = useState(false);
  const [copyError, setCopyError] = useState('');
  const close = () => {
    setOpen(false);
    setCopying(false);
    setCopyError('');
  };
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) {
        setOpen(false);
        setCopying(false);
      }
    };
    const cancel = () => {
      setOpen(false);
      setCopying(false);
    };
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
          close();
          root.current?.querySelector('button')?.focus();
        }
        if (copying) return;
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
        onClick={() => (open ? close() : setOpen(true))}
      >
        <MoreHorizontal size={20} />
      </button>
      {open && copying && (
        <form
          className="plan-actions-menu plan-copy-picker"
          aria-label={`${title} 복제`}
          onSubmit={async (event) => {
            event.preventDefault();
            if (copyBusy || disabled || !copyDate) return;
            setCopyBusy(true);
            setCopyError('');
            try {
              await onDuplicate(copyDate);
              close();
            } catch (error) {
              setCopyError((error as Error).message || '복제하지 못했어요. 다시 시도해 주세요.');
            } finally {
              setCopyBusy(false);
            }
          }}
        >
          <label className="field">
            <span>복제할 날짜</span>
            <input
              type="date"
              required
              autoFocus
              value={copyDate}
              disabled={copyBusy}
              onChange={(event) => setCopyDate(event.target.value)}
            />
          </label>
          <p className="plan-copy-note">제목과 세부 항목만 복제해요.</p>
          {copyError && (
            <p className="form-error" role="alert">
              {copyError}
            </p>
          )}
          <div className="plan-copy-actions">
            <Button
              variant="ghost"
              size="sm"
              type="button"
              disabled={copyBusy}
              onClick={() => {
                setCopying(false);
                setCopyError('');
              }}
            >
              취소
            </Button>
            <Button size="sm" type="submit" disabled={copyBusy || disabled || !copyDate}>
              {copyBusy
                ? '복제 중…'
                : copyDate
                  ? `${Number(copyDate.slice(5, 7))}월 ${Number(copyDate.slice(8))}일에 복제`
                  : '복제'}
            </Button>
          </div>
        </form>
      )}
      {open && !copying && (
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
                if (action === 'duplicate') {
                  setCopyDate(addDays(date, 1));
                  setCopying(true);
                  return;
                }
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
