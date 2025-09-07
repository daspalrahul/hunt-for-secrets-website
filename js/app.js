/* Client-only treasure hunt app */

// Safe localStorage helpers
function safeGet(key) {
  try { return localStorage.getItem(key); }
  catch (e) { console.warn('localStorage.getItem failed', e); return null; }
}
function safeSet(key, val) {
  try { localStorage.setItem(key, val); }
  catch (e) { console.warn('localStorage.setItem failed', e); }
}
function safeRemove(key) {
  try { localStorage.removeItem(key); }
  catch (e) { console.warn('localStorage.removeItem failed', e); }
}

let savedProgress = {};
try {
  savedProgress = JSON.parse(safeGet('progress') || '{}');
} catch (e) {
  console.warn('Failed to read progress from storage', e);
}

const state = {
  locations: [],
  progress: savedProgress, // {id:{done:boolean, points:number, ts:number, method:string, distance:number}}
  model: null,
  usingDetector: true
};

function $(id){ return document.getElementById(id); }

async function load() {
  // PWA install prompt
  let deferredPrompt;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const btn = $('installBtn');
    btn.hidden = false;
    btn.onclick = async () => {
      btn.hidden = true;
      await deferredPrompt.prompt();
    };
  });

  // Load locations
  const res = await fetch('data/locations.json');
  state.locations = await res.json();
  $('totalCount').textContent = state.locations.length;

  // Populate select
  const sel = $('clueSelect');
  for (const loc of state.locations) {
    const opt = document.createElement('option');
    opt.value = loc.id;
    const done = state.progress[loc.id]?.done;
    opt.textContent = `${done ? '✅ ' : ''}${loc.title}`;
    sel.appendChild(opt);
  }
  sel.onchange = () => renderClue();
  renderClue();

  // Buttons
  $('validateBtn').onclick = () => validateSelected();
  $('resetBtn').onclick = resetProgress;

  // Try to load detector
  try {
    state.model = await cocoSsd.load();
  } catch(e) {
    console.warn('Detector unavailable:', e);
    state.usingDetector = false;
  }

  // Service worker
  if ('serviceWorker' in navigator) {
    try { await navigator.serviceWorker.register('sw.js'); } catch {}
  }

  renderScore();
}

function renderClue() {
  const id = $('clueSelect').value;
  const loc = state.locations.find(l => l.id === id);
  $('clueHint').textContent = loc?.clue || '';
  $('result').textContent = '';
  debug(`Selected: ${loc.title}`);
}

function haversineMeters(aLat,aLon,bLat,bLon){
  const R=6371000, toRad=d=>d*Math.PI/180;
  const dLat=toRad(bLat-aLat), dLon=toRad(bLon-aLon);
  const la1=toRad(aLat), la2=toRad(bLat);
  const x=Math.sin(dLat/2)**2 + Math.cos(la1)*Math.cos(la2)*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(x));
}

function getLiveLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Geolocation not supported'));
    navigator.geolocation.getCurrentPosition(
      pos => resolve({lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy, ts: Date.now()}),
      err => reject(err),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
    );
  });
}

async function getExifLocation(file) {
  try {
    const data = await exifr.parse(file, { gps: true });
    if (!data || data.latitude == null || data.longitude == null) return null;
    return { lat: data.latitude, lon: data.longitude, acc: 50, ts: Date.now() };
  } catch {
    return null;
  }
}

async function detectLabels(imgEl){
  if (!state.usingDetector || !state.model) return [];
  try {
    const preds = await state.model.detect(imgEl, 10);
    return preds.filter(p=>p.score>=0.5).map(p=>p.class);
  } catch {
    return [];
  }
}

function debug(msg){
  const pre = $('debugPre');
  pre.textContent = `[${new Date().toISOString()}] ${msg}\n` + pre.textContent;
}

