import { crc32, deflateSync } from 'node:zlib';

/**
 * Renders the extension icon (a white bookmark ribbon on a dark rounded square) as a PNG,
 * so the repo needs no binary assets. 4×4 supersampling gives smooth edges.
 */
export function renderIcon(size: number): Buffer {
  const SAMPLES = 4;
  const rgba = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let background = 0;
      let ribbon = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const u = (x + (sx + 0.5) / SAMPLES) / size;
          const v = (y + (sy + 0.5) / SAMPLES) / size;
          if (insideRoundedSquare(u, v, 0.22)) background++;
          if (insideRibbon(u, v)) ribbon++;
        }
      }
      const total = SAMPLES * SAMPLES;
      const ribbonShare = ribbon / total;
      // Dark zinc square (#18181b) with the white ribbon blended on top.
      const offset = (y * size + x) * 4;
      rgba[offset] = Math.round(0x18 + (0xff - 0x18) * ribbonShare);
      rgba[offset + 1] = Math.round(0x18 + (0xff - 0x18) * ribbonShare);
      rgba[offset + 2] = Math.round(0x1b + (0xff - 0x1b) * ribbonShare);
      rgba[offset + 3] = Math.round((255 * background) / total);
    }
  }
  return encodePng(size, size, rgba);
}

function insideRoundedSquare(u: number, v: number, radius: number): boolean {
  const dx = Math.max(radius - u, 0, u - (1 - radius));
  const dy = Math.max(radius - v, 0, v - (1 - radius));
  return dx * dx + dy * dy <= radius * radius;
}

function insideRibbon(u: number, v: number): boolean {
  const left = 0.32;
  const right = 0.68;
  const top = 0.2;
  const bottom = 0.8;
  const notch = 0.16;
  if (u < left || u > right || v < top || v > bottom) return false;
  const halfWidth = (right - left) / 2;
  const distanceFromCenter = Math.abs(u - (left + halfWidth));
  // The V-shaped notch at the bottom of the ribbon.
  return v <= bottom - notch * (1 - distanceFromCenter / halfWidth);
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

function encodePng(width: number, height: number, rgba: Buffer): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  // Remaining bytes (compression, filter, interlace) are 0.

  // Each scanline is prefixed with filter type 0 (none).
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
