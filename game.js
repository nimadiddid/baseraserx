"use strict";

const BASE_CHAIN_ID  = 8453;
const BASE_RPC       = "https://api.developer.coinbase.com/rpc/v1/base/bc_otm6g9zw";
const BASE_CHAIN_HEX = "0x" + BASE_CHAIN_ID.toString(16);
const BASESCAN        = "https://basescan.org";
const SCORE_PER_SEC  = 5;
const LANE_COUNT     = 5;
const BASE_SPEED     = 220;
const SPEED_STEP     = 35;
const SPAWN_BASE     = 1.6;

const CONTRACT_ABI = [
  { name:"submitScore", type:"function", stateMutability:"nonpayable",
    inputs:[{name:"points",type:"uint256"},{name:"timeSeconds",type:"uint256"}], outputs:[] },
  { name:"bestScore", type:"function", stateMutability:"view",
    inputs:[{name:"player",type:"address"}],
    outputs:[{name:"points",type:"uint256"},{name:"timeSeconds",type:"uint256"},
             {name:"timestamp",type:"uint256"},{name:"gameNumber",type:"uint256"}] },
  { name:"gamesPlayed", type:"function", stateMutability:"view",
    inputs:[{name:"player",type:"address"}], outputs:[{name:"",type:"uint256"}] },
  { name:"getLeaderboard", type:"function", stateMutability:"view",
    inputs:[{name:"n",type:"uint256"}],
    outputs:[{name:"addrs",type:"address[]"},{name:"points",type:"uint256[]"},{name:"times",type:"uint256[]"}] },
  { name:"ScoreSubmitted", type:"event",
    inputs:[{name:"player",type:"address",indexed:true},{name:"points",type:"uint256",indexed:false},
            {name:"timeSeconds",type:"uint256",indexed:false},{name:"gameNumber",type:"uint256",indexed:false},
            {name:"isNewBest",type:"bool",indexed:false}] }
];


const SHARED_CONTRACT_ADDR = "0xc3E7eFb7b54Fae4d43FC6A63bA77c31394bc1a06";

let wallet       = null;
let contract     = null;

let score        = 0;
let elapsed      = 0;
let gameRunning  = false;
let gamePaused   = false;
let bestScore    = 0;
let gamesPlayed  = 0;
let lastTs       = 0;
let playerX, playerY, playerW, playerH;
let lanes        = [];
let opponents    = [];
let spawnTimer   = 0;
let roadOffset   = 0;
let bgOffset     = 0;
let currentSpeed = BASE_SPEED;
let speedLevel   = 0;
let flashTimer   = 0;
let shakeMag     = 0;
let particles    = [];
let speedBoostSmoke = 0;  

let canvas, ctx, hudScore, hudTime, healthBar;

function grabRefs() {
  canvas    = document.getElementById("game-canvas");
  ctx       = canvas.getContext("2d");
  hudScore  = document.getElementById("hud-score");
  hudTime   = document.getElementById("hud-time");
  healthBar = document.getElementById("health-bar");
}

function syncWallet() {
  if (!wallet && window._walletSigner && window._walletAddress) {
    wallet = { address: window._walletAddress, signer: window._walletSigner, provider: window._walletProvider };
  }
}

(function buildSpeedLines() {
  const wrap = document.getElementById("speedlines");
  if (!wrap) return;
  for (let i = 0; i < 20; i++) {
    const d = document.createElement("div");
    d.style.cssText = `position:absolute;left:${Math.random()*100}%;top:0;width:1px;height:${25+Math.random()*55}px;background:linear-gradient(180deg,transparent,rgba(0,82,255,.45),transparent);animation:fall ${.35+Math.random()*.65}s ${-Math.random()}s linear infinite;`;
    wrap.appendChild(d);
  }
  const s = document.createElement("style");
  s.textContent = `@keyframes fall{from{top:-80px}to{top:110%}}`;
  document.head.appendChild(s);
})();

function ensureContract() {
  if (contract) return contract;
  if (!wallet) return null;
  contract = new ethers.Contract(SHARED_CONTRACT_ADDR, CONTRACT_ABI, wallet.signer);
  return contract;
}

