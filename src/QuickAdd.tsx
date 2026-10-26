import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { formatDate } from './domain';
import type { Planner } from './planner';

/**
 * The small editor a swipe opens: one line, saved with Enter. A new plan lands on
 * the date being viewed; a new detail lands right below the row that was swiped.
 */
export default function QuickAdd({
  planner,
  date,
  taskId,
  afterDetailId,
  onDone,
  onCancel,
}: {
  planner: Planner;
  date: string;
  /** Set when a detail row or a plan's row asked for a new detail. */
  taskId?: string;
  afterDetailId?: string;
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  // The dialog moves focus to its first control when it opens; take it back after.
  useEffect(() => {
    const frame = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);
  const [text, setText] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const addingDetail = Boolean(taskId);
  const task = taskId ? planner.data.tasks.find((item) => item.id === taskId) : undefined;
  const disabled = working || planner.busy || !planner.canWrite;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = text.trim();
    if (!value) {
      setError(addingDetail ? '세부 항목을 적어 주세요.' : '할 일을 적어 주세요.');
      return;
    }
    if (disabled) return;
    setWorking(true);
    setError('');
    try {
      if (addingDetail) {
        // The latest copy, so a check made by someone else meanwhile is kept.
        const live = task;
        if (!live) throw new Error('이 계획이 이동되거나 삭제되었어요. 목록을 다시 확인해 주세요.');
        const checks = live.detailChecks || [];
        const found = checks.findIndex((check) => check.id === afterDetailId);
        const at = found < 0 ? live.details.length : found + 1;
        await planner.saveTask(
          {
            ...live,
            details: [...live.details.slice(0, at), value, ...live.details.slice(at)],
            detailChecks: [
              ...checks.slice(0, at),
              { id: crypto.randomUUID(), completed: false },
              ...checks.slice(at),
            ],
          },
          true,
        );
        onDone('세부 항목을 추가했어요.');
      } else {
        await planner.saveTask(
          {
            id: crypto.randomUUID(),
            title: value,
            date,
            details: [],
            detailChecks: [],
            completed: false,
            created_by: planner.session?.user.id || 'local',
            workspace_id: planner.workspace?.id,
          },
          false,
        );
        onDone('할 일을 추가했어요.');
      }
    } catch (e) {
      setError((e as Error).message || '저장하지 못했어요. 다시 시도해 주세요.');
    } finally {
      setWorking(false);
    }
  }
  return (
    <form className="quick-add" onSubmit={submit}>
      <label className="field">
        <span>
          {addingDetail
            ? `“${task?.title || '삭제된 계획'}”의 세부 항목`
            : `${formatDate(date)} 할 일`}
        </span>
        <input
          ref={input}
          value={text}
          maxLength={addingDetail ? 10000 : 150}
          placeholder={addingDetail ? '예: 예제 3-2 다시 풀기' : '예: 구조 역학 3장 연습문제 풀기'}
          disabled={working}
          onChange={(event) => {
            setText(event.target.value);
            if (error) setError('');
          }}
        />
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="quick-add-actions">
        <Button variant="ghost" type="button" disabled={working} onClick={onCancel}>
          취소
        </Button>
        <Button type="submit" disabled={disabled || !text.trim()}>
          {working ? '저장 중…' : '추가'}
        </Button>
      </div>
    </form>
  );
}
