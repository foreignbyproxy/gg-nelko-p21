/**
 * Web Serial connection to a Nelko P21.
 *
 * On Windows, a paired P21 shows up as a Bluetooth COM port. Recent Chrome and
 * Edge versions can also open classic Bluetooth serial (RFCOMM) devices
 * directly when the SPP service class is allowed in the picker.
 *
 * Print jobs get no reply. Queries such as `BATTERY?` do, so a background
 * loop collects incoming bytes and each query waits for its answer. All port
 * traffic goes through one queue so a query never interleaves with a print.
 * Reply formats are parsed in ./replies.ts.
 */

import {
  parseBattery,
  parseConfig,
  parseLabelBlock,
  parseStatus,
  type BatteryStatus,
  type LabelInfo,
  type PrinterConfig,
  type PrinterStatus,
} from './replies';

export type { BatteryStatus, LabelInfo, PrinterConfig, PrinterStatus } from './replies';

/** Bluetooth Serial Port Profile service class UUID. */
const SPP_UUID = '00001101-0000-1000-8000-00805f9b34fb';
const BAUD_RATE = 115200;
const QUERY_TIMEOUT_MS = 2000;
/** Fail instead of waiting forever if the OS never accepts a write. */
const WRITE_TIMEOUT_MS = 5000;
const PRINT_WRITE_TIMEOUT_MS = 15000;
/** After a reply parses, wait briefly so trailing bytes (e.g. CRLF) don't leak into the next query. */
const REPLY_SETTLE_MS = 150;

const encoder = new TextEncoder();
const BATTERY_QUERY = encoder.encode('BATTERY?\r\n');
const CONFIG_QUERY = encoder.encode('CONFIG?\r\n');
// The ESC queries are sent with CRLF, as the hardware-tested reference script does.
/** ESC ! ? — one raw status byte. */
const STATUS_QUERY = new Uint8Array([0x1b, 0x21, 0x3f, 0x0d, 0x0a]);
/** ESC ! o — 16 raw bytes describing the loaded label roll. */
const LABEL_QUERY = new Uint8Array([0x1b, 0x21, 0x6f, 0x0d, 0x0a]);

const hex = (b: Uint8Array, max = 48) =>
  Array.from(b.subarray(0, max), (x) => x.toString(16).padStart(2, '0')).join(' ') +
  (b.length > max ? ` … (${b.length} bytes)` : '');

/** Diagnostic logging is off unless the page URL has `?debug`. */
const DEBUG = typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug');

