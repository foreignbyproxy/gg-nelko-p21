import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BatteryIndicator } from './components/BatteryIndicator';
import { ConnectionControl, type ConnState } from './components/ConnectionControl';
import { LabelPreview } from './components/LabelPreview';
import { P21Printer, isSerialSupported, type BatteryStatus } from './lib/printer';
import {
  DEFAULT_DENSITY,
  DEFAULT_SIZE_ID,
  DENSITY_MAX,
  DENSITY_MIN,
  LABEL_SIZES,
  buildPrintJob,
} from './lib/protocol';
import { FONTS, renderTextLabel, type TextAlign } from './lib/render';
import { useStoredState } from './lib/useStoredState';

const DEFAULTS = {
  text: 'Hello\nP21',
  fontId: 'sans',
  bold: true,
  maxFontSize: 48,
  lineHeight: 1.1,
  align: 'center' as TextAlign,
  invert: false,
  sizeId: DEFAULT_SIZE_ID,
  density: DEFAULT_DENSITY,
  copies: 1,
};

type Notice = { kind: 'info' | 'success' | 'error'; text: string } | null;

/** How often to re-check the battery while connected. */
const BATTERY_POLL_MS = 60_000;
/** Wait after a print before asking for the battery, so the printer has finished. */
const BATTERY_AFTER_PRINT_MS = 4_000;

const ALIGNS: { id: TextAlign; label: string; icon: string }[] = [
  { id: 'left', label: 'Align left', icon: 'M3 5h14M3 9h9M3 13h14M3 17h9' },
  { id: 'center', label: 'Align center', icon: 'M3 5h14M5.5 9h9M3 13h14M5.5 17h9' },
  { id: 'right', label: 'Align right', icon: 'M3 5h14M8 9h9M3 13h14M8 17h9' },
];