async function validateSelected(){
  const id = $('clueSelect').value;
  const loc = state.locations.find(l => l.id === id);
  const file = $('photoInput').files[0];
  if (!loc){ return; }
  $('result').textContent = 'Validating…';

  let pos, method='live';
  try {
    pos = await getLiveLocation();
  } catch {
    if (file){
      const ex = await getExifLocation(file);
      if (ex){ pos = ex; method='exif'; }
    }
  }
  if (!pos){
    $('result').textContent = 'Could not read your location. Please enable location or include GPS in photo.';
    return;
  }

  const dist = haversineMeters(pos.lat,pos.lon,loc.lat,loc.lon);
  const within = dist <= loc.radiusMeters;

  // Object check (optional bonus)
  let objectOk = false;
  if (file && state.usingDetector){
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    await img.decode().catch(()=>{});
    const labels = await detectLabels(img);
    objectOk = (loc.labelsAnyOf||[]).some(tag => labels.includes(tag));
    URL.revokeObjectURL(url);
  }

  if (within){
    const basePoints = loc.points;
    const bonus = objectOk ? Math.ceil(basePoints*0.3) : 0;
    const total = basePoints + bonus;
    state.progress[id] = { done:true, points: total, ts: Date.now(), method, distance: Math.round(dist), objectOk };
    safeSet('progress', JSON.stringify(state.progress));
    $('result').innerHTML = `✅ Nice! Within ${Math.round(dist)} m (${method}). +${basePoints} pts${bonus?` + ${bonus} bonus`:''}.`;
  } else {
    $('result').textContent = `❌ Not quite. You are ${Math.round(dist)} m away (need <= ${loc.radiusMeters} m).`;
  }

  // Update UI
  for (const opt of $('clueSelect').options) {
    const done = state.progress[opt.value]?.done;
    opt.textContent = `${done ? '✅ ' : ''}${state.locations.find(l=>l.id===opt.value).title}`;
  }
  renderScore();
}

function renderScore(){
  const vals = Object.values(state.progress||{}).filter(p=>p.done);
  const count = vals.length;
  const points = vals.reduce((a,b)=>a+(b.points||0),0);
  $('completedCount').textContent = count;
  $('totalPoints').textContent = points;
}

function resetProgress(){
  if (!confirm('Reset local progress?')) return;
  state.progress = {};
  safeRemove('progress');
  renderScore();
  for (const opt of $('clueSelect').options) {
    opt.textContent = state.locations.find(l=>l.id===opt.value).title;
  }
  $('result').textContent = '';
  $('photoInput').value = '';
}

window.addEventListener('load', load);

// --- Splash screen logic ---
function setupSplash(){
  const key = 'bcn-splash-dismissed';
  const dismissed = safeGet(key) === '1';
  const el = document.getElementById('splash');
  if (!el) return;
  if (dismissed) { el.style.display = 'none'; return; }
  const start = document.getElementById('startBtn');
  if (!start) {
    console.warn('#startBtn not found; hiding splash');
    el.style.display = 'none';
    return;
  }
  start.addEventListener('click', ()=>{
    el.style.opacity = '0';
    setTimeout(()=>{
      el.style.display = 'none';
      safeSet(key,'1');
    }, 200);
  });
}

// --- Map with Leaflet ---
let map, markersLayer;
async function initMap(){
  if (!window.L) return;
  map = L.map('map', { scrollWheelZoom: false });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);
  markersLayer = L.layerGroup().addTo(map);

  // Fit to Barcelona bounding box (rough)
  const bounds = [[41.33, 2.08], [41.47, 2.23]];
  map.fitBounds(bounds);

  const res = await fetch('data/locations.json');
  const locs = await res.json();
  // approximate pins: add a tiny jitter so it isn't an exact reveal
  function jitter(n){ return (Math.random()-0.5) * n; } // ~small offset
  locs.forEach(loc=>{
    const icon = L.divIcon({
      className: 'pin',
      html: '<div style="background:linear-gradient(180deg,#0ea5e9,#7c3aed);width:16px;height:16px;border-radius:50%;box-shadow:0 0 0 3px rgba(14,165,233,.3)"></div>',
      iconSize: [16,16],
      iconAnchor: [8,8]
    });
    const lat = loc.lat + jitter(0.0012); // ~100m jitter
    const lon = loc.lon + jitter(0.0012);
    const m = L.marker([lat,lon], { icon }).addTo(markersLayer);
    const done = state.progress[loc.id]?.done;
    m.bindPopup(`<strong>${done?'✅ ':''}${loc.title}</strong><br><em>${loc.clue}</em>`);
  });
}

