// Per-history-entry UI state: no account, task or draft data is stored here.
// The screen and the date live in the address so a day can be linked and the
// browser's back button walks the screens the reader actually visited.
import { todayKey } from './domain';

export type EntryView = 'home' | 'calendar' | 'stats' | 'settings';
export type EntryNavigation = {
  intro?: boolean;
  entered?: boolean;
  view?: EntryView;
  date?: string;
  month?: string;
  scroll?: number;
};

const views: EntryView[] = ['home', 'calendar', 'stats', 'settings'];
const readView = (value: unknown): EntryView | undefined =>
  views.includes(value as EntryView) ? (value as EntryView) : undefined;

function readState(): EntryNavigation {
  try {
    const value = window.history.state?.daylyEntry;
    if (!value || typeof value !== 'object') return {};
    return {
      intro: typeof value.intro === 'boolean' ? value.intro : undefined,
      entered: value.entered === true,
      view: readView(value.view),
      date: validDate(value.date) ? value.date : undefined,
      month: validDate(value.month) ? value.month : undefined,
      scroll: Number.isFinite(value.scroll) && value.scroll >= 0 ? value.scroll : undefined,
    };
  } catch {
    return {};
  }
}

export function readEntryNavigation(): EntryNavigation {
  const state = readState();
  try {
    const params = new URLSearchParams(location.search);
    const view = readView(params.get('view'));
    const date = params.get('date');
    return {
      ...state,
      view: view || state.view,
      date: validDate(date) ? date : state.date,
    };
  } catch {
    return state;
  }
}

function validDate(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value + 'T00:00:00Z'))
  );
}

/** Build the address for a screen, leaving defaults out so links stay short. */
function entryUrl(view: EntryView, date: string) {
  const url = new URL(location.href);
  // Auth callbacks own their own parameters and must survive untouched.
  if (view === 'home') url.searchParams.delete('view');
  else url.searchParams.set('view', view);
  if (date === todayKey()) url.searchParams.delete('date');
  else url.searchParams.set('date', date);
  return url.pathname + url.search + url.hash;
}

export function saveEntryNavigation(value: EntryNavigation) {
  try {
    // An empty url keeps the current address: only the stored state changes.
    history.replaceState({ ...history.state, daylyEntry: { ...readState(), ...value } }, '');
  } catch {
    // Private browsing / blocked history storage must never prevent entry.
  }
}

/** Add a history entry so back returns to the screen the reader came from. */
export function pushEntryNavigation(value: EntryNavigation & { view: EntryView; date: string }) {
  try {
    const url = entryUrl(value.view, value.date);
    if (url === location.pathname + location.search + location.hash) {
      saveEntryNavigation(value);
      return;
    }
    history.pushState({ ...history.state, daylyEntry: { ...readState(), ...value } }, '', url);
  } catch {
    saveEntryNavigation(value);
  }
}

export function hasEntryDestination() {
  // Auth callbacks (including errors), shared links and explicit #planner links
  // take priority over the decorative entry. The auth SDK owns their parameters.
  return Boolean(location.hash || location.search);
}
