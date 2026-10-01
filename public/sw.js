// 离线缓存：词典（约 23 MB）只下载一次，之后秒开、断网也能用。
// 词典类大文件：缓存优先；页面、脚本、样式：网络优先（保证更新能马上生效），断网时用缓存。
// 词典文件内容变了就把 VERSION 加一。
const VERSION = "v1";
const BIG = "cishu-dict-" + VERSION;
const APP = "cishu-app";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith("cishu-dict-") && k !== BIG) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  const big = /\/(vendor\/kuromoji-dict|dict)\//.test(url.pathname);
  e.respondWith(big ? cacheFirst(req) : networkFirst(req));
});

async function cacheFirst(req) {
  const cache = await caches.open(BIG);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

async function networkFirst(req) {
  const cache = await caches.open(APP);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    throw err;
  }
}
