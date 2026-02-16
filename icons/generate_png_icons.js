const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function clamp(v, min = 0, max = 255) {
  return Math.max(min, Math.min(max, v));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function colorLerp(c1, c2, t) {
  return {
    r: Math.round(lerp(c1.r, c2.r, t)),
    g: Math.round(lerp(c1.g, c2.g, t)),
    b: Math.round(lerp(c1.b, c2.b, t)),
    a: Math.round(lerp(c1.a ?? 255, c2.a ?? 255, t)),
  };
}

function createCanvas(w, h) {
  return {
    w,
    h,
    data: new Uint8Array(w * h * 4),
  };
}

function blendPixel(canvas, x, y, c) {
  const ix = Math.round(x);
  const iy = Math.round(y);
  if (ix < 0 || iy < 0 || ix >= canvas.w || iy >= canvas.h) return;
  const i = (iy * canvas.w + ix) * 4;

  const sr = c.r;
  const sg = c.g;
  const sb = c.b;
  const sa = (c.a ?? 255) / 255;

  const dr = canvas.data[i];
  const dg = canvas.data[i + 1];
  const db = canvas.data[i + 2];
  const da = canvas.data[i + 3] / 255;

  const outA = sa + da * (1 - sa);
  if (outA <= 0) return;

  const outR = (sr * sa + dr * da * (1 - sa)) / outA;
  const outG = (sg * sa + dg * da * (1 - sa)) / outA;
  const outB = (sb * sa + db * da * (1 - sa)) / outA;

  canvas.data[i] = clamp(Math.round(outR));
  canvas.data[i + 1] = clamp(Math.round(outG));
  canvas.data[i + 2] = clamp(Math.round(outB));
  canvas.data[i + 3] = clamp(Math.round(outA * 255));
}

function insideRoundedRect(px, py, x, y, w, h, r) {
  const rx = Math.max(x + r, Math.min(px, x + w - r));
  const ry = Math.max(y + r, Math.min(py, y + h - r));
  const dx = px - rx;
  const dy = py - ry;
  return dx * dx + dy * dy <= r * r;
}

function fillRoundedRectGradient(canvas, x, y, w, h, r, c1, c2) {
  const minX = Math.floor(x);
  const minY = Math.floor(y);
  const maxX = Math.ceil(x + w);
  const maxY = Math.ceil(y + h);
  for (let py = minY; py < maxY; py++) {
    for (let px = minX; px < maxX; px++) {
      if (!insideRoundedRect(px + 0.5, py + 0.5, x, y, w, h, r)) continue;
      const tx = (px - x) / Math.max(1, w - 1);
      const ty = (py - y) / Math.max(1, h - 1);
      const t = Math.max(0, Math.min(1, (tx + ty) * 0.5));
      blendPixel(canvas, px, py, colorLerp(c1, c2, t));
    }
  }
}

function strokeRoundedRect(canvas, x, y, w, h, r, thickness, color) {
  const innerX = x + thickness;
  const innerY = y + thickness;
  const innerW = Math.max(0, w - thickness * 2);
  const innerH = Math.max(0, h - thickness * 2);
  const innerR = Math.max(0, r - thickness);

  const minX = Math.floor(x);
  const minY = Math.floor(y);
  const maxX = Math.ceil(x + w);
  const maxY = Math.ceil(y + h);

  for (let py = minY; py < maxY; py++) {
    for (let px = minX; px < maxX; px++) {
      const cx = px + 0.5;
      const cy = py + 0.5;
      const inOuter = insideRoundedRect(cx, cy, x, y, w, h, r);
      const inInner = innerW > 0 && innerH > 0 && insideRoundedRect(cx, cy, innerX, innerY, innerW, innerH, innerR);
      if (inOuter && !inInner) {
        blendPixel(canvas, px, py, color);
      }
    }
  }
}

function drawCircle(canvas, cx, cy, r, color) {
  const minX = Math.floor(cx - r);
  const maxX = Math.ceil(cx + r);
  const minY = Math.floor(cy - r);
  const maxY = Math.ceil(cy + r);
  const rr = r * r;
  for (let py = minY; py <= maxY; py++) {
    for (let px = minX; px <= maxX; px++) {
      const dx = (px + 0.5) - cx;
      const dy = (py + 0.5) - cy;
      if (dx * dx + dy * dy <= rr) blendPixel(canvas, px, py, color);
    }
  }
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const vx = x2 - x1;
  const vy = y2 - y1;
  const wx = px - x1;
  const wy = py - y1;
  const c1 = vx * wx + vy * wy;
  if (c1 <= 0) return Math.hypot(px - x1, py - y1);
  const c2 = vx * vx + vy * vy;
  if (c2 <= c1) return Math.hypot(px - x2, py - y2);
  const b = c1 / c2;
  const bx = x1 + b * vx;
  const by = y1 + b * vy;
  return Math.hypot(px - bx, py - by);
}

function drawLine(canvas, x1, y1, x2, y2, thickness, color) {
  const pad = thickness / 2 + 1;
  const minX = Math.floor(Math.min(x1, x2) - pad);
  const maxX = Math.ceil(Math.max(x1, x2) + pad);
  const minY = Math.floor(Math.min(y1, y2) - pad);
  const maxY = Math.ceil(Math.max(y1, y2) + pad);
  const radius = thickness / 2;

  for (let py = minY; py <= maxY; py++) {
    for (let px = minX; px <= maxX; px++) {
      const d = distToSegment(px + 0.5, py + 0.5, x1, y1, x2, y2);
      if (d <= radius) blendPixel(canvas, px, py, color);
    }
  }
}

function drawIcon(size) {
  const s = size / 128;
  const canvas = createCanvas(size, size);

  // Back to previous "bubble + branch" concept with slightly brighter colors.
  const bg1 = { r: 56, g: 189, b: 248, a: 255 };
  const bg2 = { r: 45, g: 212, b: 191, a: 255 };
  const dark = { r: 15, g: 23, b: 42, a: 255 };
  const white = { r: 255, g: 255, b: 255, a: 255 };

  fillRoundedRectGradient(canvas, 4 * s, 4 * s, 120 * s, 120 * s, 24 * s, bg1, bg2);
  strokeRoundedRect(canvas, 4 * s, 4 * s, 120 * s, 120 * s, 24 * s, Math.max(1, 3 * s), { r: 255, g: 255, b: 255, a: 110 });

  fillRoundedRectGradient(canvas, 16 * s, 20 * s, 96 * s, 66 * s, 18 * s, white, white);
  drawLine(canvas, 52 * s, 84 * s, 38 * s, 100 * s, Math.max(1, 11 * s), white);
  drawLine(canvas, 38 * s, 100 * s, 60 * s, 88 * s, Math.max(1, 11 * s), white);

  const branchStroke = size <= 16 ? 3.1 : Math.max(2, 10 * s);
  drawLine(canvas, 64 * s, 74 * s, 64 * s, 52 * s, branchStroke, dark);
  drawLine(canvas, 64 * s, 56 * s, 47 * s, 44 * s, branchStroke, dark);
  drawLine(canvas, 64 * s, 56 * s, 82 * s, 44 * s, branchStroke, dark);

  if (size > 16) {
    const nodeRadius = Math.max(2, 5.5 * s);
    drawCircle(canvas, 64 * s, 76 * s, nodeRadius, dark);
    drawCircle(canvas, 45 * s, 43 * s, nodeRadius, dark);
    drawCircle(canvas, 84 * s, 43 * s, nodeRadius, dark);
  }

  return canvas;
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  const crcVal = crc32(Buffer.concat([typeBuf, data]));
  crc.writeUInt32BE(crcVal >>> 0, 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePNG(canvas) {
  const signature = Buffer.from([137,80,78,71,13,10,26,10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(canvas.w, 0);
  ihdr.writeUInt32BE(canvas.h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rowLen = canvas.w * 4;
  const raw = Buffer.alloc((rowLen + 1) * canvas.h);
  for (let y = 0; y < canvas.h; y++) {
    const out = y * (rowLen + 1);
    raw[out] = 0;
    canvas.data.copy ? canvas.data.copy(raw, out + 1, y * rowLen, (y + 1) * rowLen) : raw.set(canvas.data.subarray(y * rowLen, (y + 1) * rowLen), out + 1);
  }

  const compressed = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function writeIcon(size, outPath) {
  const canvas = drawIcon(size);
  const png = encodePNG(canvas);
  fs.writeFileSync(outPath, png);
}

const targets = [
  { size: 16, file: 'icon16.png' },
  { size: 48, file: 'icon48.png' },
  { size: 128, file: 'icon128.png' },
];

for (const t of targets) {
  const outPath = path.join(__dirname, t.file);
  writeIcon(t.size, outPath);
  console.log('generated', outPath);
}
