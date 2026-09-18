var CACHE_VERSION = "coldstart-v1";
var APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/styles.css",
  "./js/db.js",
  "./js/app.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-512-maskable.png",
  "./icons/apple-touch-icon.png",
  "./icons/grain.png"
];
var FONT_CACHE = "coldstart-fonts-v1";

self.addEventListener("install", function(event){
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function(cache){
      return cache.addAll(APP_SHELL);
    }).then(function(){ return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function(event){
  event.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.map(function(key){
        if(key !== CACHE_VERSION && key !== FONT_CACHE) return caches.delete(key);
      }));
    }).then(function(){ return self.clients.claim(); })
  );
});

function isFontRequest(url){
  return url.origin === "https://fonts.googleapis.com" || url.origin === "https://fonts.gstatic.com";
}

self.addEventListener("fetch", function(event){
  var req = event.request;
  if(req.method !== "GET") return;
  var url = new URL(req.url);

  if(isFontRequest(url)){
    event.respondWith(
      caches.open(FONT_CACHE).then(function(cache){
        return cache.match(req).then(function(cached){
          if(cached) return cached;
          return fetch(req).then(function(res){
            // The Google Fonts CSS is fetched without `crossorigin`, so it
            // comes back opaque (status 0) even on success — still cacheable.
            if(res && (res.status === 200 || res.type === "opaque")) cache.put(req, res.clone());
            return res;
          }).catch(function(){ return cached; });
        });
      })
    );
    return;
  }

  if(url.origin === self.location.origin){
    event.respondWith(
      caches.match(req).then(function(cached){
        if(cached) return cached;
        return fetch(req).then(function(res){
          if(res && res.status === 200){
            var copy = res.clone();
            caches.open(CACHE_VERSION).then(function(cache){ cache.put(req, copy); });
          }
          return res;
        }).catch(function(){
          if(req.mode === "navigate") return caches.match("./index.html");
        });
      })
    );
  }
});
