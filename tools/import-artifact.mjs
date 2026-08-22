/* Claude 아티팩트로 만든 HTML → 이 앱의 index.html 로 변환한다.
 *
 * 언제 쓰나:
 *   앱을 Claude 아티팩트 쪽에서 뜯어고친 뒤, 그 결과를 이 앱에 다시 들여올 때.
 *   (이 폴더의 index.html 을 직접 고치는 경우엔 쓸 필요가 없다 — 그게 기본 경로다.)
 *
 * 쓰는 법:
 *   node tools/import-artifact.mjs <아티팩트HTML경로>
 *   node tools/import-artifact.mjs <경로> --dry     실제로 쓰지 않고 확인만
 *
 * 안전장치:
 *   - 기존 index.html 을 _backup/index.<날짜>.html 로 먼저 복사해 둔다.
 *   - 치환해야 할 부분을 하나라도 못 찾으면 아무것도 쓰지 않고 멈춘다.
 *     (조용히 반쯤 망가진 앱을 배포하는 것보다 낫다)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const srcArg = args.find((a) => !a.startsWith("--"));

if (!srcArg) {
  console.error("사용법: node tools/import-artifact.mjs <아티팩트HTML경로> [--dry]");
  process.exit(1);
}
const SRC = resolve(srcArg);
if (!existsSync(SRC)) {
  console.error(`✗ 파일이 없습니다: ${SRC}`);
  process.exit(1);
}

let html = readFileSync(SRC, "utf8");
const notes = [];

/* ── 1. Claude 프레임 런타임이 든 <head> 를 통째로 교체 ──────────────
   아티팩트 HTML 에는 __FRAME_PREAMBLE 과 <base href="/_f/..."> 가 들어 있다.
   이게 남아 있으면 claude.ai 밖에서 경로가 전부 깨진다. */
const HEAD_END = "</head><body>";
const headEnd = html.indexOf(HEAD_END);
if (headEnd < 0) {
  fail("<head> 의 끝(`</head><body>`)을 찾지 못했습니다. 아티팩트 HTML 이 맞나요?");
}
const body = html.slice(headEnd + HEAD_END.length);

const NEW_HEAD = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>좋아하는 구석</title>
<meta name="description" content="마음에 든 구석을 사진으로 모으고, 그 이유를 태그로 남기는 개인 아카이브">

