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
 * Reply formats: merlinschumacher/nelko-p21-print.
 */

/** Bluetooth Serial Port Profile service class UUID. */
const SPP_UUID = '00001101-0000-1000-8000-00805f9b34fb';
const BAUD_RATE = 115200;
const QUERY_TIMEOUT_MS = 2000;

const encoder = new TextEncoder();
const BATTERY_QUERY = encoder.encode('BATTERY?\r\n');
const BATTERY_PREFIX = encoder.encode('BATTERY ');

export interface BatteryStatus {
  /** 0–99. The printer reports 99 whenever it's charging. */
  percent: number;
  charging: boolean;
}

export const isSerialSupported = (): boolean =>
  typeof navigator !== 'undefined' && 'serial' in navigator;

type RequestOptions = SerialPortRequestOptions & { allowedBluetoothServiceClassIds?: string[] };
type PortInfo = SerialPortInfo & { bluetoothServiceClassId?: string | number };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function indexOf(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/** Parses `BATTERY ` + [level as BCD, charging flag]. Returns null until complete. */
export function parseBattery(buf: Uint8Array): BatteryStatus | null {
  const at = indexOf(buf, BATTERY_PREFIX);
  const p = at + BATTERY_PREFIX.length;
  if (at < 0 || buf.length < p + 2) return null;
  const level = buf[p];
  const hi = level >> 4;
  const lo = level & 0x0f;
  const percent = hi <= 9 && lo <= 9 ? hi * 10 + lo : Math.min(99, level);
  return { percent, charging: buf[p + 1] !== 0 };
}

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
    return this.exclusive(() => this.write(job));
  }

  /** Asks the printer for its charge level. Resolves null if it doesn't answer. */
  async getBattery(): Promise<BatteryStatus | null> {
    return this.exclusive(async () => {
      this.rx = new Uint8Array(0);
      await this.write(BATTERY_QUERY);
      return this.waitFor(parseBattery, QUERY_TIMEOUT_MS);
    });
  }

  /** Runs port operations one at a time, in the order they were requested. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async write(bytes: Uint8Array): Promise<void> {
    if (!this.port?.writable) throw new Error('Printer is not connected.');
    const writer = this.port.writable.getWriter();
    try {
      await writer.write(bytes);
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
      } catch {
        // Read error or lost connection; handled below or by the disconnect event.
      } finally {
        reader.releaseLock();
        if (this.reader === reader) this.reader = null;
      }
      // Non-fatal errors (e.g. a framing error) leave the port usable with a fresh stream.
      if (this.port === port && port.readable) this.startReading(port);
    })();
  }

  private receive(chunk: Uint8Array): void {
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
