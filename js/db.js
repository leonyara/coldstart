(function(global){
  "use strict";

  var DB_NAME = "coldstart_db";
  var DB_VERSION = 1;
  var STORE = "kv";
  var dbPromise = null;
  var idbOK = 'indexedDB' in window;

  function openDB(){
    if(dbPromise) return dbPromise;
    dbPromise = new Promise(function(resolve, reject){
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function(){
        var db = req.result;
        if(!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath:"key" });
      };
      req.onsuccess = function(){ resolve(req.result); };
      req.onerror = function(){ reject(req.error); };
    });
    return dbPromise;
  }

  function idbGet(key){
    return openDB().then(function(db){
      return new Promise(function(resolve, reject){
        var tx = db.transaction(STORE, "readonly");
        var req = tx.objectStore(STORE).get(key);
        req.onsuccess = function(){ resolve(req.result ? req.result.value : undefined); };
        req.onerror = function(){ reject(req.error); };
      });
    });
  }

  function idbSet(key, value){
    return openDB().then(function(db){
      return new Promise(function(resolve, reject){
        var tx = db.transaction(STORE, "readwrite");
        var req = tx.objectStore(STORE).put({ key:key, value:value });
        req.onsuccess = function(){ resolve(); };
        req.onerror = function(){ reject(req.error); };
      });
    });
  }

  // localStorage doubles as a safety-net backup in case IndexedDB is
  // unavailable or throws (some browsers restrict it in private mode).
  function lsGet(key){
    try{ var raw = localStorage.getItem("coldstart_kv_"+key); return raw!==null ? JSON.parse(raw) : undefined; }
    catch(e){ return undefined; }
  }
  function lsSet(key, value){
    try{ localStorage.setItem("coldstart_kv_"+key, JSON.stringify(value)); }catch(e){}
  }

  global.ColdstartDB = {
    get: function(key){
      if(!idbOK) return Promise.resolve(lsGet(key));
      return idbGet(key).catch(function(){ return lsGet(key); });
    },
    set: function(key, value){
      lsSet(key, value);
      if(!idbOK) return Promise.resolve();
      return idbSet(key, value).catch(function(){});
    }
  };
})(window);
