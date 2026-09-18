(function(){
  "use strict";

  var RANKS = ["NULL","FROZEN","SLUSH","THAW","SPARK","IGNITION","BLAZE","SINGULARITY"];
  var THRESHOLDS = [0, 50, 150, 350, 700, 1300, 2300, 4000];

  var DIFF_XP = { solo:8, small:14, large:22 };
  var OUT_MULT = { opened:1, short:1.3, long:1.6, contact:2, date:2.6 };
  var OUT_COLOR = { opened:"#4beeff", short:"#7dffea", long:"#7dffea", contact:"#ff3ec8", date:"#ffb347" };
  var LOC_LABELS = { street:"Street", mall:"Mall", cafe:"Cafe/Bar", transit:"Transit", night:"Night/Club", other:"Other" };
  var DIFF_LABELS = { solo:"Solo", small:"Small grp", large:"Large grp" };
  var OUT_LABELS = { opened:"Opened", short:"Short convo", long:"Long convo", contact:"Contact", date:"Date set" };

  var ACHIEVEMENTS = [
    { id:"first", ico:"◎", name:"First Contact", desc:"Log your 1st approach", test:function(a){ return a.length>=1; } },
    { id:"ten", ico:"✦", name:"Perfect Ten", desc:"10 approaches logged", test:function(a){ return a.length>=10; } },
    { id:"fifty", ico:"✹", name:"Half Century", desc:"50 approaches logged", test:function(a){ return a.length>=50; } },
    { id:"overclock", ico:"⚡", name:"Overclock", desc:"3+ in a single day", test:function(a){ return maxPerDay(a)>=3; } },
    { id:"contact", ico:"☍", name:"Full Stack", desc:"Landed a contact or date", test:function(a){ return a.some(function(x){return x.outcome==="contact"||x.outcome==="date";}); } },
    { id:"night", ico:"☾", name:"Night Shift", desc:"Approach after 9pm", test:function(a){ return a.some(function(x){ return new Date(x.ts).getHours()>=21; }); } },
    { id:"mojito", ico:"🍹", name:"Mojito Mode", desc:"Reach full summer climate", test:function(a){ return computeHeat(a)>=0.9; } }
  ];

  // ---- PERSISTENCE (IndexedDB via ColdstartDB, with an in-memory cache
  // that mirrors the original localStorage-as-cache shape) ----
  var db = window.ColdstartDB;
  function saveApproaches(list){ return db.set("approaches", list); }
  function saveMomentum(m){ return db.set("momentum", m); }
  var cachedLastChoice = null;
  function saveLastChoice(loc, diff){ cachedLastChoice = {location:loc, difficulty:diff}; return db.set("lastChoice", cachedLastChoice); }
  function saveSoundPref(v){ return db.set("soundPref", v); }
  function saveUnlockedAch(arr){ return db.set("achUnlocked", arr); }

  function maxPerDay(approaches){
    var counts = {};
    approaches.forEach(function(a){ var key=new Date(a.ts).toDateString(); counts[key]=(counts[key]||0)+1; });
    var max=0; Object.keys(counts).forEach(function(k){ if(counts[k]>max) max=counts[k]; });
    return max;
  }
  function longestStreakEver(approaches){
    if(approaches.length===0) return 0;
    var dayMs=86400000, days={};
    approaches.forEach(function(a){ var d=new Date(a.ts); d.setHours(0,0,0,0); days[d.getTime()]=true; });
    var keys=Object.keys(days).map(Number).sort(function(x,y){return x-y;});
    var longest=1, run=1;
    for(var i=1;i<keys.length;i++){ if(keys[i]-keys[i-1]===dayMs){ run++; } else { run=1; } if(run>longest) longest=run; }
    return longest;
  }
  function rankForXP(xp){ var idx=0; for(var i=0;i<THRESHOLDS.length;i++){ if(xp>=THRESHOLDS[i]) idx=i; } return idx; }
  function decayMomentum(m){
    var now=Date.now();
    if(m.lastUpdate){ var daysSince=Math.floor((now-m.lastUpdate)/86400000); if(daysSince>1){ m.value=Math.max(0, m.value-(daysSince-1)*15); } }
    return m;
  }
  function computeStreak(approaches){
    if(approaches.length===0) return { count:0, cooling:false };
    var days={}; approaches.forEach(function(a){ days[new Date(a.ts).toDateString()]=true; });
    var count=0, cursor=new Date(), todayKey=cursor.toDateString();
    if(!days[todayKey]){ cursor.setDate(cursor.getDate()-1); }
    while(days[cursor.toDateString()]){ count++; cursor.setDate(cursor.getDate()-1); }
    var lastTs=approaches[approaches.length-1].ts;
    var daysSinceLast=Math.floor((Date.now()-lastTs)/86400000);
    return { count:count, cooling: daysSinceLast>=3 };
  }

  function computeHeat(approaches){
    var totalXP=approaches.reduce(function(s,a){ return s+a.xp; },0);
    var rankIdx=rankForXP(totalXP);
    var curFloor=THRESHOLDS[rankIdx];
    var nextIdx=Math.min(rankIdx+1, RANKS.length-1);
    var nextFloor=THRESHOLDS[nextIdx];
    var pct=rankIdx===RANKS.length-1 ? 1 : (totalXP-curFloor)/(nextFloor-curFloor);
    var heatFromRank=(rankIdx+pct)/(RANKS.length-1);
    var streak=computeStreak(approaches).count;
    var streakBoost=Math.min(streak,14)/14*0.3;
    return Math.max(0, Math.min(1, heatFromRank+streakBoost));
  }

  function hexToRgb(hex){ hex=hex.replace('#',''); return {r:parseInt(hex.substring(0,2),16),g:parseInt(hex.substring(2,4),16),b:parseInt(hex.substring(4,6),16)}; }
  function rgbToHex(r,g,b){ function c(v){ v=Math.round(Math.max(0,Math.min(255,v))); var h=v.toString(16); return h.length===1?'0'+h:h; } return '#'+c(r)+c(g)+c(b); }
  function lerpColor(c1,c2,t){ var a=hexToRgb(c1),b=hexToRgb(c2); return rgbToHex(a.r+(b.r-a.r)*t, a.g+(b.g-a.g)*t, a.b+(b.b-a.b)*t); }
  function lerpColor3(cA,cB,cC,t){ if(t<0.5) return lerpColor(cA,cB,t/0.5); return lerpColor(cB,cC,(t-0.5)/0.5); }
  function hexToHsl(hex){
    var rgb=hexToRgb(hex), r=rgb.r/255, g=rgb.g/255, b=rgb.b/255;
    var max=Math.max(r,g,b), min=Math.min(r,g,b), h, s, l=(max+min)/2;
    if(max===min){ h=0; s=0; }
    else{
      var d=max-min;
      s = l>0.5 ? d/(2-max-min) : d/(max+min);
      if(max===r) h=(g-b)/d+(g<b?6:0);
      else if(max===g) h=(b-r)/d+2;
      else h=(r-g)/d+4;
      h/=6;
    }
    return {h:h*360, s:s*100, l:l*100};
  }
  function hslToHex(h,s,l){
    h=((h%360)+360)%360; s=Math.max(0,Math.min(100,s))/100; l=Math.max(0,Math.min(100,l))/100;
    var c=(1-Math.abs(2*l-1))*s, x=c*(1-Math.abs((h/60)%2-1)), m=l-c/2, r,g,b;
    if(h<60){ r=c;g=x;b=0; } else if(h<120){ r=x;g=c;b=0; } else if(h<180){ r=0;g=c;b=x; }
    else if(h<240){ r=0;g=x;b=c; } else if(h<300){ r=x;g=0;b=c; } else { r=c;g=0;b=x; }
    return rgbToHex((r+m)*255, (g+m)*255, (b+m)*255);
  }
  function lerpHue(h1,h2,t){ var d=h2-h1; if(d>180) d-=360; if(d<-180) d+=360; return h1+d*t; }
  function lerpColorHSL(c1,c2,t){
    var a=hexToHsl(c1), b=hexToHsl(c2);
    return hslToHex(lerpHue(a.h,b.h,t), a.s+(b.s-a.s)*t, a.l+(b.l-a.l)*t);
  }
  function lerpColor3HSL(cA,cB,cC,t){ if(t<0.5) return lerpColorHSL(cA,cB,t/0.5); return lerpColorHSL(cB,cC,(t-0.5)/0.5); }

  var PALETTE = {
    primary:["#4beeff","#6fa8ff","#ff6ec7","#ff8a4d","#ffb347"],
    secondary:["#bfefff","#ffe58a","#9dff88"],
    bgA:["#060a12","#081a17","#230d16"]
  };
  function lerpColorStopsHSL(stops, t){
    t = Math.max(0, Math.min(1, t));
    var n = stops.length-1;
    var scaled = t*n;
    var idx = Math.min(n-1, Math.floor(scaled));
    return lerpColorHSL(stops[idx], stops[idx+1], scaled-idx);
  }
  var CLIMATE_STAGES = [
    { max:0.15, name:"DEEP FREEZE" }, { max:0.35, name:"FROSTLINE" }, { max:0.55, name:"SLUSH THAW" },
    { max:0.75, name:"WARM SPARK" }, { max:0.90, name:"HEATWAVE" }, { max:1.01, name:"MOJITO MODE" }
  ];
  var PARTICLES_BY_BUCKET = { ice:["❄","❆","✳"], mid:["💧","≈","✦"], hot:["🌴","🍹","☀"] };
  var lastParticleBucket = null;
  var lastRankIdx = null;

  function applyClimate(approaches){
    var heat = computeHeat(approaches);
    var primary = lerpColorStopsHSL(PALETTE.primary, heat);
    var secondary = lerpColor3HSL(PALETTE.secondary[0],PALETTE.secondary[1],PALETTE.secondary[2], heat);
    var bgA = lerpColor3HSL(PALETTE.bgA[0],PALETTE.bgA[1],PALETTE.bgA[2], heat);
    var rgb = hexToRgb(primary);
    var glow = "rgba("+rgb.r+","+rgb.g+","+rgb.b+",0.16)";
    var grid = "rgba("+rgb.r+","+rgb.g+","+rgb.b+",0.07)";

    var root = document.documentElement.style;
    root.setProperty('--accent-primary', primary);
    root.setProperty('--accent-secondary', secondary);
    root.setProperty('--bg', bgA);
    root.setProperty('--climate-glow', glow);
    root.setProperty('--grid-line', grid);
    root.setProperty('--sun-size', (90 + heat*90)+"px");
    root.setProperty('--sun-top', (-40 + heat*70)+"px");

    var stage = CLIMATE_STAGES.find(function(s){ return heat <= s.max; }) || CLIMATE_STAGES[CLIMATE_STAGES.length-1];
    document.getElementById("climateName").textContent = stage.name;

    var bucket = heat<0.34 ? "ice" : (heat<0.7 ? "mid" : "hot");
    if(bucket !== lastParticleBucket){ lastParticleBucket = bucket; spawnParticles(bucket); }
    return heat;
  }

  function spawnParticles(bucket){
    var chars = PARTICLES_BY_BUCKET[bucket];
    [document.getElementById("particleLayer"), document.getElementById("mapParticleLayer")].forEach(function(layer){
      if(!layer) return;
      layer.innerHTML = "";
      for(var i=0;i<7;i++){
        var p=document.createElement("div"); p.className="particle"; p.textContent=chars[i%chars.length];
        p.style.left=(Math.random()*94)+"%";
        p.style.setProperty('--drift-x',(Math.random()*60-30)+"px");
        p.style.animationDuration=(7+Math.random()*7)+"s";
        p.style.animationDelay=(Math.random()*8)+"s";
        p.style.fontSize=(12+Math.random()*9)+"px";
        layer.appendChild(p);
      }
    });
  }

  (function initBulbs(){ var row=document.getElementById("marqueeBulbs"); for(var i=0;i<9;i++){ var b=document.createElement("div"); b.className="bulb"; row.appendChild(b); } })();

  (function initStars(){
    var layer = document.getElementById("starLayer");
    if(!layer) return;
    for(var i=0;i<16;i++){
      var s = document.createElement("div");
      s.className = "star";
      s.style.left = (Math.random()*100)+"%";
      s.style.top = (Math.random()*60)+"%";
      s.style.animationDuration = (2+Math.random()*3)+"s";
      s.style.animationDelay = (Math.random()*4)+"s";
      var size = 1+Math.random()*2;
      s.style.width = size+"px"; s.style.height = size+"px";
      layer.appendChild(s);
    }
  })();

  // ---- NEURAL MAP pan/zoom controller (wired once; content rebuilt per render) ----
  var mapScale = 1, mapPanX = 0, mapPanY = 0;
  function clampMapScale(s){ return Math.max(0.6, Math.min(3.5, s)); }
  function updateMapTransform(){
    var g = document.getElementById("mapViewport");
    if(!g) return;
    g.setAttribute("transform", "translate("+mapPanX+","+mapPanY+") translate(300,300) scale("+mapScale+") translate(-300,-300)");
  }
  (function setupMapInteractions(){
    var svgEl = document.getElementById("neuralSvg");
    if(!svgEl) return;
    var pointers = {};
    var dragging = false, dragStartX=0, dragStartY=0, panStartX=0, panStartY=0;
    var pinchStartDist = 0, pinchStartScale = 1;
    function svgUserScale(){ var rect = svgEl.getBoundingClientRect(); return rect.width ? 600/rect.width : 1; }
    function endPointer(e){
      delete pointers[e.pointerId];
      var ids = Object.keys(pointers);
      pinchStartDist = 0;
      if(ids.length===0){ dragging=false; svgEl.classList.remove("dragging"); }
      else if(ids.length===1){
        dragging = true;
        dragStartX = pointers[ids[0]].x; dragStartY = pointers[ids[0]].y;
        panStartX = mapPanX; panStartY = mapPanY;
      }
    }
    svgEl.addEventListener("pointerdown", function(e){
      try{ svgEl.setPointerCapture(e.pointerId); }catch(err){}
      pointers[e.pointerId] = {x:e.clientX, y:e.clientY};
      var ids = Object.keys(pointers);
      if(ids.length===1){
        dragging = true; dragStartX=e.clientX; dragStartY=e.clientY;
        panStartX=mapPanX; panStartY=mapPanY;
        svgEl.classList.add("dragging");
      } else if(ids.length===2){
        dragging = false;
        var pts = ids.map(function(id){ return pointers[id]; });
        pinchStartDist = Math.hypot(pts[0].x-pts[1].x, pts[0].y-pts[1].y);
        pinchStartScale = mapScale;
      }
    });
    svgEl.addEventListener("pointermove", function(e){
      if(!pointers[e.pointerId]) return;
      pointers[e.pointerId] = {x:e.clientX, y:e.clientY};
      var ids = Object.keys(pointers);
      if(ids.length===2){
        var pts = ids.map(function(id){ return pointers[id]; });
        var dist = Math.hypot(pts[0].x-pts[1].x, pts[0].y-pts[1].y);
        if(pinchStartDist>0){ mapScale = clampMapScale(pinchStartScale*(dist/pinchStartDist)); updateMapTransform(); }
        return;
      }
      if(dragging){
        var k = svgUserScale();
        mapPanX = panStartX + (e.clientX-dragStartX)*k;
        mapPanY = panStartY + (e.clientY-dragStartY)*k;
        updateMapTransform();
      }
    });
    svgEl.addEventListener("pointerup", endPointer);
    svgEl.addEventListener("pointercancel", endPointer);
    svgEl.addEventListener("pointerleave", function(e){ if(Object.keys(pointers).length<=1) endPointer(e); });
    svgEl.addEventListener("wheel", function(e){
      e.preventDefault();
      var dir = e.deltaY>0 ? -1 : 1;
      mapScale = clampMapScale(mapScale*(1+dir*0.12));
      updateMapTransform();
    }, {passive:false});

    var zi=document.getElementById("zoomInBtn"), zo=document.getElementById("zoomOutBtn"), zr=document.getElementById("zoomResetBtn");
    if(zi) zi.addEventListener("click", function(){ mapScale=clampMapScale(mapScale+0.3); updateMapTransform(); });
    if(zo) zo.addEventListener("click", function(){ mapScale=clampMapScale(mapScale-0.3); updateMapTransform(); });
    if(zr) zr.addEventListener("click", function(){ mapScale=1; mapPanX=0; mapPanY=0; updateMapTransform(); });
  })();

  var justAddedTs = null;

  // ---- SOUND ENGINE (synthesized 8-bit SFX, no external audio files) ----
  var soundEnabled = false;
  var audioCtx = null, masterGain = null;
  function ensureAudioCtx(){
    if(!audioCtx){
      try{
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        masterGain = audioCtx.createGain();
        masterGain.gain.value = 0.2;
        masterGain.connect(audioCtx.destination);
      }catch(e){ audioCtx = null; }
    }
    if(audioCtx && audioCtx.state === "suspended"){ audioCtx.resume().catch(function(){}); }
    return audioCtx;
  }
  function playTone(freq, startOffset, duration, type, peakGain){
    if(!soundEnabled) return;
    var ctx = ensureAudioCtx(); if(!ctx) return;
    var osc=ctx.createOscillator(), gain=ctx.createGain();
    osc.type = type || "square";
    var t0 = ctx.currentTime + startOffset;
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(peakGain, t0+0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0+duration);
    osc.connect(gain); gain.connect(masterGain);
    osc.start(t0); osc.stop(t0+duration+0.02);
  }
  function playSweep(freqFrom, freqTo, startOffset, duration, type, peakGain){
    if(!soundEnabled) return;
    var ctx = ensureAudioCtx(); if(!ctx) return;
    var osc=ctx.createOscillator(), gain=ctx.createGain();
    osc.type = type || "square";
    var t0 = ctx.currentTime + startOffset;
    osc.frequency.setValueAtTime(freqFrom, t0);
    osc.frequency.linearRampToValueAtTime(freqTo, t0+duration);
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(peakGain, t0+0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0+duration);
    osc.connect(gain); gain.connect(masterGain);
    osc.start(t0); osc.stop(t0+duration+0.02);
  }
  function sfxClick(){ playTone(740, 0, 0.05, "square", 0.10); }
  function sfxNav(){ playTone(520, 0, 0.045, "square", 0.07); }
  function sfxSubmit(){
    playTone(523.25, 0.00, 0.09, "triangle", 0.16);
    playTone(659.25, 0.07, 0.09, "triangle", 0.16);
    playTone(783.99, 0.14, 0.14, "triangle", 0.18);
  }
  function sfxUpdate(){
    playTone(587.33, 0, 0.11, "triangle", 0.15);
    playTone(783.99, 0.08, 0.12, "triangle", 0.15);
  }
  function sfxCombo(){
    playSweep(420, 1100, 0, 0.16, "square", 0.15);
    playTone(1568, 0.15, 0.12, "sine", 0.16);
  }
  function sfxRankUp(){
    var notes=[523.25,659.25,783.99,1046.5];
    notes.forEach(function(f,i){ playTone(f, i*0.09, 0.16, "triangle", 0.18); });
    playTone(1318.5, 0.36, 0.35, "sine", 0.2);
    playTone(1046.5, 0.36, 0.35, "sine", 0.14);
  }
  function sfxDelete(){ playSweep(480, 240, 0, 0.16, "square", 0.14); }
  function sfxAchievement(){
    playTone(987.77, 0, 0.08, "sine", 0.15);
    playTone(1318.5, 0.09, 0.14, "sine", 0.17);
  }

  var soundToggleBtn = document.getElementById("soundToggle");
  function updateSoundToggleUI(){
    if(!soundToggleBtn) return;
    soundToggleBtn.textContent = soundEnabled ? "🔊" : "🔇";
    soundToggleBtn.classList.toggle("muted", !soundEnabled);
  }
  updateSoundToggleUI();

  function dismissSoundHint(){
    var hint = document.getElementById("soundHint");
    if(hint) hint.classList.remove("show");
    db.set("soundHintSeen", true);
  }
  function maybeShowSoundHint(){
    db.get("soundHintSeen").then(function(seen){
      if(seen) return;
      var hint = document.getElementById("soundHint");
      if(!hint) return;
      hint.classList.add("show");
      setTimeout(dismissSoundHint, 5000);
    });
  }
  setTimeout(maybeShowSoundHint, 900);

  if(soundToggleBtn){
    soundToggleBtn.addEventListener("click", function(){
      soundEnabled = !soundEnabled;
      saveSoundPref(soundEnabled);
      updateSoundToggleUI();
      dismissSoundHint();
      if(soundEnabled){ ensureAudioCtx(); playTone(880, 0, 0.06, "square", 0.12); }
    });
  }

  // ---- ACHIEVEMENT UNLOCK TRACKING (for sound cues) ----
  var unlockedAchIds = [];
  var achBaselineSuppressed = true;

  var approaches = [];
  var momentum = { value:0, lastUpdate:null };

  function persist(){
    saveApproaches(approaches);
    saveMomentum(momentum);
  }

  var selected = { location:null, difficulty:null, outcome:null };
  var editingIndex = null;

  function wireChips(containerId, key){
    var container = document.getElementById(containerId);
    container.querySelectorAll(".chip").forEach(function(chip){
      chip.setAttribute("aria-pressed", "false");
      chip.addEventListener("click", function(){
        container.querySelectorAll(".chip").forEach(function(c){ c.classList.remove("selected"); c.setAttribute("aria-pressed","false"); });
        chip.classList.add("selected");
        chip.setAttribute("aria-pressed", "true");
        selected[key] = chip.getAttribute("data-val");
        sfxClick();
        updateSubmitState();
      });
    });
  }
  wireChips("locChips","location"); wireChips("diffChips","difficulty"); wireChips("outChips","outcome");

  var submitBtn = document.getElementById("submitBtn");
  function updateSubmitState(){ submitBtn.disabled = !(selected.location && selected.difficulty && selected.outcome); }
  updateSubmitState();

  function showToast(msg){ var t=document.getElementById("toast"); t.textContent=msg; t.classList.add("show"); setTimeout(function(){ t.classList.remove("show"); }, 2200); }
  function hitFlash(){ var f=document.getElementById("flashOverlay"); f.classList.add("hit"); setTimeout(function(){ f.classList.remove("hit"); }, 90); }
  function showCombo(n){ var el=document.getElementById("comboPopup"); el.textContent="COMBO x"+n+"!"; el.classList.remove("show"); void el.offsetWidth; el.classList.add("show"); }
  function showAchievementPopup(ach, extraCount){
    var el = document.getElementById("achievementPopup");
    document.getElementById("apIcon").textContent = ach.ico;
    document.getElementById("apName").textContent = ach.name + (extraCount>0 ? " (+"+extraCount+" more)" : "");
    el.classList.remove("show"); void el.offsetWidth; el.classList.add("show");
  }

  function applyLastChoiceDefaults(){
    var last = cachedLastChoice;
    if(!last) return;
    [["locChips","location",last.location], ["diffChips","difficulty",last.difficulty]].forEach(function(t){
      if(!t[2]) return;
      var container = document.getElementById(t[0]);
      var chip = container.querySelector('.chip[data-val="'+t[2]+'"]');
      if(chip){
        container.querySelectorAll(".chip").forEach(function(c){ c.classList.remove("selected"); c.setAttribute("aria-pressed","false"); });
        chip.classList.add("selected"); chip.setAttribute("aria-pressed","true");
        selected[t[1]] = t[2];
      }
    });
  }

  function resetForm(){
    document.querySelectorAll(".chip.selected").forEach(function(c){ c.classList.remove("selected"); c.setAttribute("aria-pressed","false"); });
    selected = { location:null, difficulty:null, outcome:null };
    applyLastChoiceDefaults();
    document.getElementById("anxSlider").value = 3;
    document.getElementById("notesInput").value = "";
    updateSubmitState();
  }

  function loadEntryIntoForm(i){
    var e = approaches[i];
    editingIndex = i;
    selected = { location:e.location, difficulty:e.difficulty, outcome:e.outcome };
    ["locChips","diffChips","outChips"].forEach(function(cid){
      document.getElementById(cid).querySelectorAll(".chip").forEach(function(chip){
        chip.classList.toggle("selected", chip.getAttribute("data-val")===
          (cid==="locChips"?e.location:cid==="diffChips"?e.difficulty:e.outcome));
      });
    });
    document.getElementById("anxSlider").value = e.anxiety;
    document.getElementById("notesInput").value = e.notes || "";
    updateSubmitState();
    submitBtn.textContent = "SAVE CHANGES";
    document.getElementById("cancelEdit").style.display = "block";
    document.querySelectorAll("nav button").forEach(function(b){ b.classList.remove("active"); });
    document.querySelector('nav button[data-view="log"]').classList.add("active");
    document.querySelectorAll(".view").forEach(function(v){ v.classList.remove("active"); });
    document.getElementById("view-log").classList.add("active");
    window.scrollTo({top:0, behavior:"smooth"});
  }

  document.getElementById("cancelEdit").addEventListener("click", function(){
    editingIndex = null;
    resetForm();
    submitBtn.textContent = "LOG APPROACH";
    document.getElementById("cancelEdit").style.display = "none";
  });

  submitBtn.addEventListener("click", function(){
    if(submitBtn.disabled) return;
    var anx = parseInt(document.getElementById("anxSlider").value, 10);
    var notes = document.getElementById("notesInput").value.trim();
    var base = DIFF_XP[selected.difficulty] * OUT_MULT[selected.outcome];
    var anxBonus = anx * 2;
    var momMult = 1 + (momentum.value/100)*0.5;
    var xp = Math.round((base + anxBonus) * momMult);

    if(editingIndex !== null){
      var old = approaches[editingIndex];
      var reMomMult = (typeof old.momMult === "number") ? old.momMult : 1;
      var editedXp = Math.round((base + anxBonus) * reMomMult);
      approaches[editingIndex] = { ts: old.ts, location:selected.location, difficulty:selected.difficulty, outcome:selected.outcome, anxiety:anx, notes:notes, xp:editedXp, momMult:reMomMult };
      editingIndex = null;
      submitBtn.textContent = "LOG APPROACH";
      document.getElementById("cancelEdit").style.display = "none";
      resetForm();
      persist();
      sfxUpdate();
      window.scrollTo({top:0, behavior:"smooth"});
      showToast("Entry updated");
      renderAll();
      return;
    }

    var entry = { ts:Date.now(), location:selected.location, difficulty:selected.difficulty, outcome:selected.outcome, anxiety:anx, notes:notes, xp:xp, momMult:momMult };
    approaches.push(entry);
    justAddedTs = entry.ts;
    saveLastChoice(selected.location, selected.difficulty);
    momentum.value = Math.min(100, momentum.value + 10);
    momentum.lastUpdate = Date.now();
    persist();
    resetForm();
    window.scrollTo({top:0, behavior:"smooth"});
    hitFlash();
    sfxSubmit();
    var todayKey = new Date().toDateString();
    var todayCount = approaches.filter(function(a){ return new Date(a.ts).toDateString()===todayKey; }).length;
    if(todayCount>=2){ showCombo(todayCount); setTimeout(sfxCombo, 260); }
    showToast("+"+xp+" XP logged");
    renderAll();
  });

  document.querySelectorAll("nav button").forEach(function(btn){
    btn.addEventListener("click", function(){
      sfxNav();
      document.querySelectorAll("nav button").forEach(function(b){ b.classList.remove("active"); });
      btn.classList.add("active");
      document.querySelectorAll(".view").forEach(function(v){ v.classList.remove("active"); });
      document.getElementById("view-"+btn.getAttribute("data-view")).classList.add("active");
      if(btn.getAttribute("data-view")==="map") renderMap();
      if(btn.getAttribute("data-view")==="stats") renderStats();
    });
  });

  // ---- EXPORT / IMPORT (local file, the app's real backup mechanism) ----
  document.getElementById("exportBtn").addEventListener("click", function(){
    var payload = JSON.stringify({ approaches:approaches, momentum:momentum, exportedAt:new Date().toISOString() }, null, 2);
    var filename = "coldstart-backup-"+new Date().toISOString().slice(0,10)+".json";
    try{
      var blob = new Blob([payload], {type:"application/json"});
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a"); a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast("Backup downloaded");
    }catch(e){ showToast("Export failed"); }
  });

  document.getElementById("importBtn").addEventListener("click", function(){ document.getElementById("importFile").click(); });
  document.getElementById("importFile").addEventListener("change", function(e){
    var file = e.target.files[0]; if(!file) return;
    var reader = new FileReader();
    reader.onload = function(){
      try{
        var parsed = JSON.parse(reader.result);
        if(!parsed || !Array.isArray(parsed.approaches)) throw new Error("bad file");
        approaches = parsed.approaches;
        if(parsed.momentum) momentum = parsed.momentum;
        persist(); renderAll();
        showToast("Backup restored");
      }catch(err){ showToast("Could not read that file"); }
    };
    reader.readAsText(file);
    e.target.value = "";
  });

  var pendingDeleteIndex = null;
  function requestDeleteEntry(i){
    pendingDeleteIndex = i;
    document.getElementById("deleteModal").style.display = "flex";
    document.getElementById("deleteConfirmBtn").focus();
  }
  function closeDeleteModal(){
    document.getElementById("deleteModal").style.display = "none";
    pendingDeleteIndex = null;
  }
  document.getElementById("deleteCancelBtn").addEventListener("click", closeDeleteModal);
  document.getElementById("deleteModal").addEventListener("click", function(e){ if(e.target===this) closeDeleteModal(); });
  document.getElementById("deleteConfirmBtn").addEventListener("click", function(){
    if(pendingDeleteIndex===null) return;
    approaches.splice(pendingDeleteIndex,1);
    persist(); sfxDelete();
    closeDeleteModal();
    renderAll();
    showToast("Entry deleted");
  });
  document.addEventListener("keydown", function(e){
    if(e.key==="Escape" && document.getElementById("deleteModal").style.display==="flex") closeDeleteModal();
  });

  function renderHeader(){
    var totalXP = approaches.reduce(function(s,a){ return s+a.xp; }, 0);
    var rankIdx = rankForXP(totalXP);
    var rankNameEl = document.getElementById("rankName");
    var rankChanged = (lastRankIdx !== null && rankIdx > lastRankIdx);
    rankNameEl.textContent = RANKS[rankIdx];
    rankNameEl.className = "rank-name pixel " + RANKS[rankIdx] + (rankChanged ? " glitch" : "");
    lastRankIdx = rankIdx;
    if(rankChanged) sfxRankUp();
    document.getElementById("xpTotal").textContent = totalXP;

    var curFloor = THRESHOLDS[rankIdx];
    var nextIdx = Math.min(rankIdx+1, RANKS.length-1);
    var nextFloor = THRESHOLDS[nextIdx];
    var pct = rankIdx===RANKS.length-1 ? 100 : Math.min(100, Math.round(((totalXP-curFloor)/(nextFloor-curFloor))*100));
    document.getElementById("xpFill").style.width = pct+"%";
    document.getElementById("nextRankLabel").textContent = rankIdx===RANKS.length-1 ? "MAX RANK REACHED" : (nextFloor-totalXP)+" XP to "+RANKS[nextIdx];

    var streak = computeStreak(approaches);
    document.getElementById("streakNum").textContent = streak.count;
    var pill = document.getElementById("streakPill");
    var streakIconEl = document.getElementById("streakIcon");
    var streakSuffixEl = document.getElementById("streakSuffix");
    if(streak.cooling){ pill.classList.add("cooling"); streakIconEl.textContent = "❄"; streakSuffixEl.textContent = " day streak · cooling"; }
    else{ pill.classList.remove("cooling"); streakIconEl.textContent = "🔥"; streakSuffixEl.textContent = " day streak"; }

    document.getElementById("insertCoin").style.display = approaches.length===0 ? "block" : "none";
    applyClimate(approaches);
  }

  function renderMap(){
    var svg = document.getElementById("neuralSvg");
    var empty = document.getElementById("mapEmpty");
    svg.innerHTML = "";
    var hudNodesEl = document.getElementById("hudNodes"), hudLinksEl = document.getElementById("hudLinks");
    if(hudNodesEl) hudNodesEl.textContent = approaches.length;
    if(approaches.length===0){
      empty.style.display = "block";
      if(hudLinksEl) hudLinksEl.textContent = "0";
      return;
    }
    empty.style.display = "none";
    var cx=300, cy=300, ns="http://www.w3.org/2000/svg";

    var g = document.createElementNS(ns,"g");
    g.setAttribute("id","mapViewport");
    svg.appendChild(g);

    function makeLine(x1,y1,x2,y2,color,width,opacity){
      var l=document.createElementNS(ns,"line");
      l.setAttribute("x1",x1); l.setAttribute("y1",y1); l.setAttribute("x2",x2); l.setAttribute("y2",y2);
      l.setAttribute("stroke",color); l.setAttribute("stroke-width",width); l.setAttribute("opacity",opacity);
      return l;
    }
    function makeCircle(x,y,r,color,glow){
      var c=document.createElementNS(ns,"circle");
      c.setAttribute("cx",x); c.setAttribute("cy",y); c.setAttribute("r",r); c.setAttribute("fill",color);
      if(glow) c.setAttribute("style","filter:drop-shadow(0 0 6px "+color+")");
      return c;
    }
    function makePulseDot(pathD, color, dur, begin){
      var c = document.createElementNS(ns,"circle");
      c.setAttribute("r", 3); c.setAttribute("fill", color);
      c.setAttribute("style","filter:drop-shadow(0 0 4px "+color+")");
      var anim = document.createElementNS(ns,"animateMotion");
      anim.setAttribute("path", pathD);
      anim.setAttribute("dur", dur+"s");
      anim.setAttribute("begin", begin+"s");
      anim.setAttribute("repeatCount","indefinite");
      c.appendChild(anim);
      return c;
    }

    // radar pings from the core
    [0,1,2].forEach(function(i){
      var ring = document.createElementNS(ns,"circle");
      ring.setAttribute("cx",cx); ring.setAttribute("cy",cy); ring.setAttribute("r",10);
      ring.setAttribute("fill","none"); ring.setAttribute("stroke","#e7f1ff"); ring.setAttribute("stroke-width","1.5");
      ring.setAttribute("class","core-ring");
      var animR = document.createElementNS(ns,"animate");
      animR.setAttribute("attributeName","r"); animR.setAttribute("from","10"); animR.setAttribute("to","95");
      animR.setAttribute("dur","3s"); animR.setAttribute("begin",(i*1)+"s"); animR.setAttribute("repeatCount","indefinite");
      var animO = document.createElementNS(ns,"animate");
      animO.setAttribute("attributeName","opacity"); animO.setAttribute("from","0.55"); animO.setAttribute("to","0");
      animO.setAttribute("dur","3s"); animO.setAttribute("begin",(i*1)+"s"); animO.setAttribute("repeatCount","indefinite");
      ring.appendChild(animR); ring.appendChild(animO);
      g.appendChild(ring);
    });
    g.appendChild(makeCircle(cx,cy,10,"#e7f1ff",true));

    var pts=[];
    approaches.forEach(function(a,i){
      var angle=i*137.508*Math.PI/180, radius=16*Math.sqrt(i+1)+14;
      var x=cx+radius*Math.cos(angle), y=cy+radius*Math.sin(angle);
      x=Math.max(14,Math.min(586,x)); y=Math.max(14,Math.min(586,y));
      pts.push({x:x,y:y,a:a});
    });

    var hubConnections = [];
    var linkCount = 0;
    pts.forEach(function(p,i){
      var color=OUT_COLOR[p.a.outcome]||"#4beeff";
      var prev=i>0?pts[i-1]:{x:cx,y:cy};
      var w=p.a.outcome==="date"?2.4:p.a.outcome==="contact"?2:p.a.outcome==="opened"?1:1.4;
      g.appendChild(makeLine(prev.x,prev.y,p.x,p.y,color,w,0.35));
      linkCount++;
      var r=Math.hypot(p.x-cx,p.y-cy);
      if(r<130){ g.appendChild(makeLine(cx,cy,p.x,p.y,color,0.6,0.12)); linkCount++; hubConnections.push({x:p.x,y:p.y,color:color}); }
    });
    if(hudLinksEl) hudLinksEl.textContent = linkCount;

    var maxPulses = 26;
    var step = Math.max(1, Math.ceil(hubConnections.length/maxPulses));
    hubConnections.forEach(function(h, idx){
      if(idx % step !== 0) return;
      var pathD = "M "+cx+","+cy+" L "+h.x+","+h.y;
      var dur = 1.6 + (idx%5)*0.25;
      var begin = (idx%7)*0.3;
      g.appendChild(makePulseDot(pathD, h.color, dur, begin));
    });

    var isMapVisible = document.getElementById("view-map").classList.contains("active");
    var auraStart = Math.max(0, pts.length-40);
    pts.forEach(function(p,i){
      var color=OUT_COLOR[p.a.outcome]||"#4beeff";
      var r=4+Math.min(9,p.a.xp/8);
      if(i>=auraStart){
        var aura = makeCircle(p.x,p.y,r*1.7,color,false);
        aura.setAttribute("class","node-aura");
        aura.setAttribute("opacity","0.25");
        aura.style.animationDelay = ((i%5)*0.35)+"s";
        g.appendChild(aura);
      }
      var node = makeCircle(p.x,p.y,r,color,true);
      if(isMapVisible && justAddedTs !== null && p.a.ts === justAddedTs && i===pts.length-1){
        node.setAttribute("class","node-new");
        justAddedTs = null;
      }
      g.appendChild(node);
    });

    updateMapTransform();
  }

  function renderStats(){
    var total = approaches.length;
    document.getElementById("statTotal").textContent = total;
    var landed = approaches.filter(function(a){ return a.outcome==="contact"||a.outcome==="date"; }).length;
    document.getElementById("statConv").textContent = (total?Math.round((landed/total)*100):0)+"%";
    if(total){
      var buckets={"Morning":0,"Afternoon":0,"Evening":0,"Night":0};
      approaches.forEach(function(a){ var h=new Date(a.ts).getHours(); if(h<12) buckets["Morning"]++; else if(h<17) buckets["Afternoon"]++; else if(h<21) buckets["Evening"]++; else buckets["Night"]++; });
      document.getElementById("statBestTime").textContent = Object.keys(buckets).reduce(function(a,b){ return buckets[a]>=buckets[b]?a:b; });
    } else { document.getElementById("statBestTime").textContent = "--"; }
    document.getElementById("statMomentum").textContent = Math.round(momentum.value)+"%";
    document.getElementById("hsStreak").textContent = longestStreakEver(approaches);
    document.getElementById("hsDay").textContent = maxPerDay(approaches);

    var trendEl = document.getElementById("statAnxietyTrend");
    if(approaches.length >= 4){
      var sampleN = Math.max(1, Math.min(5, Math.floor(approaches.length/2)));
      var early = approaches.slice(0, sampleN);
      var recent = approaches.slice(-sampleN);
      var avg = function(list){ return list.reduce(function(s,a){ return s+a.anxiety; },0)/list.length; };
      var delta = avg(recent) - avg(early);
      if(Math.abs(delta) < 0.3){
        trendEl.textContent = "→ steady";
        trendEl.style.color = "var(--text-dim)";
      } else if(delta < 0){
        trendEl.textContent = "▼ " + Math.abs(delta).toFixed(1);
        trendEl.style.color = "var(--accent-primary)";
      } else {
        trendEl.textContent = "▲ " + delta.toFixed(1);
        trendEl.style.color = "var(--amber)";
      }
    } else {
      trendEl.textContent = "--";
      trendEl.style.color = "var(--accent-primary)";
    }

    var anxCard = document.getElementById("anxietyChartCard");
    if(approaches.length >= 3){
      anxCard.style.display = "block";
      var anxChart = document.getElementById("anxietyChart"); anxChart.innerHTML = "";
      var recentEntries = approaches.slice(-20);
      recentEntries.forEach(function(a){
        var col=document.createElement("div"); col.className="bar-col";
        var bar=document.createElement("div"); bar.className="bar"; bar.style.height=Math.max(3,(a.anxiety/5)*90)+"px";
        col.appendChild(bar); anxChart.appendChild(col);
      });
    } else {
      anxCard.style.display = "none";
    }

    var chart = document.getElementById("weekChart"); chart.innerHTML = "";
    var counts=[], labels=[];
    for(var i=6;i>=0;i--){
      var d=new Date(); d.setDate(d.getDate()-i);
      var key=d.toDateString();
      counts.push(approaches.filter(function(a){ return new Date(a.ts).toDateString()===key; }).length);
      labels.push(d.toLocaleDateString(undefined,{weekday:'short'}).slice(0,2));
    }
    var max=Math.max(1, Math.max.apply(null, counts));
    counts.forEach(function(c,i){
      var col=document.createElement("div"); col.className="bar-col";
      var bar=document.createElement("div"); bar.className="bar"; bar.style.height=Math.max(3,(c/max)*90)+"px";
      var lbl=document.createElement("div"); lbl.className="bar-day"; lbl.textContent=labels[i];
      col.appendChild(bar); col.appendChild(lbl); chart.appendChild(col);
    });

    var grid=document.getElementById("achGrid"); grid.innerHTML="";
    var newlyUnlockedAchs = [];
    ACHIEVEMENTS.forEach(function(ach){
      var unlocked=ach.test(approaches);
      if(unlocked && unlockedAchIds.indexOf(ach.id)===-1){
        unlockedAchIds.push(ach.id);
        if(!achBaselineSuppressed) newlyUnlockedAchs.push(ach);
      }
      var div=document.createElement("div"); div.className="ach"+(unlocked?" unlocked":"");
      div.innerHTML='<div class="ico">'+ach.ico+'</div><div class="name">'+ach.name+'</div><div class="desc">'+ach.desc+'</div>';
      grid.appendChild(div);
    });
    achBaselineSuppressed = false;
    saveUnlockedAch(unlockedAchIds);
    if(newlyUnlockedAchs.length){
      sfxAchievement();
      showAchievementPopup(newlyUnlockedAchs[0], newlyUnlockedAchs.length-1);
    }

    var logList = document.getElementById("logList");
    logList.innerHTML = "";
    if(approaches.length===0){
      logList.innerHTML = '<div class="log-empty">No entries yet — logged approaches will show up here, editable and deletable.</div>';
    } else {
      var rev = approaches.map(function(a,idx){ return {a:a, idx:idx}; }).reverse();
      var shown = rev.slice(0, 30);
      shown.forEach(function(item){
        var a = item.a, idx = item.idx;
        var row = document.createElement("div"); row.className = "log-entry";
        var d = new Date(a.ts);
        var dateStr = d.toLocaleDateString(undefined,{month:'short',day:'numeric'}) + " " + d.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});

        var info = document.createElement("div"); info.className = "log-entry-info";
        var dateLine = document.createElement("div"); dateLine.textContent = dateStr;
        var tagsLine = document.createElement("div"); tagsLine.className = "log-entry-tags";
        tagsLine.textContent = LOC_LABELS[a.location]+" · "+DIFF_LABELS[a.difficulty]+" · "+OUT_LABELS[a.outcome];
        info.appendChild(dateLine); info.appendChild(tagsLine);

        if(a.notes){
          var notesLine = document.createElement("div"); notesLine.className = "log-entry-notes";
          var isLong = a.notes.length > 90;
          var short = isLong ? a.notes.slice(0,90)+"…" : a.notes;
          notesLine.textContent = short;
          if(isLong){
            notesLine.setAttribute("role","button");
            notesLine.setAttribute("tabindex","0");
            notesLine.title = "Tap to show full note";
            var expanded = false;
            var toggleNote = function(){ expanded = !expanded; notesLine.textContent = expanded ? a.notes : short; };
            notesLine.addEventListener("click", toggleNote);
            notesLine.addEventListener("keydown", function(e){ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); toggleNote(); } });
          }
          info.appendChild(notesLine);
        }

        var xpEl = document.createElement("div"); xpEl.className = "log-entry-xp"; xpEl.textContent = "+"+a.xp;

        var actions = document.createElement("div"); actions.className = "log-entry-actions";
        var editBtn = document.createElement("button"); editBtn.type = "button"; editBtn.textContent = "✎";
        editBtn.setAttribute("aria-label","Edit this entry");
        editBtn.addEventListener("click", function(){ loadEntryIntoForm(idx); });
        var delBtn = document.createElement("button"); delBtn.type = "button"; delBtn.textContent = "✕";
        delBtn.setAttribute("aria-label","Delete this entry");
        delBtn.addEventListener("click", function(){ requestDeleteEntry(idx); });
        actions.appendChild(editBtn); actions.appendChild(delBtn);

        row.appendChild(info); row.appendChild(xpEl); row.appendChild(actions);
        logList.appendChild(row);
      });
      if(approaches.length > 30){
        var more = document.createElement("div"); more.className = "log-more";
        more.textContent = "showing most recent 30 of "+approaches.length;
        logList.appendChild(more);
      }
    }
  }

  function renderAll(){
    try{ renderHeader(); }catch(e){ console.error("renderHeader failed", e); }
    try{ renderMap(); }catch(e){ console.error("renderMap failed", e); }
    try{ renderStats(); }catch(e){ console.error("renderStats failed", e); }
  }

  async function init(){
    var storedApproaches = await db.get("approaches");
    approaches = Array.isArray(storedApproaches) ? storedApproaches : [];

    var storedMomentum = await db.get("momentum");
    momentum = decayMomentum(storedMomentum || {value:0,lastUpdate:null});
    saveMomentum(momentum);

    cachedLastChoice = (await db.get("lastChoice")) || null;

    soundEnabled = (await db.get("soundPref")) === true;
    updateSoundToggleUI();

    var storedAch = await db.get("achUnlocked");
    achBaselineSuppressed = (storedAch === undefined);
    unlockedAchIds = Array.isArray(storedAch) ? storedAch : [];

    applyLastChoiceDefaults();
    updateSubmitState();
    renderAll();
  }

  if("serviceWorker" in navigator){
    window.addEventListener("load", function(){
      navigator.serviceWorker.register("service-worker.js").catch(function(){});
    });
  }

  init();
})();