/** Diagnostic log; open the browser console (F12) to see it. */
const log = (...args: unknown[]) => {
  if (DEBUG) console.log('%c[P21]', 'color:#e4572e;font-weight:bold', ...args);
};

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms / 1000}s`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** Everything the info panel shows. A field is null if the printer didn't answer. */
export interface PrinterInfo {
  status: PrinterStatus | null;
  battery: BatteryStatus | null;
  config: PrinterConfig | null;
  label: LabelInfo | null;
}

export const isSerialSupported = (): boolean =>
  typeof navigator !== 'undefined' && 'serial' in navigator;

type RequestOptions = SerialPortRequestOptions & { allowedBluetoothServiceClassIds?: string[] };
type PortInfo = SerialPortInfo & { bluetoothServiceClassId?: string | number };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class P21Printer {
  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private readLoop: Promise<void> | null = null;
  private rx = new Uint8Array(0);
  private rxListeners = new Set<() => void>();
  private queue: Promise<unknown> = Promise.resolve();
  private onDisconnect: () => void;
  private handleDisconnect = (e: Event) => {
    if (e.target === this.port) {
      this.port = null;
      this.onDisconnect();
    }
  };

  constructor(onDisconnect: () => void) {
    this.onDisconnect = onDisconnect;
  }

  get connected(): boolean {
    return this.port !== null;
  }

  /** Human-readable description of the connected port. */
  describe(): string {
    if (!this.port) return '';
    const info = this.port.getInfo() as PortInfo;
    if (info.bluetoothServiceClassId !== undefined) return 'Bluetooth serial';
    if (info.usbVendorId !== undefined) return 'USB serial';
    return 'Serial port';
  }

  /** Shows the browser's port picker, then opens the chosen port. */
  async connect(): Promise<void> {
    if (!isSerialSupported()) throw new Error('Web Serial is not supported in this browser.');
    const opts: RequestOptions = { allowedBluetoothServiceClassIds: [SPP_UUID] };
    let port: SerialPort;
    try {
      port = await navigator.serial.requestPort(opts);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'NotFoundError') {
        throw new Error('No port selected.');
      }
      throw err;
    }
    try {
      await port.open({ baudRate: BAUD_RATE });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Couldn't open the port (${msg}). Make sure the printer is on and no other app is using it.`,
      );
    }
    this.port = port;
    navigator.serial.addEventListener('disconnect', this.handleDisconnect);
    log('Opened port', port.getInfo());
    this.startReading(port);
    // Give the Bluetooth link a moment to settle before the first query.
    await sleep(500);
  }

  async disconnect(): Promise<void> {
    const port = this.port;
    this.port = null;
    navigator.serial.removeEventListener('disconnect', this.handleDisconnect);
    if (this.reader) {
      try {
        await this.reader.cancel();
      } catch {
        // Stream already errored; the loop will exit on its own.
      }
      await this.readLoop;
    }
    if (port) {
      try {
        await port.close();
      } catch {
        // Port may already be gone; nothing else to clean up.
      }
    }
  }

  async print(job: Uint8Array): Promise<void> {
    return this.exclusive(() => this.write(job, PRINT_WRITE_TIMEOUT_MS));
  }

  /** Asks the printer for its charge level. Resolves null if it doesn't answer. */
  getBattery(): Promise<BatteryStatus | null> {
    return this.query(BATTERY_QUERY, parseBattery);
  }

  /** Reads the status byte (ready, lid open, no labels, …). */
  getStatus(): Promise<PrinterStatus | null> {
    return this.query(STATUS_QUERY, parseStatus);
  }

  /** Reads DPI, hardware/firmware versions, auto power-off and beep settings. */
  getConfig(): Promise<PrinterConfig | null> {
    return this.query(CONFIG_QUERY, parseConfig);
  }

  /** Reads the loaded label roll's details from its NFC tag. */
  getLabel(): Promise<LabelInfo | null> {
    return this.query(LABEL_QUERY, parseLabelBlock);
  }

  /** Runs every query, one after another. */
  async getInfo(): Promise<PrinterInfo> {
    log('Reading printer info…');
    const status = await this.getStatus();
    const battery = await this.getBattery();
    const config = await this.getConfig();
    const label = await this.getLabel();
    return { status, battery, config, label };
  }

  /** Sends one query and waits for its reply. Resolves null on timeout. */
  private query<T>(command: Uint8Array, parse: (buf: Uint8Array) => T | null): Promise<T | null> {
    return this.exclusive(async () => {
      this.rx = new Uint8Array(0);
      await this.write(command, WRITE_TIMEOUT_MS);
      const result = await this.waitFor(parse, QUERY_TIMEOUT_MS);
      if (result === null) {
        log(`No usable reply to ${hex(command)} within ${QUERY_TIMEOUT_MS / 1000}s. Received: ${hex(this.rx) || 'nothing'}`);
      } else {
        log('Parsed reply:', result);
        await sleep(REPLY_SETTLE_MS);
      }
      return result;
    });
  }

  /** Runs port operations one at a time, in the order they were requested. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async write(bytes: Uint8Array, timeoutMs: number): Promise<void> {
    if (!this.port?.writable) throw new Error('Printer is not connected.');
    log('TX', hex(bytes));
    const writer = this.port.writable.getWriter();
    try {
      await withTimeout(writer.write(bytes), timeoutMs, 'Sending to the printer');
    } catch (err) {
      log('Write failed:', err);
      throw err;
    } finally {
      writer.releaseLock();
    }
  }

  private startReading(port: SerialPort): void {
    if (!port.readable) return;
    const reader = port.readable.getReader();
    this.reader = reader;
    this.readLoop = (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value?.length) this.receive(value);
        }
      } catch (err) {
        // Read error or lost connection; handled below or by the disconnect event.
        log('Read error:', err);
      } finally {
        reader.releaseLock();
        if (this.reader === reader) this.reader = null;
      }
      // Non-fatal errors (e.g. a framing error) leave the port usable with a fresh stream.
      if (this.port === port) {
        if (port.readable) {
          log('Restarting reader');
          this.startReading(port);
        } else {
          log('Port can no longer be read; replies will not arrive until you reconnect.');
        }
      }
    })();
  }

  private receive(chunk: Uint8Array): void {
    log('RX', hex(chunk));
    // Keep only recent bytes; replies are tiny.
    const merged = new Uint8Array(Math.min(this.rx.length, 256) + chunk.length);
    merged.set(this.rx.subarray(Math.max(0, this.rx.length - 256)), 0);
    merged.set(chunk, merged.length - chunk.length);
    this.rx = merged;
    this.rxListeners.forEach((fn) => fn());
  }

  private waitFor<T>(parse: (buf: Uint8Array) => T | null, timeoutMs: number): Promise<T | null> {
    return new Promise((resolve) => {
      const finish = (result: T | null) => {
        clearTimeout(timer);
        this.rxListeners.delete(check);
        resolve(result);
      };
      const check = () => {
        const result = parse(this.rx);
        if (result !== null) finish(result);
      };
      const timer = setTimeout(() => finish(null), timeoutMs);
      this.rxListeners.add(check);
      check();
    });
  }
}
