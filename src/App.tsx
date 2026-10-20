import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import {
  CalendarDays,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Download,
  Home,
  Leaf,
  LockKeyhole,
  Mail,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  Settings,
  SquareCheckBig,
  ShieldCheck,
  Trash2,
  UserRound,
  Users,
  X,
  ChartNoAxesColumnIncreasing,
  Copy,
  Moon,
  Sun,
} from 'lucide-react';
import {
  addDays,
  dateObject,
  formatDate,
  shiftMonth,
  sortedTasks,
  taskProgress,
  dayProgress,
  readDetailNote,
  todayKey,
  weeklyStats,
  type Snapshot,
  type Task,
} from './domain';
import { usePlanner } from './planner';
import Account from './Account';
import TaskDetail from './TaskDetail';
import { TaskProgress, DayProgressRing } from './TaskProgress';
import WorkspacePanel from './WorkspacePanel';
import DetailRecord from './DetailRecord';
import DataProtection from './DataProtection';
import { AtmospherePicker, CompletionSparkles, useAtmosphere } from './Atmosphere';
import WelcomeScreen from './WelcomeScreen';
import { readEntryNavigation, saveEntryNavigation } from './entryNavigation';
import SwipeRow from './SwipeRow';
import SpringCheck, { SpringCheckLabel } from './SpringCheck';