// Run splash early
document.addEventListener('DOMContentLoaded', setupSplash);

// After load() finishes, also init map
const _origLoad = load;
load = async function(){
  await _origLoad();
  initMap();
}


// --- How-to carousel ---
function setupCarousel(){
  const slides = document.querySelector('.howto .slides');
  const dots = document.querySelectorAll('.howto .dot');
  if (!slides || dots.length===0) return;
  let i = 0;
  function show(n){
    i = (n+3)%3;
    slides.style.transform = `translateX(-${i*100}%)`;
    dots.forEach((d,k)=>d.classList.toggle('active', k===i));
  }
  dots.forEach(d=>d.addEventListener('click', ()=>show(parseInt(d.dataset.i))));
  show(0);
  setInterval(()=>show(i+1), 3500);
}
document.addEventListener('DOMContentLoaded', setupCarousel);

// --- Deterministic jitter per ID (so centering matches pins) ---
function seededOffset(id){
  // simple hash to [0,1)
  let h=0;
  for (let c of id) { h = (h*31 + c.charCodeAt(0)) >>> 0; }
  const r1 = (h % 1000) / 1000; h = (h*1103515245 + 12345) >>> 0;
  const r2 = (h % 1000) / 1000;
  const scale = 0.0010; // ~80-100m
  return { dlat: (r1-0.5)*scale, dlon: (r2-0.5)*scale };
}

const markerIndex = {}; // id -> {lat,lon,marker}

// Override initMap to use tier pins and deterministic jitter
const _initMap = initMap;
initMap = async function(){
  if (!window.L) return;
  map = L.map('map', { scrollWheelZoom: false });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);
  markersLayer = L.layerGroup().addTo(map);
  const bounds = [[41.33, 2.08], [41.47, 2.23]];
  map.fitBounds(bounds);

  const res = await fetch('data/locations.json');
  const locs = await res.json();

  locs.forEach(loc=>{
    const off = seededOffset(loc.id);
    const lat = loc.lat + off.dlat;
    const lon = loc.lon + off.dlon;
    const tierClass = 'pin' + (loc.tier || 'B');
    const icon = L.divIcon({
      className: `pin ${tierClass}`,
      html: '<div style="width:16px;height:16px;border-radius:50%;box-shadow:0 0 0 3px rgba(14,165,233,.25)"></div>',
      iconSize: [16,16],
      iconAnchor: [8,8]
    });
    const m = L.marker([lat,lon], { icon }).addTo(markersLayer);
    const done = state.progress[loc.id]?.done;
    m.bindPopup(`<strong>${done?'✅ ':''}${loc.title}</strong><br><em>${loc.clue}</em><br><small>Tier ${loc.tier}</small>`);
    markerIndex[loc.id] = { lat, lon, marker: m };
  });
}

// Center map to selected clue
function centerSelected(){
  const id = $('clueSelect').value;
  const node = markerIndex[id];
  if (node && map){
    map.setView([node.lat, node.lon], 16, {animate:true});
    node.marker.openPopup();
  }
}

// Hook up "Show on Map" button and also center on selection change
document.addEventListener('DOMContentLoaded', ()=>{
  const btn = document.getElementById('showOnMap');
  if (btn) btn.addEventListener('click', centerSelected);
});
const _origRenderClue = renderClue;
renderClue = function(){
  _origRenderClue();
  centerSelected();
}

// --- Persistence: already using localStorage; add periodic flush safeguard
setInterval(()=>{ safeSet('progress', JSON.stringify(state.progress)); }, 5000);

// --- Completion detection
function checkCompletion(){
  const total = state.locations.length;
  const done = Object.values(state.progress||{}).filter(p=>p.done).length;
  if (done >= total && total>0){
    showCompletionCard();
  }
}

// Hook: after successful validation, also check completion
const _validateSelected = validateSelected;
validateSelected = async function(){
  await _validateSelected();
  checkCompletion();
};

