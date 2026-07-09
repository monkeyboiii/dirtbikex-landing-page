import { decode, encode } from 'fast-png';
import qrcode from 'qrcode-generator';

const SENTINEL_R = 255;
const SENTINEL_G = 0;
const SENTINEL_B = 255;
const QUIET_MODULES = 1;
const MIN_MODULE_PX = 4;

/** Paint `url` as a QR into the template's magenta sentinel. See JOIN_MODULE.md "Invite cards". */
export function composeCard(template: ArrayBuffer, url: string): Uint8Array {
  const img = decode(template);
  const { width, height, channels } = img;
  const data = img.data as Uint8Array;

  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      if (data[i] === SENTINEL_R && data[i + 1] === SENTINEL_G && data[i + 2] === SENTINEL_B) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) throw new Error('sentinel_not_found');

  const size = Math.min(x1 - x0, y1 - y0) + 1;
  const qr = qrcode(0, 'M');
  qr.addData(url);
  qr.make();
  const modules = qr.getModuleCount();
  const scale = Math.floor(size / (modules + 2 * QUIET_MODULES));
  if (scale < MIN_MODULE_PX) throw new Error('qr_too_small');

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = (y * width + x) * channels;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      if (channels === 4) data[i + 3] = 255;
    }
  }

  const drawn = scale * (modules + 2 * QUIET_MODULES);
  const offset = Math.floor((size - drawn) / 2) + QUIET_MODULES * scale;
  for (let row = 0; row < modules; row++) {
    for (let col = 0; col < modules; col++) {
      if (!qr.isDark(row, col)) continue;
      for (let dy = 0; dy < scale; dy++) {
        const py = y0 + offset + row * scale + dy;
        for (let dx = 0; dx < scale; dx++) {
          const px = x0 + offset + col * scale + dx;
          const i = (py * width + px) * channels;
          data[i] = 0;
          data[i + 1] = 0;
          data[i + 2] = 0;
        }
      }
    }
  }

  return encode(img);
}