async function submitScoreOnChain(points, secs) {
  if (!wallet) return;

  const txEl   = document.getElementById("tx-status");
  const doneEl = document.getElementById("tx-done");
  const msgEl  = document.getElementById("tx-msg");
  const linkEl = document.getElementById("tx-link");

  const show = txt => { if (msgEl) msgEl.textContent = txt; if (txEl) txEl.classList.remove("hidden"); };
  const hide = ()  => { if (txEl) txEl.classList.add("hidden"); };

  if (doneEl) doneEl.classList.add("hidden");
  show(contract ? "Deploying on Base — confirm in wallet…" : "Deploying contract on Base…");

  try {
    const c = await ensureContract();
    if (!c) { show("Deploy failed — open console for details."); setTimeout(hide, 5000); return; }

    show("Submitting score on Base — confirm in wallet…");
    const tx = await c.submitScore(BigInt(points), BigInt(secs));
    show("Waiting for confirmation…");
    const receipt = await tx.wait(1);

    hide();
    if (doneEl) doneEl.classList.remove("hidden");
    const txHash = receipt?.hash ?? tx.hash;
    if (linkEl && txHash) {
      linkEl.href        = `${BASESCAN}/tx/${txHash}`;
      linkEl.textContent = `Tx: ${txHash.slice(0,8)}...${txHash.slice(-6)}`;
    }

  } catch(err) {
    console.error("submitScoreOnChain:", err);
    const msg = err?.message || "";
    const code = err?.code || "";
    if (code === 4001 || code === "ACTION_REJECTED" || /denied|rejected/i.test(msg)) {
      show("Rejected by user."); setTimeout(hide, 3000);
    } else if (/estimateGas|revert|missing revert/i.test(msg)) {
      contract = null;
      show("Contract error. Try again."); setTimeout(hide, 4000);
    } else {
      show("Failed: " + (msg.slice(0, 80) || "unknown error")); setTimeout(hide, 6000);
    }
  }
}

const storeKey = a => "br_" + a.toLowerCase();
function loadData() {
  if (!wallet) return;
  try {
    const d = JSON.parse(localStorage.getItem(storeKey(wallet.address)) || "{}");
    bestScore   = d.b || 0;
    gamesPlayed = d.g || 0;
  } catch {}
}
function saveData() {
  if (!wallet) return;
  localStorage.setItem(storeKey(wallet.address), JSON.stringify({ b: bestScore, g: gamesPlayed }));
}

function resize() {
  if (!canvas) return;
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  const lw = canvas.width / LANE_COUNT;
  lanes    = Array.from({length: LANE_COUNT}, (_, i) => ({ x: i*lw, cx: i*lw+lw/2, w: lw }));
  playerW  = lw * 0.54;
  playerH  = playerW * 1.9;
  playerX  = lanes[Math.floor(LANE_COUNT/2)].cx - playerW/2;
  playerY  = canvas.height - playerH - 55;
}
window.addEventListener("resize", resize);

const keys = { left: false, right: false };
window.addEventListener("keydown", e => {
  if (e.key==="ArrowLeft"  || e.key==="a" || e.key==="A") keys.left  = true;
  if (e.key==="ArrowRight" || e.key==="d" || e.key==="D") keys.right = true;
});
window.addEventListener("keyup", e => {
  if (e.key==="ArrowLeft"  || e.key==="a" || e.key==="A") keys.left  = false;
  if (e.key==="ArrowRight" || e.key==="d" || e.key==="D") keys.right = false;
});
let tx0 = null;
document.addEventListener("touchstart", e => {
  if (!gameRunning) return;
  tx0 = e.touches[0].clientX;
}, { passive: true });
document.addEventListener("touchmove", e => {
  if (!gameRunning || tx0 === null) return;
  const dx = e.touches[0].clientX - tx0;
  if (Math.abs(dx) > 8) { keys.left = dx < 0; keys.right = dx > 0; }
}, { passive: true });
document.addEventListener("touchend", () => { keys.left = keys.right = false; tx0 = null; });

function spawnParticle(x, y, type) {
  const base = type === "smoke"
    ? { vx:(Math.random()-.5)*30, vy:-20-Math.random()*40, life:1.2, maxLife:1.2, size:4+Math.random()*6, color:"200,200,200" }
    : { vx:(Math.random()-.5)*80, vy:-60-Math.random()*60, life:.6,  maxLife:.6,  size:2+Math.random()*4, color:"255,160,40"  };
  particles.push({ ...base, x: x+(Math.random()-.5)*8, y, type });
}

function spawnBoostSmoke(x, y) {
  particles.push({
    x: x + (Math.random()-.5)*10,
    y,
    vx: (Math.random()-.5)*20,
    vy: 60 + Math.random()*80,   
    life: 0.7, maxLife: 0.7,
    size: 5 + Math.random()*7,
    color: "180,180,255",         
    type: "smoke"
  });
}
function updateParticles(dt) {
  for (const p of particles) { p.x += p.vx*dt; p.y += p.vy*dt; p.vy += 40*dt; p.life -= dt; }
  particles = particles.filter(p => p.life > 0);
}
function drawParticles() {
  for (const p of particles) {
    const a = p.life/p.maxLife, s = p.size*a;
    ctx.save(); ctx.globalAlpha = a*.85; ctx.fillStyle = `rgb(${p.color})`;
    if (p.type === "smoke") {
      ctx.shadowColor = `rgba(${p.color},.3)`; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.arc(p.x, p.y, s, 0, Math.PI*2); ctx.fill();
    } else {
      ctx.fillStyle = `rgba(${p.color},${a})`; ctx.fillRect(p.x-s/2, p.y-s/2, s, s);
    }
    ctx.restore();
  }
}

