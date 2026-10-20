import { saveEntryNavigation, type EntryNavigation } from './entryNavigation';

const clamp = (v: number) => Math.max(0, Math.min(1, v));
const segment = (p: number, from: number, to: number) => clamp((p - from) / (to - from));
const ease = (v: number) => v * v * (3 - 2 * v);

// One frame per input event, no perpetual loop and no React state per frame.
export function connectPlannerScroll({
  flow,
  runway,
  stage,
  object,
  app,
  controls,
  enabled,
  initial,
  registerEnter,
}: {
  flow: HTMLDivElement;
  runway: HTMLElement;
  stage: HTMLDivElement;
  object: HTMLDivElement;
  app: HTMLDivElement;
  controls: HTMLDivElement;
  enabled: boolean;
  initial: EntryNavigation;
  registerEnter: (enter: () => void) => void;
}) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const mobile = matchMedia('(max-width: 700px)');
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  const book = object.querySelector<HTMLElement>('.planner-book')!;
  const cover = object.querySelector<HTMLElement>('.book-front')!;
  const marks = object.querySelector<HTMLElement>('.book-page-marks')!;
  const shadow = stage.querySelector<HTMLElement>('.book-shadow')!;
  const caption = stage.querySelector<HTMLElement>('.welcome-caption')!;
  const wordmark = stage.querySelector<HTMLElement>('.welcome-wordmark')!;
  const binding = [...object.querySelectorAll<HTMLElement>('.book-spine, .book-edge, .book-back')];
  let frame = 0,
    entered: boolean | undefined,
    progress = 0,
    visible = true;
  let distance = 0,
    origin = 0,
    width = 0,
    height = 0;
  let target = { x: 0, y: 0, width: 0, height: 0 };
  let tiltX = 0,
    tiltY = 0;
  let targetDirty = false;

  function setEntered(next: boolean) {
    if (entered === next && app.inert === !next) return;
    const focusedInApp = app.contains(document.activeElement);
    entered = next;
    flow.dataset.entered = String(next);
    app.inert = !next;
    app.setAttribute('aria-hidden', String(!next));
    // Do not leave focus on an element that has just become hidden/inert.
    if (!next && focusedInApp) {
      stage.inert = false;
      flow.querySelector<HTMLElement>('.planner-skip-link')?.focus({ preventScroll: true });
    }
    if (next && stage.contains(document.activeElement)) focusPlanner();
    stage.inert = next;
    stage.setAttribute('aria-hidden', String(next));
    saveEntryNavigation({ entered: next, intro: enabled, scroll: window.scrollY });
  }
  function focusPlanner() {
    app.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
  }
  function measure() {
    const rect = runway.getBoundingClientRect();
    origin = rect.top + scrollY;
    distance = Math.max(1, runway.offsetHeight - stage.offsetHeight);
    width = object.offsetWidth;
    height = object.offsetHeight;
    const card = app.querySelector<HTMLElement>('.tasks-card, .glass-card');
    if (card) {
      const r = card.getBoundingClientRect();
      // When released into document flow the app starts at origin + distance.
      const appOffset = entered ? origin + distance - scrollY : 0;
      target = {
        x: r.x + r.width / 2 - innerWidth / 2,
        y: r.y - appOffset + r.height / 2 - stage.offsetHeight / 2,
        width: r.width,
        height: r.height,
      };
    }
  }
  function draw() {
    frame = 0;
    if (document.hidden) return;
    if (!enabled) {
      setEntered(true);
      app.style.opacity = '1';
      return;
    }
    if (reduced.matches) {
      // Ordinary document flow, with a static cover and immediately usable app.
      flow.dataset.reduced = 'true';
      app.inert = false;
      app.removeAttribute('aria-hidden');
      app.style.opacity = '1';
      stage.inert = false;
      stage.removeAttribute('aria-hidden');
      object.style.transform = '';
      object.style.opacity = '';
      book.style.transform = '';
      cover.style.transform = '';
      cover.style.opacity = '';
      marks.style.opacity = '0';
      binding.forEach((el) => {
        el.style.opacity = '1';
      });
      shadow.style.opacity = '';
      shadow.style.transform = '';
      controls.style.opacity = '';
      controls.inert = false;
      controls.removeAttribute('aria-hidden');
      flow.dataset.scrolling = 'false';
      caption.style.opacity = '';
      wordmark.style.opacity = '';
      return;
    }
    flow.dataset.reduced = 'false';
    if (targetDirty) {
      measure();
      targetDirty = false;
    }
    progress = clamp((scrollY - origin) / distance);
    setEntered(progress >= 0.999);
    const controlsHidden = progress > 0.17;
    flow.dataset.scrolling = String(controlsHidden && !entered);
    if (controlsHidden && controls.contains(document.activeElement)) {
      flow.querySelector<HTMLElement>('.planner-skip-link')?.focus({ preventScroll: true });
    }
    controls.inert = controlsHidden;
    controls.setAttribute('aria-hidden', String(controlsHidden));
    if (entered) {
      app.style.opacity = '1';
      object.style.opacity = '0';
      return;
    }
    if (!visible && progress > 0 && progress < 1) return;
    const opening = ease(segment(progress, 0.2, 0.52));
    const face = ease(segment(progress, 0.4, 0.72));
    const expand = ease(segment(progress, 0.55, 0.91));
    const handoff = segment(progress, 0.88, 1);
    const rotation = (mobile.matches ? 23 : 34) * (1 - face);
    book.style.transform = `rotateX(${-9 * (1 - face) + tiltX}deg) rotateY(${rotation + tiltY}deg) rotateZ(${-4 * (1 - face)}deg)`;
    cover.style.transform = `translateZ(12px) rotateY(${-155 * opening}deg)`;
    cover.style.opacity = String(1 - segment(progress, 0.58, 0.73));
    binding.forEach((el) => {
      el.style.opacity = String(1 - face);
    });
    const sx = 1 + ((target.width || width) / width - 1) * expand;
    const sy = 1 + ((target.height || height) / height - 1) * expand;
    object.style.transform = `translate(-50%, -50%) translate(${target.x * expand}px, ${target.y * expand}px) scale(${sx}, ${sy})`;
    object.style.opacity = String(1 - handoff);
    marks.style.opacity = String(
      segment(progress, 0.42, 0.62) * (1 - segment(progress, 0.75, 0.88)),
    );
    shadow.style.opacity = String(1 - segment(progress, 0.3, 0.72));
    shadow.style.transform = `translateX(-50%) scale(${1 + progress * 0.4}, ${1 - progress * 0.3})`;
    controls.style.opacity = String(1 - segment(progress, 0, 0.17));
    caption.style.opacity = controls.style.opacity;
    wordmark.style.opacity = String(1 - segment(progress, 0.65, 0.88));
    app.style.opacity = String(handoff);
  }
  function schedule() {
    if (!frame && !document.hidden) frame = requestAnimationFrame(draw);
  }
  function scroll() {
    tiltX = tiltY = 0;
    // Below the entry, only process the crossing back into the scene.
    if (scrollY <= origin + distance + innerHeight || !entered || reduced.matches) schedule();
  }
  function resize() {
    if (!document.hidden) {
      measure();
      schedule();
    }
  }
  function pointer(event: PointerEvent) {
    if (
      !visible ||
      document.hidden ||
      progress > 0.005 ||
      reduced.matches ||
      mobile.matches ||
      !fine.matches
    )
      return;
    tiltX = -(event.clientY / innerHeight - 0.5) * 3;
    tiltY = (event.clientX / innerWidth - 0.5) * 4;
    schedule();
  }
  function resetPointer() {
    tiltX = tiltY = 0;
    schedule();
  }
  function enter() {
    if (!enabled) {
      focusPlanner();
      return;
    }
    measure();
    window.scrollTo({
      top: reduced.matches ? runway.offsetTop + runway.offsetHeight : origin + distance,
      behavior: 'instant',
    });
    draw();
    focusPlanner();
  }
  function destinationChanged() {
    if (!enabled) {
      // The implicit auth flow clears location.hash, creating a fresh history
      // entry with no state. Persist direct entry on that new item too.
      saveEntryNavigation({ intro: false, entered: true, scroll: window.scrollY });
    } else if (location.hash === '#planner') enter();
  }
  registerEnter(enter);
  saveEntryNavigation({ intro: enabled });
  measure();
  // Restore the current history entry, rather than remembering "never show again".
  const restoreScroll =
    initial.scroll ?? (enabled && initial.entered ? origin + distance : undefined);
  if (restoreScroll !== undefined) window.scrollTo({ top: restoreScroll, behavior: 'instant' });
  draw();
  const observer = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) schedule();
  });
  observer.observe(runway);
  const sizeObserver = new ResizeObserver(resize);
  sizeObserver.observe(stage);
  const card = app.querySelector('.tasks-card');
  if (card) sizeObserver.observe(card);
  // Loading/access banners can move the target without changing its own size.
  const contentObserver = new MutationObserver(() => {
    targetDirty = true;
    if (visible && !entered) schedule();
  });
  const main = app.querySelector('main');
  if (main) contentObserver.observe(main, { childList: true, subtree: true });
  window.addEventListener('scroll', scroll, { passive: true });
  window.addEventListener('resize', resize);
  window.addEventListener('hashchange', destinationChanged);
  stage.addEventListener('pointermove', pointer, { passive: true });
  stage.addEventListener('pointerleave', resetPointer);
  document.addEventListener('visibilitychange', resize);
  reduced.addEventListener('change', resize);
  mobile.addEventListener('change', resize);
  return () => {
    cancelAnimationFrame(frame);
    observer.disconnect();
    sizeObserver.disconnect();
    contentObserver.disconnect();
    window.removeEventListener('scroll', scroll);
    window.removeEventListener('resize', resize);
    window.removeEventListener('hashchange', destinationChanged);
    stage.removeEventListener('pointermove', pointer);
    stage.removeEventListener('pointerleave', resetPointer);
    document.removeEventListener('visibilitychange', resize);
    reduced.removeEventListener('change', resize);
    mobile.removeEventListener('change', resize);
  };
}
