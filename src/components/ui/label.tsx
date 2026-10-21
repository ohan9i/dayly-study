import type { LabelHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';
import './input.css';

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('ui-label', className)} {...props} />;
}