document.getElementById('shareCard').onclick = async () => {
  try{
    const blob = await new Promise(res => document.getElementById('cardCanvas').toBlob(res, 'image/png'));
    const file = new File([blob], 'bcn-hunt-completion.png', {type:'image/png'});
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files:[file], title:'Hunt for Secrets', text:'I completed the Barcelona treasure hunt!' });
    } else {
      // fallback to download if Web Share is not available
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'bcn-hunt-completion.png'; a.click();
      URL.revokeObjectURL(url);
    }
  } catch(e){
    console.warn('Share failed', e);
  }
};

// Ensure we check completion on load (resume state)
window.addEventListener('load', ()=> setTimeout(checkCompletion, 400));

// --- Install prompt nudge after 2 sessions
(function(){
  const k='bcn-sessions'; let n = parseInt(safeGet(k)||'0',10)+1; safeSet(k, String(n));
  if (n>=2){
    const btn = document.getElementById('installBtn');
    if (btn) btn.hidden = false;
  }
})();

// --- First launch banner wiring
(function(){
  const key='bcn-first-launch'; const seen = safeGet(key)==='1';
  const b = document.getElementById('firstLaunchBanner');
  if (!b) return;
  if (!seen){ b.hidden = false; }
  document.getElementById('closeBanner').onclick = ()=>{ b.hidden = true; safeSet(key,'1'); };
  document.getElementById('openPrivacyFromBanner').onclick = (e)=>{
    e.preventDefault();
    const modal = document.getElementById('privacyModal'); if (modal) modal.hidden = false;
  };
})();

// --- Battery saver & High contrast persistence
(function(){
  const bs = document.getElementById('batterySaverToggle');
  const hc = document.getElementById('highContrastToggle');
  const bsKey='bcn-battery-saver', hcKey='bcn-high-contrast';
  const savedBs = safeGet(bsKey)==='1';
  const savedHc = safeGet(hcKey)==='1';
  if (bs){ bs.checked = savedBs; }
  if (hc){ hc.checked = savedHc; if (savedHc) document.documentElement.classList.add('high-contrast'); }
  if (bs) bs.addEventListener('change', ()=>{ safeSet(bsKey, bs.checked?'1':'0'); });
  if (hc) hc.addEventListener('change', ()=>{
    safeSet(hcKey, hc.checked?'1':'0');
    document.documentElement.classList.toggle('high-contrast', hc.checked);
  });
})();

// --- Backup/restore progress JSON
(function(){
  const btnB = document.getElementById('backupProgress');
  const btnR = document.getElementById('restoreProgress');
  if (btnB) btnB.onclick = ()=>{
    const blob = new Blob([JSON.stringify(state.progress,null,2)], {type:'application/json'});
    const url = URL.createObjectURL(blob); const a=document.createElement('a');
    a.href=url; a.download='bcn-hunt-progress.json'; a.click(); URL.revokeObjectURL(url);
  };
  if (btnR) btnR.onclick = async ()=>{
    const inp = document.createElement('input'); inp.type='file'; inp.accept='application/json';
    inp.onchange = async ()=>{
      const f = inp.files[0]; if (!f) return;
      try {
        const text = await f.text();
        const data = JSON.parse(text);
        if (typeof data === 'object'){ state.progress = data; safeSet('progress', JSON.stringify(state.progress)); renderScore(); }
      } catch(e){ alert('Invalid file'); }
    };
    inp.click();
  };
})();

// --- Reset all local data
(function(){
  const btn = document.getElementById('resetAllData');
  if (!btn) return;
  btn.onclick = async ()=>{
    if (!confirm('This will erase local progress and preferences. Proceed?')) return;
    try {
      const keepKeys = ['bcn-first-launch']; // keep banner state
      const all = Object.keys(localStorage);
      for (const k of all){ if (!keepKeys.includes(k)) safeRemove(k); }
    } catch {}
    state.progress = {};
    renderScore();
    location.reload();
  };
})();