async function startGame() {
  grabRefs();
  syncWallet();
  loadData();


  score        = 0;
  elapsed      = 0;
  roadOffset   = 0;
  bgOffset     = 0;
  opponents    = [];
  particles    = [];
  spawnTimer   = 0;
  currentSpeed = BASE_SPEED;
  speedLevel   = 0;
  flashTimer   = 0;
  shakeMag     = 0;
  speedBoostSmoke = 0;
  gameRunning  = true;
  lastTs       = performance.now();

  requestAnimationFrame(() => {
    resize();
    updateHUD();
    requestAnimationFrame(tick);
  });
}

function tick(ts) {
  if (!gameRunning) return;
  if (gamePaused) { lastTs = ts; requestAnimationFrame(tick); return; }
  const dt = Math.min((ts - lastTs) / 1000, .1);
  lastTs = ts;
  elapsed += dt;
  score   += SCORE_PER_SEC * dt;

  const newLevel = Math.floor(elapsed / 10);
  if (newLevel > speedLevel) {
    speedLevel   = newLevel;
    currentSpeed = BASE_SPEED + speedLevel * SPEED_STEP;
    flashTimer   = 2.0;
    speedBoostSmoke = 1.0;  
  }
  if (flashTimer > 0) flashTimer -= dt;
  if (shakeMag   > 0) shakeMag = Math.max(0, shakeMag - 80*dt);
  if (speedBoostSmoke > 0) speedBoostSmoke -= dt;

  roadOffset = (roadOffset + currentSpeed*dt) % 120;
  bgOffset   = (bgOffset   + currentSpeed*.15*dt) % canvas.height;

  const ps = currentSpeed * 1.6;
  if (keys.left)  playerX = Math.max(0,                   playerX - ps*dt);
  if (keys.right) playerX = Math.min(canvas.width-playerW, playerX + ps*dt);

  const interval = Math.max(.35, SPAWN_BASE - speedLevel*.08);
  spawnTimer += dt;
  if (spawnTimer >= interval) { spawnTimer = 0; spawnOpponent(); }

  for (const op of opponents) {
    op.y += op.speed * dt;
  }
  opponents = opponents.filter(op => op.y < canvas.height + 50);
  updateParticles(dt);

  
  if (speedBoostSmoke > 0) {
    if (Math.random() < .4) spawnBoostSmoke(playerX+playerW*.2, playerY+playerH*.88);
    if (Math.random() < .4) spawnBoostSmoke(playerX+playerW*.8, playerY+playerH*.88);
  }

  let crashed = false;
  for (const op of opponents) {
    if (overlap(playerX+5, playerY+8, playerW-10, playerH-14, op.x+5, op.y+8, op.w-10, op.h-14)) {
      crashed = true;
      for (let i = 0; i < 28; i++) spawnParticle(playerX+playerW/2, playerY+playerH/2, "spark");
      shakeMag = 18; break;
    }
  }

  render();
  updateHUD();
  if (crashed) { gameRunning = false; setTimeout(endGame, 400); return; }
  requestAnimationFrame(tick);
}

function overlap(ax,ay,aw,ah,bx,by,bw,bh) {
  return ax < bx+bw && ax+aw > bx && ay < by+bh && ay+ah > by;
}

const CAR_PALETTES = [
  { body:"#C0181A", dark:"#7A0C0E", accent:"#FF4444", rim:"#DDDDDD", light:"#FF6666" },
  { body:"#156E16", dark:"#0A3C0A", accent:"#22CC22", rim:"#CCCCCC", light:"#44FF44" },
  { body:"#C07010", dark:"#7A4508", accent:"#FF9922", rim:"#DDDDDD", light:"#FFBB44" },
  { body:"#7B1FA2", dark:"#4A0070", accent:"#CC44FF", rim:"#CCCCCC", light:"#DD88FF" },
  { body:"#006B8F", dark:"#003E55", accent:"#00CCFF", rim:"#DDDDDD", light:"#44DDFF" },
  { body:"#B8860B", dark:"#7A5808", accent:"#FFD700", rim:"#CCCCCC", light:"#FFEE44" },
  { body:"#1A237E", dark:"#0D0D4A", accent:"#5C6BC0", rim:"#DDDDDD", light:"#8899FF" },
  { body:"#880E4F", dark:"#4A0528", accent:"#F06292", rim:"#DDDDDD", light:"#FF88BB" },
];

function spawnOpponent() {
  const lane    = lanes[Math.floor(Math.random() * LANE_COUNT)];
  const palette = CAR_PALETTES[Math.floor(Math.random() * CAR_PALETTES.length)];
  opponents.push({
    x: lane.cx - playerW/2, y: -playerH - Math.random()*60,
    w: playerW, h: playerH,
    speed: currentSpeed * (.55 + Math.random()*.75),
    palette
  });
}