export default function App() {
  const [s, set] = useStoredState('gg-nelko-p21.settings', DEFAULTS);
  const [conn, setConn] = useState<ConnState>('disconnected');
  const [portLabel, setPortLabel] = useState('');
  const [printing, setPrinting] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [battery, setBattery] = useState<{ status: BatteryStatus; at: Date } | null>(null);
  const [batteryBusy, setBatteryBusy] = useState(false);
  const supported = isSerialSupported();

  const printerRef = useRef<P21Printer | null>(null);
  printerRef.current ??= new P21Printer(() => {
    setConn('disconnected');
    setPortLabel('');
    setBattery(null);
    setNotice({ kind: 'error', text: 'Printer disconnected. Check that it is on and in range.' });
  });

  const refreshBattery = useCallback(async () => {
    const printer = printerRef.current;
    if (!printer?.connected) return;
    setBatteryBusy(true);
    try {
      const status = await printer.getBattery();
      // Keep the last reading if the printer didn't answer this time.
      if (status && printer.connected) setBattery({ status, at: new Date() });
    } catch {
      // Disconnects are reported by the disconnect handler.
    } finally {
      setBatteryBusy(false);
    }
  }, []);

  useEffect(() => {
    if (conn !== 'connected') return;
    void refreshBattery();
    const id = setInterval(() => void refreshBattery(), BATTERY_POLL_MS);
    return () => clearInterval(id);
  }, [conn, refreshBattery]);

  const size = LABEL_SIZES.find((l) => l.id === s.sizeId) ?? LABEL_SIZES[0];
  const rendered = useMemo(
    () =>
      renderTextLabel(
        {
          text: s.text,
          fontId: s.fontId,
          bold: s.bold,
          maxFontSize: s.maxFontSize,
          lineHeight: s.lineHeight,
          align: s.align,
          invert: s.invert,
        },
        size,
      ),
    [s.text, s.fontId, s.bold, s.maxFontSize, s.lineHeight, s.align, s.invert, size],
  );

  const connect = async () => {
    setConn('connecting');
    setNotice(null);
    try {
      await printerRef.current!.connect();
      setConn('connected');
      setPortLabel(printerRef.current!.describe());
      setNotice({ kind: 'success', text: 'Printer connected.' });
    } catch (err) {
      setConn('disconnected');
      const text = err instanceof Error ? err.message : String(err);
      if (text !== 'No port selected.') setNotice({ kind: 'error', text });
    }
  };

  const disconnect = async () => {
    await printerRef.current!.disconnect();
    setConn('disconnected');
    setPortLabel('');
    setBattery(null);
    setNotice(null);
  };

  const canPrint = conn === 'connected' && !printing && rendered.lineCount > 0;

  const print = useCallback(async () => {
    if (!canPrint) return;
    setPrinting(true);
    setNotice({ kind: 'info', text: 'Sending to printer…' });
    try {
      const job = buildPrintJob(rendered.image, size, s.density, s.copies);
      await printerRef.current!.print(job);
      setNotice({ kind: 'success', text: s.copies > 1 ? `Sent ${s.copies} copies.` : 'Label sent.' });
      setTimeout(() => void refreshBattery(), BATTERY_AFTER_PRINT_MS);
    } catch (err) {
      setNotice({ kind: 'error', text: `Print failed: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setPrinting(false);
    }
  }, [canPrint, rendered.image, size, s.density, s.copies, refreshBattery]);

  // Ctrl/Cmd + Enter prints from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        void print();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [print]);

  // Close the port when the page goes away so it isn't left locked.
  useEffect(() => {
    const printer = printerRef.current;
    return () => void printer?.disconnect();
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img src="/favicon.svg" alt="" width={28} height={28} />
          <div>
            <h1>P21 Label Printer</h1>
            <p>Nelko P21 · Web Serial</p>
          </div>
        </div>
        <div className="topbar-right">
          {conn === 'connected' && battery && (
            <BatteryIndicator
              battery={battery.status}
              checkedAt={battery.at}
              refreshing={batteryBusy}
              onRefresh={() => void refreshBattery()}
            />
          )}
          <ConnectionControl
            state={conn}
            portLabel={portLabel}
            supported={supported}
            onConnect={connect}
            onDisconnect={disconnect}
          />
        </div>
      </header>

      {!supported && (
        <div className="banner banner-error">
          This browser can't talk to serial devices. Open this page in <strong>Chrome</strong> or{' '}
          <strong>Edge</strong> on a desktop computer.
        </div>
      )}

      {supported && conn !== 'connected' && (
        <div className="banner">
          Pair the P21 in your system's Bluetooth settings, turn it on, then click <strong>Connect printer</strong> and
          pick the P21 (or its outgoing COM port) from the list.
        </div>
      )}

      <main className="layout">
        <section className="card card-preview" aria-label="Preview">
          <LabelPreview image={rendered.image} size={size} />
          <div className="preview-meta">
            {rendered.lineCount === 0 ? (
              <span className="muted">Type some text to see it here.</span>
            ) : (
              <>
                <span>
                  {rendered.lineCount} {rendered.lineCount === 1 ? 'line' : 'lines'}
                </span>
                <span>Fitted to {rendered.fontSize}px</span>
                {rendered.overflow && <span className="warn">Text is too long to fit — it will be clipped.</span>}
              </>
            )}
          </div>
        </section>

        <section className="card" aria-labelledby="text-heading">
          <h2 id="text-heading">Text</h2>
          <label className="field">
            <span className="field-label">Label text</span>
            <textarea
              value={s.text}
              onChange={(e) => set({ text: e.target.value })}
              rows={4}
              spellCheck={false}
              placeholder={'One line per row\nPress Enter for a new line'}
            />
            <span className="hint">Press Enter for a new line. Text shrinks automatically to fit.</span>
          </label>

          <div className="row">
            <label className="field grow">
              <span className="field-label">Font</span>
              <select value={s.fontId} onChange={(e) => set({ fontId: e.target.value })}>
                {FONTS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="field">
              <span className="field-label">Style</span>
              <div className="segmented">
                <button
                  type="button"
                  aria-pressed={s.bold}
                  onClick={() => set({ bold: !s.bold })}
                  title="Bold"
                  className="seg-bold"
                >
                  B
                </button>
                <button
                  type="button"
                  aria-pressed={s.invert}
                  onClick={() => set({ invert: !s.invert })}
                  title="White text on black"
                >
                  <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden>
                    <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeWidth="1.8" />
                    <path d="M10 3a7 7 0 0 1 0 14z" fill="currentColor" />
                  </svg>
                  <span className="sr-only">Invert</span>
                </button>
              </div>
            </div>
            <div className="field">
              <span className="field-label">Align</span>
              <div className="segmented">
                {ALIGNS.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    aria-pressed={s.align === a.id}
                    onClick={() => set({ align: a.id })}
                    title={a.label}
                  >
                    <svg viewBox="0 0 20 22" width="16" height="16" aria-hidden>
                      <path d={a.icon} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" />
                    </svg>
                    <span className="sr-only">{a.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="row">
            <label className="field grow">
              <span className="field-label">
                Max size <output>{s.maxFontSize}px</output>
              </span>
              <input
                type="range"
                min={10}
                max={96}
                value={s.maxFontSize}
                onChange={(e) => set({ maxFontSize: Number(e.target.value) })}
              />
            </label>
            <label className="field grow">
              <span className="field-label">
                Line spacing <output>{s.lineHeight.toFixed(2)}×</output>
              </span>
              <input
                type="range"
                min={0.8}
                max={1.6}
                step={0.05}
                value={s.lineHeight}
                onChange={(e) => set({ lineHeight: Number(e.target.value) })}
              />
            </label>
          </div>
        </section>

        <section className="card" aria-labelledby="print-heading">
          <h2 id="print-heading">Print</h2>
          <label className="field">
            <span className="field-label">Label size</span>
            <select value={s.sizeId} onChange={(e) => set({ sizeId: e.target.value })}>
              {LABEL_SIZES.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field-label">
              Darkness <output>{s.density}</output>
            </span>
            <input
              type="range"
              min={DENSITY_MIN}
              max={DENSITY_MAX}
              value={s.density}
              onChange={(e) => set({ density: Number(e.target.value) })}
            />
          </label>

          <div className="field">
            <span className="field-label">Copies</span>
            <div className="stepper">
              <button
                type="button"
                onClick={() => set({ copies: Math.max(1, s.copies - 1) })}
                disabled={s.copies <= 1}
                aria-label="Fewer copies"
              >
                −
              </button>
              <input
                type="number"
                min={1}
                max={50}
                value={s.copies}
                onChange={(e) => set({ copies: Math.min(50, Math.max(1, Number(e.target.value) || 1)) })}
                aria-label="Copies"
              />
              <button
                type="button"
                onClick={() => set({ copies: Math.min(50, s.copies + 1) })}
                disabled={s.copies >= 50}
                aria-label="More copies"
              >
                +
              </button>
            </div>
          </div>

          <button type="button" className="btn btn-primary btn-print" onClick={print} disabled={!canPrint}>
            {printing ? 'Printing…' : s.copies > 1 ? `Print ${s.copies} labels` : 'Print label'}
          </button>
          <p className="hint center">
            {conn === 'connected' ? (
              <>
                or press <kbd>Ctrl</kbd> + <kbd>Enter</kbd>
              </>
            ) : (
              'Connect the printer to print.'
            )}
          </p>

          {notice && (
            <p className={`notice notice-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
              {notice.text}
            </p>
          )}
        </section>
      </main>
    </div>
  );
}