// --- Filters (search, tier, status)
(function(){
  const s = document.getElementById('searchClues');
  const fa = document.getElementById('filterA'), fb = document.getElementById('filterB'), fc = document.getElementById('filterC'), fd = document.getElementById('filterDone');
  function apply(){
    const q = (s?.value||'').toLowerCase();
    const showA = fa?.checked !== false, showB = fb?.checked !== false, showC = fc?.checked !== false, showDone = fd?.checked !== false;
    const sel = document.getElementById('clueSelect'); if (!sel) return;
    sel.innerHTML = '';
    for (const loc of state.locations){
      const done = state.progress[loc.id]?.done;
      if (!showDone && done) continue;
      const tier = loc.tier || 'B';
      if ((tier==='A' && !showA) || (tier==='B' && !showB) || (tier==='C' && !showC)) continue;
      const text = (loc.title + ' ' + (loc.clue||'')).toLowerCase();
      if (q && !text.includes(q)) continue;
      const opt = document.createElement('option');
      opt.value = loc.id;
      opt.textContent = `${done ? '✅ ' : ''}${loc.title}`;
      sel.appendChild(opt);
    }
    renderClue();
  }
  [s, fa, fb, fc, fd].forEach(el=> el && el.addEventListener('input', apply));
  window.addEventListener('load', ()=> setTimeout(apply, 500));
})();

// --- Nearby suggestions
document.getElementById('findNearby')?.addEventListener('click', async ()=>{
  try {
    const pos = await getLiveLocation();
    const ul = document.getElementById('nearbyList'); ul.innerHTML='';
    const list = state.locations
      .map(l => ({ l, d: haversineMeters(pos.lat,pos.lon,l.lat,l.lon) }))
      .filter(x => x.d <= 500) // within 500m
      .sort((a,b)=>a.d-b.d)
      .slice(0,10);
    if (list.length===0){ ul.innerHTML = '<li>No nearby clues found.</li>'; return; }
    for (const {l,d} of list){
      const li = document.createElement('li');
      li.innerHTML = `<a href="#">${l.title}</a> — ${Math.round(d)} m`;
      li.querySelector('a').addEventListener('click', (e)=>{ e.preventDefault(); document.getElementById('clueSelect').value = l.id; renderClue(); centerSelected(); });
      ul.appendChild(li);
    }
  } catch(e){
    alert('Location unavailable. Please allow location to find nearby clues.');
  }
});

// --- Warm/cold meter calculation
function warmCold(distance, radius){
  // bands relative to radius
  if (distance <= radius) return {label:'🔥 Hot', percent: 100};
  const ratio = distance / radius;
  if (ratio <= 1.5) return {label:'😊 Warm', percent: 70};
  if (ratio <= 2.5) return {label:'😐 Cool', percent: 40};
  return {label:'🥶 Cold', percent: 20};
}

// Patch success/fail UI in validateSelected to include meter
// --- Battery-aware: skip object detection when saver enabled or battery low
(async function(){
  try {
    const bsOn = safeGet('bcn-battery-saver')==='1';
    if (bsOn){ state.usingDetector = false; return; }
    if (navigator.getBattery){
      const b = await navigator.getBattery();
      if (b.level < 0.15 || b.saverMode){ state.usingDetector = false; }
    }
  } catch {}
})();

// --- Completion code using SubtleCrypto (sorted ids + points)
async function makeCompletionCode(){
  const ids = Object.keys(state.progress).filter(id=>state.progress[id]?.done).sort().join(',');
  const pts = Object.values(state.progress).filter(p=>p.done).reduce((a,b)=>a+(b.points||0),0);
  const text = ids + '|' + pts;
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  const bytes = Array.from(new Uint8Array(buf));
  const b32 = bytes.map(b=>b.toString(16).padStart(2,'0')).join('').slice(0,16).toUpperCase();
  return b32.match(/.{1,4}/g).join('-'); // XXXX-XXXX-XXXX-XXXX
}

// Hook into completion card to display code
const _showCompletionCard = showCompletionCard;
showCompletionCard = async function(){
  await _showCompletionCard();
  const c = await makeCompletionCode();
  const ctx = document.getElementById('cardCanvas').getContext('2d');
  ctx.font = '32px sans-serif'; ctx.fillStyle = '#7dd3fc';
  ctx.fillText('Completion Code: ' + c, 60, 1220);
};

