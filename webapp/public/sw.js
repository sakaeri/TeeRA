self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "TeeRA", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "TeeRA";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/favicon.ico",
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data && event.notification.data.url ? event.notification.data.url : "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(url) && "focus" in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    }),
  );
});

// ---- 電波が弱い・圏外のときの表示 ----
// ・画面の部品（/_next/static など中身が変わらないファイル、画像）は、一度
//   読み込んだら端末に保存し、次からは保存したものを使う（通信が減って早く開ける）。
// ・ページ本体は毎回ネットから取る。一定時間たっても届かなければ、前回開いた
//   同じページの内容を表示する（画面側で「前回の内容を表示しています」と出す）。
//   前回の内容もなければ、真っ白のまま固まらずに「もう一度読み込む」画面を出す。
// ・ログイン画面を開いたら（ログアウト後など）、保存したページの内容は消す
//   （ServiceWorkerSetup.tsxから知らせる）。
const STATIC_CACHE = "teera-static-v1";
const PAGE_CACHE = "teera-pages-v1";
const KEEP_CACHES = [STATIC_CACHE, PAGE_CACHE];
const STATIC_MAX_ENTRIES = 300;
// 開発中（localhost）は保存しない（書き換えたファイルが反映されなくなるため）
const OFFLINE_SUPPORT = !["localhost", "127.0.0.1"].includes(self.location.hostname);
// 前回の内容がある場合に、ネットの応答を待つ時間
const PAGE_TIMEOUT_WITH_COPY_MS = 6000;
// 前回の内容がない場合に、「もう一度読み込む」画面を出すまで待つ時間
const PAGE_TIMEOUT_WITHOUT_COPY_MS = 20000;

// 前回の内容を表示した画面（クライアントID）。画面側から問い合わせて、お知らせを出す
const servedFromCopy = new Set();

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("teera-") && !KEEP_CACHES.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "clear-pages") {
    event.waitUntil(caches.delete(PAGE_CACHE));
  } else if (data.type === "served-from-copy?" && event.ports[0]) {
    const id = event.source && event.source.id;
    event.ports[0].postMessage({ servedFromCopy: !!id && servedFromCopy.has(id) });
    if (id) servedFromCopy.delete(id);
  }
});

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/lp/") ||
    url.pathname.startsWith("/howto/") ||
    /\.(png|jpg|jpeg|svg|ico|woff2?)$/.test(url.pathname)
  );
}

async function trimCache(name, max) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

// /_next/static/ のファイルは名前に中身の指紋が入っていて中身が変わらないので、
// 保存したものをそのまま使う。画像などは保存したものを先に出しつつ、裏で新しい
// ものを取りに行って入れ替える（次に開いたときに新しいものになる）。
async function staticFromCache(event, url) {
  const request = event.request;
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  const refresh = () => fetch(request).then(async (response) => {
    if (response.ok && response.type === "basic") {
      await cache.put(request, response.clone());
      await trimCache(STATIC_CACHE, STATIC_MAX_ENTRIES);
    }
    return response;
  });
  if (cached) {
    if (!url.pathname.startsWith("/_next/static/")) event.waitUntil(refresh().catch(() => {}));
    return cached;
  }
  return refresh();
}

function offlinePage() {
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#0b3d2e"><title>TeeRA</title>
<style>html,body{margin:0;height:100%;background:#0b3d2e;color:#f4ead0;font-family:"Hiragino Sans","Noto Sans CJK JP",sans-serif}
main{min-height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:24px;box-sizing:border-box;text-align:center}
h1{font-size:20px;margin:0}p{font-size:14px;line-height:1.7;margin:0;opacity:.85}
button{margin-top:8px;border:0;border-radius:10px;background:#c9a24b;color:#0b3d2e;font-weight:700;font-size:16px;padding:12px 28px}</style></head>
<body><main><h1>読み込めませんでした</h1><p>電波が弱いか、圏外になっている可能性があります。<br>電波の良い場所で、もう一度お試しください。</p><button onclick="location.reload()">もう一度読み込む</button></main></body></html>`;
  return new Response(html, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

async function pageNetworkFirst(event) {
  const request = event.request;
  const cache = await caches.open(PAGE_CACHE);
  const copy = await cache.match(request);
  const network = fetch(request).then(async (response) => {
    // 転送（ログイン画面へなど）やエラーは保存しない
    if (response.ok && response.type === "basic") await cache.put(request, response.clone());
    return response;
  });
  const timeout = new Promise((resolve) =>
    setTimeout(resolve, copy ? PAGE_TIMEOUT_WITH_COPY_MS : PAGE_TIMEOUT_WITHOUT_COPY_MS, "timeout"),
  );
  // ネットの応答が返らなくても、時間がたったら前回の内容（なければ案内の画面）を出す
  event.waitUntil(network.catch(() => {}));
  const result = await Promise.race([network.catch(() => "failed"), timeout]);
  if (result instanceof Response) return result;
  if (copy) {
    if (event.resultingClientId) servedFromCopy.add(event.resultingClientId);
    return copy;
  }
  return offlinePage();
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (!OFFLINE_SUPPORT || request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  if (request.mode === "navigate") {
    event.respondWith(pageNetworkFirst(event));
    return;
  }
  if (isStaticAsset(url)) {
    event.respondWith(staticFromCache(event, url));
  }
});
