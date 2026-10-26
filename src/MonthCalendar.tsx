import { useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  addDays,
  dateObject,
  isTaskComplete,
  planDays,
  shiftMonth,
  type Snapshot,
  type Task,
} from './domain';
import './MonthCalendar.css';

const RING = 2 * Math.PI * 18.5;
const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
const longDate = (date: string) =>
  new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'UTC',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(dateObject(date));

export default function MonthCalendar({
  data,
  month,
  date,
  today,
  tasks,
  completed,
  onMonth,
  onSelect,
  onOpen,
}: {
  data: Snapshot;
  month: string;
  date: string;
  today: string;
  // The selected day's plans, already in the order the planner shows them.
  tasks: Task[];
  completed: ReadonlySet<string>;
  onMonth: (month: string) => void;
  onSelect: (date: string) => void;
  onOpen: (date: string) => void;
}) {
  const days = useMemo(() => planDays(data), [data]);
  const first = addDays(month, -dateObject(month).getUTCDay());

  return (
    <section className="glass-card calendar-card">
      <div className="month-calendar">
        <div className="month-main">
          <div className="card-header">
            <h2>
              {month.slice(0, 4)}년 {Number(month.slice(5, 7))}월
            </h2>
            <div className="row-actions">
              <button
                className="icon-button"
                aria-label="이전 달"
                onClick={() => onMonth(shiftMonth(month, -1))}
              >
                <ChevronLeft size={20} />
              </button>
              <button
                className="icon-button"
                aria-label="다음 달"
                onClick={() => onMonth(shiftMonth(month, 1))}
              >
                <ChevronRight size={20} />
              </button>
            </div>
          </div>
          <div className="month-weekdays" aria-hidden="true">
            {weekdays.map((x) => (
              <span key={x}>{x}</span>
            ))}
          </div>
          <div className="month-grid">
            {Array.from({ length: 42 }, (_, i) => {
              const value = addDays(first, i),
                record = days.get(value),
                total = record?.total || 0,
                done = record?.done || 0,
                // Days that have started show their result; days ahead only show that plans exist.
                started = value <= today || done > 0,
                state = !total
                  ? 'is-empty'
                  : started && done === total
                    ? 'is-complete-day'
                    : started
                      ? 'is-partial-day'
                      : 'is-planned-day';
              return (
                <button
                  key={value}
                  type="button"
                  className={`calendar-day ${state}${value.slice(0, 7) !== month.slice(0, 7) ? ' outside-month' : ''}${value === today ? ' is-today' : ''}${value === date ? ' selected-day' : ''}`}
                  aria-label={`${longDate(value)}, ${total ? `계획 ${total}개 중 ${done}개 완료` : '계획 없음'}`}
                  aria-pressed={value === date}
                  onClick={() => {
                    // A second tap on the selected day opens it.
                    if (value === date) return onOpen(value);
                    onSelect(value);
                    if (value.slice(0, 7) !== month.slice(0, 7)) onMonth(value.slice(0, 7) + '-01');
                  }}
                >
                  <span className="day-mark" aria-hidden="true">
                    {state === 'is-partial-day' && (
                      <svg viewBox="0 0 40 40">
                        <circle className="day-ring-track" cx="20" cy="20" r="18.5" />
                        {done > 0 && (
                          <circle
                            className="day-ring-value"
                            cx="20"
                            cy="20"
                            r="18.5"
                            strokeDasharray={`${(RING * done) / total} ${RING}`}
                          />
                        )}
                      </svg>
                    )}
                    <span className="day-number">{Number(value.slice(8))}</span>
                    {state === 'is-planned-day' && <i className="day-plan-dot" />}
                  </span>
                  {value === today && (
                    <span className="day-today" aria-hidden="true">
                      오늘
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
        <aside className="month-preview" aria-label="선택한 날의 계획" aria-live="polite">
          <h3>{longDate(date)}</h3>
          {tasks.length > 0 && (
            <ul className="month-preview-list">
              {tasks.map((task) => {
                const finished = isTaskComplete(task, completed);
                return (
                  <li key={task.id} className={finished ? 'is-complete' : ''}>
                    <i aria-hidden="true" />
                    <span>{task.title}</span>
                    <span className="sr-only">{finished ? ', 완료' : ', 진행 전'}</span>
                  </li>
                );
              })}
            </ul>
          )}
          <button type="button" className="month-preview-open" onClick={() => onOpen(date)}>
            이동
          </button>
        </aside>
      </div>
    </section>
  );
}