// ----- VERIFY CODE (format + checksum) -----
(function(){
  const inp = document.getElementById('verifyInput');
  const btn = document.getElementById('verifyBtn');
  const out = document.getElementById('verifyResult');
  async function verify(){
    const raw = (inp.value||'').trim().toUpperCase();
    const okFmt = /^[0-9A-F]{4}(-[0-9A-F]{4}){3}-[0-9A-F]{2}$/.test(raw); // 4-4-4-4-CS
    if (!okFmt){ out.className='result err'; out.textContent='Invalid format.'; return; }
    const parts = raw.split('-');
    const cs = parts.pop(); // last 2
    const hex = parts.join(''); // 16 hex
    const sum = hex.split('').reduce((a,c)=> a + parseInt(c,16), 0) & 0xFF;
    const calc = (sum & 0xFF).toString(16).toUpperCase().padStart(2,'0');
    if (calc === cs){
      out.className='result ok'; out.textContent='Looks valid ✔️ (checksum matches).';
    } else {
      out.className='result err'; out.textContent='Checksum mismatch.';
    }
  }
  btn?.addEventListener('click', verify);
})();

// ----- COMPLETION CODE (now with checksum) -----
async function makeCompletionCode(){
  const ids = Object.keys(state.progress).filter(id=>state.progress[id]?.done).sort().join(',');
  const pts = Object.values(state.progress).filter(p=>p.done).reduce((a,b)=>a+(b.points||0),0);
  const text = ids + '|' + pts;
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  const bytes = Array.from(new Uint8Array(buf));
  const hex = bytes.map(b=>b.toString(16).padStart(2,'0')).join('').slice(0,16).toUpperCase();
  const sum = hex.split('').reduce((a,c)=> a + parseInt(c,16), 0) & 0xFF;
  const cs = (sum & 0xFF).toString(16).toUpperCase().padStart(2,'0');
  return hex.match(/.{1,4}/g).join('-') + '-' + cs; // XXXX-XXXX-XXXX-XXXX-CS
}

// ----- FACE BLUR (BlazeFace) -----
let faceModel = null;
async function loadFaceModel(){
  try{ faceModel = await blazeface.load(); } catch(e){ console.warn('BlazeFace load failed', e); }
}
loadFaceModel();

async function blurFacesOnCanvas(imgEl, canvas, manualBoxes=[]){
  const ctx = canvas.getContext('2d');
  const maxW = 1280; // limit size for performance
  const scale = imgEl.naturalWidth > maxW ? maxW / imgEl.naturalWidth : 1;
  const w = Math.round(imgEl.naturalWidth * scale);
  const h = Math.round(imgEl.naturalHeight * scale);
  canvas.width = w; canvas.height = h;
  ctx.drawImage(imgEl, 0, 0, w, h);

  const boxes = [];
  if (faceModel && document.getElementById('autoFaceBlurToggle')?.checked){
    try{
      const preds = await faceModel.estimateFaces(imgEl, false);
      preds.forEach(p => {
        const [x,y,wf,hf] = p.topLeft.concat([p.bottomRight[0]-p.topLeft[0], p.bottomRight[1]-p.topLeft[1]]);
        boxes.push({x:x*scale,y:y*scale,w:wf*scale,h:hf*scale});
      });
    } catch(e){ console.warn('Face detect failed', e); }
  }
  // manual rectangles (already in canvas scale)
  boxes.push(...manualBoxes);

  // apply blur per box using an offscreen canvas
  if (boxes.length){
    const off = document.createElement('canvas');
    off.width = w; off.height = h;
    const octx = off.getContext('2d');
    octx.filter = 'blur(12px)';
    octx.drawImage(canvas, 0, 0, w, h);
    boxes.forEach(b => {
      const sx = Math.max(0, b.x), sy = Math.max(0, b.y), sw = Math.max(1, Math.min(w - sx, b.w)), sh = Math.max(1, Math.min(h - sy, b.h));
      const patch = off.getContext('2d').getImageData(sx, sy, sw, sh);
      ctx.putImageData(patch, sx, sy);
      // optional overlay box (subtle)
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 2;
      ctx.strokeRect(sx, sy, sw, sh);
    });
  }
  canvas.style.display = 'block';
  return canvas;
}

