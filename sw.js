/* EPC Buddy static app shell — versioned so new deployments replace old files.
   IMPORTANT: do not cache Supabase API requests, authentication or private photos.
   Offline editing/sync is NOT implemented by this service worker. */
const CACHE='epc-buddy-shell-20261108-v1';
const SHELL=['./','./index.html','./css/styles.css','./js/app.js','./js/config.js',
             './manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png'];
self.addEventListener('install',event=>{
 event.waitUntil((async()=>{
  const cache=await caches.open(CACHE);
  // Use per-resource fetch; a missing optional file must not break installation.
  await Promise.allSettled(SHELL.map(async url=>{
   const response=await fetch(url,{cache:'reload'});
   if(response.ok)await cache.put(url,response);
  }));
  await self.skipWaiting();
 })());
});
self.addEventListener('activate',event=>{
 event.waitUntil((async()=>{
  const keys=await caches.keys();
  await Promise.all(keys.filter(k=>k.startsWith('epc-buddy-shell-')&&k!==CACHE).map(k=>caches.delete(k)));
  await self.clients.claim();
 })());
});
self.addEventListener('fetch',event=>{
 const request=event.request;
 if(request.method!=='GET'||new URL(request.url).origin!==self.location.origin)return;
 const url=new URL(request.url);
 // Cache only known app shell files. Never cache arbitrary pages, user data or photos.
 const isShell=SHELL.some(path=>new URL(path,self.registration.scope).pathname===url.pathname);
 if(!isShell)return;
 event.respondWith((async()=>{
  try{
   const response=await fetch(request);
   if(response.ok){const cache=await caches.open(CACHE);await cache.put(request,response.clone())}
   return response;
  }catch(error){
   const cached=await caches.match(request,{ignoreSearch:true});
   if(cached)return cached;
   throw error;
  }
 })());
});
