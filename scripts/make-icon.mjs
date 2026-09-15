import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const buildDir = "buildResources";
const logoPath = path.join(buildDir, "logo.png");

fs.mkdirSync(buildDir, { recursive: true });

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(rgba, w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function drawPlaceholder(rgba, N) {
  const bg = [0x1e, 0x1e, 0x1e, 0xff];
  const fg = [0xc9, 0x6f, 0x4a, 0xff];
  const fg2 = [0xa8, 0x56, 0x38, 0xff];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const fx = (x / N) * 32 - 15.5;
      const fy = (y / N) * 32 - 15.5;
      const r = Math.max(Math.abs(fx), Math.abs(fy));
      let c = bg;
      if (r >= 9 && r <= 14) c = r < 12 ? fg : fg2;
      else if (fy > 8 && fy < 12 && fx > -6 && fx < 6) c = fg2;
      const i = (y * N + x) * 4;
      rgba.writeUInt8(c[0], i);
      rgba.writeUInt8(c[1], i + 1);
      rgba.writeUInt8(c[2], i + 2);
      rgba.writeUInt8(c[3], i + 3);
    }
  }
}

function pngSize(file) {
  if (file.length < 24) return null;
  if (file.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: file.readUInt32BE(16), h: file.readUInt32BE(20) };
}

function buildIco(images) {
  const headerSize = 6 + 16 * images.length;
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0);
  dir.writeUInt16LE(1, 2);
  dir.writeUInt16LE(images.length, 4);
  const entries = Buffer.alloc(16 * images.length);
  let offset = headerSize;
  images.forEach((img, i) => {
    const e = entries.subarray(i * 16, (i + 1) * 16);
    e.writeUInt8(img.w >= 256 ? 0 : img.w, 0);
    e.writeUInt8(img.h >= 256 ? 0 : img.h, 1);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(img.png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += img.png.length;
  });
  return Buffer.concat([dir, entries, ...images.map((i) => i.png)]);
}

const logo = fs.existsSync(logoPath) ? fs.readFileSync(logoPath) : null;

if (logo) {
  const size = pngSize(logo);
  if (!size) {
    console.error("buildResources/logo.png is not a valid PNG file.");
    process.exit(1);
  }
  fs.writeFileSync(path.join(buildDir, "icon.png"), logo);
  fs.writeFileSync(path.join(buildDir, "icon.ico"), buildIco([{ png: logo, w: size.w, h: size.h }]));
  console.log(`icon generated from logo.png (${size.w}x${size.h}). For best Windows quality use a 256x256 PNG.`);
} else {
  const images = [];
  for (const n of [256, 64, 48, 32, 16]) {
    const rgba = Buffer.alloc(n * n * 4);
    drawPlaceholder(rgba, n);
    const png = encodePng(rgba, n, n);
    images.push({ png, w: n, h: n });
    if (n === 256) fs.writeFileSync(path.join(buildDir, "icon.png"), png);
  }
  fs.writeFileSync(path.join(buildDir, "icon.ico"), buildIco(images));
  console.log("placeholder icon generated (no buildResources/logo.png found — add your own 256x256 PNG and re-run).");
}
