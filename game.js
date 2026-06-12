/* ══════════════════════════════════════════════════════════
   BASE RACER — game.js  v3  (Cinematic Edition)
   High-quality top-down lane racer with advanced canvas rendering
   Web3 Base network integration
══════════════════════════════════════════════════════════ */
"use strict";

// ══════════════════════════════════════════════════════════
//  CONSTANTS
// ══════════════════════════════════════════════════════════
const BASE_CHAIN_ID  = 8453;
const BASE_RPC       = "https://mainnet.base.org";
const BASE_CHAIN_HEX = "0x" + BASE_CHAIN_ID.toString(16);
const BASESCAN_TX    = "https://basescan.org/tx/";
const SCORE_PER_SEC  = 5;
const LANE_COUNT     = 5;
const BASE_SPEED     = 220;
const SPEED_STEP     = 35;       // +35px/s every 10 seconds
const SPAWN_BASE     = 1.6;      // seconds between spawns (decreases with speed)

// ══════════════════════════════════════════════════════════
//  GLOBAL STATE
// ══════════════════════════════════════════════════════════
let wallet       = null;
let score        = 0;
let elapsed      = 0;
let gameRunning  = false;
let bestScore    = 0;
let gamesPlayed  = 0;
let lastTs       = 0;

let playerX, playerY, playerW, playerH;
let lanes = [];
let opponents = [];
let spawnTimer   = 0;
let roadOffset   = 0;
let bgOffset     = 0;
let currentSpeed = BASE_SPEED;
let speedLevel   = 0;
let flashTimer   = 0;
let shakeMag     = 0;          // camera shake on crash

// Particle system
let particles = [];

// ══════════════════════════════════════════════════════════
//  DOM
// ══════════════════════════════════════════════════════════
const screens = {
  connect:  document.getElementById("screen-connect"),
  start:    document.getElementById("screen-start"),
  game:     document.getElementById("screen-game"),
  gameover: document.getElementById("screen-gameover"),
};
const canvas   = document.getElementById("game-canvas");
const ctx      = canvas.getContext("2d");
const hudScore = document.getElementById("hud-score");
const hudTime  = document.getElementById("hud-time");
const healthBar = document.getElementById("health-bar");

function showScreen(id) {
  Object.entries(screens).forEach(([k,el]) => el.classList.toggle("active", k === id));
}

// ══════════════════════════════════════════════════════════
//  CONNECT SCREEN DECORATION
// ══════════════════════════════════════════════════════════
(function buildSpeedLines() {
  const wrap = document.getElementById("speedlines");
  if (!wrap) return;
  for (let i = 0; i < 20; i++) {
    const d = document.createElement("div");
    d.style.cssText = `position:absolute;left:${Math.random()*100}%;top:0;
      width:1px;height:${25+Math.random()*55}px;
      background:linear-gradient(180deg,transparent,rgba(0,82,255,.45),transparent);
      animation:fall ${.35+Math.random()*.65}s ${-Math.random()}s linear infinite;`;
    wrap.appendChild(d);
  }
  const s = document.createElement("style");
  s.textContent = `@keyframes fall{from{top:-80px}to{top:110%}}`;
  document.head.appendChild(s);
})();

// ══════════════════════════════════════════════════════════
//  WEB3
// ══════════════════════════════════════════════════════════
async function connectWallet() {
  if (!window.ethereum) { alert("No EVM wallet found. Install MetaMask."); return; }
  try {
    await window.ethereum.request({ method: "eth_requestAccounts" });
    try {
      await window.ethereum.request({ method:"wallet_switchEthereumChain", params:[{chainId:BASE_CHAIN_HEX}] });
    } catch(e) {
      if (e.code===4902) await window.ethereum.request({ method:"wallet_addEthereumChain", params:[{
        chainId:BASE_CHAIN_HEX, chainName:"Base",
        nativeCurrency:{name:"Ether",symbol:"ETH",decimals:18},
        rpcUrls:[BASE_RPC], blockExplorerUrls:["https://basescan.org"]
      }]});
      else throw e;
    }
    const provider = new ethers.BrowserProvider(window.ethereum);
    const signer   = await provider.getSigner();
    const address  = await signer.getAddress();
    wallet = { address, provider, signer };
    loadData(); updateStartScreen(); showScreen("start");
  } catch(err) { console.error(err); alert("Connection failed: "+(err.message||err)); }
}

async function recordScore(score, secs) {
  if (!wallet) return;
  const el = { status:document.getElementById("tx-status"), done:document.getElementById("tx-done"),
               msg:document.getElementById("tx-msg"), link:document.getElementById("tx-link") };
  el.status.classList.remove("hidden"); el.done.classList.add("hidden");
  try {
    const memo = `BASE RACER | Score:${score} | Time:${secs}s`;
    const hex  = "0x"+Array.from(new TextEncoder().encode(memo)).map(b=>b.toString(16).padStart(2,"0")).join("");
    el.msg.textContent = "Confirm in wallet…";
    const tx = await wallet.signer.sendTransaction({ to:wallet.address, value:0n, data:hex });
    el.msg.textContent = "Broadcasting…";
    await tx.wait(1);
    el.status.classList.add("hidden"); el.done.classList.remove("hidden");
    el.link.href = BASESCAN_TX + tx.hash;
  } catch(err) { el.status.classList.add("hidden"); if(err.code!==4001) console.error(err); }
}

