import { forwardRef, lazy, Suspense } from 'react';
import plannerCover from './assets/planner-cover.svg';

// The cover's holographic foil is only ever seen on the entry screen, so readers
// who arrive straight at the planner never download it.
const HoloCard = lazy(() => import('./HoloCard'));

// A complete CSS book, available on the first paint without a model or WebGL.
// The front cover pivots at the spine; the inside and outside are separate faces.
export const PlannerObject = forwardRef<HTMLDivElement, { cover?: boolean }>(function PlannerObject(
  { cover = true },
  ref,
) {
  return (
    <div className="planner-object" ref={ref} aria-hidden="true">
      <div className="planner-book">
        <div className="book-back" />
        <div className="book-ribbon" />
        <div className="book-spine">
          <span>DAYLY</span>
        </div>
        <div className="book-edge book-edge-right" />
        <div className="book-edge book-edge-top" />
        <div className="book-edge book-edge-bottom" />
        <div className="book-paper" />
        <div className="book-front">
          <div className="book-cover-outside">
            <div className="book-label">
              <span>DAYLY</span>
              <small>DAILY PLANNER</small>
            </div>
            <span className="book-cover-foot">UNDATED / VOL. 01</span>
            {cover && (
              <Suspense fallback={null}>
                <HoloCard
                  image={plannerCover}
                  alt="DAYLY 플래너 표지"
                  preset="bursts"
                  scale={1.85}
                  surfaceOnly
                  idle={false}
                  shadow={false}
                  frame={2}
                  radius={6}
                  intensity={0.8}
                  edgeSparkle={0.35}
                  glare={0.35}
                  className="planner-cover-holo"
                />
              </Suspense>
            )}
          </div>
          <div className="book-cover-inside" />
        </div>
      </div>
    </div>
  );
});
