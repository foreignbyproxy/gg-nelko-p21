/**
 * Nelko P21 print protocol (a TSPL dialect).
 *
 * A print job is a few text commands followed by one raw 1-bit bitmap:
 *
 *   SIZE 14.0 mm,40.0 mm
 *   GAP 5.0 mm,0 mm
 *   DIRECTION 1,1
 *   DENSITY 7
 *   CLS
 *   BITMAP 0,0,12,284,0,<raw bytes>
 *   PRINT 1
 *
 * The print head is 96 dots wide, so the bitmap is always 96 px (12 bytes)
 * per row. Labels are designed in landscape (length × 96) and rotated 90°
 * clockwise into the printer's portrait orientation before packing.
 * In the bitmap, a 1 bit is white (no burn) and a 0 bit is black.
 *
 * Protocol reverse-engineered by merlinschumacher/nelko-p21-print. The byte
 * layout matches the known-working kennedn/nelko-p21 fork; additional label
 * sizes come from TylerCode/Fyne-P21-Print.
 */

export const HEAD_DOTS = 96;

export interface LabelSize {
  id: string;
  name: string;
  widthMm: number;
  heightMm: number;
  /** Label length in dots (the landscape canvas width). */
  lengthDots: number;
}

export const LABEL_SIZES: LabelSize[] = [
  { id: '14x40', name: '14 × 40 mm', widthMm: 14, heightMm: 40, lengthDots: 284 },
  { id: '12x40', name: '12 × 40 mm', widthMm: 12, heightMm: 40, lengthDots: 284 },
  { id: '14x50', name: '14 × 50 mm', widthMm: 14, heightMm: 50, lengthDots: 355 },
  { id: '14x75', name: '14 × 75 mm', widthMm: 14, heightMm: 75, lengthDots: 532 },
  { id: '15x30', name: '15 × 30 mm', widthMm: 15, heightMm: 30, lengthDots: 213 },
];

export const DEFAULT_SIZE_ID = '14x40';
export const DENSITY_MIN = 0;
export const DENSITY_MAX = 15;
export const DEFAULT_DENSITY = 7;

/** A landscape 1-bit image: `ink[y * width + x]` is 1 for black. */
export interface MonoImage {
  width: number;
  height: number;
  ink: Uint8Array;
}

/** Rotate a landscape image 90° clockwise and pack it into printer rows. */
export function packBitmap(img: MonoImage): { bytesPerRow: number; rows: number; data: Uint8Array } {
  const { width: W, height: H, ink } = img;
  if (H !== HEAD_DOTS) throw new Error(`image height must be ${HEAD_DOTS}, got ${H}`);
  const bytesPerRow = H / 8;
  const rows = W;
  // Start all-white (every bit 1), then clear bits for black dots.
  const data = new Uint8Array(bytesPerRow * rows).fill(0xff);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < H; c++) {
      // Clockwise rotation: output (c, r) comes from source (x = r, y = H - 1 - c).
      if (ink[(H - 1 - c) * W + r]) {
        data[r * bytesPerRow + (c >> 3)] &= ~(0x80 >> (c & 7));
      }
    }
  }
  return { bytesPerRow, rows, data };
}

export function buildPrintJob(img: MonoImage, size: LabelSize, density: number, copies: number): Uint8Array {
  const d = Math.round(Math.min(DENSITY_MAX, Math.max(DENSITY_MIN, density)));
  const n = Math.max(1, Math.round(copies));
  const { bytesPerRow, rows, data } = packBitmap(img);
  const enc = new TextEncoder();
  const header = enc.encode(
    `SIZE ${size.widthMm.toFixed(1)} mm,${size.heightMm.toFixed(1)} mm\r\n` +
      `GAP 5.0 mm,0 mm\r\n` +
      `DIRECTION 1,1\r\n` +
      `DENSITY ${d}\r\n` +
      `CLS\r\n` +
      `BITMAP 0,0,${bytesPerRow},${rows},0,`,
  );
  const footer = enc.encode(`\r\nPRINT ${n}\r\n`);
  const job = new Uint8Array(header.length + data.length + footer.length);
  job.set(header, 0);
  job.set(data, header.length);
  job.set(footer, header.length + data.length);
  return job;
}
