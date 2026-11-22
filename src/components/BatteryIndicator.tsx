import type { BatteryStatus } from '../lib/replies';

interface Props {
  battery: BatteryStatus;
  checkedAt: Date;
  refreshing: boolean;
  onRefresh: () => void;
}

const LOW = 20;

export function BatteryIndicator({ battery, checkedAt, refreshing, onRefresh }: Props) {
  const { percent, charging } = battery;
  const low = !charging && percent <= LOW;
  const time = checkedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const title = charging
    ? `Charging. The printer reports 99% while plugged in; unplug it for a real reading. Checked ${time}. Click to refresh.`
    : `Battery ${percent}%. Checked ${time}. Click to refresh.`;
  // Inner fill spans x = 3..19 (16 units) inside the battery outline.
  const fill = Math.max(1.5, (Math.min(percent, 100) / 100) * 16);

  return (
    <button
      type="button"
      className={`battery${low ? ' battery-low' : ''}${charging ? ' battery-charging' : ''}${refreshing ? ' battery-refreshing' : ''}`}
      onClick={onRefresh}
      disabled={refreshing}
      title={title}
      aria-label={charging ? 'Battery charging. Refresh battery level' : `Battery ${percent}%. Refresh battery level`}
    >
      <svg viewBox="0 0 26 14" width="26" height="14" aria-hidden>
        <rect x="1" y="1" width="20" height="12" rx="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <rect x="22.5" y="4.5" width="2" height="5" rx="1" fill="currentColor" />
        <rect className="battery-fill" x="3" y="3" width={fill} height="8" rx="1.5" />
        {charging && (
          <path
            d="M12.4 2.2 8 7.6h3l-1.3 4.2 4.6-5.6h-3.1z"
            className="battery-bolt"
            stroke="var(--surface)"
            strokeWidth="0.8"
            strokeLinejoin="round"
          />
        )}
      </svg>
      <span>{charging ? 'Charging' : `${percent}%`}</span>
    </button>
  );
}
