/**
 * Parsers for the P21's query replies. Formats documented by
 * merlinschumacher/nelko-p21-print.
 *
 * Text queries (`BATTERY?`, `CONFIG?`) reply with a prefix, a binary payload
 * and CRLF. Status queries (`ESC ! ?`, `ESC ! o`) reply with raw bytes and no
 * terminator. Each parser returns null until its reply has fully arrived.
 */

const encoder = new TextEncoder();

function indexOf(haystack: Uint8Array, needle: Uint8Array, from = 0): number {
  outer: for (let i = from; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/**
 * Finds `prefix` and returns the `len` payload bytes after it. Doesn't wait
 * for the CRLF: if a printer ends lines differently, the reply still parses.
 * The caller pauses briefly after a reply so a trailing CRLF can't leak into
 * the next query.
 */
function textPayload(buf: Uint8Array, prefix: Uint8Array, len: number): Uint8Array | null {
  const at = indexOf(buf, prefix);
  if (at < 0) return null;
  const start = at + prefix.length;
  return buf.length >= start + len ? buf.subarray(start, start + len) : null;
}

// ---------- Battery: `BATTERY?` → "BATTERY " + [level BCD, charging] + CRLF ----------

export interface BatteryStatus {
  /** 0–99. The printer reports 99 whenever it's charging. */
  percent: number;
  charging: boolean;
}

const BATTERY_PREFIX = encoder.encode('BATTERY ');

export function parseBattery(buf: Uint8Array): BatteryStatus | null {
  const p = textPayload(buf, BATTERY_PREFIX, 2);
  if (!p) return null;
  const hi = p[0] >> 4;
  const lo = p[0] & 0x0f;
  const percent = hi <= 9 && lo <= 9 ? hi * 10 + lo : Math.min(99, p[0]);
  return { percent, charging: p[1] !== 0 };
}

// ---------- Config: `CONFIG?` → "CONFIG " + 10 bytes (or 20) + CRLF ----------

export interface PrinterConfig {
  dpi: number;
  hardwareVersion: string;
  firmwareVersion: string;
  /** Auto power-off, e.g. "30 minutes" or "Never". */
  autoPowerOff: string;
  beep: boolean;
}

const CONFIG_PREFIX = encoder.encode('CONFIG ');
const TIMER_TEXT: Record<number, string> = { 0: 'Never', 1: '15 minutes', 2: '30 minutes', 3: '60 minutes' };

export function parseConfig(buf: Uint8Array): PrinterConfig | null {
  const p = textPayload(buf, CONFIG_PREFIX, 10);
  if (!p) return null;
  return {
    dpi: (p[0] << 8) | p[1],
    hardwareVersion: `${p[2]}.${p[3]}.${p[4]}`,
    firmwareVersion: `${p[5]}.${p[6]}.${p[7]}`,
    autoPowerOff: TIMER_TEXT[p[8]] ?? `Unknown (${p[8]})`,
    beep: p[9] !== 0,
  };
}

// ---------- Status: `ESC ! ?` → 1 raw byte ----------

export type Severity = 'ok' | 'warn' | 'error';

export interface PrinterStatus {
  code: number;
  ready: boolean;
  text: string;
  severity: Severity;
}

/** Exact codes listed in the protocol docs. Only 0x00 and 0x04 have been observed on a real P21. */
const STATUS_CODES: Record<number, [string, Severity]> = {
  0x00: ['Ready', 'ok'],
  0x01: ['Lid open', 'error'],
  0x02: ['Feeding', 'warn'],
  0x03: ['Paper error', 'error'],
  0x04: ['No labels loaded', 'error'],
  0x10: ['Paused', 'warn'],
  0x20: ['Busy', 'warn'],
  0x24: ['Out of labels', 'error'],
  0x30: ['Low battery', 'error'],
  0x80: ['Overheated', 'error'],
  0x90: ['No power', 'error'],
};

/** Individual flags, for codes that aren't in the table (the byte is a bitfield). */
const STATUS_BITS: [number, string, Severity][] = [
  [0x80, 'Overheated', 'error'],
  [0x20, 'Busy', 'warn'],
  [0x10, 'Paused', 'warn'],
  [0x04, 'No labels loaded', 'error'],
  [0x02, 'Feeding', 'warn'],
  [0x01, 'Lid open', 'error'],
];

export function decodeStatus(code: number): PrinterStatus {
  const known = STATUS_CODES[code];
  if (known) return { code, ready: code === 0, text: known[0], severity: known[1] };
  const parts: string[] = [];
  let severity: Severity = 'warn';
  let rest = code;
  for (const [bit, text, sev] of STATUS_BITS) {
    if (code & bit) {
      parts.push(text);
      rest &= ~bit;
      if (sev === 'error') severity = 'error';
    }
  }
  if (rest) parts.push(`Unknown (0x${rest.toString(16).padStart(2, '0')})`);
  return { code, ready: false, text: parts.join(', '), severity };
}

export function parseStatus(buf: Uint8Array): PrinterStatus | null {
  return buf.length >= 1 ? decodeStatus(buf[0]) : null;
}

// ---------- Label roll: `ESC ! o` → 16 raw bytes read from the roll's NFC tag ----------

export type LabelColor = 'transparent' | 'white' | 'pink' | 'blue' | 'yellow' | 'unknown';

export interface LabelInfo {
  /** False when no tag was read (bytes 2–13 are all zero). */
  hasTag: boolean;
  widthMm: number;
  lengthMm: number;
  usableWidthMm: number;
  gapMm: number;
  type: string;
  color: LabelColor;
  batch: number;
  /** The 12 tag bytes as hex; identifies the roll. */
  paperCode: string;
  /** The printer status carried in byte 0. */
  status: PrinterStatus;
  /** False if the block's checksum didn't match, so the values may be garbled. */
  checksumOk: boolean;
}

const COLORS: Record<number, LabelColor> = { 2: 'transparent', 3: 'white', 4: 'pink', 5: 'blue', 6: 'yellow' };
const TYPES: Record<number, string> = { 0: 'Continuous', 1: 'Gapped', 2: 'Black mark' };

/** CRC16/MODBUS (poly 0xA001, init 0xFFFF). */
export function crc16(data: Uint8Array): number {
  let crc = 0xffff;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  }
  return crc;
}

export function parseLabelBlock(buf: Uint8Array): LabelInfo | null {
  if (buf.length < 16) return null;
  const b = buf.subarray(0, 16);
  const tag = b.subarray(2, 14);
  const format = b[3] >> 4;
  // From tag format 2, byte 7's high nibble means something else and byte 8 is the gap.
  const typeByte = format >= 2 ? b[7] & 0x0f : b[7];
  return {
    hasTag: tag.some((x) => x !== 0),
    widthMm: b[13],
    lengthMm: b[11],
    usableWidthMm: b[12],
    gapMm: format >= 2 && b[8] ? b[8] : 5,
    type: TYPES[typeByte] ?? `Unknown (${typeByte})`,
    color: COLORS[b[4]] ?? 'unknown',
    batch: (b[5] << 8) | b[6],
    paperCode: Array.from(tag, (x) => x.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase(),
    status: decodeStatus(b[0]),
    checksumOk: crc16(b.subarray(0, 14)) === ((b[14] << 8) | b[15]),
  };
}