<!-- PWA -->
<link rel="manifest" href="manifest.webmanifest">
<meta name="theme-color" content="#F4F4F1" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#101215" media="(prefers-color-scheme: dark)">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="좋아하는 구석">
<link rel="apple-touch-icon" href="icons/apple-touch-icon-180.png">
<link rel="icon" href="icons/icon-192.png" sizes="192x192" type="image/png">
<link rel="icon" href="icons/icon-512.png" sizes="512x512" type="image/png">
</head>
<body>`;

html = NEW_HEAD + body;
notes.push("Claude 프레임 런타임 · <base href> 제거");

/* ── 2. 본문에 떠 있는 <title> 제거 (head 로 옮겼음) ── */
const stray = "<body>\n<title>좋아하는 구석</title>\n";
if (html.includes(stray)) {
  html = html.replace(stray, "<body>\n");
  notes.push("본문의 떠돌이 <title> 정리");
}

/* ── 3. 폴더 저장 모드 되살리기 ──────────────────────────────
   아티팩트 빌드는 FOLDER_UI 가 false 로 박혀 있다.
   지원 브라우저(데스크톱 Chrome/Edge)에서만 켜지도록 바꾼다. */
const FOLDER_RE = /const FOLDER_UI = [^;]+;([^\n]*)/;
if (!FOLDER_RE.test(html)) {
  fail("`const FOLDER_UI = ...` 줄을 찾지 못했습니다. 앱 소스 구조가 바뀌었는지 확인하세요.");
}
html = html.replace(
  FOLDER_RE,
  'const FOLDER_UI = (typeof window.showDirectoryPicker === "function");  /* standalone PWA: 지원 브라우저에서만 폴더 모드 */'
);
notes.push("FOLDER_UI 를 브라우저 지원 여부로 자동 판정하게 변경");

/* ── 4. 폰 안내문 교체 (아티팩트 링크 전제로 쓰인 문장) ── */
const noticeOld =
  "이 링크는 폰에서 볼 때 쓰는 화면이에요. 여기서 고친 내용은 컴퓨터 폴더로 돌아가지 않습니다 — 컴퓨터에서는 <code>좋아하는-구석.html</code>을 열어서 쓰세요.";
const noticeNew =
  "이 기기에서는 기록이 이 브라우저 안에만 저장돼요. 컴퓨터(Chrome·Edge)에서 열면 폴더에 파일로 저장하고 드라이브로 옮길 수 있습니다. 기기끼리 옮길 때는 <code>백업 저장</code> → <code>불러오기</code>를 쓰세요.";
if (html.includes(noticeOld)) {
  html = html.replace(noticeOld, noticeNew);
  notes.push("폰 안내문을 PWA 구조에 맞게 교체");
} else if (!html.includes(noticeNew)) {
  notes.push("⚠ 폰 안내문을 못 찾았습니다 (문구가 바뀐 듯). 직접 확인해 주세요.");
}

/* ── 5. 서비스 워커 등록 스니펫 주입 ── */
const SNIPPET = `
<script>
/* ── 서비스 워커: 오프라인 실행 + 설치 ────────────────────
   updateViaCache:"none" — sw.js 자체를 HTTP 캐시에서 꺼내 쓰지 않게 한다.
   이게 없으면 리뉴얼 후에도 브라우저가 낡은 sw.js 를 몇 시간 붙들 수 있다. */
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", function () {
    navigator.serviceWorker
      .register("sw.js", { updateViaCache: "none" })
      .then(function (reg) {
        // 앱을 열 때마다 새 버전이 있는지 확인
        reg.update().catch(function () {});
        reg.addEventListener("updatefound", function () {
          var sw = reg.installing;
          if (!sw) return;
          sw.addEventListener("statechange", function () {
            if (sw.state === "installed" && navigator.serviceWorker.controller) {
              console.log("새 버전을 받았어요. 앱을 다시 열면 적용됩니다.");
            }
          });
        });
      })
      .catch(function (e) { console.warn("sw 등록 실패", e); });
  });
}
</script>
</body></html>
`;
const closeIdx = html.lastIndexOf("</body></html>");
if (closeIdx < 0) fail("`</body></html>` 을 찾지 못했습니다.");
html = html.slice(0, closeIdx).trimEnd() + "\n" + SNIPPET.trimStart();
notes.push("서비스 워커 등록 스크립트 주입");

/* ── 6. 저장 (기존 파일은 먼저 백업) ── */
const dest = join(ROOT, "index.html");

if (DRY) {
  console.log("── 확인만 (--dry). 아무것도 쓰지 않았습니다 ──");
  notes.forEach((n) => console.log("  · " + n));
  console.log(`  결과 크기: ${Buffer.byteLength(html, "utf8")} bytes`);
  process.exit(0);
}

if (existsSync(dest)) {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "");
  const dir = join(ROOT, "_backup");
  mkdirSync(dir, { recursive: true });
  const bak = join(dir, `index.${stamp}.html`);
  copyFileSync(dest, bak);
  notes.push(`이전 index.html 을 _backup/index.${stamp}.html 로 보관`);
}

writeFileSync(dest, html, "utf8");
notes.forEach((n) => console.log("  · " + n));
console.log(`✓ index.html 갱신 완료 (${Buffer.byteLength(html, "utf8")} bytes)`);
console.log("  다음: .\\deploy.ps1  (버전 갱신 + 배포)");

function fail(msg) {
  console.error("✗ " + msg);
  console.error("  아무것도 쓰지 않고 멈춥니다. 기존 index.html 은 그대로입니다.");
  process.exit(1);
}
