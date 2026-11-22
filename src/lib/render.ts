import { HEAD_DOTS, type LabelSize, type MonoImage } from './protocol';

export type TextAlign = 'left' | 'center' | 'right';

export interface FontOption {
  id: string;
  name: string;
  stack: string;
}

export const FONTS: FontOption[] = [
  { id: 'sans', name: 'Sans', stack: 'Arial, Helvetica, "Liberation Sans", sans-serif' },
  { id: 'condensed', name: 'Condensed', stack: '"Arial Narrow", "Roboto Condensed", "Liberation Sans Narrow", sans-serif' },
  { id: 'serif', name: 'Serif', stack: 'Georgia, "Times New Roman", serif' },
  { id: 'mono', name: 'Mono', stack: 'Consolas, "Cascadia Mono", "DejaVu Sans Mono", monospace' },
];

export interface TextLabel {
  text: string;
  fontId: string;
  bold: boolean;
  /** Largest font size to try; text shrinks until it fits. */
  maxFontSize: number;
  /** Line height as a multiple of the font size. */
  lineHeight: number;
  align: TextAlign;
  invert: boolean;
}

export interface RenderResult {
  image: MonoImage;
  fontSize: number;
  lineCount: number;
  /** True if the text didn't fit even at the minimum font size. */
  overflow: boolean;
}

const PADDING = 4;
const MIN_FONT_SIZE = 6;
const THRESHOLD = 128;

let scratch: HTMLCanvasElement | null = null;

function getContext(width: number, height: number): CanvasRenderingContext2D {
  scratch ??= document.createElement('canvas');
  scratch.width = width;
  scratch.height = height;
  const ctx = scratch.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D is unavailable.');
  return ctx;
}

interface Layout {
  fontSize: number;
  advance: number;
  ascent: number;
  blockHeight: number;
  fits: boolean;
}

function measure(ctx: CanvasRenderingContext2D, lines: string[], fontSize: number, lineHeight: number, maxW: number, maxH: number): Layout {
  const metrics = lines.map((l) => ctx.measureText(l || ' '));
  const advance = fontSize * lineHeight;
  // Size the block by its ink so text is optically centered, falling back to
  // font proportions for blank lines.
  const first = metrics[0];
  const last = metrics[metrics.length - 1];
  const ascent = lines[0] ? first.actualBoundingBoxAscent : fontSize * 0.72;
  const descent = lines[lines.length - 1] ? last.actualBoundingBoxDescent : 0;
  const blockHeight = (lines.length - 1) * advance + ascent + descent;
  const blockWidth = Math.max(
    ...metrics.map((m) => Math.max(m.width, m.actualBoundingBoxLeft + m.actualBoundingBoxRight)),
  );
  return { fontSize, advance, ascent, blockHeight, fits: blockWidth <= maxW && blockHeight <= maxH };
}

/** Renders text to a landscape 1-bit image sized for the label. */
export function renderTextLabel(label: TextLabel, size: LabelSize): RenderResult {
  const W = size.lengthDots;
  const H = HEAD_DOTS;
  const ctx = getContext(W, H);
  const lines = label.text.replace(/\r\n?/g, '\n').split('\n');
  const font = FONTS.find((f) => f.id === label.fontId) ?? FONTS[0];
  const weight = label.bold ? 700 : 400;

  ctx.fillStyle = label.invert ? '#000' : '#fff';
  ctx.fillRect(0, 0, W, H);

  let layout: Layout | null = null;
  const hasText = label.text.trim().length > 0;
  if (hasText) {
    for (let fs = Math.max(MIN_FONT_SIZE, Math.round(label.maxFontSize)); fs >= MIN_FONT_SIZE; fs--) {
      ctx.font = `${weight} ${fs}px ${font.stack}`;
      layout = measure(ctx, lines, fs, label.lineHeight, W - PADDING * 2, H - PADDING * 2);
      if (layout.fits) break;
    }
  }

  if (layout) {
    const { ascent, advance } = layout;
    ctx.font = `${weight} ${layout.fontSize}px ${font.stack}`;
    ctx.fillStyle = label.invert ? '#fff' : '#000';
    ctx.textAlign = label.align;
    ctx.textBaseline = 'alphabetic';
    const x = label.align === 'left' ? PADDING : label.align === 'right' ? W - PADDING : W / 2;
    const top = (H - layout.blockHeight) / 2;
    lines.forEach((line, i) => {
      ctx.fillText(line, x, top + ascent + i * advance);
    });
  }

  const { data } = ctx.getImageData(0, 0, W, H);
  const ink = new Uint8Array(W * H);
  for (let i = 0; i < ink.length; i++) {
    const p = i * 4;
    const lum = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
    ink[i] = lum < THRESHOLD ? 1 : 0;
  }

  return {
    image: { width: W, height: H, ink },
    fontSize: layout?.fontSize ?? 0,
    lineCount: hasText ? lines.length : 0,
    overflow: layout ? !layout.fits : false,
  };
}