function render() {
  const W = canvas.width, H = canvas.height;
  ctx.save();
  if (shakeMag > 0) ctx.translate((Math.random()-.5)*shakeMag, (Math.random()-.5)*shakeMag*.6);
  drawBackground(W, H);
  drawRoad(W, H);
  drawParticles();
  for (const op of opponents) {
    drawCarShadow(op.x, op.y, op.w, op.h);
    drawCar(op.x, op.y, op.w, op.h, op.palette, false);
  }
  drawCarShadow(playerX, playerY, playerW, playerH);
  drawCar(playerX, playerY, playerW, playerH,
    { body:"#0D2B6E", dark:"#060F2C", accent:"#0052FF", rim:"#A0C4FF", light:"#60A5FA" }, true);
  if (flashTimer > 0) {
    const a = Math.min(.4, flashTimer*.22) * (flashTimer > 1.5 ? 1 : flashTimer/1.5);
    ctx.fillStyle = `rgba(0,100,255,${a})`; ctx.fillRect(0, 0, W, H);
    if (flashTimer > 1.2) {
      ctx.save();
      ctx.font = `bold ${Math.floor(W*.058)}px 'Segoe UI',sans-serif`;
      ctx.textAlign = "center"; ctx.shadowColor = "#0052FF"; ctx.shadowBlur = 30;
      ctx.fillStyle = "#FFFFFF"; ctx.fillText("⚡  SPEED UP!", W/2, H*.2);
      ctx.restore();
    }
  }
  ctx.restore();
}

function drawBackground(W, H) {
  const sky = ctx.createLinearGradient(0, 0, 0, H*.22);
  sky.addColorStop(0, "#050A1E"); sky.addColorStop(.6, "#071030"); sky.addColorStop(1, "#0A1840");
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H*.22);
  ctx.save(); ctx.fillStyle = "#060D22";
  const buildings = [[0,.85],[.04,.6],[.07,.75],[.10,.55],[.14,.80],[.18,.65],[.22,.5],[.26,.70],[.30,.6],[.35,.45],[.40,.68],[.44,.58],[.48,.72],[.52,.52],[.56,.65],[.60,.48],[.65,.72],[.70,.6],[.74,.55],[.78,.7],[.82,.62],[.86,.5],[.90,.73],[.94,.6],[.97,.8],[1,.85]];
  const BH = H*.22;
  ctx.beginPath(); ctx.moveTo(0, BH);
  for (const [bx, bh] of buildings) ctx.lineTo(bx*W, BH*(1-bh*.4));
  ctx.lineTo(W, BH); ctx.closePath(); ctx.fill();
  for (let i = 0; i < 60; i++) {
    const wx = (i*137.5) % W, wy = BH*.1 + (i*53.7) % (BH*.55);
    const alpha = .3 + .5*Math.abs(Math.sin(elapsed*1.3+i));
    ctx.fillStyle = `rgba(${[[0,120,255],[255,200,0],[0,220,180],[180,80,255]][i%4].join(",")},${alpha})`;
    ctx.fillRect(wx, wy, 2, 3);
  }
  ctx.restore();
  const hg = ctx.createLinearGradient(0, H*.18, 0, H*.28);
  hg.addColorStop(0, "rgba(0,60,160,.55)"); hg.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = hg; ctx.fillRect(0, H*.18, W, H*.12);
}

