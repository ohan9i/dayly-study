import { forwardRef } from 'react';

// A complete CSS book, available on the first paint without a model or WebGL.
// The front cover pivots at the spine; the inside and outside are separate faces.
export const PlannerObject = forwardRef<HTMLDivElement>(function PlannerObject(_, ref) {
  return (
    <div className="planner-object" ref={ref} aria-hidden="true">
      <div className="planner-book">
        <div className="book-back" />
        <div className="book-spine">
          <span>Dayly</span>
        </div>
        <div className="book-edge book-edge-right" />
        <div className="book-edge book-edge-top" />
        <div className="book-edge book-edge-bottom" />
        <div className="book-paper">
          <div className="book-page-marks">
            <span className="book-page-date">TODAY / DAYLY</span>
            <span className="book-page-title">오늘의 계획</span>
            {Array.from({ length: 5 }, (_, i) => (
              <span className="book-page-row" key={i}>
                <i />
                <b />
              </span>
            ))}
          </div>
        </div>
        <div className="book-front">
          <div className="book-cover-outside">
            <div className="book-label">
              <span>Dayly.</span>
              <small>DAILY PLANNER</small>
            </div>
            <span className="book-cover-foot">ONE DAY AT A TIME</span>
          </div>
          <div className="book-cover-inside" />
        </div>
      </div>
    </div>
  );
});
