import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Clock3,
  Download,
  Home,
  Leaf,
  LogIn,
  LogOut,
  Mail,
  NotebookPen,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  Upload,
  UserRound,
  Users,
  X,
  ChartNoAxesColumnIncreasing,
  Copy,
} from 'lucide-react';
import {
  addDays,
  dateObject,
  emptySnapshot,
  formatDate,
  parseSnapshot,
  shiftMonth,
  sortedTasks,
  SUBJECTS,
  todayKey,
  weeklyStats,
  type Snapshot,
  type StudyLog,
  type Subject,
  type Task,
} from './domain';
import { supabase, usePlanner } from './planner';

type View = 'home' | 'calendar' | 'journal' | 'stats' | 'settings';
type ModalState =
  | { kind: 'task'; item?: Task }
  | { kind: 'log'; item?: StudyLog }
  | { kind: 'search' }
  | { kind: 'account' }
  | null;
const navigation = [
  { id: 'home', label: '나의 하루', icon: Home },
  { id: 'calendar', label: '달력', icon: CalendarDays },
  { id: 'journal', label: '공부 기록', icon: BookOpen },
  { id: 'stats', label: '학습 흐름', icon: ChartNoAxesColumnIncreasing },
  { id: 'settings', label: '설정', icon: Settings2 },
] as const;
const subjectClass = (subject: string) =>
  ({ 전공: 'mint', 수학: 'blue', 생활: 'neutral', 기록: 'peach', 기타: 'lavender' })[subject] ||
  'neutral';
const shortDay = (date: string) =>
  new Intl.DateTimeFormat('ko-KR', { timeZone: 'UTC', weekday: 'short' }).format(dateObject(date));

