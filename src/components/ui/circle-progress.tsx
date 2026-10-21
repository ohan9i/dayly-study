import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';
import './circle-progress.css';

// Adapted from the user's CircleProgress example; CSS handles interpolation.
export interface CircleProgressProps extends HTMLAttributes<HTMLDivElement> {
  value: number;
  maxValue: number;
  size?: number;
  strokeWidth?: number;
  counterClockwise?: boolean;
  disableAnimation?: boolean;
}

export function CircleProgress({
  value,
  maxValue,
  size = 136,
  strokeWidth = 3,
  counterClockwise = false,
  disableAnimation = false,
  className,
  ...props
}: CircleProgressProps) {
  const maximum = Number.isFinite(maxValue) && maxValue > 0 ? maxValue : 1;
  const amount = Number.isFinite(value) ? Math.min(maximum, Math.max(0, value)) : 0;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  return (
    <div
      className={cn('circle-progress', className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={maximum}
      aria-valuenow={amount}
      data-static={disableAnimation}
      {...props}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle
          className="circle-progress-track"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
        />
        <circle
          className="circle-progress-value"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - amount / maximum) * (counterClockwise ? -1 : 1)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}