// ══════════════════════════════════════════════════════════
//  STORAGE
// ══════════════════════════════════════════════════════════
const storeKey = a => "br_"+a.toLowerCase();
function loadData() {
  if (!wallet) return;
  try { const d=JSON.parse(localStorage.getItem(storeKey(wallet.address))||"{}");
        bestScore=d.b||0; gamesPlayed=d.g||0; } catch{}
}
function saveData() {
  if (!wallet) return;
  localStorage.setItem(storeKey(wallet.address), JSON.stringify({b:bestScore,g:gamesPlayed}));
}
function updateStartScreen() {
  document.getElementById("wallet-address-display").textContent = wallet.address.slice(0,6)+"…"+wallet.address.slice(-4);
  document.getElementById("best-score-display").textContent   = bestScore;
  document.getElementById("games-played-display").textContent = gamesPlayed;
}

// ══════════════════════════════════════════════════════════
//  CANVAS + LANES
// ══════════════════════════════════════════════════════════
function resize() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  const lw = canvas.width / LANE_COUNT;
  lanes = Array.from({length:LANE_COUNT},(_,i) => ({ x:i*lw, cx:i*lw+lw/2, w:lw }));
  playerW = lw * 0.54;
  playerH = playerW * 1.9;
  playerX = lanes[Math.floor(LANE_COUNT/2)].cx - playerW/2;
  playerY = canvas.height - playerH - 55;
}
window.addEventListener("resize", resize);

// ══════════════════════════════════════════════════════════
//  INPUT
// ══════════════════════════════════════════════════════════
const keys = { left:false, right:false };
window.addEventListener("keydown", e => {
  if (e.key==="ArrowLeft"  ||e.key==="a"||e.key==="A") keys.left=true;
  if (e.key==="ArrowRight" ||e.key==="d"||e.key==="D") keys.right=true;
});
window.addEventListener("keyup", e => {
  if (e.key==="ArrowLeft"  ||e.key==="a"||e.key==="A") keys.left=false;
  if (e.key==="ArrowRight" ||e.key==="d"||e.key==="D") keys.right=false;
});
let tx0 = null;
canvas.addEventListener("touchstart", e=>{ tx0=e.touches[0].clientX; },{passive:true});
canvas.addEventListener("touchmove",  e=>{ if(tx0===null)return; const dx=e.touches[0].clientX-tx0; if(Math.abs(dx)>8){keys.left=dx<0;keys.right=dx>0;} },{passive:true});
canvas.addEventListener("touchend",   ()=>{ keys.left=keys.right=false; tx0=null; });

// ══════════════════════════════════════════════════════════
//  PARTICLE SYSTEM
// ══════════════════════════════════════════════════════════
function spawnParticle(x,y,type) {
  const base = type==="smoke"
    ? { vx:(Math.random()-.5)*30, vy:-20-Math.random()*40, life:1.2, maxLife:1.2, size:4+Math.random()*6, color:"200,200,200" }
    : { vx:(Math.random()-.5)*80, vy:-60-Math.random()*60, life:.6, maxLife:.6, size:2+Math.random()*4, color:"255,160,40" };
  particles.push({...base, x:x+(Math.random()-.5)*8, y, type});
}
function updateParticles(dt) {
  for (const p of particles) {
    p.x  += p.vx * dt;
    p.y  += p.vy * dt;
    p.vy += 40 * dt;  // gravity for sparks
    p.life -= dt;
  }
  particles = particles.filter(p => p.life > 0);
}
function drawParticles() {
  for (const p of particles) {
    const a = p.life / p.maxLife;
    const s = p.size * a;
    ctx.save();
    ctx.globalAlpha = a * .85;
    ctx.fillStyle = `rgb(${p.color})`;
    if (p.type==="smoke") {
      ctx.shadowColor = `rgba(${p.color},.3)`; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.arc(p.x, p.y, s, 0, Math.PI*2); ctx.fill();
    } else {
      ctx.fillStyle = `rgba(${p.color},${a})`;
      ctx.fillRect(p.x-s/2, p.y-s/2, s, s);
    }
    ctx.restore();
  }
}

// ══════════════════════════════════════════════════════════
//  GAME LOOP
// ══════════════════════════════════════════════════════════
function startGame() {
  score=0; elapsed=0; roadOffset=0; bgOffset=0;
  opponents=[]; particles=[]; spawnTimer=0;
  currentSpeed=BASE_SPEED; speedLevel=0; flashTimer=0; shakeMag=0;
  lastTs=performance.now(); gameRunning=true;
  resize(); updateHUD();
  requestAnimationFrame(tick);
}