function drawRoad(W, H) {
  const asph = ctx.createLinearGradient(0, 0, W, 0);
  asph.addColorStop(0, "#161618"); asph.addColorStop(.08, "#1E1E22"); asph.addColorStop(.5, "#222226");
  asph.addColorStop(.92, "#1E1E22"); asph.addColorStop(1, "#161618");
  ctx.fillStyle = asph; ctx.fillRect(0, H*.20, W, H*.80);
  const sheen = ctx.createLinearGradient(0, H*.20, 0, H);
  sheen.addColorStop(0, "rgba(0,50,120,.12)"); sheen.addColorStop(.35, "rgba(0,30,80,.05)"); sheen.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = sheen; ctx.fillRect(0, H*.20, W, H*.80);
  const laneW = W/LANE_COUNT, rw = laneW*.10, blockH = 28;
  for (let y = -(roadOffset % blockH); y < H; y += blockH) {
    const odd = Math.floor(y/blockH) % 2 === 0;
    ctx.fillStyle = odd ? "rgba(230,30,30,.90)" : "rgba(245,245,245,.90)"; ctx.fillRect(0, y, rw, blockH-1);
    ctx.fillStyle = odd ? "rgba(245,245,245,.90)" : "rgba(230,30,30,.90)"; ctx.fillRect(W-rw, y, rw, blockH-1);
  }
  ctx.strokeStyle = "#E8E8E8"; ctx.lineWidth = 3.5; ctx.setLineDash([]);
  ctx.beginPath(); ctx.moveTo(rw, 0); ctx.lineTo(rw, H); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(W-rw, 0); ctx.lineTo(W-rw, H); ctx.stroke();
  const cx = W/2;
  ctx.strokeStyle = "#FFD740"; ctx.lineWidth = 2.5;
  [-4.5, 4.5].forEach(off => { ctx.beginPath(); ctx.moveTo(cx+off, 0); ctx.lineTo(cx+off, H); ctx.stroke(); });
  ctx.fillStyle = "rgba(180,130,0,.25)"; ctx.fillRect(cx-4.5, 0, 9, H);
  const dashH = 120*.52, gapH = 120 - dashH;
  ctx.strokeStyle = "rgba(230,230,230,.78)"; ctx.lineWidth = 2; ctx.setLineDash([dashH, gapH]);
  for (let i = 1; i < LANE_COUNT; i++) {
    const lx = i * laneW;
    if (Math.abs(lx-cx) < 8) continue;
    ctx.lineDashOffset = -roadOffset; ctx.beginPath(); ctx.moveTo(lx, 0); ctx.lineTo(lx, H); ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.strokeStyle = "rgba(255,255,255,.28)"; ctx.lineWidth = 1;
  for (let y = -(roadOffset % 140); y < H; y += 140) {
    ctx.beginPath(); ctx.moveTo(rw+2, y); ctx.lineTo(rw+16, y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(W-rw-2, y); ctx.lineTo(W-rw-16, y); ctx.stroke();
  }
  
  ctx.strokeStyle = "rgba(255,255,255,.55)";
  ctx.lineWidth = 2.5;
  const markH = 22, markGap = 80;
  const markOff = roadOffset % markGap;
  for (let i = 0; i < LANE_COUNT; i++) {
    const lx = lanes[i].cx;
    for (let y = markOff - markGap; y < H + markH; y += markGap) {
      ctx.beginPath(); ctx.moveTo(lx, y); ctx.lineTo(lx, y + markH); ctx.stroke();
    }
  }
  const fog = ctx.createLinearGradient(0, H*.20, 0, H*.38);
  fog.addColorStop(0, "rgba(5,10,30,.75)"); fog.addColorStop(1, "rgba(5,10,30,0)");
  ctx.fillStyle = fog; ctx.fillRect(0, H*.20, W, H*.20);
  const vig = ctx.createLinearGradient(0, 0, W, 0);
  vig.addColorStop(0, "rgba(0,0,0,.45)"); vig.addColorStop(.08, "rgba(0,0,0,0)");
  vig.addColorStop(.92, "rgba(0,0,0,0)"); vig.addColorStop(1, "rgba(0,0,0,.45)");
  ctx.fillStyle = vig; ctx.fillRect(0, 0, W, H);
}

function drawCarShadow(x, y, w, h) {
  ctx.save();
  const cx = x + w/2;
  const grad = ctx.createRadialGradient(cx, y+h*.92, 0, cx, y+h*.92, w*.72);
  grad.addColorStop(0, "rgba(0,0,0,.55)"); grad.addColorStop(.6, "rgba(0,0,0,.20)"); grad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = grad; ctx.scale(1, .32);
  ctx.beginPath(); ctx.ellipse(cx, (y+h*.92)/.32, w*.72, h*.38, 0, 0, Math.PI*2); ctx.fill();
  ctx.restore();
}

function drawCar(x, y, w, h, pal, isPlayer) {
  const cx = x + w/2;
  ctx.save();
  function poly(pts, style) {
    ctx.fillStyle = style; ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath(); ctx.fill();
  }
  function polyStroke(pts, style, lw) {
    ctx.strokeStyle = style; ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath(); ctx.stroke();
  }
  const X = f => cx + f*w, Y = f => y + f*h;

  const jetColor = isPlayer ? pal.accent : pal.light;
  for (const jx of [X(-.18), X(.18)]) {
    const jLen = h * (.10 + Math.random()*.06);
    const jg = ctx.createLinearGradient(jx, Y(1), jx, Y(1)+jLen);
    jg.addColorStop(0, hexA(jetColor, .95)); jg.addColorStop(.45, hexA(jetColor, .5)); jg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = jg; ctx.beginPath(); ctx.ellipse(jx, Y(1)+jLen*.4, w*.055, jLen*.55, 0, 0, Math.PI*2); ctx.fill();
  }

  const tw = w*.24, th = h*.175, txOff = -tw*.08;
  [[x+txOff, y+h*.07], [x+w-txOff-tw, y+h*.07], [x+txOff, y+h*.72], [x+w-txOff-tw, y+h*.72]]
    .forEach(([tx, ty]) => drawWheel(tx, ty, tw, th, pal));

  const rwy = Y(.77);
  const rwg = ctx.createLinearGradient(X(0), rwy, X(0), rwy+h*.06);
  rwg.addColorStop(0, lighten(pal.body, .1)); rwg.addColorStop(1, pal.dark);
  poly([[X(-.56),rwy+h*.055],[X(-.56),rwy+h*.015],[X(-.22),rwy],[X(.22),rwy],
        [X(.56),rwy+h*.015],[X(.56),rwy+h*.055],[X(.22),rwy+h*.042],[X(-.22),rwy+h*.042]], rwg);
  ctx.fillStyle = pal.dark;
  ctx.fillRect(X(-.155), rwy+h*.042, w*.06, h*.038);
  ctx.fillRect(X(.095),  rwy+h*.042, w*.06, h*.038);
  ctx.fillStyle = pal.accent; ctx.globalAlpha = .55;
  ctx.fillRect(X(-.50), rwy+h*.022, w*1.0, h*.016); ctx.globalAlpha = 1;
  poly([[X(-.56),rwy+h*.015],[X(-.56),rwy+h*.065],[X(-.50),rwy+h*.065],[X(-.50),rwy+h*.015]], pal.dark);
  poly([[X(.50),rwy+h*.015],[X(.50),rwy+h*.065],[X(.56),rwy+h*.065],[X(.56),rwy+h*.015]], pal.dark);

  const podFY = Y(.24), podRY = Y(.76);
  const piFL = X(-.20), piRL = X(-.24), poFL = X(-.46), poRL = X(-.50);
  const plg = ctx.createLinearGradient(poFL, 0, piFL, 0);
  plg.addColorStop(0, pal.dark); plg.addColorStop(.4, pal.body); plg.addColorStop(.85, lighten(pal.body, .18)); plg.addColorStop(1, pal.body);
  poly([[piFL,podFY],[poFL,podFY+h*.04],[poRL,podRY],[piRL,podRY]], plg);
  poly([[poFL,podFY+h*.04],[poFL,podFY+h*.10],[poRL,podRY+h*.028],[poRL,podRY]], pal.dark);
  poly([[poFL+w*.03,podFY+h*.05],[poFL+w*.03,podFY+h*.14],[poFL+w*.10,podFY+h*.14],[poFL+w*.12,podFY+h*.05]], "rgba(0,0,0,.75)");
  const piFR = X(.20), piRR = X(.24), poFR = X(.46), poRR = X(.50);
  const prg = ctx.createLinearGradient(piFR, 0, poFR, 0);
  prg.addColorStop(0, pal.body); prg.addColorStop(.15, lighten(pal.body, .18)); prg.addColorStop(.6, pal.body); prg.addColorStop(1, pal.dark);
  poly([[piFR,podFY],[poFR,podFY+h*.04],[poRR,podRY],[piRR,podRY]], prg);
  poly([[poFR,podFY+h*.04],[poFR,podFY+h*.10],[poRR,podRY+h*.028],[poRR,podRY]], pal.dark);
  poly([[poFR-w*.03,podFY+h*.05],[poFR-w*.03,podFY+h*.14],[poFR-w*.10,podFY+h*.14],[poFR-w*.12,podFY+h*.05]], "rgba(0,0,0,.75)");

  const bRW = w*.28, bMW = w*.25, bFW = w*.13, bNT = w*.035;
  const fp = [[cx-bRW,Y(.74)],[cx-bMW,Y(.44)],[cx-bFW,Y(.16)],[cx-bNT,Y(.01)],
              [cx+bNT,Y(.01)],[cx+bFW,Y(.16)],[cx+bMW,Y(.44)],[cx+bRW,Y(.74)]];
  const fg = ctx.createLinearGradient(cx-bRW, 0, cx+bRW, 0);
  fg.addColorStop(0, pal.dark); fg.addColorStop(.18, pal.body); fg.addColorStop(.42, lighten(pal.body, .30));
  fg.addColorStop(.55, lighten(pal.body, .15)); fg.addColorStop(.75, pal.body); fg.addColorStop(1, pal.dark);
  poly(fp, fg);
  ctx.save(); ctx.globalAlpha = .28; polyStroke(fp, lighten(pal.body, .55), 1); ctx.globalAlpha = 1; ctx.restore();
  poly([[cx-bRW,Y(.74)],[cx-bMW,Y(.44)],[cx-bFW,Y(.16)],[cx-w*.20,Y(.16)],[cx-w*.18,Y(.44)],[cx-w*.22,Y(.74)]], "rgba(0,0,0,.18)");
  poly([[cx+bRW,Y(.74)],[cx+bMW,Y(.44)],[cx+bFW,Y(.16)],[cx+w*.20,Y(.16)],[cx+w*.18,Y(.44)],[cx+w*.22,Y(.74)]], "rgba(0,0,0,.18)");
  const sg = ctx.createLinearGradient(0, Y(.01), 0, Y(.74));
  sg.addColorStop(0, hexA(pal.accent, .9)); sg.addColorStop(.5, hexA(pal.accent, .6)); sg.addColorStop(1, hexA(pal.accent, .15));
  poly([[cx-w*.04,Y(.01)],[cx+w*.04,Y(.01)],[cx+w*.055,Y(.74)],[cx-w*.055,Y(.74)]], sg);

  const czY = Y(.26), czH = h*.32, czW = w*.22;
  ctx.fillStyle = "#080A10"; ctx.beginPath();
  ctx.moveTo(cx-czW*.55, czY+czH); ctx.bezierCurveTo(cx-czW*.62, czY+czH*.6, cx-czW*.45, czY, cx, czY-h*.012);
  ctx.bezierCurveTo(cx+czW*.45, czY, cx+czW*.62, czY+czH*.6, cx+czW*.55, czY+czH); ctx.closePath(); ctx.fill();
  const gg = ctx.createRadialGradient(cx-czW*.15, czY+czH*.22, czH*.04, cx, czY+czH*.5, czH*.5);
  gg.addColorStop(0, "rgba(180,210,255,.75)");
  gg.addColorStop(.3, isPlayer ? "rgba(30,80,200,.70)" : "rgba(15,15,40,.80)");
  gg.addColorStop(.75, isPlayer ? "rgba(5,20,100,.88)" : "rgba(5,5,20,.90)");
  gg.addColorStop(1, "rgba(0,0,0,.95)");
  ctx.fillStyle = gg; ctx.beginPath();
  ctx.moveTo(cx-czW*.44, czY+czH); ctx.bezierCurveTo(cx-czW*.50, czY+czH*.6, cx-czW*.35, czY+h*.01, cx, czY+h*.005);
  ctx.bezierCurveTo(cx+czW*.35, czY+h*.01, cx+czW*.50, czY+czH*.6, cx+czW*.44, czY+czH); ctx.closePath(); ctx.fill();
  ctx.save(); ctx.globalAlpha = .55;
  const spec = ctx.createRadialGradient(cx-czW*.18, czY+czH*.14, 0, cx-czW*.18, czY+czH*.14, czH*.28);
  spec.addColorStop(0, "rgba(255,255,255,.9)"); spec.addColorStop(.4, "rgba(200,220,255,.4)"); spec.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = spec; ctx.beginPath();
  ctx.ellipse(cx-czW*.18, czY+czH*.18, czW*.28, czH*.20, -0.4, 0, Math.PI*2); ctx.fill(); ctx.restore();
  ctx.save(); ctx.strokeStyle = "#0A0C14"; ctx.lineWidth = w*.05; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(cx-czW*.42, czY+czH*.08);
  ctx.bezierCurveTo(cx-czW*.30, czY-h*.02, cx+czW*.30, czY-h*.02, cx+czW*.42, czY+czH*.08);
  ctx.stroke(); ctx.restore();

  const fwg = ctx.createLinearGradient(X(-.48), 0, X(.48), 0);
  fwg.addColorStop(0, pal.dark); fwg.addColorStop(.5, lighten(pal.body, .1)); fwg.addColorStop(1, pal.dark);
  poly([[cx-w*.01,Y(.02)],[cx-w*.27,Y(.02)],[cx-w*.48,Y(.06)],[cx-w*.46,Y(.10)],[cx-w*.24,Y(.07)],[cx-w*.01,Y(.055)]], fwg);
  poly([[cx+w*.01,Y(.02)],[cx+w*.27,Y(.02)],[cx+w*.48,Y(.06)],[cx+w*.46,Y(.10)],[cx+w*.24,Y(.07)],[cx+w*.01,Y(.055)]], fwg);
  ctx.fillStyle = pal.dark;
  poly([[cx-w*.46,Y(.04)],[cx-w*.50,Y(.04)],[cx-w*.50,Y(.11)],[cx-w*.46,Y(.11)]], pal.dark);
  poly([[cx+w*.46,Y(.04)],[cx+w*.50,Y(.04)],[cx+w*.50,Y(.11)],[cx+w*.46,Y(.11)]], pal.dark);
  const ntg = ctx.createLinearGradient(cx-w*.04, 0, cx+w*.04, 0);
  ntg.addColorStop(0, pal.dark); ntg.addColorStop(.5, lighten(pal.body, .25)); ntg.addColorStop(1, pal.dark);
  poly([[cx-bNT,Y(.01)],[cx-w*.025,Y(.055)],[cx+w*.025,Y(.055)],[cx+bNT,Y(.01)]], ntg);

  ctx.save();
  if (isPlayer) {
    ctx.shadowColor = "#99CCFF"; ctx.shadowBlur = 16; ctx.fillStyle = "#DDEEFF";
    poly([[cx-w*.44,Y(.065)],[cx-w*.28,Y(.065)],[cx-w*.28,Y(.09)],[cx-w*.44,Y(.09)]], "#DDEEFF");
    poly([[cx+w*.28,Y(.065)],[cx+w*.44,Y(.065)],[cx+w*.44,Y(.09)],[cx+w*.28,Y(.09)]], "#DDEEFF");
    ctx.strokeStyle = "rgba(160,200,255,.65)"; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(cx-w*.25, Y(.04)); ctx.lineTo(cx-w*.03, Y(.04)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx+w*.03, Y(.04)); ctx.lineTo(cx+w*.25, Y(.04)); ctx.stroke();
  } else {
    ctx.shadowColor = "#FF2200"; ctx.shadowBlur = 18; ctx.fillStyle = "#FF3311";
    poly([[cx-w*.22,Y(.87)],[cx-w*.06,Y(.87)],[cx-w*.05,Y(.91)],[cx-w*.23,Y(.91)]], "#FF3311");
    poly([[cx+w*.06,Y(.87)],[cx+w*.22,Y(.87)],[cx+w*.23,Y(.91)],[cx+w*.05,Y(.91)]], "#FF3311");
    ctx.shadowBlur = 8; ctx.fillStyle = "rgba(255,60,0,.4)";
    ctx.fillRect(cx-w*.15, Y(.91), w*.30, h*.015);
  }
  ctx.restore();
  ctx.restore();
}

function drawWheel(x, y, w, h, pal) {
  const cx = x + w/2, cy = y + h/2;
  ctx.save();
  const tGrad = ctx.createRadialGradient(cx-w*.15, cy-h*.15, 0, cx, cy, w*.55);
  tGrad.addColorStop(0, "#303030"); tGrad.addColorStop(.55, "#1A1A1A"); tGrad.addColorStop(1, "#0A0A0A");
  ctx.fillStyle = tGrad; roundRect(x, y, w, h, w*.28); ctx.fill();
  const rp = w*.20, rimW = w-rp*2, rimH = h-rp*1.6;
  const rimGrad = ctx.createLinearGradient(x+rp, y+rp*.8, x+rp+rimW, y+rp*.8);
  rimGrad.addColorStop(0, darken(pal.rim, .55)); rimGrad.addColorStop(.3, pal.rim);
  rimGrad.addColorStop(.6, lighten(pal.rim, .15)); rimGrad.addColorStop(1, darken(pal.rim, .4));
  ctx.fillStyle = rimGrad; roundRect(x+rp, y+rp*.8, rimW, rimH, w*.10); ctx.fill();
  ctx.save(); ctx.translate(cx, cy); ctx.strokeStyle = darken(pal.rim, .3); ctx.lineWidth = w*.055;
  for (let i = 0; i < 5; i++) {
    ctx.save(); ctx.rotate(i*Math.PI*2/5);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -h*.30); ctx.stroke(); ctx.restore();
  }
  ctx.restore();
  const hubGrad = ctx.createRadialGradient(cx-w*.04, cy-h*.04, 0, cx, cy, w*.10);
  hubGrad.addColorStop(0, "#888"); hubGrad.addColorStop(1, "#222");
  ctx.fillStyle = hubGrad; ctx.beginPath(); ctx.arc(cx, cy, w*.10, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,.08)"; ctx.lineWidth = w*.04;
  ctx.beginPath(); ctx.arc(cx, cy, w*.44, -Math.PI*.7, -Math.PI*.1); ctx.stroke();
  ctx.restore();
}

function hexToRgb(hex) {
  return [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)];
}
function hexA(hex, a) { const [r,g,b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; }
function darken(hex, f) { const [r,g,b] = hexToRgb(hex); return `rgb(${Math.round(r*f)},${Math.round(g*f)},${Math.round(b*f)})`; }
function lighten(hex, f) { const [r,g,b] = hexToRgb(hex); return `rgb(${Math.min(255,Math.round(r+(255-r)*f))},${Math.min(255,Math.round(g+(255-g)*f))},${Math.min(255,Math.round(b+(255-b)*f))})`; }
function roundRect(x, y, w, h, r) {
  r = Math.min(r, Math.abs(w)/2, Math.abs(h)/2); ctx.beginPath();
  ctx.moveTo(x+r, y); ctx.lineTo(x+w-r, y); ctx.arcTo(x+w, y, x+w, y+r, r);
  ctx.lineTo(x+w, y+h-r); ctx.arcTo(x+w, y+h, x+w-r, y+h, r);
  ctx.lineTo(x+r, y+h); ctx.arcTo(x, y+h, x, y+h-r, r);
  ctx.lineTo(x, y+r); ctx.arcTo(x, y, x+r, y, r); ctx.closePath();
}

function updateHUD() {
  if (!hudScore || !hudTime || !healthBar) return;
  hudScore.textContent = Math.floor(score);
  hudTime.textContent  = Math.floor(elapsed) + "s";
  const pct = 100 - 100 / (1 + speedLevel * 0.35);
  healthBar.style.width      = (8 + pct*.92) + "%";
  healthBar.style.background = flashTimer > 0
    ? "linear-gradient(90deg,#FF8C00,#FFD700)"
    : `linear-gradient(90deg,#0052FF ${100-pct}%,#60A5FA)`;
}

function pauseGame() {
  if (!gameRunning || gamePaused) return;
  gamePaused = true;
  const btn = document.getElementById("btn-pause");
  if (btn) { btn.textContent = "▶"; btn.title = "Resume"; }
}

function resumeGame() {
  if (!gameRunning || !gamePaused) return;
  gamePaused = false;
  lastTs = performance.now();
  const btn = document.getElementById("btn-pause");
  if (btn) { btn.textContent = "⏸"; btn.title = "Pause"; }
}

function togglePause() {
  if (gamePaused) resumeGame(); else pauseGame();
}

function endGame() {
  const fs = Math.floor(score), ss = Math.floor(elapsed);
  gamesPlayed++;
  if (fs > bestScore) bestScore = fs;
  saveData();
  const el = id => document.getElementById(id);
  if (el("final-score")) el("final-score").textContent = fs;
  if (el("go-time"))     el("go-time").textContent     = ss + "s";
  if (el("go-best"))     el("go-best").textContent     = bestScore;
  if (el("tx-status"))   el("tx-status").classList.add("hidden");
  if (el("tx-done"))     el("tx-done").classList.add("hidden");
  if (el("gameover-card")) el("gameover-card").classList.add("show");
  submitScoreOnChain(fs, ss);
                                   }
