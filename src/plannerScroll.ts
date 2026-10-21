import { saveEntryNavigation, type EntryNavigation } from './entryNavigation';

// Scroll is a trigger, never the animation playhead. WAAPI runs the brief
// sequence without a React render or a JavaScript loop on every frame.
export function connectPlannerEntry({
  flow,
  runway,
  stage,
  object,
  app,
  enabled,
  initial,
  registerEnter,
}: {
  flow: HTMLDivElement;
  runway: HTMLElement;
  stage: HTMLDivElement;
  object: HTMLDivElement;
  app: HTMLDivElement;
  enabled: boolean;
  initial: EntryNavigation;
  registerEnter: (enter: () => void) => void;
}) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const mobile = matchMedia('(max-width: 700px)');
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  const book = object.querySelector<HTMLElement>('.planner-book')!;
  const cover = object.querySelector<HTMLElement>('.book-front')!;
  const shadows = [...stage.querySelectorAll<HTMLElement>('.book-shadow, .book-contact-shadow')];
  const binding = [
    ...object.querySelectorAll<HTMLElement>('.book-spine, .book-edge, .book-back, .book-ribbon'),
  ];
  const letters = [...stage.querySelectorAll<HTMLElement>('.welcome-wordmark span')];
  const rule = stage.querySelector<HTMLElement>('.welcome-rule')!;
  const animations: Animation[] = [];
  let objectAnimation: Animation | undefined;
  let phase: 'ready' | 'opening' | 'entered' = 'ready';
  let disposed = false,
    timeout = 0,
    pointerFrame = 0,
    touchY = 0;
  const closedPose = () => `rotateX(-10deg) rotateY(${mobile.matches ? 24 : 32}deg) rotateZ(-3deg)`;

  function focusPlanner() {
    app.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
  }
  function finish(focus = true, top = 0) {
    if (disposed) return;
    phase = 'entered';
    clearTimeout(timeout);
    cancelAnimationFrame(pointerFrame);
    flow.dataset.phase = 'entered';
    flow.dataset.entered = 'true';
    flow.dataset.intro = 'false';
    runway.hidden = true;
    stage.inert = true;
    stage.setAttribute('aria-hidden', 'true');
    app.inert = false;
    app.removeAttribute('aria-hidden');
    app.style.opacity = '1';
    app.style.transform = '';
    animations.splice(0).forEach((animation) => animation.cancel());
    window.scrollTo({ top, behavior: 'instant' });
    saveEntryNavigation({ intro: false, entered: true, scroll: window.scrollY });
    if (focus) focusPlanner();
  }
  function animate(el: Element, frames: Keyframe[], duration: number, delay = 0) {
    const animation = el.animate(frames, { duration, delay, fill: 'both', easing: 'linear' });
    animations.push(animation);
    return animation;
  }
  function objectFrames(): Keyframe[] {
    const card = app.querySelector<HTMLElement>('.tasks-card, .glass-card') || app;
    const target = card.getBoundingClientRect();
    const width = object.offsetWidth,
      height = object.offsetHeight;
    const x = target.x + target.width / 2 - innerWidth / 2;
    const y = target.y + target.height / 2 - stage.clientHeight * 0.61;
    const final = `translate(-50%, -50%) translate(${x}px, ${y}px) scale(${target.width / width}, ${target.height / height})`;
    return [
      { transform: 'translate(-50%, -50%)', opacity: 1, offset: 0 },
      {
        transform: 'translate(-50%, -50%) translateY(-8px) scale(1.04)',
        opacity: 1,
        offset: 0.42,
        easing: 'cubic-bezier(.65,0,.2,1)',
      },
      { transform: final, opacity: 1, offset: 0.86 },
      { transform: final, opacity: 0, offset: 1 },
    ];
  }
  function open() {
    if (phase !== 'ready' || disposed) return;
    document.documentElement.dataset.interaction = 'pointer';
    if (reduced.matches || typeof object.animate !== 'function') {
      finish();
      return;
    }
    phase = 'opening';
    flow.dataset.phase = 'opening';
    cancelAnimationFrame(pointerFrame);
    // A reload during the sequence goes straight to the working planner.
    saveEntryNavigation({ intro: false, entered: true, scroll: 0 });
    const duration = mobile.matches ? 1250 : 1550;
    try {
      animate(
        book,
        [
          {
            transform: book.style.transform || closedPose(),
            offset: 0,
            easing: 'cubic-bezier(.4,0,.2,1)',
          },
          {
            transform: 'rotateX(-3deg) rotateY(12deg) rotateZ(-1deg)',
            offset: 0.38,
            easing: 'cubic-bezier(.22,1,.36,1)',
          },
          { transform: 'rotateX(0deg) rotateY(0deg) rotateZ(0deg)', offset: 0.72 },
          { transform: 'rotateX(0deg) rotateY(0deg) rotateZ(0deg)', offset: 1 },
        ],
        duration,
      );
      animate(
        cover,
        [
          { transform: 'translateZ(12px) rotateY(0deg)', offset: 0 },
          {
            transform: 'translateZ(12px) rotateY(-8deg)',
            offset: 0.12,
            easing: 'cubic-bezier(.4,0,.2,1)',
          },
          { transform: 'translateZ(12px) rotateY(-150deg)', offset: 0.55 },
          { transform: 'translateZ(12px) rotateY(-155deg)', offset: 0.72 },
          { transform: 'translateZ(12px) rotateY(-155deg)', offset: 1 },
        ],
        duration,
      );
      [...cover.children].forEach((face) =>
        animate(
          face,
          [
            { opacity: 1, offset: 0 },
            { opacity: 1, offset: 0.55 },
            { opacity: 0, offset: 0.72 },
            { opacity: 0, offset: 1 },
          ],
          duration,
        ),
      );
      objectAnimation = animate(object, objectFrames(), duration);
      binding.forEach((el) =>
        animate(
          el,
          [
            { opacity: 1, offset: 0 },
            { opacity: 1, offset: 0.48 },
            { opacity: 0, offset: 0.72 },
            { opacity: 0, offset: 1 },
          ],
          duration,
        ),
      );
      shadows.forEach((el) =>
        animate(
          el,
          [
            { opacity: 1, offset: 0 },
            { opacity: 0.6, offset: 0.4 },
            { opacity: 0, offset: 0.72 },
            { opacity: 0, offset: 1 },
          ],
          duration,
        ),
      );
      letters.forEach((el, index) =>
        animate(
          el,
          [
            { transform: 'translateY(0)', opacity: 1, easing: 'cubic-bezier(.4,0,.2,1)' },
            { transform: 'translateY(-48px)', opacity: 0 },
          ],
          duration * 0.52,
          index * 35,
        ),
      );
      animate(
        rule,
        [
          { opacity: 1, transform: 'scaleX(1)' },
          { opacity: 0, transform: 'scaleX(.3)' },
        ],
        duration * 0.48,
      );
      const handoff = animate(
        app,
        [
          { opacity: 0, offset: 0 },
          { opacity: 0, offset: 0.76 },
          { opacity: 1, offset: 1 },
        ],
        duration,
      );
      void handoff.finished.then(() => finish()).catch(() => {});
      timeout = window.setTimeout(() => finish(), duration + 250);
    } catch {
      finish();
    }
  }
  function scroll() {
    if (phase === 'ready' && scrollY > 3) open();
  }
  function wheel(event: WheelEvent) {
    if (event.deltaY > 3) open();
  }
  function touchStart(event: TouchEvent) {
    touchY = event.touches[0]?.clientY || 0;
  }
  function touchMove(event: TouchEvent) {
    if (touchY - (event.touches[0]?.clientY || touchY) > 12) open();
  }
  function keyboard(event: KeyboardEvent) {
    if (
      phase === 'ready' &&
      ['ArrowDown', 'PageDown', ' ', 'End'].includes(event.key) &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      event.preventDefault();
      finish();
    }
  }
  function resize() {
    if (phase === 'opening') {
      // Mobile browser chrome can resize the viewport during the swipe.
      // Retarget the end pose without restarting or prematurely finishing.
      (objectAnimation?.effect as KeyframeEffect | null)?.setKeyframes(objectFrames());
    } else if (phase === 'ready') book.style.transform = closedPose();
  }
  function preferenceChanged() {
    if (phase === 'opening' && reduced.matches) finish();
  }
  function pointer(event: PointerEvent) {
    if (
      phase !== 'ready' ||
      document.hidden ||
      event.pointerType !== 'mouse' ||
      reduced.matches ||
      mobile.matches ||
      !fine.matches
    )
      return;
    cancelAnimationFrame(pointerFrame);
    pointerFrame = requestAnimationFrame(() => {
      book.style.transform = `rotateX(${-10 - (event.clientY / innerHeight - 0.5) * 3}deg) rotateY(${32 + (event.clientX / innerWidth - 0.5) * 4}deg) rotateZ(-3deg)`;
    });
  }
  function resetPointer() {
    if (phase === 'ready') book.style.transform = closedPose();
  }
  function destinationChanged() {
    if (phase === 'entered' || !enabled)
      saveEntryNavigation({ intro: false, entered: true, scroll: window.scrollY });
    else if (location.hash === '#planner') finish();
  }
  registerEnter(() => finish());
  if (!enabled || initial.entered) finish(false, initial.scroll || 0);
  else {
    flow.dataset.phase = 'ready';
    flow.dataset.entered = 'false';
    app.inert = true;
    app.setAttribute('aria-hidden', 'true');
    app.style.opacity = '0';
    book.style.transform = closedPose();
    saveEntryNavigation({ intro: true, entered: false, scroll: 0 });
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  window.addEventListener('scroll', scroll, { passive: true });
  window.addEventListener('wheel', wheel, { passive: true });
  window.addEventListener('touchstart', touchStart, { passive: true });
  window.addEventListener('touchmove', touchMove, { passive: true });
  window.addEventListener('keydown', keyboard);
  window.addEventListener('resize', resize);
  window.addEventListener('hashchange', destinationChanged);
  stage.addEventListener('pointermove', pointer, { passive: true });
  stage.addEventListener('pointerleave', resetPointer);
  reduced.addEventListener('change', preferenceChanged);
  return () => {
    disposed = true;
    clearTimeout(timeout);
    cancelAnimationFrame(pointerFrame);
    animations.forEach((animation) => animation.cancel());
    window.removeEventListener('scroll', scroll);
    window.removeEventListener('wheel', wheel);
    window.removeEventListener('touchstart', touchStart);
    window.removeEventListener('touchmove', touchMove);
    window.removeEventListener('keydown', keyboard);
    window.removeEventListener('resize', resize);
    window.removeEventListener('hashchange', destinationChanged);
    stage.removeEventListener('pointermove', pointer);
    stage.removeEventListener('pointerleave', resetPointer);
    reduced.removeEventListener('change', preferenceChanged);
  };
}
