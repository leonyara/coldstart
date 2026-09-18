var CACHE_VERSION = "coldstart-v2";
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
var FONT_CACHE = "coldstart-fonts-v2";
var GOOGLE_FONTS_CSS = "https://fonts.googleapis.com/css2?family=Press+Start+2P&family=Space+Mono:wght@400;700&display=swap";
// Pinned so both fonts are guaranteed offline right after install, instead of
// waiting on a first runtime fetch to populate the cache. Self-healing if
// Google ever rotates these hashes: the fetch handler below re-caches on the
// next successful online load.
var GOOGLE_FONT_FILES = [
  "https://fonts.gstatic.com/s/pressstart2p/v16/e3t4euO8T-267oIAQAu6jDQyK3nVivM.woff2",
  "https://fonts.gstatic.com/s/spacemono/v17/i7dPIFZifjKcF5UAWdDRYEF8RQ.woff2",
  "https://fonts.gstatic.com/s/spacemono/v17/i7dMIFZifjKcF5UAWdDRaPpZUFWaHg.woff2"
];

self.addEventListener("install", function(event){
  event.waitUntil(
    Promise.all([
      caches.open(CACHE_VERSION).then(function(cache){ return cache.addAll(APP_SHELL); }),
      caches.open(FONT_CACHE).then(function(cache){
        return Promise.all([
          fetch(GOOGLE_FONTS_CSS, {mode:"no-cors"}).then(function(res){ return cache.put(GOOGLE_FONTS_CSS, res); }).catch(function(){}),
          cache.addAll(GOOGLE_FONT_FILES).catch(function(){})
        ]);
      })
    ]).then(function(){ return self.skipWaiting(); })
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
