import './ProgressBar.css';

interface ProgressBarProps {
  /** 0..100 */
  value: number;
  /** Название для экранного диктора. */
  label?: string;
  class?: string;
}

export function ProgressBar({ value, label = 'Прочитано', class: className }: ProgressBarProps) {
  const percent = Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
  return (
    <div
      class={className ? `progress ${className}` : 'progress'}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(percent)}
    >
      <span class="progress__fill" style={{ width: `${percent}%` }} />
    </div>
  );
}