// Manual blur UI (simple rectangle draw)
(function(){
  const btn = document.getElementById('manualBlurBtn');
  const canvas = document.getElementById('photoPreview');
  let drawing = false, startX=0, startY=0, rects = [];
  if (!btn || !canvas) return;
  btn.addEventListener('click', ()=>{
    if (canvas.style.display === 'none'){ alert('Select a photo first.'); return; }
    alert('Drag on the preview to blur extra areas (e.g., license plates). Double-tap to clear.');
  });
  canvas.addEventListener('pointerdown', (e)=>{
    drawing = true;
    const r = canvas.getBoundingClientRect();
    startX = (e.clientX - r.left) * (canvas.width / r.width);
    startY = (e.clientY - r.top) * (canvas.height / r.height);
  });
  canvas.addEventListener('pointerup', async (e)=>{
    if (!drawing) return;
    drawing = false;
    const r = canvas.getBoundingClientRect();
    const endX = (e.clientX - r.left) * (canvas.width / r.width);
    const endY = (e.clientY - r.top) * (canvas.height / r.height);
    const box = { x: Math.min(startX, endX), y: Math.min(startY, endY), w: Math.abs(endX - startX), h: Math.abs(endY - startY) };
    rects.push(box);
    // redraw with blur
    const img = new Image(); img.src = canvas.toDataURL(); await img.decode().catch(()=>{});
    await blurFacesOnCanvas(img, canvas, rects);
  });
  canvas.addEventListener('dblclick', async ()=>{
    rects = [];
    const img = new Image(); img.src = canvas.toDataURL(); await img.decode().catch(()=>{});
    await blurFacesOnCanvas(img, canvas, rects);
  });
})();

// Hook into photo selection to show preview + blur
(function(){
  const input = document.getElementById('photoInput');
  const canvas = document.getElementById('photoPreview');
  input?.addEventListener('change', async ()=>{
    const file = input.files?.[0]; if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image(); img.src = url; await img.decode().catch(()=>{});
    await blurFacesOnCanvas(img, canvas, []);
    URL.revokeObjectURL(url);
  });
})();

// --- Paste from clipboard in Verify Card ---
(function(){
  const btn = document.getElementById('pasteCodeBtn');
  const inp = document.getElementById('verifyInput');
  if (!btn || !inp) return;
  btn.addEventListener('click', async ()=>{
    try{
      const text = await navigator.clipboard.readText();
      if (text){ inp.value = text.trim(); }
    } catch(e){ alert('Clipboard not available.'); }
  });
})();

// --- Splash quick links
document.getElementById('linkVerify')?.addEventListener('click', (e)=>{
  e.preventDefault();
  const splash = document.getElementById('splash'); if (splash) splash.style.display='none';
  document.getElementById('verifyCard')?.scrollIntoView({behavior:'smooth', block:'start'});
});
document.getElementById('linkNearby')?.addEventListener('click', (e)=>{
  e.preventDefault();
  const splash = document.getElementById('splash'); if (splash) splash.style.display='none';
  document.getElementById('nearbySection')?.scrollIntoView({behavior:'smooth', block:'start'});
});

// --- Paste from clipboard
document.getElementById('pasteFromClipboard')?.addEventListener('click', async ()=>{
  try{
    const text = await navigator.clipboard.readText();
    if (text){
      const inp = document.getElementById('verifyInput');
      inp.value = text.trim();
      document.getElementById('verifyBtn')?.click();
    }
  } catch(e){
    alert('Clipboard not available. Long-press and paste manually.');
  }
});

// --- Copy completion code to clipboard
(function(){
  const origShow = showCompletionCard;
  showCompletionCard = async function(){
    await origShow();
    const btn = document.getElementById('copyCode');
    if (btn){
      btn.onclick = async ()=>{
        const code = await makeCompletionCode();
        try{
          await navigator.clipboard.writeText(code);
          alert('Completion code copied: ' + code);
        } catch(e){
          prompt('Copy this code manually:', code);
        }
      };
    }
  };
})();

