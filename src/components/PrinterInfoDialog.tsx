import { useEffect, useRef, type ReactNode } from 'react';
import type { PrinterInfo } from '../lib/printer';
import type { LabelSize } from '../lib/protocol';
import type { LabelColor } from '../lib/replies';

interface Props {
  open: boolean;
  onClose: () => void;
  info: { data: PrinterInfo; at: Date } | null;
  loading: boolean;
  onRefresh: () => void;
  selectedSize: LabelSize;
}

const COLOR_NAMES: Record<LabelColor, string> = {
  transparent: 'Transparent',
  white: 'White',
  pink: 'Pink',
  blue: 'Blue',
  yellow: 'Yellow',
  unknown: 'Unknown',
};

const NO_ANSWER = <span className="muted">No answer</span>;

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="info-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function PrinterInfoDialog({ open, onClose, info, loading, onRefresh, selectedSize }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const d = info?.data;
  const label = d?.label;
  const sizeMismatch =
    label?.hasTag && (label.widthMm !== selectedSize.widthMm || label.lengthMm !== selectedSize.heightMm);

  return (
    <dialog
      ref={ref}
      className="info-dialog"
      aria-labelledby="info-title"
      onClose={onClose}
      onClick={(e) => {
        // Clicking the backdrop (outside the panel) closes the dialog.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="info-panel">
        <header className="info-head">
          <h2 id="info-title">Printer info</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden>
              <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        {!d ? (
          <p className="info-loading">Reading from the printer…</p>
        ) : (
          <div className={`info-body${loading ? ' is-refreshing' : ''}`}>
            <section>
              <h3>Printer</h3>
              <dl>
                <Row label="Status">
                  {d.status ? (
                    <span className={`badge badge-${d.status.severity}`}>{d.status.text}</span>
                  ) : (
                    NO_ANSWER
                  )}
                </Row>
                <Row label="Battery">
                  {d.battery ? (d.battery.charging ? 'Charging' : `${d.battery.percent}%`) : NO_ANSWER}
                </Row>
                <Row label="Firmware">{d.config ? <code>{d.config.firmwareVersion}</code> : NO_ANSWER}</Row>
                <Row label="Hardware">{d.config ? <code>{d.config.hardwareVersion}</code> : NO_ANSWER}</Row>
                {d.config && (
                  <>
                    <Row label="Resolution">{d.config.dpi} dpi</Row>
                    <Row label="Auto power-off">{d.config.autoPowerOff}</Row>
                    <Row label="Beep">{d.config.beep ? 'On' : 'Off'}</Row>
                  </>
                )}
              </dl>
            </section>

            <section>
              <h3>Loaded labels</h3>
              {!label ? (
                <p className="muted">The printer didn't report the loaded roll.</p>
              ) : !label.hasTag ? (
                <p className="muted">
                  No label tag detected. The printer can still print, but choose the label size yourself.
                </p>
              ) : (
                <>
                  <dl>
                    <Row label="Size">
                      {label.widthMm} × {label.lengthMm} mm
                    </Row>
                    <Row label="Type">{label.type}</Row>
                    <Row label="Gap">{label.gapMm} mm</Row>
                    <Row label="Colour">
                      <span className="swatch-wrap">
                        <span className={`swatch swatch-${label.color}`} aria-hidden />
                        {COLOR_NAMES[label.color]}
                      </span>
                    </Row>
                    <Row label="Paper code">
                      <code className="code-wrap">{label.paperCode}</code>
                    </Row>
                    <Row label="Batch">{label.batch}</Row>
                  </dl>
                  {sizeMismatch && (
                    <p className="info-note">
                      The app is set to {selectedSize.name}. Change <strong>Label size</strong> to match the loaded
                      roll.
                    </p>
                  )}
                  {!label.checksumOk && (
                    <p className="info-note info-note-warn">
                      The label data failed its checksum, so these values may be wrong. Try refreshing.
                    </p>
                  )}
                </>
              )}
            </section>
          </div>
        )}

        <footer className="info-foot">
          <span className="hint">
            {info ? `Checked ${info.at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}` : ''}
          </span>
          <button type="button" className="btn btn-ghost" onClick={onRefresh} disabled={loading}>
            {loading ? 'Reading…' : 'Refresh'}
          </button>
        </footer>
      </div>
    </dialog>
  );
}
