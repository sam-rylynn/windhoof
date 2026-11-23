// Native rectangles are in container coordinates, not screen or drawing-buffer pixels.
function initPortraitWindow() {
  const host = window.xhs;
  const stage = document.getElementById('stage');
  if (!host || !stage || stage.classList.contains('host-window')) return;
  stage.classList.add('host-window');
  const tool = host.miniTool;
  let version = 0, readId = 0, nextRead = 0;
  function layout(info) {
    if (!info || !(info.windowHeight > 0 && info.windowWidth > 0)) return;
    const area = info.safeArea, buttons = info.menuButtons || {}, gesture = info.gestureArea;
    const box = stage.getBoundingClientRect();
    const sx = window.innerWidth / info.windowWidth, sy = window.innerHeight / info.windowHeight;
    const visible = rect => rect && rect.width > 0 && rect.height > 0;
    const capsule = version >= 9550 && visible(buttons.capsule);
    const row = capsule ? [buttons.capsule] : [buttons.back, buttons.me, buttons.share].filter(visible);
    const top = row.reduce((edge, rect) => Math.max(edge, rect.bottom), visible(area) ? area.top : 0);
    if (row.length || top > 0) stage.style.setProperty('--headroom', Math.ceil(Math.max(0, top * sy - box.top) + 8) + 'px');
    else stage.style.removeProperty('--headroom');
    stage.classList.toggle('host-buttons', row.length > 0);
    const left = Math.max(visible(area) ? area.left : 0, visible(gesture) ? gesture.right : 0);
    stage.style.setProperty('--inset-left', Math.ceil(Math.max(0, left * sx - box.left)) + 'px');
    if (visible(area)) {
      stage.style.setProperty('--inset-right', Math.ceil(Math.max(0, box.right - area.right * sx)) + 'px');
      stage.style.setProperty('--footroom', Math.ceil(Math.max(20, box.bottom - area.bottom * sy + 12)) + 'px');
    }
  }
  function readLaunch(options) {
    const env = options && options.miniToolEnv;
    if (!env) return;
    const raw = env.buildVersion;
    if ((typeof raw === 'string' || typeof raw === 'number') && /^[1-9]\d{6,}$/.test(raw) && Number.isSafeInteger(Number(raw))) {
      version = Math.floor(Number(raw) / 1000);
    }
    layout(env.windowInfo);
  }
  async function refresh() {
    if (version < 9490 || !tool || typeof tool.getWindowInfo !== 'function') return;
    const id = ++readId;
    try {
      const info = await tool.getWindowInfo();
      if (id === readId) layout(info);
    } catch (_) { /* Keep the last measured layout. */ }
  }
  function scheduleRead() {
    cancelAnimationFrame(nextRead);
    nextRead = requestAnimationFrame(refresh);
  }
  async function start() {
    readLaunch(host.launchOptions);
    if (!version && tool && typeof tool.getLaunchOptions === 'function') {
      try { readLaunch(await tool.getLaunchOptions()); } catch (_) { /* Use the in-page layout. */ }
    }
    if (version < 9490 || !tool || typeof tool.getWindowInfo !== 'function') return;
    scheduleRead();
    window.addEventListener('resize', scheduleRead);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleRead(); });
  }
  start();
}

// Offline riding renderer for devices that cannot draw the WebGL scene.
(function () {
  'use strict';
  var active;
  const places = { valley: '河谷草原', hemu: '禾木村', moon: '月亮湾', sayram: '赛里木湖' };
  const forecasts = { valley: 'steppe', hemu: 'mist', moon: 'day', sayram: 'snow' };
  const weather = {
    steppe: { name: '黄昏', sky: ['#526f82', '#f5d79d'], ridge: ['#aa9c8d', '#827f77'], snow: '#ffdfa3', land: ['#a69f6e', '#707d49'], tree: ['#505d43', '#354b3f'], water: '#aebba0' },
    day:    { name: '晴日', sky: ['#6c9abb', '#e3efe2'], ridge: ['#9faeb1', '#758e90'], snow: '#f0f0de', land: ['#a9af70', '#74854b'], tree: ['#637d54', '#3b604c'], water: '#6ca19b' },
    mist:   { name: '晨雾', sky: ['#a3b4be', '#f1e7d2'], ridge: ['#c1c1b7', '#a5b4ae'], snow: '#e9e5d6', land: ['#afb69c', '#748c72'], tree: ['#748c78', '#566f61'], water: '#b0c2ba' },
    rain:   { name: '雨天', sky: ['#55646f', '#a8b8b4'], ridge: ['#87969a', '#687e80'], snow: '#bdc5bf', land: ['#849077', '#546f54'], tree: ['#516a5b', '#384f48'], water: '#819e9d' },
    snow:   { name: '晴雪', sky: ['#83a6c0', '#e8edeb'], ridge: ['#afbec9', '#80939f'], snow: '#f3f2e7', land: ['#dce3dd', '#b9cbd4'], tree: ['#809b98', '#506d6a'], water: '#97c3d1' }
  };
  const speeds = [0, 1.7, 4.2, 7.8, 12.5];
  const gaits = ['驻足', '慢步', '小跑', '跑步', '疾跑'];
  function limit(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function known(table, key) { return Object.prototype.hasOwnProperty.call(table, key); }
  function seed(x, z) {
    let v = Math.imul(x, 1597334677) ^ Math.imul(z, 3812015801);
    v = Math.imul(v ^ (v >>> 16), 2246822507);
    return ((v ^ (v >>> 13)) >>> 0) / 4294967296;
  }
  function polygon(c, color, points) {
    c.fillStyle = color; c.beginPath(); c.moveTo(points[0], points[1]);
    for (let i = 2; i < points.length; i += 2) c.lineTo(points[i], points[i + 1]);
    c.closePath(); c.fill();
  }
  function oval(c, color, x, y, rx, ry, tilt) {
    c.beginPath(); c.ellipse(x, y, rx, ry, tilt || 0, 0, Math.PI * 2); c.fillStyle = color; c.fill();
  }

  function landscape(c, w, h, s, seconds) {
    const p = weather[s.scene], horizon = h * 0.44, rad = s.yaw;
    const gradient = c.createLinearGradient(0, 0, 0, horizon);
    gradient.addColorStop(0, p.sky[0]); gradient.addColorStop(1, p.sky[1]);
    c.fillStyle = gradient; c.fillRect(0, 0, w, horizon + 1);
    if (s.scene !== 'rain') {
      const sunX = w * (0.70 - Math.sin(rad) * 0.55);
      oval(c, s.scene === 'steppe' ? '#fcdea3' : '#f4f1d9', sunX, h * (s.scene === 'steppe' ? 0.28 : 0.17), w * 0.034, w * 0.034);
    }
    const peaks = [];
    for (let i = -1; i <= 33; i++) {
      const x = w * i / 32, a = rad + (i / 32 - 0.5) * 1.0;
      const jag = Math.abs(Math.sin(a * 9 + 0.8)) * 0.066 + Math.abs(Math.sin(a * 21)) * 0.021 + Math.abs(Math.sin(a * 43)) * 0.010;
      peaks.push([x, horizon - h * (0.022 + jag + 0.095 * (0.5 + 0.5 * Math.cos(a * 4.0 + 0.25)))]);
    }
    c.fillStyle = p.ridge[0]; c.beginPath(); c.moveTo(-w / 32, horizon + 2);
    for (const q of peaks) c.lineTo(q[0], q[1]);
    c.lineTo(w + w / 32, horizon + 2); c.fill();
    for (let i = 1; i < peaks.length - 1; i++) {
      const a = peaks[i - 1], b = peaks[i], d = peaks[i + 1];
      if (b[1] < Math.min(a[1], d[1]) && b[1] < horizon - h * 0.09) {
        polygon(c, p.snow, [a[0],a[1], b[0],b[1], d[0],d[1], b[0]+w*.011,b[1]+h*.015, b[0]-w*.003,b[1]+h*.034, b[0]-w*.013,b[1]+h*.014]);
      }
    }
    c.fillStyle = p.ridge[1]; c.beginPath(); c.moveTo(-1, horizon + 2);
    for (let i = 0; i <= 32; i++) {
      const a = rad + i / 32 - 0.5;
      c.lineTo(i * w / 32, horizon - h * (0.018 + 0.05 * Math.pow(Math.sin(4 * a - 0.8), 2) + 0.014 * Math.sin(14 * a)));
    }
    c.lineTo(w + 1, horizon + 2); c.fill();
    const ground = c.createLinearGradient(0, horizon, 0, h);
    ground.addColorStop(0, p.land[0]); ground.addColorStop(1, p.land[1]);
    c.fillStyle = ground; c.fillRect(0, horizon, w, h - horizon);

    // A river follows its own course through the world. Its banks move with the same camera as the trees.
    const sin = Math.sin(rad), cos = Math.cos(rad), focal = h * 0.66, eye = 3.4;
    const bank = z => 24 + 17 * Math.sin(z * 0.047) + 10 * Math.cos(z * 0.012);
    const riverWidth = s.place === 'sayram' ? 116 : s.place === 'moon' ? 22 : 9;
    const waterPoint = (side, z) => ({ x: bank(z) + side * riverWidth - s.x, z: z - s.z });
    const bankPoint = v => ({ side: v.x * cos - v.z * sin, depth: v.x * sin + v.z * cos });
    // Clip against the near plane before projection, including when facing back upstream.
    const clipFloor = 2.2;
    for (let z = Math.floor((s.z - 155) / 5) * 5; z < s.z + 155; z += 5) {
      const ring = [waterPoint(0,z),waterPoint(1,z),waterPoint(1,z+5),waterPoint(0,z+5)].map(bankPoint);
      const points = [];
      let last = ring[3];
      for (const v of ring) {
        if ((v.depth >= clipFloor) !== (last.depth >= clipFloor)) {
          const t = (clipFloor - last.depth) / (v.depth - last.depth);
          points.push(w * .5 + (last.side + t * (v.side - last.side)) * focal / clipFloor, horizon + eye * focal / clipFloor);
        }
        if (v.depth >= clipFloor) points.push(w * .5 + v.side * focal / v.depth, horizon + eye * focal / v.depth);
        last = v;
      }
      if (points.length >= 6) polygon(c, p.water, points);
    }
    // Reuse object locations as the rider crosses grid cells so the landscape never pops to a new arrangement.
    const step = 13, cx = Math.floor(s.x / step), cz = Math.floor(s.z / step), objects = [];
    for (let iz = cz - 8; iz <= cz + 8; iz++) for (let ix = cx - 8; ix <= cx + 8; ix++) {
      const r = seed(ix, iz), q = seed(iz + 73, ix - 11);
      const x = (ix + .1 + .8 * r) * step, z = (iz + .1 + .8 * q) * step;
      const dx = x - s.x, dz = z - s.z, depth = sin * dx + cos * dz;
      if (depth < 3.5 || depth > 102) continue;
      const scale = focal / depth, sx = w * .5 + (cos * dx - sin * dz) * scale;
      if (sx < -4 * scale || sx > w + 4 * scale) continue;
      const water = x > bank(z) && x < bank(z) + riverWidth, y = horizon + eye * scale;
      objects.push({ x: sx, y, scale, depth, r, q, water });
    }
    objects.sort((a, b) => b.depth - a.depth);
    for (const o of objects) {
      const k = o.scale, x = o.x, y = o.y;
      if (o.water) {
        c.fillStyle = s.scene === 'rain' ? '#b8c8bf' : '#c7dad3'; c.fillRect(x, y, k * (0.4 + 2 * o.q), Math.max(.6, k * .028)); continue;
      }
      const autumn = s.place === 'moon' && s.scene !== 'snow';
      if (s.place === 'hemu' && o.r > .59) {
        const size = k * (0.75 + o.q * .55);
        c.fillStyle = '#735e48'; c.fillRect(x-1.2*size,y-1.5*size,2.4*size,1.5*size);
        polygon(c, s.scene === 'snow' ? '#dde2d9' : '#645443', [x-1.6*size,y-1.4*size, x-.4*size,y-2.65*size, x+1.55*size,y-1.5*size]);
        c.fillStyle = '#d6bd88'; c.fillRect(x+.2*size,y-.95*size,.42*size,.5*size);
      } else if (o.r > (s.place === 'moon' ? .42 : s.place === 'sayram' ? .86 : .72)) {
        const ht = k * (2.3 + 1.9 * o.q);
        c.fillStyle = '#645d47'; c.fillRect(x-.024*ht, y-.7*ht, .05*ht,.7*ht);
        if (autumn) {
          oval(c, o.q > .5 ? '#c99651' : '#b2a255', x, y-.66*ht, ht*.20, ht*.40, .07);
          oval(c, '#deb15d', x-.055*ht, y-.70*ht, ht*.12, ht*.27, .05);
        } else {
          polygon(c,p.tree[1],[x,y-ht,x+.19*ht,y-.40*ht,x+.12*ht,y-.42*ht,x+.25*ht,y-.15*ht,x-.22*ht,y-.18*ht,x-.10*ht,y-.48*ht,x-.15*ht,y-.47*ht]);
          polygon(c,s.scene === 'snow' ? p.snow : p.tree[0],[x,y-ht,x-.18*ht,y-.40*ht,x-.045*ht,y-.5*ht,x+.008*ht,y-.44*ht]);
        }
      } else {
        const size = k * (.30 + o.q * .53);
        c.strokeStyle = s.scene === 'snow' ? '#9baba8' : '#677a50'; c.lineWidth = Math.max(.65, k*.039);
        c.beginPath(); c.moveTo(x-size*.52,y); c.lineTo(x-size*.85,y-size*.68);
        c.moveTo(x,y); c.lineTo(x+size*.18,y-size); c.moveTo(x+size*.3,y); c.lineTo(x+size*.7,y-size*.57); c.stroke();
      }
    }
    if (s.scene === 'snow' || s.scene === 'rain') {
      const snowing = s.scene === 'snow';
      c.fillStyle = 'rgba(250,251,242,.7)'; c.strokeStyle = 'rgba(208,224,222,.43)'; c.lineWidth = 1;
      if (!snowing) c.beginPath();
      for (let i = 0; i < 36; i++) {
        const dx = seed(i, 1), dy = seed(i, 2), x = ((dx * 2 + seconds * (snowing ? .023 : .075)) % 1) * w, y = ((dy + seconds * (snowing ? .055 : .66) * (.7 + dx)) % 1) * h;
        if (snowing) c.fillRect(x,y,1+dx,1+dx);
        else { c.moveTo(x,y); c.lineTo(x-3,y+12); }
      }
      if (!snowing) c.stroke();
    }
  }

  function horse(c, w, h, s) {
    const stride = s.phase, motion = Math.min(1, s.speed * .65);
    const beat = Math.sin(stride * 2) * 1.45 * motion, size = Math.min(w / 199, h / 390);
    c.save();
    c.translate(w * (.49 + .035 * s.steer), h * (s.started ? .728 : .606));
    c.scale(size, size);
    oval(c,'rgba(39,50,37,.22)',-2,23,32,5,0);
    c.translate(0,beat); c.rotate(s.steer * .035);
    // Each limb has its own footfall phase and bends its knee only on the return swing.
    function leg(x,y,phase,color) {
      const t = stride + phase, dx = Math.sin(t) * 8 * motion, lift = Math.max(0,Math.cos(t)) * 6 * motion;
      const kx = x + dx*.34 + 1, ky = y + 12 - lift*.34, fx = x + dx - 2, fy = y + 26 - lift - beat;
      c.lineCap='round'; c.strokeStyle=color; c.lineWidth=4.2; c.beginPath(); c.moveTo(x,y); c.quadraticCurveTo(kx+1,ky-3,kx,ky); c.lineTo(fx,fy); c.stroke();
      c.strokeStyle='#54564d'; c.lineWidth=3.4; c.beginPath(); c.moveTo(fx,fy-1); c.lineTo(fx+2.5,fy+1); c.stroke();
    }
    leg(-11,-5,Math.PI,'#979c90'); leg(20,-7,0,'#a4a799');
    // Tail, rump and the arched neck form a continuous silhouette.
    c.fillStyle='#c3c3ae'; c.beginPath(); c.moveTo(-20,-15); c.bezierCurveTo(-34,-14,-26,5,-39+motion*Math.sin(stride)*3,13); c.bezierCurveTo(-20,11,-21,-2,-17,-10); c.fill();
    leg(-17,-2,0,'#d5d5bf'); leg(13,-4,Math.PI,'#e6e2ce');
    c.fillStyle='#e8e4cd'; c.beginPath(); c.moveTo(-26,-8);
    c.bezierCurveTo(-29,-22,-16,-26,-4,-21); c.bezierCurveTo(8,-20,13,-21,17,-33);
    c.bezierCurveTo(18,-39,17,-45,25,-47); c.lineTo(29,-45); c.lineTo(34,-40);
    c.lineTo(40,-34); c.quadraticCurveTo(40,-29,35,-30); c.lineTo(27,-34);
    c.bezierCurveTo(24,-27,26,-18,20,-10); c.bezierCurveTo(10,0,0,2,-12,-2); c.bezierCurveTo(-19,2,-24,-3,-26,-8); c.fill();
    polygon(c,'#e3dfc9',[22,-45,20,-55,25,-50,26,-45,27,-47,29,-54,30,-49,28,-44]);
    c.fillStyle='#c1c2ad'; c.beginPath(); c.moveTo(23,-47); c.bezierCurveTo(18,-49,20,-33,10,-26); c.lineTo(14,-23); c.quadraticCurveTo(21,-34,23,-47); c.fill();
    c.strokeStyle='#695543'; c.lineWidth=.85; c.beginPath(); c.moveTo(27,-44); c.lineTo(32,-34); c.lineTo(38,-31); c.moveTo(34,-38); c.lineTo(31,-34); c.stroke();
    oval(c,'#4c4c40',29.5,-41.5,1,1,0);
    // A rust-red saddle blanket reads distinctly even on the snowy route.
    polygon(c,'#994f39',[-13,-21,10,-21,7,-8,-14,-10]);
    polygon(c,'#644536',[-12,-22,9,-23,10,-19,-12,-17]);
    c.save(); c.translate(0,-motion*Math.max(0,Math.sin(stride*2))*1.1);
    polygon(c,'#354950',[-6,-38,2,-39,7,-33,8,-22,3,-18,-7,-22]);
    polygon(c,'#334143',[-4,-22,4,-22,10,-17,8,-7,4,-7,4,-15,-5,-17]);
    polygon(c,'#594335',[4,-9,9,-9,10,-5,6,-5]);
    oval(c,'#a47e61',-1,-43,3.6,4.8,-.12);
    oval(c,'#69563f',-1.8,-46.7,5.7,1.4,-.06); oval(c,'#79654a',-1.7,-48,3.1,2.4,-.12);
    c.strokeStyle='#43565b'; c.lineWidth=3; c.beginPath(); c.moveTo(1,-36); c.lineTo(7,-30); c.lineTo(14,-32); c.stroke();
    c.strokeStyle='#775d43'; c.lineWidth=.7; c.beginPath(); c.moveTo(14,-32); c.quadraticCurveTo(25,-27,33,-34); c.stroke();
    c.restore(); c.restore();
  }

  window.startLightRide = function startLightRide(saved) {
    const stage = document.getElementById('stage');
    const canvas = stage.querySelector('#c');
    if (active && active.canvas === canvas) return active;
    if (active) active.stop();
    const c = canvas.getContext('2d', { alpha: false });
    if (!c) throw new Error('当前设备无法创建轻量骑行画布');
    saved = saved || {};
    const place = known(places, saved.place) ? saved.place : 'valley';
    const level = Number.isFinite(saved.level) ? limit(Math.round(saved.level), 0, 4) : 0;
    const moving = Number.isFinite(saved.speed) ? saved.speed : saved.v;
    const s = {
      started: !!saved.started, level, speed: saved.started ? limit(Number.isFinite(moving) ? moving : speeds[level], 0, 22) : 0, dist: Math.max(0, Number(saved.dist) || 0),
      place, scene: known(weather, saved.scene) ? saved.scene : forecasts[place], yaw: Number.isFinite(saved.yaw) ? saved.yaw : (Number(saved.heading) || 0),
      x: place === 'sayram' ? 24 : 0, z: 0, steer: 0, phase: 0, sprint: !!saved.sprint && level === 4, muted: saved.muted === undefined ? saved.sound === false : !!saved.muted
    };
    const el = {};
    for (const id of ['title','hud','goText','places','scenes','menuToggle','options','closeOptions','bPlace','bScene','bView','bSound','tFast','tSlow','hint','toast','err','gait']) el[id] = stage.querySelector('#' + id);
    const speedText = stage.querySelector('#speed b'), distText = stage.querySelector('#dist b');
    const fastText = el.tFast.querySelector('[data-label]') || el.tFast;
    const dispose = [];
    let stopped = false;
    function on(node, name, callback, capture) {
      node.addEventListener(name, callback, !!capture);
      dispose.push(() => node.removeEventListener(name, callback, !!capture));
    }
    let w = 1, h = 1, dpr = 1, raf = 0, last = 0, seconds = 0, hintTimer = 0;
    let targetSteer = 0, pointer = null, downX = 0, audio = null, hoofPhase = 0;
    const Audio = window.AudioContext || window.webkitAudioContext;
    const placeKeys = Object.keys(places), sceneKeys = Object.keys(weather);
    function hud() {
      const currentSpeed = String(Math.round(s.speed * 3.6)), distance = (s.dist / 1000).toFixed(1);
      const gait = s.speed < .25 ? gaits[0] : s.sprint ? '疾驰' : gaits[s.level || 1];
      if (speedText.textContent !== currentSpeed) speedText.textContent = currentSpeed;
      if (distText.textContent !== distance) distText.textContent = distance;
      if (el.gait.textContent !== gait) el.gait.textContent = gait;
      const action = s.level < 4 ? '加速' : s.sprint ? '收速' : '冲刺';
      if (fastText.textContent !== action) fastText.textContent = action;
      el.tSlow.disabled = !s.level;
    }
    function selected() {
      for (const group of [el.places, el.scenes]) {
        const key = group === el.places ? s.place : s.scene;
        for (let i = 0; i < group.children.length; i++) {
          const b = group.children[i], pressed = b.value === key;
          b.classList.toggle('on', pressed); b.setAttribute('aria-pressed', String(pressed));
        }
      }
      el.bPlace.querySelector('[data-value]').textContent = places[s.place];
      el.bScene.querySelector('[data-value]').textContent = weather[s.scene].name;
      el.bSound.querySelector('[data-value]').textContent = s.muted ? '关' : '开';
    }
    function audioGesture() {
      if (!Audio || s.muted || !s.started) return;
      try {
        if (!audio) audio = new Audio();
        if (audio.state === 'suspended') audio.resume().catch(function () {});
      } catch (_) { el.bSound.hidden = true; s.muted = true; }
    }
    function hoof() {
      if (s.muted || !audio || audio.state !== 'running') return;
      const start = audio.currentTime, osc = audio.createOscillator(), gain = audio.createGain();
      osc.frequency.setValueAtTime(103, start); osc.frequency.exponentialRampToValueAtTime(49, start + .095);
      gain.gain.setValueAtTime(.0001, start); gain.gain.exponentialRampToValueAtTime(.062, start + .006);
      gain.gain.exponentialRampToValueAtTime(.0001, start + .12);
      osc.connect(gain); gain.connect(audio.destination); osc.start(); osc.stop(start + .13);
      osc.onended = function () { osc.disconnect(); gain.disconnect(); };
    }
    function draw() {
      c.setTransform(dpr,0,0,dpr,0,0);
      landscape(c,w,h,s,seconds); horse(c,w,h,s);
    }
    function resize() {
      w = Math.max(1,canvas.clientWidth); h = Math.max(1,canvas.clientHeight);
      dpr = Math.min(window.devicePixelRatio || 1, 1.25, Math.sqrt(720000 / (w*h)));
      canvas.width = Math.max(1,Math.round(w*dpr)); canvas.height = Math.max(1,Math.round(h*dpr));
      draw();
    }
    function frame(now) {
      raf = 0;
      if (document.hidden || !s.started) return;
      const elapsed = now - last;
      if (elapsed >= 31) {
        const dt = Math.min(.1,elapsed / 1000); last = now;
        const goal = s.sprint ? 16.5 : speeds[s.level];
        s.speed += limit(goal - s.speed, -5 * dt, 3.4 * dt);
        s.steer += (targetSteer - s.steer) * (1 - Math.exp(-7 * dt));
        s.yaw += s.steer * dt * (.70 - s.speed * .016) * Math.min(1,s.speed);
        const travel = s.speed * dt;
        s.x += Math.sin(s.yaw) * travel; s.z += Math.cos(s.yaw) * travel; s.dist += travel;
        if (s.speed > .05) s.phase += dt * (2.7 + .67 * s.speed);
        const beat = Math.floor(s.phase / Math.PI);
        if (beat !== hoofPhase) { hoofPhase = beat; hoof(); }
        seconds += dt; draw(); hud();
      }
      if (s.level || s.sprint || s.speed > .01 || Math.abs(s.steer-targetSteer) > .015) raf = requestAnimationFrame(frame);
    }
    function wake() {
      if (!document.hidden && s.started && !raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
    }
    function setMenu(open) {
      el.options.hidden = !open; el.menuToggle.setAttribute('aria-expanded', String(open));
      if (open) { targetSteer = 0; pointer = null; el.closeOptions.focus(); } else el.menuToggle.focus();
    }
    function hint(text) {
      clearTimeout(hintTimer); el.hint.textContent = text; el.hint.classList.add('on');
      hintTimer = setTimeout(() => el.hint.classList.remove('on'), 4600);
    }
    function setLocation(key) {
      s.place = key; s.scene = forecasts[key]; s.x = key === 'sayram' ? 24 : 0; s.z = 0;
      s.yaw = key === 'sayram' ? .29 : 0; s.dist = 0;
      if (s.started) { s.level = 1; s.speed = 0; s.sprint = false; }
      selected(); hud(); draw(); wake();
    }
    function setWeather(key) { s.scene = key; selected(); draw(); }
    function choices(group, keys, caption, select) {
      group.textContent = '';
      for (const key of keys) {
        const b = document.createElement('button'); b.type = 'button'; b.value = key; b.textContent = caption(key);
        on(b,'click',() => select(key)); group.appendChild(b);
      }
    }
    function next(keys,key) { return keys[(keys.indexOf(key) + 1) % keys.length]; }
    function resetPointer() { pointer = null; targetSteer = 0; wake(); }
    choices(el.places,placeKeys,key => places[key],setLocation);
    choices(el.scenes,sceneKeys,key => weather[key].name,setWeather);
    el.err.style.display = 'none'; el.bView.hidden = true; el.bSound.hidden = !Audio;
    el.options.hidden = true; el.menuToggle.setAttribute('aria-expanded','false');
    el.toast.classList.remove('on'); el.goText.disabled = false; el.goText.textContent = '上马出发';
    el.title.hidden = s.started; el.hud.hidden = !s.started;
    on(el.goText,'click',() => {
      if (s.started) return;
      s.started = true; s.level = s.place === 'valley' ? 3 : 1;
      el.title.hidden = true; el.hud.hidden = false; canvas.tabIndex = -1; canvas.focus();
      hint('左右拖动转向，点右下角调速'); audioGesture(); hud(); draw(); wake();
    });
    on(el.tFast,'click',() => {
      if (s.level === 4) s.sprint = !s.sprint; else s.level++;
      audioGesture(); hud(); wake();
    });
    on(el.tSlow,'click',() => { s.level = Math.max(0,s.level-1); s.sprint = false; audioGesture(); hud(); wake(); });
    on(el.menuToggle,'click',() => setMenu(el.options.hidden)); on(el.closeOptions,'click',() => setMenu(false));
    on(el.bPlace,'click',() => setLocation(next(placeKeys,s.place)));
    on(el.bScene,'click',() => setWeather(next(sceneKeys,s.scene)));
    on(el.bSound,'click',() => { s.muted = !s.muted; if (!s.muted) audioGesture(); selected(); });
    on(stage,'click',e => {
      if (!el.options.hidden && !el.options.contains(e.target) && !el.menuToggle.contains(e.target)) {
        e.preventDefault(); e.stopPropagation(); setMenu(false);
      }
    },true);
    on(stage,'keydown',e => { if (!el.options.hidden && e.key === 'Escape') { e.preventDefault(); setMenu(false); } });
    on(canvas,'pointerdown',e => {
      if (!s.started || !el.options.hidden || pointer !== null || e.button !== 0) return;
      pointer = e.pointerId; downX = e.clientX; audioGesture();
      if (canvas.setPointerCapture) { try { canvas.setPointerCapture(pointer); } catch (_) {} }
    });
    on(canvas,'pointermove',e => {
      if (e.pointerId !== pointer) return;
      targetSteer = limit((e.clientX - downX) / limit(w*.20,52,92),-1,1); wake();
    });
    for (const type of ['pointerup','pointercancel','lostpointercapture']) on(canvas,type,e => { if (e.pointerId === pointer) resetPointer(); });
    on(window,'blur',resetPointer);
    on(window,'resize',resize);
    on(document,'visibilitychange',() => {
      if (document.hidden) {
        pointer = null; targetSteer = 0; cancelAnimationFrame(raf); raf = 0;
        if (audio && audio.state === 'running') audio.suspend().catch(function () {});
      } else {
        if (audio && !s.muted) audio.resume().catch(function () {});
        wake();
      }
    });
    document.documentElement.classList.add('scene-ready');
    canvas.setAttribute('aria-label','轻量骑行画面'); stage.setAttribute('data-renderer','canvas2d');
    selected(); hud(); resize(); wake();
    active = {
      stage, canvas,
      state: () => ({ started:s.started, dist:s.dist, level:s.level, v:s.speed, speed:s.speed, sprint:s.sprint, view:0, place:s.place, scene:s.scene, yaw:s.yaw, muted:s.muted }),
      stop: function () {
        if (stopped) return;
        stopped = true;
        cancelAnimationFrame(raf); clearTimeout(hintTimer);
        for (const off of dispose) off();
        if (audio && audio.state !== 'closed') audio.close().catch(function () {});
        if (active && active.canvas === canvas) active = null;
      }
    };
    return active;
  };
})();

// The 3D engine and its Canvas 2D fallback share the stage, but never a canvas or event loop.
function runWindhoofMiniTool(start3D) {
  const stage = document.getElementById('stage');
  const original = document.createDocumentFragment();
  for (let i = 0; i < stage.children.length; i++) original.appendChild(stage.children[i].cloneNode(true));
  initPortraitWindow();

  const removeListeners = [];
  let active = true, pageHidden = false, paused = document.hidden;
  let pending = null, frameId = 0;
  let seconds = 0, frames = 0, lateFrames = 0, slowWindows = 0;

  function clearSamples() { seconds = 0; frames = 0; lateFrames = 0; slowWindows = 0; }
  function listen(target, name, fn, options) {
    target.addEventListener(name, fn, options);
    removeListeners.push(() => target.removeEventListener(name, fn, options));
  }
  function schedule() {
    if (active && !paused && !frameId && pending) frameId = requestAnimationFrame(runFrame);
  }
  function runFrame(now) {
    frameId = 0;
    if (paused || !active || !pending) return;
    const next = pending;
    pending = null;
    try { next(now); } catch (error) { useLight(error); }
  }
  function syncVisibility() {
    const hidden = pageHidden || document.hidden;
    if (hidden === paused) return;
    paused = hidden;
    clearSamples();
    if (frameId) cancelAnimationFrame(frameId);
    frameId = 0;
    if (session.visibility) session.visibility(hidden);
    schedule();
  }
  function useLight(reason) {
    if (!active) return;
    active = false;
    if (frameId) cancelAnimationFrame(frameId);
    frameId = 0;
    pending = null;
    for (const off of removeListeners) off();
    let state = {};
    try { if (session.snapshot) state = session.snapshot(); }
    catch (error) { console.warn('Windhoof could not read the previous ride', error); }
    try { if (session.release) session.release(); }
    catch (error) { console.warn('Windhoof could not release the previous renderer', error); }
    // Rendering and UI setup may have stopped halfway. Restore the original children and keep stage's host safe area.
    window.__ride = undefined;
    stage.textContent = '';
    stage.appendChild(original);
    document.documentElement.classList.remove('scene-ready');
    try {
      const light = window.startLightRide(state);
      light.ready = true;
      window.__ride = light;
      document.documentElement.dataset.renderer = 'canvas2d';
    } catch (error) {
      console.error('Windhoof light renderer', error);
      const alert = document.getElementById('err');
      alert.textContent = '画面暂时无法显示，请关闭后重新打开。';
      alert.style.display = 'flex';
    }
    if (reason) console.warn('Windhoof switched to light riding:', reason);
  }
  const session = {
    listen,
    frame(fn) { if (active) { pending = fn; schedule(); } },
    // After all quality reductions, require two consecutive foreground windows with a majority of frames below 24 fps.
    sample(dt, atFloor) {
      if (!atFloor) { clearSamples(); return false; }
      seconds += dt;
      frames++;
      if (dt > 1 / 24) lateFrames++;
      if (seconds < 1 || frames < 4) return false;
      slowWindows = lateFrames > frames / 2 ? slowWindows + 1 : 0;
      frames = 0; seconds = 0; lateFrames = 0;
      if (slowWindows < 2) return false;
      useLight('low frame rate at minimum quality');
      return true;
    },
  };
  listen(document, 'visibilitychange', syncVisibility);
  listen(window, 'pagehide', () => { pageHidden = true; syncVisibility(); });
  listen(window, 'pageshow', () => { pageHidden = false; syncVisibility(); });
  listen(document.getElementById('c'), 'webglcontextlost', () => useLight('WebGL context lost'));
  stage.dataset.renderer = document.documentElement.dataset.renderer = 'webgl2';
  try { start3D(session); } catch (error) { useLight(error); }
}

function startWindhoof3D(miniToolSession) {
// ======== 00_util.js
'use strict';
const rideSession = typeof miniToolSession === 'undefined' ? null : miniToolSession;
function listenRideGlobal(target, name, listener, options) {
  if (rideSession) rideSession.listen(target, name, listener, options);
  else target.addEventListener(name, listener, options);
}
// ---------------------------------------------------------------- small maths
const TAU = Math.PI * 2, D2R = Math.PI / 180;
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const sat = x => x < 0 ? 0 : x > 1 ? 1 : x;
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = sat((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const frac = x => x - Math.floor(x);
// frame-rate independent approach of cur to tgt
const damp = (cur, tgt, rate, dt) => tgt + (cur - tgt) * Math.exp(-rate * dt);
const wrapPi = a => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const v3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  mad: (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: a => Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]),
  norm: a => { const l = Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
};

// 4x4 matrices, column major (as WebGL wants them)
const m4 = {
  perspective(fovy, aspect, n, f) {
    const t = 1 / Math.tan(fovy / 2), o = new Float32Array(16);
    o[0] = t / aspect; o[5] = t; o[10] = (f + n) / (n - f); o[11] = -1; o[14] = 2 * f * n / (n - f);
    return o;
  },
  ortho(l, r, b, t, n, f) {
    const o = new Float32Array(16);
    o[0] = 2 / (r - l); o[5] = 2 / (t - b); o[10] = -2 / (f - n);
    o[12] = -(r + l) / (r - l); o[13] = -(t + b) / (t - b); o[14] = -(f + n) / (f - n); o[15] = 1;
    return o;
  },
  lookAt(e, tg, up) {
    const z = v3.norm(v3.sub(e, tg)), x = v3.norm(v3.cross(up, z)), y = v3.cross(z, x), o = new Float32Array(16);
    o[0] = x[0]; o[1] = y[0]; o[2] = z[0];
    o[4] = x[1]; o[5] = y[1]; o[6] = z[1];
    o[8] = x[2]; o[9] = y[2]; o[10] = z[2];
    o[12] = -v3.dot(x, e); o[13] = -v3.dot(y, e); o[14] = -v3.dot(z, e); o[15] = 1;
    return o;
  },
  mul(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++)
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    return o;
  },
};

const QS = new URLSearchParams(location.search);
const qnum = (k, d) => QS.has(k) && isFinite(+QS.get(k)) ? +QS.get(k) : d;

// ======== 01_gl.js
// ---------------------------------------------------------------- WebGL2 layer
const canvas = document.getElementById('c');
const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance' });
if (!gl) {
  const e = document.getElementById('err'); e.style.display = 'flex';
  e.textContent = '这个浏览器不支持 WebGL2，换一个新一点的 Chrome、Edge 或 Safari 再打开。';
  throw new Error('no webgl2');
}
const HAS_FLOAT = !!gl.getExtension('EXT_color_buffer_float');
gl.getExtension('OES_texture_float_linear');

// tf: names of vertex outputs to capture with transform feedback (interleaved), if any
function program(vs, fs, name, tf) {
  const head = '#version 300 es\nprecision highp float;\nprecision highp int;\nprecision highp sampler2DShadow;\n';
  const mk = (type, src) => {
    const s = gl.createShader(type); gl.shaderSource(s, head + src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s);
      const lines = (head + src).split('\n').map((l, i) => (i + 1) + ': ' + l);
      const bad = [], pattern = /ERROR: \d+:(\d+)/g;
      let hit;
      while (bad.length < 4 && (hit = pattern.exec(log))) bad.push(Number(hit[1]));
      const near = bad.map(n => lines.slice(Math.max(0, n - 3), n + 1).join('\n')).join('\n...\n');
      console.error('shader ' + name + (type === gl.VERTEX_SHADER ? ' (vs)' : ' (fs)') + '\n' + log + '\n' + near);
      throw new Error('shader ' + name + ': ' + log);
    }
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
  if (tf) gl.transformFeedbackVaryings(p, tf, gl.INTERLEAVED_ATTRIBS);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link ' + name + ': ' + gl.getProgramInfoLog(p));
  const cache = {};
  return {
    p, name,
    use() { gl.useProgram(p); return this; },
    u(n) { return n in cache ? cache[n] : (cache[n] = gl.getUniformLocation(p, n)); },
    f1(n, x) { gl.uniform1f(this.u(n), x); }, f2(n, x, y) { gl.uniform2f(this.u(n), x, y); },
    f3(n, v) { gl.uniform3f(this.u(n), v[0], v[1], v[2]); }, f4(n, x, y, z, w) { gl.uniform4f(this.u(n), x, y, z, w); },
    i1(n, x) { gl.uniform1i(this.u(n), x); }, m4(n, m) { gl.uniformMatrix4fv(this.u(n), false, m); },
  };
}

function makeTex(w, h, ifmt, fmt, type, filter, wrap) {
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, fmt, type, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap || gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap || gl.CLAMP_TO_EDGE);
  return t;
}
// a colour target (half float when the browser can render to it)
function makeTarget(w, h) {
  const tex = HAS_FLOAT ? makeTex(w, h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR) : makeTex(w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR);
  const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  return { fb, tex, w, h };
}
// the multisampled scene buffer (colour + depth)
function makeScene(w, h, samples) {
  const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  const col = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, col);
  gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, HAS_FLOAT ? gl.RGBA16F : gl.RGBA8, w, h);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, col);
  const dep = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, dep);
  gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, w, h);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, dep);
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  return { fb, col, dep, w, h, ok };
}
function freeScene(s) { if (!s) return; gl.deleteFramebuffer(s.fb); gl.deleteRenderbuffer(s.col); gl.deleteRenderbuffer(s.dep); }
function freeTarget(t) { if (!t) return; gl.deleteFramebuffer(t.fb); gl.deleteTexture(t.tex); }

// depth-only target for the shadow of horse and rider
function makeShadow(size) {
  const tex = makeTex(size, size, gl.DEPTH_COMPONENT24, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
  const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, tex, 0);
  gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE);
  return { fb, tex, size };
}

// one triangle that covers the screen, no buffers needed
const emptyVAO = gl.createVertexArray();
const VS_FULL = `
out vec2 vUv;
void main(){ vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); vUv = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;
function drawFull() { gl.bindVertexArray(emptyVAO); gl.drawArrays(gl.TRIANGLES, 0, 3); }

// ======== 02_world.js
// ---------------------------------------------------------------- the land, the wind and the air: one definition, used by JS and by every shader
// The country is a broad grass valley running east-west (along x). A river winds down the middle of it, crossing and recrossing the way;
// low ridges lie across the valley floor, so riding along it is up and over and down to the next ford. The walls rise on either side,
// the shaded one (toward -z) dark with spruce, the sunny one open; beyond them stand the snow mountains.
// Along it lie three places: a village of log houses on a terrace by the river (XH), a great S-bend of the river between steep wooded
// banks (XM), and at the end of the valley a lake (XL).
// Everything here exists twice, in JS and in GLSL. Keep the two in step.

const WATER = -0.30;                      // the surface of the river and the lake; their banks meet the land at 0
const XH = 5560, XM = 10400, XL = 17200, LAKE_A = 3800, LAKE_B = 2900, LAKE_S = 3170;      // the lake: 7.6 km long, 5.8 km across
const bell = t => { t = Math.abs(t); if (t >= 1) return 0; const u = 1 - t * t; return u * u; };
const dbell = t => Math.abs(t) >= 1 ? 0 : -4 * t * (1 - t * t);
function riverBase(x) { return 150 * Math.sin(x * 0.0042 + 0.6) + 85 * Math.sin(x * 0.0101 + 2.1) + 210 * Math.sin(x * 0.00105 + 4.0) - 20; }
function riverBaseD(x) { return 0.63 * Math.cos(x * 0.0042 + 0.6) + 0.8585 * Math.cos(x * 0.0101 + 2.1) + 0.2205 * Math.cos(x * 0.00105 + 4.0); }
// the middle of the river. At the bend (XM) its own wandering is stilled and one clean S is laid in
function riverZ(x) { const b = bell((x - XM) / 520); return riverBase(x) * (1 - 0.85 * b) + 250 * b * Math.sin((x - XM) * 0.0090); }
function riverDZ(x) {
  const t = (x - XM) / 520, b = bell(t), db = dbell(t) / 520, s = (x - XM) * 0.0090;
  return riverBaseD(x) * (1 - 0.85 * b) - 0.85 * riverBase(x) * db + 250 * (db * Math.sin(s) + b * 0.0090 * Math.cos(s));
}
function riverW(x) { return 1 + 1.4 * bell((x - XM) / 520); }                       // it runs wide at the bend
// how far (x, z) is from the middle of the river, signed (+ toward +z), in units of its own width: the water's edge is at 10
function riverS(x, z) { const s = riverDZ(x); return (z - riverZ(x)) / Math.sqrt(1 + s * s) / riverW(x); }
function riverD(x, z) { return Math.abs(riverS(x, z)); }
// how far across the valley: negative toward the shaded wall
function valleyZ(x, z) { return z + 160 * Math.sin(x * 0.00083 + 1.0); }
// metres outside the shore of the lake (negative on the water)
function lakeD(x, z) {
  if (Math.abs(x - XL) > LAKE_A + 1000) return 9999;
  const ex = (x - XL) / LAKE_A, ez = z / LAKE_B;
  return (Math.sqrt(ex * ex + ez * ez) - 1) * LAKE_S + 55 * Math.sin(x * 0.0040 + z * 0.0030) + 30 * Math.sin(z * 0.0110 - x * 0.0060);
}
// a rise above the western shore, from which the whole lake lies open
const SK = (() => { let x = XL - LAKE_A - 900; while (lakeD(x, 160) > 0 && x < XL) x += 3; return [x - 250, 160]; })();
const ZH = riverZ(XH) + 270;                                                         // the village stands back from the river on the sunny side
function villageAt(x, z) { return bell((x - XH) / 560) * bell((z - ZH) / 320); }
// two bars of sand on the inside of the bends
function barH(x, s) { const u = x - XM; return 1.15 * (bell((u + 175) / 75) * bell((s - 4.6) / 4.2) + bell((u - 175) / 75) * bell((s + 4.6) / 4.2)); }

function terrainHraw(x, z) {
  const qx = x + Math.sin(z * 0.0031) * 46.0, qz = z + Math.cos(x * 0.0027) * 46.0;
  let h = 16.0 * Math.sin(qx * 0.0021 + 0.6) * Math.cos(qz * 0.0018 - 0.4);
  h += 8.0 * Math.sin(qx * 0.0057 + 1.3) * Math.cos(qz * 0.0049 - 0.7);
  h += 4.2 * Math.sin(qx * 0.0123 - qz * 0.0091 + 2.1);
  h += 2.2 * Math.sin(qx * 0.0210 + qz * 0.0270 + 0.5);
  h += 0.9 * Math.sin(qx * 0.0470 - 0.3) * Math.sin(qz * 0.0410 + 1.9);
  h += 0.28 * Math.sin(qx * 0.110 + qz * 0.090 + 4.0);
  h = h * 0.55 + 12.0;                                                   // the valley floor: gentle, and a little above the river
  const rg = Math.max(0, Math.sin(x * 0.0058 + 1.1 * Math.sin(z * 0.0016) + 2.0));
  h += 46.0 * rg * rg * (1 - 0.8 * bell((x - XH) / 820));                 // ridges across it: a climb and a descent every kilometre (but not through the village)
  h = lerp(h, 5.0, 0.85 * villageAt(x, z));                              // the terrace the village stands on
  h += 70.0 * bell(Math.hypot(x - (XH + 100), z - (ZH + 345)) / 230);    // and the knoll beside it, to look down from
  const bM = bell((x - XM) / 900), dl = lakeD(x, z);
  // the walls, cut into spurs and side valleys; at the bend they close in steeply, round the lake they stand back
  const wall = smooth(lerp(480, 130, bM), lerp(2500, 950, bM), Math.abs(valleyZ(x, z))) * smooth(60, 900, dl);
  h += wall * (70.0 + 340.0 * wall) * (0.60 + 0.40 * Math.sin(qx * 0.0019 + 1.7 * Math.sin(qz * 0.0012)));
  const s = riverS(x, z), d = Math.abs(s), w = riverW(x), e0 = 13 * w + 11;
  h *= smooth(e0, e0 + lerp(146, 70, bM), d * w);                        // the land eases down to the river
  h -= 0.95 * (1 - smooth(5, 13, d));                                    // its bed
  if (Math.abs(x - XM) < 260) h += barH(x, s);
  if (dl < 420) h = lerp(WATER + (dl > 0 ? dl * 0.035 : Math.max(dl * 0.045, -14)), h, smooth(40, 420, dl));     // the lake: a shelving beach, then deep
  h += 46.0 * bell(Math.hypot(x - SK[0], z - SK[1]) / 240);                 // the rise above the lake's western shore
  const kb = 1 - smooth(0.35, 1.0, Math.hypot(x - MB[0], z - MB[1]) / 10); if (kb > 0) h = lerp(h, MB[2], kb);      // a small level ledge cut into the hillside above the bend: room for a horse to stand, and no more, or it would hide the river
  return h;
}
// is there water standing over land of height h at (x, z)?
function wetAt(x, z, h) { return Bridge.h(x, z) < -1e8 && h < WATER && (riverD(x, z) < 13 || lakeD(x, z) < 8); }
// in the depth of winter the lake is frozen hard enough to ride on (the river still runs)
// The lanes and buildings of the village, painted once into a small map (by Village): red is how near a lane is, green how near
// a building. The ground, the grass, the trees and the snow all read it, here and in the shaders.
const RoadMap = { X0: XH - 470, Z0: ZH - 420, SPAN: 940, N: 448, data: null,
  at(x, z, ch) {
    const D = this.data; if (!D) return 0;
    const N = this.N, u = (x - this.X0) / this.SPAN * N - 0.5, v = (z - this.Z0) / this.SPAN * N - 0.5;
    if (u < 0 || v < 0 || u >= N - 1 || v >= N - 1) return 0;
    const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j, o = (j * N + i) * 4 + ch;
    return ((D[o] * (1 - fu) + D[o + 4] * fu) * (1 - fv) + (D[o + N * 4] * (1 - fu) + D[o + N * 4 + 4] * fu) * fv) / 255;
  } };
// the bridge where the lane goes down to the river (built by Village): the height of its deck under (x, z), or -1e9 off it
const Bridge = { on: false, x: 0, z: 0, tx: 1, tz: 0, L: 0, ramp: 0, w: 0, y: 0,
  h(x, z) {
    if (!this.on) return -1e9;
    const dx = x - this.x, dz = z - this.z, l = dx * this.tx + dz * this.tz, sd = -dx * this.tz + dz * this.tx, al = Math.abs(l);
    if (Math.abs(sd) > this.w || al > this.L + this.ramp) return -1e9;
    if (al <= this.L) return this.y;
    const e = l < 0 ? -1 : 1, ge = terrainH(this.x + this.tx * e * (this.L + this.ramp), this.z + this.tz * e * (this.L + this.ramp));
    return Math.max(terrainH(x, z), lerp(this.y, ge, (al - this.L) / this.ramp));
  } };
function iceAt(x, z) { return G.env3[3] > 0.5 && lakeD(x, z) < 8 && terrainH(x, z) < WATER; }
// what the horse stands on: the land, the bed of the water it wades, or the ice
function rideH(x, z) { const b = Bridge.h(x, z); if (b > -1e8) return b; const h = terrainH(x, z); return h < WATER && G.env3[3] > 0.5 && lakeD(x, z) < 8 ? WATER : h; }
// what there is to stand on or look across: the land, or the water where river and lake lie
function groundY(x, z) { const h = terrainH(x, z); return wetAt(x, z, h) ? WATER : h; }

// two places to look from: on the hillside above the village, and high on the bank above the bend. No trees stand in the way of the view.
function climbTo(x, z0, target) { let z = z0; for (let i = 0; i < 500 && terrainHraw(x, z) < target; i++) z += 3; return z; }
// Above the village: on the knoll's flank. Above the bend: high on the hillside straight north of where the river swings nearest,
// so that the S it makes lies below. (MB could be a levelled ledge there; it is left unset, because standing level hides the river
// behind the brow of the slope, and standing on the slope tips the view down onto it)
let MB = [1e9, 1e9, 0];
const VH = [XH + 58, ZH + 216], CH = [XH - 10, ZH], VM = [XM + 175, 0], BM = [XM + 175, 0];
function segD(x, z, a, b) { const px = x - a[0], pz = z - a[1], bx = b[0] - a[0], bz = b[1] - a[1], t = sat((px * bx + pz * bz) / (bx * bx + bz * bz)); return Math.hypot(px - bx * t, pz - bz * t); }
function clearAt(x, z) { return smooth(40, 100, segD(x, z, VM, BM)) * smooth(40, 120, segD(x, z, VH, CH)); }
const terrainH = terrainHraw;
VM[1] = climbTo(VM[0], riverZ(VM[0]) + 150, 185);
{ const tx = XM - 20 - VM[0], tz = 60 - VM[1], l = Math.hypot(tx, tz); BM[0] = VM[0] + tx / l * 250; BM[1] = VM[1] + tz / l * 250; }      // the look is toward the middle of the S


// the same value noise the shaders use, so JS can ask what lies under a hoof
function hash21(x, y) {
  let h = (Math.imul(Math.floor(x) | 0, 374761393) + Math.imul(Math.floor(y) | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}
function vnoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y); let fx = x - ix, fy = y - iy; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = hash21(ix, iy), b = hash21(ix + 1, iy), c = hash21(ix, iy + 1), d = hash21(ix + 1, iy + 1);
  return lerp(lerp(a, b, fx), lerp(c, d, fx), fy);
}
function snowAt(x, z) {
  const k = G.env[1]; if (k < 0.002) return 0;
  const n = vnoise(x * 0.026 + 70, z * 0.026 + 70) * 0.55 + vnoise(x * 0.090 + 13, z * 0.090 + 13) * 0.30 + vnoise(x * 0.41, z * 0.41) * 0.15, th = 0.66 - k * 1.5;
  return smooth(th, th + 0.07, n) * smooth(10.5, 14, riverD(x, z)) * smooth(0.5, 5, lakeD(x, z));
}
// how deep it lies, in metres: drifted, shallow where the lanes are trodden. As snowDepthS() in the shaders.
function snowDepth(x, z) {
  const s = snowAt(x, z); if (s <= 0) return 0;
  return 0.40 * s * sat(G.env[1] * 2.5) * (0.80 + 0.40 * vnoise(x * 0.11 + 40, z * 0.11 + 40)) * (1 - 0.45 * smooth(0.66, 0.84, RoadMap.at(x, z, 0)));
}
// how much forest stands at (x, z), 0..1, h being the height of the land there: belts of spruce on the shaded wall,
// a few stands on the sunny one, copses on the valley floor; taiga on both banks at the bend, birch groves round the village;
// none by the water, in the village or above the tree line
function forestAt(x, z, h) {
  const vz = valleyZ(x, z), n = vnoise(x * 0.0016 + 31, z * 0.0016 + 31) * 0.6 + vnoise(x * 0.0062 + 7, z * 0.0062 + 7) * 0.4;
  const shady = smooth(380, 760, -vz), sunny = smooth(560, 1000, vz), floor = 1 - Math.max(shady, sunny);
  let m = shady * smooth(0.20, 0.32, n) + sunny * smooth(0.40, 0.50, n) + floor * smooth(0.54, 0.62, n);
  m = Math.max(m, (floor + 0.6 * sunny) * 0.85 * smooth(0.63, 0.69, vnoise(x * 0.011 + 5, z * 0.011 + 5)));      // and small clumps of spruce scattered over the grass, as on the high pastures
  // at the bend the taiga covers everything but a few glades; round the village the walls are wooded, birch stands in groves
  // on the floor, and a belt of it follows the river
  const rm = riverD(x, z) * riverW(x), bh = bell((x - XH) / 1500);
  m = Math.max(m, bell((x - XM) / 1300) * smooth(0.05, 0.17, n), bh * Math.max(shady * smooth(0.10, 0.22, n) + sunny * smooth(0.32, 0.44, n) + floor * smooth(0.38, 0.50, n), 0.9 * (1 - smooth(90, 150, rm))));
  // in the village a birch here and there, none on the lanes or against the houses
  m *= (1 - 0.93 * sat(villageAt(x, z) * 2.5)) * (1 - smooth(0.25, 0.60, RoadMap.at(x, z, 1))) * (1 - smooth(0.40, 0.75, RoadMap.at(x, z, 0)));
  m *= smooth(140, 260, Math.hypot(x - SK[0], z - SK[1]));
  return m * smooth(22, 55, rm) * (1 - smooth(300, 360, h)) * smooth(40, 150, lakeD(x, z)) * clearAt(x, z);
}
// the shade of the clouds at (x, z), as cloudShade() in the shaders
function cloudShadeAt(x, z) {
  const k = G.env3[0]; if (k < 0.01) return 1;
  const qx = x * 0.00085 + G.windDir[0] * G.time * 0.011, qz = z * 0.00085 + G.windDir[1] * G.time * 0.011;
  return 1 - k * smooth(0.50, 0.68, vnoise(qx, qz) * 0.62 + vnoise(qx * 2.6 + 5, qz * 2.6 + 5) * 0.38) * 0.62;
}

const GLSL_UNI = `
uniform mat4 uVP;
uniform vec3 uCam;
uniform float uTime;
uniform vec3 uSun, uSunCol, uAmb, uZen, uHorA, uHorS;
uniform float uGlow, uFogB, uFar;
uniform vec2 uWindDir; uniform float uWindT;
uniform mat4 uShVP; uniform sampler2DShadow uSh;
uniform vec3 uHorse;
uniform vec4 uEnv;    // x rain, y snow lying on the ground, z how high the ranges stand, w overcast
uniform vec4 uEnv2;   // x wet, y grass height, z shadow strength, w lightning
uniform vec4 uEnv3;   // x shadows of clouds on the land, y snow blowing, z cold, w how hard the lake is frozen
uniform vec4 uMist;   // x density at its base, y how fast it thins with height (m), z the height of its base, w how it glows toward the sun
uniform vec3 uTint;   // what the season does to the colour of the grass
uniform float uWindK; // how hard it blows
uniform float uSelf;      // set for things that are themselves drawn into the shade map, so that they do not stand in their own shadow
uniform sampler2D uRoad, uTrail;      // the village's lanes and buildings; where the horse has ploughed the snow
uniform vec3 uTrailC;
uniform sampler2D uMask; uniform vec3 uMaskC;      // the shade map (see Shade): its middle (x, z) and 1 / its span
uniform vec3 uNear;   // which of the three places lie within reach of what this program draws (x the village, y the bend, z the lake): their terms are skipped elsewhere
const float WATER = -0.30;
const float XH = ${XH}.0, XM = ${XM}.0, XL = ${XL}.0, LAKE_A = ${LAKE_A}.0, LAKE_B = ${LAKE_B}.0, LAKE_S = ${LAKE_S}.0, ZH = ${ZH.toFixed(3)};
const vec2 VH = vec2(${VH[0].toFixed(2)}, ${VH[1].toFixed(2)}), CH = vec2(${CH[0].toFixed(2)}, ${CH[1].toFixed(2)}), VM = vec2(${VM[0].toFixed(2)}, ${VM[1].toFixed(2)}), BM = vec2(${BM[0].toFixed(2)}, ${BM[1].toFixed(2)});
`;

const GLSL_NOISE = `
float hash21(vec2 p){
  ivec2 i = ivec2(floor(p));
  uint h = uint(i.x) * 374761393u + uint(i.y) * 668265263u;
  h = (h ^ (h >> 13u)) * 1274126177u; h ^= h >> 16u;
  return float(h) * (1.0 / 4294967295.0);
}
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i), b = hash21(i + vec2(1.0, 0.0)), c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p){
  float s = 0.0, a = 0.5;
  for (int k = 0; k < 5; k++) { s += a * vnoise(p); p = p * 2.03 + vec2(17.3, 9.1); a *= 0.5; }
  return s;
}
`;

const GLSL_WORLD = `
float bell(float t){ t = abs(t); if (t >= 1.0) return 0.0; float u = 1.0 - t * t; return u * u; }
float dbell(float t){ return abs(t) >= 1.0 ? 0.0 : -4.0 * t * (1.0 - t * t); }
float riverBase(float x){ return 150.0 * sin(x * 0.0042 + 0.6) + 85.0 * sin(x * 0.0101 + 2.1) + 210.0 * sin(x * 0.00105 + 4.0) - 20.0; }
float riverBaseD(float x){ return 0.63 * cos(x * 0.0042 + 0.6) + 0.8585 * cos(x * 0.0101 + 2.1) + 0.2205 * cos(x * 0.00105 + 4.0); }
float riverZ(float x){ float rb = riverBase(x); if (uNear.y < 0.5) return rb; float b = bell((x - XM) / 520.0); return rb * (1.0 - 0.85 * b) + 250.0 * b * sin((x - XM) * 0.0090); }
float riverDZ(float x){
  float rbd = riverBaseD(x); if (uNear.y < 0.5) return rbd;
  float t = (x - XM) / 520.0, b = bell(t), db = dbell(t) / 520.0, s = (x - XM) * 0.0090;
  return rbd * (1.0 - 0.85 * b) - 0.85 * riverBase(x) * db + 250.0 * (db * sin(s) + b * 0.0090 * cos(s));
}
float riverW(float x){ return uNear.y < 0.5 ? 1.0 : 1.0 + 1.4 * bell((x - XM) / 520.0); }
float riverS(vec2 p){ float s = riverDZ(p.x); return (p.y - riverZ(p.x)) * inversesqrt(1.0 + s * s) / riverW(p.x); }
float riverD(vec2 p){ return abs(riverS(p)); }
float valleyZ(vec2 p){ return p.y + 160.0 * sin(p.x * 0.00083 + 1.0); }
float lakeD(vec2 p){
  if (uNear.z < 0.5 || abs(p.x - XL) > LAKE_A + 1000.0) return 9999.0;
  vec2 e = vec2((p.x - XL) / LAKE_A, p.y / LAKE_B);
  return (length(e) - 1.0) * LAKE_S + 55.0 * sin(p.x * 0.0040 + p.y * 0.0030) + 30.0 * sin(p.y * 0.0110 - p.x * 0.0060);
}
float villageAt(vec2 p){ return uNear.x < 0.5 ? 0.0 : bell((p.x - XH) / 560.0) * bell((p.y - ZH) / 320.0); }
// the village's lanes (r) and buildings (g), from the map Village painted
vec2 roadAt(vec2 p){
  if (uNear.x < 0.5) return vec2(0.0);
  vec2 uv = (p - vec2(${RoadMap.X0}.0, ${RoadMap.Z0.toFixed(3)})) / ${RoadMap.SPAN}.0;
  if (uv.x <= 0.0 || uv.y <= 0.0 || uv.x >= 1.0 || uv.y >= 1.0) return vec2(0.0);
  return textureLod(uRoad, uv, 0.0).rg;
}
float barH(float x, float s){ float u = x - XM; return 1.15 * (bell((u + 175.0) / 75.0) * bell((s - 4.6) / 4.2) + bell((u - 175.0) / 75.0) * bell((s + 4.6) / 4.2)); }
// the height of the land, given how far p is from the river (s, signed, in widths) and outside the lake (dl): those are costly, and callers often have them
float terrainHsl(vec2 p, float s, float dl){
  vec2 q = p + vec2(sin(p.y * 0.0031), cos(p.x * 0.0027)) * 46.0;
  float h = 16.0 * sin(q.x * 0.0021 + 0.6) * cos(q.y * 0.0018 - 0.4);
  h += 8.0 * sin(q.x * 0.0057 + 1.3) * cos(q.y * 0.0049 - 0.7);
  h += 4.2 * sin(q.x * 0.0123 - q.y * 0.0091 + 2.1);
  h += 2.2 * sin(q.x * 0.0210 + q.y * 0.0270 + 0.5);
  h += 0.9 * sin(q.x * 0.0470 - 0.3) * sin(q.y * 0.0410 + 1.9);
  h += 0.28 * sin(q.x * 0.110 + q.y * 0.090 + 4.0);
  h = h * 0.55 + 12.0;
  float rg = max(0.0, sin(p.x * 0.0058 + 1.1 * sin(p.y * 0.0016) + 2.0));
  if (uNear.x > 0.5) {
    h += 46.0 * rg * rg * (1.0 - 0.8 * bell((p.x - XH) / 820.0));
    h = mix(h, 5.0, 0.85 * villageAt(p));
    h += 70.0 * bell(length(p - vec2(XH + 100.0, ZH + 345.0)) / 230.0);
  } else h += 46.0 * rg * rg;
  float bM = uNear.y > 0.5 ? bell((p.x - XM) / 900.0) : 0.0;
  float wall = smoothstep(mix(480.0, 130.0, bM), mix(2500.0, 950.0, bM), abs(valleyZ(p))) * smoothstep(60.0, 900.0, dl);
  h += wall * (70.0 + 340.0 * wall) * (0.60 + 0.40 * sin(q.x * 0.0019 + 1.7 * sin(q.y * 0.0012)));
  float d = abs(s), w = riverW(p.x), e0 = 13.0 * w + 11.0;
  h *= smoothstep(e0, e0 + mix(146.0, 70.0, bM), d * w);
  h -= 0.95 * (1.0 - smoothstep(5.0, 13.0, d));
  if (uNear.y > 0.5 && abs(p.x - XM) < 260.0) h += barH(p.x, s);
  if (dl < 420.0) h = mix(WATER + (dl > 0.0 ? dl * 0.035 : max(dl * 0.045, -14.0)), h, smoothstep(40.0, 420.0, dl));
  if (uNear.z > 0.5) h += 46.0 * bell(length(p - vec2(${SK[0].toFixed(1)}, ${SK[1].toFixed(1)})) / 240.0);
  if (uNear.y > 0.5) h = mix(h, ${MB[2].toFixed(2)}, 1.0 - smoothstep(0.35, 1.0, length(p - vec2(${MB[0].toFixed(1)}, ${MB[1].toFixed(1)})) / 10.0));
  return h;
}
float terrainH(vec2 p){ return terrainHsl(p, riverS(p), lakeD(p)); }
bool wetAt(vec2 p, float h){ return h < WATER && (riverD(p) < 13.0 || lakeD(p) < 8.0); }
vec3 terrainN(vec2 p, float e){
  return normalize(vec3(terrainH(p - vec2(e, 0.0)) - terrainH(p + vec2(e, 0.0)), 2.0 * e, terrainH(p - vec2(0.0, e)) - terrainH(p + vec2(0.0, e))));
}
float segD(vec2 p, vec2 a, vec2 b){ vec2 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)); }
float clearAt(vec2 p){ return uNear.x + uNear.y < 0.5 ? 1.0 : smoothstep(40.0, 100.0, segD(p, VM, BM)) * smoothstep(40.0, 120.0, segD(p, VH, CH)); }
float forestAtS(vec2 p, float h, float rD, float dl){
  float vz = valleyZ(p), n = vnoise(p * 0.0016 + 31.0) * 0.6 + vnoise(p * 0.0062 + 7.0) * 0.4;
  float shady = smoothstep(380.0, 760.0, -vz), sunny = smoothstep(560.0, 1000.0, vz), flr = 1.0 - max(shady, sunny);
  float m = shady * smoothstep(0.20, 0.32, n) + sunny * smoothstep(0.40, 0.50, n) + flr * smoothstep(0.54, 0.62, n), rm = rD * riverW(p.x);
  m = max(m, (flr + 0.6 * sunny) * 0.85 * smoothstep(0.63, 0.69, vnoise(p * 0.011 + 5.0)));
  if (uNear.y > 0.5) m = max(m, bell((p.x - XM) / 1300.0) * smoothstep(0.05, 0.17, n));
  if (uNear.x > 0.5) m = max(m, bell((p.x - XH) / 1500.0) * max(shady * smoothstep(0.10, 0.22, n) + sunny * smoothstep(0.32, 0.44, n) + flr * smoothstep(0.38, 0.50, n), 0.9 * (1.0 - smoothstep(90.0, 150.0, rm))));
  vec2 rb = roadAt(p);
  m *= (1.0 - 0.93 * clamp(villageAt(p) * 2.5, 0.0, 1.0)) * (1.0 - smoothstep(0.25, 0.60, rb.g)) * (1.0 - smoothstep(0.40, 0.75, rb.r));
  if (uNear.z > 0.5) m *= smoothstep(140.0, 260.0, length(p - vec2(${SK[0].toFixed(1)}, ${SK[1].toFixed(1)})));
  return m * smoothstep(22.0, 55.0, rm) * (1.0 - smoothstep(300.0, 360.0, h)) * smoothstep(40.0, 150.0, dl) * clearAt(p);
}
float forestAt(vec2 p, float h){ return forestAtS(p, h, riverD(p), lakeD(p)); }
// how far the year has turned at this place, 0 summer .. 1 autumn gold: the village and the bend are in their autumn
float autumnAt(float x){ return max(uNear.x > 0.5 ? bell((x - XH) / 1700.0) : 0.0, uNear.y > 0.5 ? bell((x - XM) / 1500.0) : 0.0); }
// gust strength 0..1: long fronts that travel down the wind
float windAt(vec2 p){
  vec2 d = uWindDir; vec2 q = vec2(dot(p, d), dot(p, vec2(-d.y, d.x)));
  float a = vnoise(vec2(q.x * 0.030 - uWindT * 0.50, q.y * 0.011));
  float b = vnoise(vec2(q.x * 0.085 - uWindT * 1.15, q.y * 0.038 + 3.7));
  return smoothstep(0.22, 0.82, a * 0.65 + b * 0.35);
}
// the shadows of the clouds, sliding over the land: 1 in the sun
float cloudShade(vec2 p){
  if (uEnv3.x < 0.01) return 1.0;
  vec2 q = p * 0.00085 + uWindDir * uTime * 0.011;
  float c = vnoise(q) * 0.62 + vnoise(q * 2.6 + 5.0) * 0.38;
  return 1.0 - uEnv3.x * smoothstep(0.50, 0.68, c) * 0.62;
}
// colour of the grass seen from above: lush hollows, dry gold rises, drifts of flowers
vec3 grassAlb(vec2 p){
  float n1 = vnoise(p * 0.0052 + 11.0), n2 = vnoise(p * 0.027 + 5.0), n3 = vnoise(p * 0.13 + 2.0);
  float dry = smoothstep(0.28, 0.78, n1 * 0.62 + n2 * 0.38);
  vec3 c = mix(vec3(0.042, 0.135, 0.026), vec3(0.185, 0.190, 0.055), dry);
  c *= 0.82 + 0.36 * n3;
  // high country, and autumn: the grass has gone tawny
  c = mix(c, vec3(0.185, 0.150, 0.066) * (0.75 + 0.5 * n2), max(clamp(uEnv.y * 1.7, 0.0, 0.8), autumnAt(p.x) * 0.55));
  return c * uTint;
}
// snow lying in drifts (the snow-mountain scene). Keep in step with snowAt() in JS.
float snowAtS(vec2 p, float rD, float dl){
  if (uEnv.y < 0.002) return 0.0;
  float n = vnoise(p * 0.026 + 70.0) * 0.55 + vnoise(p * 0.090 + 13.0) * 0.30 + vnoise(p * 0.41) * 0.15;
  float th = 0.66 - uEnv.y * 1.5;
  return smoothstep(th, th + 0.07, n) * smoothstep(10.5, 14.0, rD) * smoothstep(0.5, 5.0, dl);
}
float snowDepthS(vec2 p, float rD, float dl){
  float s = snowAtS(p, rD, dl); if (s <= 0.0) return 0.0;
  return 0.40 * s * clamp(uEnv.y * 2.5, 0.0, 1.0) * (0.80 + 0.40 * vnoise(p * 0.11 + 40.0)) * (1.0 - 0.45 * smoothstep(0.66, 0.84, roadAt(p).r));
}
float snowAt(vec2 p){ return uEnv.y < 0.002 ? 0.0 : snowAtS(p, riverD(p), lakeD(p)); }
float flowerAt(vec2 p){ return smoothstep(0.60, 0.78, vnoise(p * 0.021 + 40.0)); }

// the clear sky in direction rd (no sun disc, no cloud): also the colour the land fades to
vec3 skyGrad(vec3 rd){
  float y = max(rd.y, 0.0);
  vec2 sx = normalize(uSun.xz), rx = normalize(rd.xz + vec2(1e-5));
  float ws = pow(clamp(0.5 + 0.5 * dot(rx, sx), 0.0, 1.0), 2.5);
  vec3 hor = mix(uHorA, uHorS, ws);
  vec3 c = mix(uZen, hor, exp(-y * 5.0));
  c = mix(c, uZen * 0.72, smoothstep(0.35, 1.0, y) * 0.55);
  float mu = max(dot(rd, uSun), 0.0);
  c += uSunCol * uGlow * (0.010 * pow(mu, 4.0) + 0.055 * pow(mu, 36.0));
  return c;
}
vec3 hazeCol(vec3 rd){ return skyGrad(normalize(vec3(rd.x, 0.012, rd.z))); }

// mist that lies in the low ground: thick by the river, thinning with height, drifting in banks
float mistTau(vec3 a, vec3 b){
  if (uMist.x < 1e-6) return 0.0;
  float H = uMist.y, ya = (a.y - uMist.z) / H, yb = (b.y - uMist.z) / H, dy = yb - ya;
  float ea = exp(-clamp(ya, -3.0, 30.0)), eb = exp(-clamp(yb, -3.0, 30.0));
  float mean = abs(dy) > 0.02 ? (ea - eb) / dy : 0.5 * (ea + eb);
  float banks = 0.50 + 1.0 * vnoise((a.xz + b.xz) * 0.5 * 0.0035 + uWindDir * uTime * 0.012);
  return uMist.x * mean * distance(a, b) * banks;
}
// the same, looking up and out through the top of it
float mistSky(vec3 rd){
  if (uMist.x < 1e-6) return 0.0;
  return 1.0 - exp(-uMist.x * uMist.y * exp(-clamp((uCam.y - uMist.z) / uMist.y, -3.0, 30.0)) / max(rd.y, 0.004));
}
vec3 mistCol(vec3 rd){
  float mu = max(dot(rd, uSun), 0.0);
  return uAmb * 0.92 + uSunCol * (0.06 + uMist.w * (0.10 * mu * mu + 0.55 * pow(mu, 12.0)));
}
vec3 applyFog(vec3 col, vec3 wp){
  vec3 d = wp - uCam; float dist = length(d); vec3 rd = d / dist;
  float f = 1.0 - exp(-dist * uFogB);
  f = max(f, smoothstep(uFar * 0.70, uFar * 0.97, dist));
  col = mix(col, hazeCol(rd), f);
  return mix(col, mistCol(rd), 1.0 - exp(-mistTau(uCam, wp)));
}
// how much of the sun reaches the ground at p, past trees and houses
float shadeAt(vec2 p){
  vec2 uv = (p - uMaskC.xy) * uMaskC.z + 0.5, e = abs(uv - 0.5);
  float edge = max(e.x, e.y); if (edge > 0.5) return 1.0;
  return mix(1.0, textureLod(uMask, uv, 0.0).r, uEnv2.z * (1.0 - smoothstep(0.42, 0.5, edge)));
}
float shadowAt(vec3 wp){
  float sm = uSelf > 0.5 ? 1.0 : shadeAt(wp.xz);
  vec4 s = uShVP * vec4(wp, 1.0); vec3 c = s.xyz * 0.5 + 0.5;
  if (c.x < 0.002 || c.x > 0.998 || c.y < 0.002 || c.y > 0.998 || c.z > 1.0) return sm;
  float t = 1.0 / float(textureSize(uSh, 0).x), z = c.z - 0.0016, r = 0.0;
  r += texture(uSh, vec3(c.xy + vec2(-t, -t) * 0.75, z)); r += texture(uSh, vec3(c.xy + vec2(t, -t) * 0.75, z));
  r += texture(uSh, vec3(c.xy + vec2(-t, t) * 0.75, z)); r += texture(uSh, vec3(c.xy + vec2(t, t) * 0.75, z));
  return mix(1.0, r * 0.25, uEnv2.z) * sm;
}
`;

// values every shader reads; filled each frame by the game and the sky
const G = {
  vp: new Float32Array(16), cam: [0, 2, 0], camR: [1, 0, 0], camU: [0, 1, 0], camF: [0, 0, -1], tanHalf: 0.5, aspect: 1.7,
  time: 0, sun: [0.7, 0.2, 0.6], sunCol: [3, 1.8, 0.8], amb: [0.3, 0.3, 0.4], zen: [0.08, 0.2, 0.46], horA: [0.6, 0.56, 0.58], horS: [1.7, 1.15, 0.55],
  glow: 1, fogB: 0.00030, far: 4200, windDir: [0.8, 0.6], windT: 0, shVP: new Float32Array(16), horse: [0, 0, 0], exposure: 0.85, shadowTex: null,
  env: [0, 0, 0, 0], env2: [0, 1, 1, 0], env3: [0, 0, 0, 0], mist: [0, 10, 0, 1], tint: [1, 1, 1], windK: 1, maskC: [0, 0, 0.001], rainFall: [0, -9.5, 0], rainRel: [0, -9.5, 0], rainT: 0,
};
// Main-camera frustum. setCamera supplies a new matrix for each camera pose.
let frustumMatrix = null;
const frustumPlanes = new Float64Array(6 * 4);
function outsideRideView(x, y, z, radius) {
  const m = G.vp, planes = frustumPlanes;
  if (frustumMatrix !== m) {
    for (let side = 0; side < 6; side++) {
      const row = side >> 1, sign = side % 2 === 0 ? 1 : -1, i = side * 4;
      const a = m[3] + sign * m[row], b = m[7] + sign * m[4 + row], c = m[11] + sign * m[8 + row];
      const length = Math.hypot(a, b, c) || 1;
      planes[i] = a / length; planes[i + 1] = b / length; planes[i + 2] = c / length;
      planes[i + 3] = (m[15] + sign * m[12 + row]) / length;
    }
    frustumMatrix = m;
  }
  for (let i = 0; i < planes.length; i += 4) {
    if (planes[i] * x + planes[i + 1] * y + planes[i + 2] * z + planes[i + 3] < -radius) return true;
  }
  return false;
}
// reach: how far from the camera this program draws (m); decides which places' terms it needs
function setGlobals(p, reach) {
  const cx = G.cam[0], rc = reach || 4400;
  p.f3('uNear', [Math.abs(cx - XH) < 1700 + rc ? 1 : 0, Math.abs(cx - XM) < 1500 + rc ? 1 : 0, Math.abs(cx - XL) < LAKE_A + 1000 + rc ? 1 : 0]);
  p.m4('uVP', G.vp); p.f3('uCam', G.cam); p.f1('uTime', G.time);
  p.f3('uSun', G.sun); p.f3('uSunCol', G.sunCol); p.f3('uAmb', G.amb); p.f3('uZen', G.zen); p.f3('uHorA', G.horA); p.f3('uHorS', G.horS);
  p.f1('uGlow', G.glow); p.f1('uFogB', G.fogB); p.f1('uFar', G.far);
  p.f2('uWindDir', G.windDir[0], G.windDir[1]); p.f1('uWindT', G.windT);
  p.m4('uShVP', G.shVP); p.f3('uHorse', G.horse);
  p.f4('uEnv', G.env[0], G.env[1], G.env[2], G.env[3]); p.f4('uEnv2', G.env2[0], G.env2[1], G.env2[2], G.env2[3]);
  p.f4('uEnv3', G.env3[0], G.env3[1], G.env3[2], G.env3[3]); p.f4('uMist', G.mist[0], G.mist[1], G.mist[2], G.mist[3]);
  p.f3('uTint', G.tint); p.f1('uWindK', G.windK);
  if (G.shadowTex) { gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D, G.shadowTex); p.i1('uSh', 7); }
  gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, Shade.tex); p.i1('uMask', 6); p.f3('uMaskC', G.maskC);
  if (G.roadTex) { gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, G.roadTex); p.i1('uRoad', 4); }
  if (G.trailTex) { gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, G.trailTex); p.i1('uTrail', 3); p.f3('uTrailC', G.trailC); }
}

// ======== 02b_env.js
// ---------------------------------------------------------------- scenes: the hour, the weather and the season, as one set of numbers that can be blended
// The country is the same in all of them (the valley, its river and forests, the snow mountains beyond); only the air changes.
const SCENES = {
  steppe: {
    label: '黄昏', sub: '落日 · 日照金山', sunElev: 9, sunAz: 2.41, sun: [3.00, 1.62, 0.66], amb: [0.25, 0.30, 0.44], zen: [0.050, 0.135, 0.400], horA: [0.40, 0.42, 0.50], horS: [0.92, 0.55, 0.24],
    glow: 1.0, exp: 0.66, fogB: 0.00030, rain: 0, snow: 0, mount: 0.80, overcast: 0, wet: 0, grassH: 1, shadow: 1, tint: [1, 1, 1], wind: 1, crystal: 0, disc: 1,
    cloud: 0.75, flurry: 0, cold: 0, mist: 0.0012, mistH: 9, mistGlow: 1.0, freeze: 0, lamp: 0.85,
  },
  day: {
    label: '晴日', sub: '晴空 · 远山如洗', sunElev: 44, sunAz: 2.21, sun: [3.40, 3.10, 2.60], amb: [0.34, 0.45, 0.66], zen: [0.040, 0.170, 0.600], horA: [0.48, 0.64, 0.88], horS: [0.74, 0.82, 0.92],
    glow: 0.4, exp: 0.56, fogB: 0.00016, rain: 0, snow: 0, mount: 0.80, overcast: 0, wet: 0, grassH: 1, shadow: 1, tint: [1, 1, 1], wind: 0.9, crystal: 0, disc: 1,
    cloud: 0.55, flurry: 0, cold: 0, mist: 0.0004, mistH: 12, mistGlow: 1.0, freeze: 0, lamp: 0.0,
  },
  mist: {
    label: '晨雾', sub: '清晨 · 河谷晨雾', sunElev: 9.5, sunAz: 0.30, sun: [2.90, 1.85, 1.05], amb: [0.31, 0.34, 0.45], zen: [0.075, 0.150, 0.380], horA: [0.50, 0.46, 0.50], horS: [1.25, 0.80, 0.44],
    glow: 0.7, exp: 0.80, fogB: 0.00022, rain: 0, snow: 0, mount: 0.72, overcast: 0, wet: 0.30, grassH: 1, shadow: 0.85, tint: [0.85, 1.0, 0.88], wind: 0.45, crystal: 0, disc: 1,
    cloud: 0.25, flurry: 0, cold: 0.6, mist: 0.011, mistH: 9, mistGlow: 0.85, freeze: 0, lamp: 1.0,
  },
  rain: {
    label: '雨天', sub: '夏雨 · 草原雷阵', sunElev: 40, sunAz: 0.90, sun: [0.46, 0.50, 0.55], amb: [0.50, 0.56, 0.64], zen: [0.150, 0.180, 0.230], horA: [0.33, 0.37, 0.41], horS: [0.37, 0.40, 0.43],
    glow: 0.08, exp: 0.84, fogB: 0.00110, rain: 1, snow: 0, mount: 0.42, overcast: 1, wet: 1, grassH: 1, shadow: 0.22, tint: [0.60, 0.90, 0.62], wind: 1.7, crystal: 0, disc: 0,
    cloud: 0, flurry: 0, cold: 0.2, mist: 0.0040, mistH: 30, mistGlow: 0.2, freeze: 0, lamp: 0.7,
  },
  snow: {
    label: '晴雪', sub: '严冬 · 冰封雪岭', sunElev: 27, sunAz: -0.95, sun: [3.30, 3.00, 2.50], amb: [0.30, 0.42, 0.68], zen: [0.028, 0.100, 0.400], horA: [0.42, 0.58, 0.82], horS: [0.70, 0.78, 0.90],
    glow: 0.45, exp: 0.52, fogB: 0.00014, rain: 0, snow: 0.40, mount: 1, overcast: 0, wet: 0, grassH: 0.60, shadow: 1, tint: [1.0, 1.0, 1.0], wind: 1.25, crystal: 1, disc: 1,
    cloud: 0.6, flurry: 1, cold: 1, mist: 0.0006, mistH: 14, mistGlow: 1.0, freeze: 1, lamp: 0.2,
  },
};
const Env = {
  name: 'steppe', order: ['steppe', 'day', 'mist', 'rain', 'snow'], cur: null, from: null, to: null, t: 1, span: 5, time: 0,
  flash: 0, flashAge: 9, flashIn: 7, flashDir: [1, 0.3, 0], boltSeed: 1, massifAz: 0.32, rainNow: 0, rnd: rng(2026),
  copy(s) { const o = {}; for (const k in s) o[k] = Array.isArray(s[k]) ? s[k].slice() : s[k]; return o; },
  init() { this.cur = this.copy(SCENES[this.name]); this.from = this.copy(this.cur); this.to = SCENES[this.name]; },
  set(name, instant) {
    if (!SCENES[name]) return;
    this.name = name; this.from = this.copy(this.cur); this.to = SCENES[name]; this.t = instant ? 1 : 0;
    if (instant) this.cur = this.copy(this.to);
  },
  next() { this.set(this.order[(this.order.indexOf(this.name) + 1) % this.order.length]); return SCENES[this.name]; },
  update(dt) {
    this.time += dt;
    if (this.t < 1) {
      this.t = Math.min(1, this.t + dt / this.span);
      const e = this.t * this.t * (3 - 2 * this.t), a = this.from, b = this.to, c = this.cur;
      for (const k in b) {
        if (typeof b[k] === 'string') { c[k] = b[k]; continue; }
        if (Array.isArray(b[k])) for (let i = 0; i < b[k].length; i++) c[k][i] = lerp(a[k][i], b[k][i], e); else c[k] = lerp(a[k], b[k], e);
      }
    }
    const c = this.cur, t = this.time;
    // rain comes in squalls: heavier for a while, then easing
    this.rainNow = c.rain * (0.66 + 0.34 * Math.sin(t * 0.21 + 1.3 * Math.sin(t * 0.083)));
    // lightning: now and then, while it rains hard
    this.flashAge += dt;
    if (c.rain > 0.7) {
      this.flashIn -= dt;
      if (this.flashIn <= 0) {
        this.flashIn = 9 + this.rnd() * 17; this.flashAge = 0; this.boltSeed = 1 + this.rnd() * 50;
        const a = this.rnd() * TAU; this.flashDir = [Math.cos(a) * 0.9, 0.35, Math.sin(a) * 0.9];
        if (typeof Sound !== 'undefined') Sound.thunder(0.9 + this.rnd() * 2.6);
      }
    }
    const fa = this.flashAge;
    this.flash = fa > 1.2 ? 0 : Math.max(Math.exp(-fa * 9), fa > 0.14 ? 0.75 * Math.exp(-(fa - 0.14) * 7) : 0, fa > 0.40 ? 0.35 * Math.exp(-(fa - 0.40) * 6) : 0);
    // hand everything to the shaders
    const el = c.sunElev * D2R, ce = Math.cos(el), fl = this.flash;
    G.sun = [ce * Math.cos(c.sunAz), Math.sin(el), ce * Math.sin(c.sunAz)];
    G.sunCol = c.sun; G.zen = c.zen; G.horA = c.horA; G.horS = c.horS; G.glow = c.glow; G.exposure = c.exp; G.fogB = c.fogB;
    G.amb = [c.amb[0] * (1 + 0.9 * fl), c.amb[1] * (1 + 0.95 * fl), c.amb[2] * (1 + 1.1 * fl)];
    G.windK = c.wind; G.env = [this.rainNow, c.snow, c.mount * (1 - 0.58 * smooth(XL - LAKE_A - 2600, XL - LAKE_A - 700, G.cam ? G.cam[0] : 0)), c.overcast];      // round the lake the mountains stand far back and low: the water is the wide thing there
    G.env2 = [c.wet, c.grassH, c.shadow, fl]; G.tint = c.tint;
    G.env3 = [c.cloud, c.flurry, c.cold, c.freeze]; G.mist = [c.mist, c.mistH, 0, c.mistGlow];
  },
};

// ======== 03_sky.js
// ---------------------------------------------------------------- sky: sun, cloud, overcast and lightning, the ranges on the skyline
const Sky = {
  init() {
    this.prog = program(VS_FULL, GLSL_UNI + GLSL_NOISE + GLSL_WORLD + `
in vec2 vUv; out vec4 o;
uniform vec3 uCamR, uCamU, uCamF, uFlashDir; uniform vec2 uTan; uniform float uMassif, uDisc; uniform vec3 uBolt;

float ridge(vec2 q, float seed){
  float h = vnoise(q * 2.3 + seed) * 0.55 + vnoise(q * 6.1 + seed * 1.7 + 9.0) * 0.30 + vnoise(q * 19.0 + seed * 0.3) * 0.15;
  return pow(h, 1.7) + 0.05 * vnoise(q * 63.0 + seed);
}
vec4 cloud(vec3 rd, float scale, float speed, float cover, float soft, vec2 off){
  vec2 uv = rd.xz / (rd.y + 0.10) * scale + uWindDir * uTime * speed + off;
  float d = fbm(uv);
  float den = smoothstep(cover, cover + soft, d);
  float d2 = smoothstep(cover, cover + soft, fbm(uv + normalize(uSun.xz) * 0.22));
  return vec4(den, exp(-d2 * 1.9), d, 0.0);
}
// one range of mountains laid over col. f: how busy its skyline is; big: how much it grows in the mountain scene
vec3 range(vec3 col, float az, float el, float fw, vec3 haze, float f, float seed, float base, float amp, float big, float hz, float line, vec3 rockC){
  float M = uEnv.z, lobe = pow(0.5 + 0.5 * cos(az - uMassif), 3.0);
  float k = 1.0 + M * (big * 0.35 + big * lobe);
  float m = (base + amp * ridge(vec2(cos(az), sin(az)) * f, seed)) * k;
  float a = smoothstep(m + fw, m - fw, el);
  if (a <= 0.0) return col;
  float m2 = (base + amp * ridge(vec2(cos(az + 0.010), sin(az + 0.010)) * f, seed)) * k;
  float sgn = sign(sin(az - atan(uSun.z, uSun.x)));
  float face = clamp(0.5 + (m2 - m) * sgn * 150.0 / k, 0.0, 1.0);
  float d = m - el;
  // gullies run down from the crest: rock shows in them, snow lies between
  float g = vnoise(vec2(az * 60.0 * f, d * 34.0) + seed), g2 = vnoise(vec2(az * 170.0 * f, d * 80.0) + seed * 2.0);
  float snowLine = line * (1.0 + M * 0.9);
  float snow = smoothstep(snowLine - 0.012, snowLine + 0.020, el + (g - 0.5) * 0.012 + (g2 - 0.5) * 0.008);
  float lit = face * (0.70 + 0.60 * g);
  vec3 rock = rockC * (uAmb * (0.85 + 0.3 * g2) + uSunCol * 0.16 * lit);
  vec3 sn = uAmb * (1.00 + 0.22 * g2) + uSunCol * (0.05 + 0.40 * lit);
  vec3 mc = mix(rock, sn, snow);
  mc *= 0.82 + 0.18 * smoothstep(0.0, 0.05 * k, d);
  mc = mix(mc, haze, clamp(hz * (0.50 + 0.50 * exp(-el * 12.0)) * mix(1.0, 0.72, M) + uEnv.w * 0.9, 0.0, 1.0));
  return mix(col, mc, a);
}
void main(){
  vec2 p = vUv * 2.0 - 1.0;
  vec3 rd = normalize(uCamF + uCamR * p.x * uTan.x + uCamU * p.y * uTan.y);
  vec3 haze = hazeCol(rd);
  if (rd.y < 0.0) { o = vec4(haze, 1.0); return; }
  vec3 col = skyGrad(rd);
  float mu = dot(rd, uSun), clear = 1.0 - uEnv.w;

  col += uSunCol * (smoothstep(0.99990, 0.99997, mu) * 40.0 + pow(max(mu, 0.0), 1400.0) * 0.9) * uDisc;

  // fair-weather cloud: a high thin layer and a lower broken one
  vec4 c1 = cloud(rd, 0.55, 0.0035, 0.50, 0.30, vec2(3.0, 7.0));
  vec4 c2 = cloud(rd, 1.25, 0.0060, 0.56, 0.16, vec2(31.0, 17.0));
  vec3 litC = uSunCol * 0.24 + uAmb * 0.95, shC = uAmb * 0.70 + uZen * 0.45;
  float silver = pow(max(mu, 0.0), 10.0);
  for (int k = 0; k < 2; k++) {
    vec4 c = k == 0 ? c1 : c2;
    float den = c.x * (k == 0 ? 0.55 : 0.92);
    vec3 cc = mix(shC, litC, c.y);
    cc += uSunCol * silver * (1.0 - c.x * 0.75) * (k == 0 ? 0.16 : 0.28);
    cc = mix(haze, cc, smoothstep(0.0, 0.22, rd.y) * 0.9 + 0.1);
    col = mix(col, cc, den * smoothstep(0.005, 0.06, rd.y) * clear);
  }

  // rain cloud: a low grey ceiling with darker bellies, moving
  if (uEnv.w > 0.002) {
    vec2 uv = rd.xz / (rd.y + 0.16) * 0.75 + uWindDir * uTime * 0.014;
    float n = fbm(uv) * 0.62 + fbm(uv * 2.4 + 7.0 - uWindDir * uTime * 0.02) * 0.38;
    vec3 oc = mix(uZen * 0.80, uHorA * 1.12, smoothstep(0.30, 0.74, n));
    // lightning lights the cloud from inside, strongest toward the strike
    float fd = pow(max(dot(rd, normalize(uFlashDir)), 0.0), 2.0);
    oc += vec3(0.70, 0.78, 1.00) * uEnv2.w * (0.10 + 1.1 * fd * fd) * (0.5 + n);
    // rain hanging under the cloud in dark shafts, far off
    float azr = atan(rd.z, rd.x);
    float shaft = smoothstep(0.52, 0.80, vnoise(vec2(azr * 7.0 + uTime * 0.004, 1.0)) * 0.7 + vnoise(vec2(azr * 23.0, rd.y * 6.0 + uTime * 0.05)) * 0.3);
    oc *= 1.0 - 0.34 * shaft * smoothstep(0.30, 0.02, rd.y);
    // the bolt itself: a crooked line from the cloud to the ground, for an instant
    if (uBolt.z > 0.01) {
      float da = azr - uBolt.x; da = atan(sin(da), cos(da));
      float path = (vnoise(vec2(rd.y * 34.0, uBolt.y)) - 0.5) * 0.11 + (vnoise(vec2(rd.y * 130.0, uBolt.y + 7.0)) - 0.5) * 0.022;
      float fork = (vnoise(vec2(rd.y * 34.0, uBolt.y + 19.0)) - 0.5) * 0.30 + 0.05;
      float dl = min(abs(da - path), abs(da - path - fork * smoothstep(0.26, 0.10, rd.y)) * 2.2);
      float line = exp(-dl * 380.0) + 0.16 * exp(-dl * 55.0);
      oc += vec3(0.85, 0.90, 1.0) * line * uBolt.z * 40.0 * smoothstep(0.36, 0.26, rd.y);
    }
    oc = mix(oc, haze, exp(-rd.y * 6.0) * 0.9);
    col = mix(col, oc, uEnv.w);
  }

  // the ranges: farthest and highest first
  float az = atan(rd.z, rd.x);
  float el = rd.y / max(length(rd.xz), 1e-4), fw = fwidth(el) * 1.2 + 1e-5;
  col = range(col, az, el, fw, haze, 1.5, 11.7, 0.008, 0.062, 0.25, 0.52, 0.066, vec3(0.36, 0.40, 0.54));
  col = range(col, az, el, fw, haze, 1.7, 21.0, 0.004, 0.040, 0.15, 0.44, 0.090, vec3(0.30, 0.36, 0.40));

  col = mix(col, haze, exp(-rd.y * 40.0) * 0.45);
  col = mix(col, mistCol(rd), mistSky(rd));
  o = vec4(col, 1.0);
}`, 'sky');
  },
  draw() {
    const p = this.prog.use(); setGlobals(p);
    p.f3('uCamR', G.camR); p.f3('uCamU', G.camU); p.f3('uCamF', G.camF); p.f2('uTan', G.tanHalf * G.aspect, G.tanHalf);
    p.f1('uMassif', Env.massifAz); p.f1('uDisc', Env.cur.disc); p.f3('uFlashDir', Env.flashDir);
    p.f3('uBolt', [Math.atan2(Env.flashDir[2], Env.flashDir[0]), Env.boltSeed, Env.flashAge < 0.22 ? Env.flash : 0]);
    gl.disable(gl.DEPTH_TEST); gl.depthMask(false);
    drawFull();
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
  },
};

// ======== 03b_mountains.js
// ---------------------------------------------------------------- the great range of the mountain scene
// Real relief, not a painted skyline: a ring of mountains 7 to 40 km out, built once from ridged noise. It travels with the rider
// (you never reach it) but keeps its bearing, and it is lit like everything else. Snow lies where it is high and not too steep.
const Mount = {
  NA: 720, NR: 84, R0: 6500, R1: 42000, H: 6400,
  height(x, z, a) {
    // ridged noise: each octave is sharpened into crests, and sits mostly on the crests of the octave before
    let px = x / 7400 + 31.7, pz = z / 7400 + 12.3, f = 0, w = 1, amp = 0.5;
    for (let o = 0; o < 6; o++) {
      let n = 1 - Math.abs(2 * vnoise(px, pz) - 1); n *= n;
      f += n * amp * w; w = clamp(n * 1.9, 0, 1);
      const t = px * 1.62 + pz * 1.21; pz = pz * 1.62 - px * 1.21 + 7.1; px = t + 3.3; amp *= 0.5;
    }
    const r = Math.hypot(x, z), env = smooth(this.R0 + 600, 17000, r) * (1 - 0.5 * smooth(27000, this.R1, r));
    // the great massif stands up the valley; a second range, lower, closes the view to the south (behind the village and the bend)
    const lobe = 0.5 + 0.5 * Math.cos(a - Env.massifAz), lobe2 = 0.5 + 0.5 * Math.cos(a + 1.80);
    return f * env * (0.40 + 0.98 * Math.pow(lobe, 1.5) + 0.22 * Math.pow(lobe2, 3));
  },
  init() {
    const NA = this.NA, NR = this.NR, nv = NA * (NR + 1), hs = new Float32Array(nv), v = new Float32Array(nv * 6), rr = new Float32Array(NR + 1);
    for (let j = 0; j <= NR; j++) rr[j] = this.R0 * Math.pow(this.R1 / this.R0, j / NR);
    for (let j = 0; j <= NR; j++) for (let i = 0; i < NA; i++) { const a = i / NA * TAU; hs[j * NA + i] = this.height(Math.cos(a) * rr[j], Math.sin(a) * rr[j], a); }
    for (let j = 0; j <= NR; j++) for (let i = 0; i < NA; i++) {
      const a = i / NA * TAU, ca = Math.cos(a), sa = Math.sin(a), r = rr[j], k = j * NA + i, o = k * 6;
      const j0 = Math.max(j - 1, 0), j1 = Math.min(j + 1, NR), dr = (hs[j1 * NA + i] - hs[j0 * NA + i]) / (rr[j1] - rr[j0]);
      const da = (hs[j * NA + (i + 1) % NA] - hs[j * NA + (i + NA - 1) % NA]) / (2 * TAU / NA * r);
      v[o] = ca * r; v[o + 1] = hs[k]; v[o + 2] = sa * r; v[o + 3] = dr * ca - da * sa; v[o + 4] = dr * sa + da * ca; v[o + 5] = 0;
    }
    const idx = new Uint32Array(NA * NR * 6); let q = 0;
    for (let j = 0; j < NR; j++) for (let i = 0; i < NA; i++) {
      const a = j * NA + i, b = j * NA + (i + 1) % NA, c = a + NA, d = b + NA;
      idx[q++] = a; idx[q++] = c; idx[q++] = b; idx[q++] = b; idx[q++] = c; idx[q++] = d;
    }
    this.count = idx.length;
    this.vao = gl.createVertexArray(); gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, v, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 24, 12);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    this.prog = program(GLSL_UNI + `
layout(location=0) in vec3 aP; layout(location=1) in vec2 aG;
uniform mat4 uMVP; uniform float uHk;
out vec3 vP; out vec2 vG; out float vH;
void main(){ vP = vec3(aP.x, aP.y * uHk - 140.0, aP.z); vG = aG; vH = aP.y; gl_Position = uMVP * vec4(vP, 1.0); }`, GLSL_UNI + GLSL_NOISE + GLSL_WORLD + `
in vec3 vP; in vec2 vG; in float vH; out vec4 o;
uniform float uHk;
void main(){
  float dist = length(vP); vec3 rd = vP / dist; vec2 q = vP.xz;
  // relief finer than the mesh: it breaks the snow line and roughens the faces
  float n1 = vnoise(q * 0.00055 + 3.0), n2 = vnoise(q * 0.0021 + 9.0), n3 = vnoise(q * 0.0075 + 5.0), n4 = vnoise(q * 0.024);
  vec2 gd = vec2(vnoise(q * 0.0014 + 11.0) - 0.5, vnoise(q * 0.0014 + 23.0) - 0.5) * 0.9
          + vec2(vnoise(q * 0.0050 + 5.0) - 0.5, vnoise(q * 0.0050 + 17.0) - 0.5) * 0.6
          + vec2(n4 - 0.5, vnoise(q * 0.024 + 31.0) - 0.5) * 0.35;
  float relief = smoothstep(0.02, 0.12, vH);
  vec2 g = vG * uHk + gd * relief;
  // the faces are fluted: ribs of rock and runnels of snow, all running down the fall line
  float sl = length(g); vec2 fall = g / max(sl, 1e-3), acr = vec2(-fall.y, fall.x);
  float fu = dot(q, acr), fw = dot(q, fall), fk = smoothstep(0.22, 0.85, sl) * relief;
  float fl = (vnoise(vec2(fu * 0.0058, fw * 0.00075) + 7.0) - 0.5) * 1.25 + 0.35 * (vnoise(vec2(fu * 0.0125, fw * 0.0017) + 3.0) - 0.5);
  g += acr * fl * 0.85 * fk;
  vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
  float steep = 1.0 - N.y;
  float line = 0.150 + (n1 - 0.5) * 0.10;
  float snow = smoothstep(line - 0.035, line + 0.050, vH + (n2 - 0.5) * 0.09 + (n3 - 0.5) * 0.03);
  snow *= 1.0 - smoothstep(0.34, 0.56, steep + (n3 - 0.5) * 0.22 + fl * 0.26 * fk);      // too steep to hold it: rock shows, in ribs
  snow = max(snow, smoothstep(0.42, 0.60, vH) * 0.80);                                     // the summits are white whatever the slope
  // When the sun is low its light has come the long way through the air and is deep gold; and it reaches only what stands high:
  // the foot of the range lies already (or still) in the shadow of the earth, blue. This is the hour the peaks burn.
  float lowS = 1.0 - smoothstep(0.12, 0.36, uSun.y);
  float sline = mix(-0.30, 0.205, lowS * lowS);
  float lit = smoothstep(sline - 0.02, sline + 0.10, vH + (n2 - 0.5) * 0.06);
  // (the colour is far redder in the numbers than it will look: the film curve at the end pulls every bright thing toward white)
  vec3 sunC = mix(uSunCol, vec3(1.14, 0.37, 0.046) * uSunCol.r, 0.93 * lowS) * lit;
  vec3 ambC = uAmb * mix(vec3(1.0), vec3(0.76, 0.92, 1.24), lowS) * (1.0 - 0.72 * lowS * lit);      // (where the gold falls, the blue of the sky does not dilute it)
  float ndl = max(dot(N, uSun), 0.0), wrap = clamp(dot(N, uSun) * 0.5 + 0.5, 0.0, 1.0), ndS = clamp((dot(N, uSun) + 0.10) / 1.10, 0.0, 1.0);
  // rock: banded where the beds show, darker in the gullies
  float beds = vnoise(vec2(vH * 34.0 + n2 * 4.0, dot(q, vec2(0.00021, 0.00017))));
  vec3 rock = mix(vec3(0.150, 0.145, 0.160), vec3(0.230, 0.195, 0.165), n2) * (0.8 + 0.4 * n4) * (0.82 + 0.36 * beds) * (1.0 - 0.25 * clamp(-fl * 2.0, 0.0, 1.0) * fk);
  vec3 low = mix(vec3(0.200, 0.165, 0.085), rock, smoothstep(0.035, 0.110, vH + (n3 - 0.5) * 0.04));
  vec3 col = low * (ambC * (0.55 + 0.45 * N.y) + sunC * ndl * mix(0.95, 0.70, lowS));
  vec3 sc = vec3(0.84, 0.88, 0.96) * (ambC * (0.70 + 0.35 * N.y + 0.12 * wrap) + sunC * ndS * mix(0.80, 1.02, lowS));      // snow throws the gold back; rock soaks it up
  col = mix(col, sc, snow);
  // the air between: thin up here, but there are tens of kilometres of it
  float f = 1.0 - exp(-dist * 0.000027);
  vec3 air = skyGrad(normalize(vec3(rd.x, max(rd.y * 0.45, 0.012), rd.z)));
  col = mix(col, air, clamp(f * 0.92 * (1.0 - 0.58 * lowS) + uEnv.w * 0.97, 0.0, 1.0));      // (the gold carries: at that hour the air between is lit the same colour)
  col = mix(col, hazeCol(rd), smoothstep(0.012, -0.004, rd.y));
  col = mix(col, mistCol(rd), mistSky(rd));
  o = vec4(col, 1.0);
}`, 'mountains');
  },
  draw() {
    const M = G.env[2]; if (M < 0.004) return;
    const R = G.camR, U = G.camU, F = G.camF, view = new Float32Array([R[0], U[0], -F[0], 0, R[1], U[1], -F[1], 0, R[2], U[2], -F[2], 0, 0, 0, 0, 1]);
    const p = this.prog.use(); setGlobals(p);
    p.m4('uMVP', m4.mul(m4.perspective(2 * Math.atan(G.tanHalf), G.aspect, 700, 130000), view)); p.f1('uHk', this.H * M);
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
    gl.bindVertexArray(this.vao); gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_INT, 0);
    gl.clear(gl.DEPTH_BUFFER_BIT);       // everything else is nearer than the range
  },
};

// ======== 04_terrain.js
// ---------------------------------------------------------------- the ground and the river: one grid that rides with the camera, fine near and coarse far
const Terrain = {
  N: 320,
  init() {
    const N = this.N, v = new Float32Array((N + 1) * (N + 1) * 2), idx = new Uint32Array(N * N * 6);
    let k = 0;
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) { v[k++] = i / N * 2 - 1; v[k++] = j / N * 2 - 1; }
    k = 0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
      idx[k++] = a; idx[k++] = c; idx[k++] = b; idx[k++] = b; idx[k++] = c; idx[k++] = d;
    }
    this.vao = gl.createVertexArray(); gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, v, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    this.count = idx.length;
    this.prog = program(GLSL_UNI + GLSL_NOISE + GLSL_WORLD + `
layout(location=0) in vec2 aP;
out vec3 vW;
void main(){
  vec2 w = sign(aP) * pow(abs(aP), vec2(2.2)) * uFar;
  vec2 p = uCam.xz + w;
  float rs = riverS(p), dl = lakeD(p), h = terrainHsl(p, rs, dl);
  if (h < WATER && (abs(rs) < 13.0 || dl < 8.0)) h = WATER;        // where river and lake lie the grid is the water's surface, and the bed is beneath it
  else h += snowDepthS(p, abs(rs), dl);                            // the snow lies on the land: what stands there stands in it
  vW = vec3(p.x, h, p.y);
  gl_Position = uVP * vec4(vW, 1.0);
}`, GLSL_UNI + GLSL_NOISE + GLSL_WORLD + `
in vec3 vW; out vec4 o;

// water, seen from above it. The river is glacier melt, milky jade over pale pebbles, and runs; the lake is clear:
// glass over its shingle at the edge, turquoise in the shallows, sapphire out where it is deep.
vec3 waterCol(vec2 p, vec3 rd, float dist, float depth, float lake, float sh){
  float t = uTime, dz = riverDZ(p.x);
  vec2 fl = normalize(vec2(1.0, dz));
  vec2 q = mix(vec2(dot(p, fl), (p.y - riverZ(p.x)) * inversesqrt(1.0 + dz * dz)), vec2(dot(p, uWindDir), dot(p, vec2(-uWindDir.y, uWindDir.x))) * 0.7, lake);
  float sp = mix(1.7 * (0.45 + 0.55 * clamp(depth / 0.65, 0.0, 1.0)), 0.35 * uWindK, lake);      // the river runs faster in the middle; the lake only ripples
  float n1 = vnoise(vec2(q.x * 0.9 - t * sp, q.y * 2.2)), n1b = vnoise(vec2(q.x * 0.9 - t * sp + 0.33, q.y * 2.2 + 0.21));
  float n2 = vnoise(vec2(q.x * 2.6 - t * sp * 1.8, q.y * 5.5 + 3.0)), n3 = vnoise(vec2(q.x * 7.0 - t * sp * 2.6, q.y * 13.0));
  float rough = mix(0.22, 0.09, smoothstep(12.0, 400.0, dist)) * (1.0 + uEnv.x * 1.2) * mix(1.0, 0.8 + 0.5 * uWindK, lake);
  vec3 N = normalize(vec3((n1 - n1b) * 2.2 + (n2 - 0.5) * 0.7 + (n3 - 0.5) * 0.35, 1.0 / rough, (n2 - 0.5) * 1.0 + (n1 - 0.5) * 0.5 + (n3 - 0.5) * 0.35));
  vec3 R = reflect(rd, N); R.y = abs(R.y);
  float F = (0.03 + 0.97 * pow(clamp(1.0 + dot(rd, N), 0.0, 1.0), 5.0)) * mix(1.0, 0.62, lake);
  vec3 lit = uSunCol * max(uSun.y, 0.0) * 0.9 * sh + uAmb;
  vec3 pebble = mix(vec3(0.20, 0.19, 0.17), vec3(0.36, 0.34, 0.30), vnoise(p * 2.7)) * (0.7 + 0.6 * vnoise(p * 9.0));
  float milk = bell((p.x - XM) / 900.0);      // at the bend the water is thick with glacier flour: a paler, greener jade
  vec3 river = mix(pebble * vec3(0.70, 0.95, 0.90), mix(vec3(0.050, 0.215, 0.205), vec3(0.085, 0.330, 0.270), milk), 1.0 - exp(-depth * 4.5));
  F *= 1.0 - 0.30 * milk * (1.0 - lake);
  vec3 lk = mix(pebble * vec3(0.78, 1.0, 0.98), vec3(0.030, 0.270, 0.300), 1.0 - exp(-depth * 1.5));
  lk = mix(lk, vec3(0.008, 0.070, 0.215), 1.0 - exp(-max(depth - 0.9, 0.0) * 0.55));
  vec3 body = mix(river, lk, lake);
  vec3 sky = skyGrad(R);
  sky = mix(sky, mistCol(R), mistSky(R) * 0.8);
  vec3 c = mix(body * lit, sky, F);
  c += uSunCol * pow(max(dot(R, uSun), 0.0), 240.0) * 14.0 * sh * (1.0 - uEnv.w);
  // white water over the river's shallows; on the lake, small waves running up the shingle and falling back
  float foam = smoothstep(0.70, 0.90, n2 * 0.6 + n3 * 0.4) * smoothstep(0.03, 0.30, depth) * (1.0 - smoothstep(0.36, 0.65, depth)) * (1.0 - lake);
  float lap = 0.05 + 0.05 * sin(t * 0.9 + dot(p, vec2(0.11, 0.17)) + n1 * 4.0);
  foam = max(foam, lake * (1.0 - smoothstep(lap * 0.4, lap, depth)) * (0.5 + 0.5 * n2));
  c = mix(c, lit * 0.80, foam * 0.55);
  // rain rings
  float ring = step(0.985, hash21(floor(p * 3.0) + floor(t * 6.0))) * uEnv.x;
  c += uAmb * ring * 0.35;
  return c;
}

// a sheet of ice broken into plates: how far p is from the nearest crack between them
float cracks(vec2 p){
  vec2 i = floor(p), f = fract(p); float d1 = 9.0, d2 = 9.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y)), o = vec2(hash21(i + g), hash21(i + g + 57.0));
    float d = length(g + o - f);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return d2 - d1;
}
// the lake in winter: clear blue ice over dark water. Cracks hang in it as white sheets and bubbles are frozen in on their way up,
// both seen at several depths, so they shift against each other as the eye moves; wind-packed snow lies on it in streaks
vec3 iceCol(vec2 p, vec3 rd, float dist, float depth, float sh){
  vec3 lit = uSunCol * max(uSun.y, 0.0) * 0.8 * sh + uAmb;
  vec3 body = mix(vec3(0.060, 0.300, 0.330), vec3(0.008, 0.075, 0.170), 1.0 - exp(-depth * 0.30));
  body *= 0.80 + 0.40 * vnoise(p * 0.035);
  vec3 c = body * lit;
  vec2 par = rd.xz / max(-rd.y, 0.10);
  float near = 1.0 - smoothstep(25.0, 140.0, dist), w = 0.010 + dist * 0.0007, cr = 0.0, bub = 0.0;
  // real cracks wander, and they start and stop: the plates are bent out of true, and each crack shows only along part of its length
  vec2 warp = vec2(vnoise(p * 0.045 + 3.0), vnoise(p * 0.045 + 17.0)) * 9.0 + vec2(vnoise(p * 0.21), vnoise(p * 0.21 + 7.0)) * 1.6;
  for (int k = 0; k < 3; k++) {
    float fk = float(k); vec2 q = p + par * (0.06 + 0.20 * fk) + warp;
    float show = smoothstep(0.30, 0.62, vnoise(q * 0.060 + fk * 5.0));
    cr += (1.0 - smoothstep(0.0, w, cracks(q * 0.085 + fk * 3.7))) * (1.0 - 0.30 * fk) * (0.25 + 0.75 * show);
    if (near > 0.0) {
      cr += (1.0 - smoothstep(0.0, w * 2.2, cracks(q * 0.37 + 9.0 + fk))) * 0.32 * near * (1.0 - 0.30 * fk) * smoothstep(0.45, 0.70, vnoise(q * 0.13 + 9.0 + fk));
      // bubbles: scattered, of every size, in swarms
      vec2 bc = q * 5.3 + fk * 3.1, bi = floor(bc);
      float h = hash21(bi + fk * 7.0), there = smoothstep(0.56, 0.80, vnoise(q * 0.33 + fk * 11.0)) * step(0.50, h);
      vec2 off = vec2(hash21(bi + 3.0), hash21(bi + 5.0)) - 0.5;
      bub += there * (1.0 - smoothstep(0.03 + 0.20 * h * h, 0.06 + 0.26 * h * h, length(fract(bc) - 0.5 - off * 0.72))) * near * (1.0 - 0.3 * fk);
    }
  }
  c += lit * vec3(0.55, 0.74, 0.82) * (min(cr, 1.6) * 0.40 + min(bub, 1.0) * 0.45);
  // the sky lies in it, almost unbroken
  vec3 N = normalize(vec3((vnoise(p * 0.6) - 0.5) * 0.045, 1.0, (vnoise(p * 0.6 + 5.0) - 0.5) * 0.045));
  vec3 R = reflect(rd, N); R.y = abs(R.y);
  float F = 0.035 + 0.965 * pow(clamp(1.0 + dot(rd, N), 0.0, 1.0), 5.0);
  c = mix(c, skyGrad(R), F * 0.80);
  c += uSunCol * (pow(max(dot(R, uSun), 0.0), 1400.0) * 4.0 + pow(max(dot(R, uSun), 0.0), 90.0) * 0.08) * sh;
  // snow: packed white along the shore and in long drifts down the wind, fine streaks of it sliding over the bare ice
  vec2 wq = vec2(dot(p, uWindDir), dot(p, vec2(-uWindDir.y, uWindDir.x)));
  float sn = smoothstep(0.52, 0.64, vnoise(vec2(wq.x * 0.010, wq.y * 0.032)) * 0.62 + vnoise(vec2(wq.x * 0.045, wq.y * 0.15) + 4.0) * 0.38);
  sn = max(sn, 1.0 - smoothstep(0.02, 0.22, depth + (vnoise(p * 0.3) - 0.5) * 0.12));
  float drift = smoothstep(0.62, 0.90, vnoise(vec2(wq.x * 0.07 - uTime * 0.8, wq.y * 1.7)) * 0.55 + vnoise(vec2(wq.x * 0.23 - uTime * 1.9, wq.y * 5.5)) * 0.45);
  sn = max(sn, drift * 0.16 * uEnv3.y * (1.0 - smoothstep(6.0, 90.0, dist)));
  float sp = step(0.992, hash21(floor(p * 22.0))) * pow(max(dot(R, uSun), 0.0), 4.0) * (1.0 - smoothstep(3.0, 120.0, dist));
  vec3 sc = vec3(0.70, 0.75, 0.84) * (uSunCol * (max(uSun.y, 0.0) * 0.85 + 0.03) * sh + uAmb * 1.15) * (0.92 + 0.16 * vnoise(p * 1.9)) + uSunCol * sp * 1.6;
  return mix(c, sc, sn);
}

void main(){
  vec2 p = vW.xz;
  vec3 d = vW - uCam; float dist = length(d); vec3 rd = d / dist;
  float rs = riverS(p), dl = lakeD(p), rD = abs(rs);
  float gh = terrainHsl(p, rs, dl), e = 0.4 + dist * 0.004;
  vec3 N = normalize(vec3(gh - terrainH(p + vec2(e, 0.0)), e, gh - terrainH(p + vec2(0.0, e))));
  vec3 alb = grassAlb(p);
  float w = windAt(p);
  float shade = cloudShade(p);
  float sh = shadowAt(vW + vec3(0.0, 0.25, 0.0)) * shade;
  float ndl = max(dot(N, uSun), 0.0);
  float mu = max(dot(rd, uSun), 0.0);
  // under the trees it is dim and the grass is thin
  float fo = forestAtS(p, gh, rD, dl);
  alb = mix(alb, vec3(0.020, 0.050, 0.022), fo * 0.75);
  // in the village the ground is trodden: worn turf, bare earth between the houses
  float vil = villageAt(p);
  if (vil > 0.0) alb = mix(alb, vec3(0.150, 0.118, 0.070) * (0.75 + 0.5 * vnoise(p * 0.9)), vil * smoothstep(0.35, 0.62, vnoise(p * 0.045 + 3.0) * 0.6 + vnoise(p * 0.21) * 0.4) * 0.85);
  // the lanes: earth packed by hooves and cart wheels, two ruts, ragged at the edges
  vec2 rb = roadAt(p);
  if (rb.r > 0.5) {
    float dr = (1.0 - rb.r) * 10.0, lane = 1.0 - smoothstep(1.7, 2.7, dr + (vnoise(p * 0.8) - 0.5) * 1.3);
    vec3 dirt = vec3(0.175, 0.135, 0.090) * (0.70 + 0.55 * vnoise(p * 1.7)) * (1.0 - 0.28 * (1.0 - smoothstep(0.0, 0.30, abs(dr - 0.85))));
    alb = mix(alb, dirt, lane * 0.94);
  }
  sh *= mix(1.0, 0.45, fo * smoothstep(250.0, 330.0, dist));      // far off, where the shade map does not reach, a wood is simply dim
  // the canopy: lit by the low sun on the slopes that face it, glowing where we look through it at the sun
  vec3 col = alb * (uSunCol * (ndl * 1.5 + 0.07) * sh + uAmb * (0.62 + 0.38 * N.y));
  col += alb * uSunCol * pow(mu, 4.0) * 0.36 * sh;
  // gusts show as paler bands running over the grass
  col *= 1.0 + (w - 0.45) * 0.34 * (1.0 - smoothstep(60.0, 900.0, dist));
  col += uSunCol * alb * w * 0.10 * sh;
  // clumps, until they would shimmer
  col *= 1.0 + (vnoise(p * 0.8) - 0.5) * 0.30 * (1.0 - smoothstep(20.0, 140.0, dist));
  // under the blades close by it is dim earth and shade
  col *= mix(0.50, 0.86, smoothstep(5.0, 110.0, dist));
  // rain: darker, with the grey sky lying on the bent grass
  col *= mix(1.0, 0.82, uEnv2.x);
  col += uAmb * uEnv2.x * 0.16 * (0.3 + w) * pow(clamp(1.0 + dot(rd, N), 0.0, 1.0), 4.0);
  // snow in drifts, glinting
  float sn = snowAtS(p, rD, dl);
  if (sn > 0.0) {
    float sp = 0.45 * step(0.994, hash21(floor(p * 30.0))) * pow(max(dot(reflect(rd, N), uSun), 0.0), 5.0) * (1.0 - smoothstep(3.0, 140.0, dist));
    // the wind has carved it: small ridges that take the light and throw blue shade
    vec3 Ns = N + vec3(vnoise(p * 2.6) - 0.5, 0.0, vnoise(p * 2.6 + 9.0) - 0.5) * 0.55 * (1.0 - smoothstep(4.0, 90.0, dist));
    // where hooves and feet have gone in (Trail keeps the map: red how deep the hole, green how high the snow heaped round it)
    float pit = 0.0;
    if (dist < 70.0) {
      vec2 tu = (p - uTrailC.xy) * uTrailC.z + 0.5, te = abs(tu - 0.5);
      float edge = 1.0 - smoothstep(0.43, 0.49, max(te.x, te.y));
      vec2 any = edge > 0.0 ? textureLod(uTrail, tu, 4.5).rg : vec2(0.0);
      if (any.r + any.g > 0.002) {
        const float DEP = 0.21, RIM = 0.055;
        // looked at from the side, a hole shows its far wall and hides its near one: the look-up is carried along the line of sight
        // (the line of sight is followed down into the snow a step at a time, until it meets the floor of a hole or the wall beyond it)
        vec2 st = rd.xz / max(-rd.y, 0.22) * uTrailC.z * DEP / 9.0, t2 = tu;
        float ray = 0.0, sf = texture(uTrail, t2).r, pr = 0.0, ps = sf;
        for (int i = 0; i < 9; i++) { if (ray >= sf) break; pr = ray; ps = sf; t2 += st; ray += 1.0 / 9.0; sf = texture(uTrail, t2).r; }
        // between the last step above the snow and the first below it, the meeting point is found by proportion: no terraces
        float da = ps - pr, db = ray - sf, w = ray > pr ? clamp(db / max(da + db, 1e-4), 0.0, 1.0) : 0.0;
        t2 -= st * w; ray -= w / 9.0;
        vec2 m = texture(uTrail, t2).rg; m.r = max(m.r, ray * step(0.03, m.r));
        float e = 1.2 / float(textureSize(uTrail, 0).x);
        vec2 mx = texture(uTrail, t2 + vec2(e, 0.0)).rg - texture(uTrail, t2 - vec2(e, 0.0)).rg, mz = texture(uTrail, t2 + vec2(0.0, e)).rg - texture(uTrail, t2 - vec2(0.0, e)).rg;
        Ns -= vec3(mx.g * RIM - mx.r * DEP, 0.0, mz.g * RIM - mz.r * DEP) * (uTrailC.z / (2.0 * e)) * edge;
        pit = m.r * edge;
      }
    }
    Ns = normalize(Ns);
    float nds = max(dot(Ns, uSun), 0.0), deep = smoothstep(0.25, 0.80, pit);
    sp *= 1.0 - smoothstep(0.02, 0.2, pit);
    // down in a hole the sun seldom reaches the floor, and less of the sky is seen: it is blue shade
    vec3 sc = vec3(0.66, 0.71, 0.80) * (uSunCol * (nds * 0.80 + 0.03) * sh * (1.0 - 0.80 * deep) + uAmb * 1.15 * mix(vec3(1.0), vec3(0.50, 0.58, 0.76), deep)) + uSunCol * sp * 1.6;
    // spindrift: snow smoking along the surface in streaks, down the wind
    vec2 wq = vec2(dot(p, uWindDir), dot(p, vec2(-uWindDir.y, uWindDir.x)));
    float drift = smoothstep(0.55, 0.85, vnoise(vec2(wq.x * 0.06 - uTime * 0.9, wq.y * 0.9)) * 0.6 + vnoise(vec2(wq.x * 0.19 - uTime * 2.1, wq.y * 2.6)) * 0.4);
    sc += (uAmb * 0.5 + uSunCol * 0.10 * sh) * drift * uEnv3.y * (1.0 - smoothstep(10.0, 160.0, dist));
    col = mix(col, sc, sn);
  }
  // the banks and the beach: shingle and sand where the grass stops
  float bank = max(1.0 - smoothstep(11.0, 15.5, rD + (vnoise(p * 0.35) - 0.5) * 3.0), 1.0 - smoothstep(7.0, 24.0, dl + (vnoise(p * 0.21) - 0.5) * 12.0));
  if (bank > 0.0) {
    vec3 shingle = mix(vec3(0.165, 0.150, 0.125), vec3(0.34, 0.32, 0.28), vnoise(p * 3.1)) * (0.65 + 0.7 * vnoise(p * 11.0));
    shingle = mix(shingle, vec3(0.40, 0.36, 0.28) * (0.85 + 0.3 * vnoise(p * 6.0)), step(abs(p.x - XM), 260.0) * step(rD, 9.5));      // the bars in the bend are pale sand
    shingle *= mix(0.62, 1.0, smoothstep(0.02, 0.22, gh - WATER));                   // dark where it is wet
    vec3 bc = shingle * (uSunCol * (ndl * 1.2 + 0.05) * sh + uAmb * 0.9);
    col = mix(col, bc, bank);
  }
  if (gh < WATER + 0.06 && (rD < 13.0 || dl < 8.0)) {
    float wet = 1.0 - smoothstep(-0.03, 0.03, gh - WATER + (vnoise(p * 1.3) - 0.5) * 0.03);
    float lake = 1.0 - smoothstep(-6.0, 6.0, dl), dep = max(WATER - gh, 0.0);
    if (wet > 0.0) col = mix(col, lake * uEnv3.w > 0.5 ? iceCol(p, rd, dist, dep, sh) : waterCol(p, rd, dist, dep, lake, sh), wet);
  }
  o = vec4(applyFog(col, vW), 1.0);
}`, 'terrain');
  },
  draw() {
    const p = this.prog.use(); setGlobals(p);
    gl.bindVertexArray(this.vao);
    gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_INT, 0);
  },
};

// ======== 05_grass.js
// ---------------------------------------------------------------- grass: three rings of instanced blades that wrap round the camera
// Each frame runs in two steps. First, once for every blade: where it stands, how tall, which way the wind bends it, its colour,
// how the light and the air fall on it. That is the costly part (it reads the land, the wind, the river, the forest), and it is
// captured into a buffer with transform feedback. Then the blades are drawn from that buffer by a vertex shader with little left to do.
// Before this every vertex of every blade did all of it again: several times the work for the same picture.
const Grass = {
  // tile = side of the square a ring repeats over; in0..in1 = where the ring fades in from the camera
  layers: [
    { tile: 26, n: 150000, w: 0.0075, h: 0.58, seg: 4, in0: -1, in1: 0 },
    { tile: 72, n: 170000, w: 0.020, h: 0.62, seg: 3, in0: 7, in1: 14 },
    { tile: 210, n: 150000, w: 0.060, h: 0.70, seg: 2, in0: 24, in1: 44 },
  ],
  STRIDE: 80,      // five vec4 for each blade
  init(quality) {
    const scale = [0.34, 0.62, 1][quality];
    const maxN = 170000, r = rng(77), inst = new Float32Array(maxN * 4);
    for (let i = 0; i < inst.length; i++) inst[i] = r();
    const ib = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, ib); gl.bufferData(gl.ARRAY_BUFFER, inst, gl.STATIC_DRAW);
    for (const L of this.layers) {
      L.count = Math.floor(L.n * scale);
      // widen what is left so the field keeps its cover
      L.wq = L.w / Math.sqrt(scale);
      // the blade: a strip that narrows to a point (never fewer than two steps: a strip of one triangle draws several times slower here)
      const v = [];
      for (let s = 0; s < L.seg; s++) { const t = s / L.seg * 0.92; v.push(-1, t, 1, t); }
      v.push(0, 1);
      L.nv = v.length / 2;
      L.tf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, L.tf); gl.bufferData(gl.ARRAY_BUFFER, L.count * this.STRIDE, gl.DYNAMIC_COPY);
      // step one reads the blade's four random numbers
      L.vaoA = gl.createVertexArray(); gl.bindVertexArray(L.vaoA);
      gl.bindBuffer(gl.ARRAY_BUFFER, ib);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);
      // step two: the strip, the random numbers again, and what step one worked out
      L.vao = gl.createVertexArray(); gl.bindVertexArray(L.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, ib);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0); gl.vertexAttribDivisor(1, 1);
      gl.bindBuffer(gl.ARRAY_BUFFER, L.tf);
      for (let k = 0; k < 5; k++) { gl.enableVertexAttribArray(2 + k); gl.vertexAttribPointer(2 + k, 4, gl.FLOAT, false, this.STRIDE, k * 16); gl.vertexAttribDivisor(2 + k, 1); }
    }
    gl.bindVertexArray(null); gl.bindBuffer(gl.ARRAY_BUFFER, null);

    this.progA = program(GLSL_UNI + GLSL_NOISE + GLSL_WORLD + `
layout(location=0) in vec4 aI;
uniform float uTile, uW, uH, uIn0, uIn1; uniform vec2 uCtr;
uniform vec3 uSlow;   // things that change slowly over the ground, worked out once a frame: x the slope toward the sun, y the cloud's shade here (or -1: work it out), z whether trees are near
out vec4 oA;          // where the root is; the blade's height
out vec4 oB;          // how it bends (x, z); its width at the root; whether it carries a flower
out vec4 oC;          // its colour; the gust on it
out vec4 oD;          // sunlight on it; how much of that is unshadowed; the glow looking toward the sun; snow on it
out vec4 oE;          // the air between: what it adds, and how much of the blade's own colour comes through
void main(){
  vec2 rel = mod(aI.xy * uTile - uCtr, uTile) - 0.5 * uTile;
  vec2 p = uCtr + rel;
  float dcam = length(p - uCam.xz);
  float sc = (1.0 - smoothstep(0.36, 0.5, length(rel) / uTile)) * smoothstep(uIn0, uIn1, dcam);
  float r1 = aI.z, r2 = aI.w;
  float rs = riverS(p), dl = lakeD(p), rD = abs(rs);
  float y0 = terrainHsl(p, rs, dl);
  float tuft = vnoise(p * 0.33 + 3.0);
  float sn = snowAtS(p, rD, dl);
  float bare = (1.0 - smoothstep(0.0, 0.55, sn)) * (1.0 - smoothstep(0.70, 0.80, roadAt(p).r));      // no blades under the drifts, nor on the lanes
  float fo = 0.0;
  if (uSlow.z > 0.5) fo = forestAtS(p, y0, rD, dl);
  if (rD < 20.0) bare *= smoothstep(11.5, 16.0, rD + (vnoise(p * 0.35) - 0.5) * 3.0);      // nor in the river and on its shingle
  if (dl < 40.0) bare *= smoothstep(8.0, 26.0, dl + (vnoise(p * 0.21) - 0.5) * 12.0);      // nor on the beach
  float vil = villageAt(p), meadow = (1.0 - smoothstep(120.0, 900.0, dl)) * smoothstep(20.0, 60.0, dl);
  float h = uH * (0.50 + 0.80 * r1) * (0.62 + 0.76 * tuft) * sc * uEnv2.y * bare;
  h *= (1.0 + 0.75 * (1.0 - smoothstep(15.0, 32.0, rD))) * (1.0 - 0.45 * fo) * (1.0 - 0.55 * vil) * (uNear.x + uNear.y > 0.5 ? 1.0 - 0.62 * (1.0 - smoothstep(6.0, 36.0, min(length(p - VH), length(p - VM)))) : 1.0);          // rushes stand tall along the water; thin grass under the trees; grazed short in the village

  float w = windAt(p);
  float lean = (0.10 + 0.80 * w) * (0.7 + 0.6 * r2) * uWindK;
  float flut = sin(uWindT * (5.0 + 3.0 * r2) + r1 * 40.0 + p.x * 0.7) * (0.03 + 0.08 * w);
  vec2 rdir = vec2(cos(r2 * 6.2832), sin(r2 * 6.2832));
  vec2 bend = uWindDir * (lean + flut) + rdir * 0.24;
  vec2 hd = p - uHorse.xz; float hl = length(hd);
  float push = 1.0 - smoothstep(0.25, 0.95, hl);       // the horse parts the grass it stands in
  bend += hd / max(hl, 0.05) * push * 0.9;
  h *= 1.0 - push * 0.4;
  vec3 root = vec3(p.x, y0, p.y);

  // flowers: a few blades in the drifts carry a head; the meadows by the lake are thick with them
  float fl = step(0.962 - 0.11 * meadow, r2) * max(flowerAt(p), meadow) * step(0.25, r1);
  vec3 alb = grassAlb(p);
  alb = mix(alb, vec3(0.020, 0.050, 0.022), fo * 0.6);

  float dh = uSlow.x;
  float ndl = max((uSun.y - dh * length(uSun.xz)) * inversesqrt(1.0 + dh * dh), 0.0);
  float sh = shadowAt(root + vec3(0.0, h * 0.5, 0.0)) * (uSlow.y < 0.0 ? cloudShade(p) : uSlow.y);
  vec3 mid = root + vec3(0.0, h * 0.6, 0.0), d = mid - uCam; float dist = length(d); vec3 rd = d / dist;
  float mu = max(dot(rd, uSun), 0.0);
  float f = max(1.0 - exp(-dist * uFogB), smoothstep(uFar * 0.70, uFar * 0.97, dist)), m = 1.0 - exp(-mistTau(uCam, mid));

  oA = vec4(root, h);
  oB = vec4(bend, uW * (1.0 + dcam * 0.045) * sc * bare, fl);
  oC = vec4(alb, w);
  oD = vec4((ndl * 1.5 + 0.07) * sh, sh, mu * mu * mu * mu, smoothstep(0.0, 0.5, sn) * 0.6);
  oE = vec4(hazeCol(rd) * f * (1.0 - m) + mistCol(rd) * m, (1.0 - f) * (1.0 - m));
  gl_Position = vec4(0.0, 0.0, 0.0, 1.0);
}`, `void main(){}`, 'grassBlades', ['oA', 'oB', 'oC', 'oD', 'oE']);

    this.prog = program(`
layout(location=0) in vec2 aV; layout(location=1) in vec4 aI;
layout(location=2) in vec4 aA; layout(location=3) in vec4 aB; layout(location=4) in vec4 aC; layout(location=5) in vec4 aD; layout(location=6) in vec4 aE;
uniform mat4 uVP; uniform vec3 uCam, uSunCol, uAmb; uniform vec4 uEnv, uEnv2;
out vec3 vCol;
void main(){
  float t = aV.y, r1 = aI.z, r2 = aI.w, h = aA.w, fl = aB.w, w = aC.w;
  vec2 bend = aB.xy;
  float ct = inversesqrt(1.0 + dot(bend, bend) * t * t * 1.4);
  vec3 pos = aA.xyz + vec3(bend.x * t * t, t, bend.y * t * t) * (h * ct);
  vec2 rdir = vec2(cos(r2 * 6.2832), sin(r2 * 6.2832));
  vec3 side = normalize(cross(vec3(0.0, 1.0, 0.0), normalize(uCam - pos)) + vec3(rdir.x, 0.0, rdir.y) * 0.4);
  float wid = aB.z * (1.0 - t * t * t * 0.9) * (1.0 + fl * 3.2 * smoothstep(0.6, 0.9, t));
  pos += side * (aV.x * wid);

  vec3 alb = aC.rgb;
  vec3 c = mix(alb * 0.26, alb * 1.55 + vec3(0.016, 0.018, 0.0), pow(max(t, 1e-4), 0.9));
  c *= 0.70 + 0.60 * fract(r2 * 7.31);
  c = mix(c, c.grb * vec3(0.9, 1.0, 0.8), step(0.86, fract(r1 * 5.77)) * 0.35);
  c = mix(c, vec3(0.46, 0.37, 0.18), step(0.80, r1) * smoothstep(0.66, 1.0, t) * 0.75);                       // seed heads
  vec3 fc = r1 < 0.50 ? vec3(0.95, 0.66, 0.05) : (r1 < 0.80 ? vec3(0.86, 0.84, 0.76) : vec3(0.46, 0.24, 0.70));
  c = mix(c, fc, fl * smoothstep(0.62, 0.86, t) * (1.0 - uEnv.x * 0.6));
  c = mix(c, vec3(0.50, 0.53, 0.56), aD.w);

  // the canopy is lit from above, dim at the root; it glows where we look through it at the sun, and gusts show paler
  vec3 lit = c * (uSunCol * aD.x * mix(0.5, 1.0, t) + uAmb * mix(0.40, 1.0, t));
  lit += c * uSunCol * (aD.z * 0.50 + w * 0.14) * aD.y * t;
  lit += uAmb * uEnv2.x * 0.22 * t * (0.25 + w);      // wet blades carry a sheen of sky
  vCol = lit * aE.w + aE.rgb;
  gl_Position = uVP * vec4(pos, 1.0);
}`, `
in vec3 vCol; out vec4 o;
void main(){ o = vec4(vCol, 1.0); }`, 'grass');
  },
  draw() {
    // the lie of the land under the rider, toward the sun; the cloud over it; whether there is forest within reach of the blades
    const hx = G.horse[0], hz = G.horse[2], sl = Math.hypot(G.sun[0], G.sun[2]) || 1, sx = G.sun[0] / sl, sz = G.sun[2] / sl;
    const dh = (terrainH(hx + sx * 3, hz + sz * 3) - terrainH(hx - sx * 3, hz - sz * 3)) / 6;
    let trees = 0;
    for (let i = 0; i < 9 && !trees; i++) { const tx = hx + (i % 3 - 1) * 110, tz = hz + (Math.floor(i / 3) - 1) * 110; if (forestAt(tx, tz, terrainH(tx, tz)) > 0.01) trees = 1; }
    const shade = cloudShadeAt(hx, hz);
    const fx = G.camF[0], fz = G.camF[2], fl = Math.hypot(fx, fz) || 1, dens = App.dens;

    // step one: every blade, once
    let p = this.progA.use(); setGlobals(p, 320);
    gl.enable(gl.RASTERIZER_DISCARD); gl.bindBuffer(gl.ARRAY_BUFFER, null);
    for (const L of this.layers) {
      L.drawn = Math.round(L.count * dens);
      p.f1('uTile', L.tile); p.f1('uW', L.wq / Math.sqrt(dens)); p.f1('uH', L.h); p.f1('uIn0', L.in0); p.f1('uIn1', L.in1);
      p.f3('uSlow', [dh, L.tile > 100 ? -1 : shade, trees]);
      p.f2('uCtr', G.cam[0] + fx / fl * L.tile * 0.30, G.cam[2] + fz / fl * L.tile * 0.30);
      gl.bindVertexArray(L.vaoA);
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, L.tf);
      gl.beginTransformFeedback(gl.POINTS); gl.drawArrays(gl.POINTS, 0, L.drawn); gl.endTransformFeedback();
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
    }
    gl.disable(gl.RASTERIZER_DISCARD);

    // step two: draw them
    p = this.prog.use();
    p.m4('uVP', G.vp); p.f3('uCam', G.cam); p.f3('uSunCol', G.sunCol); p.f3('uAmb', G.amb);
    p.f4('uEnv', G.env[0], G.env[1], G.env[2], G.env[3]); p.f4('uEnv2', G.env2[0], G.env2[1], G.env2[2], G.env2[3]);
    for (const L of this.layers) { gl.bindVertexArray(L.vao); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, L.nv, L.drawn); }
  },
};

// ======== 05b_trees.js
// ---------------------------------------------------------------- trees: spruce in tall narrow spires, larch among them, birch in the valley
// Each tree is a card turned toward the camera. What is on the card is painted once, when the page loads, into an atlas:
// three kinds of tree, three forms of each, built from a trunk, branches and some hundreds of clumps of foliage, every clump with
// its own light and shade and ragged, leafy edge. The atlas does not hold colour. It holds, for every point of the picture,
// how bright that point is within the tree, a number that varies from clump to clump, and whether it is leaf or bark.
// The colour is made when the tree is drawn, so one painting serves summer green, every stage of the autumn, and the bare winter.
// Trees are scattered once over a strip of country that repeats along the valley; whether a place holds one is forestAt().
const Trees = {
  T: 7000, CELL: 20, Z0: -3400, Z1: 3400,
  init() {
    this.bake();
    const N = this.n = [90000, 220000, 520000][App.quality], r = rng(404), inst = this.inst = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) {
      const k = r(); let z;
      if (k < 0.47) z = -lerp(400, 3300, Math.pow(r(), 1.5));          // the shaded wall, most of them low on it
      else if (k < 0.63) z = lerp(520, 3300, Math.pow(r(), 1.3));      // the sunny wall
      else z = lerp(-520, 620, r());                                   // the valley floor, the banks of the bend, the groves round the village
      inst[i * 4] = r() * this.T; inst[i * 4 + 1] = z; inst[i * 4 + 2] = 0.02 + r() * 0.96; inst[i * 4 + 3] = r();
    }
    // a grid over the strip, so the rider can ask what stands nearby
    const nx = this.nx = Math.ceil(this.T / this.CELL), nz = this.nz = Math.ceil((this.Z1 - this.Z0) / this.CELL);
    this.head = new Int32Array(nx * nz).fill(-1); this.next = new Int32Array(N);
    for (let i = 0; i < N; i++) {
      const c = Math.min(nx - 1, Math.floor(inst[i * 4] / this.CELL)) + nx * clamp(Math.floor((inst[i * 4 + 1] - this.Z0) / this.CELL), 0, nz - 1);
      this.next[i] = this.head[c]; this.head[c] = i;
    }
    const ib = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, ib); gl.bufferData(gl.ARRAY_BUFFER, inst, gl.STATIC_DRAW);
    // step one, once for each tree: is it there, how tall, what kind, how the wind moves it
    this.tf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.tf); gl.bufferData(gl.ARRAY_BUFFER, N * 32, gl.DYNAMIC_COPY);
    this.vaoA = gl.createVertexArray(); gl.bindVertexArray(this.vaoA);
    gl.bindBuffer(gl.ARRAY_BUFFER, ib); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);
    // step two: the card, drawn from what step one found. The shadows of the trees are drawn from the same (see Shade)
    this.vao = gl.createVertexArray(); gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, 0, 1, 0, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, ib);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0); gl.vertexAttribDivisor(1, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.tf);
    for (let k = 0; k < 2; k++) { gl.enableVertexAttribArray(2 + k); gl.vertexAttribPointer(2 + k, 4, gl.FLOAT, false, 32, k * 16); gl.vertexAttribDivisor(2 + k, 1); }
    gl.bindVertexArray(null); gl.bindBuffer(gl.ARRAY_BUFFER, null);
    this.progA = program(GLSL_UNI + GLSL_NOISE + GLSL_WORLD + `
layout(location=0) in vec4 aI;
uniform float uTile;
out vec4 oA;      // where it stands (on the ground); its height, 0 if no tree grows here
out vec4 oB;      // its width; its kind (0 spruce, 1 larch, 2 birch) plus, in the fraction, the gust on it; autumn; the cloud's shade
void main(){
  float x = uCam.x + mod(aI.x - uCam.x + 0.5 * uTile, uTile) - 0.5 * uTile;
  vec2 p = vec2(x, aI.y);
  float rs = riverS(p), dl = lakeD(p), h0 = terrainHsl(p, rs, dl);
  float keep = step(aI.z, forestAtS(p, h0, abs(rs), dl)) * (1.0 - smoothstep(0.44 * uTile, 0.50 * uTile, abs(x - uCam.x)));
  // what grows here: spruce on the walls; birch on the valley floor and thick round the village; larch among the spruce at the bend
  float vz = valleyZ(p), flr = 1.0 - max(smoothstep(380.0, 760.0, -vz), smoothstep(560.0, 1000.0, vz));
  float bH = bell((x - XH) / 1500.0), bM = bell((x - XM) / 1200.0), ty = fract(aI.w * 91.7 + aI.z * 3.3);
  float birch = clamp(0.04 + 0.34 * flr * (1.0 - 0.45 * bM) + 0.55 * bH + 0.10 * bM, 0.0, 0.85), larch = 0.06 + 0.34 * bM + 0.10 * bH;
  float kind = ty < birch ? 2.0 : (ty < birch + larch ? 1.0 : 0.0);
  float H = (kind > 1.5 ? mix(9.0, 19.0, aI.w) : mix(13.0, 31.0, aI.w * aI.w)) * keep;
  float W = H * (kind > 1.5 ? 0.62 : (kind > 0.5 ? 0.42 : 0.36)) * mix(0.88, 1.12, fract(aI.w * 7.3));
  oA = vec4(p.x, h0 - 0.25, p.y, H);
  oB = vec4(W, kind + 0.9 * windAt(p), autumnAt(x), cloudShade(p));
  gl_Position = vec4(0.0, 0.0, 0.0, 1.0);
}`, `void main(){}`, 'treeEach', ['oA', 'oB']);
    this.prog = program(GLSL_UNI + `
layout(location=0) in vec2 aQ; layout(location=1) in vec4 aI; layout(location=2) in vec4 aA; layout(location=3) in vec4 aB;
out vec2 vQ, vT; out vec3 vW, vSide, vFace; out vec4 vS;      // vS: seed, cloud shade, kind, autumn
void main(){
  float H = aA.w, kind = floor(aB.y), gust = fract(aB.y) / 0.9;
  if (H < 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec3 face = normalize(vec3(uCam.x - aA.x, 0.0, uCam.z - aA.z)), side = vec3(face.z, 0.0, -face.x);
  vec3 pos = aA.xyz + side * (aQ.x * aB.x * 0.5) + vec3(0.0, aQ.y * H, 0.0);
  pos.xz += uWindDir * (gust * aQ.y * aQ.y * 0.012 * H * uWindK);           // the tops nod in the wind
  vQ = aQ; vW = pos; vSide = side; vFace = face; vS = vec4(aI.w, aB.w, kind, aB.z);
  vT = vec2(floor(fract(aI.w * 53.3 + aI.z * 1.7) * 3.0), kind);
  gl_Position = uVP * vec4(pos, 1.0);
}`, GLSL_UNI + GLSL_NOISE + GLSL_WORLD + `
in vec2 vQ, vT; in vec3 vW, vSide, vFace; in vec4 vS; out vec4 o;
uniform sampler2D uAtlas;
void main(){
  vec2 uv = (vT + vec2(mix(0.012, 0.988, vQ.x * 0.5 + 0.5), mix(0.006, 0.994, vQ.y))) / 3.0;
  vec4 tx = texture(uAtlas, uv, -0.6);
  float dist = distance(vW, uCam);
  if (tx.a < mix(0.42, 0.18, smoothstep(120.0, 1100.0, dist))) discard;
  float leaf = step(0.5, tx.b), shade = tx.r, hv = tx.g, sp = vS.z, au = vS.w, seed = vS.x;
  // in winter birch and larch have shed their leaves, but the crown does not vanish: every twig is thick with rime and hung with snow.
  // Some sprays are gone, so that the sky shows through; the rest stand white
  float winter = smoothstep(0.04, 0.30, uEnv.y), rime = leaf * step(0.5, sp) * winter;
  if (rime > 0.0 && hv < 0.26 * winter) discard;      // (by the clump's own number, not a scramble of it: that drew contour lines across a tree seen close)

  vec3 alb;
  if (leaf < 0.5) alb = hv > 0.8 ? vec3(0.50, 0.49, 0.46) : vec3(0.070, 0.054, 0.042);            // birch bark is white; the rest dark
  else if (sp < 0.5) alb = mix(vec3(0.010, 0.030, 0.024), vec3(0.030, 0.066, 0.036), hv);          // spruce: blue-black green
  else {
    // every tree turns in its own time, and every spray within it a little differently:
    // a few trees still half green, most yellow-gold, some deep gold or orange, a few gone to russet
    float turn = fract(seed * 13.7), hv2 = fract(hv * 5.3 + seed * 3.1);
    vec3 green = mix(vec3(0.040, 0.092, 0.026), vec3(0.075, 0.150, 0.036), hv);
    vec3 yel = sp < 1.5 ? mix(vec3(0.360, 0.195, 0.016), vec3(0.560, 0.350, 0.030), hv) : mix(vec3(0.400, 0.265, 0.020), vec3(0.640, 0.480, 0.050), hv);
    vec3 deep = sp < 1.5 ? mix(vec3(0.330, 0.140, 0.012), vec3(0.500, 0.240, 0.020), hv) : mix(vec3(0.400, 0.210, 0.015), vec3(0.580, 0.340, 0.028), hv);
    vec3 rus = mix(vec3(0.150, 0.058, 0.014), vec3(0.260, 0.110, 0.018), hv);
    vec3 turned = turn < 0.12 ? mix(green, yel, 0.40 + 0.5 * hv2) : turn < 0.70 ? mix(yel, deep, 0.22 * hv2) : turn < 0.91 ? mix(deep, yel, 0.30 * hv2) : mix(rus, deep, 0.45 * hv2);
    turned = mix(turned, rus, step(0.93, hv2) * 0.4);             // here and there a spray already brown
    alb = mix(green, turned, au);
  }
  alb = mix(alb, vec3(0.085, 0.070, 0.062), rime);      // what shows between the snow is twig, not leaf
  alb *= 0.80 + 0.36 * fract(seed * 29.3);

  // the card is flat; its light is that of a rounded crown, broken by the light and shade painted into each clump
  float nx = vQ.x;
  vec3 N = normalize(vSide * nx * 0.9 + vFace * sqrt(max(1.0 - nx * nx, 0.0)) + vec3(0.0, 0.30, 0.0));
  vec3 rd = normalize(vW - uCam);
  float ndl = max(dot(N, uSun), 0.0), mu = max(dot(rd, uSun), 0.0);
  float lit = mix(0.10, 1.0, shade * shade * (3.0 - 2.0 * shade));
  vec3 col = alb * (uSunCol * (0.10 + 0.70 * ndl) * lit * vS.y + uAmb * (0.30 + 0.70 * shade));
  // leaves let the light through: looked at toward the sun, the autumn crowns glow
  col += alb * uSunCol * (0.06 + 0.94 * pow(mu, 3.0)) * 0.42 * leaf * step(0.5, sp) * (0.35 + 0.65 * au) * (0.3 + 0.7 * shade) * vS.y;
  // snow lies on the upper side of the boughs; frost whitens the bare twigs
  float sn = clamp(uEnv.y * 2.4, 0.0, 1.0) * (leaf > 0.5 ? smoothstep(0.30, 0.60, shade) : 0.42 * step(hv, 0.8));      // thick on every bough, the dark only showing underneath
  sn = max(sn, rime * (0.62 + 0.34 * shade));
  col = mix(col, vec3(0.78, 0.82, 0.90) * (uSunCol * (ndl * 0.75 + 0.14) * (0.55 + 0.45 * shade) * vS.y + uAmb * 1.2), sn * 0.94);
  col *= mix(1.0, 0.85, uEnv2.x);
  o = vec4(applyFog(col, vW), 1.0);
}`, 'trees');
  },

  // paint the atlas: one tile for each kind and form
  bake() {
    const TW = App.quality > 1 ? 384 : 256, TH = TW * 2, W = TW * 3, H = TH * 3;
    const tex = this.atlas = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const p = program(VS_FULL, GLSL_NOISE + `
in vec2 vUv; out vec4 o;
uniform float uSp, uSeed, uAsp;
float h1(float n){ return fract(sin(n * 127.1 + uSeed * 311.7) * 43758.5453); }
float sdSeg(vec2 p, vec2 a, vec2 b){ vec2 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)); }
float bestZ; vec3 res; float cov;
// whatever is nearest the eye at this point wins: z is how far forward it stands
void put(float inside, float z, float shade, float hue, float mat){ if (inside > 0.5 && z > bestZ) { bestZ = z; res = vec3(shade, hue, mat); cov = 1.0; } }
// a spray of foliage. Not a solid shape: leaves thick toward its middle, thinning to a broken edge, with holes the sky shows through.
// Lit from above: the top of each spray is bright, its underside in its own shade, and sprays further back are darker.
// st: how the leaf texture is stretched (needles hang, so a spruce's is drawn out downward)
void clump(vec2 p, vec2 c, vec2 r, float z, float hue, float thin, float fine, vec2 st){
  vec2 q = (p - c) / r; float d = length(q);
  if (d > 1.4) return;
  float n1 = vnoise(p * 34.0 + c * 31.0), n2 = vnoise(p * st * fine + c * 13.0), n3 = vnoise(p * st * fine * 2.4 + c * 5.0);
  float body = n2 * 0.55 + n3 * 0.45 + (0.95 - thin) * (1.0 - d) - 0.30 * (n1 - 0.5);
  float inside = step(d, 1.12 - 0.45 * n1) * step(0.50, body);
  float top = clamp(0.52 + 0.58 * q.y - 0.22 * q.x, 0.0, 1.0);
  float sh = (0.16 + 0.84 * top) * (0.40 + 0.60 * z) * (0.55 + 0.90 * n3);
  put(inside, z + 0.04 * n2, clamp(sh, 0.0, 1.0), clamp(hue + (n2 - 0.5) * 0.35, 0.0, 1.0), 1.0);
}
void main(){
  // work in units of the card's width, the same across and up: x from -0.5 to 0.5, y from 0 at the ground to Ht at the top
  vec2 p = vec2(vUv.x - 0.5, vUv.y / uAsp); float Ht = 1.0 / uAsp, yn = vUv.y;
  bestZ = -1.0; res = vec3(0.5, 0.5, 1.0); cov = 0.0;
  if (uSp < 1.5) {
    // spruce and larch: whorls of boughs up a straight trunk. The spruce is dense and its boughs hang; the larch is open and feathery
    bool larch = uSp > 0.5;
    float tw = mix(0.026, 0.004, yn);
    if (abs(p.x) < tw && yn < 0.965) put(1.0, 0.22, 0.45 + 0.45 * vnoise(p * vec2(70.0, 12.0)), 0.2, 0.0);
    float N = larch ? 17.0 : 24.0;
    for (int i = 0; i < 24; i++) {
      float fi = float(i); if (fi >= N) break;
      float y0n = mix(larch ? 0.20 : 0.10, 0.955, (fi + 0.7 * h1(fi)) / N), y0 = y0n * Ht;
      float R = pow(1.0 - y0n, larch ? 0.78 : 0.90) * (larch ? 0.50 : 0.47) * (0.70 + 0.48 * h1(fi + 40.0));
      for (int s = 0; s < 2; s++) {
        float fs = float(s), sg = s == 0 ? -1.0 : 1.0, Rs = R * (0.75 + 0.45 * h1(fi * 2.0 + fs + 80.0));
        // a spruce bough sags and lifts again at its tip; a larch bough reaches out nearly level
        vec2 a = vec2(0.0, y0), b = vec2(sg * Rs, y0 - Rs * (larch ? 0.10 : 0.42));
        if (sdSeg(p, a, b) < mix(0.007, 0.002, clamp(abs(p.x) / max(Rs, 0.01), 0.0, 1.0))) put(1.0, 0.26, 0.38, 0.2, 0.0);
        for (int k = 0; k < 5; k++) {
          float fk = float(k), t = (fk + 0.30 + 0.55 * h1(fi * 7.0 + fk + fs * 3.0)) / 5.0;
          vec2 c = mix(a, b, t) - vec2(0.0, Rs * (larch ? 0.03 : 0.07) + 0.012);
          vec2 r = larch ? vec2(Rs * 0.20 + 0.012, Rs * 0.07 + 0.020) : vec2(Rs * 0.21 + 0.012, Rs * 0.11 + 0.026);
          clump(p, c, r, 0.30 + 0.50 * h1(fi * 11.0 + fk * 3.0 + fs), h1(fi * 5.0 + fk + fs * 9.0), larch ? 0.50 : 0.22, larch ? 74.0 : 52.0, larch ? vec2(1.0, 1.0) : vec2(2.2, 0.75));
        }
      }
      // boughs that reach toward us hide the trunk
      for (int k = 0; k < 2; k++) {
        float fk = float(k), hx = h1(fi * 3.0 + fk * 9.0 + 200.0);
        vec2 c = vec2((hx - 0.5) * R * 1.0, y0 - R * (larch ? 0.05 : 0.16) - 0.012);
        clump(p, c, larch ? vec2(R * 0.24 + 0.012, R * 0.08 + 0.020) : vec2(R * 0.26 + 0.012, R * 0.13 + 0.026), 0.60 + 0.40 * h1(fi + fk * 5.0 + 300.0), h1(fi * 13.0 + fk), larch ? 0.50 : 0.22, larch ? 74.0 : 52.0, larch ? vec2(1.0, 1.0) : vec2(2.2, 0.75));
      }
    }
  } else {
    // birch: a white stem marked with black, slender dark branches that rise and then hang, and an airy crown of small leaves
    float bend = 0.045 * sin(yn * 3.1 + uSeed * 5.0) * yn, tw = mix(0.030, 0.005, yn);
    if (abs(p.x - bend) < tw && yn < 0.92) {
      float mark = step(0.72, vnoise(vec2(p.x * 30.0, p.y * 60.0 + uSeed * 9.0)));
      put(1.0, 0.55, mix(0.92, 0.14, mark) * (0.78 + 0.22 * (1.0 - abs(p.x - bend) / tw)), 1.0, 0.0);
    }
    for (int i = 0; i < 11; i++) {
      float fi = float(i), y0n = mix(0.30, 0.86, (fi + h1(fi + 500.0) * 0.8) / 11.0), sg = mod(fi, 2.0) < 0.5 ? -1.0 : 1.0;
      float len = mix(0.46, 0.16, y0n) * (0.70 + 0.5 * h1(fi + 520.0)), an = mix(0.50, 1.00, h1(fi + 540.0));
      vec2 a = vec2(0.045 * sin(y0n * 3.1 + uSeed * 5.0) * y0n, y0n * Ht), b = a + vec2(sg * cos(an), sin(an)) * len;
      if (sdSeg(p, a, b) < mix(0.008, 0.0025, clamp(distance(p, a) / len, 0.0, 1.0))) put(1.0, 0.42, 0.28, 0.6, 0.0);
      for (int k = 0; k < 7; k++) {
        float fk = float(k), t = 0.35 + 0.80 * h1(fi * 9.0 + fk + 600.0);
        vec2 c = mix(a, b, t) + (vec2(h1(fi * 3.0 + fk * 5.0 + 610.0), h1(fi * 7.0 + fk * 2.0 + 620.0)) - 0.5) * vec2(0.20, 0.24);
        float rr = 0.040 + 0.050 * h1(fi * 5.0 + fk + 630.0);
        clump(p, c, vec2(rr * 1.25, rr), 0.25 + 0.75 * h1(fi * 13.0 + fk * 3.0 + 640.0), h1(fi * 17.0 + fk + 650.0), 0.40, 88.0, vec2(1.0));
      }
    }
    for (int k = 0; k < 26; k++) {
      float fk = float(k), an = h1(fk + 700.0) * 6.2832, rad = sqrt(h1(fk + 710.0));
      vec2 c = vec2(0.0, 0.70 * Ht) + vec2(cos(an) * 0.34, sin(an) * 0.36) * rad;
      float rr = 0.038 + 0.045 * h1(fk + 720.0);
      clump(p, c, vec2(rr * 1.25, rr), 0.25 + 0.75 * h1(fk + 730.0), h1(fk + 740.0), 0.42, 88.0, vec2(1.0));
    }
  }
  o = vec4(res, cov);
}`, 'treeBake').use();
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    gl.viewport(0, 0, W, H); gl.clearColor(0.55, 0.5, 1, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    for (let sp = 0; sp < 3; sp++) for (let v = 0; v < 3; v++) {
      gl.viewport(v * TW, sp * TH, TW, TH);
      p.f1('uSp', sp); p.f1('uSeed', 1.3 + sp * 7.1 + v * 3.7); p.f1('uAsp', [0.36, 0.42, 0.62][sp]);
      drawFull();
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(fb);
    gl.bindTexture(gl.TEXTURE_2D, tex); gl.generateMipmap(gl.TEXTURE_2D);
    gl.enable(gl.DEPTH_TEST);
  },
  // step one: every tree, once
  update() {
    const p = this.progA.use(); setGlobals(p, 3600); p.f1('uTile', this.T);
    gl.enable(gl.RASTERIZER_DISCARD); gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindVertexArray(this.vaoA); gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, this.tf);
    gl.beginTransformFeedback(gl.POINTS); gl.drawArrays(gl.POINTS, 0, this.n); gl.endTransformFeedback();
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null); gl.disable(gl.RASTERIZER_DISCARD);
  },
  draw() {
    const p = this.prog.use(); setGlobals(p, 3600);
    gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, this.atlas); p.i1('uAtlas', 5);
    gl.bindVertexArray(this.vao); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.n);
  },
  // trunks near (X, Z): calls hit(wx, wz) for each
  near(X, Z, R, hit) {
    const T = this.T, xt = ((X % T) + T) % T, c0 = Math.floor(xt / this.CELL), z0 = Math.floor((Z - this.Z0) / this.CELL), inst = this.inst;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const cz = z0 + dz; if (cz < 0 || cz >= this.nz) continue;
      const cx = ((c0 + dx) % this.nx + this.nx) % this.nx;
      for (let i = this.head[cx + this.nx * cz]; i >= 0; i = this.next[i]) {
        const wx = X + ((inst[i * 4] - xt + 1.5 * T) % T) - 0.5 * T, wz = inst[i * 4 + 1];
        if (Math.abs(wx - X) > R || Math.abs(wz - Z) > R) continue;
        if (forestAt(wx, wz, terrainH(wx, wz)) > inst[i * 4 + 2]) hit(wx, wz);
      }
    }
  },
};

// ======== 05c_shade.js
// ---------------------------------------------------------------- shade: what stands between the ground and the sun
// A picture of the ground from straight above, some hundreds of metres across and centred on the camera, in which everything that
// throws a shadow is drawn where its shadow falls: every tree as its own silhouette laid out along the ground away from the sun,
// houses, tents and animals as their outlines swept the same way. The ground, the grass, the horse and the houses read it.
// It is drawn afresh every frame, which costs little: no heights are needed, only where things stand.
const Shade = {
  SIZE: 1024, SPAN: 640, casters: [], extra: [], max: 9000,
  init() {
    const S = this.SIZE;
    this.tex = makeTex(S, S, gl.R8, gl.RED, gl.UNSIGNED_BYTE, gl.LINEAR);
    this.fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.progTree = program(`
layout(location=0) in vec2 aQ; layout(location=1) in vec4 aI; layout(location=2) in vec4 aA; layout(location=3) in vec4 aB;
uniform vec4 uM;      // the middle of the map (x, z); 2 / its span; how long a shadow is for each metre of height
uniform vec2 uDir;    // the way shadows fall along the ground
out vec2 vUv; out float vKind;
void main(){
  float H = aA.w, L = H * uM.w; vec2 rel = aA.xz - uM.xy;
  if (H < 0.5 || max(abs(rel.x), abs(rel.y)) * uM.z > 1.0 + L * uM.z) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float kind = floor(aB.y);
  vec2 p = aA.xz + uDir * (aQ.y * L) + vec2(-uDir.y, uDir.x) * (aQ.x * aB.x * 0.5);
  vUv = (vec2(floor(fract(aI.w * 53.3 + aI.z * 1.7) * 3.0), kind) + vec2(mix(0.012, 0.988, aQ.x * 0.5 + 0.5), mix(0.006, 0.994, aQ.y))) / 3.0;
  vKind = kind;
  gl_Position = vec4((p - uM.xy) * uM.z, 0.0, 1.0);
}`, `
in vec2 vUv; in float vKind; out vec4 o;
uniform sampler2D uAtlas; uniform float uBare;
void main(){
  vec4 t = texture(uAtlas, vUv, 1.0);
  if (t.a < 0.30) discard;
  if (uBare > 0.5 && vKind > 0.5 && t.b > 0.5) discard;      // bare trees throw only the shadow of their stems
  o = vec4(0.0, 0.0, 0.0, 1.0);
}`, 'shadeTrees');
    this.progBox = program(`
layout(location=0) in vec2 aP; uniform vec4 uM;
void main(){ gl_Position = vec4((aP - uM.xy) * uM.z, 0.0, 1.0); }`, `out vec4 o; void main(){ o = vec4(0.0, 0.0, 0.0, 1.0); }`, 'shadeBoxes');
    this.buf = new Float32Array(this.max * 2);
    this.vao = gl.createVertexArray(); gl.bindVertexArray(this.vao);
    this.vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo); gl.bufferData(gl.ARRAY_BUFFER, this.buf.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  },
  // something box-like that stands at (x, z): half its length and breadth, which way it is turned, how tall it is
  add(x, z, a, b, rot, h) { this.casters.push({ x, z, a, b, rot, h }); },
  render() {
    const S = this.SIZE, texel = this.SPAN / S, cx = Math.round(G.cam[0] / texel) * texel, cz = Math.round(G.cam[2] / texel) * texel;
    const sl = Math.hypot(G.sun[0], G.sun[2]) || 1, dx = -G.sun[0] / sl, dz = -G.sun[2] / sl, len = Math.min(sl / Math.max(G.sun[1], 0.02), 7);
    G.maskC = [cx, cz, 1 / this.SPAN];
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb); gl.viewport(0, 0, S, S);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.depthMask(false);
    gl.clearColor(1, 1, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    if (G.env2[2] > 0.3) {
      let p = this.progTree.use();
      p.f4('uM', cx, cz, 2 / this.SPAN, len); p.f2('uDir', dx, dz); p.f1('uBare', G.env[1] > 0.17 ? 1 : 0);
      gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, Trees.atlas); p.i1('uAtlas', 5);
      gl.bindVertexArray(Trees.vao); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, Trees.n);
      // boxes: the outline, the outline moved to where the top's shadow falls, and the ground between them
      const b = this.buf, half = this.SPAN / 2 + 40; let k = 0;
      const tri = (ax, az, bx, bz, qx, qz) => { b[k++] = ax; b[k++] = az; b[k++] = bx; b[k++] = bz; b[k++] = qx; b[k++] = qz; };
      for (const list of [this.casters, this.moving || [], this.extra]) for (const c of list) {
        if (Math.abs(c.x - cx) > half || Math.abs(c.z - cz) > half || k > b.length - 80) continue;
        const cs = Math.cos(c.rot), sn = Math.sin(c.rot), ox = dx * c.h * len, oz = dz * c.h * len, P = [];
        for (const q of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) P.push([c.x + q[0] * c.a * cs - q[1] * c.b * sn, c.z + q[0] * c.a * sn + q[1] * c.b * cs]);
        tri(P[0][0], P[0][1], P[1][0], P[1][1], P[2][0], P[2][1]); tri(P[0][0], P[0][1], P[2][0], P[2][1], P[3][0], P[3][1]);
        for (let i = 0; i < 4; i++) {
          const A = P[i], B = P[(i + 1) % 4];
          tri(A[0], A[1], B[0], B[1], B[0] + ox, B[1] + oz); tri(A[0], A[1], B[0] + ox, B[1] + oz, A[0] + ox, A[1] + oz);
        }
      }
      if (k > 0) {
        p = this.progBox.use(); p.f4('uM', cx, cz, 2 / this.SPAN, len);
        gl.bindVertexArray(this.vao); gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo); gl.bufferSubData(gl.ARRAY_BUFFER, 0, b, 0, k);
        gl.drawArrays(gl.TRIANGLES, 0, k / 2);
      }
    }
    this.extra.length = 0;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
  },
};

// ======== 06_loft.js
// ---------------------------------------------------------------- bodies as lofted tubes
// Horse and rider have no stored model. Every frame their skin is swept along the skeleton:
// each tube is a run of rings, a ring is an ellipse with its own back / belly / side radii.
// row = [x, y, z,  rd, rv, rl,  r, g, b, gloss]   (rd: radius toward the ring's "dorsal" side, rv: the opposite side, rl: sideways)

// Catmull-Rom through the control rows, `sub` steps per span
function crRows(ctrl, sub) {
  const out = [], n = ctrl.length, m = ctrl[0].length;
  for (let i = 0; i < n - 1; i++) {
    const p0 = ctrl[Math.max(i - 1, 0)], p1 = ctrl[i], p2 = ctrl[i + 1], p3 = ctrl[Math.min(i + 2, n - 1)];
    for (let s = 0; s < sub; s++) {
      const t = s / sub, t2 = t * t, t3 = t2 * t, row = new Array(m);
      for (let c = 0; c < m; c++) row[c] = 0.5 * (2 * p1[c] + (p2[c] - p0[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (3 * p1[c] - p0[c] - 3 * p2[c] + p3[c]) * t3);
      for (let c = 3; c < 6; c++) if (row[c] < 0.004) row[c] = 0.004;
      out.push(row);
    }
  }
  out.push(ctrl[n - 1].slice());
  return out;
}
// straight spans with `sub` steps each (joints stay sharp)
function linRows(ctrl, sub) {
  const out = [], n = ctrl.length, m = ctrl[0].length;
  for (let i = 0; i < n - 1; i++) for (let s = 0; s < sub; s++) {
    const t = s / sub, row = new Array(m);
    for (let c = 0; c < m; c++) row[c] = ctrl[i][c] + (ctrl[i + 1][c] - ctrl[i][c]) * t;
    out.push(row);
  }
  out.push(ctrl[n - 1].slice());
  return out;
}

class DynMesh {
  constructor(maxV, maxI) {
    this.S = 10; this.v = new Float32Array(maxV * this.S); this.i = new Uint16Array(maxI); this.nv = 0; this.ni = 0; this.sent = -1;
    this.vao = gl.createVertexArray(); gl.bindVertexArray(this.vao);
    this.vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo); gl.bufferData(gl.ARRAY_BUFFER, this.v.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 40, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 40, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 40, 24);
    this.ibo = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.i.byteLength, gl.DYNAMIC_DRAW);
  }
  begin() { this.nv = 0; this.ni = 0; }
  // sweep one tube. ref: a vector across the tube (the ring's sideways axis is built from it). capA / capB: close the ends.
  // paint(k, a, row, out): optional, sets out[0..3] for ring k at angle a (0 = side, +PI/2 = dorsal)
  loft(rows, ref, seg, capA, capB, paint) {
    const v = this.v, S = this.S, n = rows.length, base = this.nv, col = [0, 0, 0, 0];
    let tFirst = null, tLast = null;
    for (let k = 0; k < n; k++) {
      const a = rows[Math.max(k - 1, 0)], b = rows[Math.min(k + 1, n - 1)], P = rows[k];
      let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2]; let l = Math.hypot(tx, ty, tz) || 1; tx /= l; ty /= l; tz /= l;
      // dorsal axis n = ref x t, sideways axis s = t x n
      let nx = ref[1] * tz - ref[2] * ty, ny = ref[2] * tx - ref[0] * tz, nz = ref[0] * ty - ref[1] * tx; l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      const sx = ty * nz - tz * ny, sy = tz * nx - tx * nz, sz = tx * ny - ty * nx;
      if (k === 0) tFirst = [tx, ty, tz]; if (k === n - 1) tLast = [tx, ty, tz];
      for (let j = 0; j < seg; j++) {
        const ang = j / seg * TAU, ca = Math.cos(ang), sa = Math.sin(ang), rn = (sa >= 0 ? P[3] : P[4]) * sa, rs = P[5] * ca, o = (this.nv++) * S;
        v[o] = P[0] + nx * rn + sx * rs; v[o + 1] = P[1] + ny * rn + sy * rs; v[o + 2] = P[2] + nz * rn + sz * rs;
        if (paint) { col[0] = P[6]; col[1] = P[7]; col[2] = P[8]; col[3] = P[9]; paint(k, ang, P, col); v[o + 6] = col[0]; v[o + 7] = col[1]; v[o + 8] = col[2]; v[o + 9] = col[3]; }
        else { v[o + 6] = P[6]; v[o + 7] = P[7]; v[o + 8] = P[8]; v[o + 9] = P[9]; }
      }
    }
    const ix = this.i;
    for (let k = 0; k < n - 1; k++) for (let j = 0; j < seg; j++) {
      const a = base + k * seg + j, b = base + k * seg + (j + 1) % seg, c = a + seg, d = b + seg;
      ix[this.ni++] = a; ix[this.ni++] = c; ix[this.ni++] = b; ix[this.ni++] = b; ix[this.ni++] = c; ix[this.ni++] = d;
    }
    const cap = (row, t, ringBase, sign) => {
      const r = (row[3] + row[4] + row[5]) / 3 * 0.45 * sign, o = (this.nv++) * S, c = this.nv - 1;
      v[o] = row[0] + t[0] * r; v[o + 1] = row[1] + t[1] * r; v[o + 2] = row[2] + t[2] * r;
      v[o + 6] = row[6]; v[o + 7] = row[7]; v[o + 8] = row[8]; v[o + 9] = row[9];
      for (let j = 0; j < seg; j++) {
        const a = ringBase + j, b = ringBase + (j + 1) % seg;
        if (sign < 0) { ix[this.ni++] = c; ix[this.ni++] = b; ix[this.ni++] = a; } else { ix[this.ni++] = c; ix[this.ni++] = a; ix[this.ni++] = b; }
      }
    };
    if (capA) cap(rows[0], tFirst, base, -1);
    if (capB) cap(rows[n - 1], tLast, base + (n - 1) * seg, 1);
  }
  // a flat four-sided face, its corners given anticlockwise as seen from outside, one colour
  quad(a, b, c, d, col, gloss) {
    const v = this.v, S = this.S, base = this.nv, ix = this.i;
    for (const p of [a, b, c, d]) { const o = (this.nv++) * S; v[o] = p[0]; v[o + 1] = p[1]; v[o + 2] = p[2]; v[o + 6] = col[0]; v[o + 7] = col[1]; v[o + 8] = col[2]; v[o + 9] = gloss; }
    ix[this.ni++] = base; ix[this.ni++] = base + 1; ix[this.ni++] = base + 2; ix[this.ni++] = base; ix[this.ni++] = base + 2; ix[this.ni++] = base + 3;
  }
  finish() {
    const v = this.v, S = this.S, ix = this.i;
    for (let k = 0; k < this.nv; k++) { const o = k * S; v[o + 3] = v[o + 4] = v[o + 5] = 0; }
    for (let k = 0; k < this.ni; k += 3) {
      const a = ix[k] * S, b = ix[k + 1] * S, c = ix[k + 2] * S;
      const ux = v[b] - v[a], uy = v[b + 1] - v[a + 1], uz = v[b + 2] - v[a + 2], wx = v[c] - v[a], wy = v[c + 1] - v[a + 1], wz = v[c + 2] - v[a + 2];
      const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
      v[a + 3] += nx; v[a + 4] += ny; v[a + 5] += nz; v[b + 3] += nx; v[b + 4] += ny; v[b + 5] += nz; v[c + 3] += nx; v[c + 4] += ny; v[c + 5] += nz;
    }
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo); gl.bufferSubData(gl.ARRAY_BUFFER, 0, v, 0, this.nv * S);
    if (this.sent !== this.ni) { gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo); gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, ix, 0, this.ni); this.sent = this.ni; }
  }
  draw() { gl.bindVertexArray(this.vao); gl.drawElements(gl.TRIANGLES, this.ni, gl.UNSIGNED_SHORT, 0); }
}

// ======== 06b_sdf.js
// ---------------------------------------------------------------- a body sculpted from soft shapes
// The horse's body is not a stored model. It is a set of ellipsoids and tapered capsules (barrel, shoulder, haunch, crest, jowl...)
// that melt into one another; the surface where their combined distance is zero is turned into a mesh once at start-up.
// Each shape belongs to a bone, and a point on the skin follows the bones whose shapes it lies on.

const SDF = {
  // an ellipsoid, its long axes turned by `rot` in the side-on plane
  ell(cx, cy, cz, rx, ry, rz, rot, k, bone) {
    const c = Math.cos(rot || 0), s = Math.sin(rot || 0), mr = Math.min(rx, ry, rz);
    return { k, bone, d(x, y, z) {
      const dx = x - cx, dy = y - cy, px = (dx * c + dy * s) / rx, py = (dy * c - dx * s) / ry, pz = (z - cz) / rz;
      const k0 = Math.sqrt(px * px + py * py + pz * pz); if (k0 < 1e-5) return -mr;
      const qx = px / rx, qy = py / ry, qz = pz / rz;
      return k0 * (k0 - 1) / Math.sqrt(qx * qx + qy * qy + qz * qz);
    } };
  },
  // a capsule that tapers from radius ra at a to rb at b, flattened sideways by sz (1 = round)
  cap(ax, ay, az, bx, by, bz, ra, rb, sz, k, bone) {
    const s = sz || 1, a2 = az / s, b2 = bz / s, ex = bx - ax, ey = by - ay, ez = b2 - a2, el = ex * ex + ey * ey + ez * ez, sc = Math.min(1, s);
    return { k, bone, d(x, y, z) {
      const px = x - ax, py = y - ay, pz = z / s - a2;
      let h = (px * ex + py * ey + pz * ez) / el; h = h < 0 ? 0 : h > 1 ? 1 : h;
      const qx = px - ex * h, qy = py - ey * h, qz = pz - ez * h;
      return (Math.sqrt(qx * qx + qy * qy + qz * qz) - (ra + (rb - ra) * h)) * sc;
    } };
  },
  smin(a, b, k) { const h = k - Math.abs(a - b); if (h <= 0) return a < b ? a : b; return (a < b ? a : b) - h * h / (4 * k); },
  // the combined field. z is mirrored: shapes are given for the right side only
  make(prims) {
    const n = prims.length;
    return (x, y, z) => { const az = z < 0 ? -z : z; let d = 1e9; for (let i = 0; i < n; i++) { const p = prims[i]; d = SDF.smin(d, p.d(x, y, az), p.k); } return d; };
  },
};

// Surface nets: one vertex in every grid cell the surface passes through, joined across the grid edges it crosses.
// Only the neighbourhood of the surface is sampled finely.
function surfaceNets(f, lo, hi, cell) {
  const nx = Math.ceil((hi[0] - lo[0]) / cell) + 1, ny = Math.ceil((hi[1] - lo[1]) / cell) + 1, nz = Math.ceil((hi[2] - lo[2]) / cell) + 1, C = 4;
  const val = new Float32Array(nx * ny * nz), done = new Uint8Array(nx * ny * nz);
  const cx = Math.ceil((nx - 1) / C) + 1, cy = Math.ceil((ny - 1) / C) + 1, cz = Math.ceil((nz - 1) / C) + 1, cv = new Float32Array(cx * cy * cz);
  for (let k = 0; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++)
    cv[i + cx * (j + cy * k)] = f(lo[0] + Math.min(i * C, nx - 1) * cell, lo[1] + Math.min(j * C, ny - 1) * cell, lo[2] + Math.min(k * C, nz - 1) * cell);
  const near = C * cell * 1.9;
  for (let k = 0; k < cz - 1; k++) for (let j = 0; j < cy - 1; j++) for (let i = 0; i < cx - 1; i++) {
    let m = 1e9, any = 0;
    for (let c = 0; c < 8; c++) { const v = cv[(i + (c & 1)) + cx * ((j + ((c >> 1) & 1)) + cy * (k + (c >> 2)))]; if (Math.abs(v) < m) { m = Math.abs(v); any = v; } }
    const fine = m < near;
    for (let kk = k * C; kk <= Math.min(k * C + C, nz - 1); kk++) for (let jj = j * C; jj <= Math.min(j * C + C, ny - 1); jj++) for (let ii = i * C; ii <= Math.min(i * C + C, nx - 1); ii++) {
      const o = ii + nx * (jj + ny * kk);
      if (done[o] === 2 || (done[o] === 1 && !fine)) continue;
      if (fine) { val[o] = f(lo[0] + ii * cell, lo[1] + jj * cell, lo[2] + kk * cell); done[o] = 2; } else { val[o] = any; done[o] = 1; }
    }
  }
  const pos = [], idx = [], cellV = new Int32Array(nx * ny * nz).fill(-1), g = new Float32Array(8);
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const o = i + nx * (j + ny * k);
    let mask = 0;
    for (let c = 0; c < 8; c++) { const v = val[o + (c & 1) + nx * (((c >> 1) & 1) + ny * (c >> 2))]; g[c] = v; if (v < 0) mask |= 1 << c; }
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (let e = 0; e < 12; e++) {
      const a = edges[e][0], b = edges[e][1], va = g[a], vb = g[b];
      if ((va < 0) === (vb < 0)) continue;
      const t = va / (va - vb);
      sx += (a & 1) + ((b & 1) - (a & 1)) * t; sy += ((a >> 1) & 1) + (((b >> 1) & 1) - ((a >> 1) & 1)) * t; sz += (a >> 2) + ((b >> 2) - (a >> 2)) * t; n++;
    }
    cellV[o] = pos.length / 3;
    pos.push(lo[0] + (i + sx / n) * cell, lo[1] + (j + sy / n) * cell, lo[2] + (k + sz / n) * cell);
    // the three grid edges that leave this cell's first corner: each is shared by four cells
    const in0 = g[0] < 0;
    const quad = (a, b, c, d, flip) => { if (a < 0 || b < 0 || c < 0 || d < 0) return; if (flip) idx.push(a, c, b, a, d, c); else idx.push(a, b, c, a, c, d); };
    if (j > 0 && k > 0 && in0 !== (g[1] < 0)) quad(cellV[o], cellV[o - nx], cellV[o - nx - nx * ny], cellV[o - nx * ny], !in0);
    if (i > 0 && k > 0 && in0 !== (g[2] < 0)) quad(cellV[o], cellV[o - nx * ny], cellV[o - 1 - nx * ny], cellV[o - 1], !in0);
    if (i > 0 && j > 0 && in0 !== (g[4] < 0)) quad(cellV[o], cellV[o - 1], cellV[o - 1 - nx], cellV[o - nx], !in0);
  }
  return { pos: new Float32Array(pos), idx: new Uint32Array(idx), nv: pos.length / 3 };
}

// Mesh a field and send it to the GPU with colour, shade in the creases, and bone weights.
// paint(x, y, z) -> [r, g, b, gloss];  bind(x, y, z, out) fills out[0..3] with bones and out[4..7] with their weights
function bakeBody(f, lo, hi, cell, paint, bind) {
  const net = surfaceNets(f, lo, hi, cell), nv = net.nv, S = 18, v = new Float32Array(nv * S), e = cell * 0.3, bw = new Float32Array(8), a1 = cell * 3, a2 = cell * 8;
  for (let k = 0; k < nv; k++) {
    const x = net.pos[k * 3], y = net.pos[k * 3 + 1], z = net.pos[k * 3 + 2], o = k * S;
    let nx = f(x + e, y, z) - f(x - e, y, z), ny = f(x, y + e, z) - f(x, y - e, z), nz = f(x, y, z + e) - f(x, y, z - e); const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    const ao = 0.60 + 0.40 * sat(0.5 * f(x + nx * a1, y + ny * a1, z + nz * a1) / a1 + 0.5 * f(x + nx * a2, y + ny * a2, z + nz * a2) / a2);
    const c = paint(x, y, z); bind(x, y, z, bw);
    v[o] = x; v[o + 1] = y; v[o + 2] = z; v[o + 3] = nx; v[o + 4] = ny; v[o + 5] = nz;
    v[o + 6] = c[0] * ao; v[o + 7] = c[1] * ao; v[o + 8] = c[2] * ao; v[o + 9] = c[3];
    for (let j = 0; j < 8; j++) v[o + 10 + j] = bw[j];
  }
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, v, gl.STATIC_DRAW);
  const at = (loc, n, off) => { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, n, gl.FLOAT, false, S * 4, off * 4); };
  at(0, 3, 0); at(1, 3, 3); at(2, 4, 6); at(3, 4, 10); at(4, 4, 14);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, net.idx, gl.STATIC_DRAW);
  return { vao, count: net.idx.length, verts: nv };
}

// ---------------------------------------------------------------- a small skeleton for sculpted bodies (cattle, sheep, people)
// Thirteen bones, each a rigid turn of the standing figure about a point of its own.
const Rig = {
  NB: 13,
  make() { const m = new Float32Array(13 * 16); for (let i = 0; i < 13; i++) { const o = i * 16; m[o] = m[o + 5] = m[o + 10] = m[o + 15] = 1; } return m; },
  // bone i: the point `rest` of the standing figure goes to `cur`, and everything round it is turned: first by pitch
  // (in the side-on plane: positive swings a hanging limb forward, or lifts something that points forward), then by roll
  // (about the fore-and-aft axis: positive tips an upright thing to the right), then by yaw (about the vertical: positive turns right)
  set(m, i, rest, cur, pitch, yaw, roll) {
    const cz = Math.cos(pitch), sz = Math.sin(pitch), cx = Math.cos(roll || 0), sx = Math.sin(roll || 0), cy = Math.cos(yaw || 0), sy = Math.sin(yaw || 0);
    const a00 = cz, a01 = -sz, a10 = cx * sz, a11 = cx * cz, a12 = -sx, a20 = sx * sz, a21 = sx * cz, a22 = cx;
    const r00 = cy * a00 - sy * a20, r01 = cy * a01 - sy * a21, r02 = -sy * a22, r20 = sy * a00 + cy * a20, r21 = sy * a01 + cy * a21, r22 = cy * a22;
    const o = i * 16, x = rest[0], y = rest[1], z = rest[2] || 0;
    m[o] = r00; m[o + 1] = a10; m[o + 2] = r20; m[o + 3] = 0; m[o + 4] = r01; m[o + 5] = a11; m[o + 6] = r21; m[o + 7] = 0; m[o + 8] = r02; m[o + 9] = a12; m[o + 10] = r22; m[o + 11] = 0;
    m[o + 12] = cur[0] - (r00 * x + r01 * y + r02 * z); m[o + 13] = cur[1] - (a10 * x + a11 * y + a12 * z); m[o + 14] = (cur[2] || 0) - (r20 * x + r21 * y + r22 * z); m[o + 15] = 1;
  },
  // where a point of the standing figure is now, carried by bone i
  xf(m, i, p) {
    const o = i * 16, x = p[0], y = p[1], z = p[2] || 0;
    return [m[o] * x + m[o + 4] * y + m[o + 8] * z + m[o + 12], m[o + 1] * x + m[o + 5] * y + m[o + 9] * z + m[o + 13], m[o + 2] * x + m[o + 6] * y + m[o + 10] * z + m[o + 14]];
  },
  // one step of a leg: psi is where it is in its stride (0..1), duty the part of the stride it stands on the ground, A how far it swings.
  // Returns [the angle of the limb, how far through the swing it is (0 while standing)]
  step(psi, duty, A) {
    if (psi < duty) return [A * (1 - 2 * psi / duty), 0];
    const q = (psi - duty) / (1 - duty), e = q * q * (3 - 2 * q);
    return [-A + 2 * A * e, q];
  },
};

// which bones carry a point of the skin: the nearer a bone's own shapes, the more it follows that bone.
// sideOff[b]: for a bone of the right side, how many to add for its twin on the left; such bones carry nothing at the midline
function bindPrims(prims, sideOff, soft, mid) {
  const db = new Float32Array(Rig.NB), ord = [];
  return (x, y, z, o) => {
    const az = Math.abs(z); db.fill(1e9);
    for (const p of prims) { const d = p.d(x, y, az); if (d < db[p.bone]) db[p.bone] = d; }
    ord.length = 0; let sum = 0;
    for (let b = 0; b < Rig.NB; b++) {
      if (db[b] > 0.5) continue;
      let w = Math.exp(-Math.max(db[b], 0) / soft);
      const off = sideOff[b] || 0;
      if (off) w *= smooth(0, mid, az);
      if (w < 0.003) continue;
      ord.push([w, off && z < 0 ? b + off : b]);
    }
    if (!ord.length) ord.push([1, 0]);
    ord.sort((a, b) => b[0] - a[0]); ord.length = Math.min(ord.length, 4);
    for (const w of ord) sum += w[0];
    for (let j = 0; j < 4; j++) { o[j] = j < ord.length ? ord[j][1] : 0; o[4 + j] = j < ord.length ? ord[j][0] / sum : 0; }
  };
}

// Like bakeBody, for a body that comes in several coats: one mesh and one set of weights, and a vertex buffer for each colouring.
// info(x, y, z, n) is worked out once for each vertex (n its normal) and handed to every paint(x, y, z, info) -> [r, g, b, gloss]
// opt.fix: bones that carry the figure from the pose it was sculpted in to the one it stands in (arms are sculpted held away
// from the body, so that they do not melt into it, and are brought down here). opt.drop(x, y, z): faces wholly inside are left out.
function bakeSkins(f, lo, hi, cell, info, paints, bind, opt) {
  const net = surfaceNets(f, lo, hi, cell), nv = net.nv, S = 18, base = new Float32Array(nv * S), e = cell * 0.3, bw = new Float32Array(8), a1 = cell * 3, a2 = cell * 8;
  const aos = new Float32Array(nv), infos = new Array(nv);
  for (let k = 0; k < nv; k++) {
    const x = net.pos[k * 3], y = net.pos[k * 3 + 1], z = net.pos[k * 3 + 2], o = k * S;
    let nx = f(x + e, y, z) - f(x - e, y, z), ny = f(x, y + e, z) - f(x, y - e, z), nz = f(x, y, z + e) - f(x, y, z - e); const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    aos[k] = 0.58 + 0.42 * sat(0.5 * f(x + nx * a1, y + ny * a1, z + nz * a1) / a1 + 0.5 * f(x + nx * a2, y + ny * a2, z + nz * a2) / a2);
    infos[k] = info(x, y, z, [nx, ny, nz]); bind(x, y, z, bw);
    base[o] = x; base[o + 1] = y; base[o + 2] = z; base[o + 3] = nx; base[o + 4] = ny; base[o + 5] = nz;
    for (let j = 0; j < 8; j++) base[o + 10 + j] = bw[j];
  }
  let idx = net.idx, moved = null;
  if (opt && opt.drop) {
    const keep = [], P = net.pos, D = opt.drop;
    for (let k = 0; k < idx.length; k += 3) { const a = idx[k] * 3, b2 = idx[k + 1] * 3, c = idx[k + 2] * 3; if (!(D(P[a], P[a + 1], P[a + 2]) && D(P[b2], P[b2 + 1], P[b2 + 2]) && D(P[c], P[c + 1], P[c + 2]))) keep.push(idx[k], idx[k + 1], idx[k + 2]); }
    idx = new Uint32Array(keep);
  }
  if (opt && opt.fix) {
    const m = opt.fix; moved = new Float32Array(nv * 6);
    for (let k = 0; k < nv; k++) {
      const o = k * S, x = base[o], y = base[o + 1], z = base[o + 2], nx = base[o + 3], ny = base[o + 4], nz = base[o + 5]; let px = 0, py = 0, pz = 0, qx = 0, qy = 0, qz = 0;
      for (let j = 0; j < 4; j++) { const w = base[o + 14 + j]; if (w <= 0) continue; const q = base[o + 10 + j] * 16;
        px += w * (m[q] * x + m[q + 4] * y + m[q + 8] * z + m[q + 12]); py += w * (m[q + 1] * x + m[q + 5] * y + m[q + 9] * z + m[q + 13]); pz += w * (m[q + 2] * x + m[q + 6] * y + m[q + 10] * z + m[q + 14]);
        qx += w * (m[q] * nx + m[q + 4] * ny + m[q + 8] * nz); qy += w * (m[q + 1] * nx + m[q + 5] * ny + m[q + 9] * nz); qz += w * (m[q + 2] * nx + m[q + 6] * ny + m[q + 10] * nz); }
      const l = Math.hypot(qx, qy, qz) || 1; moved.set([px, py, pz, qx / l, qy / l, qz / l], k * 6);
    }
  }
  const ibo = gl.createBuffer(); let first = true;
  const vaos = paints.map(paint => {
    const v = base.slice();
    for (let k = 0; k < nv; k++) { const o = k * S, c = paint(v[o], v[o + 1], v[o + 2], infos[k]), ao = aos[k]; v[o + 6] = c[0] * ao; v[o + 7] = c[1] * ao; v[o + 8] = c[2] * ao; v[o + 9] = c[3]; }
    if (moved) for (let k = 0; k < nv; k++) { const o = k * S, q = k * 6; v[o] = moved[q]; v[o + 1] = moved[q + 1]; v[o + 2] = moved[q + 2]; v[o + 3] = moved[q + 3]; v[o + 4] = moved[q + 4]; v[o + 5] = moved[q + 5]; }
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, v, gl.STATIC_DRAW);
    const at = (loc, n, off) => { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, n, gl.FLOAT, false, S * 4, off * 4); };
    at(0, 3, 0); at(1, 3, 3); at(2, 4, 6); at(3, 4, 10); at(4, 4, 14);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    if (first) { gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW); first = false; }
    return vao;
  });
  gl.bindVertexArray(null);
  return { vaos, count: idx.length, verts: nv };
}

// ======== 07_gait.js
// ---------------------------------------------------------------- gaits and the legs that carry them
// Legs are numbered 0 LH, 1 RH, 2 LF, 3 RF (left/right, hind/fore). Phase runs 0..1 over one stride.
const Gait = {
  //         stand  walk   trot  canter gallop
  speed: [0, 1.7, 4.2, 7.8, 12.5],
  stride: [1.2, 1.8, 2.9, 4.4, 5.8],
  // when each foot lands within the stride (the right lead: the right fore lands last)
  off: [[0, .5, .25, .75], [0, .5, .25, .75], [0, .5, .5, 1.0], [0, .30, .30, .62], [0, .12, .38, .50]],
  duty: [.62, .62, .42, .28, .21],
  liftF: [0, .10, .20, .36, .48], liftH: [0, .08, .13, .25, .34],
  bob: [0, .012, .034, .050, .062], pitch: [0, 0.5, 0.4, 4.6, 5.4],
  names: ['立', '慢步', '快步', '跑步', '袭步'],
  out: { g: 0, off: [0, 0, 0, 0], duty: .6, liftF: 0, liftH: 0, bob: 0, pitch: 0, stride: 1.2, one: 0, move: 0 },
  // everything about the gait at speed v, blended between its neighbours
  sample(v) {
    const S = this.speed, o = this.out;
    let k = 0; while (k < 3 && v > S[k + 1]) k++;
    const t = sat((v - S[k]) / (S[k + 1] - S[k])), e = t * t * (3 - 2 * t), L = (a) => lerp(a[k], a[k + 1], e);
    o.g = k + t;
    for (let i = 0; i < 4; i++) o.off[i] = lerp(this.off[k][i], this.off[k + 1][i], e);
    o.duty = L(this.duty); o.liftF = L(this.liftF); o.liftH = L(this.liftH); o.bob = L(this.bob); o.pitch = L(this.pitch);
    o.stride = lerp(this.stride[k], this.stride[k + 1], t);
    // flat out: longer and quicker
    const x = sat((v - 12.5) / 4.0);
    o.stride += x * 1.1; o.duty -= x * 0.03; o.liftF += x * 0.04; o.bob += x * 0.008;
    o.one = smooth(2.0, 3.0, o.g);          // 0: two beats to the stride (walk, trot), 1: one (canter, gallop)
    o.move = smooth(0.05, 0.9, v);           // 0 standing
    return o;
  },
  name(v) { return v < 0.4 ? '' : v < 2.9 ? this.names[1] : v < 6 ? this.names[2] : v < 10.2 ? this.names[3] : v < 14.3 ? this.names[4] : '疾驰'; },
};

// One leg as a chain of four segments in a vertical plane. Angles are from straight down, positive forward.
// The joints do not move freely: they fold together the way a horse's leg does (one number s: 0 standing, 1 folded tight).
// Given where the foot must be, find s for the distance and turn the whole chain to the direction.
function makeLeg(L, a0, k, smin, smax) {
  const N = 56, R = new Float32Array(N), A = new Float32Array(N);
  const end = (s) => { let x = 0, y = 0; for (let i = 0; i < 4; i++) { const a = (a0[i] + k[i] * s) * D2R; x += L[i] * Math.sin(a); y -= L[i] * Math.cos(a); } return [x, y]; };
  for (let i = 0; i < N; i++) { const e = end(lerp(smin, smax, i / (N - 1))); R[i] = Math.hypot(e[0], e[1]); A[i] = Math.atan2(e[0], -e[1]); }
  return {
    L, max: R[0], min: R[N - 1],
    // hip (hx, hy), foot target (fx, fy): fills out[0..9] with the five joints x,y
    solve(hx, hy, fx, fy, out) {
      const dx = fx - hx, dy = fy - hy, len = clamp(Math.hypot(dx, dy), R[N - 1], R[0]), th = Math.atan2(dx, -dy);
      let i = 0; while (i < N - 2 && R[i + 1] > len) i++;
      const f = sat((R[i] - len) / (R[i] - R[i + 1] || 1)), s = lerp(smin, smax, (i + f) / (N - 1)), rot = th - lerp(A[i], A[i + 1], f);
      let x = hx, y = hy; out[0] = x; out[1] = y;
      for (let j = 0; j < 4; j++) { const a = (a0[j] + k[j] * s) * D2R + rot; x += L[j] * Math.sin(a); y -= L[j] * Math.cos(a); out[2 + j * 2] = x; out[3 + j * 2] = y; }
      return s;
    },
  };
}
//                       upper   mid    cannon pastern     standing angles      how they fold
const LEG_FORE = makeLeg([0.30, 0.43, 0.38, 0.19], [-27, 3, 0, 13], [-15, 55, -65, -110], 0, 1.25);
const LEG_HIND = makeLeg([0.33, 0.48, 0.42, 0.19], [23, -38, 8, 18], [35, -45, 35, -20], -0.22, 1.25);

// ======== 08_horse.js
// ---------------------------------------------------------------- the horse and its rider
// Local frame: x forward, y up, z to the horse's right; the ground under it is y = 0.
// a white horse: pale coat, grey skin showing at the muzzle, legs a shade greyer toward the hoof
const COAT = [0.600, 0.585, 0.545], DARK = [0.150, 0.140, 0.140], LEGC = [0.430, 0.420, 0.400], HOOF = [0.100, 0.090, 0.080];
// the rider: a long dark indigo coat with a red sash, and a red scarf that the wind takes
const CLOTH = [0.034, 0.058, 0.115], SASH = [0.400, 0.030, 0.028], TROUSER = [0.040, 0.040, 0.046], BOOT = [0.070, 0.040, 0.025], SKIN = [0.36, 0.22, 0.15], HAIRC = [0.028, 0.022, 0.018], GLOVE = [0.060, 0.038, 0.026];
const BLANKET = [0.300, 0.034, 0.030], TRIM = [0.55, 0.40, 0.12], LEATHER = [0.095, 0.050, 0.026];

// the legs below knee and hock keep crisp joints, so they are swept tubes: [segment, fraction along it, radius front, back, sideways, colour 0 coat .. 1 grey, 2 hoof]
const SKIN_FORE = [[1, .84, .050, .052, .046, .35], [2, 0, .056, .050, .058, .6], [2, .13, .046, .044, .046, .8], [2, .5, .036, .040, .034, 1], [2, .88, .039, .046, .038, 1],
  [3, 0, .047, .056, .046, 1], [3, .34, .039, .043, .039, 1], [3, .60, .049, .046, .048, 1], [3, .66, .054, .048, .052, 2], [3, .85, .061, .050, .057, 2], [3, 1, .068, .053, .062, 2]];
const SKIN_HIND = [[1, .86, .052, .062, .047, .35], [2, 0, .052, .074, .056, .6], [2, .14, .046, .054, .045, .8], [2, .5, .040, .044, .037, 1], [2, .88, .042, .048, .040, 1],
  [3, 0, .049, .058, .047, 1], [3, .34, .040, .043, .040, 1], [3, .60, .050, .047, .049, 1], [3, .66, .055, .049, .053, 2], [3, .85, .062, .051, .058, 2], [3, 1, .069, .054, .063, 2]];

function ik2(a, c, l1, l2, pole) {
  const d = v3.sub(c, a), dist = clamp(v3.len(d), 0.02, l1 + l2 - 0.002), dir = v3.norm(d);
  const proj = (l1 * l1 + dist * dist - l2 * l2) / (2 * dist), h = Math.sqrt(Math.max(l1 * l1 - proj * proj, 0));
  const pp = v3.norm(v3.mad(pole, dir, -v3.dot(pole, dir)));
  return v3.add(v3.mad(a, dir, proj), v3.scale(pp, h));
}

// bones of the sculpted body. Right-side leg bones; the left ones are these + 2.
const BN = { T: 0, H: 1, NL: 2, NU: 3, HD: 4, FE: 5, TI: 6, HU: 9, RA: 10, COUNT: 13 };
const HORSE_FS = `
in vec3 vW, vN, vL; in vec4 vC; in float vY; out vec4 o;
uniform float uCut, uProp;
void main(){
  if (vL.y > uCut) discard;      // first person: the rider's own neck is not in the way
  vec3 N = normalize(vN), V = normalize(uCam - vW), L = uSun;
  float ndl = dot(N, L);
  float sh = shadowAt(vW + N * 0.045) * cloudShade(vW.xz);
  float dif = clamp((ndl + 0.22) / 1.22, 0.0, 1.0); dif *= dif;
  vec3 alb = vC.rgb;
  // the coat is not one flat white: faint dapples, and it darkens when soaked
  float coat = step(0.45, vC.a) * step(vC.a, 0.58);
  alb *= 1.0 + coat * ((vnoise(vL.xy * 9.0 + vL.z * 6.0) - 0.5) * 0.16 + (vnoise(vL.xy * 31.0 + vL.z * 23.0) - 0.5) * 0.06);
  alb *= 1.0 - uEnv2.x * 0.22 * (0.6 + 0.4 * coat);
  if (uProp > 0.5) alb = mix(alb, vec3(0.72, 0.76, 0.84), clamp(uEnv.y * 2.4, 0.0, 1.0) * smoothstep(0.25, 0.55, N.y));      // snow lies on roofs
  float low = smoothstep(0.0, 1.25, vY);
  vec3 amb = uAmb * (0.50 + 0.50 * N.y) + (uSunCol * 0.05 + uAmb * 0.25) * vec3(0.55, 0.75, 0.25) * max(-N.y, 0.0);
  float ao = mix(0.50, 1.0, low) * (0.80 + 0.20 * N.y);
  vec3 col = alb * (uSunCol * dif * sh + amb * ao);
  vec3 H = normalize(L + V);
  col += uSunCol * pow(max(dot(N, H), 0.0), mix(10.0, 48.0, vC.a)) * vC.a * 0.22 * sh * smoothstep(-0.1, 0.3, ndl);
  col += uAmb * uEnv2.x * 0.30 * pow(clamp(1.0 - dot(N, V), 0.0, 1.0), 2.0) * (0.4 + 0.6 * max(N.y, 0.0));
  // the low sun catches the edges that turn away from us
  float fres = pow(clamp(1.0 - dot(N, V), 0.0, 1.0), 3.0);
  float back = clamp(dot(-V, L) * 0.5 + 0.55, 0.0, 1.0);
  col += uSunCol * (alb * 0.28 + 0.030) * fres * back * 1.5 * smoothstep(-0.35, 0.25, ndl) * mix(0.5, 1.0, sh);
  o = vec4(applyFog(col, vW), 1.0);
}`;

const Horse = {
  phase: 0.3, v: 0, pos: [0, 0, 0], f: [1, 0, 0], u: [0, 1, 0], r: [0, 0, 1], model: new Float32Array(16),
  joints: [new Float32Array(10), new Float32Array(10), new Float32Array(10), new Float32Array(10)],
  prevPsi: [0, 0, 0, 0], footfalls: [], rider: true, fp: false,
  bones: new Float32Array(BN.COUNT * 16), rest: null, backY: null,
  A: { tail: [0, 0, 0], tailDir: [-1, 0, 0], crest: [], poll: [0, 0, 0], pollDir: [1, 0, 0], scarf: [0, 0, 0], eye: [0.2, 2.5, 0], nose: [1.5, 1.5, 0], hands: [[0, 0, 0], [0, 0, 0]], bit: [[0, 0, 0], [0, 0, 0]], hoof: [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]], tack: [], knot: [0, 2.4, 0], coat: [], irons: [[], []], leathers: [[], []], scarfDir: [-0.8, -0.6, 0], capA: [0, 1.7, 0], capB: [0, 2.2, 0] },

  // ---- bones: each is a rigid turn in the side-on plane about its own origin, plus a swing sideways (the neck and head, into a turn)
  setBone(i, orx, ory, ocx, ocy, ocz, dth, yaw) {
    const c = Math.cos(dth), s = Math.sin(dth), cy = Math.cos(yaw || 0), sy = Math.sin(yaw || 0), m = this.bones, o = i * 16;
    const r00 = cy * c, r01 = -cy * s, r02 = sy, r10 = s, r11 = c, r20 = -sy * c, r21 = sy * s, r22 = cy;
    m[o] = r00; m[o + 1] = r10; m[o + 2] = r20; m[o + 3] = 0; m[o + 4] = r01; m[o + 5] = r11; m[o + 6] = r21; m[o + 7] = 0; m[o + 8] = r02; m[o + 9] = 0; m[o + 10] = r22; m[o + 11] = 0;
    m[o + 12] = ocx - (r00 * orx + r01 * ory); m[o + 13] = ocy - (r10 * orx + r11 * ory); m[o + 14] = ocz - (r20 * orx + r21 * ory); m[o + 15] = 1;
  },
  // where a point of the standing horse is now, carried by bone i
  xf(i, p) {
    const m = this.bones, o = i * 16, x = p[0], y = p[1], z = p[2] || 0;
    return [m[o] * x + m[o + 4] * y + m[o + 8] * z + m[o + 12], m[o + 1] * x + m[o + 5] * y + m[o + 9] * z + m[o + 13], m[o + 2] * x + m[o + 6] * y + m[o + 10] * z + m[o + 14]];
  },
  xf2(i, j, t, p) { const a = this.xf(i, p), b = this.xf(j, p); return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; },

  init() {
    // the standing horse: the pose everything is sculpted in
    const R = this.rest = { B: [0.70, 1.40], an: 52 * D2R, ah: 56 * D2R, LS: [-0.30, 1.50], hip: [-0.55, 1.28], sho: [0.60, 1.22], J: [] };
    R.dn = [Math.cos(R.an), Math.sin(R.an)]; R.pn = [-R.dn[1], R.dn[0]];
    R.mid = [R.B[0] + R.dn[0] * 0.37, R.B[1] + R.dn[1] * 0.37]; R.poll = [R.B[0] + R.dn[0] * 0.74, R.B[1] + R.dn[1] * 0.74];
    R.dh = [Math.cos(R.ah), -Math.sin(R.ah)]; R.hn = [Math.sin(R.ah), Math.cos(R.ah)];
    for (let i = 0; i < 4; i++) { const hind = i < 2, J = new Float32Array(10); (hind ? LEG_HIND : LEG_FORE).solve(hind ? R.hip[0] : R.sho[0], hind ? R.hip[1] : R.sho[1], hind ? -0.60 : 0.53, 0, J); R.J.push(J); }
    const t0 = performance.now();
    this.sculpt();
    this.sculptMs = Math.round(performance.now() - t0);
    this.mesh = new DynMesh(9000, 54000);
    const vs = GLSL_UNI + `
layout(location=0) in vec3 aP; layout(location=1) in vec3 aN; layout(location=2) in vec4 aC;
uniform mat4 uModel;
out vec3 vW, vN, vL; out vec4 vC; out float vY;
void main(){ vec4 w = uModel * vec4(aP, 1.0); vW = w.xyz; vN = mat3(uModel) * aN; vC = aC; vY = aP.y; vL = aP; gl_Position = uVP * w; }`;
    const skin = `
layout(location=0) in vec3 aP; layout(location=1) in vec3 aN; layout(location=2) in vec4 aC; layout(location=3) in vec4 aB; layout(location=4) in vec4 aK;
uniform mat4 uModel; uniform mat4 uBones[${BN.COUNT}];
mat4 skinM(){ return uBones[int(aB.x)] * aK.x + uBones[int(aB.y)] * aK.y + uBones[int(aB.z)] * aK.z + uBones[int(aB.w)] * aK.w; }
`;
    this.prog = program(vs, GLSL_UNI + GLSL_NOISE + GLSL_WORLD + HORSE_FS, 'horse');
    this.progBody = program(GLSL_UNI + skin + `
out vec3 vW, vN, vL; out vec4 vC; out float vY;
void main(){ mat4 S = skinM(); vec4 l = S * vec4(aP, 1.0); vec4 w = uModel * l; vW = w.xyz; vN = mat3(uModel) * (mat3(S) * aN); vC = aC; vY = l.y; vL = aP; gl_Position = uVP * w; }`,
      GLSL_UNI + GLSL_NOISE + GLSL_WORLD + HORSE_FS, 'horseBody');
    this.progSh = program(`
layout(location=0) in vec3 aP; uniform mat4 uModel, uShVP2;
void main(){ gl_Position = uShVP2 * (uModel * vec4(aP, 1.0)); }`, `void main(){}`, 'horseShadow');
    this.progBodySh = program(skin + `uniform mat4 uShVP2;
void main(){ gl_Position = uShVP2 * (uModel * (skinM() * vec4(aP, 1.0))); }`, `void main(){}`, 'horseBodyShadow');
    Rider.init();
    this.place([0, terrainH(0, 0), 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
    this.update(0, 0, {});
  },

  // ---- the body as soft shapes, meshed once
  sculpt() {
    const R = this.rest, B = R.B, dn = R.dn, pn = R.pn, mid = R.mid, poll = R.poll, dh = R.dh, hn = R.hn, E = SDF.ell, Cp = SDF.cap, hr = -R.ah;
    const Jh = R.J[1], Jf = R.J[3];       // right hind: hip, stifle, hock..; right fore: shoulder, elbow, knee..
    const P = (s, t) => [poll[0] + dh[0] * s + hn[0] * t, poll[1] + dh[1] * s + hn[1] * t];
    const prims = [], add = p => prims.push(p), T = BN.T, H = BN.H;
    // barrel, chest, withers, breast, and the back, broad and nearly flat
    add(E(-0.02, 1.235, 0, 0.65, 0.318, 0.338, 0, 0.10, T));
    add(E(0.32, 1.210, 0, 0.38, 0.338, 0.305, 0, 0.10, T));
    add(E(0.43, 1.500, 0, 0.27, 0.120, 0.075, -0.10, 0.09, T));
    add(E(0.640, 1.262, 0, 0.158, 0.205, 0.236, 0, 0.16, T));
    add(Cp(-0.42, 1.480, 0, 0.26, 1.475, 0, 0.092, 0.092, 1.7, 0.08, T));
    // croup, buttock, point of hip, dock
    add(E(-0.58, 1.305, 0, 0.33, 0.298, 0.312, 0, 0.12, H));
    add(E(-0.70, 1.185, 0.145, 0.20, 0.27, 0.165, 0.10, 0.06, H));
    add(E(-0.43, 1.455, 0.225, 0.10, 0.065, 0.078, 0, 0.06, H));
    add(Cp(-0.83, 1.475, 0, -0.955, 1.375, 0, 0.052, 0.036, 1, 0.035, H));
    // thigh: the great muscle from hip to stifle, the quarter in front of it, the hamstring behind
    add(Cp(Jh[0], Jh[1], 0.185, Jh[2], Jh[3], 0.198, 0.212, 0.130, 0.68, 0.08, BN.FE));
    add(E(-0.40, 1.110, 0.205, 0.130, 0.200, 0.098, 0.25, 0.07, BN.FE));
    add(Cp(-0.80, 1.260, 0.135, -0.665, 0.860, 0.165, 0.112, 0.070, 0.8, 0.07, BN.FE));
    // gaskin, tapering to the hock
    add(Cp(Jh[2], Jh[3], 0.198, Jh[4], Jh[5], 0.180, 0.118, 0.058, 0.74, 0.05, BN.TI));
    add(E(lerp(Jh[2], Jh[4], 0.30), lerp(Jh[3], Jh[5], 0.30), 0.192, 0.080, 0.145, 0.066, -38 * D2R, 0.05, BN.TI));
    // shoulder: the blade sloping down from the withers, the point of the shoulder, the triceps down to the elbow
    add(Cp(0.45, 1.500, 0.120, 0.655, 1.225, 0.228, 0.122, 0.140, 0.74, 0.08, BN.HU));
    add(E(0.605, 1.225, 0.212, 0.070, 0.092, 0.058, 0, 0.12, BN.HU));
    add(Cp(0.455, 1.270, 0.218, Jf[2], Jf[3], 0.212, 0.126, 0.084, 0.56, 0.10, BN.HU));
    // forearm
    add(Cp(Jf[2], Jf[3], 0.218, Jf[4], Jf[5], 0.204, 0.102, 0.057, 0.84, 0.045, BN.RA));
    add(E(lerp(Jf[2], Jf[4], 0.24) + 0.022, lerp(Jf[3], Jf[5], 0.24), 0.210, 0.056, 0.130, 0.050, 3 * D2R, 0.045, BN.RA));
    // neck: deep and narrow, with a crest along the top
    add(Cp(0.61, 1.345, 0, mid[0], mid[1], 0, 0.242, 0.170, 0.66, 0.10, BN.NL));
    add(Cp(B[0] + dn[0] * 0.02 + pn[0] * 0.170, B[1] + dn[1] * 0.02 + pn[1] * 0.170, 0, mid[0] + pn[0] * 0.118, mid[1] + pn[1] * 0.118, 0, 0.075, 0.060, 0.72, 0.05, BN.NL));
    add(Cp(mid[0], mid[1], 0, poll[0], poll[1], 0, 0.170, 0.114, 0.70, 0.08, BN.NU));
    add(Cp(mid[0] + pn[0] * 0.118, mid[1] + pn[1] * 0.118, 0, poll[0] + pn[0] * 0.072, poll[1] + pn[1] * 0.072, 0, 0.060, 0.046, 0.72, 0.05, BN.NU));
    // head: skull, jowl, the long face, muzzle, chin, the bar of the lower jaw, brow over the eye, nostril
    let q = P(0.06, 0.005); add(E(q[0], q[1], 0, 0.140, 0.105, 0.105, hr, 0.06, BN.HD));
    q = P(0.16, -0.078); add(E(q[0], q[1], 0, 0.125, 0.086, 0.088, hr, 0.05, BN.HD));
    const f0 = P(0.14, 0.022), f1 = P(0.50, 0.000); add(Cp(f0[0], f0[1], 0, f1[0], f1[1], 0, 0.088, 0.055, 0.82, 0.05, BN.HD));
    q = P(0.53, -0.012); add(E(q[0], q[1], 0, 0.072, 0.060, 0.066, hr, 0.04, BN.HD));
    q = P(0.49, -0.062); add(E(q[0], q[1], 0, 0.050, 0.034, 0.044, hr, 0.03, BN.HD));
    const j0 = P(0.20, -0.105), j1 = P(0.46, -0.058); add(Cp(j0[0], j0[1], 0.030, j1[0], j1[1], 0.022, 0.046, 0.034, 1, 0.04, BN.HD));
    q = P(0.135, 0.052); add(E(q[0], q[1], 0.086, 0.040, 0.030, 0.030, hr, 0.03, BN.HD));
    q = P(0.555, 0.016); add(E(q[0], q[1], 0.043, 0.024, 0.020, 0.022, hr, 0.02, BN.HD));
    this.prims = prims;
    const f = this.sdf = SDF.make(prims);

    const net = surfaceNets(f, [-1.06, 0.42, -0.40], [1.64, 2.18, 0.40], 0.02), nv = net.nv, S = 18, v = new Float32Array(nv * S);
    const eyeC = P(0.135, 0.052), e = 0.004, db = new Float32Array(BN.COUNT), ord = [];
    for (let k = 0; k < nv; k++) {
      const x = net.pos[k * 3], y = net.pos[k * 3 + 1], z = net.pos[k * 3 + 2], az = Math.abs(z), o = k * S;
      // normal: the way the field grows
      const nx = f(x + e, y, z) - f(x - e, y, z), ny = f(x, y + e, z) - f(x, y - e, z), nz = f(x, y, z + e) - f(x, y, z - e), nl = Math.hypot(nx, ny, nz) || 1;
      v[o] = x; v[o + 1] = y; v[o + 2] = z; v[o + 3] = nx / nl; v[o + 4] = ny / nl; v[o + 5] = nz / nl;
      // which bones carry this point: the nearer a bone's own shapes, the more it follows that bone
      db.fill(1e9);
      for (const p of prims) { const d = p.d(x, y, az); if (d < db[p.bone]) db[p.bone] = d; }
      ord.length = 0; let sum = 0;
      for (let b = 0; b < 11; b++) {
        if (db[b] > 0.5) continue;
        let w = Math.exp(-Math.max(db[b], 0) / 0.045);
        if (b >= BN.FE) w *= smooth(0.0, 0.09, az);              // nothing of a leg at the midline
        if (w < 0.003) continue;
        ord.push([w, b >= BN.FE && z < 0 ? b + 2 : b]);
      }
      ord.sort((a, b) => b[0] - a[0]); ord.length = Math.min(ord.length, 4);
      for (const w of ord) sum += w[0];
      for (let j = 0; j < 4; j++) { v[o + 10 + j] = j < ord.length ? ord[j][1] : 0; v[o + 14 + j] = j < ord.length ? ord[j][0] / sum : 0; }
      // colour
      let c = COAT, gloss = 0.55;
      const hs = (x - poll[0]) * dh[0] + (y - poll[1]) * dh[1];
      if (db[BN.HD] < 0.02) c = v3.lerp(COAT, DARK, smooth(0.36, 0.52, hs));
      if (y < 0.82) c = v3.lerp(c, LEGC, smooth(0.82, 0.52, y) * 0.35);
      if (Math.hypot(x - eyeC[0], y - eyeC[1], az - 0.100) < 0.026) { c = [0.010, 0.009, 0.010]; gloss = 1.0; }
      // the saddle blanket lies over the back and partway down the sides
      if (this.rider && x > -0.22 && x < 0.37 && y > 1.115 && az < 0.40) {
        const edge = Math.min(x + 0.22, 0.37 - x) < 0.040 || y < 1.155;
        c = edge ? TRIM : BLANKET; gloss = 0.1;
      }
      const ux = nx / nl, uy = ny / nl, uz = nz / nl;
      const ao = 0.58 + 0.42 * sat(0.5 * f(x + ux * 0.06, y + uy * 0.06, z + uz * 0.06) / 0.06 + 0.5 * f(x + ux * 0.16, y + uy * 0.16, z + uz * 0.16) / 0.16);
      // nostrils and the line of the mouth
      const hsn = (x - poll[0]) * dh[0] + (y - poll[1]) * dh[1], htn = (x - poll[0]) * hn[0] + (y - poll[1]) * hn[1];
      if (Math.hypot(hsn - 0.565, htn - 0.016, az - 0.046) < 0.017) { c = [0.03, 0.025, 0.03]; gloss = 0.3; }
      v[o + 6] = c[0] * ao; v[o + 7] = c[1] * ao; v[o + 8] = c[2] * ao; v[o + 9] = gloss;
    }
    this.bodyCount = net.idx.length; this.bodyVerts = nv;
    this.bvao = gl.createVertexArray(); gl.bindVertexArray(this.bvao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, v, gl.STATIC_DRAW);
    const at = (loc, n, off) => { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, n, gl.FLOAT, false, S * 4, off * 4); };
    at(0, 3, 0); at(1, 3, 3); at(2, 4, 6); at(3, 4, 10); at(4, 4, 14);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, net.idx, gl.STATIC_DRAW);

    // points on the finished skin that other things hang from: walk in from outside along a direction until the surface is met
    const onSkin = (x, y, z, dx, dy, dz, lift) => { let t = 0.30; for (let i = 0; i < 160 && f(x + dx * t, y + dy * t, z + dz * t) > (lift || 0); i++) t -= 0.0025; return [x + dx * t, y + dy * t, z + dz * t]; };
    R.crest = [];
    for (let s = 0.02; s <= 0.741; s += 0.03) R.crest.push({ p: onSkin(B[0] + dn[0] * s, B[1] + dn[1] * s, 0, pn[0], pn[1], 0, 0.004), t: smooth(0.22, 0.52, s) });
    R.back = x => onSkin(x, 1.36, 0, 0, 1, 0)[1];
    const hp = (s, t, z, lift) => { const a = P(s, 0), b = P(s, t), dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy, z) || 1; return onSkin(a[0], a[1], 0, dx / l, dy / l, z / l, lift === undefined ? 0.005 : lift); };
    R.fore = hp(0.03, 0.10, 0); R.ear = [hp(-0.012, 0.095, -0.058, 0), hp(-0.012, 0.095, 0.058, 0)];
    R.bit = [hp(0.455, -0.030, -0.065), hp(0.455, -0.030, 0.065)]; R.nose = P(0.60, 0.0); R.dock = [-0.955, 1.375, 0];
    // the bridle: straps that lie on the head
    const strap = pts => pts.map(p => hp(p[0], p[1], p[2]));
    R.tack = [];
    for (const s of [-1, 1]) R.tack.push(strap([[0.000, 0.085, s * 0.075], [0.07, 0.03, s * 0.10], [0.16, 0.00, s * 0.10], [0.27, -0.015, s * 0.09], [0.37, -0.025, s * 0.075], [0.455, -0.030, s * 0.065]]));   // cheek pieces
    R.tack.push(strap([[0.075, 0.03, -0.10], [0.090, 0.075, -0.075], [0.098, 0.10, -0.035], [0.100, 0.10, 0], [0.098, 0.10, 0.035], [0.090, 0.075, 0.075], [0.075, 0.03, 0.10]]));   // browband
    R.tack.push(strap([[0.36, 0.08, 0], [0.36, 0.06, 0.05], [0.36, 0.0, 0.075], [0.36, -0.06, 0.05], [0.36, -0.09, 0], [0.36, -0.06, -0.05], [0.36, 0.0, -0.075], [0.36, 0.06, -0.05], [0.36, 0.08, 0]]));   // noseband
    R.tack.push(strap([[0.000, 0.085, -0.075], [-0.020, 0.10, -0.04], [-0.028, 0.10, 0], [-0.020, 0.10, 0.04], [0.000, 0.085, 0.075]]));   // crownpiece, behind the ears
    this.A.tack = R.tack.map(t => t.map(p => p.slice()));
  },

  place(pos, f, u, r) {
    this.pos = pos; this.f = f; this.u = u; this.r = r;
    const m = this.model;
    m[0] = f[0]; m[1] = f[1]; m[2] = f[2]; m[3] = 0; m[4] = u[0]; m[5] = u[1]; m[6] = u[2]; m[7] = 0;
    m[8] = r[0]; m[9] = r[1]; m[10] = r[2]; m[11] = 0; m[12] = pos[0]; m[13] = pos[1]; m[14] = pos[2]; m[15] = 1;
  },
  toWorld(x, y, z) {
    const p = this.pos, f = this.f, u = this.u, r = this.r;
    return [p[0] + f[0] * x + u[0] * y + r[0] * z, p[1] + f[1] * x + u[1] * y + r[1] * z, p[2] + f[2] * x + u[2] * y + r[2] * z];
  },
  dirWorld(x, y, z) { const f = this.f, u = this.u, r = this.r; return [f[0] * x + u[0] * y + r[0] * z, f[1] * x + u[1] * y + r[1] * z, f[2] * x + u[2] * y + r[2] * z]; },

  // pose the skeleton for this instant. opt.turn: -1..1 how hard it is turning (neck and head swing into it)
  update(dt, v, opt) {
    const gs = Gait.sample(v), M = this.mesh, A = this.A, R = this.rest;
    this.v = v;
    if (v > 0.02) this.phase = frac(this.phase + dt * v / gs.stride);
    const ph = this.phase, one = gs.one, mv = gs.move, turn = opt.turn || 0, fast = smooth(6, 13, v);
    this.footfalls.length = 0;

    // ---- the body's own motion within the stride
    const bob2 = -Math.cos(2 * TAU * (ph - gs.duty * 0.5)), bob1 = Math.cos(TAU * (ph - 0.86));
    const yb = (gs.bob * lerp(bob2, bob1, one) - 0.035 * one - 0.02 * sat((v - 12.5) / 4)) * mv;
    const pitch = gs.pitch * D2R * (one * Math.cos(TAU * (ph - 0.10)) + (1 - one) * 0.6 * Math.cos(2 * TAU * (ph - 0.10))) * mv;
    const lumbar = 9 * D2R * one * Math.cos(TAU * (ph - 0.92)) * mv;
    this.yb = yb; this.pitch = pitch;
    const an = lerp(52, 31, smooth(1.5, 4, gs.g)) * D2R + pitch
      + (-4.5 * one * Math.cos(TAU * (ph - 0.62)) - 3.0 * (1 - one) * Math.cos(2 * TAU * (ph - 0.30))) * D2R * mv;
    const slope = clamp(opt.slope || 0, -0.35, 0.35);
    const ah = lerp(56, 40, fast) * D2R + (3 * one * Math.cos(TAU * (ph - 0.62))) * D2R * mv;
    const T = BN.T, H = BN.H;
    this.setBone(T, 0, 1.15, 0, 1.15 + yb, 0, pitch, 0);
    const tf = (x, y) => this.xf(T, [x, y, 0]);
    const ls = tf(R.LS[0], R.LS[1]); this.setBone(H, R.LS[0], R.LS[1], ls[0], ls[1], 0, pitch + lumbar, 0);
    const anS = an - slope * 0.55;
    const Bc = tf(R.B[0], R.B[1]); this.setBone(BN.NL, R.B[0], R.B[1], Bc[0], Bc[1], 0, anS - R.an, -turn * 0.07);
    const mc = this.xf(BN.NL, R.mid); this.setBone(BN.NU, R.mid[0], R.mid[1], mc[0], mc[1], mc[2], anS - R.an, -turn * 0.15);
    const pc = this.xf(BN.NU, R.poll); this.setBone(BN.HD, R.poll[0], R.poll[1], pc[0], pc[1], pc[2], R.ah - ah, -turn * 0.22);

    // ---- legs: where each foot is in its step, then the joints that put it there
    const half = Math.min(gs.duty * gs.stride * 0.5, 0.64) * mv, ang = (J, a) => Math.atan2(J[a + 3] - J[a + 1], J[a + 2] - J[a]);
    for (let i = 0; i < 4; i++) {
      const hind = i < 2, psi = frac(ph - gs.off[i]), lift = (hind ? gs.liftH : gs.liftF) * mv, J = this.joints[i], Jr = R.J[i];
      let xr = 0, y = 0;
      if (psi < gs.duty) xr = half * (1 - 2 * psi / gs.duty);
      else {
        const q = (psi - gs.duty) / (1 - gs.duty), e = q * q * q * (q * (6 * q - 15) + 10);
        xr = -half + 2 * half * e; y = lift * Math.pow(Math.sin(Math.PI * (hind ? Math.pow(q, 0.8) : q)), 1.25);
      }
      const hip = hind ? this.xf(H, R.hip) : tf(R.sho[0], R.sho[1]);
      const neutral = hind ? -0.60 + 0.10 * one * mv : 0.53 + 0.05 * one * mv;
      (hind ? LEG_HIND : LEG_FORE).solve(hip[0], hip[1], neutral + xr, y, J);
      // the two upper bones of the leg carry the muscle of haunch and shoulder
      const b = (hind ? BN.FE : BN.HU) + ((i & 1) ? 0 : 2);
      this.setBone(b, Jr[0], Jr[1], J[0], J[1], 0, ang(J, 0) - ang(Jr, 0), 0);
      this.setBone(b + 1, Jr[2], Jr[3], J[2], J[3], 0, ang(J, 2) - ang(Jr, 2), 0);
      if (psi < this.prevPsi[i] - 0.5 && v > 0.5) this.footfalls.push(i);
      this.prevPsi[i] = psi;
    }

    // ---- what is swept fresh each frame: lower legs, ears, saddle, rider
    M.begin();
    const Z = [0, 0, 1];
    for (let i = 0; i < 4; i++) {
      const hind = i < 2, side = (i & 1) ? 1 : -1, J = this.joints[i], SK = hind ? SKIN_HIND : SKIN_FORE, lc = [], zTop = hind ? 0.180 : 0.204;
      for (let k = 0; k < SK.length; k++) {
        const t = SK[k], j = t[0] * 2, x = lerp(J[j], J[j + 2], t[1]), y = lerp(J[j + 1], J[j + 3], t[1]), fr = (t[0] + t[1]) / 4;
        const c = t[5] >= 2 ? HOOF : v3.lerp(COAT, LEGC, t[5]);
        lc.push([x, y, side * lerp(zTop, 0.165, sat((fr - 0.5) / 0.5)), t[2] * 1.22, t[3] * 1.22, t[4] * 1.22, c[0], c[1], c[2], t[5] >= 2 ? 0.7 : 0.5]);
      }
      M.loft(linRows(lc, 2), Z, 12, true, true);
      const hoof = A.hoof[i]; hoof[0] = J[8]; hoof[1] = J[9]; hoof[2] = side * 0.165;
    }
    // ears: cupped, laid back when it runs, each on its own side
    const dhc = [Math.cos(ah), -Math.sin(ah)], hnc = [Math.sin(ah), Math.cos(ah)];
    const eb = lerp(0.10, 0.95, fast), ed = [hnc[0] * Math.cos(eb) - dhc[0] * Math.sin(eb), hnc[1] * Math.cos(eb) - dhc[1] * Math.sin(eb)];
    for (const s of [0, 1]) {
      const fl = Math.pow(Math.max(0, Math.sin(G.time * (0.9 + s * 0.37) + s * 2.1)), 14) * 0.45 * (1 - fast * 0.6), ce = Math.cos(fl), se = Math.sin(fl);
      const edx = ed[0] * ce - ed[1] * se, edy = ed[1] * ce + ed[0] * se;
      const b = this.xf(BN.HD, R.ear[s]), sg = s ? 1 : -1, er = [];
      for (const t of [[-0.02, .022, .022, .028], [0.03, .018, .022, .038], [0.095, .011, .018, .034], [0.150, .006, .011, .020], [0.190, .002, .003, .004]])
        er.push([b[0] + edx * t[0], b[1] + edy * t[0], b[2] + sg * (0.012 * t[0] / 0.17), t[1], t[2], t[3], COAT[0] * 0.92, COAT[1] * 0.9, COAT[2] * 0.88, 0.3]);
      M.loft(crRows(er, 2), [dhc[0], dhc[1], 0], 8, false, true, (k, a, P, c) => { if (Math.sin(a) < -0.35) { c[0] = 0.30; c[1] = 0.22; c[2] = 0.20; } });
    }

    // anchors for mane, tail and tack (local frame)
    A.tail = this.xf(H, R.dock);
    const ta = pitch + lumbar - lerp(1.20, 0.50, fast); A.tailDir = [-Math.cos(ta), Math.sin(ta), 0];
    A.crest.length = 0;
    for (const c of R.crest) A.crest.push(this.xf2(BN.NL, BN.NU, c.t, c.p));
    A.poll = this.xf(BN.HD, R.fore); A.pollDir = [dhc[0], dhc[1], 0];
    A.bit[0] = this.xf(BN.HD, R.bit[0]); A.bit[1] = this.xf(BN.HD, R.bit[1]);
    A.nose = this.xf(BN.HD, [R.nose[0], R.nose[1], 0]);
    for (let i = 0; i < R.tack.length; i++) for (let j = 0; j < R.tack[i].length; j++) A.tack[i][j] = this.xf(BN.HD, R.tack[i][j]);

    if (this.rider) Rider.build(M, { tf, yb, pitch, ph, one, mv, fast, turn, Bc, an: anS, g: gs.g, slope });
    M.finish();
  },

  lightVP() {
    const c = this.toWorld(0, 1.2, 0), eye = v3.mad(c, G.sun, 34);
    return m4.mul(m4.ortho(-3.6, 3.6, -3.6, 3.6, 1, 90), m4.lookAt(eye, c, [0, 1, 0]));
  },
  drawBody(p) {
    p.m4('uModel', this.model); gl.uniformMatrix4fv(p.u('uBones'), false, this.bones);
    gl.bindVertexArray(this.bvao); gl.drawElements(gl.TRIANGLES, this.bodyCount, gl.UNSIGNED_INT, 0);
  },
  shadowPass() {
    G.shVP = this.lightVP();
    gl.bindFramebuffer(gl.FRAMEBUFFER, App.shadow.fb); gl.viewport(0, 0, App.shadow.size, App.shadow.size);
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.depthFunc(gl.LEQUAL); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
    gl.clearDepth(1); gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1.5, 3);
    let p = this.progBodySh.use(); p.m4('uShVP2', G.shVP); this.drawBody(p);
    if (this.rider) Rider.drawShadow(p);
    p = this.progSh.use(); p.m4('uModel', this.model); p.m4('uShVP2', G.shVP);
    this.mesh.draw();
    Hair.drawShadow();
    gl.disable(gl.POLYGON_OFFSET_FILL);
  },
  draw() {
    let p = this.progBody.use(); setGlobals(p); p.f1('uCut', 99); p.f1('uProp', 0); this.drawBody(p);
    if (this.rider) Rider.draw(p);
    p = this.prog.use(); setGlobals(p); p.m4('uModel', this.model); p.f1('uCut', 99); p.f1('uProp', 0);
    this.mesh.draw();
  },
};

// ======== 08b_rider.js
// ---------------------------------------------------------------- the rider
// Head and trunk are sculpted from soft shapes like the horse and carried by three bones (hips, chest, head).
// Arms and legs are swept fresh each frame, because where they go is solved, not posed.
// Rider space: the seat is the origin, x forward, y up, z to the right; the figure sits upright in it.
const RB = { P: 0, C: 1, H: 2 };
const Rider = {
  bones: new Float32Array(BN.COUNT * 16), torso: null, head: null, backY: null,
  init() {
    for (let i = 0; i < BN.COUNT; i++) { const o = i * 16; this.bones[o] = this.bones[o + 5] = this.bones[o + 10] = this.bones[o + 15] = 1; }
    const t0 = performance.now();
    this.sculptTorso(); this.sculptHead();
    this.sculptMs = Math.round(performance.now() - t0);
    // where the tails of the coat hang from, along the back of its skirt
    this.coatRoot = []; this.coatDir = [];
    for (let i = 0; i < 7; i++) { const th = (i - 3) / 3 * 62 * D2R; this.coatRoot.push([-0.020 - 0.150 * Math.cos(th), -0.082, 0.192 * Math.sin(th)]); this.coatDir.push(v3.norm([-0.80, -0.45, 0.45 * Math.sin(th)])); }
  },
  // a bone: the rest point goes to cur, turned by pitch (negative leans forward), yaw (positive looks right), roll (positive leans right)
  setBone(i, rest, cur, pitch, yaw, roll) {
    const cz = Math.cos(pitch), sz = Math.sin(pitch), cx = Math.cos(roll || 0), sx = Math.sin(roll || 0), cy = Math.cos(yaw || 0), sy = Math.sin(yaw || 0);
    const a00 = cz, a01 = -sz, a02 = 0, a10 = cx * sz, a11 = cx * cz, a12 = -sx, a20 = sx * sz, a21 = sx * cz, a22 = cx;
    const r00 = cy * a00 - sy * a20, r01 = cy * a01 - sy * a21, r02 = cy * a02 - sy * a22, r20 = sy * a00 + cy * a20, r21 = sy * a01 + cy * a21, r22 = sy * a02 + cy * a22;
    const m = this.bones, o = i * 16, x = rest[0], y = rest[1], z = rest[2] || 0;
    m[o] = r00; m[o + 1] = a10; m[o + 2] = r20; m[o + 3] = 0; m[o + 4] = r01; m[o + 5] = a11; m[o + 6] = r21; m[o + 7] = 0; m[o + 8] = r02; m[o + 9] = a12; m[o + 10] = r22; m[o + 11] = 0;
    m[o + 12] = cur[0] - (r00 * x + r01 * y + r02 * z); m[o + 13] = cur[1] - (a10 * x + a11 * y + a12 * z); m[o + 14] = (cur[2] || 0) - (r20 * x + r21 * y + r22 * z); m[o + 15] = 1;
  },
  xf(i, p) {
    const m = this.bones, o = i * 16, x = p[0], y = p[1], z = p[2] || 0;
    return [m[o] * x + m[o + 4] * y + m[o + 8] * z + m[o + 12], m[o + 1] * x + m[o + 5] * y + m[o + 9] * z + m[o + 13], m[o + 2] * x + m[o + 6] * y + m[o + 10] * z + m[o + 14]];
  },

  sculptTorso() {
    const E = SDF.ell, Cp = SDF.cap;
    const f = SDF.make([
      E(0.000, 0.000, 0, 0.130, 0.110, 0.172, 0, 0.07),                 // hips
      E(-0.020, -0.062, 0, 0.150, 0.066, 0.192, 0, 0.06),               // the skirt of the coat, spread on the saddle
      E(0.005, 0.165, 0, 0.098, 0.110, 0.132, 0, 0.09),                 // waist
      E(0.005, 0.168, 0, 0.107, 0.034, 0.142, 0, 0.02),                 // sash
      E(0.012, 0.345, 0, 0.116, 0.150, 0.162, 0, 0.09),                 // ribs
      E(0.058, 0.392, 0.070, 0.060, 0.072, 0.080, 0, 0.08),             // chest
      E(-0.046, 0.400, 0.074, 0.070, 0.105, 0.080, 0, 0.07),            // shoulder blade
      Cp(0.0, 0.468, 0, 0.0, 0.462, 0.150, 0.072, 0.060, 1, 0.07),      // across the shoulders
      E(0.0, 0.455, 0.186, 0.058, 0.066, 0.052, 0, 0.05),               // cap of the shoulder
      Cp(0.004, 0.500, 0, 0.016, 0.615, 0, 0.052, 0.047, 1, 0.045),     // neck
      E(0.004, 0.540, 0, 0.066, 0.028, 0.070, 0, 0.02),                 // the stand collar
    ]);
    this.torso = bakeBody(f, [-0.24, -0.20, -0.30], [0.24, 0.66, 0.30], 0.012, (x, y, z) => {
      const az = Math.abs(z);
      if (y > 0.571) return [SKIN[0], SKIN[1], SKIN[2], 0.2];
      if (y > 0.553 && Math.hypot(x - 0.006, z) > 0.056) return [TRIM[0], TRIM[1], TRIM[2], 0.5];
      if (y > 0.134 && y < 0.203) return [SASH[0], SASH[1], SASH[2], 0.15];
      if (y < -0.098) return [TRIM[0], TRIM[1], TRIM[2], 0.5];
      if (x > 0.02 && az < 0.011 && y > 0.21 && y < 0.535) return [TRIM[0] * 0.8, TRIM[1] * 0.8, TRIM[2] * 0.8, 0.5];   // the coat closes down the front
      return [CLOTH[0], CLOTH[1], CLOTH[2], 0.12];
    }, (x, y, z, o) => {
      const wC = smooth(0.06, 0.26, y), wH = smooth(0.565, 0.615, y);
      o[0] = RB.P; o[1] = RB.C; o[2] = RB.H; o[3] = 0; o[4] = 1 - wC; o[5] = wC * (1 - wH); o[6] = wC * wH; o[7] = 0;
    });
  },

  sculptHead() {
    const E = SDF.ell, Cp = SDF.cap;
    const skin = [
      E(0.004, 0.738, 0, 0.097, 0.104, 0.077, 0, 0.03),                 // cranium
      E(0.040, 0.678, 0, 0.068, 0.084, 0.060, 0, 0.04),                 // face
      E(0.068, 0.624, 0, 0.030, 0.026, 0.032, 0, 0.03),                 // chin
      E(0.012, 0.648, 0.046, 0.036, 0.030, 0.022, 0, 0.03),             // angle of the jaw
      E(0.068, 0.692, 0.046, 0.024, 0.022, 0.022, 0, 0.03),             // cheekbone
      Cp(0.092, 0.730, 0, 0.080, 0.728, 0.048, 0.015, 0.012, 1, 0.02),  // brow
      Cp(0.098, 0.722, 0, 0.116, 0.676, 0, 0.010, 0.013, 1, 0.014),     // nose
      E(0.102, 0.642, 0, 0.016, 0.013, 0.024, 0, 0.015),                // mouth
      E(0.004, 0.702, 0.079, 0.016, 0.030, 0.009, 0, 0.008),            // ear
      Cp(0.006, 0.560, 0, 0.016, 0.625, 0, 0.046, 0.045, 1, 0.03),      // neck
    ];
    const hair = [
      E(-0.010, 0.752, 0, 0.104, 0.098, 0.084, 0, 0.02),                // hair, drawn back
      E(-0.112, 0.742, 0, 0.036, 0.036, 0.036, 0, 0.02),                // the knot it is tied in
    ];
    const f = SDF.make(skin.concat(hair));
    // features that sit on the face are placed by walking in to its surface
    const faceX = (y, z) => { let x = 0.16; while (x > 0 && f(x, y, z) > 0) x -= 0.0005; return x; };
    const F = this.face = { eye: [], brow: [], mouth: [] };
    for (const s of [-1, 1]) {
      F.eye.push([faceX(0.7115, s * 0.0305) - 0.0015, 0.7115, s * 0.0305]);
      F.brow.push([[0.012, 0.7320], [0.024, 0.7352], [0.038, 0.7350], [0.051, 0.7305]].map(q => [faceX(q[1], s * q[0]) + 0.0005, q[1], s * q[0]]));
    }
    F.mouth = [-0.019, -0.009, 0, 0.009, 0.019].map(z => [faceX(0.6405, z) + 0.0002, 0.6405 + Math.abs(z) * 0.06, z]);
    this.head = bakeBody(f, [-0.17, 0.555, -0.11], [0.15, 0.87, 0.11], 0.0065, (x, y, z) => {
      const az = Math.abs(z);
      let dS = 1e9, dH = 1e9;
      for (const p of skin) dS = Math.min(dS, p.d(x, y, az));
      for (const p of hair) dH = Math.min(dH, p.d(x, y, az));
      const isHair = dH < dS + 0.001;
      // a red band tied round the head, lower at the back
      if (Math.abs(y - (0.776 + 0.16 * x)) < 0.011 && y > 0.74) return [SASH[0], SASH[1], SASH[2], 0.15];
      if (isHair) return [HAIRC[0], HAIRC[1], HAIRC[2], 0.6];
      const es = smooth(0.024, 0.010, Math.hypot(y - 0.7115, az - 0.0305)) * (x > 0.06 ? 0.22 : 0);                   // a little shade round the eye
      if (es > 0) return [SKIN[0] * (1 - es), SKIN[1] * (1 - es * 1.1), SKIN[2] * (1 - es * 1.1), 0.2];
      return [SKIN[0], SKIN[1], SKIN[2], 0.2];
    }, (x, y, z, o) => {
      const wH = smooth(0.565, 0.615, y);
      o[0] = RB.C; o[1] = RB.H; o[2] = 0; o[3] = 0; o[4] = 1 - wH; o[5] = wH; o[6] = 0; o[7] = 0;
    });
  },

  // pose the rider on the horse for this instant. M: the mesh that is swept fresh each frame
  build(M, c) {
    const { tf, yb, ph, one, mv, fast, turn, Bc, an, g, slope } = c, A = Horse.A, R = Horse.rest, Z = [0, 0, 1], fp = Horse.fp;
    const dn = [Math.cos(an), Math.sin(an)], pn = [-dn[1], dn[0]];
    if (!this.backY) this.backY = [-0.11, -0.065, 0.00, 0.16, 0.29, 0.345, 0.12].map(x => R.back(x));
    const Y = this.backY, L3 = (p, r, col, gl) => [p[0], p[1], p[2], r[0], r[1], r[2], col[0], col[1], col[2], gl];
    // saddle: cantle behind, seat, a raised pommel in front, and a flap down each side under the leg
    const sad = [[-0.11, Y[0] + 0.012, .018, .018, .050], [-0.065, Y[1] + 0.066, .034, .034, .150], [0.00, Y[2] + 0.036, .046, .030, .172], [0.16, Y[3] + 0.030, .040, .030, .180], [0.29, Y[4] + 0.048, .062, .030, .125], [0.345, Y[5] + 0.020, .022, .020, .055]];
    M.loft(crRows(sad.map(t => { const p = tf(t[0], t[1]); return [p[0], p[1], 0, t[2], t[3], t[4], LEATHER[0], LEATHER[1], LEATHER[2], 0.6]; }), 3), Z, 12, true, true);
    for (const s of [-1, 1]) {
      const a = tf(0.15, Y[3] - 0.02), b = tf(0.19, 1.330), d = tf(0.225, 1.165);
      M.loft(crRows([[a[0], a[1], s * 0.230, .105, .105, .012, ...LEATHER, .6], [b[0], b[1], s * 0.334, .140, .140, .013, ...LEATHER, .6], [d[0], d[1], s * 0.356, .115, .105, .012, ...LEATHER, .6]], 3), Z, 8, true, true);
    }

    // ---- the seat. Out of the saddle and forward as the pace rises; rising to the trot; the body takes up half of the horse's bounce
    const S = tf(0.12, Y[6] + 0.045);
    const trot = smooth(1.4, 2.0, g) * (1 - smooth(2.5, 3.0, g));
    const post = trot * 0.045 * (0.5 - 0.5 * Math.cos(TAU * ph)) * mv;
    // forward over the withers going uphill, upright and a little back coming down
    const lean = Math.max(-0.16, (7 + 30 * fast + 5 * trot + 4 * one * Math.sin(TAU * (ph - 0.30)) * mv) * D2R + Math.atan(slope) * (slope > 0 ? 1.15 : 0.95));
    const breath = (1 - mv) * Math.sin(G.time * 1.3) * 0.012;
    const P0 = [S[0] - 0.02 - 0.05 * fast, S[1] + 0.10 + 0.07 * fast - 0.5 * yb * fast + post, 0];
    this.setBone(RB.P, [0, 0, 0], P0, -lean * 0.5, 0, turn * 0.05);
    const waist = [0, 0.16, 0]; this.setBone(RB.C, waist, this.xf(RB.P, waist), -lean + breath, turn * 0.10, turn * 0.09);
    // the head stays more upright than the back, and looks where the horse is being turned
    const neck = [0.008, 0.585, 0]; this.setBone(RB.H, neck, this.xf(RB.C, neck), -lean * 0.30, turn * 0.34, turn * 0.03);
    A.eye = this.xf(RB.H, [0.100, 0.712, 0]);
    A.scarf = this.xf(RB.C, [-0.078, 0.545, 0]);
    A.scarfDir = v3.norm(v3.sub(this.xf(RB.C, [-0.50, -0.34, 0]), this.xf(RB.C, [0, 0, 0])));     // down the back, whichever way the back leans
    A.capA = this.xf(RB.P, [0, -0.02, 0]); A.capB = this.xf(RB.C, [0.005, 0.45, 0]);                // the trunk, for cloth and hair to lie against
    A.knot = this.xf(RB.H, [-0.142, 0.740, 0]);
    for (let i = 0; i < 7; i++) A.coat[i] = this.xf(RB.P, this.coatRoot[i]);
    if (!fp) {
      const F = this.face, W = [0.40, 0.38, 0.35], I = [0.030, 0.020, 0.018], LIP = [0.210, 0.082, 0.068], row = (q, r, c, gl) => [...this.xf(RB.H, q), r[0], r[1], r[2], c[0], c[1], c[2], gl];
      const fw = v3.norm(v3.sub(this.xf(RB.H, [1, 0, 0]), this.xf(RB.H, [0, 0, 0]))), upv = v3.norm(v3.sub(this.xf(RB.H, [0, 1, 0]), this.xf(RB.H, [0, 0, 0])));
      for (let k = 0; k < 2; k++) {
        // eyes: a pale almond with a dark iris, looking ahead; a brow over each
        const e = F.eye[k];
        M.loft(crRows([row([e[0] - 0.003, e[1], e[2] - 0.0125], [.0008, .0008, .0008], W, .6), row(e, [.0056, .0050, .0050], W, .6), row([e[0] - 0.003, e[1], e[2] + 0.0125], [.0008, .0008, .0008], W, .6)], 3), fw, 6, true, true);
        M.loft(crRows([row([e[0] + 0.0012, e[1], e[2] - 0.0052], [.0008, .0008, .0008], I, 1), row([e[0] + 0.0012, e[1], e[2]], [.0052, .0052, .0046], I, 1), row([e[0] + 0.0012, e[1], e[2] + 0.0052], [.0008, .0008, .0008], I, 1)], 3), fw, 6, true, true);
        M.loft(crRows(F.brow[k].map((q, i) => row(q, i === 0 || i === 3 ? [.0022, .0022, .0020] : [.0034, .0034, .0024], HAIRC, .3)), 2), fw, 5, true, true);
      }
      M.loft(crRows(F.mouth.map((q, i) => row(q, i === 0 || i === 4 ? [.0016, .0016, .0012] : [.0036, .0036, .0020], LIP, .3)), 2), fw, 5, true, true);
    }

    for (const s of [-1, 1]) {
      const si = s < 0 ? 0 : 1;
      // ---- arm: a gloved fist low over the withers, giving and taking with the horse's mouth. In first person it is held where the rider sees it
      const a = this.xf(RB.C, [0.0, 0.452, s * 0.188]);
      const hr = fp ? 0.40 : lerp(0.20, 0.08, fast), hu2 = fp ? 0.285 : lerp(0.265, 0.290, fast);
      const wrist = [Bc[0] + dn[0] * hr + pn[0] * hu2, Bc[1] + dn[1] * hr + pn[1] * hu2, s * (fp ? 0.105 : 0.085)];
      const el = ik2(a, wrist, fp ? 0.33 : 0.30, fp ? 0.31 : 0.28, [-0.35, -1, s * 0.55]);
      const fd = v3.norm(v3.sub(wrist, el)), cuff = v3.mad(wrist, fd, -0.035), k = fp ? 0.80 : 1, a0 = fp ? v3.lerp(a, el, 0.45) : a;
      A.hands[si] = v3.mad(wrist, fd, 0.045);
      const R1 = r => [r * k, r * k, r * k];
      M.loft(crRows([L3(a0, R1(.058), CLOTH, .12), L3(v3.lerp(a0, el, 0.45), R1(.052), CLOTH, .12), L3(v3.lerp(a0, el, 0.88), R1(.045), CLOTH, .12), L3(el, R1(.045), CLOTH, .12),
        L3(v3.lerp(el, cuff, 0.22), R1(.047), CLOTH, .12), L3(v3.lerp(el, cuff, 0.65), R1(.040), CLOTH, .12), L3(v3.mad(cuff, fd, -0.028), R1(.039), CLOTH, .12)], 3), [0, 1, 0.01], 10, true, false);
      M.loft(linRows([L3(v3.mad(cuff, fd, -0.028), R1(.039), CLOTH, .12), L3(v3.mad(cuff, fd, -0.026), R1(.042), TRIM, .5), L3(cuff, R1(.042), TRIM, .5),
        L3(v3.mad(cuff, fd, 0.004), [.031, .031, .032], GLOVE, .45), L3(wrist, [.030, .029, .032], GLOVE, .45)], 1), [0, 1, 0.01], 10, false, false);
      // the fist, taller than it is wide, closed round the rein; the thumb lies along the top
      const kn = v3.mad(wrist, fd, 0.060), tip = v3.mad(wrist, fd, 0.098);
      M.loft(crRows([L3(wrist, [.030, .029, .032], GLOVE, .45), L3(v3.mad(wrist, fd, 0.030), [.037, .032, .044], GLOVE, .45), L3(kn, [.036, .031, .045], GLOVE, .45), L3(tip, [.020, .017, .029], GLOVE, .45)], 2), [0, 1, 0.01], 10, false, true);
      const up = v3.norm(v3.mad([0, 1, 0], fd, -fd[1]));
      M.loft(crRows([L3(v3.mad(v3.mad(wrist, fd, 0.012), up, 0.030), [.012, .012, .012], GLOVE, .45), L3(v3.mad(v3.mad(wrist, fd, 0.045), up, 0.046), [.013, .013, .013], GLOVE, .45),
        L3(v3.mad(v3.mad(wrist, fd, 0.078), up, 0.040), [.010, .010, .010], GLOVE, .45)], 2), [0, 1, 0.01], 6, true, true);

      // ---- leg: knee on the saddle flap, heel down. The coat covers the top of the thigh; tall boots
      const hip = this.xf(RB.P, [0.03, -0.04, s * 0.105]);
      const kn2 = tf(0.42 + 0.02 * fast, 1.355 + 0.06 * fast), ank = tf(0.25 - 0.02 * fast, 0.935 + 0.08 * fast);
      const knee = [kn2[0], kn2[1], s * 0.385], ankle = [ank[0], ank[1], s * 0.408];
      M.loft(crRows([L3(hip, [.098, .098, .092], CLOTH, .12), L3(v3.lerp(hip, knee, 0.28), [.095, .092, .090], CLOTH, .12), L3(v3.lerp(hip, knee, 0.50), [.089, .087, .085], CLOTH, .12)], 3), Z, 10, true, false);
      M.loft(linRows([L3(v3.lerp(hip, knee, 0.50), [.089, .087, .085], CLOTH, .12), L3(v3.lerp(hip, knee, 0.515), [.091, .089, .087], TRIM, .5), L3(v3.lerp(hip, knee, 0.535), [.091, .089, .087], TRIM, .5),
        L3(v3.lerp(hip, knee, 0.545), [.080, .081, .077], TROUSER, .1)], 1), Z, 10, false, false);
      M.loft(crRows([L3(v3.lerp(hip, knee, 0.545), [.080, .081, .077], TROUSER, .1), L3(v3.lerp(hip, knee, 0.80), [.070, .070, .067], TROUSER, .1), L3(knee, [.066, .060, .062], TROUSER, .1),
        L3(v3.lerp(knee, ankle, 0.10), [.058, .062, .058], TROUSER, .1)], 3), Z, 10, false, false);
      M.loft(linRows([L3(v3.lerp(knee, ankle, 0.10), [.058, .062, .058], TROUSER, .1), L3(v3.lerp(knee, ankle, 0.105), [.064, .068, .063], BOOT, .5), L3(v3.lerp(knee, ankle, 0.15), [.062, .067, .061], BOOT, .5)], 1), Z, 10, false, false);
      M.loft(crRows([L3(v3.lerp(knee, ankle, 0.15), [.062, .067, .061], BOOT, .5), L3(v3.lerp(knee, ankle, 0.40), [.051, .066, .053], BOOT, .5), L3(v3.lerp(knee, ankle, 0.78), [.041, .047, .041], BOOT, .5),
        L3(ankle, [.040, .045, .040], BOOT, .5)], 3), Z, 10, false, true);
      // foot: heel, arch, ball, toe; toes a little up
      const heel = [ankle[0] - 0.060, ankle[1] - 0.042, ankle[2]], ball = [ankle[0] + 0.105, ankle[1] - 0.030, ankle[2] + s * 0.006], toe = [ankle[0] + 0.190, ankle[1] - 0.002, ankle[2] + s * 0.010];
      M.loft(crRows([L3(heel, [.036, .036, .036], BOOT, .5), L3(v3.lerp(heel, ball, 0.45), [.039, .039, .040], BOOT, .5), L3(ball, [.047, .047, .031], BOOT, .5), L3(toe, [.034, .034, .022], BOOT, .5)], 3), [0, 1, 0], 10, true, true);
      // stirrup: the iron round the ball of the foot, hung from the saddle by its leather
      const ty = ball[1] - 0.044, zi = ball[2] - s * 0.058, zo = ball[2] + s * 0.060, top = [ball[0], ball[1] + 0.118, ball[2] + s * 0.004];
      A.irons[si] = [[ball[0], ty, zi], [ball[0], ball[1] + 0.045, zi + s * 0.004], top, [ball[0], ball[1] + 0.045, zo - s * 0.004], [ball[0], ty, zo], [ball[0], ty, zi]];
      const lt = tf(0.20, Y[3] - 0.045);
      A.leathers[si] = [[lt[0], lt[1], s * 0.250], v3.lerp([lt[0], lt[1], s * 0.340], top, 0.45), top];
    }
  },

  draw(p) {
    gl.uniformMatrix4fv(p.u('uBones'), false, this.bones);
    p.f1('uCut', Horse.fp ? 0.53 : 99);
    gl.bindVertexArray(this.torso.vao); gl.drawElements(gl.TRIANGLES, this.torso.count, gl.UNSIGNED_INT, 0);
    if (!Horse.fp) { gl.bindVertexArray(this.head.vao); gl.drawElements(gl.TRIANGLES, this.head.count, gl.UNSIGNED_INT, 0); }
    p.f1('uCut', 99);
  },
  drawShadow(p) {
    gl.uniformMatrix4fv(p.u('uBones'), false, this.bones);
    gl.bindVertexArray(this.torso.vao); gl.drawElements(gl.TRIANGLES, this.torso.count, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(this.head.vao); gl.drawElements(gl.TRIANGLES, this.head.count, gl.UNSIGNED_INT, 0);
  },
};

// ======== 08c_camp.js
// ---------------------------------------------------------------- herders' camps: white felt yurts on the sunny bank of the river, smoke rising from them
const Camp = {
  SP: 1100, list: [], smokeT: 0, m: new Float32Array(16),
  init() {
    const M = this.mesh = new DynMesh(700, 4200);
    M.begin();
    const FELT = [0.60, 0.58, 0.54], BAND = [0.40, 0.085, 0.050], DOOR = [0.36, 0.11, 0.05], CROWN = [0.07, 0.06, 0.05];
    const row = (y, r, c) => [0, y, 0, r, r, r, c[0], c[1], c[2], 0.15];
    // a round wall, a patterned band under the eave, a low cone of a roof, the smoke ring at its crown
    M.loft(linRows([row(0, 2.55, FELT), row(0.75, 2.66, FELT), row(1.28, 2.62, FELT), row(1.30, 2.64, BAND), row(1.48, 2.64, BAND), row(1.50, 2.76, FELT),
      row(2.05, 1.62, FELT), row(2.52, 0.52, FELT), row(2.56, 0.46, CROWN), row(2.64, 0.40, CROWN)], 2), [1, 0, 0], 28, false, true, (k, a, P, c) => {
      const aw = Math.atan2(Math.sin(a), Math.cos(a));
      if (Math.abs(aw) < 0.24 && P[1] < 1.26 && P[1] > 0.02) { c[0] = DOOR[0]; c[1] = DOOR[1]; c[2] = DOOR[2]; }                    // the door
      else if (P[1] > 1.52 && P[1] < 2.5 && Math.abs(Math.sin(a * 6)) > 0.985) { c[0] *= 0.5; c[1] *= 0.5; c[2] *= 0.5; }          // ropes over the roof
    });
    M.finish();
  },
  // which camps are near: a few yurts each, every kilometre or so along the river
  update(dt) {
    const L = this.list; L.length = 0;
    const k0 = Math.floor(Game.x / this.SP);
    for (let k = k0 - 2; k <= k0 + 2; k++) {
      if (k !== 0 && hash21(k, 77) < 0.30) continue;
      const x = k * this.SP + 150 + hash21(k, 5) * 700;
      if (Math.abs(x - XH) < 900 || Math.abs(x - XM) < 900 || lakeD(x, 0) < 500) continue;
      const s = riverDZ(x), off = (62 + hash21(k, 9) * 45) * Math.sqrt(1 + s * s), n = 2 + (hash21(k, 13) > 0.5 ? 1 : 0);
      for (let j = 0; j < n; j++) {
        const yx = x + [0, 10.5, -7][j], yz = riverZ(x) + off + [0, 5, 11][j];
        L.push({ x: yx, z: yz, y: terrainH(yx, yz) - 0.06, rot: hash21(k, 20 + j) * 0.8 - 2.0, first: j === 0 });
      }
    }
    Shade.moving = L.map(c => ({ x: c.x, z: c.z, a: 2.4, b: 2.4, rot: 0, h: 2.2 }));
  },
  draw() {
    if (!this.list.length) return;
    const p = Horse.prog.use(); setGlobals(p); p.f1('uCut', 99); p.f1('uProp', 1); p.f1('uSelf', 1);
    const m = this.m;
    for (const c of this.list) {
      const cs = Math.cos(c.rot), sn = Math.sin(c.rot);
      m.set([cs, 0, sn, 0, 0, 1, 0, 0, -sn, 0, cs, 0, c.x, c.y, c.z, 1]);
      p.m4('uModel', m); this.mesh.draw();
    }
    p.f1('uProp', 0); p.f1('uSelf', 0);
  },
};

// ======== 08d_places.js
// ---------------------------------------------------------------- the village of log houses and its smoke, the herds, the swans, and the list of places to ride from

// The village: log cabins with steep plank roofs, some in a yard of rail fence, haystacks and woodpiles beside them. Built once, in place.
// A cabin's faces carry no colour of their own. Each carries where on it a point lies (in metres) and what it is made of,
// and the logs, planks, panes and stones are drawn from that when it is lit.
const MAT = { PLAIN: 0, LOG: 0.1, END: 0.2, ROOF: 0.3, GABLE: 0.4, DOOR: 0.5, WINDOW: 0.6, STONE: 0.7, RAIL: 0.8, HAY: 0.9, PILE: 1.0, SNOW: 1.1 };
const Village = {
  cabins: [], segs: [], chimneys: [], doors: [], I: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
  init() {
    // some two hundred cabins are more than one mesh can index: they are built into several, each closed when it is nearly full
    const r = rng(77), S = 10; let M = null, V, IX; this.meshes = [];
    const fresh = () => { if (M) M.finish(); M = new DynMesh(64000, 110000); V = M.v; IX = M.i; M.begin(); this.meshes.push(M); };
    fresh();
    const vert = (p, c0, c1, c2, m) => { const o = (M.nv++) * S; V[o] = p[0]; V[o + 1] = p[1]; V[o + 2] = p[2]; V[o + 6] = c0; V[o + 7] = c1; V[o + 8] = c2; V[o + 9] = m; };
    // a face whose corners know where they are on it (u, v), with one more number for the whole face
    const quad = (pa, pb, pc, pd, ua, ub, uc, ud, ex, m) => {
      const base = M.nv; vert(pa, ua[0], ua[1], ex, m); vert(pb, ub[0], ub[1], ex, m); vert(pc, uc[0], uc[1], ex, m); vert(pd, ud[0], ud[1], ex, m);
      IX[M.ni++] = base; IX[M.ni++] = base + 1; IX[M.ni++] = base + 2; IX[M.ni++] = base; IX[M.ni++] = base + 2; IX[M.ni++] = base + 3;
    };
    const flat = (pa, pb, pc, pd, c, m) => { const u = [c[0], c[1]]; quad(pa, pb, pc, pd, u, u, u, u, c[2], m || 0); };
    const DARK = [0.040, 0.032, 0.026], WOODC = [0.150, 0.092, 0.048], RAIL = [0.150, 0.130, 0.105], HAY = [0.36, 0.27, 0.10], D = 0.30, ST = 0.26;
    // The village is laid out as the real one is: along its lanes. A main street runs the length of the terrace, two more keep to
    // either side of it, three cross them, and the middle one of those goes down to the bridge. Each household has a cabin set back
    // from the lane and facing it, most in a yard of rail fence, with a shed or two beside or behind and a haystack.
    // Crowded in the middle, opening out toward the edges.
    this.box = [XH - 330, XH + 330, ZH - 170, ZH + 170];
    const lanes = this.roads = [[[-300, -45], [-190, -22], [-70, 12], [55, -2], [170, 26], [295, 58]], [[-235, -112], [-115, -96], [5, -112], [118, -92], [225, -62]],
      [[-205, 72], [-92, 96], [18, 108], [128, 120], [215, 112]], [[-128, -150], [-115, -96], [-96, -22], [-92, 96], [-84, 150]],
      [[30, 168], [18, 108], [24, 4], [5, -112], [14, -235], [12, -330]], [[142, -128], [118, -92], [132, 18], [128, 120], [124, 160]]].map(l => crRows(l.map(q => [XH + q[0] * 1.32, ZH + q[1]]), 14));      // drawn for a shorter village, and stretched along the valley
    const roadD = this.roadD = (x, z) => { let d = 1e9; for (const l of lanes) for (let k = 0; k < l.length - 1; k++) d = Math.min(d, segD(x, z, l[k], l[k + 1])); return d; };
    const total = l => { let t = 0; for (let k = 0; k < l.length - 1; k++) t += Math.hypot(l[k + 1][0] - l[k][0], l[k + 1][1] - l[k][1]); return t; };
    const along = (l, s) => { for (let k = 0; k < l.length - 1; k++) { const A = l[k], B = l[k + 1], len = Math.hypot(B[0] - A[0], B[1] - A[1]); if (s <= len || k === l.length - 2) { const u = Math.min(1, s / len); return [lerp(A[0], B[0], u), lerp(A[1], B[1], u), (B[0] - A[0]) / len, (B[1] - A[1]) / len]; } s -= len; } };
    const plots = [], core = (x, z) => bell((x - XH) / 450) * bell((z - ZH) / 240);
    for (const l of lanes) { const T = total(l); for (const side of [1, -1]) for (let s = 3 + r() * 12; s < T - 4;) {
      const q = along(l, s), c = core(q[0], q[1]);
      const a = 2.9 + r() * 2.1, b = 2.2 + r() * 0.9, yard = r() < 0.62, fa = a + 2.3 + r() * 2.2, fb = b + 2.3 + r() * 1.8, set = (yard ? fb : b + 2.4) + 3.3 + r() * 4.5;
      const x = q[0] - q[3] * side * set, z = q[1] + q[2] * side * set, rad = yard ? Math.hypot(fa, fb) * 0.85 : Math.hypot(a, b) + 1.2;
      let rot = Math.atan2(q[3], q[2]) + (side > 0 ? Math.PI : 0) + (r() - 0.5) * 0.36; if (r() < 0.14) rot += (r() < 0.5 ? 1 : -1) * Math.PI / 2;      // a few stand gable to the lane
      const ok = r() > (1 - c) * 0.42 && villageAt(x, z) > 0.30 && riverD(x, z) > 34 && roadD(x, z) > Math.min(set - 0.3, rad + 1) && !plots.some(o => Math.hypot(o.x - x, o.z - z) < o.rad + rad + 1.0);
      if (ok) { plots.push({ x, z, rot, a, b, nc: r() < 0.4 ? 9 : 8, yard, fa, fb, rad, shed: false }); s += (yard ? 2 * fa : 2 * a + 3) + 2 + r() * lerp(16, 4, c); } else s += 6;
    } }
    for (const h of plots.slice()) {
      const hc = Math.cos(h.rot), hs = Math.sin(h.rot), put = (lx, lz) => [h.x + lx * hc - lz * hs, h.z + lx * hs + lz * hc];
      const free = (x, z, rad) => villageAt(x, z) > 0.26 && riverD(x, z) > 30 && roadD(x, z) > rad + 2.6 && !plots.some(o => o !== h && Math.hypot(o.x - x, o.z - z) < o.rad + rad + 0.6);
      const n = r() < 0.78 ? (r() < 0.4 ? 2 : 1) : 0;
      for (let i = 0; i < n; i++) {
        const big = r() < 0.25, sa = big ? 2.6 + r() * 1.2 : 1.6 + r() * 1.0, sb = big ? 2.0 + r() * 0.5 : 1.3 + r() * 0.6, srad = Math.hypot(sa, sb) + 0.4, beside = r() < 0.6, sd = r() < 0.5 ? 1 : -1;
        const q = beside ? put(sd * ((h.yard ? h.fa : h.a) + 1.0 + sb), -r() * 3) : put((r() - 0.5) * 2 * h.a, -((h.yard ? h.fb : h.b) + 1.0 + sb));
        if (free(q[0], q[1], srad)) plots.push({ x: q[0], z: q[1], rot: h.rot + (beside ? Math.PI / 2 : 0) + (r() - 0.5) * 0.3, a: sa, b: sb, nc: big ? 7 : r() < 0.5 ? 5 : 6, yard: false, fa: 0, fb: 0, rad: srad, shed: true });
      }
      if (r() < 0.45) { const sd = r() < 0.5 ? 1 : -1, q = put(sd * ((h.yard ? h.fa : h.a) + 3.2 + r() * 2), 1 - r() * 5); if (free(q[0], q[1], 1.9)) { h.hay = q; plots.push({ x: q[0], z: q[1], rad: 1.9, stack: true }); } }
    }
    for (const pl of plots) {
      if (pl.stack) continue;
      if (M.nv > 50000) fresh();
      const cx = pl.x, cz = pl.z, rot = pl.rot, cs = Math.cos(rot), sn = Math.sin(rot), shed = pl.shed;
      const a = pl.a, b = pl.b, nc = pl.nc, base = 0.22, hw = base + nc * D, hr = hw + b * (shed ? 0.80 : 1.02), seed = r(), yard = pl.yard, dh = shed ? hw - base - 0.14 : 1.9;
      const cy = terrainH(cx, cz) - 0.12;
      const W = (lx, ly, lz) => [cx + lx * cs - lz * sn, cy + ly, cz + lx * sn + lz * cs];
      const GP = (lx, ly, lz) => { const x = cx + lx * cs - lz * sn, z = cz + lx * sn + lz * cs; return [x, terrainH(x, z) + ly, z]; };       // standing on the ground itself
      const box = (x0, y0, z0, x1, y1, z1, c, m, P) => {
        P = P || W;
        flat(P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), P(x1, y0, z1), c, m); flat(P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1), P(x0, y1, z0), c, m);
        flat(P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1), c, m); flat(P(x0, y0, z0), P(x0, y1, z0), P(x1, y1, z0), P(x1, y0, z0), c, m);
        flat(P(x0, y1, z0), P(x0, y1, z1), P(x1, y1, z1), P(x1, y1, z0), c, m);
      };
      // a course of stones under the walls
      box(-a - 0.10, -0.5, -b - 0.10, a + 0.10, base, b + 0.10, [0, 0, 0], MAT.STONE);
      // walls: each one face; its logs are drawn from the height (v) and the length along it (u)
      const wall = (x0, z0, x1, z1, len, k) => quad(W(x0, base, z0), W(x1, base, z1), W(x1, hw, z1), W(x0, hw, z0), [0, 0], [len, 0], [len, hw - base], [0, hw - base], seed + k * 0.13, MAT.LOG);
      wall(-a, b, a, b, 2 * a, 0); wall(a, -b, -a, -b, 2 * a, 1); wall(a, b, a, -b, 2 * b, 2); wall(-a, -b, -a, b, 2 * b, 3);
      // the corners: the logs of one wall and of the other run on past each other, course by course, and show their sawn ends
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (let c = 0; c < nc; c++) {
        const y0 = base + c * D + 0.015, y1 = base + (c + 1) * D - 0.015, v0 = c * D, v1 = (c + 1) * D, es = seed + c * 0.071 + sx * 0.3 + sz * 0.11;
        if (c % 2 === 0) {
          const X0 = sx * a, X1 = sx * (a + ST), Z0 = sz * b, Z1 = sz * (b - 0.27);
          quad(W(X1, y0, Z1), W(X1, y0, Z0), W(X1, y1, Z0), W(X1, y1, Z1), [-1, -1], [1, -1], [1, 1], [-1, 1], es, MAT.END);
          quad(W(X0, y0, Z0), W(X1, y0, Z0), W(X1, y1, Z0), W(X0, y1, Z0), [0, v0], [ST, v0], [ST, v1], [0, v1], seed, MAT.LOG);
          quad(W(X0, y0, Z1), W(X1, y0, Z1), W(X1, y1, Z1), W(X0, y1, Z1), [0, v0], [ST, v0], [ST, v1], [0, v1], seed + 0.5, MAT.LOG);
          flat(W(X0, y1, Z0), W(X1, y1, Z0), W(X1, y1, Z1), W(X0, y1, Z1), WOODC);
        } else {
          const Z0 = sz * b, Z1 = sz * (b + ST), X0 = sx * a, X1 = sx * (a - 0.27);
          quad(W(X1, y0, Z1), W(X0, y0, Z1), W(X0, y1, Z1), W(X1, y1, Z1), [-1, -1], [1, -1], [1, 1], [-1, 1], es, MAT.END);
          quad(W(X0, y0, Z0), W(X0, y0, Z1), W(X0, y1, Z1), W(X0, y1, Z0), [0, v0], [ST, v0], [ST, v1], [0, v1], seed + 0.26, MAT.LOG);
          quad(W(X1, y0, Z0), W(X1, y0, Z1), W(X1, y1, Z1), W(X1, y1, Z0), [0, v0], [ST, v0], [ST, v1], [0, v1], seed + 0.7, MAT.LOG);
          flat(W(X0, y1, Z0), W(X0, y1, Z1), W(X1, y1, Z1), W(X1, y1, Z0), WOODC);
        }
      }
      // gables, boarded upright, with the dark opening of the loft
      for (const sx of [-1, 1]) quad(W(sx * a, hw, -b), W(sx * a, hw, b), W(sx * a, hr, 0), W(sx * a, hr, 0), [-b, 0], [b, 0], [0, hr - hw], [0, hr - hw], seed + sx * 0.2, MAT.GABLE);
      // the roof: steep, of planks laid down the slope, overhanging all round; dark beneath
      const ov = 0.75, ox = a + 0.65, ze = b + ov, he = hw - ov * (hr - hw) / b, sl = Math.hypot(ze, hr - he), th = 0.09;
      for (const sz of [-1, 1]) {
        quad(W(-ox, he, sz * ze), W(ox, he, sz * ze), W(ox, hr + 0.05, 0), W(-ox, hr + 0.05, 0), [0, sl], [2 * ox, sl], [2 * ox, 0], [0, 0], seed + sz * 0.31, MAT.ROOF);
        flat(W(-ox, he - th, sz * ze), W(ox, he - th, sz * ze), W(ox, hr + 0.05 - th, 0), W(-ox, hr + 0.05 - th, 0), DARK);
        flat(W(-ox, he, sz * ze), W(ox, he, sz * ze), W(ox, he - th, sz * ze), W(-ox, he - th, sz * ze), WOODC);
        for (const sx of [-1, 1]) flat(W(sx * ox, he, sz * ze), W(sx * ox, hr + 0.05, 0), W(sx * ox, hr + 0.05 - th, 0), W(sx * ox, he - th, sz * ze), WOODC);
      }
      // the snow that lies on the roof: a slab on each slope and a cap along the ridge. It is built at its full depth and pressed
      // flat by the vertex shader when there is no snow (each vertex carries the way it is pressed)
      {
        const rz = hr + 0.05 - he, rl = Math.hypot(ze, rz), ny = ze / rl, nzl = rz / rl, T = 0.30, e = 0.10, X = ox + e, Y = he - e * rz / ze, R = hr + 0.05;
        const sv = (lx, ly, lz, sz, up) => { const n = [-nzl * sz * sn, ny, nzl * sz * cs], q = W(lx, ly, lz); vert([q[0] + n[0] * T * up, q[1] + n[1] * T * up, q[2] + n[2] * T * up], n[0] * up, n[1] * up, n[2] * up, MAT.SNOW); };
        const face = () => { const q = M.nv - 4; IX[M.ni++] = q; IX[M.ni++] = q + 1; IX[M.ni++] = q + 2; IX[M.ni++] = q; IX[M.ni++] = q + 2; IX[M.ni++] = q + 3; };
        for (const sz of [-1, 1]) {
          const Z = sz * (ze + e);
          sv(-X, Y, Z, sz, 1); sv(X, Y, Z, sz, 1); sv(X, R, 0, sz, 1); sv(-X, R, 0, sz, 1); face();
          sv(-X, Y, Z, sz, 0); sv(X, Y, Z, sz, 0); sv(X, Y, Z, sz, 1); sv(-X, Y, Z, sz, 1); face();
          for (const sx of [-1, 1]) { sv(sx * X, Y, Z, sz, 0); sv(sx * X, R, 0, sz, 0); sv(sx * X, R, 0, sz, 1); sv(sx * X, Y, Z, sz, 1); face(); }
        }
        sv(-X, R, 0, -1, 1); sv(X, R, 0, -1, 1); sv(X, R, 0, 1, 1); sv(-X, R, 0, 1, 1); face();
        for (const sx of [-1, 1]) { sv(sx * X, R, 0, -1, 0); sv(sx * X, R, 0, -1, 1); sv(sx * X, R, 0, 1, 1); sv(sx * X, R, 0, 1, 0); face(); }
      }
      // door and windows, standing a little proud of the logs
      const dx = (r() - 0.5) * a * 0.5, zf = b + 0.035, blue = r() < 0.6 ? 1 : 0;
      const dp = GP(dx, 0, b + 1.15), door = { x: dp[0], z: dp[2], yaw: rot + Math.PI / 2, yard, cx, cz, b };      // where someone stands at this door, looking out
      quad(W(dx - 0.52, base, zf), W(dx + 0.52, base, zf), W(dx + 0.52, base + dh, zf), W(dx - 0.52, base + dh, zf), [0, 0], [1, 0], [1, 1], [0, 1], seed, MAT.DOOR);
      const win = (p0, p1, p2, p3) => quad(p0, p1, p2, p3, [0, 0], [1, 0], [1, 1], [0, 1], blue + 0.45 * (r() < 0.7 ? 1 : 0) + 0.02, MAT.WINDOW);
      if (!shed) for (const wx of [dx + 1.75, dx - 1.75]) if (Math.abs(wx) < a - 0.75) win(W(wx - 0.45, base + 0.95, zf), W(wx + 0.45, base + 0.95, zf), W(wx + 0.45, base + 1.80, zf), W(wx - 0.45, base + 1.80, zf));
      if (!shed) win(W(a + 0.035, base + 0.95, 0.45), W(a + 0.035, base + 0.95, -0.45), W(a + 0.035, base + 1.80, -0.45), W(a + 0.035, base + 1.80, 0.45));
      // chimney
      if (!shed) {
        const chx = a * (0.2 + r() * 0.4) * (r() < 0.5 ? 1 : -1), chz = -b * 0.38, chy = hr - (hr - hw) * 0.38;
        box(chx - 0.24, chy - 0.6, chz - 0.24, chx + 0.24, hr + 0.50, chz + 0.24, [0, 0, 0], MAT.STONE);
        box(chx - 0.30, hr + 0.50, chz - 0.30, chx + 0.30, hr + 0.58, chz + 0.30, DARK);
        if (r() < 0.50) this.chimneys.push([...W(chx, hr + 0.62, chz), r()]);
      }
      // firewood stacked against the back wall
      if (!shed && r() < 0.6) {
        const px = -a + 0.3 + r() * (2 * a - 2.9), pl = 1.6 + r() * 1.0, ph = 0.8 + r() * 0.4, zb = -b - 0.02, zo = -b - 0.50;
        quad(W(px + pl, base - 0.1, zo), W(px, base - 0.1, zo), W(px, base - 0.1 + ph, zo), W(px + pl, base - 0.1 + ph, zo), [0, 0], [pl, 0], [pl, ph], [0, ph], seed, MAT.PILE);
        flat(W(px, base - 0.1 + ph, zo), W(px + pl, base - 0.1 + ph, zo), W(px + pl, base - 0.1 + ph, zb), W(px, base - 0.1 + ph, zb), WOODC);
        for (const ex of [px, px + pl]) flat(W(ex, base - 0.1, zo), W(ex, base - 0.1 + ph, zo), W(ex, base - 0.1 + ph, zb), W(ex, base - 0.1, zb), WOODC);
      }
      this.cabins.push({ x: cx, z: cz, r: Math.hypot(a, b) + 0.9, house: !shed });
      Shade.add(cx, cz, a + 0.55, b + 0.65, rot, hr * 0.80);
      // the yard: posts and two rails, open in front of the door
      if (yard) {
        const fa = pl.fa, fb = pl.fb;
        door.gate = GP(0, 0, fb + 1.8);
        const pts = [[-fa, -fb], [fa, -fb], [fa, fb], [2.6, fb], null, [-2.6, fb], [-fa, fb], [-fa, -fb]];
        for (let k = 0; k < pts.length - 1; k++) {
          const p0 = pts[k], p1 = pts[k + 1]; if (!p0 || !p1) continue;
          const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), n = Math.max(1, Math.round(len / 3.2));
          for (let q = 0; q < n; q++) {
            const u0 = q / n, u1 = (q + 1) / n, ax = lerp(p0[0], p1[0], u0), az = lerp(p0[1], p1[1], u0), bx = lerp(p0[0], p1[0], u1), bz = lerp(p0[1], p1[1], u1);
            box(ax - 0.07, 0, az - 0.07, ax + 0.07, 1.22, az + 0.07, RAIL, MAT.RAIL, GP);
            for (const y of [0.50, 0.98]) flat(GP(ax, y, az), GP(bx, y, bz), GP(bx, y + 0.11, bz), GP(ax, y + 0.11, az), RAIL, MAT.RAIL);
            const A = GP(ax, 0, az), B = GP(bx, 0, bz); this.segs.push([A[0], A[2], B[0], B[2]]);
          }
          if (k === pts.length - 2 || !pts[k + 2]) { const e = pts[k + 1]; box(e[0] - 0.07, 0, e[1] - 0.07, e[0] + 0.07, 1.22, e[1] + 0.07, RAIL, MAT.RAIL, GP); }
        }
      }
      if (!shed) { if (!door.gate) door.gate = GP(dx, 0, b + 2.6); door.gx = door.gate[0]; door.gz = door.gate[2]; this.doors.push(door); }      // and the way in from outside
      // a haystack beside some
      if (pl.hay) {
        const hx = pl.hay[0], hz = pl.hay[1], hy = terrainH(hx, hz) - 0.1;
        M.loft(crRows([[0, 1.45], [0.8, 1.6], [1.6, 1.25], [2.15, 0.55], [2.35, 0.06]].map(t => [hx, hy + t[0], hz, t[1], t[1], t[1], HAY[0] * (0.8 + r() * 0.3), HAY[1], HAY[2], MAT.HAY]), 2), [1, 0, 0], 12, false, true);
        this.cabins.push({ x: hx, z: hz, r: 2.1 });
        Shade.add(hx, hz, 1.4, 1.4, 0, 1.9);
      }
    }
    // the bridge: planks on log piers where the lane comes down to the river, a rail along either side
    {
      const l = lanes[4]; let best = 0, bd = 1e9; for (let k = 0; k < l.length; k++) { const d = riverD(l[k][0], l[k][1]); if (d < bd) { bd = d; best = k; } }
      const C = l[best], A = l[Math.max(best - 1, 0)], B2 = l[Math.min(best + 1, l.length - 1)]; let tx = B2[0] - A[0], tz = B2[1] - A[1]; const tl = Math.hypot(tx, tz); tx /= tl; tz /= tl;
      const Lh = 21, ramp = 6, wb = 2.1, Y = Math.max(terrainH(C[0] - tx * Lh, C[1] - tz * Lh), terrainH(C[0] + tx * Lh, C[1] + tz * Lh), WATER + 1.1) + 0.2, PL = [0.165, 0.125, 0.085];
      Object.assign(Bridge, { x: C[0], z: C[1], tx, tz, L: Lh, ramp, w: wb, y: Y, on: true });
      if (M.nv > 50000) fresh();
      const Wb = (lx, y, sd) => [C[0] + tx * lx - tz * sd, y, C[1] + tz * lx + tx * sd];
      const box = (x0, y0, z0, x1, y1, z1, c, m, P) => { flat(P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), P(x1, y0, z1), c, m); flat(P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1), P(x0, y1, z0), c, m); flat(P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1), c, m); flat(P(x0, y0, z0), P(x0, y1, z0), P(x1, y1, z0), P(x1, y0, z0), c, m); flat(P(x0, y1, z0), P(x0, y1, z1), P(x1, y1, z1), P(x1, y1, z0), c, m); };
      box(-Lh, Y - 0.20, -wb, Lh, Y, wb, PL, MAT.RAIL, Wb);
      for (const e of [-1, 1]) { const ge = terrainH(C[0] + tx * e * (Lh + ramp), C[1] + tz * e * (Lh + ramp)) - 0.04; flat(Wb(e * Lh, Y, -wb), Wb(e * Lh, Y, wb), Wb(e * (Lh + ramp), ge, wb), Wb(e * (Lh + ramp), ge, -wb), PL, MAT.RAIL); }
      for (let lx = -Lh + 3; lx <= Lh - 2.9; lx += 6) for (const sd of [-1.7, 1.7]) box(lx - 0.17, -1.8, sd - 0.17, lx + 0.17, Y - 0.2, sd + 0.17, RAIL, MAT.RAIL, Wb);
      for (const sd of [-wb, wb]) {
        for (let lx = -Lh; lx <= Lh + 0.01; lx += 3) box(lx - 0.07, Y, sd - 0.07, lx + 0.07, Y + 1.15, sd + 0.07, RAIL, MAT.RAIL, Wb);
        for (const y of [0.50, 0.98]) flat(Wb(-Lh, Y + y, sd), Wb(Lh, Y + y, sd), Wb(Lh, Y + y + 0.11, sd), Wb(-Lh, Y + y + 0.11, sd), RAIL, MAT.RAIL);
        const p0 = Wb(-Lh, 0, sd), p1 = Wb(Lh, 0, sd); this.segs.push([p0[0], p0[2], p1[0], p1[2]]);
      }
      Shade.add(C[0], C[1], Lh, wb, Math.atan2(tz, tx), Y);
    }
    // the map of lanes and buildings
    {
      const RM = RoadMap, N = RM.N, DT = new Uint8Array(N * N * 4), cell = RM.SPAN / N;
      const splat = (ch, A, B, rad, fall) => {
        const i0 = Math.max(0, Math.floor((Math.min(A[0], B[0]) - rad - fall - RM.X0) / cell)), i1 = Math.min(N - 1, Math.ceil((Math.max(A[0], B[0]) + rad + fall - RM.X0) / cell));
        const j0 = Math.max(0, Math.floor((Math.min(A[1], B[1]) - rad - fall - RM.Z0) / cell)), j1 = Math.min(N - 1, Math.ceil((Math.max(A[1], B[1]) + rad + fall - RM.Z0) / cell));
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const v = Math.round(255 * sat(1 - Math.max(0, segD(RM.X0 + (i + 0.5) * cell, RM.Z0 + (j + 0.5) * cell, A, B) - rad) / fall)), o = (j * N + i) * 4 + ch; if (v > DT[o]) DT[o] = v; }
      };
      for (const l of lanes) for (let k = 0; k < l.length - 1; k++) splat(0, l[k], l[k + 1], 0, 10);
      for (const pl of plots) splat(1, [pl.x, pl.z], [pl.x + 0.01, pl.z], pl.rad, 14);
      RM.data = DT;
      G.roadTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, G.roadTex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, N, N, 0, gl.RGBA, gl.UNSIGNED_BYTE, DT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    M.finish();
    this.prog = program(GLSL_UNI + `
layout(location=0) in vec3 aP; layout(location=1) in vec3 aN; layout(location=2) in vec4 aC;
out vec3 vW, vN; out vec4 vC;
void main(){
  vec3 P = aP; float s = clamp(uEnv.y * 2.4, 0.0, 1.0), snow = step(1.05, aC.a);
  P -= aC.rgb * (0.30 * (1.0 - s) * snow);      // the slab of snow on a roof, pressed flat as it thaws
  vW = P; vN = aN; vC = aC; gl_Position = snow > 0.5 && s < 0.03 ? vec4(2.0, 2.0, 2.0, 1.0) : uVP * vec4(P, 1.0);
}`, GLSL_UNI + GLSL_NOISE + GLSL_WORLD + `
in vec3 vW, vN; in vec4 vC; out vec4 o;
uniform float uLamp;
// sawn or hewn wood: uv.x along the grain, uv.y across it, in metres
vec3 wood(vec2 uv, float seed){
  float g = vnoise(vec2(uv.x * 1.2 + seed * 9.0, uv.y * 42.0)) * 0.55 + vnoise(vec2(uv.x * 5.0 + seed, uv.y * 150.0)) * 0.45;
  vec3 c = mix(vec3(0.115, 0.060, 0.030), vec3(0.290, 0.170, 0.082), g);
  vec2 k = vec2(uv.x * 0.9 + seed * 3.0, uv.y * 3.4), kc = fract(k) - 0.5;
  float knot = step(0.80, hash21(floor(k) + seed)) * (1.0 - smoothstep(0.03, 0.16, length(kc * vec2(1.0, 0.35))));      // a knot here and there
  return mix(c, vec3(0.055, 0.032, 0.018), knot * 0.8);
}
void main(){
  vec3 V = normalize(uCam - vW), N = normalize(vN); if (dot(N, V) < 0.0) N = -N;
  float m = vC.a, ao = 1.0, seed = vC.b; vec3 alb, emit = vec3(0.0);
  if (m > 1.05) alb = vec3(0.76, 0.80, 0.88);
  else if (m < 0.05) alb = vC.rgb;
  else if (m < 0.15) {
    // a wall of round logs: each course bulges out and catches the light along its upper half; moss and tow pack the dark seams
    float course = vC.g / 0.30, f = fract(course), id = floor(course), ny = (f - 0.5) * 2.0, s = seed + id * 7.3;
    N = normalize(N * sqrt(max(1.0 - ny * ny * 0.8, 0.06)) + vec3(0.0, 1.0, 0.0) * ny * 0.9);
    alb = wood(vec2(vC.r, f * 0.30 + id * 0.9), s) * (0.72 + 0.56 * hash21(vec2(id, floor(seed * 91.0))));
    alb = mix(alb, vec3(0.170, 0.155, 0.135), 0.55 * smoothstep(0.35, 0.80, vnoise(vec2(vC.r * 0.35 + s, id * 1.7 + seed * 5.0))));      // weathered silver
    alb *= 1.0 - 0.55 * smoothstep(0.90, 1.0, vnoise(vec2(vC.r * 1.7 + s * 3.0, f * 7.0 + id * 5.0)));                      // checks along the grain
    ao = (0.22 + 0.78 * smoothstep(0.0, 0.16, f) * (1.0 - smoothstep(0.84, 1.0, f))) * (1.0 - 0.38 * smoothstep(1.5, 2.5, vC.g));
  } else if (m < 0.25) {
    // the sawn end of a log: rings, a crack or two, darker toward the bark
    float rr = length(vC.rg), ang = atan(vC.g, vC.r);
    alb = mix(vec3(0.330, 0.225, 0.115), vec3(0.205, 0.125, 0.060), 0.5 + 0.5 * sin(rr * 24.0 + vnoise(vC.rg * 2.5 + seed * 9.0) * 5.0));
    alb *= (1.0 - 0.55 * smoothstep(0.78, 1.05, rr)) * (1.0 - 0.6 * (1.0 - smoothstep(0.0, 0.10, abs(sin(ang * 1.5 + seed * 20.0)))) * smoothstep(0.15, 0.5, rr));
    alb *= 1.0 - 0.75 * smoothstep(1.02, 1.30, rr);
  } else if (m < 0.35) {
    // roof planks, running down the slope, weathered grey; the old ones green with moss toward the eave
    float pl = vC.r / 0.23, id = floor(pl), f = fract(pl);
    alb = wood(vec2(vC.g, f * 0.23 + id * 3.0), seed + id);
    alb = mix(alb, vec3(0.135, 0.128, 0.120), 0.62) * (0.75 + 0.5 * hash21(vec2(id, floor(seed * 57.0))));
    alb = mix(alb, vec3(0.055, 0.085, 0.030), 0.45 * smoothstep(0.52, 0.85, vnoise(vec2(vC.r * 0.7, vC.g * 0.5) + seed * 5.0)) * smoothstep(0.5, 2.5, vC.g));
    ao = 0.35 + 0.65 * smoothstep(0.0, 0.07, f) * (1.0 - smoothstep(0.93, 1.0, f));
  } else if (m < 0.45) {
    // the gable: upright boards, and the square dark mouth of the loft
    float pl = (vC.r + 9.0) / 0.20, id = floor(pl), f = fract(pl);
    alb = wood(vec2(vC.g, f * 0.20 + id * 3.0), seed + id) * 0.78;
    ao = (0.35 + 0.65 * smoothstep(0.0, 0.08, f) * (1.0 - smoothstep(0.92, 1.0, f))) * (1.0 - 0.30 * smoothstep(0.3, 1.6, vC.g));
    if (abs(vC.r) < 0.32 && vC.g > 0.30 && vC.g < 0.95) { alb = vec3(0.012); ao = 1.0; }
  } else if (m < 0.55) {
    // a plank door in its frame, two battens across it, an iron latch
    vec2 q = vC.rg; float pl = q.x * 5.0, f = fract(pl);
    alb = wood(vec2(q.y * 1.9, f * 0.2 + floor(pl) * 3.0), seed) * 0.62;
    ao = 0.45 + 0.55 * smoothstep(0.0, 0.09, f);
    alb *= 1.0 - 0.40 * (step(abs(q.y - 0.24), 0.035) + step(abs(q.y - 0.76), 0.035));
    if (q.x < 0.075 || q.x > 0.925 || q.y > 0.94) { alb = wood(vec2(q.y * 1.9 + q.x, q.x * 0.3), seed + 3.0) * 1.15; ao = 1.0; }
    if (length((q - vec2(0.84, 0.50)) * vec2(1.0, 1.9)) < 0.035) alb = vec3(0.02);
  } else if (m < 0.65) {
    // a window: painted frame (blue, or white), four panes. The glass is dark with the sky lying in it; at dawn and dusk a lamp burns behind
    vec2 q = vC.rg; float fw = 0.12;
    bool frame = q.x < fw || q.x > 1.0 - fw || q.y < fw || q.y > 1.0 - fw || abs(q.x - 0.5) < 0.04 || abs(q.y - 0.52) < 0.04;
    if (frame) alb = (seed > 0.7 ? vec3(0.070, 0.180, 0.380) : vec3(0.50, 0.49, 0.45)) * (0.75 + 0.5 * vnoise(q * 26.0 + seed * 9.0));
    else {
      vec3 R = reflect(-V, N); alb = vec3(0.012, 0.016, 0.020);
      float lit = step(0.2, fract(seed)) * uLamp;
      emit = skyGrad(normalize(vec3(R.x, abs(R.y) + 0.05, R.z))) * 0.16 + vec3(1.00, 0.40, 0.09) * lit * (0.55 + 0.45 * vnoise(q * 2.5 + seed * 7.0)) * 1.25;
    }
  } else if (m < 0.75) {
    // field stones laid in courses
    vec2 q = vec2((vW.x + vW.z) * 2.6, vW.y * 5.2); q.x += 0.5 * mod(floor(q.y), 2.0);
    vec2 f = fract(q);
    alb = mix(vec3(0.085, 0.082, 0.078), vec3(0.210, 0.200, 0.185), hash21(floor(q))) * (0.75 + 0.5 * vnoise(q * 5.0));
    ao = 0.40 + 0.60 * smoothstep(0.0, 0.10, min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)));
  } else if (m < 0.85) alb = vC.rgb * (0.65 + 0.7 * vnoise(vec2((vW.x + vW.z) * 1.4, vW.y * 38.0)));           // rails and posts, grey with weather
  else if (m < 0.95) {
    alb = vC.rgb * (0.55 + 0.9 * vnoise(vec2((vW.x - vW.z) * 11.0, vW.y * 2.2)));                                // hay, in hanging strands
    alb = mix(alb, alb * vec3(1.15, 0.95, 0.60), vnoise(vW.xz * 1.7));
  } else {
    // a stack of split firewood, end on
    vec2 q = vC.rg / 0.15; q.x += 0.5 * mod(floor(q.y), 2.0);
    vec2 f = fract(q) - 0.5; float rr = length(f) * 2.0, h = hash21(floor(q));
    alb = mix(vec3(0.340, 0.240, 0.125), vec3(0.200, 0.122, 0.060), 0.5 + 0.5 * sin(rr * 11.0 + h * 6.0)) * (0.65 + 0.6 * h) * (1.0 - smoothstep(0.80, 1.02, rr) * 0.93);
  }
  // snow lies on whatever faces the sky
  alb = mix(alb, vec3(0.72, 0.76, 0.84), clamp(uEnv.y * 2.4, 0.0, 1.0) * smoothstep(0.22, 0.50, N.y));
  alb *= 1.0 - uEnv2.x * 0.22;
  float ndl = max(dot(N, uSun), 0.0);
  vec3 col = alb * (uSunCol * ndl * cloudShade(vW.xz) * mix(1.0, 0.25, 1.0 - uEnv2.z) + uAmb * (0.50 + 0.50 * (0.5 + 0.5 * N.y))) * ao + emit;
  o = vec4(applyFog(col, vW), 1.0);
}`, 'village');
  },
  update(dt, x, z) { },
  // houses, haystacks and fences are ridden round
  collide(g) {
    if (Math.abs(g.x - XH) > 520 || Math.abs(g.z - ZH) > 400) return;
    for (const c of this.cabins) { const dx = g.x - c.x, dz = g.z - c.z, d = Math.hypot(dx, dz); if (d < c.r && d > 1e-4) { g.x += dx / d * (c.r - d); g.z += dz / d * (c.r - d); } }
    for (const s of this.segs) {
      const bx = s[2] - s[0], bz = s[3] - s[1], px = g.x - s[0], pz = g.z - s[1], t = sat((px * bx + pz * bz) / (bx * bx + bz * bz)), dx = px - bx * t, dz = pz - bz * t, d = Math.hypot(dx, dz);
      if (d < 0.85 && d > 1e-4) { g.x += dx / d * (0.85 - d); g.z += dz / d * (0.85 - d); }
    }
  },
  draw() {
    if (Math.abs(G.cam[0] - XH) > 4600) return;
    const p = this.prog.use(); setGlobals(p); p.f1('uLamp', Env.cur.lamp);
    for (const m of this.meshes) m.draw();
  },
};

// Smoke from the chimneys and the tents. Each is one long plume, drawn as a string of soft puffs that travel along it:
// straight up while it is hot, then leaning with the wind, then spread thin and carried away. In still cold air it rises less
// and hangs over the roofs in a layer. Nothing is simulated: where a puff is depends only on how old it is.
const Smoke = {
  N: 30, src: [],
  init() {
    this.vao = gl.createVertexArray(); gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.prog = program(GLSL_UNI + GLSL_NOISE + `
layout(location=0) in vec2 aQ;
uniform vec4 uBase; uniform vec3 uCamR, uCamU; uniform float uN, uCalm;
out vec2 vQ; out vec3 vW; out vec3 vA;
void main(){
  float i = float(gl_InstanceID);
  float a = fract((i + 0.5) / uN + uTime * 0.040 + uBase.w), age = a * a * (0.35 + 0.65 * a);      // more of the puffs are near the chimney, where they are small
  float rise = mix(24.0, 13.0, uCalm) * (1.0 - exp(-age * 4.2)) + age * mix(9.0, 2.0, uCalm);
  float drift = (0.55 + uWindK) * (1.5 * age + 46.0 * age * age);      // even in still air it finds a way to lean
  vec3 p = uBase.xyz + vec3(uWindDir.x * drift, rise, uWindDir.y * drift);
  float wv = age * (3.0 + 9.0 * age);
  p.x += (vnoise(vec2(age * 5.0 - uTime * 0.10, uBase.w * 9.0)) - 0.5) * wv; p.z += (vnoise(vec2(age * 5.0 - uTime * 0.10, uBase.w * 9.0 + 7.0)) - 0.5) * wv;
  p.y += (vnoise(vec2(age * 7.0 - uTime * 0.13, uBase.w * 5.0)) - 0.5) * wv * 0.35;
  // it widens as it cools, and once it has levelled off it spreads flat
  float size = 0.36 + 13.0 * pow(age, 0.9), flatn = mix(1.0, 0.30, smoothstep(0.12, 0.6, age) * (0.4 + 0.6 * uCalm));
  vW = p + uCamR * (aQ.x * size) + uCamU * (aQ.y * size * flatn);
  vA = vec3(smoothstep(0.0, 0.012, age) * pow(1.0 - a, 1.2) / (1.0 + 7.0 * age), i * 7.3 + uBase.w * 31.0, age);
  vQ = aQ;
  gl_Position = uVP * vec4(vW, 1.0);
}`, GLSL_UNI + GLSL_NOISE + GLSL_WORLD + `
in vec2 vQ; in vec3 vW; in vec3 vA; out vec4 o;
void main(){
  float r = length(vQ); if (r > 1.0) discard;
  float n = vnoise(vQ * 1.8 + vA.y) * 0.6 + vnoise(vQ * 4.5 + vA.y * 1.7 - uTime * 0.05) * 0.4;
  float a = vA.x * pow(1.0 - r, 1.3) * smoothstep(0.10, 0.70, n + (1.0 - r) * 0.55) * smoothstep(1.0, 4.0, distance(vW, uCam));
  vec3 rd = normalize(vW - uCam); float mu = max(dot(rd, uSun), 0.0);
  // blue-white wood smoke: grey in the shade of the valley, lit where it climbs into the sun, glowing when the sun is behind it
  vec3 c = vec3(0.62, 0.66, 0.74) * (uAmb * 1.05 + uSunCol * (0.12 + 0.22 * smoothstep(6.0, 22.0, vW.y - uMist.z) + 0.40 * pow(mu, 5.0)) * cloudShade(vW.xz));
  float f = max(1.0 - exp(-distance(vW, uCam) * uFogB), 0.0);
  c = mix(c, hazeCol(rd), f);
  o = vec4(c * a, a);
}`, 'smoke');
  },
  draw() {
    const src = this.src; src.length = 0;
    if (Math.abs(G.cam[0] - XH) < 2600) for (const c of Village.chimneys) src.push(c);
    for (const c of Camp.list) if (c.first) src.push([c.x, c.y + 2.72, c.z, (c.x * 0.013) % 1]);
    if (!src.length) return;
    const p = this.prog.use(); setGlobals(p); p.f3('uCamR', G.camR); p.f3('uCamU', G.camU); p.f1('uN', this.N); p.f1('uCalm', sat(1.4 - Env.cur.wind));
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
    gl.bindVertexArray(this.vao);
    // The shader lifts a puff by at most 33 m and drifts it downwind by up to 47.5 * (0.55 + wind).
    // The 30 m margin covers lateral noise and the full camera-facing quad, including the thin tail.
    let driftX = 0, driftZ = 0, radius = 0;
    if (rideSession) {
      const halfDrift = 23.75 * (0.55 + G.windK);
      driftX = G.windDir[0] * halfDrift; driftZ = G.windDir[1] * halfDrift;
      radius = Math.hypot(driftX, 16.5, driftZ) + 30;
    }
    for (const s of src) {
      if (rideSession && outsideRideView(s[0] + driftX, s[1] + 16.5, s[2] + driftZ, radius)) continue;
      p.f4('uBase', s[0], s[1], s[2], s[3]); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.N);
    }
    gl.disable(gl.BLEND); gl.depthMask(true);
  },
};

// Swans on the lake, off the western shore: they drift, turn and bob. In winter they are gone.
const Swans = {
  list: [], m: new Float32Array(16),
  init(shore) {
    const M = this.mesh = new DynMesh(900, 5400), WHITE = [0.74, 0.74, 0.71], BILL = [0.62, 0.30, 0.04], BLACK = [0.03, 0.03, 0.03], Z = [0, 0, 1];
    M.begin();
    M.loft(crRows([[-0.52, 0.16, .02, .02, .02], [-0.40, 0.19, .10, .09, .10], [-0.15, 0.15, .17, .17, .19], [0.12, 0.13, .16, .17, .18], [0.32, 0.14, .10, .12, .11], [0.42, 0.16, .03, .04, .04]].map(t => [t[0], t[1], 0, t[2], t[3], t[4], ...WHITE, 0.3]), 3), Z, 12, true, true);
    M.loft(crRows([[0.30, 0.16, .060], [0.40, 0.30, .048], [0.37, 0.48, .040], [0.40, 0.62, .038], [0.47, 0.68, .050], [0.53, 0.66, .042]].map(t => [t[0], t[1], 0, t[2], t[2], t[2], ...WHITE, 0.3]), 3), Z, 8, true, true);
    M.loft(linRows([[0.52, 0.665, 0, .036, .030, .030, ...BLACK, 0.4], [0.56, 0.655, 0, .028, .024, .026, ...BILL, 0.5], [0.635, 0.635, 0, .010, .010, .016, ...BILL, 0.5]], 1), Z, 6, false, true);
    for (const s of [-1, 1]) M.loft(crRows([[-0.42, 0.24, s * 0.06, .03, .03, .02], [-0.18, 0.30, s * 0.13, .09, .07, .04], [0.10, 0.25, s * 0.15, .07, .06, .03], [0.24, 0.19, s * 0.12, .02, .02, .015]].map(t => [...t, ...WHITE, 0.3]), 3), Z, 8, true, true);     // folded wings
    M.finish();
    const r = rng(9);
    for (let i = 0; i < 8; i++) this.list.push({ x: shore[0] + 16 + r() * 55, z: shore[1] + (r() - 0.5) * 130, ph: r() * 6.28, rad: 3 + r() * 6, sp: (0.03 + r() * 0.03) * (r() < 0.5 ? 1 : -1) });
  },
  draw() {
    if (Math.abs(G.cam[0] - this.list[0].x) > 1500 || G.env3[3] > 0.5) return;
    const p = Horse.prog.use(); setGlobals(p); p.f1('uCut', 99); p.f1('uProp', 0); p.f1('uSelf', 1);
    const m = this.m, t = G.time;
    for (const s of this.list) {
      const a = s.ph + t * s.sp, x = s.x + Math.cos(a) * s.rad, z = s.z + Math.sin(a) * s.rad;
      if (lakeD(x, z) > -5) continue;
      const yaw = a + (s.sp > 0 ? 1.5708 : -1.5708), cs = Math.cos(yaw), sn = Math.sin(yaw), y = WATER - 0.06 + 0.012 * Math.sin(t * 1.3 + s.ph);
      m.set([cs, 0, sn, 0, 0, 1, 0, 0, -sn, 0, cs, 0, x, y, z, 1]);
      p.m4('uModel', m); this.mesh.draw();
    }
    p.f1('uSelf', 0);
  },
};

// Where a ride can begin. Each has its own weather to arrive in; the weather can then be changed.
const Places = {
  order: ['valley', 'hemu', 'moon', 'sayram'], cur: 'valley', list: {}, shore: [0, 0],
  init() {
    const L = this.list;
    // on the meadow by the first ford: straight on lies the river, then a ridge to climb, and the next ford beyond it
    L.valley = { label: '河谷草原', sub: '蹚河 · 翻梁 · 牛羊', x: -70, z: -60, yaw: 0, weather: 'steppe' };
    // from the hillside above the village, as the mist lies in the valley and the first smoke goes up
    L.hemu = { label: '禾木村', sub: '晨雾 · 木屋 · 炊烟', x: VH[0], z: VH[1], yaw: Math.atan2(CH[1] - VH[1], CH[0] - VH[0]), weather: 'mist' };
    // from high on the bank, looking down into the bend
    L.moon = { label: '月亮湾', sub: '喀纳斯 · 秋林尽染', x: VM[0], z: VM[1], yaw: Math.atan2(BM[1] - VM[1], BM[0] - VM[0]), weather: 'day' };
    // on the shore of the lake, in the depth of winter
    // on the rise above the western shore, the whole lake ahead
    const x = SK[0], z = SK[1];
    L.sayram = { label: '赛里木湖', sub: '冬 · 蓝冰 · 雪山', x, z, yaw: 0, weather: 'snow' };
    let sx = x; while (lakeD(sx, z) > 0 && sx < XL) sx += 2;      // the water's edge straight ahead of that
    this.shore = [sx, z];
  },
  next() { return this.order[(this.order.indexOf(this.cur) + 1) % this.order.length]; },
};

// ======== 08f_herd.js
// ---------------------------------------------------------------- cattle and sheep
// Sculpted like the horse, each with a skeleton: body, neck, head, two bones to a leg, and for the cattle a tail.
// They graze where they stand, shifting a step every few seconds; now and then one lifts its head and walks to a fresh patch.
// When the rider comes near they look up; nearer still, they move off (sheep at a run: a flock will part before a horse).
const Herd = {
  list: [], kinds: {}, B: null, m: new Float32Array(16), callT: 5, ms: 0,
  // legs: right fore, left fore, right hind, left hind. ph: where each falls in the stride at a walk, pt: at a trot
  LEGS: [{ U: 3, L: 4, front: true, s: 1, ph: 0.75, pt: 0 }, { U: 5, L: 6, front: true, s: -1, ph: 0.25, pt: 0.5 }, { U: 7, L: 8, front: false, s: 1, ph: 0.5, pt: 0.5 }, { U: 9, L: 10, front: false, s: -1, ph: 0, pt: 0 }],

  sculptCow() {
    const E = SDF.ell, C = SDF.cap, prims = [], P = (p, tag) => { p.tag = tag || ''; prims.push(p); };
    // body: a deep barrel under a level back, wide and low in the belly, bony at the hips
    P(E(-0.05, 0.99, 0, 0.64, 0.36, 0.33, 0, 0.10, 0));
    P(E(-0.14, 0.88, 0, 0.50, 0.31, 0.37, 0, 0.10, 0));
    P(E(0.42, 0.95, 0, 0.30, 0.36, 0.25, 0, 0.10, 0));
    P(E(0.60, 0.74, 0, 0.17, 0.17, 0.13, 0, 0.08, 0));                        // brisket
    P(C(-0.72, 1.27, 0, 0.42, 1.29, 0, 0.10, 0.11, 1.5, 0.08, 0));           // the back
    P(E(0.40, 1.27, 0, 0.22, 0.11, 0.13, 0, 0.08, 0));                        // withers
    P(E(-0.64, 1.04, 0, 0.30, 0.31, 0.29, 0, 0.10, 0));                       // rump
    P(E(-0.44, 1.25, 0.19, 0.10, 0.055, 0.06, 0, 0.07, 0));                   // hook bones
    P(E(-0.87, 1.19, 0.12, 0.07, 0.06, 0.055, 0, 0.06, 0));                   // pin bones
    P(E(-0.50, 0.60, 0, 0.15, 0.11, 0.13, 0, 0.05, 0), 'udder');
    P(C(-0.93, 1.24, 0, -1.00, 0.56, 0, 0.032, 0.016, 1, 0.03, 11));         // tail
    P(E(-1.00, 0.45, 0, 0.045, 0.12, 0.045, 0, 0.02, 11), 'tuft');
    // neck: deep, narrow, with the dewlap hanging under it
    P(C(0.56, 1.10, 0, 1.10, 1.24, 0, 0.225, 0.150, 0.66, 0.10, 1));
    P(E(0.84, 0.99, 0, 0.26, 0.15, 0.040, 0.25, 0.05, 1));
    // head: broad skull, long face, wide wet muzzle; horns out and up; ears held level below them
    P(E(1.22, 1.245, 0, 0.150, 0.125, 0.120, 0, 0.05, 2), 'head');
    P(C(1.22, 1.22, 0, 1.52, 1.07, 0, 0.108, 0.078, 0.92, 0.05, 2), 'head');
    P(E(1.555, 1.045, 0, 0.082, 0.074, 0.090, 0, 0.03, 2), 'muz');
    P(E(1.34, 1.10, 0, 0.15, 0.065, 0.075, -0.45, 0.04, 2), 'head');
    P(C(1.15, 1.345, 0.075, 1.13, 1.400, 0.250, 0.036, 0.028, 1, 0.02, 2), 'horn');
    P(C(1.13, 1.400, 0.250, 1.23, 1.560, 0.290, 0.028, 0.008, 1, 0.012, 2), 'horn');
    P(E(1.12, 1.27, 0.215, 0.035, 0.050, 0.095, 0, 0.02, 2), 'ear');
    // legs
    P(C(0.48, 0.97, 0.175, 0.50, 0.50, 0.175, 0.125, 0.062, 0.8, 0.07, 3));
    P(E(0.505, 0.50, 0.175, 0.062, 0.070, 0.058, 0, 0.03, 3));
    P(C(0.50, 0.50, 0.175, 0.50, 0.13, 0.175, 0.052, 0.046, 1, 0.03, 4));
    P(E(0.52, 0.055, 0.175, 0.078, 0.060, 0.066, 0, 0.02, 4));
    P(C(-0.60, 1.02, 0.195, -0.80, 0.54, 0.195, 0.19, 0.066, 0.66, 0.08, 7));
    P(E(-0.50, 0.84, 0.21, 0.13, 0.20, 0.09, 0.3, 0.07, 7));
    P(C(-0.80, 0.54, 0.195, -0.74, 0.13, 0.195, 0.056, 0.046, 1, 0.03, 8));
    P(E(-0.72, 0.055, 0.195, 0.078, 0.060, 0.066, 0, 0.02, 8));
    const f = SDF.make(prims), dT = (tag, x, y, az) => { let d = 9; for (const p of prims) if (p.tag === tag) d = Math.min(d, p.d(x, y, az)); return d; };
    const info = (x, y, z, n) => {
      const az = Math.abs(z);
      return { horn: dT('horn', x, y, az) < 0.008 && az > 0.10, ear: dT('ear', x, y, az) < 0.008, nose: dT('muz', x, y, az) < 0.02 && x > 1.585, ring: Math.min(dT('muz', x, y, az), dT('head', x, y, az)) < 0.02 ? smooth(1.44, 1.53, x) : 0,
        udder: dT('udder', x, y, az) < 0.012, tuft: dT('tuft', x, y, az) < 0.012, eye: Math.hypot(x - 1.30, y - 1.262, az - 0.106) < 0.024, hoof: y < 0.10, face: dT('head', x, y, az) < 0.02 && az < 0.05 && n[1] > 0.3,
        under: sat(-n[1] * 1.3 - 0.25) * smooth(1.0, 0.75, y), n: vnoise(x * 2.1 + (z > 0 ? 9 : 31), y * 2.4 + az * 1.5), n2: vnoise(x * 7 + z * 5, y * 7 - z * 3), y };
    };
    const DARK = [0.035, 0.030, 0.028], HOOF = [0.050, 0.044, 0.040, 0.5], HORN = [0.42, 0.38, 0.30, 0.5], PINK = [0.42, 0.29, 0.26, 0.3], NOSE = [0.13, 0.10, 0.095, 0.7], EYE = [0.012, 0.010, 0.010, 1.0];
    const common = (i) => i.eye ? EYE : i.hoof ? HOOF : i.horn ? (i.y > 1.50 ? [DARK[0], DARK[1], DARK[2], 0.5] : HORN) : i.udder ? PINK : i.nose ? NOSE : null;
    const plain = (base, pale, ringC) => (x, y, z, i) => {
      const c0 = common(i); if (c0) return c0;
      if (i.tuft) return [DARK[0], DARK[1], DARK[2], 0.3];
      let c = v3.lerp(base, pale, i.under * 0.5);
      c = v3.lerp(c, DARK, smooth(0.45, 0.12, y) * 0.35);           // darker down the legs
      c = v3.lerp(c, ringC, i.ring);                               // a pale ring round the muzzle
      const k = 0.88 + 0.24 * i.n2;
      return [c[0] * k, c[1] * k, c[2] * k, 0.3];
    };
    const pied = (x, y, z, i) => {
      const c0 = common(i); if (c0) return c0;
      const white = i.n > 0.53 || y < 0.40 || i.under > 0.6 || i.face || i.tuft, k = 0.9 + 0.2 * i.n2;
      const c = white ? [0.52, 0.50, 0.46] : [0.030, 0.028, 0.028];
      return [c[0] * k, c[1] * k, c[2] * k, 0.3];
    };
    const paints = [plain([0.150, 0.078, 0.040], [0.30, 0.22, 0.15], [0.44, 0.38, 0.31]), pied, plain([0.300, 0.190, 0.090], [0.42, 0.33, 0.21], [0.48, 0.42, 0.33]), plain([0.072, 0.044, 0.030], [0.16, 0.11, 0.075], [0.40, 0.34, 0.28])];
    const K = bakeSkins(f, [-1.16, -0.03, -0.46], [1.72, 1.58, 0.46], 0.026, info, paints, bindPrims(prims, { 3: 2, 4: 2, 7: 2, 8: 2 }, 0.05, 0.08));
    return Object.assign(K, { np: [0.58, 1.08], hp: [1.12, 1.26], hipF: [0.48, 0.95], kneeF: [0.50, 0.50], hipH: [-0.60, 1.00], kneeH: [-0.80, 0.54], hz: [0.175, 0.195], tail: [-0.93, 1.24],
      Lleg: 0.90, Aw: 0.30, Ar: 0.42, bend: 0.55, down: -1.25, headDown: -0.35, up: 0.0, rad: 1.15, box: [0.95, 0.34, 1.25], walk: 0.85, run: 2.3, shy: 3.4, nose: [1.60, 1.04, 0] });
  },

  sculptSheep() {
    const E = SDF.ell, C = SDF.cap, prims = [], P = (p, tag) => { p.tag = tag || ''; prims.push(p); };
    // the fleece: body, chest, rump, the fat rump of the mountain breeds, and up the neck
    P(E(0.00, 0.555, 0, 0.42, 0.235, 0.240, 0, 0.08, 0), 'wool');
    P(E(0.26, 0.565, 0, 0.20, 0.235, 0.205, 0, 0.08, 0), 'wool');
    P(E(-0.28, 0.570, 0, 0.22, 0.230, 0.230, 0, 0.08, 0), 'wool');
    P(E(-0.47, 0.545, 0, 0.115, 0.140, 0.155, 0, 0.05, 0), 'wool');
    P(C(0.32, 0.61, 0, 0.53, 0.82, 0, 0.145, 0.095, 0.85, 0.07, 1), 'wool');
    // head: narrow, roman-nosed; ears out to the side
    P(E(0.585, 0.835, 0, 0.088, 0.078, 0.072, 0, 0.03, 2), 'head');
    P(C(0.585, 0.825, 0, 0.775, 0.735, 0, 0.068, 0.044, 0.9, 0.03, 2), 'head');
    P(E(0.790, 0.725, 0, 0.040, 0.038, 0.040, 0, 0.02, 2), 'head');
    P(E(0.545, 0.825, 0.105, 0.030, 0.022, 0.062, 0, 0.012, 2), 'ear');
    // thin legs under all that wool
    P(C(0.25, 0.46, 0.105, 0.255, 0.235, 0.105, 0.056, 0.030, 1, 0.04, 3));
    P(C(0.255, 0.235, 0.105, 0.255, 0.05, 0.105, 0.026, 0.023, 1, 0.015, 4));
    P(E(0.265, 0.025, 0.105, 0.034, 0.026, 0.028, 0, 0.01, 4));
    P(C(-0.28, 0.50, 0.115, -0.345, 0.245, 0.115, 0.078, 0.030, 0.8, 0.05, 7));
    P(C(-0.345, 0.245, 0.115, -0.32, 0.05, 0.115, 0.026, 0.023, 1, 0.015, 8));
    P(E(-0.31, 0.025, 0.115, 0.034, 0.026, 0.028, 0, 0.01, 8));
    const smooth0 = SDF.make(prims);
    // the fleece is not smooth: it stands in locks
    const f = (x, y, z) => {
      const d = smooth0(x, y, z); if (d > 0.06 || d < -0.06) return d;
      const wool = smooth(0.30, 0.42, y) * (1 - smooth(0.50, 0.57, x + (y - 0.6) * 0.3));
      return d - 0.020 * wool * (vnoise(x * 17 + z * 9.1, y * 17 - z * 6.3) * 0.65 + vnoise(x * 41 - z * 17, y * 41 + z * 23) * 0.35 - 0.30);
    };
    const dT = (tag, x, y, az) => { let d = 9; for (const p of prims) if (p.tag === tag) d = Math.min(d, p.d(x, y, az)); return d; };
    const info = (x, y, z, n) => {
      const az = Math.abs(z), dw = dT('wool', x, y, az), dh = Math.min(dT('head', x, y, az), dT('ear', x, y, az));
      return { wool: dw < 0.035 && dw < dh + 0.01 && y > 0.33, eye: Math.hypot(x - 0.640, y - 0.842, az - 0.066) < 0.014, hoof: y < 0.05, under: sat(-n[1] * 1.2 - 0.2), nose: x > 0.805,
        n: vnoise(x * 17 + z * 9.1, y * 17 - z * 6.3), n2: vnoise(x * 5 + z * 3, y * 5 - z * 2), y };
    };
    const coat = (wool, face) => (x, y, z, i) => {
      if (i.eye) return [0.012, 0.010, 0.010, 1.0];
      if (i.hoof) return [0.045, 0.040, 0.036, 0.5];
      if (!i.wool) return i.nose ? [face[0] * 0.5 + 0.02, face[1] * 0.5 + 0.02, face[2] * 0.5 + 0.02, 0.5] : [face[0], face[1], face[2], 0.25];
      // paler on the tips of the locks, grubbier underneath and behind
      const k = (0.86 + 0.26 * i.n) * (1 - 0.28 * i.under) * (0.92 + 0.16 * i.n2);
      return [wool[0] * k, wool[1] * k, wool[2] * k, 0.05];
    };
    const paints = [coat([0.66, 0.62, 0.53], [0.030, 0.028, 0.028]), coat([0.63, 0.58, 0.48], [0.180, 0.100, 0.055]), coat([0.68, 0.64, 0.56], [0.46, 0.42, 0.35]), coat([0.170, 0.105, 0.062], [0.060, 0.040, 0.028])];
    const K = bakeSkins(f, [-0.66, -0.02, -0.34], [0.88, 0.98, 0.34], 0.021, info, paints, bindPrims(prims, { 3: 2, 4: 2, 7: 2, 8: 2 }, 0.028, 0.05));
    return Object.assign(K, { np: [0.34, 0.62], hp: [0.54, 0.83], hipF: [0.25, 0.44], kneeF: [0.255, 0.235], hipH: [-0.28, 0.48], kneeH: [-0.345, 0.245], hz: [0.105, 0.115], tail: null,
      Lleg: 0.42, Aw: 0.36, Ar: 0.62, bend: 0.75, down: -1.5, headDown: -0.10, up: 0.10, rad: 0.62, box: [0.50, 0.24, 0.72], walk: 0.65, run: 3.0, shy: 5.5, nose: [0.82, 0.72, 0] });
  },

  init() {
    const t0 = performance.now();
    this.B = Rig.make();
    this.kinds.cow = this.sculptCow(); this.kinds.sheep = this.sculptSheep();
    this.ms = Math.round(performance.now() - t0);
    const r = this.rnd = rng(31);
    // a herd: n animals scattered round (cx, cz); it keeps to within rad of there
    // where a herd is put there must be open grass: if the place asked for has grown over with trees (or houses), the nearest clear one is taken
    const open = (cx, cz, rad) => { let n = 0; for (let i = 0; i < 40; i++) { const a = i * 2.399, d = rad * Math.sqrt((i + 0.5) / 40); if (this.ok(cx + Math.cos(a) * d, cz + Math.sin(a) * d)) n++; } return n / 40; };
    const site = (cx, cz, rad) => { if (open(cx, cz, rad) > 0.85) return [cx, cz]; for (let R = 30; R <= 360; R += 30) for (let k = 0; k < 12; k++) { const a = k * TAU / 12 + R, x = cx + Math.cos(a) * R, z = cz + Math.sin(a) * R; if (open(x, z, rad) > 0.85) return [x, z]; } return [cx, cz]; };
    this.sites = [];
    const herd = (kind, n, cx, cz, rad, fixed) => {
      const q = fixed ? [cx, cz] : site(cx, cz, rad); this.sites.push(q); cx = q[0]; cz = q[1];
      for (let i = 0, tries = 0; i < n && tries < n * 40; tries++) {
        const a = r() * TAU, d = Math.sqrt(r()) * rad, x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
        if (!this.ok(x, z) || this.list.some(o => Math.hypot(o.x - x, o.z - z) < (kind === 'cow' ? 2.6 : 1.5))) continue;
        const cow = kind === 'cow', young = r() < (cow ? 0.14 : 0.22);
        this.list.push({ kind, K: this.kinds[kind], coat: cow ? (r() < 0.45 ? 0 : r() < 0.4 ? 1 : r() < 0.6 ? 2 : 3) : (r() < 0.55 ? 0 : r() < 0.45 ? 1 : r() < 0.6 ? 2 : 3), young,
          x, z, y: terrainH(x, z), yaw: r() * TAU, v: 0, phase: r(), head: 0, look: 0, slope: 0, sc: (young ? 0.56 : 0.94) + r() * 0.14, seed: r(),
          st: 'graze', t: 4 + r() * 22, step: r() * 4, tx: x, tz: z, hx: cx, hz: cz, hr: rad });
        i++;
      }
    };
    const v = Places.list.valley, s = Places.list.sayram;
    herd('sheep', 22, v.x + 40, v.z - 95, 20); herd('cow', 8, v.x - 30, v.z + 70, 24);
    herd('cow', 10, XH - 230, ZH - 245, 28); herd('sheep', 26, XH + 250, ZH - 120, 24); herd('cow', 6, XH + 20, ZH + 10, 170, true); herd('sheep', 14, XH + 420, ZH + 40, 26);
    herd('sheep', 18, s.x + 150, s.z + 190, 22); herd('cow', 6, s.x + 60, s.z - 260, 24);      // below the rise, either side of the way down to the shore
  },
  // can an animal stand here?
  ok(x, z) {
    const h = terrainH(x, z);
    if (h < 0.3 || riverD(x, z) < 15 || lakeD(x, z) < 30 || forestAt(x, z, h) > 0.05) return false;
    if (Math.abs(terrainH(x + 1, z) - terrainH(x - 1, z)) + Math.abs(terrainH(x, z + 1) - terrainH(x, z - 1)) > 0.9) return false;
    if (Math.abs(x - XH) < 520) for (const c of Village.cabins) if (Math.hypot(c.x - x, c.z - z) < c.r + 1.5) return false;
    return true;
  },

  update(dt, g) {
    const L = this.list, R = this.rnd, near = [];
    for (const a of L) {
      if (Math.abs(a.x - G.cam[0]) > 420 || Math.abs(a.z - G.cam[2]) > 420) continue;       // far herds stand still until someone comes to look
      near.push(a);
      const K = a.K, dx = g.x - a.x, dz = g.z - a.z, d = Math.hypot(dx, dz), toR = Math.atan2(dz, dx);
      a.t -= dt;
      // the rider: shy off if close, look up if not far
      if (d < K.shy * (a.young ? 1.3 : 1) && (g.v > 0.6 || d < K.rad + 1.2) && a.st !== 'flee') {
        a.st = 'flee'; a.t = 1.2 + R() * 1.6; a.fy = toR + Math.PI + (R() - 0.5) * 1.2;
        // sheep go together: when one bolts, those beside it bolt the same way
        if (a.kind === 'sheep') for (const b of L) if (b !== a && b.kind === 'sheep' && b.st !== 'flee' && Math.abs(b.x - a.x) < 6 && Math.abs(b.z - a.z) < 6) { b.st = 'flee'; b.t = 0.8 + R() * 1.4; b.fy = a.fy + (R() - 0.5) * 0.9; }
      }
      else if (d < 13 && g.v > 0.4 && a.st === 'graze' && R() < dt * 0.9) { a.st = 'look'; a.t = 2 + R() * 3; }
      let vt = 0, yawT = a.yaw, turn = 1.4, headT = 0, lookT = 0;
      if (a.st === 'graze') {
        // a step now and then, nose still down; drift back if it has strayed
        a.step -= dt;
        if (a.step < 0) { a.step = 2.5 + R() * 5; a.go = 0.9 + R() * 0.8; a.dy = (R() - 0.5) * 0.9; }
        if (a.go > 0) { a.go -= dt; vt = K.walk * 0.30; yawT = a.yaw + a.dy; turn = 0.5; }
        if (Math.hypot(a.x - a.hx, a.z - a.hz) > a.hr) { yawT = Math.atan2(a.hz - a.z, a.hx - a.x); turn = 0.8; }
        if (a.t < 0) {
          if (R() < 0.45) {
            // off to a fresh patch
            for (let k = 0; k < 6; k++) {
              const an = R() * TAU, dd = 6 + R() * 16, tx = clamp(a.x + Math.cos(an) * dd, a.hx - a.hr, a.hx + a.hr), tz = clamp(a.z + Math.sin(an) * dd, a.hz - a.hr, a.hz + a.hr);
              if (this.ok(tx, tz) && this.ok((a.x + tx) / 2, (a.z + tz) / 2)) { a.st = 'walk'; a.tx = tx; a.tz = tz; a.t = 30; break; }
            }
            if (a.st !== 'walk') a.t = 3;
          } else if (R() < 0.3) { a.st = 'look'; a.t = 1.5 + R() * 3; }
          else a.t = 6 + R() * 22;
        }
      } else if (a.st === 'walk') {
        headT = 0.8; vt = K.walk * (a.young ? 1.15 : 1);
        yawT = Math.atan2(a.tz - a.z, a.tx - a.x);
        if (Math.hypot(a.tx - a.x, a.tz - a.z) < 1.0 || a.t < 0) { a.st = 'graze'; a.t = 8 + R() * 25; }
      } else if (a.st === 'look') {
        headT = 1; if (d < 30) lookT = clamp(wrapPi(toR - a.yaw), -1.1, 1.1);
        if (a.t < 0) { a.st = 'graze'; a.t = 6 + R() * 20; }
      } else {      // flee
        headT = 1; vt = K.run * (a.young ? 1.1 : 1); yawT = a.fy; turn = 4.5;
        if (a.t < 0) { a.st = 'look'; a.t = 1.5 + R() * 2.5; }
      }
      a.yaw += clamp(wrapPi(yawT - a.yaw), -turn * dt, turn * dt);
      a.v += clamp(vt - a.v, -3.5 * dt, (a.st === 'flee' ? 6 : 1.6) * dt);
      a.head = damp(a.head, headT, a.st === 'flee' ? 7 : 2.4, dt); a.look = damp(a.look, lookT, 3, dt);
      if (a.v > 0.01) {
        const nx = a.x + Math.cos(a.yaw) * a.v * dt, nz = a.z + Math.sin(a.yaw) * a.v * dt;
        if (this.ok(nx, nz) || !this.ok(a.x, a.z)) { a.x = nx; a.z = nz; }
        else { a.v = 0; a.fy = a.yaw + 2.2; if (a.st === 'walk') { a.st = 'graze'; a.t = 5; } else if (a.st === 'graze') a.dy = 1.8; }      // not that way
        // how far a full stride carries it at this pace sets how fast the legs go
        const run = smooth(K.walk * 1.2, K.run * 0.8, a.v), A = lerp(K.Aw, K.Ar, run), duty = lerp(0.62, 0.42, run);
        const ph0 = a.phase; a.phase = frac(a.phase + dt * a.v / (2 * K.Lleg * a.sc * Math.sin(A) / duty));
        if (Math.floor(ph0 * 4) !== Math.floor(a.phase * 4) && Trail.near(a.x, a.z)) { const q = Math.floor(a.phase * 4), cow = a.kind === 'cow', fo = (q < 2 ? 0.34 : -0.34) * (cow ? 1.5 : 1) * a.sc, sd = (q % 2 ? 0.10 : -0.10) * (cow ? 1.6 : 1) * a.sc, c = Math.cos(a.yaw), sn = Math.sin(a.yaw); Trail.stamp(a.x + c * fo - sn * sd, a.z + sn * fo + c * sd, a.yaw, 2, 0, (cow ? 0.22 : 0.13) * a.sc); }
      }
      a.y = terrainH(a.x, a.z);
      const fx = Math.cos(a.yaw), fz = Math.sin(a.yaw);
      a.slope = damp(a.slope, (terrainH(a.x + fx, a.z + fz) - terrainH(a.x - fx, a.z - fz)) / 2, 4, dt);
      // the horse does not walk through them
      if (d < K.rad * a.sc + 0.7 && d > 1e-4) { const push = K.rad * a.sc + 0.7 - d; g.x += dx / d * push * 0.6; g.z += dz / d * push * 0.6; a.x -= dx / d * push * 0.4; a.z -= dz / d * push * 0.4; }
    }
    // nor through each other
    for (let i = 0; i < near.length; i++) for (let j = i + 1; j < near.length; j++) {
      const a = near[i], b = near[j], dx = b.x - a.x, dz = b.z - a.z, rr = (a.K.rad * a.sc + b.K.rad * b.sc) * 0.72;
      if (Math.abs(dx) > rr || Math.abs(dz) > rr) continue;
      const d = Math.hypot(dx, dz); if (d >= rr || d < 1e-4) continue;
      const p = (rr - d) * 0.5 / d; a.x -= dx * p; a.z -= dz * p; b.x += dx * p; b.z += dz * p;
    }
    // shadows, and a voice now and then
    for (const a of near) if (Math.abs(a.x - G.cam[0]) < 340 && Math.abs(a.z - G.cam[2]) < 340) Shade.extra.push({ x: a.x, z: a.z, a: a.K.box[0] * a.sc, b: a.K.box[1] * a.sc, rot: a.yaw, h: a.K.box[2] * a.sc });
    this.callT -= dt;
    if (this.callT < 0) {
      this.callT = 4 + R() * 9;
      const c = near.filter(a => Math.hypot(a.x - g.x, a.z - g.z) < 90);
      if (c.length) { const a = c[Math.floor(R() * c.length)]; Sound.call(a.kind, Math.hypot(a.x - g.x, a.z - g.z), a.young); }
    }
  },

  // the skeleton of one animal, this instant
  pose(a) {
    const K = a.K, B = this.B, mv = smooth(0.02, 0.30, a.v), run = smooth(K.walk * 1.2, K.run * 0.8, a.v), A = lerp(K.Aw, K.Ar, run) * mv, duty = lerp(0.62, 0.42, run), ph = a.phase, t = G.time + a.seed * 100;
    const bob = (0.010 + 0.030 * run) * K.Lleg * Math.sin(ph * TAU * 2) * mv;
    Rig.set(B, 0, [0, 0, 0], [0, bob, 0], 0.03 * run * Math.sin(ph * TAU * 2 + 1), 0, 0);
    // the head: down to graze (tearing at the grass), up to walk or to look
    const tear = (1 - a.head) * 0.05 * Math.sin(t * 5.2) * (0.5 + 0.5 * Math.sin(t * 0.7)), nod = 0.05 * mv * Math.sin(ph * TAU * 2);
    const np = lerp(K.down, K.up, a.head) + nod, hpz = np + lerp(K.headDown, 0, a.head) + tear;
    Rig.set(B, 1, K.np, Rig.xf(B, 0, K.np), np, a.look * 0.5, 0);
    Rig.set(B, 2, K.hp, Rig.xf(B, 1, K.hp), hpz, a.look, 0);
    for (const l of this.LEGS) {
      const s = Rig.step(frac(ph - lerp(l.ph, l.pt, run)), duty, A), hip = l.front ? K.hipF : K.hipH, knee = l.front ? K.kneeF : K.kneeH, z = l.s * K.hz[l.front ? 0 : 1];
      const bend = K.bend * Math.sin(Math.PI * s[1]) * mv * (0.6 + 0.6 * run);
      const h3 = [hip[0], hip[1], z], k3 = [knee[0], knee[1], z];
      Rig.set(B, l.U, h3, Rig.xf(B, 0, h3), s[0], 0, 0);
      Rig.set(B, l.L, k3, Rig.xf(B, l.U, k3), s[0] + (l.front ? -bend : bend * 0.8), 0, 0);
    }
    if (K.tail) Rig.set(B, 11, K.tail, Rig.xf(B, 0, K.tail), 0.10 * mv, 0, 0.30 * Math.sin(t * 1.9) * Math.max(0, Math.sin(t * 0.37)) + 0.05 * Math.sin(t * 5.0));
  },
  draw() {
    const p = Horse.progBody.use(); setGlobals(p); p.f1('uCut', 99); p.f1('uProp', 0); p.f1('uSelf', 1);
    const m = this.m, cx = G.cam[0], cz = G.cam[2];
    for (const a of this.list) {
      if (Math.abs(a.x - cx) > 650 || Math.abs(a.z - cz) > 650) continue;
      if (rideSession && outsideRideView(a.x, a.y + 0.8, a.z, 3.5)) continue;  // includes a turning head, horns and tail
      this.pose(a);
      const fx = Math.cos(a.yaw), fz = Math.sin(a.yaw), sl = clamp(a.slope, -0.5, 0.5), il = 1 / Math.hypot(1, sl), s = a.sc;
      const f = [fx * il, sl * il, fz * il], r = [-fz, 0, fx], u = v3.cross(r, f);
      m.set([f[0] * s, f[1] * s, f[2] * s, 0, u[0] * s, u[1] * s, u[2] * s, 0, r[0] * s, r[1] * s, r[2] * s, 0, a.x, a.y - 0.02, a.z, 1]);
      p.m4('uModel', m); gl.uniformMatrix4fv(p.u('uBones'), false, this.B);
      gl.bindVertexArray(a.K.vaos[a.coat]); gl.drawElements(gl.TRIANGLES, a.K.count, gl.UNSIGNED_INT, 0);
    }
    p.f1('uSelf', 0);
  },
};

// ======== 08g_people.js
// ---------------------------------------------------------------- the people of the village
// A person is a body and a head, sculpted apart so that the head can be finer, can be swapped, and can be larger on a child.
// Bodies: a man in a short coat, a man in a long one, a woman in a long dress. Heads: fur hat, skullcap, an old man with a white beard,
// a woman in a headscarf, a girl with two long braids, a bare-headed boy. Each comes in several colourings.
// What they do: stand at a door, sit on the bench beside it, walk from house to house, carry water from the river on a yoke,
// split firewood, talk in pairs, run about (the children), keep the flock (the herders). They greet a rider who comes near.
// Bones: 0 trunk, 1 head, 2 right upper arm, 3 right forearm (left: 4, 5), 6 right thigh, 7 right shin (left: 8, 9).
const People = {
  list: [], bodies: {}, heads: {}, B: null, B2: null, S: null, m: new Float32Array(16), props: [], ms: 0, tp: 0, axeP: 0,
  ARM: 0.42,      // arms are sculpted held this far out from the body, so that sleeve and coat do not melt together

  // ---- bodies
  sculptBody(kind) {
    const E = SDF.ell, C = SDF.cap, prims = [], P = (p, tag, arm) => { p.tag = tag || ''; p.arm = !!arm; prims.push(p); return p; };
    const woman = kind === 'dress', long = kind === 'coat', al = this.ARM;
    // the arm, given hanging at the side and turned outward about the shoulder for sculpting
    const SH = woman ? [0, 1.39, 0.165] : [0, 1.44, 0.20], EL = woman ? [0, 1.135, 0.178] : [0, 1.165, 0.215], zh = EL[2], T = Rig.make(); Rig.set(T, 0, SH, SH, 0, 0, -al);
    const A = (a, b, ra, rb, sz, k, bone, tag) => { const p = Rig.xf(T, 0, a), q = Rig.xf(T, 0, b); P(C(p[0], p[1], p[2], q[0], q[1], q[2], ra, rb, sz, k, bone), tag, true); };
    if (!woman) {
      P(E(0.000, 0.96, 0, 0.115, 0.120, 0.160, 0, 0.05, 0));                      // hips
      P(E(0.000, 1.18, 0, 0.110, 0.190, 0.152, 0, 0.06, 0));                      // waist
      P(E(0.015, 1.36, 0, 0.120, 0.140, 0.172, 0, 0.06, 0));                      // chest
      P(C(0, 1.455, 0, 0, 1.450, 0.158, 0.064, 0.055, 1, 0.05, 0));               // shoulders
      P(C(0.000, 1.48, 0, 0.006, 1.57, 0, 0.050, 0.046, 1, 0.03, 0), 'neck');
      P(E(0.004, 1.515, 0, 0.066, 0.026, 0.070, 0, 0.015, 0), 'collar');
      if (!long) P(E(0.000, 0.90, 0, 0.148, 0.085, 0.190, 0, 0.04, 0));           // the skirt of a short coat
      A(SH, EL, 0.054, 0.047, 1, 0.035, 2); A(EL, [0.02, 0.955, zh], 0.045, 0.041, 1, 0.025, 3);       // sleeve
      A([0.018, 0.985, zh], [0.02, 0.948, zh], 0.047, 0.047, 1, 0.006, 3, 'cuff');
      A([0.022, 0.945, zh], [0.030, 0.862, zh], 0.031, 0.026, 0.80, 0.012, 3, 'hand');
      A([0.040, 0.925, zh - 0.008], [0.058, 0.875, zh - 0.016], 0.011, 0.009, 1, 0.006, 3, 'hand');     // thumb
      if (long) P(C(0, 0.95, 0.088, 0.012, 0.535, 0.100, 0.104, 0.112, 1, 0.045, 6), 'skirt'); // the long coat hangs to the knee, a panel to each leg
      P(C(0, 0.93, 0.092, 0.012, 0.50, 0.098, 0.083, 0.060, 1, 0.04, 6));         // thigh
      P(C(0.012, 0.50, 0.098, 0, 0.10, 0.100, 0.062, 0.050, 1, 0.03, 7));         // shin, in a boot
      P(C(-0.03, 0.045, 0.100, 0.135, 0.040, 0.104, 0.047, 0.036, 1, 0.02, 7));   // foot
    } else {
      P(E(0.000, 1.13, 0, 0.088, 0.150, 0.116, 0, 0.05, 0));                      // waist
      P(E(0.018, 1.31, 0, 0.100, 0.118, 0.136, 0, 0.05, 0));                      // chest
      P(C(0, 1.395, 0, 0, 1.390, 0.125, 0.052, 0.046, 1, 0.05, 0));               // shoulders
      P(C(0, 1.04, 0, 0, 0.25, 0, 0.125, 0.290, 1, 0.05, 0), 'skirt');            // the dress, to the ground
      P(C(0.000, 1.44, 0, 0.006, 1.515, 0, 0.044, 0.040, 1, 0.03, 0), 'neck');
      A(SH, EL, 0.046, 0.041, 1, 0.03, 2); A(EL, [0.02, 0.935, zh], 0.039, 0.035, 1, 0.022, 3);
      A([0.018, 0.965, zh], [0.02, 0.928, zh], 0.041, 0.041, 1, 0.006, 3, 'cuff');
      A([0.022, 0.925, zh], [0.030, 0.850, zh], 0.028, 0.023, 0.80, 0.012, 3, 'hand');
      A([0.038, 0.905, zh - 0.007], [0.054, 0.860, zh - 0.014], 0.010, 0.008, 1, 0.006, 3, 'hand');
      P(C(0.06, 0.035, 0.085, 0.245, 0.030, 0.092, 0.042, 0.034, 1, 0.015, 6), 'foot');      // a toe shows under the hem
    }
    const f = SDF.make(prims), dT = (tag, x, y, az) => { let d = 9; for (const p of prims) if (p.tag === tag) d = Math.min(d, p.d(x, y, az)); return d; };
    const info = (x, y, z, n) => {
      const az = Math.abs(z); let da = 9, db = 9; for (const p of prims) { const d = p.d(x, y, az); if (p.arm) { if (d < da) da = d; } else if (d < db) db = d; }
      return { arm: da < db, hand: dT('hand', x, y, az) < 0.006, cuff: dT('cuff', x, y, az) < 0.004, neck: dT('neck', x, y, az) < 0.006 && y > (woman ? 1.47 : 1.53), collar: !woman && dT('collar', x, y, az) < 0.008,
        foot: woman && dT('foot', x, y, az) < 0.01, skirt: (woman || long) && dT('skirt', x, y, az) < 0.02, n2: vnoise(x * 30 + z * 17, y * 30), y, x, az, nx: n[0], ny: n[1] };
    };
    const SKIN = [0.37, 0.24, 0.17], OCHRE = [0.215, 0.160, 0.070], DARK = [0.045, 0.038, 0.032], FUR = [0.150, 0.105, 0.065], CREAM = [0.360, 0.340, 0.300], RED = [0.280, 0.045, 0.038];
    let paints, bind;
    if (!woman) {
      // coat, its trim, sash, trousers; fur: the edges of the coat are trimmed with it
      const dress = (coat, trim, sash, trouser, fur) => (x, y, z, i) => {
        if (i.hand || i.neck) return [SKIN[0], SKIN[1], SKIN[2], 0.2];
        const edge = fur ? [fur[0] * (0.7 + 0.6 * i.n2), fur[1] * (0.7 + 0.6 * i.n2), fur[2] * (0.7 + 0.6 * i.n2), 0.05] : [trim[0], trim[1], trim[2], 0.3];
        if (i.cuff || i.collar) return edge;
        const k = 0.90 + 0.20 * i.n2;
        if (!i.arm) {
          const hem = long ? 0.47 : 0.84;
          if (y < hem && !(long && i.skirt && y > 0.40)) return y < 0.44 ? [0.050, 0.034, 0.024, 0.45] : [trouser[0] * k, trouser[1] * k, trouser[2] * k, 0.1];      // boots, trousers
          if (y > 1.035 && y < 1.095) return [sash[0], sash[1], sash[2], 0.15];
          if (y < hem + 0.04) return edge;                                                                   // round the hem
          if (i.x > 0.04 && i.az < 0.017 && y < 1.50) return [trim[0], trim[1], trim[2], 0.3];               // down the front, where the coat closes
        }
        return [coat[0] * k, coat[1] * k, coat[2] * k, 0.1];
      };
      paints = [dress([0.045, 0.060, 0.105], OCHRE, RED, [0.045, 0.042, 0.045]),
        dress([0.115, 0.078, 0.048], DARK, [0.090, 0.150, 0.220], [0.060, 0.055, 0.050], FUR),
        dress([0.070, 0.082, 0.058], OCHRE, [0.215, 0.160, 0.070], [0.050, 0.045, 0.040]),
        dress([0.125, 0.040, 0.038], DARK, [0.045, 0.045, 0.050], [0.070, 0.065, 0.060], [0.050, 0.045, 0.040])];
      bind = bindPrims(prims, { 2: 2, 3: 2, 6: 2, 7: 2 }, 0.024, 0.035);
    } else {
      const dress = (gown, vest, apron, band) => (x, y, z, i) => {
        if (i.hand || i.neck) return [SKIN[0] * 1.03, SKIN[1] * 1.04, SKIN[2] * 1.06, 0.2];
        if (i.foot && y < 0.075) return [0.050, 0.032, 0.022, 0.45];
        if (i.cuff) return [band[0], band[1], band[2], 0.3];
        if (!i.arm) {
          if (apron && i.nx > 0.35 && i.az < 0.12 && y < 1.02 && y > 0.22) return y < 0.27 ? [band[0], band[1], band[2], 0.2] : [apron[0], apron[1], apron[2], 0.1];
          if (y > 1.04 && y < 1.45) return (i.x > 0.05 && i.az < 0.014) || y < 1.065 ? [band[0], band[1], band[2], 0.3] : [vest[0], vest[1], vest[2], 0.12];      // a waistcoat, edged
          if (y < 0.19 && y > 0.07) return [band[0], band[1], band[2], 0.3];                                // an embroidered band above the hem
        }
        const k = 0.88 + 0.24 * i.n2;
        return [gown[0] * k, gown[1] * k, gown[2] * k, 0.1];
      };
      paints = [dress([0.240, 0.045, 0.040], [0.040, 0.036, 0.040], CREAM, OCHRE),
        dress([0.055, 0.075, 0.170], [0.125, 0.040, 0.045], null, CREAM),
        dress([0.070, 0.105, 0.065], [0.050, 0.040, 0.035], CREAM, RED),
        dress([0.085, 0.048, 0.070], [0.045, 0.045, 0.070], null, OCHRE)];
      // the skirt swings with the legs under it: more toward the hem, not at all on the midline
      const base = bindPrims(prims, { 2: 2, 3: 2, 6: 2 }, 0.022, 0.035);
      bind = (x, y, z, o) => {
        base(x, y, z, o);
        if (o[0] === 0 && o[4] > 0.55 && y < 1.0) { const w = smooth(1.0, 0.25, y) * 0.80 * smooth(0, 0.07, Math.abs(z)); o[0] = 0; o[1] = z < 0 ? 8 : 6; o[2] = 0; o[3] = 0; o[4] = 1 - w; o[5] = w; o[6] = 0; o[7] = 0; }
      };
    }
    // bring the arms down to the sides
    const fix = Rig.make(), SL = [SH[0], SH[1], -SH[2]]; Rig.set(fix, 2, SH, SH, 0, 0, al); Rig.set(fix, 3, SH, SH, 0, 0, al); Rig.set(fix, 4, SL, SL, 0, 0, -al); Rig.set(fix, 5, SL, SL, 0, 0, -al);
    const lo = woman ? [-0.38, -0.06, -0.56] : [-0.26, -0.02, -0.60], hi = woman ? [0.38, 1.60, 0.56] : [0.26, 1.64, 0.60];
    const K = bakeSkins(f, lo, hi, woman ? 0.017 : 0.016, info, paints, bind, { fix });
    K.far = bakeSkins(f, lo, hi, 0.032, info, paints, bind, { fix });
    return woman ? Object.assign(K, { neck: [0.006, 1.50], sho: SH, elb: EL, hip: [0, 0.93, 0.09], hand: [0.03, 0.865, zh], shin: false, Lleg: 0.80, A: 0.30, pole: 1.435 })
      : Object.assign(K, { neck: [0.006, 1.555], sho: SH, elb: EL, hip: [0, 0.93, 0.092], knee: [0.012, 0.50, 0.098], hand: [0.03, 0.885, zh], shin: true, Lleg: 0.88, A: 0.42, pole: 1.50 });
  },

  // ---- heads, sculpted about the top of the neck (0, 0, 0). The face is meshed apart, twice as fine
  sculptHead(kind) {
    const E = SDF.ell, C = SDF.cap, prims = [], P = (p, tag) => { p.tag = tag || ''; prims.push(p); };
    P(E(0.006, 0.110, 0, 0.092, 0.104, 0.078, 0, 0.03, 1), 'skin');             // cranium
    P(E(0.036, 0.062, 0, 0.068, 0.082, 0.062, 0, 0.03, 1), 'skin');             // face
    P(E(0.052, 0.006, 0, 0.038, 0.030, 0.038, 0, 0.025, 1), 'skin');            // chin
    P(E(0.060, 0.048, 0.038, 0.024, 0.026, 0.022, 0, 0.02, 1), 'skin');         // cheekbone
    P(C(0.088, 0.100, 0, 0.078, 0.098, 0.046, 0.013, 0.010, 1, 0.015, 1), 'skin');   // brow
    P(C(0.094, 0.094, 0, 0.113, 0.052, 0, 0.008, 0.013, 1, 0.010, 1), 'skin');  // nose
    P(E(0.106, 0.050, 0.011, 0.008, 0.007, 0.008, 0, 0.005, 1), 'skin');        // the wing of the nostril
    P(E(0.097, 0.020, 0, 0.013, 0.010, 0.023, 0, 0.008, 1), 'lips');
    P(E(0.004, 0.072, 0.079, 0.013, 0.027, 0.008, 0, 0.006, 1), 'skin');        // ear
    P(C(0.000, -0.09, 0, 0.004, 0.02, 0, 0.045, 0.044, 1, 0.03, 1), 'skin');    // neck
    if (kind === 'fur' || kind === 'elder') {
      P(E(0.000, 0.190, 0, 0.100, 0.060, 0.094, 0, 0.02, 1), 'hat');
      P(E(0.000, 0.152, 0, 0.113, 0.038, 0.105, 0, 0.012, 1), 'fur');           // the band of fur round it
      P(E(-0.070, 0.085, 0.075, 0.040, 0.075, 0.022, 0.2, 0.012, 1), 'fur');    // flaps over the ears and neck
    }
    if (kind === 'cap') P(E(0.002, 0.196, 0, 0.086, 0.036, 0.076, 0, 0.008, 1), 'hat');      // an embroidered skullcap
    if (kind === 'elder') { P(E(0.060, -0.045, 0, 0.042, 0.075, 0.042, 0.15, 0.02, 1), 'beard'); P(E(0.092, 0.030, 0.018, 0.014, 0.010, 0.022, 0, 0.006, 1), 'beard'); }
    if (kind === 'scarf') {
      P(E(-0.004, 0.122, 0, 0.101, 0.103, 0.091, 0, 0.02, 1), 'scarf');
      P(C(-0.060, 0.050, 0, -0.085, -0.170, 0, 0.068, 0.088, 1.4, 0.04, 1), 'scarf');        // it hangs down the back
      P(E(0.055, -0.040, 0, 0.026, 0.030, 0.045, 0, 0.012, 1), 'scarf');                      // and is tied under the chin
    }
    if (kind === 'girl') {
      P(E(-0.008, 0.122, 0, 0.098, 0.100, 0.086, 0, 0.02, 1), 'hair');
      P(C(-0.030, 0.040, 0.080, 0.050, -0.340, 0.118, 0.022, 0.015, 1, 0.012, 1), 'braid');   // two braids, forward over the shoulders
      P(E(0.000, 0.205, 0, 0.068, 0.030, 0.062, 0, 0.008, 1), 'hat');                         // and a little round cap
    }
    if (kind === 'boy') P(E(-0.004, 0.126, 0, 0.097, 0.097, 0.084, 0, 0.02, 1), 'hair');
    const f = SDF.make(prims), dT = (tag, x, y, az) => { let d = 9; for (const p of prims) if (p.tag === tag) d = Math.min(d, p.d(x, y, az)); return d; };
    const info = (x, y, z, n) => {
      const az = Math.abs(z), skin = Math.min(dT('skin', x, y, az), dT('lips', x, y, az)), ey = y - 0.0865, ez = az - 0.0305;
      const o = { hat: dT('hat', x, y, az) < 0.005, fur: dT('fur', x, y, az) < 0.006, beard: dT('beard', x, y, az) < 0.006, scarf: dT('scarf', x, y, az) < 0.006, hair: dT('hair', x, y, az) < 0.006, braid: dT('braid', x, y, az) < 0.006,
        lips: dT('lips', x, y, az) < 0.003 && x > 0.093, n2: vnoise(x * 60 + z * 33, y * 60), pat: vnoise(x * 85 + z * 71, y * 85), x, y, az };
      // the face is left bare by scarf and hair: an oval
      o.face = x > 0.045 && y < 0.150 - Math.max(0, az - 0.03) * 0.5 && skin < 0.012;
      if (kind === 'scarf' && o.scarf && o.face) o.scarf = false;
      if ((kind === 'girl' || kind === 'boy') && o.hair && (o.face || (y < 0.06 && x > -0.01))) o.hair = false;
      // features drawn on the skin
      const front = x > 0.060 && skin < 0.010, top = 0.0056 * Math.sqrt(Math.max(0, 1 - (ez * ez) / (0.0125 * 0.0125)));
      o.eye = front && Math.abs(ez) < 0.0125 && Math.abs(ey) < top ? (ez * ez + ey * ey < 0.0058 * 0.0058 ? 2 : 1) : 0;
      o.lid = front && Math.abs(ez) < 0.0145 && ey > top - 0.0003 && ey < top + 0.0030;
      o.brow = front && Math.abs(y - (0.1035 + 0.0040 * (1 - Math.pow((az - 0.029) / 0.018, 2)))) < 0.0028 && az > 0.010 && az < 0.048;
      o.mouth = o.lips && Math.abs(y - 0.0205) < 0.0015 && az < 0.019;
      o.tash = x > 0.086 && y > 0.026 && y < 0.040 && az < 0.030 && skin < 0.012;
      o.jaw = skin < 0.012 && x > 0.01 && y < 0.040 - (x - 0.06) * 0.2 && y > -0.03;
      o.back = skin < 0.012 && !o.face && y > 0.03 + Math.max(0, x) * 0.9;       // where hair grows
      o.cheek = sat(1 - Math.hypot(x - 0.078, y - 0.045, az - 0.040) / 0.026);
      return o;
    };
    // skin, hair, then whatever is worn. beard: 0 none, 1 a moustache, 2 a dark stubble along the jaw too
    const face = (skin, hair, wear, beard) => (x, y, z, i) => {
      const W = wear || {};
      if (i.eye === 2) return [0.030, 0.020, 0.016, 0.9];
      if (i.eye === 1) return [0.44, 0.42, 0.39, 0.6];
      if (i.hat) { const c = W.pat && i.pat > 0.56 ? W.pat : W.hat; return [c[0], c[1], c[2], 0.2]; }
      if (i.fur) { const k = 0.65 + 0.7 * i.n2; return [W.fur[0] * k, W.fur[1] * k, W.fur[2] * k, 0.05]; }
      if (i.scarf) { const c = W.dots && i.pat > 0.66 ? W.dots : W.scarf; return [c[0], c[1], c[2], 0.15]; }
      if (i.beard) { const k = 0.8 + 0.4 * i.n2; return [0.44 * k, 0.43 * k, 0.41 * k, 0.1]; }
      if (i.braid) { const k = 0.7 + 0.5 * Math.abs(Math.sin(y * 150)); return [hair[0] * k, hair[1] * k, hair[2] * k, 0.5]; }
      if (i.hair) { const k = 0.75 + 0.5 * i.n2; return [hair[0] * k, hair[1] * k, hair[2] * k, 0.5]; }
      if (i.lid) return [0.050, 0.032, 0.026, 0.3];
      if (i.brow) return kind === 'elder' ? [0.40, 0.39, 0.37, 0.2] : [hair[0], hair[1], hair[2], 0.3];
      if (i.mouth) return [skin[0] * 0.36, skin[1] * 0.24, skin[2] * 0.24, 0.3];
      if (i.lips) return [skin[0] * 0.80, skin[1] * 0.52, skin[2] * 0.52, 0.3];
      if (beard >= 1 && i.tash) return [hair[0], hair[1], hair[2], 0.3];
      if (i.back && !i.face) return [hair[0], hair[1], hair[2], 0.4];
      let c = skin;
      if (beard >= 2 && i.jaw) c = v3.lerp(skin, hair, 0.5);
      const r = i.cheek * (W.rosy || 0.25);
      return [c[0] * (1 + 0.10 * r), c[1] * (1 - 0.14 * r), c[2] * (1 - 0.16 * r), 0.22];
    };
    const S1 = [0.38, 0.25, 0.18], S2 = [0.33, 0.20, 0.14], S3 = [0.42, 0.29, 0.22], BLK = [0.028, 0.022, 0.018], BRN = [0.085, 0.050, 0.030], OCHRE = [0.30, 0.22, 0.08], CREAM = [0.40, 0.38, 0.34], RED = [0.28, 0.045, 0.038];
    const paints = {
      fur: [face(S1, BLK, { hat: [0.075, 0.045, 0.030], fur: [0.150, 0.095, 0.055] }, 1), face(S2, BLK, { hat: [0.045, 0.060, 0.100], fur: [0.050, 0.044, 0.040] }, 2), face(S3, BRN, { hat: [0.170, 0.045, 0.040], fur: [0.30, 0.26, 0.21] }, 0)],
      cap: [face(S1, BLK, { hat: [0.030, 0.028, 0.030], pat: CREAM }, 1), face(S2, BLK, { hat: [0.045, 0.100, 0.065], pat: OCHRE }, 2), face(S3, BRN, { hat: [0.170, 0.040, 0.036], pat: OCHRE }, 0)],
      elder: [face([0.36, 0.24, 0.18], [0.42, 0.41, 0.39], { hat: [0.060, 0.045, 0.036], fur: [0.200, 0.170, 0.130] }, 0), face([0.33, 0.21, 0.15], [0.42, 0.41, 0.39], { hat: [0.040, 0.050, 0.085], fur: [0.045, 0.042, 0.040] }, 0)],
      scarf: [face(S3, BLK, { scarf: CREAM, rosy: 0.6 }), face(S1, BLK, { scarf: RED, dots: OCHRE, rosy: 0.5 }), face(S3, BRN, { scarf: OCHRE, dots: RED, rosy: 0.6 }), face(S2, BLK, { scarf: [0.080, 0.115, 0.230], dots: CREAM, rosy: 0.4 })],
      girl: [face(S3, BLK, { hat: RED, pat: OCHRE, rosy: 0.8 }), face(S1, BRN, { hat: [0.060, 0.100, 0.180], pat: CREAM, rosy: 0.7 })],
      boy: [face(S1, BLK, { rosy: 0.7 }), face(S3, BRN, { rosy: 0.7 })],
    }[kind];
    const rigid = (x, y, z, o) => { o[0] = 1; o[1] = 0; o[2] = 0; o[3] = 0; o[4] = 1; o[5] = 0; o[6] = 0; o[7] = 0; };
    const lo = [-0.20, -0.36, -0.16], hi = [0.16, 0.27, 0.16], F0 = [0.030, -0.030, 0.070], F1 = [0.136, 0.132], mg = 0.009;
    const H = bakeSkins(f, lo, hi, 0.0066, info, paints, rigid, { drop: (x, y, z) => x > F0[0] + mg && y > F0[1] + mg && y < F1[1] - mg && Math.abs(z) < F0[2] - mg });
    H.face = bakeSkins(f, [F0[0], F0[1], -F0[2]], [F1[0], F1[1], F0[2]], 0.0033, info, paints, rigid);
    H.far = bakeSkins(f, lo, hi, 0.014, info, paints, rigid);
    return H;
  },

  // ---- things: the herder's staff, an axe, a yoke and its buckets, a bench for the wall, a chopping block with the wood round it
  makeThings() {
    const WOOD = [0.20, 0.13, 0.07], PALE = [0.36, 0.26, 0.14], BARK = [0.085, 0.060, 0.042], STEEL = [0.20, 0.21, 0.23], ROPE = [0.24, 0.20, 0.13];
    const row = (t, c, g) => [...t, ...c, g], oct = (M, r, y, c, g) => { const p = []; for (let k = 0; k < 8; k++) p.push([r * Math.cos(k * TAU / 8), y, -r * Math.sin(k * TAU / 8)]); M.quad(p[0], p[1], p[2], p[3], c, g); M.quad(p[0], p[3], p[4], p[7], c, g); M.quad(p[4], p[5], p[6], p[7], c, g); };
    let M = this.staff = new DynMesh(60, 300); M.begin();
    M.loft([[0, -1.04, 0, .017, .017, .017], [0, 0.0, 0, .015, .015, .015], [0, 0.78, 0, .012, .012, .012]].map(t => row(t, WOOD, 0.2)), [1, 0, 0], 6, true, true); M.finish();
    // the axe hangs from the hand that holds it: the helve down, the edge to the rear
    M = this.axe = new DynMesh(80, 400); M.begin();
    M.loft([[0, 0.10, 0, .015, .015, .015], [0, -0.60, 0, .017, .017, .017]].map(t => row(t, WOOD, 0.3)), [1, 0, 0], 6, true, true);
    M.loft([[0.035, -0.555, 0, .016, .016, .034], [-0.03, -0.555, 0, .012, .012, .040], [-0.115, -0.555, 0, .002, .002, .062]].map(t => row(t, STEEL, 0.9)), [0, 1, 0], 6, true, true); M.finish();
    M = this.pole = new DynMesh(80, 400); M.begin();
    M.loft([[-0.02, -0.030, -0.66, .015, .015, .015], [-0.02, -0.008, -0.33, .017, .017, .017], [-0.02, 0, 0, .018, .018, .018], [-0.02, -0.008, 0.33, .017, .017, .017], [-0.02, -0.030, 0.66, .015, .015, .015]].map(t => row(t, WOOD, 0.3)), [0, 1, 0], 6, true, true); M.finish();
    // a bucket on its rope, hanging from (0, 0, 0)
    M = this.bucket = new DynMesh(120, 600); M.begin();
    M.loft([[0, 0, 0, .006, .006, .006], [0, -0.40, 0, .006, .006, .006]].map(t => row(t, ROPE, 0.1)), [1, 0, 0], 4, false, false);
    M.loft([row([0, -0.385, 0, .100, .100, .100], WOOD, 0.25), row([0, -0.40, 0, .100, .100, .100], [0.07, 0.07, 0.075], 0.6), row([0, -0.42, 0, .099, .099, .099], WOOD, 0.25), row([0, -0.58, 0, .086, .086, .086], WOOD, 0.25), row([0, -0.60, 0, .084, .084, .084], [0.07, 0.07, 0.075], 0.6), row([0, -0.62, 0, .082, .082, .082], WOOD, 0.25)], [1, 0, 0], 10, false, true);
    oct(M, 0.092, -0.40, [0.060, 0.105, 0.135], 0.95); M.finish();
    M = this.bench = new DynMesh(200, 900); M.begin();
    M.loft([[0, 0.425, -0.85, .026, .026, .15], [0, 0.425, 0.85, .026, .026, .15]].map(t => row(t, WOOD, 0.2)), [1, 0, 0], 8, true, true);
    for (const z of [-0.62, 0.62]) M.loft([[0, -0.1, z, .11, .11, .11], [0, 0.40, z, .10, .10, .10]].map(t => row(t, BARK, 0.1)), [1, 0, 0], 8, true, true);
    M.finish();
    M = this.block = new DynMesh(500, 2400); M.begin();
    M.loft([[0, -0.1, 0, .21, .21, .21], [0, 0.47, 0, .20, .20, .20]].map(t => row(t, BARK, 0.1)), [1, 0, 0], 10, false, false);
    oct(M, 0.20, 0.47, PALE, 0.2);
    const rb = rng(12);
    for (let i = 0; i < 11; i++) { const a = rb() * TAU, d = 0.55 + rb() * 0.9, x = Math.cos(a) * d - 0.3, z = Math.sin(a) * d, b = rb() * TAU, l = 0.16 + rb() * 0.06;
      M.loft([[x - Math.cos(b) * l, 0.05, z - Math.sin(b) * l, .05, .05, .06], [x + Math.cos(b) * l, 0.05, z + Math.sin(b) * l, .05, .05, .06]].map(t => row(t, PALE, 0.2)), [0, 1, 0], 5, true, true); }
    M.finish();
  },

  init() {
    const t0 = performance.now();
    this.B = Rig.make(); this.B2 = Rig.make(); this.S = Rig.make();
    for (const k of ['jacket', 'coat', 'dress']) this.bodies[k] = this.sculptBody(k);
    for (const k of ['fur', 'cap', 'elder', 'scarf', 'girl', 'boy']) this.heads[k] = this.sculptHead(k);
    this.makeThings();
    this.ms = Math.round(performance.now() - t0);

    const r = this.rnd = rng(58), L = this.list, doors = Village.doors, free = (x, z, rad) => !L.some(o => Math.hypot(o.x - x, o.z - z) < rad);
    const pickV = n => Math.floor(r() * n), N = doors.length;
    // who: 'man', 'woman', 'elder', 'girl', 'boy' (the last two are children when `kid` is set)
    const add = (who, role, x, z, yaw, o) => {
      const body = who === 'woman' || who === 'girl' ? 'dress' : (o && o.body) || (who === 'elder' || r() < 0.5 ? 'coat' : 'jacket'), head = who === 'man' ? (r() < 0.55 ? 'fur' : 'cap') : who === 'woman' ? 'scarf' : who;
      const p = Object.assign({ who, K: this.bodies[body], coat: pickV(4), H: this.heads[head], hcoat: pickV(this.heads[head].vaos.length), hs: 1, role, x, z, y: terrainH(x, z), yaw, yaw0: yaw, v: 0, phase: r(), look: 0, nod: 0, greet: 0, sc: 0.96 + r() * 0.08, seed: r(),
        st: 'pause', t: r() * 4, tx: x, tz: z, hx: x, hz: z, stuck: 0, idle: pickV(3), salaam: who === 'elder' || (who === 'man' && r() < 0.4), speed: 1.05 + r() * 0.3, M: new Float32Array(16) }, o || {});
      if (p.kid) { p.sc = 0.58 + r() * 0.12; p.hs = 1.32; p.speed = 2.4 + r() * 0.8; }
      if (who === 'elder') p.sc *= 0.96;
      L.push(p); return p;
    };
    const along = (d, out, side) => [d.x + Math.cos(d.yaw) * out - Math.sin(d.yaw) * side, d.z + Math.sin(d.yaw) * out + Math.cos(d.yaw) * side];
    const used = new Set(), door = (test) => { for (let k = 0; k < 80; k++) { const i = pickV(N); if (!used.has(i) && (!test || test(doors[i]))) { used.add(i); return doors[i]; } } return null; };
    const n = k => Math.max(2, Math.round(N * k));
    // old men on the bench by the door
    for (let i = 0; i < n(0.045); i++) { const d = door(); if (!d) break; const q = along(d, -0.62, 1.75); this.props.push({ mesh: this.bench, x: q[0], z: q[1], yaw: d.yaw, solid: 0.9, sh: [0.2, 0.9] });
      add(i % 4 === 3 ? 'man' : 'elder', 'sit', q[0] + Math.cos(d.yaw) * 0.06, q[1] + Math.sin(d.yaw) * 0.06, d.yaw); }
    // splitting firewood in front of the house
    for (let i = 0; i < n(0.03); i++) { const d = door(dd => !dd.yard); if (!d) break; const q = along(d, 3.6, -3.4), p = add('man', 'chop', q[0], q[1], d.yaw + 0.9, { body: 'jacket', c0: r(), rest: 0, salaam: false });
      // where the axe comes down is where the block stands
      const c0 = p.c0; p.c0 = 0.62; p.axeHit = 0.8; this.pose(p); p.c0 = c0;
      const h = Rig.xf(this.B, 3, p.K.hand), LA = 0.555; p.axeHit = Math.acos(clamp((h[1] - 0.50 / p.sc) / LA, -1, 1));
      const fx = (h[0] + LA * Math.sin(p.axeHit) - 0.04) * p.sc, fz = h[2] * p.sc, b = [p.x + Math.cos(p.yaw) * fx - Math.sin(p.yaw) * fz, p.z + Math.sin(p.yaw) * fx + Math.cos(p.yaw) * fz];
      p.block = b; this.props.push({ mesh: this.block, x: b[0], z: b[1], yaw: p.yaw, solid: 0.7, sh: [0.22, 0.22] }); }
    // at their own doors
    for (let i = 0; i < n(0.075); i++) { const d = door(); if (d) add(r() < 0.6 ? 'woman' : r() < 0.5 ? 'girl' : 'man', 'stand', d.x, d.z, d.yaw + (r() - 0.5) * 0.8); }
    // going from house to house
    for (let i = 0; i < n(0.10); i++) { const d = doors[pickV(N)]; if (free(d.gx, d.gz, 3)) add(['man', 'woman', 'woman', 'elder', 'girl'][pickV(5)], 'walk', d.gx, d.gz, r() * TAU); }
    // fetching water: from the houses nearest the river, down to the bank and back
    const near = doors.slice().sort((a, b) => a.z - b.z).slice(0, Math.max(6, n(0.12)));
    for (let i = 0; i < n(0.035); i++) { const d = near[pickV(near.length)], bank = [d.gx + (r() - 0.5) * 30, 0], s = riverDZ(bank[0]); bank[1] = riverZ(bank[0]) + 12.6 * Math.sqrt(1 + s * s);
      const u = r(); add(r() < 0.75 ? 'woman' : 'girl', 'carry', lerp(d.gx, bank[0], u), lerp(d.gz, bank[1], u), 0, { home: [d.gx, d.gz], bank, toRiver: r() < 0.5, speed: 1.0 + r() * 0.15, st: 'go' }); }
    // two and two, talking
    const B0 = Village.box || [XH - 190, XH + 190, ZH - 110, ZH + 110];
    for (let i = 0; i < n(0.035); i++) for (let k = 0; k < 30; k++) {
      const x = lerp(B0[0], B0[1], r()), z = lerp(B0[2], B0[3], r());
      if (!Herd.ok(x, z) || !free(x, z, 8) || Village.segs.some(s => Math.hypot((s[0] + s[2]) / 2 - x, (s[1] + s[3]) / 2 - z) < 4)) continue;
      const a = r() * TAU, w = ['man', 'woman', 'elder', 'girl'];
      const p1 = add(w[pickV(4)], 'chat', x, z, a), p2 = add(w[pickV(4)], 'chat', x + Math.cos(a) * 1.0, z + Math.sin(a) * 1.0, a + Math.PI); p1.mate = p2; p2.mate = p1; p2.seed = p1.seed + 0.37; break;
    }
    // children, two and two: one runs, the other after
    for (let i = 0; i < n(0.025); i++) for (let k = 0; k < 30; k++) {
      const x = lerp(B0[0], B0[1], 0.1 + 0.8 * r()), z = lerp(B0[2], B0[3], 0.1 + 0.8 * r());
      if (!Herd.ok(x, z) || !free(x, z, 4)) continue;
      const a = add(r() < 0.5 ? 'boy' : 'girl', 'kid', x, z, r() * TAU, { kid: true }), b = add(r() < 0.5 ? 'boy' : 'girl', 'kid', x + 2, z + 1, r() * TAU, { kid: true, chase: a }); b.speed = a.speed * 1.04; break;
    }
    // herders by the flocks: outside the village, and where the ride begins
    const v = Places.list.valley;
    for (const h of [[3, 26], [2, 30], [5, 28], [0, 22]].map(q => [Herd.sites[q[0]][0], Herd.sites[q[0]][1], q[1]])) for (let k = 0; k < 30; k++) {
      const a = r() * TAU, x = h[0] + Math.cos(a) * h[2], z = h[1] + Math.sin(a) * h[2];
      if (!Herd.ok(x, z)) continue;
      add(r() < 0.5 ? 'man' : 'elder', 'herd', x, z, a + Math.PI, { staff: true, hx: h[0], hz: h[1], hr: h[2], speed: 0.8, salaam: false }); break;
    }
  },

  update(dt, g) {
    const R = this.rnd, doors = Village.doors, near = [];
    for (const p of this.list) {
      if (Math.abs(p.x - G.cam[0]) > 450 || Math.abs(p.z - G.cam[2]) > 450) continue;
      near.push(p);
      const dx = g.x - p.x, dz = g.z - p.z, d = Math.hypot(dx, dz), toR = Math.atan2(dz, dx), role = p.role;
      p.t -= dt;
      let vt = 0, yawT = p.yaw, lookT = 0, greetT = 0, turn = 2.6;
      const seen = d < 16 ? clamp(wrapPi(toR - p.yaw), -1.15, 1.15) : 0, close = d < 11 && g.v > 0.3;
      if (role === 'stand' || role === 'chat') {
        // they turn to a rider who comes by and greet them; then go back to what they were doing
        yawT = p.yaw0; lookT = seen;
        if (d < (role === 'chat' ? 8 : 13)) yawT = toR;
        if (close) greetT = 1;
        if (role === 'chat' && d >= 16 && p.mate) lookT = clamp(wrapPi(Math.atan2(p.mate.z - p.z, p.mate.x - p.x) - p.yaw), -0.6, 0.6);
      } else if (role === 'sit') { lookT = seen; if (close) greetT = 1; }
      else if (role === 'chop') {
        // he stops when someone rides up, straightens, and nods; then back to it
        const busy = d > 7.5 || g.v < 0.2;
        p.rest = damp(p.rest, busy ? 0 : 1, 3, dt); lookT = busy ? 0 : seen; if (!busy && close && p.rest > 0.7) greetT = 1;
        if (p.rest < 0.3) {
          const c0 = p.c0; p.c0 = frac(p.c0 + dt / 2.3);
          if (c0 < 0.585 && p.c0 >= 0.585) {      // the axe lands
            Sound.chop(d);
            const b = p.block, y = terrainH(b[0], b[1]) + 0.5;
            for (let i = 0; i < 5; i++) Fx.spawn([b[0], y, b[1]], [(R() - 0.5) * 3, 1.5 + R() * 2.5, (R() - 0.5) * 3], 0.6 + R() * 0.5, 0.012 + R() * 0.016, 2, 0);
          }
        }
      } else if (role === 'herd') {
        // he moves with the flock, a few steps at a time
        lookT = seen; if (close) greetT = 1;
        if (p.st === 'go') { vt = d < 9 ? 0 : p.speed; yawT = d < 9 ? toR : Math.atan2(p.tz - p.z, p.tx - p.x); if (Math.hypot(p.tx - p.x, p.tz - p.z) < 1.0 || p.t < -40) { p.st = 'pause'; p.t = 10 + R() * 25; } }
        else { if (d < 13) yawT = toR; if (p.t < 0) { const a = R() * TAU, dd = p.hr * (0.7 + R() * 0.5), tx = p.hx + Math.cos(a) * dd, tz = p.hz + Math.sin(a) * dd; if (Herd.ok(tx, tz)) { p.st = 'go'; p.tx = tx; p.tz = tz; p.t = 0; } else p.t = 2; } }
      } else {      // walk, carry, kid: going somewhere
        if (p.st === 'go') {
          vt = p.speed * (d < 4 && role !== 'kid' ? 0.4 : 1);
          if (p.chase) { p.tx = p.chase.x; p.tz = p.chase.z; if (Math.hypot(p.tx - p.x, p.tz - p.z) < 1.6) vt = 0; }
          yawT = Math.atan2(p.tz - p.z, p.tx - p.x); turn = role === 'kid' ? 5 : 2.6;
          if (p.detour > 0) { p.detour -= dt; yawT += p.dside * 1.35; }
          if (!p.chase && Math.hypot(p.tx - p.x, p.tz - p.z) < 1.0) { p.st = 'pause'; p.t = role === 'kid' ? 0.3 + R() * 2 : role === 'carry' ? 5 + R() * 4 : 3 + R() * 9; if (role === 'carry') p.toRiver = !p.toRiver; }
          else if (p.stuck > 0.8) { p.detour = 1.6 + R(); p.dside = R() < 0.5 ? 1 : -1; p.stuck = 0; p.tries = (p.tries || 0) + 1; if (p.tries > 5 && role === 'walk') { p.st = 'pause'; p.t = 0.5; p.tries = 0; } }
          if (d < 10) lookT = seen;
          if (role === 'kid' && d < 9 && g.v > 0.3) { vt = 0; yawT = toR; greetT = 1; }       // they stop to watch a horse go by, and jump about
        } else {
          lookT = d < 12 ? seen : 0; if (d < 9 && g.v > 0.3) { greetT = 1; if (role !== 'carry') yawT = toR; }
          if (p.t < 0) {
            p.st = 'go'; p.stuck = 0; p.tries = 0;
            if (role === 'kid') { const a = R() * TAU, dd = 4 + R() * 12; p.tx = p.hx + Math.cos(a) * dd; p.tz = p.hz + Math.sin(a) * dd; if (!Herd.ok(p.tx, p.tz)) { p.tx = p.hx; p.tz = p.hz; } }
            else if (role === 'carry') { const q = p.toRiver ? p.bank : p.home; p.tx = q[0]; p.tz = q[1]; }
            else { const dr = doors[Math.floor(R() * doors.length)]; p.tx = dr.gx; p.tz = dr.gz; }
          }
        }
      }
      if (role === 'carry') greetT = 0;       // her hands are full: she nods
      p.yaw += clamp(wrapPi(yawT - p.yaw), -turn * dt, turn * dt);
      p.v += clamp(vt - p.v, -4 * dt, 2.5 * dt);
      p.look = damp(p.look, lookT, 4, dt); p.greet = damp(p.greet, greetT, 3.5, dt);
      p.nod = damp(p.nod, (role === 'carry' || role === 'sit') && d < 9 && g.v > 0.3 ? 1 : 0, 4, dt);
      if (p.v > 0.01) {
        const ox = p.x, oz = p.z;
        p.x += Math.cos(p.yaw) * p.v * dt; p.z += Math.sin(p.yaw) * p.v * dt;
        Village.collide(p);
        for (const q of this.props) { const ex = p.x - q.x, ez = p.z - q.z, ed = Math.hypot(ex, ez); if (ed < q.solid && ed > 1e-4) { p.x += ex / ed * (q.solid - ed); p.z += ez / ed * (q.solid - ed); } }
        if (Math.hypot(p.x - ox, p.z - oz) < p.v * dt * 0.35) p.stuck += dt; else p.stuck = Math.max(0, p.stuck - dt * 0.5);
        const A = p.kid ? 0.62 : p.K.A;
        const ph0 = p.phase; p.phase = frac(p.phase + dt * p.v / (4 * p.K.Lleg * p.sc * Math.sin(A)));
        if (Math.floor(ph0 * 2) !== Math.floor(p.phase * 2) && Trail.near(p.x, p.z)) { const sd = (p.phase < 0.5 ? 0.09 : -0.09) * p.sc; Trail.stamp(p.x + Math.cos(p.yaw) * 0.12 - Math.sin(p.yaw) * sd, p.z + Math.sin(p.yaw) * 0.12 + Math.cos(p.yaw) * sd, p.yaw, 1); }
      }
      p.y = terrainH(p.x, p.z);
      const rr = role === 'sit' ? 0.9 : 1.15;
      if (d < rr && d > 1e-4) { g.x += dx / d * (rr - d) * 0.7; g.z += dz / d * (rr - d) * 0.7; if (role !== 'sit' && role !== 'chop') { p.x -= dx / d * (rr - d) * 0.3; p.z -= dz / d * (rr - d) * 0.3; } }
      if (Math.abs(p.x - G.cam[0]) < 340 && Math.abs(p.z - G.cam[2]) < 340) Shade.extra.push({ x: p.x, z: p.z, a: 0.16 * p.sc, b: 0.22 * p.sc, rot: p.yaw, h: (role === 'sit' ? 1.25 : 1.7) * p.sc });
    }
    // they do not walk through one another, nor the horse through the bench and the block
    for (let i = 0; i < near.length; i++) for (let j = i + 1; j < near.length; j++) {
      const a = near[i], b = near[j]; if (a.v < 0.01 && b.v < 0.01) continue;
      const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz); if (d >= 0.62 || d < 1e-4) continue;
      const k = (0.62 - d) / d * 0.5, ka = a.v > 0.01 ? (b.v > 0.01 ? 1 : 2) : 0, kb = b.v > 0.01 ? (a.v > 0.01 ? 1 : 2) : 0;
      a.x -= dx * k * ka; a.z -= dz * k * ka; b.x += dx * k * kb; b.z += dz * k * kb;
    }
    for (const q of this.props) { const ex = g.x - q.x, ez = g.z - q.z, ed = Math.hypot(ex, ez), s = q.solid + 0.5; if (ed < s && ed > 1e-4) { g.x += ex / ed * (s - ed); g.z += ez / ed * (s - ed); }
      if (Math.abs(q.x - G.cam[0]) < 340 && Math.abs(q.z - G.cam[2]) < 340) Shade.extra.push({ x: q.x, z: q.z, a: q.sh[0], b: q.sh[1], rot: q.yaw, h: 0.45 }); }
  },

  // the skeleton of one person, this instant
  pose(p) {
    const K = p.K, B = this.B, role = p.role, mv = smooth(0.03, 0.6, p.v), ph = p.phase, t = G.time + p.seed * 100, A = (p.kid ? 0.62 : K.A) * mv, g = p.greet, wave = p.salaam ? 0 : g, bow = p.salaam ? g : 0;
    const still = 1 - mv, sg = [1, -1];
    // trunk: where it is, how it leans and turns
    let ty = (p.kid ? 0.035 : 0.018) * Math.sin(ph * TAU * 2) * mv + still * 0.004 * Math.sin(t * 1.4), tp = -0.06 * mv - (p.kid ? 0.10 * mv : 0) - 0.22 * bow, tyaw = still * 0.05 * Math.sin(t * 0.6);
    let headP = -0.30 * bow - 0.22 * p.nod * (0.5 + 0.5 * Math.sin(t * 2.4));
    // limbs: [pitch, roll, yaw] of upper and lower, right then left. Roll: positive brings the right arm in across the body, the left arm out
    const armU = [[0, -0.07, 0], [0, 0.07, 0]], armL = [[0.20, -0.07, 0], [0.20, 0.07, 0]], legU = [0, 0], legL = [0, 0];
    for (const s of [0, 1]) {
      const st = Rig.step(frac(ph + s * 0.5), 0.5, A);
      legU[s] = st[0]; legL[s] = st[0] - (p.kid ? 1.5 : 1.0) * Math.sin(Math.PI * st[1]) * mv - 0.05;
      armU[s][0] = -st[0] * 0.85 + still * 0.03 * Math.sin(t * 0.9 + s); armL[s][0] = armU[s][0] + 0.20 + (p.kid ? 0.9 : 0.25) * mv;
    }
    const to = (s, u, l, k) => { armU[s] = lerp3(armU[s], [u[0], u[1] * sg[s], u[2] * sg[s]], k); armL[s] = lerp3(armL[s], [l[0], l[1] * sg[s], l[2] * sg[s]], k); };
    if (role === 'stand' && p.idle === 1) for (const s of [0, 1]) to(s, [-0.12, -0.72, 0], [0.30, 0.85, 0], still);      // hands on hips
    if (role === 'stand' && p.idle === 2) for (const s of [0, 1]) to(s, [-0.30, -0.10, 0], [-0.40, 0.95, 0], still);     // hands behind the back
    if (role === 'herd') to(1, [-0.30, -0.10, 0], [-0.40, 0.95, 0], still);
    if (role === 'chat') {
      // talking: one of the two speaks at a time, with the right hand; the other nods
      const turnT = Math.sin(t * 0.33) > 0, talk = (turnT ? 1 : 0) * (0.5 + 0.5 * Math.sin(t * 0.9)) * still * (1 - g);
      to(0, [0.45, -0.20, 0], [1.45 + 0.28 * Math.sin(t * 4.3), -0.30 + 0.20 * Math.sin(t * 3.1), 0], talk);
      if (!turnT) headP -= 0.10 * Math.max(0, Math.sin(t * 2.8)) * (1 - g);
      tp -= 0.03 * talk;
    }
    if (role === 'sit') {
      // sat on the bench: knees forward, hands on them
      ty = -0.40; tp = -0.10 - 0.10 * bow + 0.01 * Math.sin(t * 1.2);
      for (const s of [0, 1]) { legU[s] = 1.42; legL[s] = 0.06 + (s ? 0.10 : -0.04); to(s, [0.50, -0.10, 0], [1.20, 0.10, 0], 1); }
    }
    this.axeP = 0.10;
    if (role === 'chop') {
      // raise, hold, strike, recover. Both hands on the helve; the trunk goes back with the lift and down with the blow
      const c = p.c0, e = (a, b) => smooth(a, b, c), up = e(0.0, 0.40) * (1 - e(0.50, 0.585)), hit = e(0.50, 0.585) * (1 - e(0.72, 1.0)), work = 1 - p.rest, fi = 0.40;
      tp = lerp(tp, 0.10 * up - 0.30 * hit - 0.06, work); ty = lerp(ty, -0.02 - 0.05 * hit, work);
      const au = lerp(0.72, 2.75, up), al = lerp(0.98, 3.20, up);
      for (const s of [0, 1]) { const k = s ? 0.86 : 1; to(s, [au, fi * Math.cos(au), -fi * Math.sin(au)], [al * k + (s ? 0.10 : 0), (fi + 0.05) * Math.cos(al), -(fi + 0.05) * Math.sin(al)], work); }
      legU[0] = lerp(legU[0], -0.20, work); legL[0] = lerp(legL[0], -0.24 - 0.10 * hit, work); legU[1] = lerp(legU[1], 0.30 + 0.10 * hit, work); legL[1] = lerp(legL[1], 0.06 - 0.10 * hit, work);
      this.axeP = lerp(0.10, lerp(p.axeHit, 3.45, up), work);
    }
    if (role === 'carry') for (const s of [0, 1]) to(s, [0.20, -0.90, 0], [0.10, -2.60, 0], 1);      // hands up on the yoke
    if (p.staff) { armU[0] = [0.55 + 0.10 * Math.sin(ph * TAU) * mv, -0.07, 0]; armL[0] = [1.75, -0.07, 0]; }
    if (wave > 0.01) {
      if (p.kid) { ty += 0.16 * wave * Math.abs(Math.sin(t * 6.5)); for (const s of [0, 1]) to(s, [0.2, -2.45, 0], [0.1, -2.8 + 0.35 * Math.sin(t * 9 + s), 0], wave); }      // both arms, jumping
      else to(p.staff ? 1 : 0, [0.25, -2.35, 0], [0.15, -2.75 + 0.42 * Math.sin(t * 8.5), 0], wave);      // a hand lifted high and waved from the elbow
    }
    if (bow > 0.01) to(0, [0.50, -0.34, 0], [0.40, 2.32, 0], bow);      // the right hand to the heart, and a bow
    this.tp = tp;
    Rig.set(B, 0, [0, 0, 0], [0, ty, 0], tp, tyaw, 0);
    Rig.set(B, 1, [0, 0, 0], Rig.xf(B, 0, K.neck), tp * 0.6 + headP, p.look, 0);
    for (const s of [0, 1]) {
      const z = sg[s], sho = [K.sho[0], K.sho[1], z * K.sho[2]], elb = [K.elb[0], K.elb[1], z * K.elb[2]], hip = [K.hip[0], K.hip[1], z * K.hip[2]], ab = s ? 4 : 2, lb = s ? 8 : 6;
      Rig.set(B, ab, sho, Rig.xf(B, 0, sho), armU[s][0] + tp, armU[s][2], armU[s][1]);
      Rig.set(B, ab + 1, elb, Rig.xf(B, ab, elb), armL[s][0] + tp, armL[s][2], armL[s][1]);
      Rig.set(B, lb, hip, Rig.xf(B, 0, hip), legU[s], 0, 0);
      if (K.shin) { const knee = [K.knee[0], K.knee[1], z * K.knee[2]]; Rig.set(B, lb + 1, knee, Rig.xf(B, lb, knee), legL[s], 0, 0); }
    }
  },
  // the matrix of something a person has: at the point h of their body (carried by `bone` if given), turned by pitch and roll
  held(q, h, pitch, roll, bone) {
    Rig.set(this.S, 0, [0, 0, 0], h, pitch || 0, 0, roll || 0);
    const loc = this.S.subarray(0, 16);
    return m4.mul(q.M, bone === undefined ? loc : m4.mul(this.B.subarray(bone * 16, bone * 16 + 16), loc));
  },
  draw() {
    const p = Horse.progBody.use(); setGlobals(p); p.f1('uCut', 99); p.f1('uProp', 0); p.f1('uSelf', 1);
    const cx = G.cam[0], cz = G.cam[2], things = [], B = this.B, B2 = this.B2, ub = p.u('uBones');
    const mesh = K => { gl.drawElements(gl.TRIANGLES, K.count, gl.UNSIGNED_INT, 0); };
    for (const q of this.list) {
      const dx = q.x - cx, dz = q.z - cz, d2 = dx * dx + dz * dz;
      if (d2 > 600 * 600) continue;
      if (rideSession && outsideRideView(q.x, q.y + 1, q.z, 4)) continue;  // includes the pole, buckets and raised axe
      this.pose(q);
      const c = Math.cos(q.yaw) * q.sc, s = Math.sin(q.yaw) * q.sc, m = q.M, close = d2 < 55 * 55;
      m.set([c, 0, s, 0, 0, q.sc, 0, 0, -s, 0, c, 0, q.x, q.y - 0.02, q.z, 1]);
      p.m4('uModel', m); gl.uniformMatrix4fv(ub, false, B);
      const K = close ? q.K : q.K.far; gl.bindVertexArray(K.vaos[q.coat]); mesh(K);
      // the head: its own mesh, set on the neck, larger on a child
      B2.set(B.subarray(16, 32), 16); const k = q.hs;
      for (let i = 16; i < 28; i++) B2[i] *= k;
      gl.uniformMatrix4fv(ub, false, B2);
      if (close) { gl.bindVertexArray(q.H.vaos[q.hcoat]); mesh(q.H); gl.bindVertexArray(q.H.face.vaos[q.hcoat]); mesh(q.H.face); }
      else { gl.bindVertexArray(q.H.far.vaos[q.hcoat]); mesh(q.H.far); }
      if (q.staff) things.push([this.staff, this.held(q, Rig.xf(B, 3, q.K.hand), 0.05, 0)]);
      if (q.role === 'chop') things.push([this.axe, this.held(q, Rig.xf(B, 3, q.K.hand), this.axeP, 0)]);
      if (q.role === 'carry') {
        const mv = smooth(0.03, 0.6, q.v), sw = Math.sin(q.phase * TAU * 2);
        things.push([this.pole, this.held(q, [0, q.K.pole, 0], 0, 0, 0)]);
        for (const z of [-0.62, 0.62]) things.push([this.bucket, this.held(q, [-0.02, q.K.pole - 0.03, z], -this.tp + 0.07 * sw * mv, 0.05 * Math.cos(q.phase * TAU + z) * mv, 0)]);
      }
    }
    p.f1('uSelf', 0);
    const ps = Horse.prog.use(); setGlobals(ps); ps.f1('uCut', 99); ps.f1('uSelf', 1); ps.f1('uProp', 0);
    for (const h of things) { ps.m4('uModel', h[1]); h[0].draw(); }
    ps.f1('uProp', 1);
    const m = this.m;
    for (const q of this.props) {
      if (Math.abs(q.x - cx) > 600 || Math.abs(q.z - cz) > 600) continue;
      const y = terrainH(q.x, q.z);
      if (rideSession && outsideRideView(q.x, y + 0.5, q.z, 2.5)) continue;  // includes the wood scattered around the block
      const c = Math.cos(q.yaw), s = Math.sin(q.yaw);
      m.set([c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, q.x, y, q.z, 1]); ps.m4('uModel', m); q.mesh.draw();
    }
    ps.f1('uSelf', 0); ps.f1('uProp', 0);
  },
};
function lerp3(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }

// ======== 09_hair.js
// ---------------------------------------------------------------- mane, tail, forelock, the rider's scarf, the reins
// Each strand is a chain of points that follows its root. The air drags on it, so at a gallop everything streams back.
const Hair = {
  strands: [], n: 0, pos: null, prev: null, ready: false, time: 0,
  init() {
    let gg = 0;
    const r = rng(5), add = (o) => { o.start = this.n; this.n += o.count; this.strands.push(o); };
    // tail: one simulated guide (the dock and the fall of the hair); the hairs themselves hang round it as a bundle
    add({ kind: 'tail', count: 12, seg: 0.084, off: [0, 0, 0], spread: [0, 0, 0], w0: 0.060, w1: 0.020, c0: [0.46, 0.45, 0.42], c1: [0.56, 0.55, 0.52], stiff: 0.50, fall: 0.40, air: 2.1, tr: 0.35, ph: 0 });
    const tailG = this.strands[this.strands.length - 1];
    for (let i = 0; i < 84; i++) {
      const a = r() * TAU, rad = Math.sqrt(r());
      add({ kind: 'tailHair', g: tailG, rA: 0.030, rB: 0.105, wig: 0.022, count: 12, seg: 0, a: Math.cos(a) * rad, b: Math.sin(a) * rad, len: 0.62 + r() * 0.38, w0: 0.019, w1: 0.004, c0: [0.42 + (gg = r() * 0.12), 0.41 + gg, 0.38 + gg], c1: [0.60, 0.59, 0.56], tr: 0.45, ph: r() });
    }
    // mane: two strands off every point along the crest, lying to the right
    for (let k = 0; k < 25; k++) for (let j = 0; j < 5; j++)
      add({ kind: 'mane', idx: k, count: 6, seg: 0.046 + r() * 0.034, off: [(r() - 0.5) * 0.03, 0, 0.004 + r() * 0.022], spread: [(r() - 0.5) * 0.2, (r() - 0.5) * 0.12, (r() - 0.5) * 0.16],
        w0: 0.017, w1: 0.005, c0: [0.42 + (gg = r() * 0.13), 0.41 + gg, 0.38 + gg], c1: [0.62, 0.61, 0.58], stiff: 0.20, fall: 0.50, air: 4.5 + r() * 2.0, tr: 0.50, ph: k * 0.12 });
    // a short fringe that stands along the crest, so the mane shows from the near side too
    for (let k = 0; k < 25; k++) for (let j = 0; j < 2; j++)
      add({ kind: 'mane', up: true, idx: k, count: 3, seg: 0.028 + r() * 0.022, off: [(r() - 0.5) * 0.03, 0, (r() - 0.5) * 0.012], spread: [(r() - 0.5) * 0.3, 0, (r() - 0.5) * 0.3],
        w0: 0.018, w1: 0.005, c0: [0.44 + (gg = r() * 0.12), 0.43 + gg, 0.40 + gg], c1: [0.62, 0.61, 0.58], stiff: 0.45, fall: 0.6, air: 3.5, tr: 0.5, ph: k * 0.12 });
    for (let i = 0; i < 14; i++)
      add({ kind: 'fore', count: 4, seg: 0.042 + r() * 0.022, off: [0, 0, (i - 6.5) * 0.007], spread: [(r() - 0.5) * 0.2, 0, (r() - 0.5) * 0.3], w0: 0.014, w1: 0.005, c0: [0.48, 0.47, 0.44], c1: [0.62, 0.61, 0.58], stiff: 0.30, fall: 0.6, air: 4.5, tr: 0.5, ph: i * 0.2 });
    // scarf: two long tails of pale cloth
    for (let i = 0; i < 2; i++)
      add({ kind: 'scarf', fpHide: true, body: true, flut: 0.40, count: 11, seg: 0.072 + i * 0.010, off: [0, -i * 0.02, (i - 0.5) * 0.05], spread: [0, 0, (i - 0.5) * 0.30], w0: 0.062, w1: 0.046, c0: [0.400, 0.030, 0.028], c1: [0.450, 0.040, 0.032], stiff: 0.05, fall: 0.6, air: 4.5, tr: 0.30, ph: i * 0.9 });
    // the rider's hair, tied back and left long: a guide and its bundle, like the horse's tail
    add({ kind: 'pony', fpHide: true, body: true, flut: 0.6, count: 9, seg: 0.052, off: [0, 0, 0], spread: [0, 0, 0], w0: 0.040, w1: 0.014, c0: HAIRC, c1: HAIRC, stiff: 0.30, fall: 0.55, air: 3.2, tr: 0.10, ph: 0.4 });
    const ponyG = this.strands[this.strands.length - 1];
    for (let i = 0; i < 30; i++) {
      const a = r() * TAU, rad = Math.sqrt(r());
      add({ kind: 'tailHair', fpHide: true, g: ponyG, rA: 0.016, rB: 0.034, wig: 0.010, count: 9, seg: 0, a: Math.cos(a) * rad, b: Math.sin(a) * rad, len: 0.70 + r() * 0.30, w0: 0.014, w1: 0.004,
        c0: [HAIRC[0] + (gg = r() * 0.02), HAIRC[1] + gg, HAIRC[2] + gg], c1: [0.050, 0.040, 0.034], tr: 0.12, ph: r() });
    }
    // the tails of the coat: seven columns of cloth, joined into one surface when drawn
    this.coat = [];
    for (let i = 0; i < 7; i++) { add({ kind: 'coat', hidden: true, ci: i, count: 6, seg: 0.074, off: [0, 0, 0], stiff: 0.22, fall: 0.62, air: 3.4, ph: i * 0.35 }); this.coat.push(this.strands[this.strands.length - 1]); }
    // reins: drawn, not simulated
    const lea = [0.060, 0.034, 0.018];
    for (let i = 0; i < 2; i++) add({ kind: 'rein', fixed: true, side: i, count: 6, seg: 0, w0: 0.016, w1: 0.016, c0: lea, c1: lea, tr: 0.1 });
    // the bight of the reins between the hands, and the bridle straps on the head
    add({ kind: 'bight', fixed: true, count: 7, seg: 0, w0: 0.016, w1: 0.016, c0: lea, c1: lea, tr: 0.1 });
    Horse.A.tack.forEach((t, i) => add({ kind: 'tack', fixed: true, ti: i, count: t.length, seg: 0, w0: 0.019, w1: 0.019, c0: lea, c1: lea, tr: 0.1 }));
    const steel = [0.30, 0.31, 0.33];
    for (let i = 0; i < 2; i++) { add({ kind: 'iron', fixed: true, side: i, count: 6, seg: 0, w0: 0.013, w1: 0.013, c0: steel, c1: steel, tr: 0.1 }); add({ kind: 'leather', fixed: true, side: i, count: 3, seg: 0, w0: 0.024, w1: 0.024, c0: lea, c1: lea, tr: 0.1 }); }
    this.pos = new Float32Array(this.n * 3); this.prev = new Float32Array(this.n * 3);
    let nv = 6 * 6 * 5; for (const s of this.strands) nv += (s.count - 1) * 6;
    this.nv = nv; this.buf = new Float32Array(nv * 8);
    this.vao = gl.createVertexArray(); gl.bindVertexArray(this.vao);
    this.vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo); gl.bufferData(gl.ARRAY_BUFFER, this.buf.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 32, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 32, 24);
    this.prog = program(GLSL_UNI + `
layout(location=0) in vec3 aP; layout(location=1) in vec3 aC; layout(location=2) in vec2 aX;
out vec3 vW, vC; out vec2 vX;
void main(){ vW = aP; vC = aC; vX = aX; gl_Position = uVP * vec4(aP, 1.0); }`, GLSL_UNI + GLSL_NOISE + GLSL_WORLD + `
in vec3 vW, vC; in vec2 vX; out vec4 o;
void main(){
  vec3 rd = normalize(vW - uCam);
  float mu = max(dot(rd, uSun), 0.0);
  // lit from the side, and glowing when the sun is behind it
  vec3 col = vC * (uAmb * 0.95 + uSunCol * 0.36) * (1.0 - uEnv2.x * 0.2);
  col += uSunCol * (vC * 0.55 + vec3(0.030, 0.020, 0.010)) * pow(mu, 3.0) * vX.y * 0.9;
  o = vec4(applyFog(col, vW), 1.0);
}`, 'hair');
    this.progSh = program(`layout(location=0) in vec3 aP; uniform mat4 uShVP2; void main(){ gl_Position = uShVP2 * vec4(aP, 1.0); }`, `void main(){}`, 'hairShadow');
  },
  root(s) {
    const A = Horse.A, o = s.off;
    if (s.kind === 'tail') return [A.tail[0] + o[0], A.tail[1] + o[1], A.tail[2] + o[2]];
    if (s.kind === 'mane') { const c = A.crest[Math.min(s.idx, A.crest.length - 1)]; return [c[0] + o[0], c[1] + o[1], c[2] + o[2]]; }
    if (s.kind === 'fore') return [A.poll[0] + o[0], A.poll[1] + o[1], A.poll[2] + o[2]];
    if (s.kind === 'pony') return A.knot;
    if (s.kind === 'coat') return A.coat[s.ci];
    return [A.scarf[0] + o[0], A.scarf[1] + o[1], A.scarf[2] + o[2]];
  },
  rest(s) {
    const A = Horse.A, sp = s.spread;
    if (s.kind === 'coat') return Rider.coatDir[s.ci];
    if (s.kind === 'pony') return [-0.53, -0.85, 0];
    if (s.kind === 'tail') return v3.norm([A.tailDir[0] + sp[0], A.tailDir[1] + sp[1], sp[2]]);
    if (s.kind === 'mane' && s.up) { const f = smooth(3, 13, Horse.v); return v3.norm([-0.55 - 0.6 * f + sp[0], 0.80 - 0.4 * f, sp[2]]); }
    if (s.kind === 'mane') { const f = smooth(3, 13, Horse.v); return v3.norm([-0.20 - 0.95 * f + sp[0], -0.62 + 0.80 * f + sp[1], 0.70 - 0.50 * f + sp[2]]); }
    if (s.kind === 'fore') return v3.norm([A.pollDir[0] + 0.25 + sp[0], A.pollDir[1], sp[2]]);
    return v3.norm([A.scarfDir[0], A.scarfDir[1], sp[2]]);
  },
  reset() {
    for (const s of this.strands) {
      if (s.fixed || s.kind === 'tailHair') continue;
      const rt = this.root(s), d = this.rest(s);
      for (let i = 0; i < s.count; i++) {
        const w = Horse.toWorld(rt[0] + d[0] * s.seg * i, rt[1] + d[1] * s.seg * i, rt[2] + d[2] * s.seg * i), o = (s.start + i) * 3;
        this.pos[o] = this.prev[o] = w[0]; this.pos[o + 1] = this.prev[o + 1] = w[1]; this.pos[o + 2] = this.prev[o + 2] = w[2];
      }
    }
    this.ready = true;
  },
  step(dt) {
    if (!this.ready) this.reset();
    if (dt <= 0) return;
    const n = Math.max(1, Math.min(4, Math.round(dt * 120))), h = dt / n;
    for (let k = 0; k < n; k++) this.sub(h, (k + 1) / n);
  },
  sub(h, f) {
    this.time += h;
    const P = this.pos, Q = this.prev, t = this.time, wx = G.windDir[0] * 2.2, wz = G.windDir[1] * 2.2, tb = 0.35 + 0.085 * Horse.v;
    const HP = Horse.pos, HF = Horse.f, HU = Horse.u, HR = Horse.r;
    const CA = Horse.toWorld(...Horse.A.capA), CB = Horse.toWorld(...Horse.A.capB), CD = v3.sub(CB, CA), CL = v3.dot(CD, CD) || 1;
    let si = 0;
    for (const s of this.strands) {
      si++;
      if (s.fixed || s.kind === 'tailHair') continue;
      const rl = this.root(s), rt = Horse.toWorld(rl[0], rl[1], rl[2]), dl = this.rest(s), d = Horse.dirWorld(dl[0], dl[1], dl[2]);
      let o = s.start * 3;
      // the root rides with the body (eased over the substeps so it does not jerk)
      Q[o] = P[o]; Q[o + 1] = P[o + 1]; Q[o + 2] = P[o + 2];
      P[o] += (rt[0] - P[o]) * f; P[o + 1] += (rt[1] - P[o + 1]) * f; P[o + 2] += (rt[2] - P[o + 2]) * f;
      let st = s.stiff; const fl = s.flut === undefined ? 1 : s.flut;
      for (let i = 1; i < s.count; i++) {
        o = (s.start + i) * 3;
        const px = P[o], py = P[o + 1], pz = P[o + 2];
        let vx = px - Q[o], vy = py - Q[o + 1], vz = pz - Q[o + 2];
        // air: the breeze plus a flutter that a whole lock shares (it ripples down the strand, it does not tear it apart)
        const w = t * 7.0 + s.ph * 6.0 - i * 0.55, tf2 = tb * fl, ax = wx + Math.sin(w * 0.83) * tf2, ay = Math.sin(w) * tf2 * 0.9, az = wz + Math.cos(w * 1.17) * tf2;
        const kd = Math.min(s.air * h, 0.9);
        vx += (ax * h - vx) * kd; vy += (ay * h - vy) * kd; vz += (az * h - vz) * kd;
        vy -= 9.8 * h * h * 0.8;
        let nx = px + vx, ny = py + vy, nz = pz + vz;
        Q[o] = px; Q[o + 1] = py; Q[o + 2] = pz;
        // pulled toward how it grows, less and less along its length
        const q = o - 3;
        nx += (P[q] + d[0] * s.seg - nx) * st; ny += (P[q + 1] + d[1] * s.seg - ny) * st; nz += (P[q + 2] + d[2] * s.seg - nz) * st;
        st *= s.fall;
        // keep its length
        let dx = nx - P[q], dy = ny - P[q + 1], dz = nz - P[q + 2]; const l = Math.hypot(dx, dy, dz) || 1e-6, sc = s.seg / l;
        P[o] = P[q] + dx * sc; P[o + 1] = P[q + 1] + dy * sc; P[o + 2] = P[q + 2] + dz * sc;
        if (s.body) {
          // keep it outside the rider's trunk
          const qx = P[o] - CA[0], qy = P[o + 1] - CA[1], qz = P[o + 2] - CA[2]; let tt = (qx * CD[0] + qy * CD[1] + qz * CD[2]) / CL; tt = tt < 0 ? 0 : tt > 1 ? 1 : tt;
          const ux = qx - CD[0] * tt, uy = qy - CD[1] * tt, uz = qz - CD[2] * tt, ul = Math.hypot(ux, uy, uz);
          if (ul < 0.178 && ul > 1e-5) { const k2 = 0.178 / ul; P[o] = CA[0] + CD[0] * tt + ux * k2; P[o + 1] = CA[1] + CD[1] * tt + uy * k2; P[o + 2] = CA[2] + CD[2] * tt + uz * k2; }
        }
        if (s.kind === 'coat') {
          // it lies on the horse's back and flanks, it does not fall through them
          const ex = P[o] - HP[0], ey = P[o + 1] - HP[1], ez = P[o + 2] - HP[2], lx = ex * HF[0] + ey * HF[1] + ez * HF[2], ly = ex * HU[0] + ey * HU[1] + ez * HU[2], lz = (ex * HR[0] + ey * HR[1] + ez * HR[2]) / 0.350;
          if (lz * lz < 1 && lx > -0.95 && lx < 0.5) { const up = 1.285 + Horse.yb + 0.300 * Math.sqrt(1 - lz * lz) - ly; if (up > 0) { P[o] += HU[0] * up; P[o + 1] += HU[1] * up; P[o + 2] += HU[2] * up; } }
        }
      }
    }
  },
  build() {
    if (!this.ready) this.reset();
    const P = this.pos, b = this.buf, cam = G.cam, A = Horse.A;
    let k = 0;
    const put = (x, y, z, c, u, tr) => { b[k++] = x; b[k++] = y; b[k++] = z; b[k++] = c[0]; b[k++] = c[1]; b[k++] = c[2]; b[k++] = u; b[k++] = tr; };
    const pts = [];
    for (const s of this.strands) {
      if (s.hidden || (s.fpHide && Horse.fp)) continue;      // through the rider's own eyes the hair at the back of the head is never in view
      pts.length = 0;
      if (s.kind === 'rein') {
        // hand to bit with a little slack; it hangs clear of the neck
        const a = Horse.toWorld(...A.hands[s.side]), c = Horse.toWorld(...A.bit[s.side]), out = Horse.dirWorld(0, 0, s.side ? 1 : -1);
        for (let i = 0; i < s.count; i++) { const u = i / (s.count - 1), p = v3.lerp(a, c, u), b = Math.sin(Math.PI * u); p[1] -= b * 0.05; p[0] += out[0] * b * 0.035; p[2] += out[2] * b * 0.035; pts.push(p); }
      } else if (s.kind === 'bight') {
        const a = Horse.toWorld(...A.hands[0]), c = Horse.toWorld(...A.hands[1]), back = Horse.dirWorld(-1, 0, 0);
        for (let i = 0; i < s.count; i++) { const u = i / (s.count - 1), p = v3.lerp(a, c, u), b = Math.sin(Math.PI * u); p[1] -= b * 0.085; p[0] += back[0] * b * 0.05; p[2] += back[2] * b * 0.05; pts.push(p); }
      } else if (s.kind === 'tack') {
        for (const q of A.tack[s.ti]) pts.push(Horse.toWorld(q[0], q[1], q[2]));
      } else if (s.kind === 'iron' || s.kind === 'leather') {
        for (const q of (s.kind === 'iron' ? A.irons : A.leathers)[s.side]) pts.push(Horse.toWorld(q[0], q[1], q[2]));
      } else if (s.kind === 'tailHair') {
        // a hair of the bundle: along the guide, offset across it; the bundle is slim at the dock, full in the middle, wispy at the end
        const g = s.g, gn = g.count - 1, R = Horse.r;
        for (let i = 0; i < s.count; i++) {
          const u = i / (s.count - 1) * s.len, f = Math.min(u * gn, gn - 0.001), i0 = Math.floor(f), ff = f - i0, o = (g.start + i0) * 3;
          const tx = P[o + 3] - P[o], ty = P[o + 4] - P[o + 1], tz = P[o + 5] - P[o + 2];
          let nx = ty * R[2] - tz * R[1], ny = tz * R[0] - tx * R[2], nz = tx * R[1] - ty * R[0]; let l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
          let bx = ty * nz - tz * ny, by = tz * nx - tx * nz, bz = tx * ny - ty * nx; l = Math.hypot(bx, by, bz) || 1; bx /= l; by /= l; bz /= l;
          const rad = lerp(s.rA, s.rB, smooth(0, 0.45, u)) * (1 - 0.72 * smooth(0.68, 1.0, u)), wg = Math.sin(this.time * 5.0 + s.ph * 20 + u * 6) * s.wig * u;
          const ca = s.a * rad + wg, cb = s.b * rad;
          pts.push([P[o] + tx * ff + nx * ca + bx * cb, P[o + 1] + ty * ff + ny * ca + by * cb, P[o + 2] + tz * ff + nz * ca + bz * cb]);
        }
      } else for (let i = 0; i < s.count; i++) { const o = (s.start + i) * 3; pts.push([P[o], P[o + 1], P[o + 2]]); }
      let pl = null, pr = null, pc = null, pu = 0;
      for (let i = 0; i < s.count; i++) {
        const p = pts[i], a = pts[Math.max(i - 1, 0)], c = pts[Math.min(i + 1, s.count - 1)];
        const tx = c[0] - a[0], ty = c[1] - a[1], tz = c[2] - a[2], ex = cam[0] - p[0], ey = cam[1] - p[1], ez = cam[2] - p[2];
        let sx = ty * ez - tz * ey, sy = tz * ex - tx * ez, sz = tx * ey - ty * ex; const l = Math.hypot(sx, sy, sz) || 1;
        const u = i / (s.count - 1), w = lerp(s.w0, s.w1, u) * 0.5 / l;
        sx *= w; sy *= w; sz *= w;
        const L = [p[0] - sx, p[1] - sy, p[2] - sz], R = [p[0] + sx, p[1] + sy, p[2] + sz], col = v3.lerp(s.c0, s.c1, u);
        if (i > 0) { put(pl[0], pl[1], pl[2], pc, pu, s.tr); put(pr[0], pr[1], pr[2], pc, pu, s.tr); put(L[0], L[1], L[2], col, u, s.tr); put(pr[0], pr[1], pr[2], pc, pu, s.tr); put(R[0], R[1], R[2], col, u, s.tr); put(L[0], L[1], L[2], col, u, s.tr); }
        pl = L; pr = R; pc = col; pu = u;
      }
    }
    this.clothFrom = k / 8;      // only cloth throws a shadow: hair in the shadow map leaves scribbles on the body
    // the coat tails as one surface, shaded by how each patch faces the sun (either side)
    const C = this.coat, sun = G.sun, at = (c, i) => { const o = (C[c].start + i) * 3; return [P[o], P[o + 1], P[o + 2]]; };
    for (let c = 0; c < C.length - 1; c++) for (let i = 0; i < C[c].count - 1; i++) {
      const p0 = at(c, i), p1 = at(c + 1, i), p2 = at(c, i + 1), p3 = at(c + 1, i + 1);
      const n = v3.norm(v3.cross(v3.sub(p1, p0), v3.sub(p2, p0))), sh = 0.55 + 0.75 * Math.abs(v3.dot(n, sun));
      const hem = i === C[c].count - 2, ca = v3.scale(CLOTH, sh), cb = hem ? v3.scale(TRIM, sh * 0.8) : ca;
      put(p0[0], p0[1], p0[2], ca, 0, 0.05); put(p1[0], p1[1], p1[2], ca, 0, 0.05); put(p2[0], p2[1], p2[2], cb, 0, 0.05);
      put(p1[0], p1[1], p1[2], ca, 0, 0.05); put(p3[0], p3[1], p3[2], cb, 0, 0.05); put(p2[0], p2[1], p2[2], cb, 0, 0.05);
    }
    gl.bindVertexArray(this.vao); gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo); gl.bufferSubData(gl.ARRAY_BUFFER, 0, b, 0, k);
    this.built = k / 8;
  },
  drawShadow() {
    this.build();
    const p = this.progSh.use(); p.m4('uShVP2', G.shVP);
    gl.bindVertexArray(this.vao); gl.drawArrays(gl.TRIANGLES, this.clothFrom, this.built - this.clothFrom);
  },
  draw() {
    const p = this.prog.use(); setGlobals(p);
    gl.bindVertexArray(this.vao); gl.drawArrays(gl.TRIANGLES, 0, this.built);
  },
};

// ======== 10_fx.js
// ---------------------------------------------------------------- what the hooves throw up, what drifts in the light, and the rain
const Fx = {
  MAX: 1100, head: 0,
  init() {
    const M = this.MAX;
    this.p = new Float32Array(M * 3); this.v = new Float32Array(M * 3); this.life = new Float32Array(M); this.span = new Float32Array(M);
    this.size = new Float32Array(M); this.kind = new Float32Array(M); this.seed = new Float32Array(M); this.tone = new Float32Array(M); this.up = new Float32Array(M);
    this.buf = new Float32Array(M * 8);
    this.rnd = rng(99);
    const quad = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    this.vao = gl.createVertexArray(); gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo); gl.bufferData(gl.ARRAY_BUFFER, this.buf.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 0); gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 32, 16); gl.vertexAttribDivisor(2, 1);
    // aB: alpha, kind (0 soft puff, 1 torn grass, 2 clod, 3 water, 4 snow), seed, tone (puffs: 0 dust, 1 spray or snow)
    this.prog = program(GLSL_UNI + GLSL_NOISE + GLSL_WORLD + `
layout(location=0) in vec2 aQ; layout(location=1) in vec4 aA; layout(location=2) in vec4 aB;
uniform vec3 uCamR, uCamU;
out vec2 vQ; out vec4 vB; out vec3 vW;
void main(){
  vec3 w = aA.xyz + (uCamR * aQ.x + uCamU * aQ.y) * aA.w;
  vQ = aQ; vB = aB; vW = w; gl_Position = uVP * vec4(w, 1.0);
}`, GLSL_UNI + GLSL_NOISE + GLSL_WORLD + `
in vec2 vQ; in vec4 vB; in vec3 vW; out vec4 o;
void main(){
  float r = length(vQ); if (r > 1.0) discard;
  vec3 rd = normalize(vW - uCam); float mu = max(dot(rd, uSun), 0.0);
  float sh = shadowAt(vW);
  if (vB.y > 0.5) {
    // a small solid thing: torn grass, a clod, a drop of water, a lump of snow
    vec3 base = vB.y < 1.5 ? vec3(0.16, 0.20, 0.05) : vB.y < 2.5 ? vec3(0.10, 0.07, 0.04) : vB.y < 3.5 ? vec3(0.55, 0.60, 0.66) : vec3(0.80, 0.84, 0.90);
    vec3 c = base * (uAmb + uSunCol * (0.30 + 0.35 * pow(mu, 3.0)));
    float a = vB.x * smoothstep(1.0, 0.6, r);
    o = vec4(applyFog(c, vW) * a, a); return;
  }
  // a soft puff, brightest looking through it toward the sun
  float n = vnoise(vQ * 2.2 + vB.z * 37.0) * 0.6 + vnoise(vQ * 5.0 + vB.z * 11.0) * 0.4;
  float a = vB.x * pow(1.0 - r, 1.6) * smoothstep(0.15, 0.75, n + (1.0 - r) * 0.5) * smoothstep(mix(2.5, 0.6, step(0.9, vB.w)), mix(8.0, 2.0, step(0.9, vB.w)), length(vW - uCam));
  vec3 tone = mix(vec3(0.44, 0.37, 0.26), vec3(0.74, 0.78, 0.84), step(0.3, vB.w));
  vec3 c = tone * (uAmb * 0.9 + uSunCol * (0.18 + 0.65 * pow(mu, 3.0)) * mix(0.55, 1.0, sh));
  o = vec4(applyFog(c, vW) * a, a);
}`, 'dust');

    // motes: seeds and midges on the plain, ice crystals under the mountains. They hang round the camera and flare against the sun
    const N = this.motes = [300, 800, 1400][App.quality], mr = rng(3), mb = new Float32Array(N * 4);
    for (let i = 0; i < mb.length; i++) mb[i] = mr();
    this.mvao = gl.createVertexArray(); gl.bindVertexArray(this.mvao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, mb, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0); gl.vertexAttribDivisor(1, 1);
    this.mprog = program(GLSL_UNI + GLSL_NOISE + GLSL_WORLD + `
layout(location=0) in vec2 aQ; layout(location=1) in vec4 aI;
uniform vec3 uCamR, uCamU, uCamF; uniform float uCrystal;
out vec2 vQ; out float vA;
void main(){
  float T = 44.0;
  vec3 base = vec3(aI.x, 0.0, aI.y) * T;
  base.xz += uWindDir * uWindT * (0.9 + aI.z) + vec2(sin(uWindT * (0.4 + aI.w) + aI.z * 40.0), cos(uWindT * (0.3 + aI.z) + aI.w * 40.0)) * 0.7;
  vec2 ctr = uCam.xz + uCamF.xz * T * 0.32;
  vec2 rel = mod(base.xz - ctr, T) - 0.5 * T;
  vec2 p = ctr + rel;
  // crystals sift slowly down; seeds bob where they are
  float fall = fract(aI.z * 7.0 - uWindT * 0.035 * (0.6 + aI.w)) * 7.5;
  float y = terrainH(p) + 0.25 + mix(pow(aI.z, 1.6) * 6.5, fall, uCrystal) + sin(uWindT * (0.5 + aI.w * 0.6) + aI.z * 20.0) * 0.35;
  vec3 w = vec3(p.x, y, p.y);
  float dist = length(w - uCam);
  float size = (0.010 + 0.018 * aI.w) * (1.0 + dist * 0.035) * mix(1.0, 0.8, uCrystal);
  vec3 rd = (w - uCam) / dist; float mu = max(dot(rd, uSun), 0.0);
  float tw = 0.55 + 0.45 * sin(uWindT * (2.0 + aI.w * 5.0) * mix(1.0, 2.6, uCrystal) + aI.z * 60.0);
  float flare = mix(0.08 + 1.5 * pow(mu, 5.0), 0.20 + 0.9 * pow(mu, 3.0), uCrystal) * mix(1.0, pow(tw, 3.0) * 2.2, uCrystal);
  vA = flare * tw * (1.0 - smoothstep(0.34, 0.5, length(rel) / T)) * smoothstep(0.6, 1.8, dist) * shadowAt(w) * (1.0 - uEnv.x);
  vQ = aQ;
  gl_Position = uVP * vec4(w + (uCamR * aQ.x + uCamU * aQ.y) * size, 1.0);
}`, GLSL_UNI + `
in vec2 vQ; in float vA; out vec4 o; uniform float uCrystal;
void main(){ float r = length(vQ); if (r > 1.0) discard; float a = pow(1.0 - r, 2.0) * vA; o = vec4(uSunCol * mix(vec3(1.0, 0.94, 0.80), vec3(0.80, 0.90, 1.10), uCrystal) * a * 0.55, 0.0); }`, 'motes');

    // rain: streaks that wrap round the camera. Each is drawn along the drop's velocity as the camera sees it,
    // so at a gallop the rain comes slanting at you
    const RN = this.rainN = [3000, 6000, 10000][App.quality], rb = new Float32Array(RN * 4);
    for (let i = 0; i < rb.length; i++) rb[i] = mr();
    this.rvao = gl.createVertexArray(); gl.bindVertexArray(this.rvao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, rb, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0); gl.vertexAttribDivisor(1, 1);
    this.rprog = program(GLSL_UNI + GLSL_NOISE + GLSL_WORLD + `
layout(location=0) in vec2 aQ; layout(location=1) in vec4 aI;
uniform vec3 uCamF, uFall, uRel, uBox; uniform float uRainT; uniform vec4 uLay;   // streak length (s of fall), width, brightness, how much it thickens with distance
out vec2 vQ; out float vA;
void main(){
  vec3 box = uBox;
  vec3 base = aI.xyz * box + uFall * uRainT * (0.85 + 0.30 * aI.w);
  vec3 ctr = uCam + vec3(uCamF.x, uCamF.y * 0.4, uCamF.z) * (box.x * 0.30);
  vec3 rel = mod(base - ctr, box) - 0.5 * box;
  vec3 w = ctr + rel;
  float dist = length(w - uCam);
  vec3 ax = uRel * uLay.x * (0.85 + 0.30 * aI.w);
  vec3 side = normalize(cross(ax, w - uCam)) * (uLay.y + dist * uLay.w);
  vec3 pos = w + ax * (aQ.y * 0.5) + side * aQ.x;
  vA = uLay.z * (0.30 + 0.70 * aI.w) * (1.0 - smoothstep(0.36, 0.5, max(abs(rel.x), abs(rel.z)) / box.x)) * smoothstep(0.4, 1.6, dist) * step(terrainH(w.xz), w.y);
  vQ = aQ;
  gl_Position = uVP * vec4(pos, 1.0);
}`, GLSL_UNI + `
in vec2 vQ; in float vA; out vec4 o;
uniform vec3 uRainCol;
void main(){ float a = (1.0 - abs(vQ.x)) * (1.0 - vQ.y * vQ.y) * vA; o = vec4(uRainCol * a, 0.0); }`, 'rain');

    // drops striking the grass and the ground round the camera: each a brief pale fleck
    this.sprog = program(GLSL_UNI + GLSL_NOISE + GLSL_WORLD + `
layout(location=0) in vec2 aQ; layout(location=1) in vec4 aI;
uniform vec3 uCamR, uCamU, uCamF; uniform float uRainT;
out vec2 vQ; out float vA;
void main(){
  float T = 30.0, life = fract(uRainT * (1.6 + aI.w) + aI.z * 17.0), gen = floor(uRainT * (1.6 + aI.w) + aI.z * 17.0);
  vec2 base = fract(aI.xy + gen * vec2(0.317, 0.713)) * T;                   // each strike lands somewhere new
  vec2 ctr = uCam.xz + uCamF.xz * T * 0.30, rel = mod(base - ctr, T) - 0.5 * T, p = ctr + rel;
  float y = terrainH(p), wat = step(riverD(p), 10.0);
  y = mix(y + 0.34 * uEnv2.y, WATER + 0.02, wat);                           // on the tips of the grass, or on the river
  float dist = distance(vec3(p.x, y, p.y), uCam);
  float size = (0.012 + 0.050 * life) * (1.0 + dist * 0.03);
  vA = uEnv.x * (1.0 - life) * (1.0 - life) * (1.0 - smoothstep(0.36, 0.5, length(rel) / T)) * smoothstep(0.8, 2.5, dist);
  vQ = aQ;
  gl_Position = uVP * vec4(vec3(p.x, y, p.y) + (uCamR * aQ.x + uCamU * aQ.y * 0.45) * size, 1.0);
}`, GLSL_UNI + `
in vec2 vQ; in float vA; out vec4 o;
void main(){ float r = length(vQ); if (r > 1.0) discard; o = vec4((uAmb * 0.9 + uHorA * 0.4) * (1.0 - r * r) * vA * 0.42, 0.0); }`, 'splash');
  },
  spawn(pos, vel, life, size, kind, tone, up) {
    const i = this.head; this.head = (this.head + 1) % this.MAX;
    this.p.set(pos, i * 3); this.v.set(vel, i * 3); this.life[i] = life; this.span[i] = life; this.size[i] = size; this.kind[i] = kind; this.seed[i] = this.rnd(); this.tone[i] = tone || 0; this.up[i] = up === undefined ? 0.12 : up;
  },
  // a hoof strikes at w. wet: 0..1 rain-soaked ground; snow: 0..1 it landed in a drift
  kick(w, v, leg, wet, snow) {
    const R = this.rnd, f = Horse.f, k = sat(v / 13), hind = leg < 2, white = snow > 0.5 ? 1 : wet > 0.5 ? 0.6 : 0;
    if (wet > 2.5) {
      // on ice: a little powder and a few chips
      for (let i = 0; i < 1 + Math.round(2 * k); i++) this.spawn([w[0], WATER + 0.04, w[2]], [-f[0] * v * 0.08 + (R() - 0.5) * 0.8, 0.3 + R() * 0.6, -f[2] * v * 0.08 + (R() - 0.5) * 0.8], 0.6 + R() * 0.5, 0.10 + R() * 0.08, 0, 1);
      for (let i = 0; i < Math.round(k * 3); i++) this.spawn([w[0], WATER + 0.05, w[2]], [-f[0] * v * 0.2 + (R() - 0.5) * 2.0, 0.8 + R() * 1.6, -f[2] * v * 0.2 + (R() - 0.5) * 2.0], 0.5 + R() * 0.4, 0.008 + R() * 0.012, 4, 0);
      return;
    }
    if (wet > 1.5) {
      // wading: a sheet of water thrown up and forward, and spray hanging after it
      const n = Math.round(5 + 12 * k);
      for (let i = 0; i < n; i++)
        this.spawn([w[0] + (R() - 0.5) * 0.3, WATER + 0.05, w[2] + (R() - 0.5) * 0.3], [f[0] * v * (0.10 + R() * 0.35) + (R() - 0.5) * 3.0, 1.5 + R() * (2.5 + 3.5 * k), f[2] * v * (0.10 + R() * 0.35) + (R() - 0.5) * 3.0],
          0.6 + R() * 0.7, 0.010 + R() * 0.022, 3, 0);
      for (let i = 0; i < 2 + Math.round(3 * k); i++)
        this.spawn([w[0] + (R() - 0.5) * 0.4, WATER + 0.15 + R() * 0.3, w[2] + (R() - 0.5) * 0.4], [f[0] * v * 0.25 + (R() - 0.5) * 1.5, 0.8 + R() * 1.6, f[2] * v * 0.25 + (R() - 0.5) * 1.5], 0.7 + R() * 0.8, 0.20 + R() * 0.2, 0, 0.6);
      return;
    }
    const nPuff = Math.round((1 + 4 * k * k + (hind ? 1 : 0) * k) * (snow > 0.5 ? 1.5 : wet > 0.5 ? 0.8 : 1));
    for (let i = 0; i < nPuff; i++)
      this.spawn([w[0] + (R() - 0.5) * 0.3, w[1] + 0.05 + R() * 0.15, w[2] + (R() - 0.5) * 0.3],
        [-f[0] * v * 0.10 + (R() - 0.5) * 1.1, 0.5 + R() * 1.3 * k, -f[2] * v * 0.10 + (R() - 0.5) * 1.1], (wet > 0.5 ? 0.7 : 1.4) + R() * 1.6, 0.16 + R() * 0.14, 0, white);
    const nBits = Math.round(k * (2 + R() * 4) * (white ? 2.2 : 1) + (white ? 2 : 0));
    for (let i = 0; i < nBits; i++)
      this.spawn([w[0], w[1] + 0.1, w[2]], [-f[0] * v * (0.15 + R() * 0.3) + (R() - 0.5) * 2.4, 1.6 + R() * 3.2, -f[2] * v * (0.15 + R() * 0.3) + (R() - 0.5) * 2.4], 0.7 + R() * 0.7,
        snow > 0.5 ? 0.012 + R() * 0.020 : wet > 0.5 ? 0.008 + R() * 0.012 : 0.012 + R() * 0.022, snow > 0.5 ? 4 : wet > 0.5 ? 3 : R() < 0.7 ? 1 : 2, 0);
  },
  // a breath in cold air, from p along dir
  breath(p, dir, amount) {
    const R = this.rnd;
    for (let i = 0; i < amount; i++) this.spawn([p[0], p[1], p[2]], [dir[0] * (1.2 + R()) + (R() - 0.5) * 0.4, dir[1] * (1.2 + R()) + 0.2, dir[2] * (1.2 + R()) + (R() - 0.5) * 0.4], 0.8 + R() * 0.7, 0.05 + R() * 0.04, 0, 1, 0.25);
  },
  smoke(p) { const R = this.rnd; this.spawn([p[0] + (R() - 0.5) * 0.2, p[1], p[2] + (R() - 0.5) * 0.2], [(R() - 0.5) * 0.3, 1.2, (R() - 0.5) * 0.3], 6.5 + R() * 3.0, 0.34 + R() * 0.20, 0, 0.7, 0.95 + R() * 0.4); },
  step(dt) {
    const P = this.p, V = this.v, wx = G.windDir[0] * 0.8, wz = G.windDir[1] * 0.8;
    G.rainT += dt;
    for (let i = 0; i < this.MAX; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt; const o = i * 3;
      if (this.kind[i] < 0.5) { const d = Math.exp(-2.6 * dt), up = this.up[i]; V[o] = wx + (V[o] - wx) * d; V[o + 1] = up + (V[o + 1] - up) * d; V[o + 2] = wz + (V[o + 2] - wz) * d; }
      else { V[o + 1] -= 9.8 * dt; const d = Math.exp(-0.9 * dt); V[o] *= d; V[o + 2] *= d; }
      P[o] += V[o] * dt; P[o + 1] += V[o + 1] * dt; P[o + 2] += V[o + 2] * dt;
      if (this.kind[i] > 0.5) { const g = groundY(P[o], P[o + 2]) + 0.03; if (P[o + 1] < g) this.life[i] = 0; }
    }
  },
  draw() {
    const b = this.buf; let k = 0;
    for (let i = 0; i < this.MAX; i++) {
      if (this.life[i] <= 0) continue;
      const o = i * 3, age = 1 - this.life[i] / this.span[i], puff = this.kind[i] < 0.5;
      b[k++] = this.p[o]; b[k++] = this.p[o + 1]; b[k++] = this.p[o + 2];
      b[k++] = puff ? this.size[i] * (1 + age * 4.0) : this.size[i];
      const tn = this.tone[i], pa = tn > 0.8 ? 0.26 : tn > 0.65 ? 0.20 : tn > 0.3 ? 0.075 : 0.17;      // snow smokes, so does a chimney; spray is thin, dust in between
      b[k++] = puff ? pa * Math.min(age * 9, 1) * Math.pow(1 - age, 1.5) : Math.min((1 - age) * 4, 1);
      b[k++] = this.kind[i]; b[k++] = this.seed[i]; b[k++] = this.tone[i];
    }
    const cnt = k / 8;
    gl.enable(gl.BLEND); gl.depthMask(false);
    gl.blendFunc(gl.ONE, gl.ONE);
    if (G.env[0] < 0.98) {
      const m = this.mprog.use(); setGlobals(m); m.f3('uCamR', G.camR); m.f3('uCamU', G.camU); m.f3('uCamF', G.camF); m.f1('uCrystal', Env.cur.crystal);
      gl.bindVertexArray(this.mvao); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.motes);
    }
    const rainCol = [(G.amb[0] * 1.35 + G.horA[0] * 0.5) * 0.20, (G.amb[1] * 1.35 + G.horA[1] * 0.5) * 0.20, (G.amb[2] * 1.35 + G.horA[2] * 0.5) * 0.20];
    if (G.env[0] > 0.01) {
      const r = this.rprog.use(); setGlobals(r); r.f3('uCamF', G.camF); r.f3('uFall', G.rainFall); r.f3('uRel', G.rainRel); r.f1('uRainT', G.rainT); r.f3('uRainCol', rainCol);
      gl.bindVertexArray(this.rvao);
      // near: fine quick streaks all round
      r.f3('uBox', [26, 15, 26]); r.f4('uLay', 0.026, 0.0034, G.env[0] * 0.85, 0.0009);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, Math.round(this.rainN * sat(G.env[0])));
      // far: the grey curtain of it, longer and fainter, out to a hundred metres
      r.f3('uBox', [110, 46, 110]); r.f4('uLay', 0.070, 0.004, G.env[0] * 0.30, 0.0011);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, Math.round(this.rainN * 0.7 * sat(G.env[0])));
      const sp = this.sprog.use(); setGlobals(sp); sp.f3('uCamR', G.camR); sp.f3('uCamU', G.camU); sp.f3('uCamF', G.camF); sp.f1('uRainT', G.rainT);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, Math.min(this.rainN, [500, 1100, 1800][App.quality]));
    }
    if (G.env3[1] > 0.01) {
      // snow lifted off the drifts and carried flat along the wind, in gusts
      const r = this.rprog.use(); setGlobals(r); r.f3('uCamF', G.camF); r.f1('uRainT', G.rainT);
      const gust = 0.35 + 0.65 * Math.pow(0.5 + 0.5 * Math.sin(G.time * 0.31 + Math.sin(G.time * 0.13) * 2), 2), fall = [G.windDir[0] * 7.5, -0.45, G.windDir[1] * 7.5], cv = Game.camVel;
      r.f3('uFall', fall); r.f3('uRel', [fall[0] - cv[0], fall[1] - cv[1], fall[2] - cv[2]]);
      r.f3('uRainCol', [(G.amb[0] + G.sunCol[0] * 0.25) * 0.30, (G.amb[1] + G.sunCol[1] * 0.25) * 0.30, (G.amb[2] + G.sunCol[2] * 0.25) * 0.30]);
      r.f3('uBox', [30, 7, 30]); r.f4('uLay', 0.012, 0.0075, G.env3[1] * gust, 0.0009);
      gl.bindVertexArray(this.rvao); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, Math.round(this.rainN * 0.45));
    }
    if (cnt > 0) {
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      const p = this.prog.use(); setGlobals(p); p.f3('uCamR', G.camR); p.f3('uCamU', G.camU);
      gl.bindVertexArray(this.vao); gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo); gl.bufferSubData(gl.ARRAY_BUFFER, 0, b, 0, k);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, cnt);
    }
    gl.disable(gl.BLEND); gl.depthMask(true);
  },
};

// ======== 10b_trail.js
// ---------------------------------------------------------------- what feet leave in deep snow
// The snow is the ground lifted (see the terrain's vertex shader); whoever walks on it stands on the earth beneath, legs in the snow.
// Every hoof and foot that goes down is kept here, and drawn into a map round the rider: how deep the hole is at each point (red)
// and how high the snow thrown out of it lies (green). The ground reads the map as it shades the snow, and makes of it a hole
// one can see into: its far wall showing, its floor in shade, a rough rim catching the light.
const Trail = {
  N: 2048, SPAN: 44, MAX: 720, prints: [], dirty: true, cx: 1e9, cz: 1e9, drawn: 0,
  init() {
    const N = this.N;
    this.tex = makeTex(N, N, gl.RG8, gl.RG, gl.UNSIGNED_BYTE, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.generateMipmap(gl.TEXTURE_2D);
    this.fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex, 0); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.buf = new Float32Array(this.MAX * 8);
    this.vao = gl.createVertexArray(); gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo); gl.bufferData(gl.ARRAY_BUFFER, this.buf.byteLength, gl.DYNAMIC_DRAW);
    for (let k = 0; k < 2; k++) { gl.enableVertexAttribArray(1 + k); gl.vertexAttribPointer(1 + k, 4, gl.FLOAT, false, 32, k * 16); gl.vertexAttribDivisor(1 + k, 1); }
    gl.bindVertexArray(null);
    this.prog = program(`
layout(location=0) in vec2 aQ; layout(location=1) in vec4 aA; layout(location=2) in vec4 aB;      // aA: where, and which way it was going; aB: size, a number of its own, depth, kind
uniform vec3 uC; out vec2 vL; out vec4 vB;
void main(){ vL = aQ * aB.x; vB = aB; vec2 w = aA.xy + vL.x * aA.zw + vL.y * vec2(-aA.w, aA.z); gl_Position = vec4((w - uC.xy) * uC.z * 2.0, 0.0, 1.0); }`, GLSL_NOISE + `
in vec2 vL; in vec4 vB; out vec4 o;
void main(){
  float size = vB.x, seed = vB.y, kind = floor(vB.w + 0.001), k = fract(vB.w) * 2.0, pit = 0.0, rim = 0.0;
  vec2 q = vL;
  if (kind < 0.5) {
    // a horse's hoof: a round hole with a ragged edge, a little longer than it is wide
    float R = 0.105 * (1.0 + 0.30 * (vnoise(vec2(atan(q.y, q.x) * 1.3 + seed * 17.0, seed * 5.0)) - 0.5)), d = length(q * vec2(0.90, 1.0));
    pit = 1.0 - smoothstep(R * 0.60, R, d);
    // it came in from behind, a short scuff, and left forward: a groove that shallows and narrows, longer the faster the horse
    float t = q.x / (0.34 + 0.30 * k), tb = -q.x / 0.24;
    if (t > 0.0 && t < 1.0) pit = max(pit, 0.62 * pow(1.0 - t, 1.3) * (1.0 - smoothstep(0.55, 1.0, abs(q.y) / (0.082 * (1.0 - 0.6 * t)))));
    if (tb > 0.0 && tb < 1.0) pit = max(pit, 0.34 * (1.0 - tb) * (1.0 - smoothstep(0.55, 1.0, abs(q.y) / 0.075)));
    // what came out of the hole lies round it, most of it ahead: a lumpy rim, and clods thrown further
    rim = smoothstep(R * 0.96, R * 1.14, d) * (1.0 - smoothstep(R * 1.3, R * (2.0 + 0.8 * k), d)) * (0.45 + 0.6 * vnoise(q * 22.0 + seed * 40.0)) * (0.65 + 0.6 * clamp(q.x / 0.3, -0.5, 1.0));
    vec2 c = q * 15.0 + seed * 7.0, ci = floor(c); float h = hash21(ci + seed * 91.0);
    float clod = step(0.90 - 0.10 * k, h) * (1.0 - smoothstep(0.10, 0.46, length(fract(c) - 0.5 - (vec2(hash21(ci + 3.0), hash21(ci + 5.0)) - 0.5) * 0.5)));
    rim = max(rim, clod * 0.34 * (0.5 + 0.5 * h) * (1.0 - smoothstep(size * 0.40, size * 0.85, length(q))) * smoothstep(R * 1.2, R * 1.8, d) * clamp(0.30 + q.x * 2.6, 0.0, 1.0));
  } else if (kind < 1.5) {
    // a boot
    float d = length(q / vec2(0.135, 0.052));
    pit = 1.0 - smoothstep(0.72, 1.0, d);
    rim = smoothstep(0.95, 1.15, d) * (1.0 - smoothstep(1.3, 1.9, d)) * (0.3 + 0.7 * vnoise(q * 40.0 + seed * 9.0));
  } else {
    // a cloven hoof: two toes side by side
    float R = size * 0.42, d2 = length(q); q.y = abs(q.y) - R * 0.30;
    pit = 1.0 - smoothstep(R * 0.55, R * 0.85, length(q * vec2(0.75, 1.5)));
    rim = smoothstep(R, R * 1.2, d2) * (1.0 - smoothstep(R * 1.4, R * 2.1, d2)) * (0.3 + 0.7 * vnoise(vL * 50.0 + seed * 9.0));
  }
  o = vec4(pit * vB.z, rim * (1.0 - pit), 0.0, 1.0);
}`, 'prints');
    G.trailTex = this.tex; G.trailC = [0, 0, 1 / this.SPAN];
  },
  // a foot goes down at (x, z), going the way yaw points. kind: 0 a horse (k: how fast, 0..1), 1 a person, 2 a cow or sheep (size: how big)
  stamp(x, z, yaw, kind, k, size) {
    const P = this.prints; if (P.length >= this.MAX) P.shift();
    P.push(kind === 0 ? [x, z, Math.cos(yaw), Math.sin(yaw), 0.62 + 0.22 * k, Math.random(), 0.86 + 0.14 * k, 0.49 * k] : kind === 1 ? [x, z, Math.cos(yaw), Math.sin(yaw), 0.30, Math.random(), 0.60, 1] : [x, z, Math.cos(yaw), Math.sin(yaw), size, Math.random(), 0.62, 2]);
    this.dirty = true;
  },
  // is (x, z) near enough the rider for a print there to be kept? (others ask before they stamp)
  near(x, z) { return G.env[1] > 0.03 && Math.abs(x - this.cx) < this.SPAN * 0.5 && Math.abs(z - this.cz) < this.SPAN * 0.5; },
  update(dt, g) {
    if (G.env[1] < 0.03) { if (this.prints.length) { this.prints.length = 0; this.dirty = true; } return; }
    // the map is centred on the rider, moved a few metres at a time
    const cx = Math.round(g.x / 4) * 4, cz = Math.round(g.z / 4) * 4;
    if (cx !== this.cx || cz !== this.cz) { this.cx = cx; this.cz = cz; this.dirty = true; }
  },
  render() {
    if (!this.dirty) return; this.dirty = false;
    const c = G.trailC, P = this.prints, buf = this.buf, H = this.SPAN * 0.5 + 1; c[0] = this.cx; c[1] = this.cz;
    let n = 0; for (const q of P) if (Math.abs(q[0] - c[0]) < H && Math.abs(q[1] - c[1]) < H) buf.set(q, (n++) * 8);
    if (!n && !this.drawn) return;
    this.drawn = n;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb); gl.viewport(0, 0, this.N, this.N); gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    if (n) {
      // where prints overlap, the deeper hole and the higher heap win
      gl.enable(gl.BLEND); gl.blendEquation(gl.MAX); gl.blendFunc(gl.ONE, gl.ONE);
      const p = this.prog.use(); p.f3('uC', c);
      gl.bindVertexArray(this.vao); gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo); gl.bufferSubData(gl.ARRAY_BUFFER, 0, buf, 0, n * 8);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n); gl.bindVertexArray(null);
      gl.blendEquation(gl.FUNC_ADD); gl.disable(gl.BLEND);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, this.tex); gl.generateMipmap(gl.TEXTURE_2D);
  },
};

// ======== 11_post.js
// ---------------------------------------------------------------- frame buffers, bloom, tone and grade
const Post = {
  scene: null, resolve: null, chain: [], w: 0, h: 0, samples: 4, bloomLevels: 6,
  init() {
    this.pDown = program(VS_FULL, `
in vec2 vUv; out vec4 o; uniform sampler2D uT; uniform vec2 uPx; uniform float uFirst, uExp;
void main(){
  vec3 c = texture(uT, vUv).rgb * 4.0;
  c += texture(uT, vUv + uPx * vec2(-1.0, -1.0)).rgb + texture(uT, vUv + uPx * vec2(1.0, -1.0)).rgb + texture(uT, vUv + uPx * vec2(-1.0, 1.0)).rgb + texture(uT, vUv + uPx * vec2(1.0, 1.0)).rgb;
  c /= 8.0;
  if (!(c.r >= 0.0) || !(c.g >= 0.0) || !(c.b >= 0.0)) c = vec3(0.0);     // never let a bad pixel bloom
  // the first step keeps only what is bright, softly
  if (uFirst > 0.5) { float l = max(c.r, max(c.g, c.b)) * uExp; c *= smoothstep(0.85, 2.2, l); c = min(c, vec3(24.0)); }
  o = vec4(c, 1.0);
}`, 'down');
    this.pUp = program(VS_FULL, `
in vec2 vUv; out vec4 o; uniform sampler2D uT; uniform vec2 uPx;
void main(){
  vec3 c = texture(uT, vUv + uPx * vec2(-1.0, -1.0)).rgb + texture(uT, vUv + uPx * vec2(1.0, -1.0)).rgb + texture(uT, vUv + uPx * vec2(-1.0, 1.0)).rgb + texture(uT, vUv + uPx * vec2(1.0, 1.0)).rgb;
  o = vec4(c * 0.25, 1.0);
}`, 'up');
    this.pFinal = program(VS_FULL, `
in vec2 vUv; out vec4 o; uniform sampler2D uT, uB; uniform float uExp, uTime, uFade;
vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
float h1(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main(){
  vec3 c = texture(uT, vUv).rgb + texture(uB, vUv).rgb * 0.55;
  c *= uExp;
  vec2 q = vUv - 0.5;
  c *= 1.0 - dot(q, q) * 0.55;
  c = aces(c);
  // a touch of warmth in the lights, cool in the shade
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, 1.16);
  c = mix(c, c * c * (3.0 - 2.0 * c), 0.30);
  c *= mix(vec3(0.96, 0.99, 1.05), vec3(1.04, 1.0, 0.95), smoothstep(0.1, 0.8, l));
  c = pow(max(c, 0.0), vec3(1.0 / 2.2));
  c += (h1(gl_FragCoord.xy + fract(uTime) * 61.0) - 0.5) / 255.0;
  o = vec4(c * uFade, 1.0);
}`, 'final');
  },
  resize(w, h) {
    if (w === this.w && h === this.h) return;
    this.w = w; this.h = h;
    freeScene(this.scene); freeTarget(this.resolve); this.chain.forEach(freeTarget);
    this.scene = makeScene(w, h, this.samples);
    if (!this.scene.ok) { freeScene(this.scene); this.samples = 0; this.scene = makeScene(w, h, 0); }
    this.resolve = makeTarget(w, h);
    this.chain = [];
    let cw = w, ch = h;
    for (let i = 0; i < this.bloomLevels; i++) { cw = Math.max(2, cw >> 1); ch = Math.max(2, ch >> 1); this.chain.push(makeTarget(cw, ch)); }
  },
  begin() {
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.scene.fb); gl.viewport(0, 0, this.w, this.h);
    gl.clearColor(0, 0, 0, 1); gl.clearDepth(1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  },
  end(fade) {
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.scene.fb); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.resolve.fb);
    gl.blitFramebuffer(0, 0, this.w, this.h, 0, 0, this.w, this.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.depthMask(false);
    let src = this.resolve, p = this.pDown.use(); p.i1('uT', 0); p.f1('uExp', G.exposure); gl.activeTexture(gl.TEXTURE0);
    for (let i = 0; i < this.chain.length; i++) {
      const d = this.chain[i];
      gl.bindFramebuffer(gl.FRAMEBUFFER, d.fb); gl.viewport(0, 0, d.w, d.h);
      gl.bindTexture(gl.TEXTURE_2D, src.tex); p.f2('uPx', 1 / src.w, 1 / src.h); p.f1('uFirst', i === 0 ? 1 : 0);
      drawFull(); src = d;
    }
    p = this.pUp.use(); p.i1('uT', 0);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    for (let i = this.chain.length - 1; i > 0; i--) {
      const s = this.chain[i], d = this.chain[i - 1];
      gl.bindFramebuffer(gl.FRAMEBUFFER, d.fb); gl.viewport(0, 0, d.w, d.h);
      gl.bindTexture(gl.TEXTURE_2D, s.tex); p.f2('uPx', 0.5 / s.w, 0.5 / s.h);
      drawFull();
    }
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, canvas.width, canvas.height);
    p = this.pFinal.use(); p.i1('uT', 0); p.i1('uB', 1); p.f1('uExp', G.exposure); p.f1('uTime', G.time); p.f1('uFade', fade);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.chain[0].tex);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.resolve.tex);
    drawFull();
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
  },
};

// ======== 12_audio.js
// ---------------------------------------------------------------- sound: every bit of it synthesised
const Sound = {
  ctx: null, on: true, gust: 0, gustT: 0, lastPh: 0,
  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const c = this.ctx = new AC();
    this.master = c.createGain(); this.master.gain.value = this.on ? 0.9 : 0;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 3.5; comp.attack.value = 0.004; comp.release.value = 0.2;
    this.master.connect(comp); comp.connect(c.destination);
    // two seconds of white noise, used for everything that hisses or thuds
    const nb = this.noise = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), d = nb.getChannelData(0), r = rng(11);
    for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1;
    const loop = (rate) => { const s = c.createBufferSource(); s.buffer = nb; s.loop = true; s.playbackRate.value = rate || 1; s.start(0, Math.random()); return s; };
    const chain = (type, freq, q) => { const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; const g = c.createGain(); g.gain.value = 0; f.connect(g); g.connect(this.master); return { f, g }; };
    // wind in the ears: rises with speed
    this.wind = chain('bandpass', 420, 0.55); loop().connect(this.wind.f);
    // grass against the legs
    this.swish = chain('highpass', 3200, 0.7); loop().connect(this.swish.f);
    // rain: the hiss of it all round, a duller patter close by, and a low roar under both
    this.rainHi = chain('highpass', 5200, 0.5); loop(1.07).connect(this.rainHi.f);
    this.rainMid = chain('bandpass', 1500, 0.6); loop(0.93).connect(this.rainMid.f);
    this.rainLow = chain('lowpass', 260, 0.5); loop(0.71).connect(this.rainLow.f);
    // the river: a bright gurgle and a low wash, heard when near
    this.riverHi = chain('bandpass', 2300, 1.4); loop(1.21).connect(this.riverHi.f);
    this.riverLo = chain('lowpass', 420, 0.6); loop(0.63).connect(this.riverLo.f);
    // a thin high whistle of wind for the mountain country
    this.whistle = chain('bandpass', 1900, 9); loop(0.83).connect(this.whistle.f);
    // a low open fifth that swells very slowly: the land itself
    this.pad = c.createGain(); this.pad.gain.value = 0;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520; lp.Q.value = 0.4;
    lp.connect(this.pad); this.pad.connect(this.master);
    let n = 0;
    for (const [f, g, det] of [[73.42, 0.50, -4], [110.0, 0.36, 3], [146.83, 0.22, 5], [220.0, 0.10, -6], [329.63, 0.05, 2]]) {
      const o = c.createOscillator(), og = c.createGain(), lfo = c.createOscillator(), lg = c.createGain();
      o.type = 'triangle'; o.frequency.value = f; o.detune.value = det; og.gain.value = g;
      lfo.frequency.value = 0.03 + (n++) * 0.017; lg.gain.value = g * 0.6; lfo.connect(lg); lg.connect(og.gain);
      o.connect(og); og.connect(lp); o.start(); lfo.start();
    }
    this.pad.gain.setTargetAtTime(0.055, c.currentTime + 0.5, 4);
    // legs pushing through powder: a soft rush, only in deep snow and only when moving
    this.powder = chain('lowpass', 520, 0.5); loop(0.89).connect(this.powder.f);
    this.snowBuf = this.makeSnow(c);
  },
  // A step into deep snow, made a sample at a time (six of them, no two steps the same). It is a soft sound and a low one.
  // The hoof sinks in with a muffled whump; the snow packs under it with a crunch, a crackle of small collapses, thick at first
  // and thinning; and all of it is heard through the snow, which lets nothing high get out. Nothing rings in it, nothing hisses.
  // (An earlier one had grains ringing at 1 to 5 kHz and a narrow creak: measured, it was 27 dB(A) louder than a hoof on turf,
  // half its energy between 2 and 4 kHz, and it hurt.) snowMix: how much whump and how much crunch; snowGain: how loud it plays.
  // (Measured with tools/audio_measure.js, at a trot: about 2 dB(A) louder than a hoof on turf, but drawn out over 0.16 s, so softer to the ear; 60% of it below 300 Hz, a third between 300 Hz and 1 kHz, under 1% above 2 kHz)
  snowMix: { whump: 2.0, crunch: 1.0 }, snowGain: 0.089, powderGain: 0.04,
  makeSnow(c) {
    const sr = c.sampleRate, R = rng(77), out = [], n = Math.floor(sr * 0.40), lp = f => 1 - Math.exp(-TAU * f / sr), M = this.snowMix;
    for (let v = 0; v < 6; v++) {
      const b = c.createBuffer(1, n, sr), d = b.getChannelData(0), env = new Float32Array(n);
      // the crackle: grains of a few milliseconds each, every one at its own loudness, crowded at first and thinning out
      const grains = 45 + Math.floor(R() * 25), span = 0.15 + 0.07 * R();
      for (let k = 0; k < grains; k++) {
        const u = Math.pow(R(), 1.5), i0 = Math.floor((0.010 + u * span) * sr), len = Math.floor(sr * (0.004 + 0.008 * R())), amp = (0.3 + 0.7 * Math.pow(R(), 1.6)) * (1 - 0.75 * u);
        for (let i = 0; i < len && i0 + i < n; i++) { const e = Math.sin(Math.PI * i / len); env[i0 + i] += amp * e * e; }
      }
      const fc = 480 + 220 * R(), aW = lp(115 + 45 * R()), aHi = lp(fc * 1.9), aLo = lp(fc * 0.42), aOut = lp(1400);
      let w1 = 0, w2 = 0, h1 = 0, h2 = 0, l1 = 0, o1 = 0, o2 = 0, sum = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr, w = R() * 2 - 1, e = env[i];
        w1 += (w - w1) * aW; w2 += (w1 - w2) * aW;                                                   // the whump
        let x = w2 * M.whump * Math.min(1, t / 0.020) * Math.exp(-Math.max(0, t - 0.020) / 0.075);
        h1 += (w - h1) * aHi; h2 += (h1 - h2) * aHi; l1 += (h2 - l1) * aLo;                          // the crunch: noise kept to a band about fc
        x += (h2 - l1) * (e / (1 + 0.4 * e)) * M.crunch;
        o1 += (x - o1) * aOut; o2 += (o1 - o2) * aOut;                                               // and the whole of it heard through the snow
        d[i] = o2; sum += o2 * o2;
      }
      const fade = Math.floor(sr * 0.05), rms = Math.sqrt(sum / n) || 1;
      for (let i = 0; i < n; i++) d[i] *= 0.1 / rms * (i > n - fade ? (n - i) / fade : 1);
      out.push(b);
    }
    return out;
  },
  toggle() { this.on = !this.on; if (this.ctx) this.master.gain.setTargetAtTime(this.on ? 0.9 : 0, this.ctx.currentTime, 0.08); return this.on; },
  burst(freq, q, type, gain, attack, decay, when) {
    const c = this.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(), t = when || c.currentTime;
    s.buffer = this.noise; s.loop = true; f.type = type; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t, Math.random() * 1.5); s.stop(t + attack + decay + 0.05);
    return f;
  },
  // a hoof lands: a low thump and a dull scuff on turf, a splash when the ground is soaked, a crunch in snow
  // a hoof goes down into deep snow: one of the samples, a little lower or higher each time, a little to the side its leg is on.
  // Faster it is a little louder, never brighter
  snowStep(leg, v) {
    const c = this.ctx, t = c.currentTime, k = sat(v / 13), b = c.createBufferSource(), g = c.createGain();
    b.buffer = this.snowBuf[Math.floor(Math.random() * this.snowBuf.length)];
    b.playbackRate.value = (leg >= 2 ? 1.0 : 0.94) * (0.88 + Math.random() * 0.16);
    g.gain.value = this.snowGain * (0.75 + 0.45 * k) * (leg >= 2 ? 1 : 0.85) * (0.85 + 0.3 * Math.random());
    b.connect(g);
    if (c.createStereoPanner) { const pn = c.createStereoPanner(); pn.pan.value = (leg % 2 ? 0.18 : -0.18) + (Math.random() - 0.5) * 0.1; g.connect(pn); pn.connect(this.master); } else g.connect(this.master);
    b.start(t);
  },
  hoof(leg, v, wet, snow) {
    const c = this.ctx; if (!c || c.state !== 'running') return;
    if (snow > 0.5 && wet < 1.5) return this.snowStep(leg, v);
    const t = c.currentTime, k = sat(v / 13), fore = leg >= 2, j = 0.9 + Math.random() * 0.2, soft = snow > 0.5 ? 0.55 : 1;
    const o = c.createOscillator(), g = c.createGain();
    const f0 = (fore ? 96 : 82) * j;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * 0.48, t + 0.09);
    const amp = (0.20 + 0.42 * k) * (fore ? 1 : 0.85) * soft;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(amp, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13 + 0.05 * k);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.25);
    this.burst(520 * j, 0.7, 'lowpass', (0.10 + 0.16 * k) * soft, 0.003, 0.055, t);
    this.burst(4200, 0.6, 'highpass', 0.012 + 0.03 * k, 0.012, 0.13, t + 0.01);
    if (wet > 3.5) {
      // on the planks of the bridge: a hollow knock, the deck answering
      this.burst(230 * j, 6.0, 'bandpass', 0.34 + 0.20 * k, 0.002, 0.12, t); this.burst(640 * j, 4.0, 'bandpass', 0.14 + 0.08 * k, 0.001, 0.05, t); this.burst(1900, 1.5, 'bandpass', 0.05 + 0.05 * k, 0.001, 0.02, t);
    }
    else if (wet > 2.5) {
      // on ice: a hard bright knock, and the sheet answering underneath
      this.burst(3400 * j, 3.0, 'bandpass', 0.16 + 0.14 * k, 0.001, 0.035, t); this.burst(190 * j, 2.2, 'bandpass', 0.10 + 0.08 * k, 0.004, 0.22, t);
      if (Math.random() < 0.012 + 0.02 * k) this.iceSong(t + 0.1 + Math.random() * 0.4);
    }
    else if (wet > 1.5) { this.burst(1800 * j, 0.5, 'bandpass', 0.14 + 0.16 * k, 0.012, 0.26, t); this.burst(5200, 0.5, 'highpass', 0.05 + 0.07 * k, 0.02, 0.30, t + 0.02); }
    else if (wet > 0.5) this.burst(2600 * j, 0.5, 'bandpass', 0.05 + 0.10 * k, 0.008, 0.16, t + 0.004);
    if (snow > 0.5) { this.burst(1700 * j, 1.4, 'bandpass', 0.07 + 0.09 * k, 0.004, 0.07, t); this.burst(900 * j, 1.0, 'bandpass', 0.05, 0.02, 0.10, t + 0.02); }
  },
  // the ice sings: a crack running away through the sheet, heard as a falling ping
  iceSong(t) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain(), f0 = 900 + Math.random() * 900;
    o.type = 'sine'; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * 0.22, t + 0.45);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.07, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.8);
  },
  // an axe into a log: a dull knock and the crack of the wood
  chop(dist) {
    const c = this.ctx; if (!c || c.state !== 'running' || dist > 120) return;
    const t = c.currentTime + dist / 340, vol = 1 / (1 + dist / 10);
    this.burst(700, 1.2, 'bandpass', 0.30 * vol, 0.002, 0.07, t); this.burst(2600, 0.8, 'bandpass', 0.14 * vol, 0.001, 0.035, t); this.burst(160, 1.5, 'lowpass', 0.22 * vol, 0.004, 0.12, t);
  },
  // a voice from the herd: a sheep's bleat (a reedy note that shakes) or a cow's low (a long note that rises and sinks)
  call(kind, dist, young) {
    const c = this.ctx; if (!c || c.state !== 'running') return;
    const t = c.currentTime + 0.02, vol = 1 / (1 + dist / 14), o = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain(), lf = c.createOscillator(), lg = c.createGain();
    o.type = 'sawtooth'; let dur;
    if (kind === 'sheep') {
      const f0 = (300 + Math.random() * 120) * (young ? 1.6 : 1), a = 0.10 * vol; dur = 0.55 + Math.random() * 0.5;
      o.frequency.setValueAtTime(f0 * 0.92, t); o.frequency.linearRampToValueAtTime(f0, t + 0.08); o.frequency.linearRampToValueAtTime(f0 * 0.86, t + dur);
      f.type = 'bandpass'; f.frequency.value = young ? 2100 : 1500; f.Q.value = 1.6;
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(a, t + 0.05); g.gain.setValueAtTime(a, t + dur * 0.7); g.gain.linearRampToValueAtTime(0.0001, t + dur);
      lf.frequency.value = 13 + Math.random() * 5; lg.gain.value = a * 0.5;
    } else {
      const f0 = (105 + Math.random() * 25) * (young ? 1.7 : 1), a = 0.15 * vol; dur = 1.3 + Math.random() * 0.8;
      o.frequency.setValueAtTime(f0 * 0.82, t); o.frequency.linearRampToValueAtTime(f0 * 1.12, t + dur * 0.4); o.frequency.linearRampToValueAtTime(f0 * 0.90, t + dur);
      f.type = 'lowpass'; f.frequency.value = 560; f.Q.value = 1.3;
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(a, t + 0.25); g.gain.setValueAtTime(a, t + dur * 0.75); g.gain.linearRampToValueAtTime(0.0001, t + dur);
      lf.frequency.value = 5; lg.gain.value = a * 0.12;
    }
    lf.connect(lg); lg.connect(g.gain); o.connect(f); f.connect(g); g.connect(this.master);
    o.start(t); lf.start(t); o.stop(t + dur + 0.1); lf.stop(t + dur + 0.1);
  },
  // thunder: a crack if it was close, then a long roll that sinks
  thunder(delay) {
    const c = this.ctx; if (!c || c.state !== 'running') return;
    const t = c.currentTime + delay, near = sat(1.6 - delay * 0.5);
    if (near > 0.2) this.burst(1400, 0.4, 'lowpass', 0.30 * near, 0.004, 0.22, t);
    for (let i = 0; i < 4; i++) {
      const f = this.burst(140 - i * 22, 0.5, 'lowpass', (0.55 - i * 0.09) * (0.5 + 0.5 * near), 0.06 + i * 0.05, 1.3 + i * 0.6, t + 0.05 + i * 0.32 + Math.random() * 0.15);
      f.frequency.exponentialRampToValueAtTime(48, t + 3.5);
    }
  },
  update(dt, v, phase, rD) {
    const c = this.ctx; if (!c || c.state !== 'running') return;
    const t = c.currentTime, k = sat(v / 16.5), e = Env.cur;
    this.gustT -= dt; if (this.gustT <= 0) { this.gustT = 1.2 + Math.random() * 2.5; this.gust = Math.random(); }
    const hush = sat(e.snow * 2.5);      // deep snow swallows sound: the wind is softer and duller, no grass brushes the legs
    this.wind.g.gain.setTargetAtTime(((0.012 + 0.025 * this.gust) * e.wind + 0.20 * Math.pow(k, 1.6)) * (1 - 0.32 * hush), t, 0.35);
    this.wind.f.frequency.setTargetAtTime((300 + 520 * k + 140 * this.gust) * (1 - 0.22 * hush), t, 0.5);
    this.swish.g.gain.setTargetAtTime((0.004 + 0.022 * Math.sqrt(k)) * e.grassH * (1 - hush), t, 0.2);
    this.powder.g.gain.setTargetAtTime(hush * (this.inSnow ? 1 : 0) * this.powderGain * Math.sqrt(k), t, 0.25);
    // rain is louder the faster you ride into it
    const rn = Env.rainNow, near = 1 - smooth(8, 70, rD === undefined ? 99 : rD);
    this.rainHi.g.gain.setTargetAtTime(rn * (0.050 + 0.030 * k + 0.015 * this.gust), t, 0.5);
    this.rainMid.g.gain.setTargetAtTime(rn * (0.060 + 0.020 * this.gust), t, 0.5);
    this.rainLow.g.gain.setTargetAtTime(rn * 0.16, t, 0.6);
    this.riverHi.g.gain.setTargetAtTime(near * near * (0.030 + 0.012 * this.gust), t, 0.4);
    this.riverLo.g.gain.setTargetAtTime(near * 0.10, t, 0.4);
    this.riverHi.f.frequency.setTargetAtTime(1900 + 900 * this.gust, t, 0.7);
    this.whistle.g.gain.setTargetAtTime(e.mount * (0.004 + 0.010 * this.gust), t, 0.9);
    this.whistle.f.frequency.setTargetAtTime(1500 + 900 * this.gust, t, 1.2);
    this.pad.gain.setTargetAtTime(0.055 * (1 - 0.5 * e.rain), t, 2);
    // at a canter and above the horse breathes out once a stride, as the forelegs come down
    if (v > 6.5 && phase > 0.45 && this.lastPh <= 0.45) this.burst(620, 1.1, 'bandpass', 0.035 + 0.05 * k, 0.05, 0.16, t);
    this.lastPh = phase;
  },
};

// ======== 13_game.js
// ---------------------------------------------------------------- riding: input, motion over the land, the camera
const portraitRide = document.documentElement.dataset.layout === 'portrait';
const Game = {
  x: 0, z: 0, yaw: 0.20, velYaw: 0.20, onIce: false, v: 0, level: 0, sprint: false, steer: 0, slope: 0, roll: 0, dist: 0, started: false, t: 0, tStart: 0,
  keys: { left: false, right: false }, touchSteer: 0, scripted: null,
  speeds: [0, 1.7, 4.2, 7.8, 12.5], sprintSpeed: 16.5,
  breathT: 0, lastPh: 0, rD: 99, camYaw: 0.20, camY: 0, view: 0, orbit: { yaw: 0, pitch: 0, hold: 0 }, kick: 0, blend: 0, eyeY: 0, prevCam: null, camVel: [0, 0, 0],
  intro: portraitRide
    ? { d: 7.8, h: 1.75, ahead: 0.12, up: 1.32, fov: 48 }
    : { d: 7.8, h: 1.9, ahead: 0.2, up: 3.15, fov: 42 },
  views: portraitRide ? [
    { name: '跟随', off: 0.26, d: 6.8, h: 2.15, ahead: 0.95, up: 1.8, fov: 50 },
    { name: '第一视角', fp: true, fov: 72 },
    { name: '高远', off: 0.22, d: 11.5, h: 4.45, ahead: 1.5, up: 1.6, fov: 52 },
  ] : [
    { name: '跟随', off: 0.66, d: 5.4, h: 1.75, ahead: 1.5, up: 1.25, fov: 48 },
    { name: '第一视角', fp: true, fov: 78 },
    { name: '高远', off: 0.45, d: 13.0, h: 5.2, ahead: 3.0, up: 1.00, fov: 48 },
  ],
  init() {
    const p0 = Places.list.valley; this.x = p0.x; this.z = p0.z; this.yaw = p0.yaw;
    this.camYaw = this.yaw; this.camY = groundY(this.x, this.z) + 2;
    this.place(0);
    listenRideGlobal(window, 'keydown', e => this.key(e, true));
    listenRideGlobal(window, 'keyup', e => this.key(e, false));
    let drag = null;
    canvas.addEventListener('pointerdown', e => {
      if (!this.started || (portraitRide && (drag || e.button !== 0))) return;
      const travel = portraitRide ? clamp(canvas.getBoundingClientRect().width * 0.20, 52, 92) : 110;
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, x0: e.clientX, steering: portraitRide || e.pointerType === 'touch', travel };
      try { canvas.setPointerCapture(e.pointerId); } catch (_) { }
    });
    canvas.addEventListener('pointermove', e => {
      if (!drag || e.pointerId !== drag.id) return;
      if (drag.steering) this.touchSteer = clamp((e.clientX - drag.x0) / drag.travel, -1, 1);
      else {
        const fp = this.views[this.view].fp;
        this.orbit.yaw = clamp(this.orbit.yaw + (e.clientX - drag.x) * 0.006, fp ? -2.4 : -99, fp ? 2.4 : 99);
        this.orbit.pitch = clamp(this.orbit.pitch + (e.clientY - drag.y) * 0.004, fp ? -0.6 : -0.25, 0.9); this.orbit.hold = 3;
      }
      drag.x = e.clientX; drag.y = e.clientY;
    });
    const up = e => { if (drag && e.pointerId === drag.id) { drag = null; this.touchSteer = 0; } };
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    if (portraitRide) {
      canvas.addEventListener('lostpointercapture', up);
      const stopInput = () => {
        if (drag && canvas.hasPointerCapture(drag.id)) canvas.releasePointerCapture(drag.id);
        drag = null; this.touchSteer = 0;
        this.keys.left = false; this.keys.right = false; this.sprint = false;
      };
      listenRideGlobal(window, 'blur', stopInput);
      listenRideGlobal(document, 'visibilitychange', () => { if (document.hidden) stopInput(); });
    }
  },
  key(e, down) {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === 'ArrowLeft' || k === 'a') this.keys.left = down;
    else if (k === 'ArrowRight' || k === 'd') this.keys.right = down;
    else if (k === 'Shift') this.sprint = down;
    else if (down && !e.repeat && this.started) {
      if (k === 'ArrowUp' || k === 'w') this.faster();
      else if (k === 'ArrowDown' || k === 's') this.slower();
      else if (k === 'v') UI.toast(this.nextView());
      else if (k === 'f') UI.toast(this.setView(this.view === 1 ? 0 : 1));
      else if (k === 'c') { const s = Env.next(); UI.toast(s.label, s.sub); }
      else if (k === 'g') { const pl = this.goto(Places.next()); UI.toast(pl.label, pl.sub); }
      else return;
    } else return;
    if (k.startsWith('Arrow')) e.preventDefault();
  },
  faster() { this.level = Math.min(4, this.level + 1); },
  slower() { this.level = Math.max(0, this.level - 1); },
  setView(i) { this.view = i; this.orbit.yaw = 0; this.orbit.pitch = 0; return this.views[i].name; },
  nextView() { return this.setView((this.view + 1) % this.views.length); },
  start() { if (this.started) return; this.started = true; this.tStart = this.t; this.level = Places.cur === 'valley' ? 3 : 1; },
  // set the rider down at one of the places, in the weather that suits it
  goto(key) {
    const p = Places.list[key]; Places.cur = key;
    this.x = p.x; this.z = p.z; this.yaw = p.yaw; this.velYaw = p.yaw; this.camYaw = p.yaw; this.v = 0; this.steer = 0; this.roll = 0; this.dist = 0;
    this.level = this.started ? 1 : 0; this.sprint = false; this.orbit.yaw = 0; this.orbit.pitch = 0;
    this.slope = 0; this.place(0); this.camY = groundY(this.x, this.z) + 3; this.prevCam = null; this.camVel = [0, 0, 0];
    Hair.ready = false; Fx.life.fill(0);
    Env.set(p.weather, true); App.fade = 0;
    return p;
  },
  // tests drive it with this instead of keys: { steer, level, sprint, view, look: [yaw, pitch] }
  script(s) {
    this.scripted = s; if (!this.started) { this.started = true; this.blend = 1; }
    if (s.level !== undefined) this.level = s.level; if (s.sprint !== undefined) this.sprint = s.sprint; if (s.view !== undefined) this.view = s.view;
    if (s.look) { this.orbit.yaw = s.look[0]; this.orbit.pitch = s.look[1]; this.orbit.hold = 1; }
  },

  place(dt) {
    const fx = Math.cos(this.yaw), fz = Math.sin(this.yaw), h0 = rideH(this.x, this.z);
    const sl = (rideH(this.x + fx * 1.2, this.z + fz * 1.2) - rideH(this.x - fx * 1.2, this.z - fz * 1.2)) / 2.4;
    this.slope = dt > 0 ? damp(this.slope, sl, 5, dt) : sl;
    const f = v3.norm([fx, this.slope, fz]), r0 = [-fz, 0, fx], u0 = v3.cross(r0, f), c = Math.cos(this.roll), s = Math.sin(this.roll);
    const r = [r0[0] * c - u0[0] * s, r0[1] * c - u0[1] * s, r0[2] * c - u0[2] * s], u = [u0[0] * c + r0[0] * s, u0[1] * c + r0[1] * s, u0[2] * c + r0[2] * s];
    Horse.place([this.x, h0, this.z], f, u, r);
    G.horse = Horse.pos;
    return sl;
  },

  step(dt) {
    this.t += dt;
    const sc = this.scripted;
    const want = sc && sc.steer !== undefined ? sc.steer : clamp((this.keys.right ? 1 : 0) - (this.keys.left ? 1 : 0) + this.touchSteer, -1, 1);
    this.steer = damp(this.steer, want, 5, dt);
    const sprinting = this.sprint && this.level === 4;
    let vt = sprinting ? this.sprintSpeed : this.speeds[this.level];
    vt *= 1 - clamp(this.slope, -0.08, 0.3) * 0.9;           // uphill costs something
    if (this.slope < -0.14) vt *= 1 - sat((-this.slope - 0.14) / 0.3) * 0.45;      // and a steep way down is taken carefully
    this.rD = riverD(this.x, this.z);
    const lk = lakeD(this.x, this.z), depth = WATER - terrainH(this.x, this.z);
    this.onIce = iceAt(this.x, this.z);
    this.inWater = !this.onIce && depth > 0.04 && (this.rD < 13 || lk < 8);
    this.waterNear = Math.min(this.rD, G.env3[3] > 0.5 ? 99 : Math.abs(lk) * 0.45);
    if (this.inWater) vt *= 0.80;                            // and so does wading
    this.v += clamp(vt - this.v, -5.0 * dt, 3.4 * dt);
    const yawRate = this.steer * lerp(1.20, 0.40, sat(this.v / 16)) * sat(0.3 + this.v / 2);
    this.yaw += yawRate * dt;
    // on ice the hooves do not bite: the horse turns, and for a moment goes on the way it was going
    this.velYaw = this.onIce ? this.velYaw + wrapPi(this.yaw - this.velYaw) * (1 - Math.exp(-1.7 * dt)) : this.yaw;
    this.x += Math.cos(this.velYaw) * this.v * dt; this.z += Math.sin(this.velYaw) * this.v * dt; this.dist += this.v * dt;
    this.roll = damp(this.roll, clamp(this.v * yawRate / 9.8 * 0.9, -0.30, 0.30), 4, dt);
    // trees and yurts are ridden round, not through
    const push = (ox, oz, r) => { const dx = this.x - ox, dz = this.z - oz, d = Math.hypot(dx, dz); if (d < r && d > 1e-4) { this.x += dx / d * (r - d); this.z += dz / d * (r - d); } };
    Trees.near(this.x, this.z, 2, (wx, wz) => push(wx, wz, 1.25));
    Camp.update(dt);
    for (const c of Camp.list) push(c.x, c.z, 3.7);
    Village.collide(this); Herd.update(dt, this); People.update(dt, this);
    // the horse will not go out of its depth: it is turned back up the shelving bottom
    if (this.inWater && depth > 0.72) {
      const gx = terrainH(this.x + 1, this.z) - terrainH(this.x - 1, this.z), gz = terrainH(this.x, this.z + 1) - terrainH(this.x, this.z - 1), gl = Math.hypot(gx, gz) || 1, k = Math.min(2.5, 0.3 + (depth - 0.72) * 6);
      this.x += gx / gl * k; this.z += gz / gl * k; this.v *= 0.93;
    }
    this.place(dt);
    const V = this.views[this.view];
    Horse.fp = !!V.fp && this.blend > 0.6;
    Horse.update(dt, this.v, { turn: this.steer, slope: this.slope });
    for (const i of Horse.footfalls) {
      const hf = Horse.A.hoof[i], w = Horse.toWorld(hf[0], 0.02, hf[2]), ice = iceAt(w[0], w[2]), inW = !ice && groundY(w[0], w[2]) > terrainH(w[0], w[2]) + 0.03, deck = Bridge.h(w[0], w[2]) > -1e8, wet = deck ? 4 : ice ? 3 : inW ? 2 : Env.cur.wet, snow = inW || ice || deck ? 0 : snowAt(w[0], w[2]);
      Sound.inSnow = snow > 0.5;
      if (snow > 0.5) {      // the hoof goes in, leaves its hole, and comes up throwing a little snow
        Trail.stamp(w[0], w[2], this.yaw, 0, sat(this.v / 13));
        w[1] += snowDepth(w[0], w[2]);
        for (let q = 0; q < 2; q++) Fx.spawn([w[0], w[1], w[2]], [(Math.random() - 0.5) * 1.6 + Math.cos(this.yaw) * this.v * 0.12, 0.7 + Math.random() * 1.3, (Math.random() - 0.5) * 1.6 + Math.sin(this.yaw) * this.v * 0.12], 0.45 + Math.random() * 0.4, 0.07 + Math.random() * 0.07, 4, 1);
      }
      Fx.kick(w, this.v, i, wet, snow);
      Sound.hoof(i, this.v, wet, snow);
      this.kick = Math.max(this.kick, sat((this.v - 6) / 10) * (i >= 2 ? 1 : 0.6));
    }
    // in cold air the breath shows: the horse's with every stride at speed, slower standing; the rider's now and then
    if (Env.cur.cold > 0.3) {
      this.breathT -= dt;
      const stride = this.v > 5 && Horse.phase > 0.45 && this.lastPh <= 0.45;
      if (stride || this.breathT <= 0) {
        if (!stride) this.breathT = 2.4 + Math.random();
        const f = Horse.f, n = Horse.toWorld(...Horse.A.nose);
        Fx.breath(n, [f[0] * 0.8 + this.v * f[0] * 0.08, -0.35, f[2] * 0.8 + this.v * f[2] * 0.08], stride ? 2 : 3);
        if (!stride && !V.fp) { const e = Horse.toWorld(...Horse.A.eye); Fx.breath([e[0] + f[0] * 0.06, e[1] - 0.07, e[2] + f[2] * 0.06], [f[0] * 0.5, -0.1, f[2] * 0.5], 1); }
      }
    }
    this.lastPh = Horse.phase;
    Hair.step(dt);
    Fx.step(dt);
    Sound.update(dt, this.v, Horse.phase, this.waterNear);
    this.camera(dt);
  },

  camera(dt) {
    const fast = smooth(6, 13, this.v), flat = sat((this.v - 12.5) / 4);
    const yawFollow = portraitRide ? 3.8 : 2.4;
    this.camYaw += wrapPi(this.yaw - this.camYaw) * (1 - Math.exp(-yawFollow * dt));
    this.blend = damp(this.blend, this.started ? 1 : 0, 0.9, dt);
    const o = this.orbit, V = this.views[this.view], b = this.blend;
    if (o.hold > 0) o.hold -= dt; else if (this.v > 0.5 && !(this.scripted && this.scripted.look)) { o.yaw = damp(o.yaw, 0, 1.6, dt); o.pitch = damp(o.pitch, 0, 1.6, dt); }
    this.kick = damp(this.kick, 0, 14, dt);
    let pos, tgt, fov, near = 0.25, up = [0, 1, 0];
    if (V.fp && b > 0.6) {
      // the rider's eyes: the head rides the horse's motion, eased a little, and the horizon tips with the lean
      const e = Horse.toWorld(...Horse.A.eye);
      this.eyeY = dt > 0 && Math.abs(this.eyeY - e[1]) < 0.6 ? damp(this.eyeY, e[1], 16, dt) : e[1];
      const ya = this.camYaw * 0.35 + this.yaw * 0.65 + o.yaw, pa = (portraitRide ? -0.15 : -0.30) - o.pitch * 0.9 + this.slope * 0.5;
      const dir = [Math.cos(ya) * Math.cos(pa), Math.sin(pa), Math.sin(ya) * Math.cos(pa)];
      pos = [e[0], this.eyeY, e[2]]; tgt = v3.add(pos, dir); fov = V.fov + 6 * flat; near = 0.09;
      up = v3.norm([Horse.u[0] * 0.55, 1, Horse.u[2] * 0.55]);
      this.camY = pos[1];
    } else {
      // The valley opens onto the sunlit peaks. The other trailheads show the horse in profile.
      const I = this.intro, titleAngle = Places.cur === 'valley' ? 0.71 : 2.22;
      const idleOff = portraitRide ? titleAngle + 0.12 * Math.sin(this.t * 0.13) : 1.9 + this.t * 0.07;
      const narrow = portraitRide ? clamp(0.45 / G.aspect, 1, 1.28) : 1;
      const off = lerp(idleOff, V.off || 0.66, b) + o.yaw;
      const d = narrow * lerp(I.d, (V.d || 5.4) * (1 + 0.14 * fast + 0.05 * flat), b), h = lerp(I.h, V.h || 1.75, b) + o.pitch * 5;
      const a = this.camYaw + off, p = Horse.pos, cy = Math.cos(this.camYaw), sy = Math.sin(this.camYaw);
      const ahead = lerp(I.ahead, V.ahead || 0, b), upo = lerp(I.up, V.up || 1.25, b);
      tgt = [p[0] + cy * ahead, p[1] + upo, p[2] + sy * ahead];
      const cx = p[0] - Math.cos(a) * d, cz = p[2] - Math.sin(a) * d;
      const gy = groundY(cx, cz), wantY = Math.max(p[1] + h, gy + 0.75);
      this.camY = dt > 0 ? damp(this.camY, wantY, 5, dt) : wantY;
      fov = lerp(I.fov, (V.fov || 48) + 8 * fast + 5 * flat, b);
      pos = [cx, Math.max(this.camY, gy + 0.6) - this.kick * 0.022, cz];
    }
    if (App.rel) {
      const q = App.rel, c2 = Horse.toWorld(0.15, q.ty, 0), dd = Horse.dirWorld(Math.sin(q.b), 0, Math.cos(q.b));
      pos = [c2[0] + dd[0] * q.d, c2[1] + q.h, c2[2] + dd[2] * q.d]; tgt = c2; fov = q.fov; near = 0.25; up = [0, 1, 0];
    }
    // how fast the camera itself is moving: the rain is drawn relative to it
    if (this.prevCam && dt > 0) {
      const k = 1 - Math.exp(-8 * dt);
      for (let i = 0; i < 3; i++) { const vv = clamp((pos[i] - this.prevCam[i]) / dt, -40, 40); this.camVel[i] += (vv - this.camVel[i]) * k; }
    }
    this.prevCam = pos.slice();
    G.rainFall = [G.windDir[0] * 2.8 * G.windK, -9.5, G.windDir[1] * 2.8 * G.windK];
    G.rainRel = [G.rainFall[0] - this.camVel[0], G.rainFall[1] - this.camVel[1], G.rainFall[2] - this.camVel[2]];
    setCamera(pos, tgt, fov, near, up);
  },
  state() { return { x: +this.x.toFixed(1), z: +this.z.toFixed(1), v: +this.v.toFixed(2), level: this.level, dist: Math.round(this.dist), phase: +Horse.phase.toFixed(3), scene: Env.name, view: this.views[this.view].name, place: Places.cur, h: +terrainH(this.x, this.z).toFixed(1) }; },
};

// ======== 14_ui.js
// Portrait title, riding controls and settings.
const UI = {
  elapsed: 0,
  hintTime: 0,
  toastTime: 0,
  init() {
    initPortraitWindow();
    const el = this.el = {};
    for (const id of ['title', 'hud', 'gait', 'hint', 'toast', 'goText', 'places', 'scenes', 'menuToggle', 'options', 'closeOptions', 'bPlace', 'bScene', 'bView', 'bSound', 'tFast', 'tSlow']) {
      el[id] = document.getElementById(id);
    }
    el.speed = document.querySelector('#speed b');
    el.dist = document.querySelector('#dist b');
    this.addChoices(el.places, Places.order, Places.list, 'p', key => Game.goto(key));
    this.addChoices(el.scenes, Env.order, SCENES, 's', key => { Env.span = 2.2; Env.set(key); });

    el.goText.textContent = '上马出发';
    el.goText.disabled = false;
    el.goText.addEventListener('click', () => this.start());
    el.menuToggle.addEventListener('click', () => this.setOptions(el.options.hidden));
    el.closeOptions.addEventListener('click', () => this.setOptions(false));
    el.bPlace.addEventListener('click', () => { const p = Game.goto(Places.next()); this.toast(p.label, p.sub); });
    el.bScene.addEventListener('click', () => { const s = Env.next(); this.toast(s.label, s.sub); });
    el.bView.addEventListener('click', () => this.toast(Game.nextView()));
    el.bSound.addEventListener('click', () => this.sound());
    el.tFast.addEventListener('click', () => {
      if (Game.level === 4) Game.sprint = !Game.sprint;
      else Game.faster();
      this.pace();
    });
    el.tSlow.addEventListener('click', () => { Game.sprint = false; Game.slower(); this.pace(); });

    // The first tap outside the settings only dismisses them, even on the canvas or a pace button.
    const outside = e => !el.options.hidden && !el.options.contains(e.target) && !el.menuToggle.contains(e.target);
    const block = e => { if (outside(e)) { e.stopPropagation(); e.preventDefault(); } };
    listenRideGlobal(document, 'pointerdown', block, true);
    listenRideGlobal(document, 'pointermove', block, true);
    listenRideGlobal(document, 'click', e => {
      if (!outside(e)) return;
      block(e);
      this.setOptions(false);
    }, true);
    listenRideGlobal(window, 'keydown', e => this.key(e), true);
    const visibility = hidden => {
      App.last = 0;
      const audio = Sound.ctx;
      if (audio && Game.started) (hidden ? audio.suspend() : audio.resume()).catch(() => {});
    };
    if (rideSession) rideSession.visibility = visibility;
    else listenRideGlobal(document, 'visibilitychange', () => visibility(document.hidden));
    this.mark();
    if (App.shots) el.title.hidden = true;
  },
  addChoices(group, keys, choices, attribute, choose) {
    for (const key of keys) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset[attribute] = key;
      button.textContent = choices[key].label;
      button.addEventListener('click', () => { choose(key); this.mark(); });
      group.appendChild(button);
    }
  },
  start() {
    if (Game.started) return;
    const el = this.el;
    el.title.hidden = true;
    el.hud.hidden = false;
    Game.start();
    Env.span = 5;
    canvas.tabIndex = -1;
    canvas.focus();
    el.hint.textContent = '按住画面向左或向右拖，松手直行';
    el.hint.classList.add('on');
    this.hintTime = 6;
    this.pace();
    Sound.start();
  },
  key(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const el = this.el;
    if (!Game.started) {
      if (e.key === 'Enter' && !e.repeat && !(e.target.closest && e.target.closest('button'))) {
        e.preventDefault();
        this.start();
      }
      e.stopPropagation();
      return;
    }
    if (el.options.hidden) {
      if (e.key.toLowerCase() === 'm' && !e.repeat) this.sound();
      return;
    }
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      this.setOptions(false);
    } else if (e.key === 'Tab') {
      const buttons = el.options.querySelectorAll('button');
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  },
  setOptions(open) {
    const el = this.el;
    el.options.hidden = !open;
    el.menuToggle.setAttribute('aria-expanded', String(open));
    if (open) {
      Game.keys.left = Game.keys.right = false;
      Game.touchSteer = 0;
      this.mark();
      el.closeOptions.focus();
    } else {
      el.menuToggle.focus();
    }
  },
  mark() {
    const el = this.el;
    for (const [group, key, current] of [[el.places, 'p', Places.cur], [el.scenes, 's', Env.name]]) {
      for (const button of group.children) {
        const active = button.dataset[key] === current;
        button.classList.toggle('on', active);
        button.setAttribute('aria-pressed', String(active));
      }
    }
    for (const [button, label, value] of [[el.bPlace, '地点', Places.list[Places.cur].label], [el.bScene, '天气', SCENES[Env.name].label], [el.bView, '视角', Game.views[Game.view].name], [el.bSound, '声音', Sound.on ? '开' : '关']]) {
      const field = button.querySelector('[data-value]');
      if (field) field.textContent = value;
      else button.textContent = label + '　' + value;
    }
  },
  sound() { Sound.toggle(); this.mark(); },
  toast(text, sub) {
    const toast = this.el.toast;
    toast.firstElementChild.textContent = text;
    toast.lastElementChild.textContent = sub || '';
    toast.classList.add('on');
    this.toastTime = sub ? 2.6 : 1.8;
    this.mark();
  },
  pace() {
    const fast = this.el.tFast;
    const label = Game.level < 4 ? '加速' : Game.sprint ? '收速' : '冲刺';
    if (this.lastPace === label) return;
    this.lastPace = label;
    const field = fast.querySelector('[data-label]') || fast;
    field.textContent = label;
    fast.setAttribute('aria-label', label === '收速' ? '结束冲刺' : label);
  },
  update(dt) {
    const el = this.el;
    if (this.hintTime > 0 && (this.hintTime -= dt) <= 0) el.hint.classList.remove('on');
    if (this.toastTime > 0 && (this.toastTime -= dt) <= 0) el.toast.classList.remove('on');
    this.elapsed += dt;
    if (!Game.started || this.elapsed < 0.1) return;
    this.elapsed = 0;
    const speed = String(Math.round(Game.v * 3.6)), dist = (Game.dist / 1000).toFixed(1), gait = Gait.name(Game.v) || '驻足';
    if (el.speed.textContent !== speed) el.speed.textContent = speed;
    if (el.dist.textContent !== dist) el.dist.textContent = dist;
    if (el.gait.textContent !== gait) el.gait.textContent = gait;
    this.pace();
  },
};

// ======== 99_main.js
// ---------------------------------------------------------------- the frame
const App = {
  quality: clamp(Math.round(qnum('q', portraitRide ? 0 : 2)), 0, 2), shots: QS.has('shots'), fade: 0, last: 0, slow: 0, scale: 1, dens: 1,
};

function resize() {
  const cap = (portraitRide && App.quality === 0 ? 1.25 : [1, 1.25, 1.6][App.quality]) * App.scale;
  // however large the window, no more pixels than this are drawn: a full screen on a dense display would be five million otherwise
  const budget = [1.0e6, 1.5e6, 2.1e6][App.quality] * App.scale * App.scale;
  const cssWidth = portraitRide ? canvas.clientWidth : innerWidth;
  const cssHeight = portraitRide ? canvas.clientHeight : innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, cap, Math.sqrt(budget / Math.max(1, cssWidth * cssHeight)));
  const w = Math.max(2, Math.round(cssWidth * dpr)), h = Math.max(2, Math.round(cssHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  Post.resize(w, h);
  G.aspect = w / h;
}

function setCamera(pos, tgt, fovDeg, near, up) {
  const fov = fovDeg * D2R, view = m4.lookAt(pos, tgt, up || [0, 1, 0]);
  const proj = m4.perspective(fov, G.aspect, near || 0.25, 9000);
  G.vp = m4.mul(proj, view); G.cam = pos; G.tanHalf = Math.tan(fov / 2);
  G.camR = [view[0], view[4], view[8]]; G.camU = [view[1], view[5], view[9]]; G.camF = [-view[2], -view[6], -view[10]];
}

function render() {
  Horse.shadowPass();
  Trees.update();
  Shade.render();
  Trail.render();
  Post.begin();
  gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND);
  Sky.draw();
  Mount.draw();
  // what stands on the ground first, the ground itself last: most of it is hidden behind grass, trees and houses, and its shading,
  // the costliest there is, is then not done for what cannot be seen
  Camp.draw();
  Village.draw();
  Herd.draw();
  People.draw();
  Swans.draw();
  Horse.draw();
  Hair.draw();
  Trees.draw();
  Grass.draw();
  Terrain.draw();
  Smoke.draw();
  Fx.draw();
  Post.end(App.fade);
}

function tick(dt) {
  G.time += dt; G.windT += dt * (0.6 + 0.4 * G.windK);
  Env.update(dt);
  if (!App.freeCam) { Game.step(dt); Trail.update(dt, Game); }
  else {
    // a still stage for looking at the horse: it runs on the spot
    Horse.update(dt, App.dbgV || 0, {}); G.horse = Horse.pos; Hair.step(dt); Fx.step(dt);
    Herd.update(dt, Game); People.update(dt, Game);
    setCamera(App.dbgPos, App.dbgTgt, App.dbgFov || 60);
  }
  UI.update(dt);
}

function nextRideFrame(fn) {
  if (rideSession) rideSession.frame(fn);
  else requestAnimationFrame(fn);
}

function frame(now) {
  const raw = App.last ? (now - App.last) / 1000 : 0.016, dt = clamp(raw, 0.001, 0.05); App.last = now;
  App.ms = lerp(App.ms || 16, raw * 1000, 0.05);
  resize();
  if (!App.shots) {
    tick(dt);
    App.fade = Math.min(1, App.fade + dt * 0.8);
    render();
    if (portraitRide && !App.sceneReady && App.fade >= 0.92) {
      App.sceneReady = true;
      document.documentElement.classList.add('scene-ready');
    }
    // hold the frame rate: draw smaller if the machine cannot keep up
    if (rideSession && rideSession.sample(raw, App.fade >= 1 && App.scale <= 0.55 && App.dens <= 0.5)) return;
    if (App.ms > (portraitRide ? 34 : 19.5)) App.slow += rideSession ? Math.min(raw, 0.25) : dt; else App.slow = Math.max(0, App.slow - dt * 0.5);
    // too slow: the cost is nearly all in the pixels, so first draw a little smaller, then thin the grass, then smaller again
    if (App.slow > 1.2 && App.fade >= 1) {
      if (App.scale > 0.80) App.scale *= 0.88; else if (App.dens > 0.5) App.dens *= 0.82; else if (App.scale > 0.55) App.scale *= 0.88;
      App.slow = 0; App.ms = 16.7;
    }
  }
  nextRideFrame(frame);
}

function boot() {
  // the shadow of horse and rider; cleared to "nothing in the way" until they exist
  const light = portraitRide && App.quality === 0;
  if (light) {
    Post.samples = 2;
    Post.bloomLevels = 4;
    Trail.N = 1024;
  }
  App.shadow = makeShadow(light ? 1024 : 2048); G.shadowTex = App.shadow.tex;
  gl.bindFramebuffer(gl.FRAMEBUFFER, App.shadow.fb); gl.clearDepth(1); gl.clear(gl.DEPTH_BUFFER_BIT);
  Env.init(); if (QS.get('scene')) Env.set(QS.get('scene'), true); Env.update(0);
  Sky.init(); Mount.init(); Terrain.init(); Grass.init(App.quality); Post.init();
  Shade.init(); Places.init(); Trees.init(); Camp.init(); Village.init(); Smoke.init(); Swans.init(Places.shore); Horse.init(); Herd.init(); People.init(); Hair.init(); Fx.init(); Trail.init(); Game.init(); UI.init();
  resize();
  // for scripts and screenshots: step the world by hand
  window.__ride = {
    ready: true,
    sim(sec, input) { const n = Math.round(sec * 60); resize(); for (let i = 0; i < n; i++) { if (input && !App.freeCam) Game.script(input); tick(1 / 60); } App.fade = 1; render(); return this.state(); },
    cam(pos, tgt, fov) { App.freeCam = true; App.dbgPos = pos; App.dbgTgt = tgt; App.dbgFov = fov; },
    ride() { App.freeCam = false; App.rel = null; },
    // while riding, watch from a fixed place beside the horse: bearing in degrees (0 = from its right), distance, height, the height looked at
    watch(bearing, dist, height, ty, fov) { App.freeCam = false; App.rel = bearing === undefined ? null : { b: bearing * D2R, d: dist || 4, h: height || 0.3, ty: ty || 1.4, fov: fov || 40 }; },
    // pose the horse on the spot: phase 0..1 of the stride at speed v, seen from a bearing (degrees, 0 = from its right side)
    pose(phase, v, bearing, dist, height, fov, ty) {
      App.freeCam = true; App.dbgV = v; Horse.phase = phase; Horse.update(0, v, {});
      const b = (bearing || 0) * D2R, d = dist || 5.5, c = Horse.toWorld(0.15, ty || 1.15, 0);
      App.dbgPos = [c[0] + Math.sin(b) * d, c[1] + (height === undefined ? 0.2 : height), c[2] + Math.cos(b) * d]; App.dbgTgt = c; App.dbgFov = fov || 40;
      setCamera(App.dbgPos, App.dbgTgt, App.dbgFov); App.fade = 1; resize(); render(); return 1;
    },
    sun(elevDeg, azim) { Env.cur.sunElev = elevDeg; if (azim !== undefined) Env.cur.sunAz = azim; },
    scene(name) { Env.set(name, true); Env.update(0); return name; },
    place(key, weather) { Game.goto(key); if (weather) Env.set(weather, true); Env.update(0); App.fade = 1; return key; },
    state() { return Game.state(); },
    gpu() { const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; },
    G, App,
  };
  nextRideFrame(frame);
}
if (rideSession) {
  rideSession.snapshot = () => ({
    started: Game.started, place: Places.cur, scene: Env.name, dist: Game.dist,
    level: Game.level, speed: Game.v, sprint: Game.sprint, yaw: Game.yaw, view: Game.view, muted: !Sound.on,
  });
  rideSession.release = () => {
    if (Sound.ctx && Sound.ctx.state !== 'closed') Sound.ctx.close().catch(() => {});
    if (!gl.isContextLost()) {
      const ext = gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
    }
  };
}
function startApp() {
  if (rideSession) { boot(); return; }
  try { boot(); } catch (e) {
    console.error(e);
    const el = document.getElementById('err'); el.style.display = 'flex'; el.textContent = '启动失败：' + e.message;
  }
}
if (portraitRide) nextRideFrame(() => nextRideFrame(startApp));
else startApp();

}
runWindhoofMiniTool(startWindhoof3D);