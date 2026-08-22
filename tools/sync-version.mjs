/* sw.js 의 VERSION 을 앱 파일 내용 해시로 자동 갱신한다.
 *
 * 왜 필요한가: 서비스 워커는 "sw.js 파일의 바이트가 1비트라도 달라졌을 때"만
 * 새 버전으로 인식한다. index.html 만 고치고 sw.js 를 그대로 두면 브라우저는
 * 업데이트가 없다고 판단한다. 그래서 배포 때마다 손으로 v1 → v2 를 올려야 했는데,
 * 그걸 잊는 게 이 구조에서 유일하게 실수하기 쉬운 지점이었다.
 *
 * 이제 이 스크립트가 앱 파일들을 해시해서 sw.js 에 박아 넣는다.
 * 내용이 바뀌면 해시가 바뀌고, 안 바뀌면 해시도 그대로다 (불필요한 재배포 없음).
 *
 * 단독 실행:  node tools/sync-version.mjs
 * 보통은 deploy.ps1 이 알아서 부른다.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// 해시 대상: 사용자에게 실제로 보이는 것들
const TRACKED = [
  "index.html",
  "privacy.html",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "icons/apple-touch-icon-180.png",
];

const h = createHash("sha256");
for (const rel of TRACKED) {
  const p = join(ROOT, rel);
  if (!existsSync(p)) {
    console.error(`✗ 파일이 없습니다: ${rel}`);
    process.exit(1);
  }
  h.update(rel);
  h.update(readFileSync(p));
}
const version = h.digest("hex").slice(0, 12);

const swPath = join(ROOT, "sw.js");
const sw = readFileSync(swPath, "utf8");

const MARKER = /const VERSION = "([^"]*)"; \/\* BUILD \*\//;
const found = sw.match(MARKER);
if (!found) {
  console.error('✗ sw.js 에서 `const VERSION = "..."; /* BUILD */` 줄을 찾지 못했습니다.');
  console.error('  그 줄을 지웠다면 되살려 주세요. 자동 버전 갱신이 그 줄에 의존합니다.');
  process.exit(1);
}

if (found[1] === version) {
  console.log(`· 바뀐 내용이 없습니다 (${version}). sw.js 그대로 둡니다.`);
  process.exit(0);
}

writeFileSync(swPath, sw.replace(MARKER, `const VERSION = "${version}"; /* BUILD */`), "utf8");
console.log(`✓ sw.js 버전 갱신: ${found[1]} → ${version}`);
