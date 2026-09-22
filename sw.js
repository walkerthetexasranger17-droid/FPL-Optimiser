const C='fpl-opt-v270-full-weekly-assistant';
const CORE=['./','./index.html','./styles.v0270.css','./app.v0270.js','./manifest.webmanifest'];
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(C).then(c=>c.addAll(CORE)))});
self.addEventListener('activate',e=>e.waitUntil(Promise.all([self.clients.claim(),caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('fpl-opt-')&&k!==C).map(k=>caches.delete(k))))])));
self.addEventListener('fetch',e=>{
 if(e.request.method!=='GET')return;
 const u=new URL(e.request.url);if(u.origin!==location.origin)return;
 const isNavigation=e.request.mode==='navigate'||e.request.destination==='document'||u.pathname.endsWith('/index.html');
 const fresh=isNavigation||e.request.destination==='script'||e.request.destination==='style'||u.pathname.includes('/modules.v0270/');
 if(fresh){e.respondWith(fetch(e.request,{cache:'no-store'}).then(r=>{if(r.ok){const c=r.clone();caches.open(C).then(x=>x.put(e.request,c)).catch(()=>{});}return r;}).catch(()=>caches.match(e.request).then(x=>x||caches.match('./index.html'))));return;}
 e.respondWith(caches.match(e.request).then(x=>x||fetch(e.request).then(r=>{if(r.ok){const c=r.clone();caches.open(C).then(y=>y.put(e.request,c)).catch(()=>{});}return r;})));
});
