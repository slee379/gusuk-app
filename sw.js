/* 좋아하는 구석 — 서비스 워커
 *
 * 하는 일: 앱 껍데기(HTML/아이콘/폰트)를 캐시해서 오프라인에서도 열리게 하고,
 *          설치형 앱(PWA) 조건을 채운다.
 *
 * 안 하는 일: 사진과 메모는 건드리지 않는다. 그건 IndexedDB(또는 연결한 폴더)에 있고
 *          이 캐시와 완전히 별개다. 캐시를 통째로 지워도 기록은 남는다.
 *
 * ── 버전에 대해 ────────────────────────────────────────
 * 아래 VERSION 은 손으로 고치지 마라. `node tools/sync-version.mjs` 가
 * 파일 내용을 해시해서 자동으로 채운다 (deploy.ps1 이 알아서 실행한다).
 *
 * 그리고 설령 버전이 낡은 채로 배포되더라도 옛날 화면이 뜨지 않도록,
 * 아래 fetch 전략을 전부 "일단 캐시로 즉시 띄우고 뒤에서 새로 받아 교체"로
 * 짜두었다. 버전 갱신은 청소용이지 신선도용이 아니다.
 */
const VERSION = "79d2b43e139e"; /* BUILD */

const SHELL = `gusuk-shell-${VERSION}`;
const FONTS = `gusuk-fonts-v1`; // 폰트는 URL 자체가 불변이라 버전을 따라갈 필요가 없다

const SHELL_FILES = [
  "./",
  "./index.html",
  "./privacy.html",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon-180.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(SHELL)
      // 하나쯤 실패해도 설치가 통째로 깨지지 않게 개별 요청으로
      .then((c) => Promise.allSettled(SHELL_FILES.map((f) => c.add(new Request(f, { cache: "reload" })))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        // 낡은 껍데기 캐시만 지운다. 사진·메모는 IndexedDB라 애초에 영향 없음.
        // 공유로 막 들어온 사진(gusuk-share-inbox)은 아직 앱이 못 가져갔을 수 있으니 건드리지 않는다.
        Promise.all(
          keys
            .filter(
              (k) =>
                k.startsWith("gusuk-") &&
                k !== SHELL &&
                k !== FONTS &&
                k !== "gusuk-share-inbox"
            )
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

const isFont = (url) =>
  url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";

/* 캐시로 즉시 응답하되, 뒤에서 새 걸 받아 캐시를 갱신한다.
   → 낡은 게 화면에 남는 건 최대 한 번, 다음 실행부터 새 버전. */
function staleWhileRevalidate(req, cacheName) {
  return caches.open(cacheName).then(async (cache) => {
    const hit = await cache.match(req);
    const net = fetch(req)
      .then((res) => {
        if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone());
        return res;
      })
      .catch(() => hit);
    return hit || net;
  });
}

/* ── 공유 타겟 (안드로이드) ──────────────────────────────
   사진 앱에서 "공유 → 좋아하는 구석" 을 누르면 브라우저가 이 주소로 POST 한다.
   파일을 캐시에 잠깐 넣어두고 앱을 연 뒤, 앱이 꺼내서 담는다.
   ※ iOS 는 웹앱 공유 타겟을 지원하지 않는다. 안드로이드 전용. */
const SHARE_CACHE = "gusuk-share-inbox";

async function receiveShare(request) {
  try {
    const form = await request.formData();
    const files = form.getAll("photos").filter((f) => f && f.size);
    if (files.length) {
      const cache = await caches.open(SHARE_CACHE);
      await Promise.all(
        files.map((f, i) =>
          cache.put(
            `./shared/${Date.now()}-${i}`,
            new Response(f, {
              headers: {
                "content-type": f.type || "image/jpeg",
                "x-name": encodeURIComponent(f.name || `shared-${i}.jpg`),
              },
            })
          )
        )
      );
    }
  } catch (err) {
    // 실패해도 앱은 열어준다 — 빈손으로 열리는 게 에러 화면보다 낫다
  }
  // Response.redirect 는 절대 URL 만 받는다. sw.js 위치 기준으로 앱 주소를 만든다.
  return Response.redirect(new URL("./?share-target=1", self.location.href).href, 303);
}

self.addEventListener("fetch", (e) => {
  const req = e.request;

  if (req.method === "POST" && new URL(req.url).pathname.endsWith("/share-target")) {
    e.respondWith(receiveShare(req));
    return;
  }

  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // 구글 폰트: 오프라인에서도 글꼴 유지
  if (isFont(url)) {
    e.respondWith(staleWhileRevalidate(req, FONTS));
    return;
  }

  if (url.origin !== self.location.origin) return;

  // 앱 진입: 네트워크 우선 → 실패하면 캐시.
  // 온라인이면 항상 최신 index.html 을 받으므로 "리뉴얼했는데 옛날 화면" 이 안 생긴다.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          // 받아온 페이지를 "그 페이지 자리에" 넣는다.
          // 무조건 ./index.html 에 넣으면 privacy.html 을 한 번 열었을 때
          // 앱 첫 화면 캐시가 방침 페이지로 덮여버린다.
          const copy = res.clone();
          const u = new URL(req.url);
          u.search = "";
          u.hash = "";
          const key = u.pathname.endsWith("/") ? "./index.html" : u.href;
          caches.open(SHELL).then((c) => c.put(key, copy)).catch(() => {});
          return res;
        })
        // 오프라인: 그 페이지 자체를 캐시에서 먼저 찾고(개인정보처리방침 등),
        // 없으면 앱 첫 화면으로 떨어뜨린다
        .catch(() =>
          caches
            .match(req, { ignoreSearch: true })
            .then((r) => r || caches.match("./index.html"))
            .then((r) => r || caches.match("./"))
        )
    );
    return;
  }

  // 그 밖의 같은 출처 파일(아이콘·매니페스트): 즉시 뜨되 뒤에서 갱신
  e.respondWith(staleWhileRevalidate(req, SHELL));
});
