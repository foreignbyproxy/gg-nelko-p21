export type ConnState = 'disconnected' | 'connecting' | 'connected';

interface Props {
  state: ConnState;
  portLabel: string;
  supported: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}

export function ConnectionControl({ state, portLabel, supported, onConnect, onDisconnect }: Props) {
  const label =
    state === 'connected' ? `Connected${portLabel ? ` · ${portLabel}` : ''}` : state === 'connecting' ? 'Connecting…' : 'Not connected';

  return (
    <div className="conn">
      <span className={`conn-status conn-${state}`} role="status">
        <span className="conn-dot" aria-hidden />
        {label}
      </span>
      {state === 'connected' ? (
        <button type="button" className="btn btn-ghost" onClick={onDisconnect}>
          Disconnect
        </button>
      ) : (
        <button type="button" className="btn btn-dark" onClick={onConnect} disabled={!supported || state === 'connecting'}>
          Connect printer
        </button>
      )}
    </div>
  );
}