// Copy completion code button
(function(){
  const wire = () => {
    const btn = document.getElementById('copyCardCode');
    if (!btn) return;
    btn.onclick = async () => {
      try{
        const code = await makeCompletionCode();
        await navigator.clipboard.writeText(code);
        btn.textContent = 'Copied!';
        setTimeout(()=> btn.textContent = 'Copy Code', 1200);
      } catch(e){
        alert('Could not copy. Here is your code:\n' + (await makeCompletionCode()));
      }
    };
  };
  document.addEventListener('DOMContentLoaded', wire);
  window.addEventListener('load', wire);
})();


// Single source of truth for validation
validateSelected = async function(){
  const id = $('clueSelect').value;
  const loc = state.locations.find(l => l.id === id);
  const file = $('photoInput').files[0];
  if (!loc){
    return;
  }

  $('result').className = 'result';
  $('result').textContent = 'Validating…';

  let pos = null;
  let method = 'live';

  // JIT geolocation with rationale, EXIF fallback on decline/failure
  try {
    pos = await requestGeolocationWithRationale();
  } catch (e) {
    if (file){
      const ex = await getExifLocation(file);
      if (ex){ pos = ex; method = 'exif'; }
    }
  }

  if (!pos){
    $('result').className = 'result err';
    $('result').textContent = 'Location unavailable. Please enable location or include GPS in the photo.';
    return;
  }

  const dist = haversineMeters(pos.lat, pos.lon, loc.lat, loc.lon);
  const within = dist <= loc.radiusMeters;

  // Optional object check (skipped if battery saver disabled detector elsewhere)
  let objectOk = false;
  if (file && state.usingDetector){
    try{
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.src = url;
      await img.decode().catch(()=>{});
      const labels = await detectLabels(img);
      objectOk = (loc.labelsAnyOf||[]).some(tag => labels.includes(tag));
      URL.revokeObjectURL(url);
    } catch {}
  }

  if (within){
    const basePoints = loc.points;
    const bonus = objectOk ? Math.ceil(basePoints * 0.3) : 0;
    const total = basePoints + bonus;
    state.progress[id] = { done: true, points: total, ts: Date.now(), method, distance: Math.round(dist), objectOk };
    safeSet('progress', JSON.stringify(state.progress));
    $('result').className = 'result ok';
    var bonusText = objectOk ? (' + ' + bonus + ' bonus') : '';
    $('result').innerHTML = '✅ Nice! Within ' + Math.round(dist) + ' m (' + method + '). +' + basePoints + ' pts' + bonusText + '.';
    confettiBurst();
  } else {
    $('result').className = 'result err';
    $('result').textContent = '❌ Not quite. You are ' + Math.round(dist) + ' m away (need <= ' + loc.radiusMeters + ' m).';
  }

  // Warm/Cold meter (best-effort live location)
  try {
    const live = await getLiveLocation();
    const d2 = haversineMeters(live.lat, live.lon, loc.lat, loc.lon);
    const wc = warmCold(d2, loc.radiusMeters);
    const meter = document.createElement('div');
    meter.className = 'meter';
    const bar = document.createElement('div');
    bar.style.width = wc.percent + '%';
    bar.style.background = wc.label.indexOf('Hot')>=0 ? '#22c55e' : (wc.label.indexOf('Warm')>=0 ? '#f59e0b' : '#ef4444');
    meter.appendChild(bar);
    const tag = document.createElement('div');
    tag.style.marginTop = '6px';
    tag.textContent = wc.label + ' • ' + Math.round(d2) + ' m';
    $('result').appendChild(meter);
    $('result').appendChild(tag);
  } catch {}

  // Update dropdown labels with completion ticks
  const sel = $('clueSelect');
  for (let i=0;i<sel.options.length;i++){
    const opt = sel.options[i];
    const done = !!(state.progress[opt.value] && state.progress[opt.value].done);
    const locTitle = (state.locations.find(l=>l.id===opt.value) || {}).title || opt.value;
    opt.textContent = (done ? '✅ ' : '') + locTitle;
  }

  renderScore();
  checkCompletion();
};

