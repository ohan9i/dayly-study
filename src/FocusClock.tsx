import { useEffect, useState } from 'react';
import { Hourglass, Pause, Play, RotateCcw, Timer } from 'lucide-react';
import { Button } from './components/ui/button';
import { CircleProgress } from './components/ui/circle-progress';
import { CountdownNumber } from './components/ui/countdown-number';
import SquishSwitch from './SquishSwitch';
import './FocusClock.css';

type Mode = 'timer' | 'stopwatch';
type ClockState = {
  mode: Mode;
  duration: number;
  remaining: number;
  deadline: number | null;
  finished: boolean;
  elapsed: number;
  startedAt: number | null;
};
type DurationFields = { hours: string; minutes: string; seconds: string };
const storageKey = 'dayly.focus-clock.v1';
const maxDuration = (100 * 3600 - 1) * 1000;
const initialState: ClockState = {
  mode: 'timer',
  duration: 25 * 60_000,
  remaining: 25 * 60_000,
  deadline: null,
  finished: false,
  elapsed: 0,
  startedAt: null,
};
const pad = (value: number) => String(value).padStart(2, '0');
const remainingAt = (state: ClockState, now: number) =>
  state.deadline === null ? state.remaining : Math.max(0, state.deadline - now);
const elapsedAt = (state: ClockState, now: number) =>
  state.elapsed + (state.startedAt === null ? 0 : Math.max(0, now - state.startedAt));
const toFields = (ms: number): DurationFields => {
  const seconds = Math.floor(ms / 1000);
  return {
    hours: pad(Math.floor(seconds / 3600)),
    minutes: pad(Math.floor(seconds / 60) % 60),
    seconds: pad(seconds % 60),
  };
};
const formatTime = (seconds: number) =>
  `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`;
const parseDuration = (fields: DurationFields) => {
  const values = [fields.hours, fields.minutes, fields.seconds].map((value) =>
    value === '' ? 0 : Number(value),
  );
  if (
    values.some(
      (value, index) => !Number.isInteger(value) || value < 0 || value > (index === 0 ? 99 : 59),
    )
  )
    return null;
  return (values[0] * 3600 + values[1] * 60 + values[2]) * 1000;
};

function readClock(): ClockState {
  try {
    const value = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
    if (
      !value ||
      !['timer', 'stopwatch'].includes(value.mode) ||
      typeof value.finished !== 'boolean' ||
      ![value.duration, value.remaining, value.elapsed].every(
        (item) => Number.isSafeInteger(item) && item >= 0,
      ) ||
      value.duration > maxDuration ||
      value.remaining > value.duration ||
      ![value.deadline, value.startedAt].every(
        (item) => item === null || (Number.isSafeInteger(item) && item >= 0),
      )
    )
      return { ...initialState };
    if (value.deadline !== null && value.deadline <= Date.now())
      return { ...value, remaining: 0, deadline: null, finished: true };
    return value;
  } catch {
    return { ...initialState };
  }
}

