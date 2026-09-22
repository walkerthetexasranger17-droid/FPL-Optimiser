const C='fpl-opt-v211-cacheproof';
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(C).then(c=>c.addAll(['./','./index.html','./styles.v0211.css','./app.v0211.js','./manifest.webmanifest'])))});
self.addEventListener('activate',e=>e.waitUntil(Promise.all([self.clients.claim(),caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('fpl-opt-')&&k!==C).map(k=>caches.delete(k))))])));
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;e.respondWith(fetch(e.request,{cache:'no-store'}).then(r=>{const clone=r.clone();caches.open(C).then(c=>c.put(e.request,clone)).catch(()=>{});return r;}).catch(()=>caches.match(e.request)))});
