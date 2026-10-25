import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  addDays,
  formatDate,
  isTaskComplete,
  sortedTasks,
  taskProgress,
  type Task,
} from './domain';
import type { Planner } from './planner';

const monthDay = (date: string) => `${Number(date.slice(5, 7))}월 ${Number(date.slice(8))}일`;

/**
 * Brings plans from another day to the day being viewed. A plan moves with its
 * checks, records and files; only its date changes.
 */
export default function BringPlans({
  planner,
  date,
  canMove,
  onDone,
  onCancel,
}: {
  planner: Planner;
  /** The day the plans are brought to. */
  date: string;
  canMove: (task: Task) => boolean;
  onDone: (count: number) => void;
  onCancel: () => void;
}) {
  const completed = useMemo(
    () => new Set(planner.data.completedTaskIds),
    [planner.data.completedTaskIds],
  );
  // Days that still have something left, latest first: usually where a plan comes from.
  const unfinishedDays = useMemo(() => {
    const days = new Set<string>();
    for (const task of planner.data.tasks)
      if (task.date !== date && !isTaskComplete(task, completed)) days.add(task.date);
    return [...days].sort().reverse();
  }, [planner.data.tasks, completed, date]);
  const [source, setSource] = useState(
    () => unfinishedDays.find((day) => day < date) || unfinishedDays[0] || addDays(date, -1),
  );
  const plans = useMemo(
    () => sortedTasks(planner.data.tasks.filter((task) => task.date === source)),
    [planner.data.tasks, source],
  );
  const pickable = (task: Task) => canMove(task);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [pickedFor, setPickedFor] = useState('');
  // Unfinished plans are picked when a day is opened; finished ones stay where they are.
  if (pickedFor !== source) {
    setPickedFor(source);
    setPicked(
      new Set(
        plans
          .filter((task) => pickable(task) && !isTaskComplete(task, completed))
          .map((task) => task.id),
      ),
    );
  }
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const chosen = plans.filter((task) => picked.has(task.id) && pickable(task));
  const disabled = working || planner.busy || !planner.canWrite;
  return (
    <form
      className="bring-plans"
      aria-label="다른 날짜에서 계획 가져오기"
      onSubmit={async (event) => {
        event.preventDefault();
        if (disabled || !chosen.length) return;
        setWorking(true);
        setError('');
        try {
          const count = await planner.moveTasksToDate(
            chosen.map((task) => task.id),
            date,
          );
          onDone(count);
        } catch (e) {
          setError((e as Error).message || '가져오지 못했어요. 다시 시도해 주세요.');
        } finally {
          setWorking(false);
        }
      }}
    >
      <label className="field">
        <span>가져올 날짜</span>
        <input
          type="date"
          required
          value={source}
          disabled={working}
          onChange={(event) => {
            if (event.target.value) setSource(event.target.value);
          }}
        />
      </label>
      {unfinishedDays.length > 0 && (
        <div className="bring-days" role="group" aria-label="남은 계획이 있는 날">
          {unfinishedDays.slice(0, 6).map((day) => (
            <button
              key={day}
              type="button"
              className="bring-day"
              aria-pressed={day === source}
              disabled={working}
              onClick={() => setSource(day)}
            >
              {monthDay(day)}
            </button>
          ))}
        </div>
      )}
      {source === date ? (
        <p className="bring-empty">지금 보고 있는 날짜예요. 다른 날짜를 골라 주세요.</p>
      ) : plans.length === 0 ? (
        <p className="bring-empty">{formatDate(source)}에는 계획이 없어요.</p>
      ) : (
        <ul className="bring-list" aria-label={`${formatDate(source)} 계획`}>
          {plans.map((task) => {
            const progress = taskProgress(task, completed);
            const allowed = pickable(task);
            return (
              <li key={task.id}>
                <label className={allowed ? undefined : 'is-locked'}>
                  <input
                    type="checkbox"
                    checked={allowed && picked.has(task.id)}
                    disabled={!allowed || working}
                    onChange={(event) =>
                      setPicked((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(task.id);
                        else next.delete(task.id);
                        return next;
                      })
                    }
                  />
                  <span className="bring-title">{task.title}</span>
                  <span className="bring-meta">
                    {!allowed
                      ? '작성자만 옮길 수 있어요'
                      : isTaskComplete(task, completed)
                        ? '완료'
                        : `${progress.done}/${progress.total}`}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
      <p className="bring-note">
        고른 계획을 {monthDay(date)}로 옮겨요. 체크한 항목과 기록, 첨부는 그대로 함께 옮겨져요.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="quick-add-actions">
        <Button variant="ghost" type="button" disabled={working} onClick={onCancel}>
          취소
        </Button>
        <Button type="submit" disabled={disabled || !chosen.length || source === date}>
          {working
            ? '가져오는 중…'
            : chosen.length
              ? `${chosen.length}개를 ${monthDay(date)}로 가져오기`
              : '가져올 계획을 골라 주세요'}
        </Button>
      </div>
    </form>
  );
}
