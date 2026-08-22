/* 앱 아이콘 생성 — 의존성 없이 PNG 를 직접 써낸다 (zlib 만 사용).
 *
 *   node tools/make-icons.mjs
 *
 * 디자인: 에두아르도 칠리다의 동판화에서 가져왔다.
 *   · 따뜻한 종이 바탕에 부드러운 먹빛
 *   · 맞물린 두 개의 두꺼운 코너 — 사이로 흰 채널이 지나간다
 *   · 그 사이에 뜬 작은 사각 = 표시해둔 "구석"
 *
 * 색이나 형태를 바꾸려면 아래 INK/PAPER 와 SHAPES 만 고치면 된다.
 * 고친 뒤 이 스크립트를 다시 돌리고 `.\deploy.ps1` 하면 끝.
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "icons");
mkdirSync(OUT, { recursive: true });

/* ── 팔레트 ────────────────────────────────────────────── */
const PAPER = [0xed, 0xec, 0xe6]; // 따뜻한 종이
const INK = [0x1b, 0x1c, 0x1a]; // 부드러운 먹빛 (순수 검정은 너무 차갑다)

/* ── 형태 (24칸 그리드 위의 사각형들) ──────────────────────
   서로 떨어진 네 덩어리. 사이의 흰 고랑과 왼쪽아래에 비워둔 여백이
   형태만큼이나 중요하다 — 비워둔 그 자리가 "구석"이다. */
const GRID = 24;
const GUT = 2.5; // 덩어리 사이 흰 고랑의 폭
const SHAPES = [
  [0, 0, 11, 11], // 왼쪽위 큰 사각
  [13.5, 0, 24, 17], // 오른쪽 긴 기둥
  [0, 13.5, 5, 19.5], // 왼쪽아래 작은 사각
  [7.5, 19.5, 24, 24], // 아래 가로 보
];

/* 작은 크기에서는 흰 채널이 뭉개진다. 그래서 마크를 키워 여백을 줄인다. */
const spanFor = (size) => (size >= 128 ? 0.54 : 0.76);

/* ── 종이결 (부드러운 저주파 노이즈) ────────────────────── */
function makeNoise(seed) {
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const N = 16;
  const g = Array.from({ length: N + 1 }, () => Array.from({ length: N + 1 }, rnd));
  for (let i = 0; i <= N; i++) g[i][N] = g[i][0], g[N][i] = g[0][i];
  return (u, v) => {
    const x = u * N, y = v * N;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = g[x0][y0] + (g[x0 + 1][y0] - g[x0][y0]) * sx;
    const b = g[x0][y0 + 1] + (g[x0 + 1][y0 + 1] - g[x0][y0 + 1]) * sx;
    return (a + (b - a) * sy) * 2 - 1; // -1..1
  };
}

/* ── 렌더 ──────────────────────────────────────────────── */
const SS = 4; // 수퍼샘플링 배수 (가장자리를 매끄럽게)

function render(size) {
  const span = spanFor(size) * size;
  const u = span / GRID;
  const ox = (size - span) / 2;
  const oy = (size - span) / 2;

  // 그리드 좌표 → 픽셀 좌표
  const rects = SHAPES.map(([x0, y0, x1, y1]) => [
    ox + x0 * u, oy + y0 * u, ox + x1 * u, oy + y1 * u,
  ]);

  const grain = makeNoise(0x9e37);
  const blot = makeNoise(0x5bf1);
  const px = Buffer.alloc(size * size * 4);
  const step = 1 / SS;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // 커버리지 계산 (안티에일리어싱)
      let hits = 0;
      for (let sy = 0; sy < SS; sy++) {
        const py = y + (sy + 0.5) * step;
        for (let sx = 0; sx < SS; sx++) {
          const pxx = x + (sx + 0.5) * step;
          for (let r = 0; r < rects.length; r++) {
            const t = rects[r];
            if (pxx >= t[0] && pxx < t[2] && py >= t[1] && py < t[3]) { hits++; break; }
          }
        }
      }
      const a = hits / (SS * SS);

      const u0 = x / size, v0 = y / size;
      // 종이에는 미세한 결, 먹에는 판화 특유의 얼룩
      const gr = grain(u0, v0) * 2.5;
      const bl = blot(u0, v0) * 6;

      const i = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) {
        const paper = PAPER[c] + gr;
        const ink = INK[c] + bl;
        let v = paper * (1 - a) + ink * a;
        px[i + c] = v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
      }
      px[i + 3] = 255;
    }
  }
  return px;
}

/* ── PNG 인코딩 ────────────────────────────────────────── */
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
const crc32 = (b) => {
  let c = -1;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

for (const [name, size] of [
  ["icon-192.png", 192],
  ["icon-512.png", 512],
  ["icon-maskable-512.png", 512],
  ["apple-touch-icon-180.png", 180],
  ["favicon-32.png", 32],
]) {
  writeFileSync(join(OUT, name), png(size, render(size)));
  console.log(`✓ ${name}  ${size}×${size}`);
}
