import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { ArrowDown, ArrowUpRight } from 'lucide-react';
import { PlannerObject } from './PlannerObject';
import { hasEntryDestination, readEntryNavigation, saveEntryNavigation } from './entryNavigation';
import { connectPlannerScroll } from './plannerScroll';

export default function WelcomeScreen({
  children,
  bypass = false,
}: {
  children: ReactNode;
  bypass?: boolean;
}) {
  const flow = useRef<HTMLDivElement>(null);
  const runway = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const object = useRef<HTMLDivElement>(null);
  const app = useRef<HTMLDivElement>(null);
  const controls = useRef<HTMLDivElement>(null);
  const enter = useRef<() => void>(() => {});
  const initial = useRef(readEntryNavigation()).current;
  const directEntry = useRef(hasEntryDestination() || initial.intro === false || bypass);
  // The SDK may consume the URL before recovery is detected. Preserve the
  // destination for this mount after the new password has been saved as well.
  if (bypass) directEntry.current = true;
  const enabled = !directEntry.current;

  useLayoutEffect(() => {
    return connectPlannerScroll({
      flow: flow.current!,
      runway: runway.current!,
      stage: stage.current!,
      object: object.current!,
      app: app.current!,
      controls: controls.current!,
      enabled,
      initial,
      registerEnter: (callback) => {
        enter.current = callback;
      },
    });
  }, [enabled, initial]);

  useLayoutEffect(() => {
    const save = () => saveEntryNavigation({ scroll: window.scrollY });
    let timer = 0;
    const scheduleSave = () => {
      clearTimeout(timer);
      timer = window.setTimeout(save, 180);
    };
    window.addEventListener('scroll', scheduleSave, { passive: true });
    window.addEventListener('pagehide', save);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('scroll', scheduleSave);
      window.removeEventListener('pagehide', save);
    };
  }, []);

  return (
    <div
      className="entry-flow"
      ref={flow}
      data-intro={enabled}
      data-entered={!enabled || initial.entered}
    >
      <a
        className="planner-skip-link"
        href="#planner"
        onClick={(event) => {
          event.preventDefault();
          enter.current();
        }}
      >
        플래너로 건너뛰기
      </a>
      <section
        className="welcome-runway"
        ref={runway}
        aria-label="Dayly 시작 화면"
        hidden={!enabled}
      >
        <div className="welcome-stage" ref={stage}>
          <div className="welcome-wordmark" aria-hidden="true">
            Dayly<span>.</span>
          </div>
          <p className="welcome-caption">오늘의 계획</p>
          <div className="book-shadow" aria-hidden="true" />
          <PlannerObject ref={object} />
          <div className="welcome-controls" ref={controls}>
            <p>
              스크롤해서 펼치기 <ArrowDown size={15} aria-hidden="true" />
            </p>
            <a
              href="#planner"
              onClick={(event) => {
                event.preventDefault();
                enter.current();
              }}
            >
              플래너 바로 열기 <ArrowUpRight size={14} aria-hidden="true" />
            </a>
          </div>
        </div>
      </section>
      <div className="planner-layer" ref={app} inert={enabled && !initial.entered}>
        {children}
      </div>
    </div>
  );
}