function tick(ts) {
  if (!gameRunning) return;
  const dt = Math.min((ts-lastTs)/1000, .1);
  lastTs = ts;

  elapsed     += dt;
  score       += SCORE_PER_SEC * dt;

  // Speed ramp every 10s
  const newLevel = Math.floor(elapsed/10);
  if (newLevel > speedLevel) {
    speedLevel   = newLevel;
    currentSpeed = BASE_SPEED + speedLevel * SPEED_STEP;
    flashTimer   = 2.0;
  }
  if (flashTimer > 0) flashTimer -= dt;

  // Camera shake decay
  if (shakeMag > 0) shakeMag = Math.max(0, shakeMag - 80*dt);

  // Scroll offsets
  roadOffset = (roadOffset + currentSpeed * dt) % 120;
  bgOffset   = (bgOffset   + currentSpeed * .15 * dt) % canvas.height;

  // Player move
  const ps = currentSpeed * 1.6;
  if (keys.left)  playerX = Math.max(0,               playerX - ps*dt);
  if (keys.right) playerX = Math.min(canvas.width-playerW, playerX + ps*dt);

  // Spawn
  const interval = Math.max(.6, SPAWN_BASE - speedLevel * .08);
  spawnTimer += dt;
  if (spawnTimer >= interval) {
    spawnTimer = 0;
    spawnOpponent();
  }

  // Move opponents
  for (const op of opponents) {
    op.y += op.speed * dt;
    // Spawn tire smoke on fast opponents
    if (Math.random() < .1) spawnParticle(op.x+op.w*.25, op.y+op.h*.85, "smoke");
    if (Math.random() < .1) spawnParticle(op.x+op.w*.75, op.y+op.h*.85, "smoke");
  }
  opponents = opponents.filter(op => op.y < canvas.height+50);

  updateParticles(dt);

  // Player tire smoke when moving fast
  if (speedLevel >= 2) {
    if (Math.random() < .15) spawnParticle(playerX+playerW*.2, playerY+playerH*.88, "smoke");
    if (Math.random() < .15) spawnParticle(playerX+playerW*.8, playerY+playerH*.88, "smoke");
  }

  // Collision
  let crashed = false;
  for (const op of opponents) {
    if (overlap(playerX+5,playerY+8,playerW-10,playerH-14,
                op.x+5,  op.y+8,  op.w-10,  op.h-14)) {
      crashed = true;
      // Burst of sparks
      for (let i=0;i<28;i++) spawnParticle(playerX+playerW/2, playerY+playerH/2, "spark");
      shakeMag = 18;
      break;
    }
  }

  render();
  updateHUD();

  if (crashed) { gameRunning=false; setTimeout(endGame, 400); return; }
  requestAnimationFrame(tick);
}

function overlap(ax,ay,aw,ah,bx,by,bw,bh) {
  return ax<bx+bw && ax+aw>bx && ay<by+bh && ay+ah>by;
}

// ══════════════════════════════════════════════════════════
//  OPPONENT FACTORY
// ══════════════════════════════════════════════════════════
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
  const lane    = lanes[Math.floor(Math.random()*LANE_COUNT)];
  const palette = CAR_PALETTES[Math.floor(Math.random()*CAR_PALETTES.length)];
  const relSpeed = currentSpeed * (.55 + Math.random()*.75);
  opponents.push({
    x: lane.cx - playerW/2,
    y: -playerH - Math.random()*60,
    w: playerW, h: playerH,
    speed: relSpeed,
    palette,
  });
}

// ══════════════════════════════════════════════════════════
//  RENDER
// ══════════════════════════════════════════════════════════
function render() {
  const W = canvas.width, H = canvas.height;

  // Camera shake
  ctx.save();
  if (shakeMag > 0) {
    ctx.translate(
      (Math.random()-.5)*shakeMag,
      (Math.random()-.5)*shakeMag*.6
    );
  }

  // ── BACKGROUND (city/environment strip) ──
  drawBackground(W, H);

  // ── ROAD SURFACE ──
  drawRoad(W, H);

  // ── PARTICLES behind cars ──
  drawParticles();

  // ── OPPONENTS ──
  for (const op of opponents) {
    drawCarShadow(op.x, op.y, op.w, op.h);
    drawCar(op.x, op.y, op.w, op.h, op.palette, false);
  }

  // ── PLAYER ──
  drawCarShadow(playerX, playerY, playerW, playerH);
  drawCar(playerX, playerY, playerW, playerH,
    { body:"#0D2B6E", dark:"#060F2C", accent:"#0052FF", rim:"#A0C4FF", light:"#60A5FA" },
    true);

  // ── SPEED-UP FLASH ──
  if (flashTimer > 0) {
    const a = Math.min(.4, flashTimer*.22) * (flashTimer > 1.5 ? 1 : flashTimer/1.5);
    ctx.fillStyle = `rgba(0,100,255,${a})`;
    ctx.fillRect(0,0,W,H);
    if (flashTimer > 1.2) {
      ctx.save();
      ctx.font = `bold ${Math.floor(W*.058)}px 'Segoe UI',sans-serif`;
      ctx.textAlign = "center";
      ctx.shadowColor = "#0052FF"; ctx.shadowBlur = 30;
      ctx.fillStyle = "#FFFFFF";
      ctx.fillText("⚡  SPEED UP!", W/2, H*.2);
      ctx.restore();
    }
  }

  ctx.restore(); // end camera shake
}