export default function FocusClock({ visible }: { visible: boolean }) {
  const [state, setState] = useState(readClock);
  const [fields, setFields] = useState(() => toFields(Math.ceil(state.remaining / 1000) * 1000));
  const [now, setNow] = useState(Date.now);
  const timer = state.mode === 'timer';
  const running = timer ? state.deadline !== null : state.startedAt !== null;
  const duration = parseDuration(fields);
  const remainingSeconds = Math.ceil(remainingAt(state, now) / 1000);
  const elapsedSeconds = Math.floor(elapsedAt(state, now) / 1000);

  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      /* Keep working without browser storage. */
    }
  }, [state]);

  useEffect(() => {
    const tick = () => {
      const time = Date.now();
      if (state.deadline !== null && time >= state.deadline) {
        setFields(toFields(0));
        setState((current) =>
          current.deadline === state.deadline
            ? { ...current, deadline: null, remaining: 0, finished: true }
            : current,
        );
      }
      if (!document.hidden && visible) {
        // Only this card updates, and only when a displayed second changes.
        setNow((previous) =>
          Math.ceil(remainingAt(state, previous) / 1000) !==
            Math.ceil(remainingAt(state, time) / 1000) ||
          Math.floor(elapsedAt(state, previous) / 1000) !==
            Math.floor(elapsedAt(state, time) / 1000)
            ? time
            : previous,
        );
      }
    };
    let interval: number | undefined;
    const syncVisibility = () => {
      if (interval !== undefined) clearInterval(interval);
      tick();
      interval =
        !document.hidden && visible && (state.deadline !== null || state.startedAt !== null)
          ? window.setInterval(tick, 250)
          : undefined;
    };
    syncVisibility();
    // Hidden pages need only the completion wake-up, not a display polling loop.
    const completion =
      state.deadline !== null
        ? window.setTimeout(tick, Math.max(0, state.deadline - Date.now()))
        : undefined;
    document.addEventListener('visibilitychange', syncVisibility);
    return () => {
      if (interval !== undefined) clearInterval(interval);
      if (completion !== undefined) clearTimeout(completion);
      document.removeEventListener('visibilitychange', syncVisibility);
    };
  }, [state, visible]);

  const changeFields = (key: keyof DurationFields, value: string) => {
    const next = { ...fields, [key]: value };
    setFields(next);
    const ms = parseDuration(next);
    if (ms !== null) {
      setNow(Date.now());
      setState((current) => ({
        ...current,
        duration: ms,
        remaining: ms,
        deadline: null,
        finished: false,
      }));
    }
  };

  const toggleRunning = () => {
    const time = Date.now();
    setNow(time);
    if (timer && state.deadline !== null)
      setFields(toFields(Math.ceil(remainingAt(state, time) / 1000) * 1000));
    setState((current) => {
      if (current.mode === 'stopwatch') {
        return current.startedAt === null
          ? { ...current, startedAt: time }
          : { ...current, elapsed: elapsedAt(current, time), startedAt: null };
      }
      if (current.deadline !== null) {
        const remaining = remainingAt(current, time);
        return { ...current, remaining, deadline: null, finished: remaining === 0 };
      }
      if (duration === null || (current.finished ? current.duration === 0 : duration === 0))
        return current;
      const remaining = current.finished ? current.duration : current.remaining;
      return { ...current, remaining, deadline: time + remaining, finished: false };
    });
  };
  const reset = () => {
    setNow(Date.now());
    if (timer) setFields(toFields(state.duration));
    setState((current) =>
      current.mode === 'timer'
        ? { ...current, remaining: current.duration, deadline: null, finished: false }
        : { ...current, elapsed: 0, startedAt: null },
    );
  };
  const changeMode = (stopwatch: boolean) => {
    setNow(Date.now());
    setState((current) => ({ ...current, mode: stopwatch ? 'stopwatch' : 'timer' }));
  };
  const progress = timer ? state.remaining !== state.duration : state.elapsed > 0;
  const status = state.finished
    ? '설정한 시간이 끝났어요.'
    : !timer && state.deadline !== null
      ? '타이머도 진행 중이에요.'
      : timer && state.startedAt !== null
        ? '스톱워치도 진행 중이에요.'
        : running
          ? `${timer ? '타이머' : '스톱워치'} 진행 중`
          : progress
            ? '일시정지됨'
            : timer
              ? '숫자를 눌러 시간을 설정하세요.'
              : '시작을 눌러 시간을 기록하세요.';

  return (
    <section className="focus-clock-card" aria-label="타이머와 스톱워치">
      <span className="focus-clock-label">FOCUS / TIME</span>
      <div className="focus-clock-face" data-mode={state.mode}>
        <CircleProgress
          className="focus-clock-ring"
          value={timer ? remainingSeconds : 0}
          maxValue={state.duration / 1000}
          size={136}
          strokeWidth={3}
          counterClockwise
          aria-hidden="true"
          disableAnimation={!running || !visible}
        />
        <div className="focus-clock-center">
          <output
            className="sr-only"
            role="timer"
            aria-live="off"
            aria-label={timer ? '타이머 남은 시간' : '스톱워치 경과 시간'}
          >
            {formatTime(timer ? remainingSeconds : elapsedSeconds)}
          </output>
          <div
            className="focus-clock-display"
            role={timer && !running ? 'group' : undefined}
            aria-label={timer && !running ? '타이머 시간 설정' : undefined}
          >
            {(['hours', 'minutes', 'seconds'] as const).map((key, index) => (
              <span className="focus-clock-part" key={`${state.mode}-${key}`}>
                {index > 0 && (
                  <span className="focus-clock-colon" aria-hidden="true">
                    :
                  </span>
                )}
                {timer && !running ? (
                  <input
                    className="focus-time-input"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={index === 0 ? 99 : 59}
                    step={1}
                    aria-label={`타이머 ${['시간', '분', '초'][index]}`}
                    aria-invalid={
                      duration === null &&
                      (!Number.isInteger(Number(fields[key])) ||
                        Number(fields[key]) < 0 ||
                        Number(fields[key]) > (index === 0 ? 99 : 59))
                    }
                    value={fields[key]}
                    onChange={(event) => changeFields(key, event.target.value)}
                    onFocus={(event) => event.currentTarget.select()}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        event.currentTarget.blur();
                        toggleRunning();
                      }
                    }}
                    onBlur={() => {
                      if (duration !== null) setFields(toFields(duration));
                    }}
                  />
                ) : (
                  <CountdownNumber
                    value={formatTime(timer ? remainingSeconds : elapsedSeconds).split(':')[index]}
                    direction={timer ? 'down' : 'up'}
                    animate={running && visible && !document.hidden}
                  />
                )}
              </span>
            ))}
          </div>
          <span className="focus-clock-caption">{timer ? '남은 시간' : '경과 시간'}</span>
        </div>
      </div>
      <div className="focus-clock-actions">
        <Button
          type="button"
          onClick={toggleRunning}
          disabled={
            timer &&
            !running &&
            (duration === null || (state.finished ? state.duration === 0 : duration === 0))
          }
        >
          {running ? <Pause size={16} /> : <Play size={16} />}
          {running
            ? '일시정지'
            : timer && state.finished
              ? '다시 시작'
              : progress
                ? '계속'
                : '시작'}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={reset}
          aria-label={`${timer ? '타이머' : '스톱워치'} 초기화`}
        >
          <RotateCcw size={15} />
          초기화
        </Button>
      </div>
      <p className="focus-clock-status" role="status">
        {timer && duration === null ? '시간은 0~99, 분과 초는 0~59로 입력해 주세요.' : status}
      </p>
      <div className="focus-mode-picker" role="group" aria-label="시간 측정 모드">
        <span data-active={timer}>타이머</span>
        <SquishSwitch
          checked={!timer}
          onChange={changeMode}
          ariaLabel="스톱워치 모드"
          trackColor="#27272a"
          trackOnColor="#f5f5f5"
          thumbColor="#f5f5f5"
          thumbOnColor="#27272a"
          width={64}
          height={34}
          radius={17}
          thumbContent={timer ? <Hourglass size={15} /> : <Timer size={15} />}
        />
        <span data-active={!timer}>스톱워치</span>
      </div>
    </section>
  );
}
