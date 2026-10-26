import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  dateObject,
  flowLevel,
  periodDays,
  planDays,
  previousPeriodDays,
  todayKey,
  yearWeeks,
  type FlowPeriod,
  type Snapshot,
} from './domain';
import './StudyFlow.css';

const weekday = (date: string) =>
  new Intl.DateTimeFormat('ko-KR', { timeZone: 'UTC', weekday: 'short' }).format(dateObject(date));
const monthDay = (date: string) => `${Number(date.slice(5, 7))}월 ${Number(date.slice(8))}일`;
const describe = (date: string, total: number, done: number) =>
  total ? `${monthDay(date)}, 계획 ${total}개 중 ${done}개 완료` : `${monthDay(date)}, 계획 없음`;

export default function StudyFlow({
  data,
  date,
  onOpenDay,
}: {
  data: Snapshot;
  date: string;
  onOpenDay: (date: string) => void;
}) {
  const days = useMemo(() => planDays(data), [data]);
  const weeks = useMemo(() => yearWeeks(date), [date]);
  const [period, setPeriod] = useState<FlowPeriod>('week');
  const scroller = useRef<HTMLDivElement>(null);
  const today = todayKey();
  // On narrow screens the grid scrolls sideways; keep the latest weeks in view.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [date]);

  const bars = periodDays(date, period).map((day) => ({
    date: day,
    ...(days.get(day) || { total: 0, done: 0 }),
  }));
  const previous = previousPeriodDays(date, period);
  const average =
    previous.reduce((sum, day) => sum + (days.get(day)?.done || 0), 0) / previous.length;
  const max = Math.max(1, average, ...bars.map((bar) => bar.total));
  const hasPlans = bars.some((bar) => bar.total > 0);

  return (
    <>
      <section className="glass-card flow-card" aria-labelledby="flow-year-title">
        <h2 id="flow-year-title">한 해의 흐름</h2>
        <div className="flow-year-scroll" ref={scroller}>
          <div className="flow-year">
            <div className="flow-months" aria-hidden="true">
              {weeks.map((week, index) => {
                const first = week.find((day) => day.endsWith('-01'));
                return (
                  <span key={week[0]} style={{ gridColumn: index + 1 }}>
                    {first && index < 52 ? `${Number(first.slice(5, 7))}월` : ''}
                  </span>
                );
              })}
            </div>
            <div className="flow-grid">
              {weeks.flat().map((day) => {
                const record = days.get(day);
                if (day > date || day > today)
                  return <span key={day} className="flow-cell is-future" aria-hidden="true" />;
                return (
                  <button
                    key={day}
                    type="button"
                    className={`flow-cell level-${flowLevel(record)}${day === date ? ' is-selected' : ''}`}
                    aria-label={describe(day, record?.total || 0, record?.done || 0)}
                    title={describe(day, record?.total || 0, record?.done || 0)}
                    onClick={() => onOpenDay(day)}
                  />
                );
              })}
            </div>
          </div>
        </div>
        <div className="flow-legend" aria-hidden="true">
          적음
          {[0, 1, 2, 3, 4].map((level) => (
            <i key={level} className={`flow-cell level-${level}`} />
          ))}
          많음
        </div>
      </section>
      <section className="glass-card flow-card" aria-labelledby="flow-period-title">
        <div className="flow-period-header">
          <h2 id="flow-period-title">주 / 월 차트</h2>
          <span className="flow-period-note">
            점선은 {period === 'week' ? '지난주' : '지난달'} 평균
          </span>
          <div className="flow-toggle" role="group" aria-label="기간">
            {(['week', 'month'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={period === value}
                onClick={() => setPeriod(value)}
              >
                {value === 'week' ? '주' : '월'}
              </button>
            ))}
          </div>
        </div>
        {hasPlans ? (
          <div
            className={`flow-bars is-${period}`}
            role="img"
            aria-label={bars
              .filter((bar) => bar.total)
              .map((bar) => describe(bar.date, bar.total, bar.done))
              .join(', ')}
          >
            <div className="flow-bars-plot">
              {average > 0 && (
                <i className="flow-average" style={{ bottom: `${(average / max) * 100}%` }} />
              )}
              {bars.map((bar) => (
                <div className="flow-bar" key={bar.date}>
                  <span
                    className="flow-bar-planned"
                    style={{ height: `${(bar.total / max) * 100}%` }}
                  />
                  <span
                    className="flow-bar-done"
                    style={{ height: `${(bar.done / max) * 100}%` }}
                  />
                </div>
              ))}
            </div>
            <div className="flow-bars-labels" aria-hidden="true">
              {bars.map((bar) => {
                const day = Number(bar.date.slice(8));
                const near = Math.abs(day - Number(date.slice(8))) === 1;
                const shown =
                  period === 'week' || bar.date === date || day === 1 || (day % 5 === 0 && !near);
                return (
                  <span key={bar.date} className={bar.date === date ? 'is-current' : ''}>
                    {shown ? (period === 'week' ? weekday(bar.date) : day) : ''}
                  </span>
                );
              })}
            </div>
          </div>
        ) : (
          <p className="flow-empty">
            {period === 'week' ? '이 주에는 아직 계획이 없어요.' : '이 달에는 아직 계획이 없어요.'}
          </p>
        )}
      </section>
    </>
  );
}
