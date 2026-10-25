import { Button } from '@/components/ui/button';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  CalendarDays,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Download,
  Upload,
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
  CircleAlert,
  Bell,
  BellOff,
  Timer,
} from 'lucide-react';
import {
  addDays,
  dateObject,
  formatDate,
  importablePlans,
  parseSnapshot,
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
import TaskDetail from './TaskDetail';
import QuickAdd from './QuickAdd';
import { TaskProgress, DayProgressRing } from './TaskProgress';
import WorkspacePanel from './WorkspacePanel';
import DetailRecord from './DetailRecord';
import { AtmospherePicker, CompletionSparkles, useAtmosphere } from './Atmosphere';
import WelcomeScreen from './WelcomeScreen';
import { pushEntryNavigation, readEntryNavigation, saveEntryNavigation } from './entryNavigation';
import PlanActions from './PlanActions';
import SwipeAction from './SwipeAction';
import { useDraftUnloadGuard } from './recordDrafts';
import LoadingStatus from './LoadingStatus';
import PlannerBackground from './PlannerBackground';
import SpringCheck, { SpringCheckLabel } from './SpringCheck';
import FocusClock from './FocusClock';
import SquishSwitch from './SquishSwitch';
import { useAlarmEnabled } from './focusAlarm';

// Screens that only open on request are fetched on request.
const Account = lazy(() => import('./Account'));
const DataProtection = lazy(() => import('./DataProtection'));
const TaskHistory = lazy(() => import('./TaskHistory'));

type View = 'home' | 'calendar' | 'stats' | 'settings';
type ModalState =
  | {
      kind: 'task';
      item?: Task;
      addDetailAfter?: string;
      initialAction?: 'edit' | 'duplicate' | 'move';
    }
  | { kind: 'quick'; taskId?: string; afterDetailId?: string }
  | { kind: 'search' }
  | { kind: 'account' }
  | { kind: 'history' }
  | null;
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
  className = '',
  showHeader = true,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
  showHeader?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const el = ref.current!;
    const previousFocus = document.activeElement;
    el.showModal();
    el.querySelector<HTMLInputElement>('[autofocus], input[type=search]')?.focus();
    return () => {
      if (el.open) el.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
        previousFocus.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${className}`}
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
        <h2 id={titleId} className={showHeader ? undefined : 'sr-only'}>
          {title}
        </h2>
        {showHeader && subtitle && <p className="modal-subtitle">{subtitle}</p>}
        {/* The frame and its title appear at once; screens fetched on demand fill in. */}
        <Suspense fallback={<p className="loading-note">불러오는 중이에요.</p>}>
          {children}
        </Suspense>
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
/** The minute hand owns its own state so the planner is not redrawn with it. */
function LiveClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 10000);
    return () => clearInterval(timer);
  }, []);
  const clock = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(now);
  return (
    <time className="live-clock" dateTime={now.toISOString()} aria-label={`현재 시각 ${clock}`}>
      {clock}
    </time>
  );
}

/** Entry and exit for the plan list. A reader who asked for less motion gets
 *  the same list with every value flattened rather than a second code path,
 *  so the markup and the ordering never diverge between the two.
 *
 *  Deliberately no `layout` prop: motion animates a size change by scaling the
 *  element, and on a wrapped Korean title that squashes the glyphs for the
 *  length of the animation. Plans below a deleted one settle without a tween
 *  rather than passing through distorted text. */
function useListMotion() {
  const reduce = useReducedMotion();
  return useMemo(() => {
    if (reduce)
      return {
        initial: false as const,
        exit: { opacity: 0 },
        spring: { duration: 0 },
        delay: () => 0,
      };
    return {
      initial: { opacity: 0, y: -6 },
      exit: { opacity: 0, scale: 0.97 },
      spring: { type: 'spring' as const, visualDuration: 0.26, bounce: 0.18 },
      // Six steps is enough to read as unfolding; beyond that a long day
      // would just feel slow to arrive.
      delay: (index: number) => Math.min(index, 6) * 0.032,
    };
  }, [reduce]);
}

/** Holds a cleared message through its exit transition, so status surfaces
 *  fade out with their text instead of emptying first. */
function useLingering(value: string, linger = 240) {
  const [shown, setShown] = useState(value);
  useEffect(() => {
    if (value) {
      setShown(value);
      return undefined;
    }
    const timer = window.setTimeout(() => setShown(''), linger);
    return () => window.clearTimeout(timer);
  }, [value, linger]);
  return shown;
}

export default function App() {
  useDraftUnloadGuard();
  const [atmosphere, setAtmosphere] = useAtmosphere();
  const [alarmEnabled, setAlarmEnabled] = useAlarmEnabled();
  const planner = usePlanner();
  const { data, isOwner, canWrite, busy, loading } = planner;
  const [view, setView] = useState<View>(() => readEntryNavigation().view || 'home');
  const [date, setDate] = useState(() => readEntryNavigation().date || todayKey());
  const [taskDetailDirty, setTaskDetailDirty] = useState(false);
  const [actionError, setActionError] = useState('');
  const [pending, setPending] = useState<Set<string>>(() => new Set());
  const listMotion = useListMotion();
  const retryAction = useRef<(() => Promise<unknown>) | null>(null);
  const closePlanMenus = () => window.dispatchEvent(new Event('dayly:cancel-actions'));
  const livePlanner = useRef(planner);
  livePlanner.current = planner;
  const [month, setMonth] = useState(
    () => readEntryNavigation().month || todayKey().slice(0, 7) + '-01',
  );
  // The first render adopts the address it was opened with; every later screen or
  // date becomes its own history entry so back returns where the reader came from.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) pushEntryNavigation({ view, date, month, scroll: 0 });
    else {
      started.current = true;
      saveEntryNavigation({ view, date, month, scroll: window.scrollY });
    }
  }, [view, date, month]);
  const [modal, setModal] = useState<ModalState>(null);
  const swipeScope = `${planner.session?.user.id}:${planner.workspace?.id}:${date}:${view}:${modal?.kind || ''}`;
  const [openRecords, setOpenRecords] = useState<Set<string>>(() => new Set());
  const [taskDetailBusy, setTaskDetailBusy] = useState(false);
  useEffect(() => {
    setModal((current) =>
      current?.kind === 'task' ||
      current?.kind === 'quick' ||
      current?.kind === 'search' ||
      current?.kind === 'history'
        ? null
        : current,
    );
  }, [planner.workspace?.id, planner.session?.user.id]);
  // Toasts queue instead of overwriting, so a burst of checks stays readable.
  const [toasts, setToasts] = useState<string[]>([]);
  const toast = toasts[0] || '';
  const shownToast = useLingering(toast);
  const setToast = useCallback(
    (message: string) =>
      setToasts((queue) => (queue[queue.length - 1] === message ? queue : [...queue, message])),
    [],
  );
  const [search, setSearch] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [confirmation, setConfirmation] = useState<{
    title: string;
    label?: string;
    success?: string;
    cancelLabel?: string;
    message: string;
    action: () => Promise<void>;
  } | null>(null);
  const [confirmationError, setConfirmationError] = useState('');
  useEffect(() => setConfirmationError(''), [confirmation]);
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
    if (!toast) return;
    // A message already waiting shortens the one on screen, so a burst of checks
    // shows every result without holding the corner of the screen for long.
    const timer = window.setTimeout(
      () => setToasts((queue) => queue.slice(1)),
      toasts.length > 1 ? 2400 : 3600,
    );
    return () => clearTimeout(timer);
  }, [toast, toasts.length]);
  // Typing settles before the whole record is searched.
  useEffect(() => {
    const timer = window.setTimeout(() => setSearchQuery(search.trim().toLowerCase()), 150);
    return () => clearTimeout(timer);
  }, [search]);
  const today = todayKey();
  const tasks = useMemo(
    () => sortedTasks(data.tasks.filter((x) => x.date === date)),
    [data.tasks, date],
  );
  const completed = useMemo(() => new Set(data.completedTaskIds), [data.completedTaskIds]);
  const totalProgress = useMemo(() => dayProgress(tasks, completed), [tasks, completed]);
  // Searching only runs while the search screen is open and a word is entered.
  const searching = modal?.kind === 'search' && Boolean(searchQuery);
  const searchMatches = useMemo(
    () =>
      searching
        ? data.tasks.filter((task) =>
            `${task.title} ${task.details.join(' ')}`.toLowerCase().includes(searchQuery),
          )
        : [],
    [searching, searchQuery, data.tasks],
  );
  const canManageTask = (item?: Task) =>
    Boolean(planner.session && planner.workspace) &&
    !planner.passwordRecovery &&
    (!item || isOwner || item.created_by === planner.session?.user.id);
  // `pendingKey` names the row the work belongs to, so waiting shows where it
  // happens instead of only dimming every control at once.
  const act = async (action: () => Promise<unknown>, success?: string, pendingKey?: string) => {
    if (pendingKey) setPending((current) => new Set(current).add(pendingKey));
    try {
      await action();
      setActionError('');
      retryAction.current = null;
      if (success) setToast(success);
    } catch (e) {
      retryAction.current = action;
      setActionError((e as Error).message || '저장하지 못했습니다. 다시 시도해 주세요.');
    } finally {
      if (pendingKey)
        setPending((current) => {
          const next = new Set(current);
          next.delete(pendingKey);
          return next;
        });
    }
  };
  const goDate = (next: string) => {
    closePlanMenus();
    setDate(next);
    if (view === 'calendar') setView('home');
    setModal(null);
  };
  const goView = (next: View) => {
    closePlanMenus();
    setView(next);
    if (next === 'calendar') setMonth(date.slice(0, 7) + '-01');
    requestAnimationFrame(() => {
      const heading = document.getElementById('planner');
      heading?.scrollIntoView({ block: 'start', behavior: 'instant' });
      heading?.focus({ preventScroll: true });
    });
  };
  // Back and forward restore the screen and date recorded in that history entry.
  useEffect(() => {
    const restore = () => {
      const entry = readEntryNavigation();
      closePlanMenus();
      setModal(null);
      setView(entry.view || 'home');
      setDate(entry.date || todayKey());
      if (entry.month) setMonth(entry.month);
    };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);
  // Everyday keys for a tool opened every morning. Physical codes keep these
  // working on a Korean keyboard layout and while an IME is composing.
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (modal || confirmation) return;
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || /^(input|textarea|select)$/i.test(target?.tagName || ''))
        return;
      // The decorative entry owns the keyboard until the planner is open.
      if (document.querySelector('.entry-flow')?.getAttribute('data-entered') !== 'true') return;
      if (event.code === 'Slash') {
        event.preventDefault();
        setSearch('');
        setModal({ kind: 'search' });
      } else if (event.code === 'KeyN') {
        if (busy || loading) return;
        event.preventDefault();
        setModal({ kind: canWrite ? 'task' : 'account' });
      } else if (view === 'home' && (event.code === 'ArrowLeft' || event.code === 'ArrowRight')) {
        event.preventDefault();
        goDate(addDays(date, event.code === 'ArrowLeft' ? -1 : 1));
      }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modal, confirmation, view, date, canWrite, busy, loading]);
  const confirmDiscard = (discard: () => void) =>
    setConfirmation({
      title: '작성 중인 기록이 있어요',
      label: '기록 버리기',
      cancelLabel: '계속 작성',
      message: '아직 저장하지 않은 글과 선택 파일이 있어요. 계속 작성하거나 버릴 수 있어요.',
      action: async () => discard(),
    });
  const requestDelete = (item: Task) =>
    setConfirmation({
      title: '계획을 휴지통으로 보낼까요?',
      label: '휴지통으로 이동',
      success: '계획을 휴지통으로 옮겼어요.',
      message:
        '“' +
        item.title +
        '”을 현재 목록에서 삭제합니다. 내용과 기록, 첨부 원본은 보관되며 설정의 휴지통에서 복원할 수 있어요.',
      action: () => planner.deleteTask(item.id),
    });
  const deleteDetail = async (taskId: string, detailId: string) => {
    const current = livePlanner.current;
    const task = current.data.tasks.find((item) => item.id === taskId);
    const index = task?.detailChecks?.findIndex((detail) => detail.id === detailId) ?? -1;
    if (!task || index < 0)
      throw new Error('세부 항목이 이미 변경되었어요. 목록을 다시 확인해 주세요.');
    await current.saveTask(
      {
        ...task,
        details: task.details.filter((_, i) => i !== index),
        detailChecks: task.detailChecks?.filter((_, i) => i !== index),
      },
      true,
    );
  };
  const importInput = useRef<HTMLInputElement>(null);
  async function importData(file: File) {
    const session = planner.session,
      space = planner.workspace;
    if (!session || !space) return;
    let backup;
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error();
      backup = parseSnapshot(JSON.parse(await file.text()));
    } catch {
      setActionError('Dayly에서 내려받은 백업 JSON 파일인지 확인해 주세요.');
      return;
    }
    const { plans, skipped } = importablePlans(backup, data.tasks, session.user.id, space.id);
    if (!plans.length) {
      setToast(
        skipped
          ? `백업의 계획 ${skipped}개가 이미 “${space.name}”에 있어요.`
          : '백업 파일에 가져올 계획이 없어요.',
      );
      return;
    }
    setConfirmation({
      title: '백업에서 계획을 가져올까요?',
      label: `${plans.length}개 가져오기`,
      success: `계획 ${plans.length}개를 가져왔어요.`,
      message:
        `“${space.name}”에 계획 ${plans.length}개를 새로 추가합니다.` +
        (skipped ? ` 이미 있는 ${skipped}개는 건너뛰어요.` : '') +
        ' 제목·날짜·세부 항목만 가져오고 완료 상태와 기록, 첨부는 가져오지 않아요. 기존 계획은 바뀌지 않아요.',
      action: async () => {
        await planner.importTasks(plans);
      },
    });
  }
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
        <Button variant="ghost" size="sm" className="text-button" onClick={() => goDate(today)}>
          오늘
        </Button>
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
              실행 항목 <b>{totalProgress.done}</b> / {totalProgress.total} 완료
            </span>
            <DayProgressRing
              progress={totalProgress}
              label={date === today ? '오늘 진행률' : '이날 진행률'}
            />
          </div>
        )}
        <Button
          variant="default"
          size="icon"
          className="add-button"
          aria-label="할 일 추가"
          title="계획 추가"
          disabled={busy || loading}
          onClick={() => setModal({ kind: canWrite ? 'task' : 'account' })}
        >
          <Plus size={24} strokeWidth={1.9} />
        </Button>
      </div>
      {tasks.length ? (
        <ul className="task-list">
          {/* popLayout takes a leaving plan out of flow so it fades in place
              rather than holding its row open while the list waits for it. */}
          <AnimatePresence initial={false} mode="popLayout">
            {tasks.map((task, index) => (
              <motion.li
                key={task.id}
                className="task-swipe-item"
                initial={listMotion.initial}
                animate={{
                  opacity: 1,
                  y: 0,
                  transition: { ...listMotion.spring, delay: listMotion.delay(index) },
                }}
                exit={listMotion.exit}
                transition={listMotion.spring}
              >
                <div
                  data-task-id={task.id}
                  data-pending={pending.has(task.id) || undefined}
                  className={`task-row ${completed.has(task.id) ? 'is-complete' : ''}`}
                >
                  <SpringCheck
                    className="task-checkbox"
                    checked={completed.has(task.id)}
                    ariaLabel={`${task.title} 완료`}
                    color="var(--text)"
                    boxSize={22}
                    boxRadius={5}
                    doneOpacity={0.72}
                    labelSelector=".task-title .spring-check__label"
                    disabled={!canWrite || busy}
                    onChange={() => void act(() => planner.toggleTask(task.id), undefined, task.id)}
                  />
                  <div className="task-copy">
                    <SwipeAction
                      title={task.title}
                      scope={swipeScope}
                      disabled={!canWrite || busy || loading}
                      contentClassName="task-heading"
                      onAdd={() => setModal({ kind: 'quick' })}
                      onDelete={() =>
                        act(
                          () => livePlanner.current.deleteTask(task.id),
                          '계획을 휴지통으로 옮겼어요.',
                          task.id,
                        )
                      }
                    >
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
                      <PlanActions
                        title={task.title}
                        date={task.date}
                        disabled={!canWrite || busy || loading}
                        onAction={(initialAction) =>
                          setModal({ kind: 'task', item: task, initialAction })
                        }
                        onDuplicate={async (copyDate) => {
                          const copy = await planner.duplicateTask(task.id, copyDate);
                          goDate(copy.date);
                          setToast(
                            `${Number(copy.date.slice(5, 7))}월 ${Number(copy.date.slice(8))}일에 계획을 복제했어요.`,
                          );
                        }}
                        onDelete={() => requestDelete(task)}
                      />
                    </SwipeAction>
                    {task.details.length > 0 && (
                      <ul className="task-details" aria-label={`${task.title} 세부 항목`}>
                        {task.details.map((detail, index) => {
                          const detailId =
                            task.detailChecks?.[index]?.id || `${task.id}-detail-${index}`;
                          const recordKey = `${task.id}:${detailId}`;
                          const expanded = openRecords.has(recordKey);
                          const recordCount = (data.taskNotes || []).filter(
                            (note) =>
                              note.task_id === task.id &&
                              readDetailNote(note.body).detailId === detailId,
                          ).length;
                          return (
                            <li
                              key={detailId}
                              className={`${task.detailChecks?.[index]?.completed ? 'detail-is-complete' : ''} ${expanded ? 'detail-is-expanded' : ''}`}
                            >
                              <SwipeAction
                                title={`${task.title} 세부 항목 ${index + 1}`}
                                scope={swipeScope}
                                disabled={!canWrite || !canManageTask(task) || busy || loading}
                                contentClassName="detail-row-main"
                                onAdd={() =>
                                  setModal({
                                    kind: 'quick',
                                    taskId: task.id,
                                    afterDetailId: detailId,
                                  })
                                }
                                onDelete={() =>
                                  act(
                                    () => deleteDetail(task.id, detailId),
                                    '세부 항목을 삭제했어요.',
                                    task.id,
                                  )
                                }
                              >
                                <SpringCheck
                                  className="detail-checkbox"
                                  ariaLabel={`${task.title} 세부 항목 ${index + 1} 완료`}
                                  checked={Boolean(task.detailChecks?.[index]?.completed)}
                                  color="var(--text)"
                                  boxSize={20}
                                  boxRadius={5}
                                  doneOpacity={0.72}
                                  labelSelector=".detail-row-title .spring-check__label"
                                  disabled={!canWrite || busy}
                                  onChange={() =>
                                    void act(
                                      () => planner.toggleDetail(task.id, detailId),
                                      undefined,
                                      task.id,
                                    )
                                  }
                                />
                                <span className="detail-row-title">
                                  <SpringCheckLabel
                                    checked={Boolean(task.detailChecks?.[index]?.completed)}
                                  >
                                    {detail}
                                  </SpringCheckLabel>
                                </span>
                                <Button
                                  variant="ghost"
                                  size="sm"
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
                                  기록 <span className="record-count">{recordCount}</span>
                                  <ChevronRight size={14} />
                                </Button>
                              </SwipeAction>
                              {expanded && (
                                <DetailRecord
                                  task={task}
                                  detailId={detailId}
                                  planner={planner}
                                  onLogin={() => setModal({ kind: 'account' })}
                                  onConfirmDiscard={confirmDiscard}
                                />
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
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      ) : (
        <Empty
          icon="check"
          title="여백이 있는 하루"
          text="오늘 하고 싶은 공부를 하나씩 적어 보세요."
          action={
            <Button
              variant="secondary"
              size="default"
              className="soft-button"
              disabled={busy || loading}
              onClick={() => setModal({ kind: canWrite ? 'task' : 'account' })}
            >
              <Plus size={16} />첫 할 일 적기
            </Button>
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
          <Button
            variant="ghost"
            size="sm"
            className="text-button"
            onClick={() => setModal({ kind: 'account' })}
          >
            로그인
          </Button>
        </div>
      )}
      {planner.session && (
        <p className="save-note">
          <CircleCheck size={13} />
          {planner.lastSaved ? '공유 공간에 저장되어 있어요' : '공유 기록'}
          <span lang="en">SEOUL (KST)</span>
        </p>
      )}
    </section>
  );

  const content = (
    <div className="app-shell">
      <div className="scenery" aria-hidden="true">
        {view === 'home' && <PlannerBackground atmosphere={atmosphere} paused={Boolean(modal)} />}
      </div>
      <button
        className="brand mobile-brand"
        lang="en"
        aria-label="Dayly 홈"
        onClick={() => goView('home')}
      >
        Dayly<span className="brand-dot">.</span>
      </button>
      <aside className="sidebar">
        <button className="brand" lang="en" aria-label="Dayly 홈" onClick={() => goView('home')}>
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
          <span lang="en">
            one day
            <br />
            at a time
          </span>
        </div>
      </aside>
      <header className="topbar">
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
            <RefreshCw size={19} />
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
        <LoadingStatus loading={loading} />
        {planner.session && !planner.workspace && !loading && (
          <div className="onboarding-banner">
            <ShieldCheck size={21} />
            <div>
              <strong>내 공간을 아직 불러오지 못했어요.</strong>
              <p>새로고침하면 내 공간을 자동으로 준비하고 승인받은 공간을 확인합니다.</p>
            </div>
            <Button
              variant="secondary"
              size="default"
              className="soft-button"
              disabled={busy}
              onClick={() => void act(planner.refresh, '공간을 다시 확인했어요.')}
            >
              다시 불러오기
            </Button>
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
          <div className="planner-side-column">
            <aside className="moment planner-moment" aria-label="시계와 공부 공간 분위기">
              <span className="moment-label" lang="en">
                SEOUL / KST
              </span>
              <LiveClock />
              <AtmospherePicker value={atmosphere} onChange={setAtmosphere} compact />
            </aside>
            <FocusClock visible={view === 'home'} />
          </div>
        </div>
        {view === 'calendar' && (
          <div className="wide-page">
            <div className="page-heading">
              <p className="eyebrow" lang="en">
                MY DAYS
              </p>
              <h1 id="planner" tabIndex={-1}>
                달력
              </h1>
              <p className="page-description">날짜를 누르면 그날의 할 일을 볼 수 있어요.</p>
            </div>
            <section className="glass-card calendar-card">
              <div className="card-header">
                <h2>
                  {month.slice(0, 4)}년 {Number(month.slice(5, 7))}월
                </h2>
                <div className="row-actions">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-button"
                    onClick={() => setMonth(today.slice(0, 7) + '-01')}
                  >
                    이번 달
                  </Button>
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
              <p className="calendar-selection-summary">
                {formatDate(date)}, 남은 실행 항목 {totalProgress.total - totalProgress.done}개
              </p>
              <p className="card-footnote">
                <span className="legend-dot" />
                오늘 <span className="legend-square" />
                선택한 날, 막대는 진행률, 숫자는 남은 계획
              </p>
            </section>
          </div>
        )}
        {view === 'stats' && (
          <div className="wide-page">
            <div className="page-heading">
              <p className="eyebrow" lang="en">
                YOUR LITTLE PROGRESS
              </p>
              <h1 id="planner" tabIndex={-1}>
                학습 흐름
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
              <p className="eyebrow" lang="en">
                MAKE IT YOURS
              </p>
              <h1 id="planner" tabIndex={-1}>
                설정
              </h1>
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
                  if (!canWrite) return;
                  const value = String(
                    new FormData(e.currentTarget).get('displayName') || '',
                  ).trim();
                  try {
                    localStorage.setItem('dayly.displayName', value);
                    setDisplayName(value);
                    setToast('인사말에 사용할 이름을 저장했어요.');
                  } catch {
                    setActionError('이름을 저장하지 못했어요. 브라우저 저장 권한을 확인해 주세요.');
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
                <Button
                  variant="secondary"
                  size="default"
                  className="soft-button"
                  type="submit"
                  disabled={!canWrite}
                >
                  저장
                </Button>
              </form>
            </section>
            <section className="glass-card settings-card">
              <h2>
                <Timer size={19} />
                타이머 알림
              </h2>
              <div className="setting-row">
                <div>
                  <strong>시간이 끝나면 알려주기</strong>
                  <p>
                    타이머가 끝나면 짧은 알림음과 진동으로 알려줘요. 브라우저에서 알림을 허용하면
                    다른 탭을 보고 있어도 확인할 수 있어요.
                  </p>
                </div>
                <SquishSwitch
                  checked={alarmEnabled}
                  onChange={setAlarmEnabled}
                  ariaLabel="타이머 종료 알림"
                  trackColor="#27272a"
                  trackOnColor="#f5f5f5"
                  thumbColor="#f5f5f5"
                  thumbOnColor="#27272a"
                  width={64}
                  height={34}
                  radius={17}
                  thumbContent={alarmEnabled ? <Bell size={15} /> : <BellOff size={15} />}
                />
              </div>
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
                <Button
                  variant="secondary"
                  size="default"
                  className="soft-button"
                  onClick={() => setModal({ kind: 'account' })}
                >
                  {planner.session ? '계정 보기' : '로그인 / 회원가입'}
                </Button>
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
                      제목과 날짜는 작성자와 공간 관리자만 수정할 수 있어요. 승인된 참여자는 계획을
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
                                  label: '참여 권한 해제',
                                  success: '이 공간의 참여 권한을 해제했어요.',
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
                현재 공간의 할 일과 수행 내용, 파일 목록을 JSON으로 보관하고 다시 가져옵니다. 파일
                원본은 포함되지 않으니 각 파일의 내려받기를 이용해 주세요. 이전 개인 기록은 로그인
                전에 보관할 수 있어요.
              </p>
              <div className="backup-actions">
                <Button
                  variant="secondary"
                  size="default"
                  className="soft-button"
                  onClick={exportData}
                  disabled={Boolean(planner.session) && !planner.canManageRecords}
                >
                  <Download size={16} />
                  백업 내려받기
                </Button>
                <Button
                  variant="secondary"
                  size="default"
                  className="soft-button"
                  onClick={() => importInput.current?.click()}
                  disabled={!canWrite || busy || loading}
                >
                  <Upload size={16} />
                  백업 가져오기
                </Button>
                <input
                  ref={importInput}
                  type="file"
                  accept="application/json,.json"
                  hidden
                  aria-label="가져올 백업 파일"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (file) void importData(file);
                  }}
                />
              </div>
              <p className="setting-description">
                {canWrite
                  ? '가져오기는 백업 JSON의 계획을 현재 공간에 새 계획으로 추가해요. 같은 날짜·제목·세부 항목의 계획은 건너뛰어요.'
                  : '백업 가져오기는 로그인하고 공간을 선택하면 쓸 수 있어요.'}
              </p>
            </section>
            {planner.session && planner.workspace && (
              <Suspense
                fallback={<p className="loading-note">기록 보호 설정을 불러오는 중이에요.</p>}
              >
                <DataProtection
                  onOpenHistory={() => setModal({ kind: 'history' })}
                  key={`${planner.session.user.id}:${planner.workspace.id}`}
                  planner={planner}
                />
              </Suspense>
            )}
          </div>
        )}
      </main>
      {actionError && (
        <div className="action-error" role="alert">
          <CircleAlert size={18} />
          <span>{actionError}</span>
          {retryAction.current && (
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => {
                const retry = retryAction.current;
                if (retry) void act(retry);
              }}
            >
              다시 시도
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => setActionError('')}>
            닫기
          </Button>
        </div>
      )}
      <div className={`toast ${toast ? 'visible' : ''}`} role="status" aria-live="polite">
        {shownToast && (
          <>
            <CircleCheck size={17} />
            <span>{shownToast}</span>
          </>
        )}
      </div>
      {modal?.kind === 'history' && (
        <Modal
          title="계획 변경 이력"
          subtitle="현재 공간에서 확인할 수 있는 최근 변경 50건입니다."
          onClose={() => setModal(null)}
        >
          <TaskHistory planner={planner} />
        </Modal>
      )}
      {modal?.kind === 'quick' && (
        <Modal
          className="quick-add-modal"
          title={modal.taskId ? '세부 항목 추가' : '계획 추가'}
          onClose={() => {
            if (!busy) setModal(null);
          }}
        >
          <QuickAdd
            planner={planner}
            date={date}
            taskId={modal.taskId}
            afterDetailId={modal.afterDetailId}
            onCancel={() => setModal(null)}
            onDone={(message) => {
              setModal(null);
              setToast(message);
            }}
          />
        </Modal>
      )}
      {modal?.kind === 'task' && (
        <Modal
          title={modal.item ? '계획 상세' : '계획 추가'}
          subtitle="작은 계획 하나가 하루의 방향을 만들어 줘요."
          onClose={() => {
            if (busy || taskDetailBusy) return;
            if (!taskDetailDirty) {
              setModal(null);
              return;
            }
            setConfirmation({
              title: '작성 중인 변경이 있어요',
              message:
                '아직 저장하지 않은 내용과 선택 파일이 있어요. 계속 편집하거나 변경을 버릴 수 있어요.',
              label: '변경 버리기',
              cancelLabel: '계속 편집',
              action: async () => {
                setTaskDetailDirty(false);
                setModal(null);
              },
            });
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
            addDetailAfter={modal.addDetailAfter}
            planner={planner}
            onBusyChange={setTaskDetailBusy}
            onDirtyChange={setTaskDetailDirty}
            initialAction={modal.initialAction}
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
                    if (!taskDetailDirty) {
                      setModal(null);
                      requestDelete(item);
                      return;
                    }
                    // One question, not two: the unsaved draft and the plan go together.
                    setConfirmation({
                      title: '저장하지 않은 변경이 있어요',
                      label: '변경 버리고 휴지통으로',
                      cancelLabel: '계속 편집',
                      success: '계획을 휴지통으로 옮겼어요.',
                      message:
                        '아직 저장하지 않은 내용과 선택 파일이 있어요. 변경을 버리고 “' +
                        item.title +
                        '”을 휴지통으로 옮깁니다. 내용과 기록, 첨부 원본은 보관되며 설정의 휴지통에서 복원할 수 있어요.',
                      action: async () => {
                        await planner.deleteTask(item.id);
                        setTaskDetailDirty(false);
                        setModal(null);
                      },
                    });
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
          className="account-modal"
          showHeader={false}
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
          {searchQuery ? (
            <div className="search-results">
              {searchMatches.slice(0, 50).map((task) => (
                <button
                  key={task.id}
                  onClick={() => {
                    closePlanMenus();
                    setDate(task.date);
                    setView('home');
                    const index = task.details.findIndex((detail) =>
                      detail.toLowerCase().includes(searchQuery),
                    );
                    if (index >= 0)
                      setOpenRecords(
                        (current) =>
                          new Set([
                            ...current,
                            `${task.id}:${task.detailChecks?.[index]?.id || `${task.id}-detail-${index}`}`,
                          ]),
                      );
                    setModal(null);
                    requestAnimationFrame(() => {
                      document
                        .querySelector<HTMLElement>(`[data-task-id="${task.id}"]`)
                        ?.scrollIntoView({ block: 'center', behavior: 'instant' });
                    });
                  }}
                >
                  <span>
                    <small>{task.date}</small>
                    <strong>
                      <SearchHighlight text={task.title} query={searchQuery} />
                    </strong>
                    {task.details
                      .filter((detail) => detail.toLowerCase().includes(searchQuery))
                      .slice(0, 1)
                      .map((detail) => (
                        <span className="search-match" key={detail}>
                          <SearchHighlight text={detail} query={searchQuery} />
                        </span>
                      ))}
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
          {confirmationError && (
            <p className="form-error" role="alert">
              {confirmationError} 다시 시도할 수 있어요.
            </p>
          )}
          <div className="form-actions">
            <Button
              variant="secondary"
              size="default"
              className="soft-button"
              disabled={confirmBusy}
              onClick={() => setConfirmation(null)}
            >
              {confirmation.cancelLabel || '취소'}
            </Button>
            <Button
              variant="destructive"
              size="default"
              className="danger-button"
              disabled={confirmBusy}
              onClick={async () => {
                setConfirmBusy(true);
                try {
                  await confirmation.action();
                  setConfirmation(null);
                  if (confirmation.success) setToast(confirmation.success);
                } catch (e) {
                  setConfirmationError((e as Error).message);
                } finally {
                  setConfirmBusy(false);
                }
              }}
            >
              {confirmBusy ? '처리 중…' : confirmation.label || '참여 권한 해제'}
            </Button>
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
        <Button
          variant="secondary"
          size="default"
          className="soft-button"
          disabled={busy || disabled}
          type="submit"
        >
          <Plus size={16} />
          {busy ? '승인 중…' : '작성자 승인'}
        </Button>
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
      <p className="stats-range">
        {addDays(date, -6).slice(5).replace('-', '.')}–{date.slice(5).replace('-', '.')}, 최근 7일
      </p>
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
          <p>실행 항목을 1개 이상 완료한 날</p>
        </div>
      </div>
      {selectedTasks.length > 0 && (
        <section className="study-flow" aria-label="선택한 날의 학습 흐름">
          <h2>{formatDate(date)}, 선택한 날</h2>
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

function SearchHighlight({ text, query }: { text: string; query: string }) {
  const index = text.toLowerCase().indexOf(query.trim().toLowerCase());
  if (index < 0 || !query.trim()) return <>{text}</>;
  const end = index + query.trim().length;
  return (
    <>
      {text.slice(0, index)}
      <mark>{text.slice(index, end)}</mark>
      {text.slice(end)}
    </>
  );
}
