import { useEffect, useRef } from 'react';
import type { LabelSize, MonoImage } from '../lib/protocol';

interface Props {
  image: MonoImage;
  size: LabelSize;
}

/** Shows the exact 1-bit bitmap that will be printed, styled as a label. */
export function LabelPreview({ image, size }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const out = ctx.createImageData(image.width, image.height);
    // Thermal ink on slightly warm label stock.
    const INK = [29, 27, 24];
    const PAPER = [255, 253, 247];
    for (let i = 0; i < image.ink.length; i++) {
      const c = image.ink[i] ? INK : PAPER;
      out.data.set([c[0], c[1], c[2], 255], i * 4);
    }
    ctx.putImageData(out, 0, 0);
  }, [image]);

  return (
    <figure className="preview">
      <div className="preview-stage">
        <div className="tape" style={{ aspectRatio: `${image.width} / ${image.height}` }}>
          <canvas ref={canvasRef} className="tape-canvas" aria-label="Label preview" />
        </div>
      </div>
      <figcaption className="preview-caption">
        <span>{size.name}</span>
        <span className="dot" aria-hidden>·</span>
        <span>
          {image.width} × {image.height} dots
        </span>
        <span className="dot" aria-hidden>·</span>
        <span>Exact print preview</span>
      </figcaption>
    </figure>
  );
}
