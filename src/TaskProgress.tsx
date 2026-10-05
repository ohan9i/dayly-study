type Progress = { done: number; total: number; percent: number };

export function TaskProgress({ progress, label }: { progress: Progress; label: string }) {
  return (
    <div className="detail-progress">
      <div
        className="detail-progress-track"
        role="progressbar"
        aria-label={label}
        aria-valuenow={progress.percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={`${progress.total}개 중 ${progress.done}개 완료, ${progress.percent}%`}
      >
        <i style={{ width: `${progress.percent}%` }} />
      </div>
      <span aria-hidden="true">
        {progress.done}/{progress.total}
      </span>
    </div>
  );
}

export function DayProgressRing({ progress, label }: { progress: Progress; label: string }) {
  const circumference = 2 * Math.PI * 17;
  return (
    <div
      className="day-progress-ring"
      role="progressbar"
      aria-label={label}
      aria-valuenow={progress.percent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuetext={`${progress.total}개 중 ${progress.done}개 완료, ${progress.percent}%`}
      title={`${label}: ${progress.done}/${progress.total} 완료`}
    >
      <svg viewBox="0 0 44 44" aria-hidden="true">
        <circle className="ring-track" cx="22" cy="22" r="17" />
        <circle
          className="ring-value"
          cx="22"
          cy="22"
          r="17"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - progress.percent / 100)}
        />
        <text x="22" y="22" textAnchor="middle" dominantBaseline="central">
          {progress.percent}%
        </text>
      </svg>
    </div>
  );
}
