const C='fpl-opt-v230-strategic';
const CORE=['./','./index.html','./styles.v0230.css','./app.v0230.js','./planner-worker.v0230.js','./manifest.webmanifest'];
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(C).then(c=>c.addAll(CORE)))});
self.addEventListener('activate',e=>e.waitUntil(Promise.all([self.clients.claim(),caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('fpl-opt-')&&k!==C).map(k=>caches.delete(k))))])));
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const u=new URL(e.request.url);
  if(u.origin!==location.origin)return;
  const isNavigation=e.request.mode==='navigate'||e.request.destination==='document'||u.pathname.endsWith('/index.html');
  if(isNavigation){
    e.respondWith(fetch(e.request,{cache:'no-store'}).then(r=>{if(r.ok){const clone=r.clone();caches.open(C).then(c=>c.put('./index.html',clone)).catch(()=>{});}return r;}).catch(()=>caches.match('./index.html')));
    return;
  }
  e.respondWith(caches.match(e.request).then(cached=>cached||fetch(e.request).then(r=>{if(r.ok){const clone=r.clone();caches.open(C).then(c=>c.put(e.request,clone)).catch(()=>{});}return r;})));
});
