#!/usr/bin/env node
/**
 * Generate 1:1 PNG mockups for side-panel UI proposals.
 * No external dependencies (pure Node + zlib).
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const WIDTH = 480;
const HEIGHT = 560;

const COLORS = {
  pageBg: [245, 245, 247, 255],
  nativeBar: [232, 234, 226, 255],
  nativeBorder: [214, 217, 206, 255],
  headerCard: [250, 250, 252, 255],
  headerBorder: [220, 221, 229, 255],
  textMain: [34, 37, 48, 255],
  textMuted: [114, 118, 136, 255],
  textBrand: [54, 44, 142, 255],
  accent: [108, 90, 240, 255],
  accentSoft: [236, 233, 255, 255],
  accentText: [88, 68, 225, 255],
  treeLine: [211, 214, 228, 255],
  statusLive: [56, 202, 92, 255],
  statusDot: [154, 160, 176, 255],
  rowHover: [234, 236, 244, 255],
  chipBg: [237, 232, 255, 255],
  chipBorder: [183, 166, 255, 255],
  chipText: [93, 70, 221, 255],
  white: [255, 255, 255, 255],
  dangerGuide: [220, 40, 40, 255],
};

class Canvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = Buffer.alloc(width * height * 4, 0);
  }

  setPixel(x, y, rgba) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const idx = (y * this.width + x) * 4;
    this.data[idx] = rgba[0];
    this.data[idx + 1] = rgba[1];
    this.data[idx + 2] = rgba[2];
    this.data[idx + 3] = rgba[3];
  }

  fillRect(x, y, w, h, rgba) {
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.width, Math.floor(x + w));
    const y1 = Math.min(this.height, Math.floor(y + h));
    for (let yy = y0; yy < y1; yy += 1) {
      for (let xx = x0; xx < x1; xx += 1) {
        this.setPixel(xx, yy, rgba);
      }
    }
  }

  fillRoundedRect(x, y, w, h, r, rgba) {
    const radius = Math.max(0, Math.min(r, Math.floor(Math.min(w, h) / 2)));
    this.fillRect(x + radius, y, w - radius * 2, h, rgba);
    this.fillRect(x, y + radius, radius, h - radius * 2, rgba);
    this.fillRect(x + w - radius, y + radius, radius, h - radius * 2, rgba);
    for (let yy = 0; yy < radius; yy += 1) {
      for (let xx = 0; xx < radius; xx += 1) {
        const dx = radius - xx;
        const dy = radius - yy;
        if (dx * dx + dy * dy <= radius * radius) {
          this.setPixel(x + xx, y + yy, rgba);
          this.setPixel(x + w - radius + xx, y + yy, rgba);
          this.setPixel(x + xx, y + h - radius + yy, rgba);
          this.setPixel(x + w - radius + xx, y + h - radius + yy, rgba);
        }
      }
    }
  }

  strokeRect(x, y, w, h, t, rgba) {
    this.fillRect(x, y, w, t, rgba);
    this.fillRect(x, y + h - t, w, t, rgba);
    this.fillRect(x, y, t, h, rgba);
    this.fillRect(x + w - t, y, t, h, rgba);
  }

  line(x0, y0, x1, y1, rgba) {
    let sx = x0 < x1 ? 1 : -1;
    let sy = y0 < y1 ? 1 : -1;
    let dx = Math.abs(x1 - x0);
    let dy = -Math.abs(y1 - y0);
    let err = dx + dy;
    let x = x0;
    let y = y0;
    while (true) {
      this.setPixel(x, y, rgba);
      if (x === x1 && y === y1) break;
      const e2 = err * 2;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
  }

  fillCircle(cx, cy, r, rgba) {
    for (let y = -r; y <= r; y += 1) {
      for (let x = -r; x <= r; x += 1) {
        if (x * x + y * y <= r * r) {
          this.setPixel(cx + x, cy + y, rgba);
        }
      }
    }
  }
}

const FONT = {
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01110'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  0: ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  3: ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  5: ['11111', '10000', '10000', '11110', '00001', '00001', '11110'],
  6: ['01110', '10000', '10000', '11110', '10001', '10001', '01110'],
  7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  9: ['01110', '10001', '10001', '01111', '00001', '00001', '01110'],
  '+': ['00000', '00100', '00100', '11111', '00100', '00100', '00000'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  '.': ['00000', '00000', '00000', '00000', '00000', '00100', '00100'],
  ':': ['00000', '00100', '00100', '00000', '00100', '00100', '00000'],
  '/': ['00001', '00010', '00100', '01000', '10000', '00000', '00000'],
  '?': ['01110', '10001', '00001', '00010', '00100', '00000', '00100'],
};

function drawChar(canvas, ch, x, y, color, scale = 2) {
  const pattern = FONT[ch] || FONT['?'];
  for (let row = 0; row < pattern.length; row += 1) {
    for (let col = 0; col < pattern[row].length; col += 1) {
      if (pattern[row][col] === '1') {
        canvas.fillRect(x + col * scale, y + row * scale, scale, scale, color);
      }
    }
  }
  return 6 * scale; // 5 px + 1 spacing
}

function drawText(canvas, text, x, y, color, scale = 2) {
  let cursor = x;
  const normalized = String(text).toUpperCase();
  for (const ch of normalized) {
    cursor += drawChar(canvas, ch, cursor, y, color, scale);
  }
  return cursor - x;
}

function drawNativeBar(c) {
  c.fillRect(0, 0, WIDTH, 58, COLORS.nativeBar);
  c.fillRect(0, 57, WIDTH, 1, COLORS.nativeBorder);

  c.fillRoundedRect(12, 17, 18, 18, 4, [77, 195, 209, 255]);
  c.line(17, 24, 22, 24, COLORS.white);
  c.line(19, 21, 19, 28, COLORS.white);

  drawText(c, 'AI CHAT BRANCH', 40, 20, COLORS.textMain, 2);

  // Pin icon
  c.line(418, 17, 430, 29, COLORS.textMuted);
  c.line(430, 17, 418, 29, COLORS.textMuted);
  c.line(424, 17, 424, 34, COLORS.textMuted);

  // Close icon
  c.line(450, 20, 462, 32, COLORS.textMain);
  c.line(462, 20, 450, 32, COLORS.textMain);
}

function drawSettingsButton(c, x, y, size) {
  c.fillRoundedRect(x, y, size, size, 8, COLORS.headerCard);
  c.strokeRect(x, y, size, size, 1, COLORS.headerBorder);
  const cx = x + Math.floor(size / 2);
  const cy = y + Math.floor(size / 2);
  c.fillCircle(cx, cy, 6, COLORS.textMuted);
  c.fillCircle(cx, cy, 3, COLORS.headerCard);
  c.line(cx - 9, cy, cx + 9, cy, COLORS.textMuted);
  c.line(cx, cy - 9, cx, cy + 9, COLORS.textMuted);
}

function drawTrackButton(c, x, y, w, h, compact = false) {
  c.fillRect(x, y, w, h, COLORS.accent);
  drawText(c, '+', x + 10, y + Math.floor((h - 14) / 2), COLORS.white, 2);
  drawText(c, compact ? 'TRACK' : 'TRACK TAB', x + 28, y + Math.floor((h - 14) / 2), COLORS.white, 2);
}

function drawHeader(c, variant) {
  if (variant === 'A') {
    c.fillRoundedRect(8, 70, 464, 76, 12, COLORS.headerCard);
    c.strokeRect(8, 70, 464, 76, 1, COLORS.headerBorder);
    drawSettingsButton(c, 278, 90, 30);
    drawTrackButton(c, 318, 88, 150, 34, false);
  } else if (variant === 'B') {
    c.fillRoundedRect(8, 74, 464, 62, 12, COLORS.headerCard);
    c.strokeRect(8, 74, 464, 62, 1, COLORS.headerBorder);
    drawSettingsButton(c, 294, 88, 26);
    drawTrackButton(c, 328, 87, 126, 30, true);
  } else {
    c.fillRoundedRect(8, 74, 464, 62, 12, COLORS.headerCard);
    c.strokeRect(8, 74, 464, 62, 1, COLORS.headerBorder);
    drawTrackButton(c, 302, 87, 150, 30, false);
  }
}

function drawTree(c, variant) {
  const startY = variant === 'A' ? 156 : 146;
  const rowH = variant === 'B' ? 42 : 47;
  const textScale = 2;
  const rows = [
    { level: 0, text: 'TRAVEL PREP EUROPE', time: '57M', live: true },
    { level: 1, text: 'CITY STRATEGY', time: '56M' },
    { level: 1, text: 'BUDGET PLAN', time: '56M' },
    { level: 0, text: 'RESEARCH ROADMAP', time: '54M' },
    { level: 1, text: 'STUDY AND LIFE', time: '29M', selected: true, pending: true },
  ];

  const baseX = 18;

  rows.forEach((row, index) => {
    const y = startY + index * rowH;
    if (row.selected) {
      c.fillRoundedRect(12, y - 6, 456, rowH - 4, 6, COLORS.rowHover);
    }

    if (row.level > 0) {
      const lx = baseX + row.level * 26 - 8;
      c.line(lx, y - 22, lx, y + 10, COLORS.treeLine);
      c.line(lx, y + 2, lx + 12, y + 2, COLORS.treeLine);
    }

    if (row.level === 0) {
      c.fillCircle(baseX + row.level * 26, y + 4, row.live ? 5 : 4, row.live ? COLORS.statusLive : COLORS.statusDot);
    } else {
      c.fillCircle(baseX + row.level * 26, y + 4, 4, COLORS.statusDot);
    }

    drawText(c, row.text, baseX + row.level * 26 + 14, y - 4, COLORS.accentText, textScale);
    drawText(c, row.time, 430, y - 4, COLORS.textMuted, textScale);

    if (row.pending) {
      const chipY = y + 16;
      c.fillRoundedRect(316, chipY, 98, 18, 9, COLORS.chipBg);
      c.strokeRect(316, chipY, 98, 18, 1, COLORS.chipBorder);
      drawText(c, 'NAMING...', 326, chipY + 4, COLORS.chipText, 1);
    }
  });
}

function createVariant(variant, outPath) {
  const c = new Canvas(WIDTH, HEIGHT);
  c.fillRect(0, 0, WIDTH, HEIGHT, COLORS.pageBg);

  drawNativeBar(c);
  drawHeader(c, variant);
  drawTree(c, variant);

  // subtle frame
  c.strokeRect(0, 0, WIDTH, HEIGHT, 1, [210, 213, 222, 255]);
  writePNG(outPath, c.width, c.height, c.data);
}

// PNG encoding helpers
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function u32be(value) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(value >>> 0, 0);
  return b;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = crc32(Buffer.concat([typeBuf, data]));
  return Buffer.concat([u32be(data.length), typeBuf, data, u32be(crc)]);
}

function writePNG(outPath, width, height, rgbaData) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // no filter
    rgbaData.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }

  const idat = zlib.deflateSync(raw, { level: 9 });
  const png = Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  fs.writeFileSync(outPath, png);
}

function main() {
  const outDir = path.join(process.cwd(), 'docs', 'mockups');
  fs.mkdirSync(outDir, { recursive: true });

  const variants = ['A', 'B', 'C'];
  for (const variant of variants) {
    const outPath = path.join(outDir, `${variant}.png`);
    createVariant(variant, outPath);
  }

  console.log('Generated mockups:');
  variants.forEach((variant) => {
    console.log(`- docs/mockups/${variant}.png`);
  });
}

main();