function Modal({
  title,
  subtitle,
  children,
  onClose,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current!;
    el.showModal();
    return () => {
      if (el.open) el.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      aria-labelledby="modal-title"
    >
      <div className="modal-inner">
        <button className="icon-button modal-close" aria-label="닫기" onClick={onClose}>
          <X size={21} />
        </button>
        <h2 id="modal-title">{title}</h2>
        {subtitle && <p className="modal-subtitle">{subtitle}</p>}
        {children}
      </div>
    </dialog>
  );
}
function Empty({
  icon = 'book',
  title,
  text,
  action,
}: {
  icon?: string;
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      {icon === 'check' ? <CheckCheck size={31} /> : <NotebookPen size={31} />}
      <strong>{title}</strong>
      <p>{text}</p>
      {action}
    </div>
  );
}
function Tag({ subject }: { subject: Subject }) {
  return <span className={`tag ${subjectClass(subject)}`}>{subject}</span>;
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export default function App() {
  const planner = usePlanner();
  const { data, isOwner, canWrite, busy, loading } = planner;
  const [view, setView] = useState<View>('home');
  const [date, setDate] = useState(todayKey);
  const [month, setMonth] = useState(() => todayKey().slice(0, 7) + '-01');
  const [now, setNow] = useState(new Date());
  const [modal, setModal] = useState<ModalState>(null);
  const [toast, setToast] = useState('');
  const [allLogs, setAllLogs] = useState(false);
  const [search, setSearch] = useState('');
  const [confirmation, setConfirmation] = useState<{
    title: string;
    message: string;
    action: () => Promise<void>;
  } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [displayName, setDisplayName] = useState(() => {
    try {
      return localStorage.getItem('dayly.displayName') || '';
    } catch {
      return '';
    }
  });
  const importRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 10000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 4000);
    return () => clearTimeout(timer);
  }, [toast]);
  const today = todayKey();
  const tasks = sortedTasks(data.tasks.filter((x) => x.date === date));
  const completed = new Set(data.completedTaskIds);
  const count = tasks.filter((x) => completed.has(x.id)).length;
  const dateLogs = data.logs.filter((x) => x.date === date);
  const logs = [...(allLogs ? data.logs : dateLogs)].sort((a, b) => b.date.localeCompare(a.date));
  const clock = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(now);
  const canEdit = (item: Task | StudyLog) =>
    canWrite && (isOwner || item.created_by === planner.session?.user.id);
  const act = async (action: () => Promise<unknown>, success?: string) => {
    try {
      await action();
      if (success) setToast(success);
    } catch (e) {
      setToast((e as Error).message || '저장하지 못했습니다. 다시 시도해 주세요.');
    }
  };
  const goDate = (next: string) => {
    setDate(next);
    setView('home');
    setModal(null);
  };
  const requestDelete = (item: Task | StudyLog, kind: 'task' | 'log') =>
    setConfirmation({
      title: kind === 'task' ? '할 일을 삭제할까요?' : '공부 기록을 삭제할까요?',
      message: `“${item.title}”을 삭제합니다. 삭제한 내용은 되돌릴 수 없어요.`,
      action: () => planner.deleteItem(item.id, kind),
    });
  function exportData() {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob),
      anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `dayly-${today}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setToast('공부 기록을 백업 파일로 내려받았어요.');
  }
  async function importData(file?: File) {
    if (!file) return;
    try {
      if (file.size > 5 * 1024 * 1024)
        throw new Error('5MB 이하의 Dayly 백업 파일을 선택해 주세요.');
      const restored = parseSnapshot(JSON.parse(await file.text()));
      setConfirmation({
        title: '백업을 불러올까요?',
        message: `현재 개인 기록을 백업의 할 일 ${restored.tasks.length}개와 공부 기록 ${restored.logs.length}개로 교체합니다. 현재 기록을 먼저 백업해 두세요.`,
        action: () => planner.replaceLocal(restored),
      });
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      if (importRef.current) importRef.current.value = '';
    }
  }
  const sampleNotice = !planner.session && data.hasSamples && (
    <div className="sample-notice">
      <Leaf size={16} />
      <span>첫 시작을 위한 예시 일정이에요. 나의 하루에 맞게 바꿔 보세요.</span>
      <button
        onClick={() =>
          setConfirmation({
            title: '예시 일정을 비울까요?',
            message:
              '예시로 제공한 일정을 삭제합니다. 직접 추가한 할 일과 공부 기록은 남아 있어요.',
            action: () =>
              planner.replaceLocal({
                ...data,
                hasSamples: false,
                tasks: data.tasks.filter((x) => !x.id.startsWith('sample-')),
                completedTaskIds: data.completedTaskIds.filter((x) => !x.startsWith('sample-')),
              }),
          })
        }
      >
        비우고 시작
      </button>
    </div>
  );
  const dateNav = (
    <div className="date-nav">
      <button
        className="icon-button"
        aria-label="이전 날짜"
        onClick={() => setDate(addDays(date, -1))}
      >
        <ChevronLeft size={18} />
      </button>
      <label className="date-input-label">
        <span className="sr-only">조회 날짜</span>
        <input
          aria-label="조회 날짜"
          type="date"
          value={date}
          onChange={(e) => {
            if (e.target.value) setDate(e.target.value);
          }}
        />
      </label>
      <button
        className="icon-button"
        aria-label="다음 날짜"
        onClick={() => setDate(addDays(date, 1))}
      >
        <ChevronRight size={18} />
      </button>
      {date !== today && (
        <button className="text-button" onClick={() => setDate(today)}>
          오늘
        </button>
      )}
    </div>
  );
  const taskCard = (
    <section className="glass-card tasks-card" aria-labelledby="tasks-heading">
      <div className="card-header">
        <h2 id="tasks-heading">{date === today ? '오늘 할 일' : '이날 할 일'}</h2>
        <div className="task-progress">
          <span>
            <b>{count}</b> / {tasks.length} 완료
          </span>
          <div
            className="progress-track"
            role="progressbar"
            aria-label="할 일 완료율"
            aria-valuenow={count}
            aria-valuemin={0}
            aria-valuemax={Math.max(tasks.length, 1)}
          >
            <i style={{ width: `${tasks.length ? (count / tasks.length) * 100 : 0}%` }} />
          </div>
        </div>
        <button
          className="add-button"
          aria-label="할 일 추가"
          disabled={!canWrite || busy}
          onClick={() => setModal({ kind: 'task' })}
        >
          <Plus size={23} />
        </button>
      </div>
      {tasks.length ? (
        <ul className="task-list">
          {tasks.map((task) => (
            <li key={task.id} className={`task-row ${completed.has(task.id) ? 'is-complete' : ''}`}>
              <button
                className="task-checkbox"
                role="checkbox"
                aria-checked={completed.has(task.id)}
                aria-label={`${task.title} 완료`}
                disabled={!canWrite || busy || !isOwner}
                onClick={() => void act(() => planner.toggleTask(task.id))}
              >
                {completed.has(task.id) && <Check size={17} strokeWidth={2.6} />}
              </button>
              <button
                className="task-title"
                aria-label={`${task.title} 상세 보기`}
                onClick={() => setModal({ kind: 'task', item: task })}
              >
                {task.title}
              </button>
              {task.subject !== '생활' && <Tag subject={task.subject} />}
              <time className="task-time">{task.time || '시간 자유'}</time>
            </li>
          ))}
        </ul>
      ) : (
        <Empty
          icon="check"
          title="여백이 있는 하루"
          text="오늘 하고 싶은 공부를 하나씩 적어 보세요."
          action={
            <button
              className="soft-button"
              disabled={!canWrite}
              onClick={() => setModal({ kind: 'task' })}
            >
              <Plus size={16} />첫 할 일 적기
            </button>
          }
        />
      )}
      {!isOwner && <p className="card-footnote">완료 체크는 이 공간의 본인만 할 수 있어요.</p>}
    </section>
  );

  return (
    <div className="app-shell">
      <div className="scenery" aria-hidden="true" />
      <button className="brand mobile-brand" aria-label="Dayly 홈" onClick={() => setView('home')}>
        Dayly<span className="brand-dot">.</span>
      </button>
      <aside className="sidebar">
        <button className="brand" aria-label="Dayly 홈" onClick={() => setView('home')}>
          Dayly<span className="brand-dot">.</span>
        </button>
        <nav aria-label="주 메뉴">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`nav-button ${view === id ? 'active' : ''}`}
              aria-current={view === id ? 'page' : undefined}
              aria-label={label}
              title={label}
              onClick={() => {
                setView(id);
                if (id === 'calendar') setMonth(date.slice(0, 7) + '-01');
              }}
            >
              <Icon size={24} strokeWidth={1.65} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <Leaf size={19} />
          <span>
            one day
            <br />
            at a time
          </span>
        </div>
      </aside>
      <header className="topbar">
        <button className="mode-chip" onClick={() => setView('settings')}>
          <span className={`status-dot ${planner.session ? 'online' : ''}`} />
          {planner.session ? (isOwner ? '나의 공유 공간' : '함께 쓰는 공간') : '개인 모드'}
        </button>
        {planner.session && (
          <button
            className="icon-button"
            title="공유 기록 새로고침"
            aria-label="공유 기록 새로고침"
            disabled={loading || busy}
            onClick={() => void act(planner.refresh, '공유 기록을 새로 불러왔어요.')}
          >
            <RefreshCw size={19} className={loading ? 'spin' : ''} />
          </button>
        )}
        <button
          className="icon-button top-icon"
          aria-label="기록 검색"
          onClick={() => {
            setSearch('');
            setModal({ kind: 'search' });
          }}
        >
          <Search size={23} />
        </button>
        <button
          className="profile-button"
          aria-label="내 계정"
          onClick={() => setModal({ kind: 'account' })}
        >
          <UserRound size={20} />
        </button>
      </header>
      <main className={`main-content view-${view}`}>
        {planner.error && (
          <div className="error-banner" role="alert">
            <span>{planner.error}</span>
            <button
              className="icon-button"
              aria-label="알림 닫기"
              onClick={() => planner.setError('')}
            >
              <X size={17} />
            </button>
          </div>
        )}
        {loading && (
          <div className="loading-note" role="status">
            <RefreshCw size={15} className="spin" />
            공유 기록을 불러오는 중이에요.
          </div>
        )}
        {planner.session && !planner.workspace && !loading && (
          <div className="onboarding-banner">
            <ShieldCheck size={21} />
            <div>
              <strong>로그인했어요. 공부할 공간을 선택해 주세요.</strong>
              <p>
                초대받은 이메일이라면 승인된 공간이 여기에 나타납니다. 직접 시작하려면 나의 공간을
                만들어 주세요.
              </p>
            </div>
            <button
              className="soft-button"
              disabled={busy}
              onClick={() =>
                void act(
                  () => planner.createWorkspace('나의 공부 공간'),
                  '나의 공부 공간을 만들었어요.',
                )
              }
            >
              나의 공간 만들기
            </button>
          </div>
        )}
        {view === 'home' && (
          <div className="home-layout">
            <div className="daily-column">
              <div className="page-heading">
                <p className="eyebrow">{formatDate(date)}</p>
                <h1>
                  {date === today ? (
                    <>
                      {displayName && <span className="name-line">{displayName}님,</span>}오늘도
                      좋은 하루가 될 거예요.
                    </>
                  ) : (
                    '차곡차곡, 하루를 돌아봐요.'
                  )}
                </h1>
                <div className="heading-subrow">
                  <p>작은 공부가 모여, 나의 내일이 되니까.</p>
                  {dateNav}
                </div>
              </div>
              {taskCard}
              <section className="glass-card daily-journal">
                <div className="card-header">
                  <h2>
                    <NotebookPen size={19} />
                    {date === today ? '오늘의 공부 기록' : '이날의 공부 기록'}
                  </h2>
                  <button
                    className="text-button"
                    disabled={!canWrite || busy}
                    onClick={() => setModal({ kind: 'log' })}
                  >
                    기록하기 <ArrowRight size={15} />
                  </button>
                </div>
                {dateLogs.length ? (
                  <div className="journal-preview">
                    {dateLogs.slice(0, 2).map((log) => (
                      <button key={log.id} onClick={() => setModal({ kind: 'log', item: log })}>
                        <span>
                          <Tag subject={log.subject} />
                          <strong>{log.title}</strong>
                        </span>
                        <small>
                          {log.minutes ? `${log.minutes}분` : '메모'}
                          <ChevronRight size={15} />
                        </small>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="journal-prompt">
                    오늘 새롭게 알게 된 것, 기억하고 싶은 것을 남겨 보세요.
                  </p>
                )}
                {dateLogs.length > 2 && (
                  <button
                    className="text-button"
                    onClick={() => {
                      setView('journal');
                      setAllLogs(false);
                    }}
                  >
                    기록 {dateLogs.length}개 모두 보기
                  </button>
                )}
              </section>
              {sampleNotice}
              <p className="save-note">
                <CircleCheck size={13} />
                {planner.session
                  ? planner.lastSaved
                    ? '공유 공간에 저장되어 있어요'
                    : '공유 기록'
                  : '이 브라우저에 자동으로 저장돼요'}
                <span>SEOUL · KST</span>
              </p>
            </div>
            <aside className="moment">
              <div className="live-clock" aria-label={`현재 시각 ${clock}`}>
                {clock}
              </div>
              <p>{formatDate(today, true)}</p>
              <div className="quote-divider" />
              <blockquote>
                <span className="quote-mark">“</span>꾸준한 오늘이
                <br />더 멀리 데려다 줄 거야.<span className="quote-mark last">”</span>
              </blockquote>
              <span className="moment-label">A LITTLE EVERY DAY</span>
            </aside>
          </div>
        )}
        {view === 'calendar' && (
          <div className="wide-page">
            <div className="page-heading">
              <p className="eyebrow">MY DAYS</p>
              <h1>하루하루, 쌓이는 나의 기록.</h1>
              <p className="page-description">날짜를 누르면 그날의 할 일과 공부를 볼 수 있어요.</p>
            </div>
            <section className="glass-card calendar-card">
              <div className="card-header">
                <h2>
                  {month.slice(0, 4)}년 {Number(month.slice(5, 7))}월
                </h2>
                <div className="row-actions">
                  <button
                    className="text-button"
                    onClick={() => setMonth(today.slice(0, 7) + '-01')}
                  >
                    이번 달
                  </button>
                  <button
                    className="icon-button"
                    aria-label="이전 달"
                    onClick={() => setMonth(shiftMonth(month, -1))}
                  >
                    <ChevronLeft size={20} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label="다음 달"
                    onClick={() => setMonth(shiftMonth(month, 1))}
                  >
                    <ChevronRight size={20} />
                  </button>
                </div>
              </div>
              <div className="calendar-weekdays">
                {['일', '월', '화', '수', '목', '금', '토'].map((x) => (
                  <span key={x}>{x}</span>
                ))}
              </div>
              <div className="calendar-grid">
                {Array.from({ length: 42 }, (_, i) => {
                  const value = addDays(month, i - dateObject(month).getUTCDay()),
                    dailyTasks = data.tasks.filter((x) => x.date === value),
                    done = dailyTasks.filter((x) => completed.has(x.id)).length,
                    studyCount = data.logs.filter((x) => x.date === value).length;
                  return (
                    <button
                      key={value}
                      className={`calendar-day ${value.slice(0, 7) !== month.slice(0, 7) ? 'outside-month' : ''} ${value === today ? 'is-today' : ''} ${value === date ? 'selected-day' : ''}`}
                      aria-label={`${formatDate(value)} 할 일 ${dailyTasks.length}개 공부 기록 ${studyCount}개`}
                      onClick={() => goDate(value)}
                    >
                      <span className="day-number">{Number(value.slice(8))}</span>
                      {dailyTasks.length > 0 && (
                        <span className="calendar-task-count">
                          {done === dailyTasks.length ? (
                            <Check size={12} />
                          ) : (
                            <span className="tiny-dot" />
                          )}
                          <span>
                            {done}/{dailyTasks.length} 완료
                          </span>
                        </span>
                      )}
                      {studyCount > 0 && (
                        <span className="calendar-log-count">
                          <BookOpen size={11} />
                          {studyCount}
                          <span>개 기록</span>
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <p className="card-footnote">
                <span className="legend-dot" />
                오늘 <span className="legend-square" />
                선택한 날
              </p>
            </section>
          </div>
        )}
        {view === 'journal' && (
          <div className="wide-page">
            <div className="page-heading">
              <p className="eyebrow">STUDY JOURNAL</p>
              <h1>배운 것을, 나의 것으로.</h1>
              <p className="page-description">공부한 내용과 아직 궁금한 것을 함께 남겨 보세요.</p>
            </div>
            <div className="section-toolbar">
              <div className="segmented">
                <button className={!allLogs ? 'selected' : ''} onClick={() => setAllLogs(false)}>
                  선택한 날짜
                </button>
                <button className={allLogs ? 'selected' : ''} onClick={() => setAllLogs(true)}>
                  전체 기록
                </button>
              </div>
              {!allLogs && dateNav}
              <button
                className="primary-button"
                disabled={!canWrite || busy}
                onClick={() => setModal({ kind: 'log' })}
              >
                <Plus size={17} />
                공부 기록
              </button>
            </div>
            {logs.length ? (
              <div className="journal-grid">
                {logs.map((log) => (
                  <article key={log.id} className="glass-card journal-entry">
                    <div className="entry-top">
                      <Tag subject={log.subject} />
                      <span>{log.date.replaceAll('-', '. ')}</span>
                    </div>
                    <h2>{log.title}</h2>
                    <p className="entry-content">{log.content || '내용을 더 기록해 보세요.'}</p>
                    <div className="entry-bottom">
                      <span>
                        <Clock3 size={14} />
                        {log.minutes ? `${log.minutes}분 공부` : '시간 미기록'}
                      </span>
                      <button
                        className="text-button"
                        onClick={() => setModal({ kind: 'log', item: log })}
                      >
                        {canEdit(log) ? '수정' : '보기'}
                        <ArrowRight size={15} />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <section className="glass-card">
                <Empty
                  title="아직 펼치지 않은 기록장"
                  text="첫 공부 기록을 남겨 보세요. 한 문장이어도 좋아요."
                  action={
                    <button
                      className="soft-button"
                      disabled={!canWrite}
                      onClick={() => setModal({ kind: 'log' })}
                    >
                      <NotebookPen size={16} />
                      기록 시작하기
                    </button>
                  }
                />
              </section>
            )}
          </div>
        )}
        {view === 'stats' && (
          <div className="wide-page">
            <div className="page-heading">
              <p className="eyebrow">YOUR LITTLE PROGRESS</p>
              <h1>꾸준함이 보여요.</h1>
              <p className="page-description">선택한 날까지 최근 7일의 공부 흐름이에요.</p>
            </div>
            <div className="section-toolbar">{dateNav}</div>
            <Stats data={data} date={date} />
            <p className="stats-note">
              공부 시간은 공부 기록에 직접 입력한 시간을 합산합니다.
              {data.hasSamples && !planner.session && ' 현재 예시 일정이 포함되어 있어요.'}
            </p>
          </div>
        )}
        {view === 'settings' && (
          <div className="wide-page settings-page">
            <div className="page-heading">
              <p className="eyebrow">MAKE IT YOURS</p>
              <h1>나에게 맞는 공부 공간.</h1>
              <p className="page-description">기록을 보관하고, 함께 공부할 사람을 관리해요.</p>
            </div>
            <section className="glass-card settings-card">
              <h2>
                <UserRound size={19} />
                나의 이름
              </h2>
              <form
                className="inline-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const value = String(
                    new FormData(e.currentTarget).get('displayName') || '',
                  ).trim();
                  try {
                    localStorage.setItem('dayly.displayName', value);
                    setDisplayName(value);
                    setToast('인사말에 사용할 이름을 저장했어요.');
                  } catch {
                    setToast('이름을 저장하지 못했어요. 브라우저 저장 권한을 확인해 주세요.');
                  }
                }}
              >
                <input
                  aria-label="인사말에 사용할 이름"
                  name="displayName"
                  maxLength={20}
                  placeholder="인사말에 사용할 이름"
                  defaultValue={displayName}
                />
                <button className="soft-button" type="submit">
                  저장
                </button>
              </form>
            </section>
            <section className="glass-card settings-card">
              <h2>
                <ShieldCheck size={19} />
                계정과 저장
              </h2>
              <div className="setting-row">
                <div>
                  <strong>
                    {planner.session ? planner.session.user.email : '개인 모드로 사용 중이에요'}
                  </strong>
                  <p>
                    {planner.session
                      ? '승인된 사람과 같은 공간의 기록을 공유합니다.'
                      : '이 기기의 브라우저에 저장합니다. 브라우저 데이터를 지우면 기록도 지워지니 백업해 주세요.'}
                  </p>
                </div>
                <button className="soft-button" onClick={() => setModal({ kind: 'account' })}>
                  {planner.session ? '계정 보기' : '계정 연결'}
                </button>
              </div>
              {planner.workspaces.length > 0 && (
                <Field label="사용 중인 공유 공간">
                  <select
                    value={planner.workspace?.id || ''}
                    disabled={busy || loading}
                    onChange={(e) => void act(() => planner.selectWorkspace(e.target.value))}
                  >
                    {planner.workspaces.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                        {x.owner_id === planner.session?.user.id ? ' · 관리자' : ' · 작성자'}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
            </section>
            <section className="glass-card settings-card">
              <h2>
                <Users size={19} />
                함께 쓰는 사람
              </h2>
              {planner.session && planner.workspace ? (
                isOwner ? (
                  <>
                    <p className="setting-description">
                      승인한 이메일로 로그인한 사람만 할 일과 공부 기록을 작성할 수 있어요. 완료
                      체크는 본인만 할 수 있습니다.
                    </p>
                    <MemberForm
                      onSubmit={planner.grantMember}
                      onSuccess={() =>
                        setToast('작성자를 승인했어요. 아래 주소를 직접 전달해 주세요.')
                      }
                    />
                    {planner.members.length > 0 && (
                      <ul className="member-list">
                        {planner.members.map((member) => (
                          <li key={member.id}>
                            <Mail size={16} />
                            <span>{member.email}</span>
                            <small>작성자</small>
                            <button
                              className="icon-button"
                              aria-label={`${member.email} 작성 권한 해제`}
                              onClick={() =>
                                setConfirmation({
                                  title: '작성 권한을 해제할까요?',
                                  message: `${member.email}의 이 공간 접근 권한을 해제합니다. 작성한 기록은 유지됩니다.`,
                                  action: () => planner.revokeMember(member.id),
                                })
                              }
                            >
                              <X size={17} />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="share-link">
                      <input
                        aria-label="공유할 홈페이지 주소"
                        value={window.location.href.split('#')[0].split('?')[0]}
                        readOnly
                      />
                      <button
                        className="icon-button"
                        aria-label="홈페이지 주소 복사"
                        onClick={() =>
                          void act(
                            () =>
                              navigator.clipboard.writeText(
                                window.location.href.split('#')[0].split('?')[0],
                              ),
                            '홈페이지 주소를 복사했어요.',
                          )
                        }
                      >
                        <Copy size={17} />
                      </button>
                    </div>
                    <p className="card-footnote">
                      승인만으로 이메일이 발송되지는 않습니다. 홈페이지 주소를 직접 전달해 주세요.
                    </p>
                  </>
                ) : (
                  <p className="setting-description">
                    이 공간의 작성자로 참여하고 있어요. 사람을 승인하거나 권한을 바꾸는 일은
                    관리자만 할 수 있습니다.
                  </p>
                )
              ) : (
                <div className="setting-placeholder">
                  <Users size={24} />
                  <p>공유 계정을 연결하면 이메일로 작성자를 승인할 수 있어요.</p>
                  <span>현재는 개인 모드로 사용할 수 있습니다.</span>
                </div>
              )}
            </section>
            <section className="glass-card settings-card">
              <h2>
                <Download size={19} />
                나의 기록 보관
              </h2>
              <p className="setting-description">
                할 일과 공부 기록을 JSON 파일로 보관할 수 있어요. 백업 불러오기는 개인 모드에서 현재
                기록을 교체합니다.
              </p>
              <div className="backup-actions">
                <button className="soft-button" onClick={exportData}>
                  <Download size={16} />
                  백업 내려받기
                </button>
                <button
                  className="soft-button"
                  disabled={Boolean(planner.session) || busy}
                  onClick={() => importRef.current?.click()}
                >
                  <Upload size={16} />
                  백업 불러오기
                </button>
                <input
                  className="sr-only"
                  type="file"
                  accept=".json,application/json"
                  ref={importRef}
                  aria-label="백업 파일 선택"
                  onChange={(e) => void importData(e.target.files?.[0])}
                />
              </div>
            </section>
            {!planner.session && (
              <section className="glass-card settings-card">
                <h2>
                  <Leaf size={19} />
                  새로운 시작
                </h2>
                <p className="setting-description">
                  개인 모드의 모든 할 일과 공부 기록을 비웁니다. 먼저 백업해 두세요.
                </p>
                <button
                  className="danger-button"
                  disabled={busy}
                  onClick={() =>
                    setConfirmation({
                      title: '모든 개인 기록을 비울까요?',
                      message:
                        '이 브라우저에 저장된 할 일과 공부 기록을 모두 삭제합니다. 백업하지 않은 내용은 되돌릴 수 없어요.',
                      action: () => planner.replaceLocal(emptySnapshot()),
                    })
                  }
                >
                  <Trash2 size={16} />
                  개인 기록 비우기
                </button>
              </section>
            )}
          </div>
        )}
      </main>
      <div className={`toast ${toast ? 'visible' : ''}`} role="status" aria-live="polite">
        {toast && (
          <>
            <CircleCheck size={17} />
            <span>{toast}</span>
          </>
        )}
      </div>
      {modal?.kind === 'task' && (
        <Modal
          title={modal.item ? '할 일 살펴보기' : '하나씩, 오늘 할 일'}
          subtitle="작은 계획 하나가 하루의 방향을 만들어 줘요."
          onClose={() => {
            if (!busy) setModal(null);
          }}
        >
          <TaskForm
            key={modal.item?.id || 'new'}
            item={modal.item}
            date={date}
            userId={planner.session?.user.id || 'local'}
            editable={!modal.item ? canWrite : canEdit(modal.item)}
            busy={busy}
            onSave={async (task) => {
              await planner.saveTask(task, Boolean(modal.item));
              setModal(null);
              setToast('할 일을 저장했어요.');
            }}
            onDelete={
              modal.item && canEdit(modal.item)
                ? () => {
                    const item = modal.item!;
                    setModal(null);
                    requestDelete(item, 'task');
                  }
                : undefined
            }
          />
        </Modal>
      )}
      {modal?.kind === 'log' && (
        <Modal
          title={modal.item ? '공부 기록 펼쳐보기' : '오늘 배운 것을 남겨요'}
          subtitle="핵심 개념, 풀었던 문제, 다음에 공부할 것을 적어 보세요."
          onClose={() => {
            if (!busy) setModal(null);
          }}
        >
          <LogForm
            key={modal.item?.id || 'new'}
            item={modal.item}
            date={date}
            userId={planner.session?.user.id || 'local'}
            editable={!modal.item ? canWrite : canEdit(modal.item)}
            busy={busy}
            onSave={async (log) => {
              await planner.saveLog(log, Boolean(modal.item));
              setModal(null);
              setToast('공부 기록을 저장했어요.');
            }}
            onDelete={
              modal.item && canEdit(modal.item)
                ? () => {
                    const item = modal.item!;
                    setModal(null);
                    requestDelete(item, 'log');
                  }
                : undefined
            }
          />
        </Modal>
      )}
      {modal?.kind === 'account' && (
        <Modal
          title={planner.session ? '나의 계정' : '공부를 이어 가는 계정'}
          subtitle={
            planner.session
              ? '같은 계정으로 로그인하면 다른 기기에서도 기록을 볼 수 있어요.'
              : '이메일로 로그인 링크를 받아 안전하게 시작해요.'
          }
          onClose={() => setModal(null)}
        >
          <Account
            sessionEmail={planner.session?.user.email}
            onDone={() => setModal(null)}
            onToast={setToast}
          />
        </Modal>
      )}
      {modal?.kind === 'search' && (
        <Modal
          title="나의 기록 찾기"
          subtitle="할 일, 과목, 공부 내용으로 찾아보세요."
          onClose={() => setModal(null)}
        >
          <div className="search-input">
            <Search size={19} />
            <input
              aria-label="기록 검색어"
              type="search"
              placeholder="어떤 공부를 찾고 있나요?"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
          </div>
          {search.trim() ? (
            <div className="search-results">
              {[
                ...data.tasks.map((x) => ({ ...x, content: x.details, kind: '할 일' })),
                ...data.logs.map((x) => ({ ...x, kind: '공부 기록' })),
              ]
                .filter((x) =>
                  `${x.title} ${x.subject} ${x.content}`
                    .toLowerCase()
                    .includes(search.trim().toLowerCase()),
                )
                .slice(0, 50)
                .map((x) => (
                  <button
                    key={`${x.kind}-${x.id}`}
                    onClick={() => {
                      setDate(x.date);
                      setModal(
                        x.kind === '할 일'
                          ? { kind: 'task', item: data.tasks.find((t) => t.id === x.id)! }
                          : { kind: 'log', item: data.logs.find((l) => l.id === x.id)! },
                      );
                    }}
                  >
                    <span>
                      <small>
                        {x.kind} · {x.date}
                      </small>
                      <strong>{x.title}</strong>
                    </span>
                    <Tag subject={x.subject} />
                    <ChevronRight size={16} />
                  </button>
                ))}
              {![
                ...data.tasks.map((x) => `${x.title} ${x.subject} ${x.details}`),
                ...data.logs.map((x) => `${x.title} ${x.subject} ${x.content}`),
              ].some((x) => x.toLowerCase().includes(search.trim().toLowerCase())) && (
                <p className="search-empty">일치하는 기록이 없어요. 다른 단어로 찾아보세요.</p>
              )}
            </div>
          ) : (
            <p className="search-empty">기억을 꺼내고 싶은 단어를 입력해 주세요.</p>
          )}
        </Modal>
      )}
      {confirmation && (
        <Modal
          title={confirmation.title}
          onClose={() => {
            if (!confirmBusy) setConfirmation(null);
          }}
        >
          <p className="confirm-message">{confirmation.message}</p>
          <div className="form-actions">
            <button
              className="soft-button"
              disabled={confirmBusy}
              onClick={() => setConfirmation(null)}
            >
              취소
            </button>
            <button
              className="danger-button"
              disabled={confirmBusy}
              onClick={async () => {
                setConfirmBusy(true);
                try {
                  await confirmation.action();
                  setConfirmation(null);
                  setToast('변경을 적용했어요.');
                } catch (e) {
                  setToast((e as Error).message);
                } finally {
                  setConfirmBusy(false);
                }
              }}
            >
              {confirmBusy ? '처리 중…' : '확인'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function TaskForm({
  item,
  date,
  userId,
  editable,
  busy,
  onSave,
  onDelete,
}: {
  item?: Task;
  date: string;
  userId: string;
  editable: boolean;
  busy: boolean;
  onSave: (x: Task) => Promise<void>;
  onDelete?: () => void;
}) {
  const [error, setError] = useState('');
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const values = new FormData(e.currentTarget),
      title = String(values.get('title')).trim();
    if (!title) {
      setError('할 일을 적어 주세요.');
      return;
    }
    try {
      await onSave({
        id: item?.id || crypto.randomUUID(),
        title,
        subject: values.get('subject') as Subject,
        date: String(values.get('date')),
        time: String(values.get('time')),
        details: String(values.get('details')).trim(),
        created_by: item?.created_by || userId,
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <form onSubmit={submit} className="editor-form">
      <fieldset disabled={!editable || busy}>
        <Field label="할 일">
          <input
            name="title"
            required
            maxLength={150}
            defaultValue={item?.title}
            placeholder="예: 구조 역학 3장 연습문제 풀기"
            autoFocus
          />
        </Field>
        <div className="form-grid">
          <Field label="날짜">
            <input name="date" type="date" required defaultValue={item?.date || date} />
          </Field>
          <Field label="예정 시간">
            <input name="time" type="time" defaultValue={item?.time || ''} />
          </Field>
        </div>
        <Field label="과목">
          <select name="subject" defaultValue={item?.subject || '전공'}>
            {SUBJECTS.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </Field>
        <Field label="메모">
          <textarea
            name="details"
            rows={3}
            maxLength={10000}
            defaultValue={item?.details}
            placeholder="공부할 범위, 참고할 책이나 링크를 적어 주세요."
          />
        </Field>
      </fieldset>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {editable ? (
        <div className="form-actions">
          {onDelete && (
            <button
              className="icon-button delete-button"
              type="button"
              aria-label="이 할 일 삭제"
              onClick={onDelete}
              disabled={busy}
            >
              <Trash2 size={19} />
            </button>
          )}
          <button className="primary-button" disabled={busy} type="submit">
            <Check size={17} />
            {busy ? '저장 중…' : '할 일 저장'}
          </button>
        </div>
      ) : (
        <p className="card-footnote">이 기록의 작성자와 관리자만 수정할 수 있어요.</p>
      )}
    </form>
  );
}
function LogForm({
  item,
  date,
  userId,
  editable,
  busy,
  onSave,
  onDelete,
}: {
  item?: StudyLog;
  date: string;
  userId: string;
  editable: boolean;
  busy: boolean;
  onSave: (x: StudyLog) => Promise<void>;
  onDelete?: () => void;
}) {
  const [error, setError] = useState('');
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const values = new FormData(e.currentTarget),
      title = String(values.get('title')).trim();
    if (!title) {
      setError('공부 기록의 제목을 적어 주세요.');
      return;
    }
    try {
      await onSave({
        id: item?.id || crypto.randomUUID(),
        title,
        subject: values.get('subject') as Subject,
        date: String(values.get('date')),
        minutes: Number(values.get('minutes')),
        content: String(values.get('content')).trim(),
        created_by: item?.created_by || userId,
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <form onSubmit={submit} className="editor-form">
      <fieldset disabled={!editable || busy}>
        <Field label="오늘 공부한 것">
          <input
            name="title"
            required
            maxLength={150}
            defaultValue={item?.title}
            placeholder="예: 보의 전단력과 휨모멘트 이해하기"
            autoFocus
          />
        </Field>
        <div className="form-grid">
          <Field label="날짜">
            <input name="date" type="date" required defaultValue={item?.date || date} />
          </Field>
          <Field label="공부 시간 (분)">
            <input
              name="minutes"
              type="number"
              min={0}
              max={1440}
              step={1}
              defaultValue={item?.minutes || 0}
            />
          </Field>
        </div>
        <Field label="과목">
          <select name="subject" defaultValue={item?.subject || '전공'}>
            {SUBJECTS.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </Field>
        <Field label="배운 내용과 다음 공부">
          <textarea
            name="content"
            rows={6}
            maxLength={10000}
            defaultValue={item?.content}
            placeholder={
              '오늘 이해한 핵심 개념은 무엇인가요?\n어떤 문제가 어려웠나요?\n다음에는 무엇을 공부하면 좋을까요?'
            }
          />
        </Field>
      </fieldset>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {editable ? (
        <div className="form-actions">
          {onDelete && (
            <button
              className="icon-button delete-button"
              type="button"
              aria-label="이 공부 기록 삭제"
              disabled={busy}
              onClick={onDelete}
            >
              <Trash2 size={19} />
            </button>
          )}
          <button className="primary-button" disabled={busy} type="submit">
            <Check size={17} />
            {busy ? '저장 중…' : '기록 저장'}
          </button>
        </div>
      ) : (
        <p className="card-footnote">이 기록의 작성자와 관리자만 수정할 수 있어요.</p>
      )}
    </form>
  );
}
function Account({
  sessionEmail,
  onDone,
  onToast,
}: {
  sessionEmail?: string;
  onDone: () => void;
  onToast: (x: string) => void;
}) {
  const [sent, setSent] = useState(false),
    [email, setEmail] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError('');
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim().toLowerCase(),
        options: { emailRedirectTo: window.location.href.split('#')[0].split('?')[0] },
      });
      if (error) throw error;
      setSent(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (sessionEmail)
    return (
      <>
        <div className="account-status">
          <ShieldCheck size={28} />
          <strong>{sessionEmail}</strong>
          <p>로그인되어 있어요.</p>
        </div>
        <button
          className="soft-button full-width"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const { error } = await supabase!.auth.signOut();
            setBusy(false);
            if (error) setError(error.message);
            else {
              onDone();
              onToast('로그아웃했어요. 개인 모드로 돌아갑니다.');
            }
          }}
        >
          <LogOut size={17} />
          로그아웃
        </button>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </>
    );
  if (!supabase)
    return (
      <>
        <div className="account-status">
          <Leaf size={30} />
          <strong>지금은 개인 모드로 시작해요.</strong>
          <p>
            할 일과 공부 기록은 이 브라우저에 저장됩니다.
            <br />
            공유 서비스를 연결하면 로그인과 작성자 승인 기능을 사용할 수 있어요.
          </p>
        </div>
        <button className="primary-button full-width" onClick={onDone}>
          나의 하루로 돌아가기
        </button>
      </>
    );
  return sent ? (
    <div className="account-status">
      <Mail size={32} />
      <strong>이메일을 확인해 주세요.</strong>
      <p>
        {email}로 로그인 링크를 보냈어요.
        <br />
        메일의 링크를 누르면 이 공간으로 돌아옵니다.
      </p>
      <button className="text-button" onClick={() => setSent(false)}>
        다른 이메일 사용하기
      </button>
    </div>
  ) : (
    <form className="editor-form" onSubmit={submit}>
      <Field label="이메일">
        <input
          type="email"
          required
          autoComplete="email"
          placeholder="name@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoFocus
        />
      </Field>
      <p className="card-footnote">공유 공간은 관리자가 승인한 이메일로만 접근할 수 있어요.</p>
      <p className="card-footnote">
        개인 모드의 기록은 계정에 자동으로 옮겨지지 않아요. 로그아웃하면 이 브라우저의 개인 기록으로
        돌아갑니다.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button className="primary-button full-width" disabled={busy} type="submit">
        <LogIn size={17} />
        {busy ? '보내는 중…' : '로그인 링크 받기'}
      </button>
    </form>
  );
}
function MemberForm({
  onSubmit,
  onSuccess,
}: {
  onSubmit: (email: string) => Promise<void>;
  onSuccess: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <form
      className="member-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget,
          email = String(new FormData(form).get('email'));
        setBusy(true);
        setError('');
        try {
          await onSubmit(email);
          form.reset();
          onSuccess();
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="inline-form">
        <input
          type="email"
          name="email"
          required
          maxLength={254}
          aria-label="승인할 작성자의 이메일"
          placeholder="함께 쓸 사람의 이메일"
        />
        <button className="soft-button" disabled={busy} type="submit">
          <Plus size={16} />
          {busy ? '승인 중…' : '작성자 승인'}
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
function Stats({ data, date }: { data: Snapshot; date: string }) {
  const week = weeklyStats(data, date),
    total = week.reduce((s, x) => s + x.total, 0),
    done = week.reduce((s, x) => s + x.completed, 0),
    minutes = week.reduce((s, x) => s + x.minutes, 0),
    max = Math.max(1, ...week.map((x) => x.total));
  const subjects = SUBJECTS.map((subject) => ({
    subject,
    minutes: data.logs
      .filter((x) => x.subject === subject && x.date >= week[0].date && x.date <= date)
      .reduce((s, x) => s + x.minutes, 0),
  })).filter((x) => x.minutes > 0);
  return (
    <>
      <div className="stats-summary">
        <div className="glass-card stat-tile">
          <span>
            <CheckCheck size={17} />
            완료한 할 일
          </span>
          <strong>
            {done}
            <small> / {total}개</small>
          </strong>
          <p>한 걸음씩 해냈어요.</p>
        </div>
        <div className="glass-card stat-tile">
          <span>
            <Clock3 size={17} />
            기록한 공부 시간
          </span>
          <strong>
            {Math.floor(minutes / 60)}
            <small>시간 </small>
            {minutes % 60}
            <small>분</small>
          </strong>
          <p>나에게 투자한 시간.</p>
        </div>
        <div className="glass-card stat-tile">
          <span>
            <Leaf size={17} />
            공부를 기록한 날
          </span>
          <strong>
            {week.filter((x) => x.minutes > 0 || data.logs.some((l) => l.date === x.date)).length}
            <small> / 7일</small>
          </strong>
          <p>작은 꾸준함의 힘.</p>
        </div>
      </div>
      <section className="glass-card chart-card">
        <div className="card-header">
          <h2>지난 7일의 할 일</h2>
          <div className="chart-legend">
            <i />
            완료 <i className="pale" />
            계획
          </div>
        </div>
        <div
          className="bar-chart"
          role="img"
          aria-label={week
            .map((x) => `${x.date}: ${x.total}개 중 ${x.completed}개 완료`)
            .join(', ')}
        >
          {week.map((x) => (
            <div className="chart-column" key={x.date}>
              <span className="bar-value">
                {x.completed}
                <small>/{x.total}</small>
              </span>
              <div className="bar-track">
                <div className="bar-planned" style={{ height: `${(x.total / max) * 100}%` }}>
                  <div
                    className="bar-completed"
                    style={{ height: `${x.total ? (x.completed / x.total) * 100 : 0}%` }}
                  />
                </div>
              </div>
              <span className={x.date === date ? 'chart-day current' : 'chart-day'}>
                {shortDay(x.date)}
              </span>
              <small className="chart-date">
                {Number(x.date.slice(5, 7))}.{Number(x.date.slice(8))}
              </small>
            </div>
          ))}
        </div>
      </section>
      <section className="glass-card subjects-card">
        <h2>어떤 공부를 했나요?</h2>
        {subjects.length ? (
          subjects.map((x) => (
            <div className="subject-stat" key={x.subject}>
              <Tag subject={x.subject} />
              <div className="subject-track">
                <i style={{ width: `${(x.minutes / Math.max(1, minutes)) * 100}%` }} />
              </div>
              <span>{x.minutes}분</span>
            </div>
          ))
        ) : (
          <p className="setting-description">
            공부 기록에 시간을 남기면 과목별 흐름도 볼 수 있어요.
          </p>
        )}
      </section>
    </>
  );
}