type View = 'home' | 'calendar' | 'stats' | 'settings';
type ModalState = { kind: 'task'; item?: Task } | { kind: 'search' } | { kind: 'account' } | null;
const navigation = [
  { id: 'home', label: '나의 하루', icon: Home },
  { id: 'calendar', label: '달력', icon: CalendarDays },
  { id: 'stats', label: '학습 흐름', icon: ChartNoAxesColumnIncreasing },
  { id: 'settings', label: '설정', icon: Settings },
] as const;
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
  const titleId = useId();
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
      aria-labelledby={titleId}
    >
      <div className="modal-inner">
        <button className="icon-button modal-close" aria-label="닫기" onClick={onClose}>
          <X size={21} />
        </button>
        <h2 id={titleId}>{title}</h2>
        {subtitle && <p className="modal-subtitle">{subtitle}</p>}
        {children}
      </div>
    </dialog>
  );
}
function Empty({
  icon = 'leaf',
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
      {icon === 'check' ? <CheckCheck size={31} /> : <Leaf size={31} />}
      <strong>{title}</strong>
      <p>{text}</p>
      {action}
    </div>
  );
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
  const [atmosphere, setAtmosphere] = useAtmosphere();
  const planner = usePlanner();
  const { data, isOwner, canWrite, busy, loading } = planner;
  const [view, setView] = useState<View>(() => readEntryNavigation().view || 'home');
  const [date, setDate] = useState(() => readEntryNavigation().date || todayKey());
  const [swipeMenu, setSwipeMenu] = useState<{ id: string; side: 'add' | 'delete' } | null>(null);
  const [month, setMonth] = useState(
    () => readEntryNavigation().month || todayKey().slice(0, 7) + '-01',
  );
  useEffect(() => {
    saveEntryNavigation({ view, date, month, scroll: window.scrollY });
  }, [view, date, month]);
  const [now, setNow] = useState(new Date());
  const [modal, setModal] = useState<ModalState>(null);
  const [openRecords, setOpenRecords] = useState<Set<string>>(() => new Set());
  const [taskDetailBusy, setTaskDetailBusy] = useState(false);
  useEffect(() => {
    setModal((current) =>
      current?.kind === 'task' || current?.kind === 'search' ? null : current,
    );
  }, [planner.workspace?.id, planner.session?.user.id]);
  const [toast, setToast] = useState('');
  const [search, setSearch] = useState('');
  const [confirmation, setConfirmation] = useState<{
    title: string;
    message: string;
    action: () => Promise<void>;
  } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  useEffect(() => {
    if (planner.passwordRecovery) setModal({ kind: 'account' });
  }, [planner.passwordRecovery]);
  const [displayName, setDisplayName] = useState(() => {
    try {
      return localStorage.getItem('dayly.displayName') || '';
    } catch {
      return '';
    }
  });
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
  const totalProgress = dayProgress(tasks, completed);
  const searchMatches = data.tasks.filter((task) =>
    `${task.title} ${task.details.join(' ')}`.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const clock = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(now);
  const canManageTask = (item?: Task) =>
    Boolean(planner.session && planner.workspace) &&
    !planner.passwordRecovery &&
    (!item || isOwner || item.created_by === planner.session?.user.id);
  const act = async (action: () => Promise<unknown>, success?: string) => {
    try {
      await action();
      if (success) setToast(success);
    } catch (e) {
      setToast((e as Error).message || '저장하지 못했습니다. 다시 시도해 주세요.');
    }
  };
  const goDate = (next: string) => {
    setSwipeMenu(null);
    setDate(next);
    setView('home');
    setModal(null);
  };
  const goView = (next: View) => {
    setSwipeMenu(null);
    setView(next);
    if (next === 'calendar') setMonth(date.slice(0, 7) + '-01');
  };
  const requestDelete = (item: Task) =>
    setConfirmation({
      title: '할 일을 휴지통으로 보낼까요?',
      message:
        '“' +
        item.title +
        '”을 현재 목록에서 삭제합니다. 내용·기록·첨부 원본은 보관되며 설정의 휴지통에서 복원할 수 있어요.',
      action: () => planner.deleteTask(item.id),
    });
  function exportData() {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob),
      anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `dayly-${today}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setToast('할 일을 백업 파일로 내려받았어요.');
  }
  const dateNav = (
    <div className="date-nav">
      <label className="date-input-label" title="날짜 선택">
        <span className="date-display">{formatDate(date)}</span>
        <input
          aria-label="조회 날짜"
          type="date"
          value={date}
          onClick={(e) => {
            try {
              e.currentTarget.showPicker();
            } catch {
              /* Native date entry remains available. */
            }
          }}
          onChange={(e) => {
            if (e.target.value) goDate(e.target.value);
          }}
        />
      </label>
      <button
        className="icon-button"
        aria-label="이전 날짜"
        onClick={() => goDate(addDays(date, -1))}
      >
        <ChevronLeft size={18} />
      </button>
      <button
        className="icon-button"
        aria-label="다음 날짜"
        onClick={() => goDate(addDays(date, 1))}
      >
        <ChevronRight size={18} />
      </button>
      {date !== today && (
        <button className="text-button" onClick={() => goDate(today)}>
          오늘
        </button>
      )}
    </div>
  );
  const taskCard = (
    <section className="glass-card tasks-card" aria-labelledby="tasks-heading">
      <CompletionSparkles
        done={totalProgress.done}
        total={totalProgress.total}
        scope={`${date}:${planner.workspace?.id}:${tasks.map((task) => task.id).join(',')}`}
        ready={!loading && Boolean(planner.session)}
      />
      <div className="card-header">
        <h2 id="tasks-heading">
          <span className="section-icon">
            <SquareCheckBig size={21} strokeWidth={1.9} />
          </span>
          {date === today ? '오늘 할 일' : '이날 할 일'}
        </h2>
        {tasks.length > 0 && (
          <div className="task-progress">
            <span className="progress-copy" aria-live="polite" aria-atomic="true">
              <b key={totalProgress.done}>{totalProgress.done}</b> / {totalProgress.total} 완료
            </span>
            <DayProgressRing
              progress={totalProgress}
              label={date === today ? '오늘 진행률' : '이날 진행률'}
            />
          </div>
        )}
        <button
          className="add-button"
          aria-label="할 일 추가"
          disabled={busy || loading}
          onClick={() => setModal({ kind: canWrite ? 'task' : 'account' })}
        >
          <Plus size={24} strokeWidth={1.9} />
        </button>
      </div>
      {tasks.length ? (
        <ul className="task-list">
          {tasks.map((task) => (
            <li key={task.id} className="task-swipe-item">
              <SwipeRow
                title={task.title}
                contentClassName={`task-row ${completed.has(task.id) ? 'is-complete' : ''}`}
                open={swipeMenu?.id === task.id ? swipeMenu.side : null}
                disabled={!canWrite || busy || loading}
                onOpenChange={(side) =>
                  setSwipeMenu(
                    side
                      ? { id: task.id, side }
                      : (current) => (current?.id === task.id ? null : current),
                  )
                }
                onAdd={() => {
                  setSwipeMenu(null);
                  setModal({ kind: 'task' });
                }}
                onDelete={() => {
                  setSwipeMenu(null);
                  requestDelete(task);
                }}
              >
                <SpringCheck
                  className="task-checkbox"
                  checked={completed.has(task.id)}
                  ariaLabel={`${task.title} 완료`}
                  color="var(--text)"
                  boxSize={28}
                  boxRadius={9}
                  doneOpacity={0.72}
                  labelSelector=".task-title .spring-check__label"
                  disabled={!canWrite || busy}
                  onChange={() => void act(() => planner.toggleTask(task.id))}
                />
                <div className="task-copy">
                  <div className="task-heading">
                    <button
                      className="task-title"
                      aria-label={`${task.title} 상세 보기`}
                      onClick={() => setModal({ kind: 'task', item: task })}
                    >
                      <SpringCheckLabel checked={completed.has(task.id)}>
                        {task.title}
                      </SpringCheckLabel>
                    </button>
                    {(data.attachments || []).filter(
                      (file) => file.task_id === task.id && file.state === 'ready',
                    ).length > 0 && (
                      <span
                        className="task-file-count"
                        aria-label={`첨부 파일 ${(data.attachments || []).filter((file) => file.task_id === task.id && file.state === 'ready').length}개`}
                      >
                        <Paperclip size={13} />
                        {
                          (data.attachments || []).filter(
                            (file) => file.task_id === task.id && file.state === 'ready',
                          ).length
                        }
                      </span>
                    )}
                  </div>
                  {task.details.length > 0 && (
                    <ul className="task-details" aria-label={`${task.title} 세부 항목`}>
                      {task.details.map((detail, index) => {
                        const detailId =
                          task.detailChecks?.[index]?.id || `${task.id}-detail-${index}`;
                        const recordKey = `${task.id}:${detailId}`;
                        const expanded = openRecords.has(recordKey);
                        const hasRecord = (data.taskNotes || []).some(
                          (note) =>
                            note.task_id === task.id &&
                            readDetailNote(note.body).detailId === detailId,
                        );
                        return (
                          <li
                            key={detailId}
                            className={`${task.detailChecks?.[index]?.completed ? 'detail-is-complete' : ''} ${expanded ? 'detail-is-expanded' : ''}`}
                          >
                            <div className="detail-row-main">
                              <SpringCheck
                                className="detail-checkbox"
                                ariaLabel={`${task.title} 세부 항목 ${index + 1} 완료`}
                                checked={Boolean(task.detailChecks?.[index]?.completed)}
                                color="var(--text)"
                                boxSize={20}
                                boxRadius={6}
                                doneOpacity={0.72}
                                labelSelector=".detail-row-title .spring-check__label"
                                disabled={!canWrite || busy}
                                onChange={() =>
                                  void act(() => planner.toggleDetail(task.id, detailId))
                                }
                              />
                              <span className="detail-row-title">
                                <SpringCheckLabel
                                  checked={Boolean(task.detailChecks?.[index]?.completed)}
                                >
                                  {detail}
                                </SpringCheckLabel>
                              </span>
                              <button
                                className="detail-record-toggle"
                                aria-label={`${detail} 기록 ${expanded ? '접기' : '열기'}`}
                                aria-expanded={expanded}
                                onClick={() =>
                                  setOpenRecords((current) => {
                                    const next = new Set(current);
                                    if (next.has(recordKey)) next.delete(recordKey);
                                    else next.add(recordKey);
                                    return next;
                                  })
                                }
                              >
                                기록
                                {hasRecord && (
                                  <span className="record-dot" aria-label="기록 있음" />
                                )}
                                <ChevronRight size={14} />
                              </button>
                            </div>
                            {expanded && (
                              <DetailRecord task={task} detailId={detailId} planner={planner} />
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {task.details.length > 0 && (
                    <TaskProgress
                      progress={taskProgress(task, completed)}
                      label={`${task.title} 진행률`}
                    />
                  )}
                </div>
              </SwipeRow>
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
              disabled={busy || loading}
              onClick={() => setModal({ kind: canWrite ? 'task' : 'account' })}
            >
              <Plus size={16} />첫 할 일 적기
            </button>
          }
        />
      )}
      {!isOwner && (
        <p className="card-footnote">이 공간에 참여한 사람은 함께 완료 체크를 할 수 있어요.</p>
      )}
      {!planner.session && (
        <div className="editing-notice">
          <LockKeyhole size={14} />
          <span>
            {data.hasSamples
              ? '예시 일정이에요. 로그인하고 나의 하루를 시작해 보세요.'
              : '로그인 후 할 일을 편집할 수 있어요.'}
          </span>
          <button className="text-button" onClick={() => setModal({ kind: 'account' })}>
            로그인
          </button>
        </div>
      )}
      {planner.session && (
        <p className="save-note">
          <CircleCheck size={13} />
          {planner.lastSaved ? '공유 공간에 저장되어 있어요' : '공유 기록'}
          <span>SEOUL (KST)</span>
        </p>
      )}
    </section>
  );

  const content = (
    <div className="app-shell">
      <div className="scenery" aria-hidden="true" />
      <button className="brand mobile-brand" aria-label="Dayly 홈" onClick={() => goView('home')}>
        Dayly<span className="brand-dot">.</span>
      </button>
      <aside className="sidebar">
        <button className="brand" aria-label="Dayly 홈" onClick={() => goView('home')}>
          Dayly<span className="brand-dot">.</span>
        </button>
        <nav aria-label="주 메뉴" data-active={view}>
          {navigation.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`nav-button ${view === id ? 'active' : ''}`}
              aria-current={view === id ? 'page' : undefined}
              aria-label={label}
              title={label}
              onClick={() => goView(id)}
            >
              <Icon size={25} strokeWidth={1.7} />
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
        <button
          key={atmosphere}
          className="icon-button atmosphere-toggle"
          aria-label={atmosphere === 'morning' ? '밤 공부로 전환' : '아침 창가로 전환'}
          onClick={() => setAtmosphere(atmosphere === 'morning' ? 'night' : 'morning')}
        >
          {atmosphere === 'morning' ? (
            <Moon size={20} strokeWidth={1.7} />
          ) : (
            <Sun size={20} strokeWidth={1.7} />
          )}
        </button>
        <button className="mode-chip" onClick={() => goView('settings')}>
          <span className={`status-dot ${planner.session ? 'online' : ''}`} />
          {planner.session ? (isOwner ? '내 공간' : '승인받은 공간') : '로그인 전'}
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
          aria-label="할 일 검색"
          onClick={() => {
            setSearch('');
            setModal({ kind: 'search' });
          }}
        >
          <Search size={22} strokeWidth={1.8} />
        </button>
        <button
          className="profile-button"
          aria-label="내 계정"
          onClick={() => setModal({ kind: 'account' })}
        >
          <UserRound size={22} strokeWidth={1.8} />
        </button>
      </header>
      <main className={`main-content view-${view}`}>
        {planner.notice && (
          <div className="error-banner" role="status">
            <span>{planner.notice}</span>
            <button
              className="icon-button"
              aria-label="접근 안내 닫기"
              onClick={() => planner.setNotice('')}
            >
              <X size={17} />
            </button>
          </div>
        )}
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
              <strong>내 공간을 아직 불러오지 못했어요.</strong>
              <p>새로고침하면 내 공간을 자동으로 준비하고 승인받은 공간을 확인합니다.</p>
            </div>
            <button
              className="soft-button"
              disabled={busy}
              onClick={() => void act(planner.refresh, '공간을 다시 확인했어요.')}
            >
              다시 불러오기
            </button>
          </div>
        )}
        {planner.session && planner.workspace && view !== 'settings' && (
          <WorkspacePanel planner={planner} compact />
        )}
        <div className="home-layout" hidden={view !== 'home'} inert={view !== 'home'}>
          <div className="daily-column">
            <div className="page-heading">
              {dateNav}
              <h1 id={view === 'home' ? 'planner' : undefined} tabIndex={-1}>
                {displayName
                  ? `${displayName}님의 계획`
                  : date === today
                    ? '오늘의 계획'
                    : '하루의 계획'}
              </h1>
            </div>
            {taskCard}
          </div>
          <aside className="moment planner-moment" aria-label="시계와 공부 공간 분위기">
            <span className="moment-label">SEOUL / KST</span>
            <time
              className="live-clock"
              dateTime={now.toISOString()}
              aria-label={`현재 시각 ${clock}`}
            >
              {clock}
            </time>
            <p>{formatDate(today, true)}</p>
            <AtmospherePicker value={atmosphere} onChange={setAtmosphere} compact />
          </aside>
        </div>
        {view === 'calendar' && (
          <div className="wide-page">
            <div className="page-heading">
              <p className="eyebrow">MY DAYS</p>
              <h1 id="planner" tabIndex={-1}>
                하루하루, 쌓이는 나의 기록.
              </h1>
              <p className="page-description">날짜를 누르면 그날의 할 일을 볼 수 있어요.</p>
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
                    progress = dayProgress(dailyTasks, completed),
                    remaining = progress.total - progress.done;
                  return (
                    <button
                      key={value}
                      className={`calendar-day ${value.slice(0, 7) !== month.slice(0, 7) ? 'outside-month' : ''} ${value === today ? 'is-today' : ''} ${value === date ? 'selected-day' : ''} ${dailyTasks.length ? 'has-tasks' : ''} ${dailyTasks.length && progress.done === progress.total ? 'is-complete-day' : ''}`}
                      aria-label={`${formatDate(value)} 세부 항목 ${progress.total}개 중 ${progress.done}개 완료, ${progress.percent}%, 남은 계획 ${remaining}개`}
                      onClick={() => goDate(value)}
                    >
                      <span className="day-number">{Number(value.slice(8))}</span>
                      {remaining > 0 && (
                        <span className="calendar-remaining" aria-hidden="true">
                          <span className="calendar-remaining-label">남은 </span>
                          {remaining}
                        </span>
                      )}
                      {dailyTasks.length > 0 && (
                        <span className="calendar-progress-track" aria-hidden="true">
                          <i style={{ width: `${progress.percent}%` }} />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <p className="card-footnote">
                <span className="legend-dot" />
                오늘 <span className="legend-square" />
                선택한 날 · 막대는 진행률, 숫자는 남은 계획
              </p>
            </section>
          </div>
        )}
        {view === 'stats' && (
          <div className="wide-page">
            <div className="page-heading">
              <p className="eyebrow">YOUR LITTLE PROGRESS</p>
              <h1 id="planner" tabIndex={-1}>
                꾸준함이 보여요.
              </h1>
              <p className="page-description">작은 계획을 얼마나 꾸준히 실천했는지 살펴봐요.</p>
            </div>
            <div className="section-toolbar">{dateNav}</div>
            <Stats data={data} date={date} />
            <p className="stats-note">
              선택한 날까지 최근 7일의 세부 항목 완료 상태를 집계합니다.
              {data.hasSamples && !planner.session && ' 현재 예시 일정이 포함되어 있어요.'}
            </p>
          </div>
        )}
        {view === 'settings' && (
          <div className="wide-page settings-page">
            <div className="page-heading">
              <p className="eyebrow">MAKE IT YOURS</p>
              <h1 id="planner" tabIndex={-1}>
                나에게 맞는 공부 공간.
              </h1>
              <p className="page-description">기록을 보관하고, 함께 공부할 사람을 관리해요.</p>
            </div>
            <section className="glass-card settings-card atmosphere-settings">
              <h2>
                <Sun size={19} />
                공부 공간의 분위기
              </h2>
              <p className="setting-description">오늘의 공부에 어울리는 빛을 골라 보세요.</p>
              <AtmospherePicker value={atmosphere} onChange={setAtmosphere} />
              <p className="atmosphere-note">이 브라우저에 선택한 분위기를 기억해요.</p>
            </section>
            <section className="glass-card settings-card">
              <h2>
                <UserRound size={19} />
                나의 이름
              </h2>
              <form
                className="inline-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!canWrite) return;
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
                  disabled={!canWrite}
                  maxLength={20}
                  placeholder="인사말에 사용할 이름"
                  defaultValue={displayName}
                />
                <button className="soft-button" type="submit" disabled={!canWrite}>
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
                    {planner.session ? planner.session.user.email : '로그인하면 편집할 수 있어요'}
                  </strong>
                  <p>
                    {planner.session
                      ? '승인된 사람과 같은 공간의 기록을 공유합니다.'
                      : '이메일과 비밀번호로 로그인하면 나의 공간 또는 승인된 공유 공간에 저장합니다.'}
                  </p>
                </div>
                <button className="soft-button" onClick={() => setModal({ kind: 'account' })}>
                  {planner.session ? '계정 보기' : '로그인 / 회원가입'}
                </button>
              </div>
              {planner.session && <WorkspacePanel planner={planner} />}
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
                      승인한 이메일로 로그인한 사람은 할 일을 작성하고 함께 완료 체크할 수 있어요.
                      제목·날짜는 작성자와 공간 관리자만 수정할 수 있어요. 승인된 참여자는 계획을
                      삭제하거나 접근 가능한 다른 공간으로 이동할 수 있습니다.
                    </p>
                    <MemberForm
                      disabled={!planner.canManageMembers || busy}
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
                              disabled={!planner.canManageMembers || busy}
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
                  <p>공유 계정을 연결하면 이메일로 작성자를 승인할 수 있어요.</p>
                  <span>로그인하고 나의 공간을 만들면 시작할 수 있어요.</span>
                </div>
              )}
            </section>
            <section className="glass-card settings-card">
              <h2>
                <Download size={19} />
                나의 기록 보관
              </h2>
              <p className="setting-description">
                현재 공간의 할 일과 수행 내용, 파일 목록을 JSON으로 보관합니다. 파일 원본은 포함되지
                않으니 각 파일의 내려받기를 이용해 주세요. 이전 개인 기록은 로그인 전에 보관할 수
                있어요.
              </p>
              <div className="backup-actions">
                <button
                  className="soft-button"
                  onClick={exportData}
                  disabled={Boolean(planner.session) && !planner.canManageRecords}
                >
                  <Download size={16} />
                  백업 내려받기
                </button>
              </div>
            </section>
            {planner.session && planner.workspace && (
              <DataProtection
                key={`${planner.session.user.id}:${planner.workspace.id}`}
                planner={planner}
              />
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
            if (!busy && !taskDetailBusy) setModal(null);
          }}
        >
          <TaskDetail
            key={modal.item?.id || 'new'}
            item={
              modal.item
                ? data.tasks.find((task) => task.id === modal.item!.id) || modal.item
                : undefined
            }
            date={date}
            planner={planner}
            onBusyChange={setTaskDetailBusy}
            editable={canManageTask(modal.item)}
            onLogin={
              !planner.session || planner.passwordRecovery
                ? () => setModal({ kind: 'account' })
                : undefined
            }
            onDone={() => {
              setModal(null);
              setToast('할 일을 저장했어요.');
            }}
            onDelete={
              modal.item && planner.canWrite
                ? () => {
                    const item = modal.item!;
                    setModal(null);
                    requestDelete(item);
                  }
                : undefined
            }
            onMoved={(name) => {
              setModal(null);
              setToast(name + '로 이동했습니다.');
            }}
            onDuplicated={(copy) => {
              goDate(copy.date);
              setToast(`${planner.workspace?.name}에 계획을 복제했어요.`);
            }}
          />
        </Modal>
      )}
      {modal?.kind === 'account' && (
        <Modal
          title={planner.session ? '나의 계정' : '공부를 이어 가는 계정'}
          subtitle={
            planner.session
              ? '같은 계정으로 로그인하면 다른 기기에서도 기록을 볼 수 있어요.'
              : '이메일과 비밀번호로 나의 공부 공간에 들어가요.'
          }
          onClose={() => setModal(null)}
        >
          <Account
            key={planner.passwordRecovery ? 'recovery' : 'account'}
            recovery={planner.passwordRecovery}
            onRecoveryDone={planner.completePasswordRecovery}
            sessionEmail={planner.session?.user.email}
            onDone={() => setModal(null)}
            onToast={setToast}
          />
        </Modal>
      )}
      {modal?.kind === 'search' && (
        <Modal
          title="나의 할 일 찾기"
          subtitle="할 일 제목과 세부 항목으로 찾아보세요."
          onClose={() => setModal(null)}
        >
          <div className="search-input">
            <Search size={20} />
            <input
              aria-label="할 일 검색어"
              type="search"
              placeholder="어떤 할 일을 찾고 있나요?"
              maxLength={100}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
          </div>
          {search.trim() ? (
            <div className="search-results">
              {searchMatches.slice(0, 50).map((task) => (
                <button
                  key={task.id}
                  onClick={() => {
                    setDate(task.date);
                    setModal({ kind: 'task', item: task });
                  }}
                >
                  <span>
                    <small>{task.date}</small>
                    <strong>{task.title}</strong>
                  </span>
                  <ChevronRight size={18} />
                </button>
              ))}
              {searchMatches.length === 0 && (
                <p className="search-empty">일치하는 할 일이 없어요. 다른 단어로 찾아보세요.</p>
              )}
              {searchMatches.length > 50 && (
                <p className="card-footnote">
                  검색 결과 {searchMatches.length}개 중 50개를 보여드려요. 검색어를 더 구체적으로
                  입력해 주세요.
                </p>
              )}
            </div>
          ) : (
            <p className="search-empty">찾고 싶은 할 일이나 세부 항목을 입력해 주세요.</p>
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
  return <WelcomeScreen bypass={planner.passwordRecovery}>{content}</WelcomeScreen>;
}

function MemberForm({
  onSubmit,
  onSuccess,
  disabled = false,
}: {
  onSubmit: (email: string) => Promise<void>;
  onSuccess: () => void;
  disabled?: boolean;
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
          disabled={disabled || busy}
          maxLength={254}
          aria-label="승인할 작성자의 이메일"
          placeholder="함께 쓸 사람의 이메일"
        />
        <button className="soft-button" disabled={busy || disabled} type="submit">
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
  const week = weeklyStats(data, date);
  const selectedTasks = sortedTasks(data.tasks.filter((task) => task.date === date));
  const completed = new Set(data.completedTaskIds);
  const total = week.reduce((sum, day) => sum + day.total, 0),
    done = week.reduce((sum, day) => sum + day.completed, 0);
  const rate = total ? Math.round((done / total) * 100) : 0,
    max = Math.max(1, ...week.map((day) => day.total));
  return (
    <>
      <div className="glass-card stats-summary">
        <div className="stat-tile">
          <span>
            <CheckCheck size={18} />
            완료한 항목
          </span>
          <strong>
            {done}
            {total > 0 && <small> / {total}개</small>}
          </strong>
          <p>{total ? '한 걸음씩 해냈어요.' : '첫 할 일을 적어 보세요.'}</p>
        </div>
        <div className="stat-tile">
          <span>
            <CircleCheck size={18} />
            계획 달성률
          </span>
          <strong>
            {total ? rate : '—'}
            {total > 0 && <small>%</small>}
          </strong>
          <p>{total ? '작은 계획을 실천하는 힘.' : '첫 계획부터 시작해 보세요.'}</p>
        </div>
        <div className="stat-tile">
          <span>
            <Leaf size={18} />
            공부를 해낸 날
          </span>
          <strong>
            {week.filter((day) => day.completed > 0).length}
            <small> / 7일</small>
          </strong>
          <p>작은 꾸준함의 힘.</p>
        </div>
      </div>
      {selectedTasks.length > 0 && (
        <section className="study-flow" aria-label="선택한 날의 학습 흐름">
          <h2>{formatDate(date)}의 학습 흐름</h2>
          {selectedTasks.map((task) => {
            const progress = taskProgress(task, completed);
            return (
              <div className="study-flow-row" key={task.id}>
                <span>{task.title}</span>
                <TaskProgress progress={progress} label={`${task.title} 학습 흐름`} />
              </div>
            );
          })}
        </section>
      )}
      <section className="glass-card chart-card">
        <div className="card-header">
          <h2>지난 7일의 세부 항목</h2>
          {total > 0 && (
            <div className="chart-legend">
              <i />
              완료 <i className="pale" />
              계획
            </div>
          )}
        </div>
        {total > 0 ? (
          <div
            className="bar-chart"
            role="img"
            aria-label={week
              .map((day) => `${day.date}: ${day.total}개 중 ${day.completed}개 완료`)
              .join(', ')}
          >
            {week.map((day) => (
              <div className={`chart-column ${day.total ? '' : 'is-empty'}`} key={day.date}>
                <span className="bar-value">
                  {day.total > 0 && (
                    <>
                      {day.completed}
                      <small>/{day.total}</small>
                    </>
                  )}
                </span>
                <div className="bar-track">
                  <div className="bar-planned" style={{ height: `${(day.total / max) * 100}%` }}>
                    <div
                      className="bar-completed"
                      style={{ height: `${day.total ? (day.completed / day.total) * 100 : 0}%` }}
                    />
                  </div>
                </div>
                <span className={day.date === date ? 'chart-day current' : 'chart-day'}>
                  {shortDay(day.date)}
                </span>
                <small className="chart-date">
                  {Number(day.date.slice(5, 7))}.{Number(day.date.slice(8))}
                </small>
              </div>
            ))}
          </div>
        ) : (
          <Empty
            icon="check"
            title="아직은, 여백이 있는 한 주"
            text="할 일을 적고 하나씩 완료하면 이곳에 나의 흐름이 쌓여요."
          />
        )}
      </section>
    </>
  );
}
