self.addEventListener('install', (e)=>{
  e.waitUntil(caches.open('bcn-cache-v1').then(c=>c.addAll([
    './','./index.html','./style.css','./js/app.js','./data/locations.json','./manifest.json'
  ])));
});
self.addEventListener('fetch', (e)=>{
  e.respondWith(
    caches.match(e.request).then(res=> res || fetch(e.request))
  );
});
