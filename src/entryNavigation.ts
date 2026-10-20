// Per-history-entry UI state: no account, task or draft data is stored here.
export type EntryNavigation = {
  intro?: boolean;
  entered?: boolean;
  view?: 'home' | 'calendar' | 'stats' | 'settings';
  date?: string;
  month?: string;
  scroll?: number;
};

export function readEntryNavigation(): EntryNavigation {
  try {
    const value = window.history.state?.daylyEntry;
    if (!value || typeof value !== 'object') return {};
    return {
      intro: typeof value.intro === 'boolean' ? value.intro : undefined,
      entered: value.entered === true,
      view: ['home', 'calendar', 'stats', 'settings'].includes(value.view) ? value.view : undefined,
      date: validDate(value.date) ? value.date : undefined,
      month: validDate(value.month) ? value.month : undefined,
      scroll: Number.isFinite(value.scroll) && value.scroll >= 0 ? value.scroll : undefined,
    };
  } catch {
    return {};
  }
}

function validDate(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value + 'T00:00:00Z'))
  );
}

export function saveEntryNavigation(value: EntryNavigation) {
  try {
    history.replaceState(
      { ...history.state, daylyEntry: { ...readEntryNavigation(), ...value } },
      '',
    );
  } catch {
    // Private browsing / blocked history storage must never prevent entry.
  }
}

export function hasEntryDestination() {
  // Auth callbacks (including errors), shared links and explicit #planner links
  // take priority over the decorative entry. The auth SDK owns their parameters.
  return Boolean(location.hash || location.search);
}
