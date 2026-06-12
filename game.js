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

// ══════════════════════════════════════════════════════════
//  CAR — angular polygon body matching top-down F1 reference
//  Key shapes (all drawn with poly() helper):
//    nose tip → sharp triangle point at front
//    body     → diamond/arrowhead fuselage with beveled facets
//    sidepods → swept trapezoids, wide at rear, cut at front
//    cockpit  → teardrop dome with specular highlight
//    wings    → swept leading-edge triangles front & rear
// ══════════════════════════════════════════════════════════
function drawCar(x, y, w, h, pal, isPlayer) {
  const cx = x + w/2;
  ctx.save();

  // ── helper: fill arbitrary polygon ──────────────────────
  function poly(pts, style) {
    ctx.fillStyle = style;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i=1;i<pts.length;i++) ctx.lineTo(pts[i][0],pts[i][1]);
    ctx.closePath(); ctx.fill();
  }
  function polyStroke(pts, style, lw) {
    ctx.strokeStyle = style; ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i=1;i<pts.length;i++) ctx.lineTo(pts[i][0],pts[i][1]);
    ctx.closePath(); ctx.stroke();
  }

  // convenience coords (normalised to w/h)
  const X = f => cx + f*w;
  const Y = f => y  + f*h;

  // ─────────────────────────────────────────────────────────
  // 1. EXHAUST JETS  (drawn first — behind everything)
  // ─────────────────────────────────────────────────────────
  const jetColor = isPlayer ? pal.accent : pal.light;
  for (const jx of [X(-.18), X(.18)]) {
    const jLen = h * (.10 + Math.random()*.06);
    const jg = ctx.createLinearGradient(jx, Y(1), jx, Y(1)+jLen);
    jg.addColorStop(0,   hexA(jetColor, .95));
    jg.addColorStop(.45, hexA(jetColor, .5));
    jg.addColorStop(1,   "rgba(0,0,0,0)");
    ctx.fillStyle = jg;
    ctx.beginPath();
    ctx.ellipse(jx, Y(1)+jLen*.4, w*.055, jLen*.55, 0, 0, Math.PI*2);
    ctx.fill();
  }

  // ─────────────────────────────────────────────────────────
  // 2. WHEELS  (behind body)
  // ─────────────────────────────────────────────────────────
  const tw = w*.24, th = h*.175;
  const txOff = -tw*.08; // protrude slightly outside body
  [
    [x+txOff,            y+h*.07 ],  // front-left
    [x+w-txOff-tw,       y+h*.07 ],  // front-right
    [x+txOff,            y+h*.72 ],  // rear-left
    [x+w-txOff-tw,       y+h*.72 ],  // rear-right
  ].forEach(([tx,ty]) => drawWheel(tx, ty, tw, th, pal));

  // ─────────────────────────────────────────────────────────
  // 3. REAR WING  (wide swept blade, below body)
  // ─────────────────────────────────────────────────────────
  const rwy = Y(.77);
  const rwHalfW = w*.56;
  // Blade — swept back at outer ends (like a delta wing)
  const rwg = ctx.createLinearGradient(X(-0),rwy,X(0),rwy+h*.06);
  rwg.addColorStop(0, lighten(pal.body,.1));
  rwg.addColorStop(1, pal.dark);
  poly([
    [X(-.56), rwy+h*.055],   // outer-left bottom
    [X(-.56), rwy+h*.015],   // outer-left top
    [X(-.22), rwy          ],   // inner-left top
    [X( .22), rwy          ],   // inner-right top
    [X( .56), rwy+h*.015],   // outer-right top
    [X( .56), rwy+h*.055],   // outer-right bottom
    [X( .22), rwy+h*.042],   // inner-right bottom
    [X(-.22), rwy+h*.042],   // inner-left bottom
  ], rwg);
  // Wing pillars
  ctx.fillStyle = pal.dark;
  ctx.fillRect(X(-.155), rwy+h*.042, w*.06, h*.038);
  ctx.fillRect(X( .095), rwy+h*.042, w*.06, h*.038);
  // Accent stripe on wing
  ctx.fillStyle = pal.accent; ctx.globalAlpha=.55;
  ctx.fillRect(X(-.50), rwy+h*.022, w*1.0, h*.016);
  ctx.globalAlpha=1;
  // Endplates
  ctx.fillStyle = pal.dark;
  poly([[X(-.56),rwy+h*.015],[X(-.56),rwy+h*.065],[X(-.50),rwy+h*.065],[X(-.50),rwy+h*.015]], pal.dark);
  poly([[X( .50),rwy+h*.015],[X( .50),rwy+h*.065],[X( .56),rwy+h*.065],[X( .56),rwy+h*.015]], pal.dark);

  // ─────────────────────────────────────────────────────────
  // 4. SIDEPODS  — swept trapezoids, angular outer edge
  //    Wide at rear, narrow at front, with a hard crease line
  // ─────────────────────────────────────────────────────────
  // Left pod
  const podFrontY = Y(.24), podRearY = Y(.76);
  const podInnerFL = X(-.20), podInnerRL = X(-.24);
  const podOuterFL = X(-.46), podOuterRL = X(-.50);
  // Main pod face (top-lit facet)
  const plg = ctx.createLinearGradient(podOuterFL,0,podInnerFL,0);
  plg.addColorStop(0, pal.dark);
  plg.addColorStop(.4, pal.body);
  plg.addColorStop(.85, lighten(pal.body,.18));
  plg.addColorStop(1, pal.body);
  poly([
    [podInnerFL, podFrontY],
    [podOuterFL, podFrontY+h*.04],
    [podOuterRL, podRearY ],
    [podInnerRL, podRearY ],
  ], plg);
  // Pod crease / shadow facet (lower strip)
  poly([
    [podOuterFL, podFrontY+h*.04],
    [podOuterFL, podFrontY+h*.10],
    [podOuterRL, podRearY+h*.028],
    [podOuterRL, podRearY],
  ], pal.dark);
  // Cooling intake (dark triangular opening near front)
  poly([
    [podOuterFL+w*.03, podFrontY+h*.05],
    [podOuterFL+w*.03, podFrontY+h*.14],
    [podOuterFL+w*.10, podFrontY+h*.14],
    [podOuterFL+w*.12, podFrontY+h*.05],
  ], "rgba(0,0,0,.75)");

  // Right pod (mirrored)
  const podInnerFR = X(.20), podInnerRR = X(.24);
  const podOuterFR = X(.46), podOuterRR = X(.50);
  const prg = ctx.createLinearGradient(podInnerFR,0,podOuterFR,0);
  prg.addColorStop(0, pal.body);
  prg.addColorStop(.15, lighten(pal.body,.18));
  prg.addColorStop(.6, pal.body);
  prg.addColorStop(1, pal.dark);
  poly([
    [podInnerFR, podFrontY],
    [podOuterFR, podFrontY+h*.04],
    [podOuterRR, podRearY ],
    [podInnerRR, podRearY ],
  ], prg);
  poly([
    [podOuterFR, podFrontY+h*.04],
    [podOuterFR, podFrontY+h*.10],
    [podOuterRR, podRearY+h*.028],
    [podOuterRR, podRearY],
  ], pal.dark);
  poly([
    [podOuterFR-w*.03, podFrontY+h*.05],
    [podOuterFR-w*.03, podFrontY+h*.14],
    [podOuterFR-w*.10, podFrontY+h*.14],
    [podOuterFR-w*.12, podFrontY+h*.05],
  ], "rgba(0,0,0,.75)");

  // ─────────────────────────────────────────────────────────
  // 5. CENTRAL BODY  — arrowhead/diamond polygon
  //    Wide at rear-centre, tapers sharply to nose point
  //    Has angled facet planes like the reference image
  // ─────────────────────────────────────────────────────────
  // Main fuselage shape: 8-point polygon
  const bRearW  = w*.28;   // half-width at rear
  const bMidW   = w*.25;   // half-width at cockpit zone
  const bFrontW = w*.13;   // half-width at nose shoulder
  const bNoseTip = w*.035; // nose-tip half-width (very narrow)

  const fuselagePts = [
    [cx - bRearW,  Y(.74)],   // rear-left
    [cx - bMidW,   Y(.44)],   // left waist
    [cx - bFrontW, Y(.16)],   // left shoulder
    [cx - bNoseTip,Y(.01)],   // nose-left
    [cx + bNoseTip,Y(.01)],   // nose-right
    [cx + bFrontW, Y(.16)],   // right shoulder
    [cx + bMidW,   Y(.44)],   // right waist
    [cx + bRearW,  Y(.74)],   // rear-right
  ];

  // Base fill: left-to-right gradient (simulate overhead lighting)
  const fg = ctx.createLinearGradient(cx-bRearW,0,cx+bRearW,0);
  fg.addColorStop(0,    pal.dark);
  fg.addColorStop(.18,  pal.body);
  fg.addColorStop(.42,  lighten(pal.body,.30));  // bright highlight stripe left-of-centre
  fg.addColorStop(.55,  lighten(pal.body,.15));
  fg.addColorStop(.75,  pal.body);
  fg.addColorStop(1,    pal.dark);
  poly(fuselagePts, fg);

  // Facet crease lines (sharp painted edges visible on real carbon-fibre bodywork)
  ctx.save();
  ctx.globalAlpha = .28;
  polyStroke(fuselagePts, lighten(pal.body,.55), 1);
  ctx.globalAlpha = 1;
  ctx.restore();

  // Left angled face panel (darker — side-shadow facet)
  poly([
    [cx-bRearW,  Y(.74)],
    [cx-bMidW,   Y(.44)],
    [cx-bFrontW, Y(.16)],
    [cx-w*.20,   Y(.16)],
    [cx-w*.18,   Y(.44)],
    [cx-w*.22,   Y(.74)],
  ], `rgba(0,0,0,.18)`);

  // Right angled face panel
  poly([
    [cx+bRearW,  Y(.74)],
    [cx+bMidW,   Y(.44)],
    [cx+bFrontW, Y(.16)],
    [cx+w*.20,   Y(.16)],
    [cx+w*.18,   Y(.44)],
    [cx+w*.22,   Y(.74)],
  ], `rgba(0,0,0,.18)`);

  // Spine accent stripe — tapered
  const sg = ctx.createLinearGradient(0,Y(.01),0,Y(.74));
  sg.addColorStop(0,   hexA(pal.accent,.9));
  sg.addColorStop(.5,  hexA(pal.accent,.6));
  sg.addColorStop(1,   hexA(pal.accent,.15));
  poly([
    [cx-w*.04, Y(.01)],
    [cx+w*.04, Y(.01)],
    [cx+w*.055,Y(.74)],
    [cx-w*.055,Y(.74)],
  ], sg);

  // ─────────────────────────────────────────────────────────
  // 6. COCKPIT DOME  — teardrop with gloss specular
  // ─────────────────────────────────────────────────────────
  // Outer surround (carbon-dark bezel)
  const czY = Y(.26), czH = h*.32, czW = w*.22;
  ctx.fillStyle = "#080A10";
  ctx.beginPath();
  ctx.moveTo(cx-czW*.55, czY+czH);
  ctx.bezierCurveTo(cx-czW*.62,czY+czH*.6, cx-czW*.45,czY, cx,czY-h*.012);
  ctx.bezierCurveTo(cx+czW*.45,czY, cx+czW*.62,czY+czH*.6, cx+czW*.55,czY+czH);
  ctx.closePath(); ctx.fill();

  // Glass lens — radial gradient for dome illusion
  const gg = ctx.createRadialGradient(cx-czW*.15, czY+czH*.22, czH*.04,
                                       cx,         czY+czH*.5,  czH*.5);
  gg.addColorStop(0,   "rgba(180,210,255,.75)");
  gg.addColorStop(.3,  isPlayer?"rgba(30,80,200,.70)":"rgba(15,15,40,.80)");
  gg.addColorStop(.75, isPlayer?"rgba(5,20,100,.88)" :"rgba(5,5,20,.90)");
  gg.addColorStop(1,   "rgba(0,0,0,.95)");
  ctx.fillStyle = gg;
  ctx.beginPath();
  ctx.moveTo(cx-czW*.44, czY+czH);
  ctx.bezierCurveTo(cx-czW*.50,czY+czH*.6, cx-czW*.35,czY+h*.01, cx,czY+h*.005);
  ctx.bezierCurveTo(cx+czW*.35,czY+h*.01, cx+czW*.50,czY+czH*.6, cx+czW*.44,czY+czH);
  ctx.closePath(); ctx.fill();

  // Specular highlight — bright comma-shaped gleam top-left
  ctx.save();
  ctx.globalAlpha = .55;
  const spec = ctx.createRadialGradient(cx-czW*.18,czY+czH*.14,0, cx-czW*.18,czY+czH*.14,czH*.28);
  spec.addColorStop(0,   "rgba(255,255,255,.9)");
  spec.addColorStop(.4,  "rgba(200,220,255,.4)");
  spec.addColorStop(1,   "rgba(0,0,0,0)");
  ctx.fillStyle = spec;
  ctx.beginPath();
  ctx.ellipse(cx-czW*.18, czY+czH*.18, czW*.28, czH*.20, -0.4, 0, Math.PI*2);
  ctx.fill();
  ctx.restore();

  // Halo bar
  ctx.save();
  ctx.strokeStyle = "#0A0C14"; ctx.lineWidth = w*.05;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(cx-czW*.42, czY+czH*.08);
  ctx.bezierCurveTo(cx-czW*.30,czY-h*.02, cx+czW*.30,czY-h*.02, cx+czW*.42,czY+czH*.08);
  ctx.stroke();
  ctx.restore();

  // ─────────────────────────────────────────────────────────
  // 7. FRONT WING  — two swept delta planes + nose tip
  // ─────────────────────────────────────────────────────────
  const fwY = Y(.0);
  const fwg = ctx.createLinearGradient(X(-.48),0,X(.48),0);
  fwg.addColorStop(0, pal.dark); fwg.addColorStop(.5, lighten(pal.body,.1)); fwg.addColorStop(1, pal.dark);

  // Left delta flap
  poly([
    [cx-w*.01, Y(.02)],         // inner-front
    [cx-w*.27, Y(.02)],         // inner-rear edge of nose
    [cx-w*.48, Y(.06)],         // outer tip
    [cx-w*.46, Y(.10)],         // outer rear
    [cx-w*.24, Y(.07)],         // mid
    [cx-w*.01, Y(.055)],        // inner-rear
  ], fwg);
  // Right delta flap
  poly([
    [cx+w*.01, Y(.02)],
    [cx+w*.27, Y(.02)],
    [cx+w*.48, Y(.06)],
    [cx+w*.46, Y(.10)],
    [cx+w*.24, Y(.07)],
    [cx+w*.01, Y(.055)],
  ], fwg);
  // Front wing endplates
  ctx.fillStyle = pal.dark;
  poly([[cx-w*.46,Y(.04)],[cx-w*.50,Y(.04)],[cx-w*.50,Y(.11)],[cx-w*.46,Y(.11)]], pal.dark);
  poly([[cx+w*.46,Y(.04)],[cx+w*.50,Y(.04)],[cx+w*.50,Y(.11)],[cx+w*.46,Y(.11)]], pal.dark);
  // Nose tip
  const ntg = ctx.createLinearGradient(cx-w*.04,0,cx+w*.04,0);
  ntg.addColorStop(0, pal.dark); ntg.addColorStop(.5, lighten(pal.body,.25)); ntg.addColorStop(1, pal.dark);
  poly([
    [cx-bNoseTip, Y(.01)],
    [cx-w*.025,   Y(.055)],
    [cx+w*.025,   Y(.055)],
    [cx+bNoseTip, Y(.01)],
  ], ntg);

  // ─────────────────────────────────────────────────────────
  // 8. LIGHTS
  // ─────────────────────────────────────────────────────────
  ctx.save();
  if (isPlayer) {
    // Headlights: two bright slivers behind front wing endplates
    ctx.shadowColor = "#99CCFF"; ctx.shadowBlur = 16;
    ctx.fillStyle = "#DDEEFF";
    poly([[cx-w*.44,Y(.065)],[cx-w*.28,Y(.065)],[cx-w*.28,Y(.09)],[cx-w*.44,Y(.09)]], "#DDEEFF");
    poly([[cx+w*.28,Y(.065)],[cx+w*.44,Y(.065)],[cx+w*.44,Y(.09)],[cx+w*.28,Y(.09)]], "#DDEEFF");
    // DRL strip along front wing root
    ctx.strokeStyle="rgba(160,200,255,.65)"; ctx.lineWidth=1.2;
    ctx.beginPath(); ctx.moveTo(cx-w*.25,Y(.04)); ctx.lineTo(cx-w*.03,Y(.04)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx+w*.03,Y(.04)); ctx.lineTo(cx+w*.25,Y(.04)); ctx.stroke();
  } else {
    // Tail lights: glowing red trapezoids
    ctx.shadowColor = "#FF2200"; ctx.shadowBlur = 18;
    ctx.fillStyle = "#FF3311";
    poly([[cx-w*.22,Y(.87)],[cx-w*.06,Y(.87)],[cx-w*.05,Y(.91)],[cx-w*.23,Y(.91)]], "#FF3311");
    poly([[cx+w*.06,Y(.87)],[cx+w*.22,Y(.87)],[cx+w*.23,Y(.91)],[cx+w*.05,Y(.91)]], "#FF3311");
    // Inner brake glow
    ctx.shadowBlur=8; ctx.fillStyle="rgba(255,60,0,.4)";
    ctx.fillRect(cx-w*.15, Y(.91), w*.30, h*.015);
  }
  ctx.restore();

  ctx.restore(); // end car
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
function hexA(hex, a) {
  const [r,g,b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
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