// ── BACKGROUND ──
function drawBackground(W, H) {
  // Sky gradient
  const sky = ctx.createLinearGradient(0,0,0,H*.22);
  sky.addColorStop(0,   "#050A1E");
  sky.addColorStop(.6,  "#071030");
  sky.addColorStop(1,   "#0A1840");
  ctx.fillStyle = sky;
  ctx.fillRect(0,0,W,H*.22);

  // Distant city silhouette
  ctx.save();
  ctx.fillStyle = "#060D22";
  const buildings = [
    [0,.85],[.04,.6],[.07,.75],[.10,.55],[.14,.80],[.18,.65],
    [.22,.5],[.26,.70],[.30,.6],[.35,.45],[.40,.68],[.44,.58],
    [.48,.72],[.52,.52],[.56,.65],[.60,.48],[.65,.72],[.70,.6],
    [.74,.55],[.78,.7],[.82,.62],[.86,.5],[.90,.73],[.94,.6],[.97,.8],[1,.85]
  ];
  const BH = H*.22;
  ctx.beginPath(); ctx.moveTo(0,BH);
  for (const [bx,bh] of buildings) ctx.lineTo(bx*W, BH*(1-bh*.4));
  ctx.lineTo(W,BH); ctx.closePath(); ctx.fill();

  // Neon window dots on buildings
  for (let i=0;i<60;i++) {
    const wx = (i*137.5)%W, wy = BH*.1+(i*53.7)%((BH*.55));
    const alpha = .3+.5*Math.abs(Math.sin(elapsed*1.3+i));
    ctx.fillStyle = `rgba(${[
      [0,120,255],[255,200,0],[0,220,180],[180,80,255]
    ][i%4].join(",")},${alpha})`;
    ctx.fillRect(wx,wy,2,3);
  }
  ctx.restore();

  // Horizon glow
  const hg = ctx.createLinearGradient(0,H*.18,0,H*.28);
  hg.addColorStop(0,"rgba(0,60,160,.55)");
  hg.addColorStop(1,"rgba(0,0,0,0)");
  ctx.fillStyle = hg;
  ctx.fillRect(0,H*.18,W,H*.12);
}

