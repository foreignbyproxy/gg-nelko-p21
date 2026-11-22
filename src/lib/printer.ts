/**
 * Web Serial connection to a Nelko P21.
 *
 * On Windows, a paired P21 shows up as a Bluetooth COM port. Recent Chrome and
 * Edge versions can also open classic Bluetooth serial (RFCOMM) devices
 * directly when the SPP service class is allowed in the picker.
 */

/** Bluetooth Serial Port Profile service class UUID. */
const SPP_UUID = '00001101-0000-1000-8000-00805f9b34fb';
const BAUD_RATE = 115200;
/** ESC ! o — clears a paused state before printing. */
const CANCEL_PAUSE = new Uint8Array([0x1b, 0x21, 0x6f]);

export const isSerialSupported = (): boolean =>
  typeof navigator !== 'undefined' && 'serial' in navigator;

type RequestOptions = SerialPortRequestOptions & { allowedBluetoothServiceClassIds?: string[] };
type PortInfo = SerialPortInfo & { bluetoothServiceClassId?: string | number };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class P21Printer {
  private port: SerialPort | null = null;
  private busy = false;
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
  }

  async disconnect(): Promise<void> {
    const port = this.port;
    this.port = null;
    navigator.serial.removeEventListener('disconnect', this.handleDisconnect);
    if (port) {
      try {
        await port.close();
      } catch {
        // Port may already be gone; nothing else to clean up.
      }
    }
  }

  async print(job: Uint8Array): Promise<void> {
    if (!this.port?.writable) throw new Error('Printer is not connected.');
    if (this.busy) throw new Error('A print is already in progress.');
    this.busy = true;
    const writer = this.port.writable.getWriter();
    try {
      await writer.write(CANCEL_PAUSE);
      await sleep(100);
      await writer.write(job);
    } finally {
      writer.releaseLock();
      this.busy = false;
    }
  }
}