// ── ROAD ──
function drawRoad(W, H) {
  // Asphalt — subtle warm-cool gradient side to side
  const asph = ctx.createLinearGradient(0,0,W,0);
  asph.addColorStop(0,   "#161618");
  asph.addColorStop(.08, "#1E1E22");
  asph.addColorStop(.5,  "#222226");
  asph.addColorStop(.92, "#1E1E22");
  asph.addColorStop(1,   "#161618");
  ctx.fillStyle = asph;
  ctx.fillRect(0, H*.20, W, H*.80);

  // Wet road sheen — very subtle
  const sheen = ctx.createLinearGradient(0, H*.20, 0, H);
  sheen.addColorStop(0,   "rgba(0,50,120,.12)");
  sheen.addColorStop(.35, "rgba(0,30,80,.05)");
  sheen.addColorStop(1,   "rgba(0,0,0,0)");
  ctx.fillStyle = sheen;
  ctx.fillRect(0,H*.20,W,H*.80);

  const laneW  = W / LANE_COUNT;
  const segLen = 120;   // px per dash segment
  const dashRatio = .52;

  // ── Rumble strips (outer edges) ──
  const rw = laneW * .10;
  const blockH = 28;
  for (let y = -(roadOffset % blockH); y < H; y += blockH) {
    const odd = Math.floor(y/blockH) % 2 === 0;
    ctx.fillStyle = odd ? "rgba(230,30,30,.90)" : "rgba(245,245,245,.90)";
    ctx.fillRect(0,   y, rw, blockH-1);
    ctx.fillStyle = odd ? "rgba(245,245,245,.90)" : "rgba(230,30,30,.90)";
    ctx.fillRect(W-rw, y, rw, blockH-1);
  }

  // ── Solid white edge lines ──
  ctx.strokeStyle = "#E8E8E8";
  ctx.lineWidth   = 3.5;
  ctx.setLineDash([]);
  ctx.beginPath(); ctx.moveTo(rw,    0); ctx.lineTo(rw,    H); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(W-rw,  0); ctx.lineTo(W-rw,  H); ctx.stroke();

  // ── Yellow centre double lines ──
  const cx = W/2;
  ctx.strokeStyle = "#FFD740";
  ctx.lineWidth   = 2.5;
  [-4.5, 4.5].forEach(off => {
    ctx.beginPath(); ctx.moveTo(cx+off,0); ctx.lineTo(cx+off,H); ctx.stroke();
  });
  // Fill between them in darker yellow
  ctx.fillStyle = "rgba(180,130,0,.25)";
  ctx.fillRect(cx-4.5, 0, 9, H);

  // ── Dashed white lane dividers ──
  const dashH = segLen * dashRatio;
  const gapH  = segLen - dashH;
  ctx.strokeStyle = "rgba(230,230,230,.78)";
  ctx.lineWidth   = 2;
  ctx.setLineDash([dashH, gapH]);

  for (let i=1; i<LANE_COUNT; i++) {
    const lx = i * laneW;
    if (Math.abs(lx-cx) < 8) continue;  // skip centre (yellow)
    ctx.lineDashOffset = -roadOffset;
    ctx.beginPath(); ctx.moveTo(lx, 0); ctx.lineTo(lx, H); ctx.stroke();
  }
  ctx.setLineDash([]);

  // ── Road distance tick marks ──
  ctx.strokeStyle = "rgba(255,255,255,.28)";
  ctx.lineWidth = 1;
  const tickGap = 140;
  for (let y = -(roadOffset % tickGap); y < H; y += tickGap) {
    ctx.beginPath(); ctx.moveTo(rw+2,y); ctx.lineTo(rw+16,y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(W-rw-2,y); ctx.lineTo(W-rw-16,y); ctx.stroke();
  }

  // ── Reflective lane centreline dots ──
  ctx.fillStyle = "rgba(255,240,180,.65)";
  const dotGap = 80;
  for (let i=0;i<LANE_COUNT;i++) {
    const lx = lanes[i].cx;
    for (let y = -(roadOffset % dotGap); y < H; y += dotGap) {
      ctx.save();
      ctx.shadowColor = "rgba(255,220,100,.8)"; ctx.shadowBlur = 5;
      ctx.beginPath(); ctx.arc(lx, y, 2.5, 0, Math.PI*2); ctx.fill();
      ctx.restore();
    }
  }

  // ── Horizon fade (depth vignette) ──
  const fog = ctx.createLinearGradient(0, H*.20, 0, H*.38);
  fog.addColorStop(0,   "rgba(5,10,30,.75)");
  fog.addColorStop(1,   "rgba(5,10,30,0)");
  ctx.fillStyle = fog;
  ctx.fillRect(0,H*.20,W,H*.20);

  // Side vignette
  const vig = ctx.createLinearGradient(0,0,W,0);
  vig.addColorStop(0,   "rgba(0,0,0,.45)");
  vig.addColorStop(.08, "rgba(0,0,0,0)");
  vig.addColorStop(.92, "rgba(0,0,0,0)");
  vig.addColorStop(1,   "rgba(0,0,0,.45)");
  ctx.fillStyle = vig;
  ctx.fillRect(0,0,W,H);
}

// ══════════════════════════════════════════════════════════
//  CAR RENDERING
// ══════════════════════════════════════════════════════════

// Shadow beneath each car
function drawCarShadow(x, y, w, h) {
  ctx.save();
  const cx = x + w/2;
  const grad = ctx.createRadialGradient(cx, y+h*.92, 0, cx, y+h*.92, w*.72);
  grad.addColorStop(0,   "rgba(0,0,0,.55)");
  grad.addColorStop(.6,  "rgba(0,0,0,.20)");
  grad.addColorStop(1,   "rgba(0,0,0,0)");
  ctx.fillStyle = grad;
  ctx.scale(1, .32);
  ctx.beginPath();
  ctx.ellipse(cx, (y+h*.92)/.32, w*.72, h*.38, 0, 0, Math.PI*2);
  ctx.fill();
  ctx.restore();
}

// Full car — F1/WRC rally body
function drawCar(x, y, w, h, pal, isPlayer) {
  const cx = x + w/2;
  ctx.save();

  // ── Underbody / diffuser (darkest layer) ──
  ctx.fillStyle = "#0A0A0C";
  roundRect(cx-w*.30, y+h*.82, w*.60, h*.14, 3); ctx.fill();

  // ── Rear wing assembly ──
  const wingW = w * 1.12, wingThk = h*.055;
  const wingStem = h*.038;
  const wingY    = y + h*.76;
  // Wing stem (two pillars)
  ctx.fillStyle = pal.dark;
  ctx.fillRect(cx-w*.18, wingY+wingThk, w*.07, wingStem);
  ctx.fillRect(cx+w*.11, wingY+wingThk, w*.07, wingStem);
  // Wing blade
  const wingGrad = ctx.createLinearGradient(0,wingY,0,wingY+wingThk);
  wingGrad.addColorStop(0, pal.body);
  wingGrad.addColorStop(1, pal.dark);
  ctx.fillStyle = wingGrad;
  roundRect(cx-wingW/2, wingY, wingW, wingThk, 3); ctx.fill();
  // Endplates
  ctx.fillStyle = pal.dark;
  ctx.fillRect(cx-wingW/2,     wingY-h*.025, w*.055, wingThk+h*.025);
  ctx.fillRect(cx+wingW/2-w*.055, wingY-h*.025, w*.055, wingThk+h*.025);
  // Wing stripe
  ctx.fillStyle = pal.accent; ctx.globalAlpha=.6;
  ctx.fillRect(cx-wingW*.38, wingY+wingThk*.2, wingW*.76, wingThk*.35);
  ctx.globalAlpha=1;

  // ── Side pods ──
  const podW = w*.225, podH = h*.52, podY = y+h*.28;
  const podGradL = ctx.createLinearGradient(x,0,x+podW,0);
  podGradL.addColorStop(0, pal.dark); podGradL.addColorStop(1, pal.body);
  ctx.fillStyle = podGradL;
  roundRect(x+w*.01, podY, podW, podH, w*.05); ctx.fill();
  const podGradR = ctx.createLinearGradient(x+w-podW,0,x+w,0);
  podGradR.addColorStop(0, pal.body); podGradR.addColorStop(1, pal.dark);
  ctx.fillStyle = podGradR;
  roundRect(x+w-w*.01-podW, podY, podW, podH, w*.05); ctx.fill();
  // Pod cooling vents (horizontal slits)
  ctx.fillStyle = "rgba(0,0,0,.55)";
  for (let v=0;v<3;v++) {
    ctx.fillRect(x+w*.035,   podY+podH*.22+v*podH*.18, podW*.65, podH*.055);
    ctx.fillRect(x+w-podW+w*.015, podY+podH*.22+v*podH*.18, podW*.65, podH*.055);
  }

  // ── Central monocoque ──
  const mw = w*.56, mx = cx - mw/2;
  const monoGrad = ctx.createLinearGradient(mx,0,mx+mw,0);
  monoGrad.addColorStop(0,   pal.dark);
  monoGrad.addColorStop(.25, pal.body);
  monoGrad.addColorStop(.5,  lighten(pal.body,.22));
  monoGrad.addColorStop(.75, pal.body);
  monoGrad.addColorStop(1,   pal.dark);
  ctx.fillStyle = monoGrad;
  roundRect(mx, y+h*.10, mw, h*.72, w*.12); ctx.fill();

  // ── Nose cone ──
  const noseGrad = ctx.createLinearGradient(mx,0,mx+mw,0);
  noseGrad.addColorStop(0, pal.dark); noseGrad.addColorStop(.5, pal.body); noseGrad.addColorStop(1, pal.dark);
  ctx.fillStyle = noseGrad;
  ctx.beginPath();
  ctx.moveTo(mx,      y+h*.10);
  ctx.lineTo(mx+mw,   y+h*.10);
  ctx.lineTo(cx+mw*.18, y+h*.01);
  ctx.lineTo(cx-mw*.18, y+h*.01);
  ctx.closePath(); ctx.fill();

  // ── Livery accent stripe (spine) ──
  const stripeGrad = ctx.createLinearGradient(0,y+h*.03,0,y+h*.72);
  stripeGrad.addColorStop(0,   pal.accent+"FF");
  stripeGrad.addColorStop(.5,  pal.accent+"BB");
  stripeGrad.addColorStop(1,   pal.accent+"44");
  ctx.fillStyle = stripeGrad;
  ctx.globalAlpha = .88;
  roundRect(cx-w*.055, y+h*.02, w*.11, h*.65, 2); ctx.fill();
  ctx.globalAlpha = 1;

  // Number on side pods
  if (!isPlayer) {
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,.60)";
    ctx.font = `bold ${Math.floor(w*.18)}px 'Segoe UI',sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText("●", x+w*.115, podY+podH*.62);
    ctx.fillText("●", x+w*.885, podY+podH*.62);
    ctx.restore();
  }

  // ── Cockpit ──
  // Surround
  ctx.fillStyle = pal.dark;
  roundRect(cx-w*.195, y+h*.24, w*.39, h*.30, w*.08); ctx.fill();
  // Halo
  ctx.strokeStyle = pal.dark; ctx.lineWidth = w*.045;
  ctx.beginPath();
  ctx.moveTo(cx-w*.18, y+h*.255);
  ctx.bezierCurveTo(cx-w*.14, y+h*.20, cx+w*.14, y+h*.20, cx+w*.18, y+h*.255);
  ctx.stroke();
  // Canopy glass
  const glassGrad = ctx.createLinearGradient(cx-w*.16,y+h*.26,cx+w*.16,y+h*.50);
  glassGrad.addColorStop(0,   isPlayer ? "rgba(20,60,160,.82)" : "rgba(10,10,30,.85)");
  glassGrad.addColorStop(.35, isPlayer ? "rgba(40,100,220,.60)" : "rgba(25,25,50,.65)");
  glassGrad.addColorStop(1,   isPlayer ? "rgba(5,20,80,.90)"  : "rgba(5,5,15,.90)");
  ctx.fillStyle = glassGrad;
  roundRect(cx-w*.155, y+h*.265, w*.31, h*.255, w*.07); ctx.fill();
  // Glass highlight
  ctx.fillStyle = "rgba(200,220,255,.18)";
  roundRect(cx-w*.10, y+h*.275, w*.13, h*.075, 3); ctx.fill();

  // ── Front wing ──
  const fwW = w*.94, fwH = h*.048, fwY = y+h*.01;
  const fwGrad = ctx.createLinearGradient(cx-fwW/2,0,cx+fwW/2,0);
  fwGrad.addColorStop(0, pal.dark); fwGrad.addColorStop(.5, pal.body); fwGrad.addColorStop(1, pal.dark);
  ctx.fillStyle = fwGrad;
  roundRect(cx-fwW/2, fwY, fwW, fwH, 2); ctx.fill();
  // Front wing endplates
  ctx.fillStyle = pal.dark;
  ctx.fillRect(cx-fwW/2,     fwY,         w*.048, fwH+h*.022);
  ctx.fillRect(cx+fwW/2-w*.048, fwY,       w*.048, fwH+h*.022);

  // ── Lights ──
  ctx.save();
  if (isPlayer) {
    // Headlights — cool white/blue
    ctx.shadowColor = "#88BBFF"; ctx.shadowBlur = 14;
    ctx.fillStyle = "#D0E8FF";
    ctx.fillRect(cx-w*.265, y+h*.036, w*.095, h*.038);
    ctx.fillRect(cx+w*.17,  y+h*.036, w*.095, h*.038);
    // DRL line
    ctx.strokeStyle="rgba(180,210,255,.7)"; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.moveTo(cx-w*.18,y+h*.058); ctx.lineTo(cx-w*.025,y+h*.058); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx+w*.025,y+h*.058); ctx.lineTo(cx+w*.18, y+h*.058); ctx.stroke();
  } else {
    // Tail lights — red
    ctx.shadowColor = "#FF1100"; ctx.shadowBlur = 16;
    ctx.fillStyle = "#FF2200";
    ctx.fillRect(cx-w*.265, y+h*.875, w*.095, h*.040);
    ctx.fillRect(cx+w*.17,  y+h*.875, w*.095, h*.040);
    // Brake light strip
    ctx.strokeStyle="rgba(255,80,40,.7)"; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.moveTo(cx-w*.17,y+h*.898); ctx.lineTo(cx-w*.025,y+h*.898); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx+w*.025,y+h*.898); ctx.lineTo(cx+w*.17, y+h*.898); ctx.stroke();
  }
  ctx.restore();

  // ── Exhaust glow (player only) ──
  if (isPlayer) {
    for (const ex of [cx-w*.195, cx+w*.195]) {
      const flame = ctx.createRadialGradient(ex, y+h+4, 0, ex, y+h+4, w*.13);
      flame.addColorStop(0,   "rgba(100,180,255,.9)");
      flame.addColorStop(.4,  "rgba(40,120,255,.5)");
      flame.addColorStop(1,   "rgba(0,60,180,0)");
      ctx.fillStyle = flame;
      ctx.beginPath();
      ctx.ellipse(ex, y+h+4+(Math.random()*4), w*.065, h*.072+(Math.random()*h*.025), 0, 0, Math.PI*2);
      ctx.fill();
    }
  }

  // ── Wheels (large, detailed) ──
  const tw = w*.225, th = h*.17;
  const tireInset = -tw*.12;
  [
    [x+tireInset,          y+h*.065],   // FL
    [x+w-tireInset-tw,     y+h*.065],   // FR
    [x+tireInset,          y+h*.73],    // RL
    [x+w-tireInset-tw,     y+h*.73],    // RR
  ].forEach(([tx, ty]) => drawWheel(tx, ty, tw, th, pal));

  ctx.restore();
}

function drawWheel(x, y, w, h, pal) {
  const cx = x+w/2, cy = y+h/2;
  ctx.save();

  // Tyre rubber — radial gradient for 3D look
  const tGrad = ctx.createRadialGradient(cx-w*.15, cy-h*.15, 0, cx, cy, w*.55);
  tGrad.addColorStop(0,   "#303030");
  tGrad.addColorStop(.55, "#1A1A1A");
  tGrad.addColorStop(1,   "#0A0A0A");
  ctx.fillStyle = tGrad;
  roundRect(x, y, w, h, w*.28); ctx.fill();

  // Rim
  const rp = w*.20, rimW = w-rp*2, rimH = h-rp*1.6;
  const rimGrad = ctx.createLinearGradient(x+rp, y+rp*.8, x+rp+rimW, y+rp*.8);
  rimGrad.addColorStop(0,   darken(pal.rim, .55));
  rimGrad.addColorStop(.3,  pal.rim);
  rimGrad.addColorStop(.6,  lighten(pal.rim,.15));
  rimGrad.addColorStop(1,   darken(pal.rim, .4));
  ctx.fillStyle = rimGrad;
  roundRect(x+rp, y+rp*.8, rimW, rimH, w*.10); ctx.fill();

  // Rim spokes (5-spoke)
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = darken(pal.rim,.3);
  ctx.lineWidth = w*.055;
  for (let i=0;i<5;i++) {
    ctx.save();
    ctx.rotate(i*Math.PI*2/5);
    ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(0, -h*.30); ctx.stroke();
    ctx.restore();
  }
  ctx.restore();

  // Centre hub
  const hubGrad = ctx.createRadialGradient(cx-w*.04,cy-h*.04,0,cx,cy,w*.10);
  hubGrad.addColorStop(0, "#888"); hubGrad.addColorStop(1, "#222");
  ctx.fillStyle = hubGrad;
  ctx.beginPath(); ctx.arc(cx,cy,w*.10,0,Math.PI*2); ctx.fill();

  // Tyre sidewall highlight
  ctx.strokeStyle = "rgba(255,255,255,.08)";
  ctx.lineWidth = w*.04;
  ctx.beginPath();
  ctx.arc(cx, cy, w*.44, -Math.PI*.7, -Math.PI*.1);
  ctx.stroke();

  ctx.restore();
}

// ══════════════════════════════════════════════════════════
//  COLOUR HELPERS
// ══════════════════════════════════════════════════════════
function hexToRgb(hex) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return [r,g,b];
}
function darken(hex, f) {
  const [r,g,b] = hexToRgb(hex);
  return `rgb(${Math.round(r*f)},${Math.round(g*f)},${Math.round(b*f)})`;
}
function lighten(hex, f) {
  const [r,g,b] = hexToRgb(hex);
  return `rgb(${Math.min(255,Math.round(r+(255-r)*f))},${Math.min(255,Math.round(g+(255-g)*f))},${Math.min(255,Math.round(b+(255-b)*f))})`;
}
function roundRect(x,y,w,h,r) {
  r = Math.min(r, Math.abs(w)/2, Math.abs(h)/2);
  ctx.beginPath();
  ctx.moveTo(x+r,y);
  ctx.lineTo(x+w-r,y); ctx.arcTo(x+w,y,   x+w,y+r,   r);
  ctx.lineTo(x+w,y+h-r); ctx.arcTo(x+w,y+h, x+w-r,y+h, r);
  ctx.lineTo(x+r,y+h); ctx.arcTo(x,y+h, x,y+h-r,   r);
  ctx.lineTo(x,y+r);   ctx.arcTo(x,y,   x+r,y,     r);
  ctx.closePath();
}

// ══════════════════════════════════════════════════════════
//  HUD
// ══════════════════════════════════════════════════════════
function updateHUD() {
  hudScore.textContent = Math.floor(score);
  hudTime.textContent  = Math.floor(elapsed)+"s";
  const maxLvl = 10;
  const pct = Math.min(100, speedLevel/maxLvl*100);
  healthBar.style.width = (8 + pct*.92) + "%";
  healthBar.style.background = flashTimer>0
    ? "linear-gradient(90deg,#FF8C00,#FFD700)"
    : `linear-gradient(90deg,#0052FF ${100-pct}%,#60A5FA)`;
}

// ══════════════════════════════════════════════════════════
//  GAME OVER
// ══════════════════════════════════════════════════════════
function endGame() {
  const fs = Math.floor(score), ss = Math.floor(elapsed);
  gamesPlayed++;
  if (fs > bestScore) bestScore = fs;
  saveData();
  document.getElementById("final-score").textContent = fs;
  document.getElementById("go-time").textContent     = ss+"s";
  document.getElementById("go-best").textContent     = bestScore;
  document.getElementById("tx-status").classList.add("hidden");
  document.getElementById("tx-done").classList.add("hidden");
  showScreen("gameover");
  recordScore(fs, ss);
}

// ══════════════════════════════════════════════════════════
//  BUTTON WIRING
// ══════════════════════════════════════════════════════════
document.getElementById("btn-connect").addEventListener("click", connectWallet);
document.getElementById("btn-start").addEventListener("click", ()=>{ showScreen("game"); startGame(); });
document.getElementById("btn-disconnect").addEventListener("click", ()=>{ wallet=null; showScreen("connect"); });
document.getElementById("btn-play-again").addEventListener("click", ()=>{ showScreen("game"); startGame(); });
document.getElementById("btn-to-menu").addEventListener("click", ()=>{ updateStartScreen(); showScreen("start"); });

// ══════════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════════
resize();
showScreen("connect");
