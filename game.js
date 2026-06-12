/* ══════════════════════════════════════════════════════════
   BASE RACER — game.js  (Rally Edition)
   Top-down rally racer + Base (EVM chain 8453) Web3
══════════════════════════════════════════════════════════ */
"use strict";

// ─── CONSTANTS ────────────────────────────────────────────
const BASE_CHAIN_ID   = 8453;
const BASE_RPC        = "https://mainnet.base.org";
const BASE_CHAIN_HEX  = "0x" + BASE_CHAIN_ID.toString(16);
const BASESCAN_TX     = "https://basescan.org/tx/";
const SCORE_PER_SEC   = 5;
const LANE_COUNT      = 5;
const INITIAL_SPEED   = 200;
const SPEED_STEP      = 30;       // added every 10 seconds
const SPAWN_INTERVAL  = 1.5;

// Rally car color schemes: [bodyColor, accentColor, glowColor]
const RALLY_SCHEMES = [
  ["#CC1111","#FF4444","#FF0000"],   // red rally
  ["#116611","#44FF44","#00FF00"],   // green rally
  ["#AA6600","#FFAA00","#FF8800"],   // orange
  ["#880088","#DD44DD","#FF00FF"],   // purple
  ["#008888","#00DDDD","#00FFFF"],   // teal
  ["#996600","#FFDD00","#FFCC00"],   // yellow
];

// ─── STATE ────────────────────────────────────────────────
let wallet = null;
let gameLoop = null;
let score = 0, elapsed = 0;
let playerX = 0, playerY = 0, playerW = 0, playerH = 0;
let lanes = [];
let opponents = [];
let roadOffset = 0;
let lastTs = 0;
let gameRunning = false;
let bestScore = 0, gamesPlayed = 0;
let currentSpeed = INITIAL_SPEED;
let lastSpeedLevel = 0;
let speedFlashTimer = 0;  // flash HUD on speed up

// Road marking state
let solidLineOffset = 0;

// ─── DOM ──────────────────────────────────────────────────
const screens = {
  connect:  document.getElementById("screen-connect"),
  start:    document.getElementById("screen-start"),
  game:     document.getElementById("screen-game"),
  gameover: document.getElementById("screen-gameover"),
};
const canvas    = document.getElementById("game-canvas");
const ctx       = canvas.getContext("2d");
const hudScore  = document.getElementById("hud-score");
const hudTime   = document.getElementById("hud-time");
const healthBar = document.getElementById("health-bar");

function showScreen(name) {
  Object.entries(screens).forEach(([k, el]) =>
    el.classList.toggle("active", k === name));
}

// ─── SPEED LINES (connect screen deco) ────────────────────
(function spawnSpeedLines() {
  const wrap = document.getElementById("speedlines");
  if (!wrap) return;
  for (let i = 0; i < 18; i++) {
    const line = document.createElement("div");
    line.style.cssText = `
      position:absolute;left:${Math.random()*100}%;top:0;
      width:1px;height:${30+Math.random()*60}px;
      background:linear-gradient(180deg,transparent,rgba(0,82,255,0.4),transparent);
      animation:fall ${0.4+Math.random()*0.6}s ${-Math.random()}s linear infinite;`;
    wrap.appendChild(line);
  }
  const s = document.createElement("style");
  s.textContent = `@keyframes fall{from{top:-80px}to{top:110%}}`;
  document.head.appendChild(s);
})();

// ─── WEB3 ─────────────────────────────────────────────────
async function connectWallet() {
  if (!window.ethereum) {
    alert("No EVM wallet detected.\nPlease install MetaMask or a compatible wallet.");
    return;
  }
  try {
    await window.ethereum.request({ method: "eth_requestAccounts" });
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: BASE_CHAIN_HEX }],
      });
    } catch (swErr) {
      if (swErr.code === 4902) {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: BASE_CHAIN_HEX, chainName: "Base",
            nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
            rpcUrls: [BASE_RPC],
            blockExplorerUrls: ["https://basescan.org"],
          }],
        });
      } else throw swErr;
    }
    const provider = new ethers.BrowserProvider(window.ethereum);
    const signer   = await provider.getSigner();
    const address  = await signer.getAddress();
    wallet = { address, provider, signer };
    loadPlayerData();
    updateStartScreen();
    showScreen("start");
  } catch (err) {
    console.error("Wallet connect error:", err);
    alert("Wallet connection failed: " + (err.message || err));
  }
}

// ─── LOCAL STORAGE ────────────────────────────────────────
function storageKey(addr) { return "base_racer_" + addr.toLowerCase(); }
function loadPlayerData() {
  if (!wallet) return;
  const raw = localStorage.getItem(storageKey(wallet.address));
  if (raw) { try { const d=JSON.parse(raw); bestScore=d.bestScore||0; gamesPlayed=d.gamesPlayed||0; } catch{} }
}
function savePlayerData() {
  if (!wallet) return;
  localStorage.setItem(storageKey(wallet.address), JSON.stringify({ bestScore, gamesPlayed }));
}
function updateStartScreen() {
  document.getElementById("wallet-address-display").textContent =
    wallet.address.slice(0,6) + "…" + wallet.address.slice(-4);
  document.getElementById("best-score-display").textContent   = bestScore;
  document.getElementById("games-played-display").textContent = gamesPlayed;
}

// ─── ON-CHAIN SCORE ───────────────────────────────────────
async function recordScoreOnChain(finalScore, survivalSecs) {
  if (!wallet) return;
  const txStatus = document.getElementById("tx-status");
  const txDone   = document.getElementById("tx-done");
  const txMsg    = document.getElementById("tx-msg");
  const txLink   = document.getElementById("tx-link");
  txStatus.classList.remove("hidden");
  txDone.classList.add("hidden");
  try {
    const memo    = `BASE RACER | Score: ${finalScore} | Time: ${survivalSecs}s`;
    const hexData = "0x" + Array.from(new TextEncoder().encode(memo))
      .map(b => b.toString(16).padStart(2,"0")).join("");
    txMsg.textContent = "Confirm in your wallet…";
    const tx = await wallet.signer.sendTransaction({ to: wallet.address, value: 0n, data: hexData });
    txMsg.textContent = "Broadcasting to Base…";
    await tx.wait(1);
    txStatus.classList.add("hidden");
    txDone.classList.remove("hidden");
    txLink.href = BASESCAN_TX + tx.hash;
  } catch (err) {
    txStatus.classList.add("hidden");
    if (err.code !== 4001) console.error("TX error:", err);
  }
}

// ─── CANVAS SETUP ─────────────────────────────────────────
function resizeCanvas() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  setupLanes();
}
function setupLanes() {
  const W = canvas.width;
  const laneW = W / LANE_COUNT;
  lanes = Array.from({ length: LANE_COUNT }, (_, i) => ({
    x: i * laneW, cx: i * laneW + laneW / 2, w: laneW,
  }));
  playerW = laneW * 0.58;
  playerH = playerW * 1.85;
  playerX = lanes[Math.floor(LANE_COUNT / 2)].cx - playerW / 2;
  playerY = canvas.height - playerH - 50;
}
window.addEventListener("resize", () => { resizeCanvas(); if (!gameRunning) drawIdleBg(); });

// ─── INPUT ────────────────────────────────────────────────
const keys = { left: false, right: false };
window.addEventListener("keydown", e => {
  if (e.key==="ArrowLeft"  ||e.key==="a"||e.key==="A") keys.left =true;
  if (e.key==="ArrowRight" ||e.key==="d"||e.key==="D") keys.right=true;
});
window.addEventListener("keyup", e => {
  if (e.key==="ArrowLeft"  ||e.key==="a"||e.key==="A") keys.left =false;
  if (e.key==="ArrowRight" ||e.key==="d"||e.key==="D") keys.right=false;
});
let touchStartX = null;
canvas.addEventListener("touchstart", e => { touchStartX = e.touches[0].clientX; }, { passive:true });
canvas.addEventListener("touchmove",  e => {
  if (touchStartX===null) return;
  const dx = e.touches[0].clientX - touchStartX;
  if (Math.abs(dx)>10) { keys.left=dx<0; keys.right=dx>0; }
}, { passive:true });
canvas.addEventListener("touchend", () => { keys.left=keys.right=false; touchStartX=null; });

// ─── GAME INIT ────────────────────────────────────────────
function startGame() {
  score=0; elapsed=0; roadOffset=0; solidLineOffset=0;
  opponents=[]; currentSpeed=INITIAL_SPEED; lastSpeedLevel=0; speedFlashTimer=0;
  lastTs=performance.now(); gameRunning=true;
  resizeCanvas(); updateHUD();
  if (gameLoop) cancelAnimationFrame(gameLoop);
  requestAnimationFrame(tick);
}

// ─── OPPONENTS ────────────────────────────────────────────
let spawnTimer = 0;
function spawnOpponent(speed) {
  const lane   = lanes[Math.floor(Math.random() * LANE_COUNT)];
  const scheme = RALLY_SCHEMES[Math.floor(Math.random() * RALLY_SCHEMES.length)];
  opponents.push({
    x: lane.cx - playerW / 2,
    y: -playerH,
    w: playerW, h: playerH,
    speed,
    body:   scheme[0],
    accent: scheme[1],
    glow:   scheme[2],
  });
}

// ─── MAIN TICK ────────────────────────────────────────────
function tick(ts) {
  if (!gameRunning) return;
  const dt = Math.min((ts - lastTs) / 1000, 0.1);
  lastTs = ts;
  elapsed += dt;
  score   += SCORE_PER_SEC * dt;

  // Speed up every 10 seconds
  const speedLevel = Math.floor(elapsed / 10);
  if (speedLevel > lastSpeedLevel) {
    lastSpeedLevel = speedLevel;
    currentSpeed   = INITIAL_SPEED + speedLevel * SPEED_STEP;
    speedFlashTimer = 1.5;  // seconds to show flash
  }
  if (speedFlashTimer > 0) speedFlashTimer -= dt;

  // Scroll road markings
  roadOffset    = (roadOffset    + currentSpeed * dt) % 80;
  solidLineOffset = (solidLineOffset + currentSpeed * dt) % (canvas.height);

  // Player movement
  const pSpeed = currentSpeed * 1.5;
  if (keys.left)  playerX = Math.max(0,              playerX - pSpeed * dt);
  if (keys.right) playerX = Math.min(canvas.width - playerW, playerX + pSpeed * dt);

  // Spawn + move opponents
  spawnTimer += dt;
  if (spawnTimer >= SPAWN_INTERVAL) {
    spawnTimer = 0;
    const relSpeed = currentSpeed * (0.5 + Math.random() * 0.8);
    spawnOpponent(relSpeed);
  }
  for (const op of opponents) op.y += op.speed * dt;
  opponents = opponents.filter(op => op.y < canvas.height + 20);

  // Collision
  let crashed = false;
  for (const op of opponents) {
    if (rectsOverlap(playerX+4, playerY+4, playerW-8, playerH-8,
                     op.x+4,   op.y+4,   op.w-8,   op.h-8)) {
      crashed = true; break;
    }
  }

  drawGame();
  updateHUD();

  if (crashed) { gameRunning = false; endGame(); return; }
  gameLoop = requestAnimationFrame(tick);
}

function rectsOverlap(ax,ay,aw,ah,bx,by,bw,bh) {
  return ax<bx+bw && ax+aw>bx && ay<by+bh && ay+ah>by;
}

// ─── DRAWING ──────────────────────────────────────────────
function drawGame() {
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  drawRoad(W, H);

  // Speed-up flash overlay
  if (speedFlashTimer > 0) {
    const alpha = Math.min(0.35, speedFlashTimer * 0.4);
    ctx.fillStyle = `rgba(0,120,255,${alpha})`;
    ctx.fillRect(0, 0, W, H);
    // "SPEED UP!" text
    if (speedFlashTimer > 0.8) {
      ctx.save();
      ctx.font = `bold ${Math.floor(W*0.06)}px 'Segoe UI', sans-serif`;
      ctx.textAlign = "center";
      ctx.fillStyle = "#FFFFFF";
      ctx.shadowColor = "#0052FF";
      ctx.shadowBlur = 20;
      ctx.fillText("⚡ SPEED UP!", W/2, H*0.22);
      ctx.restore();
    }
  }

  for (const op of opponents)
    drawRallyCar(op.x, op.y, op.w, op.h, op.body, op.accent, op.glow, false);

  drawRallyCar(playerX, playerY, playerW, playerH, "#003399","#0052FF","#60A5FA", true);
}

// ─── REALISTIC ROAD ───────────────────────────────────────
function drawRoad(W, H) {
  // Asphalt base
  ctx.fillStyle = "#1C1C1E";
  ctx.fillRect(0, 0, W, H);

  // Subtle asphalt texture (horizontal lines)
  for (let y = 0; y < H; y += 4) {
    const shade = 28 + (y % 8 === 0 ? 4 : 0);
    ctx.fillStyle = `rgb(${shade},${shade},${shade+2})`;
    ctx.fillRect(0, y, W, 2);
  }

  const laneW = W / LANE_COUNT;

  // ── Solid white edge lines (left + right kerb) ──
  ctx.strokeStyle = "#FFFFFF";
  ctx.lineWidth   = 4;
  ctx.setLineDash([]);
  // Left edge
  ctx.beginPath(); ctx.moveTo(3, 0); ctx.lineTo(3, H); ctx.stroke();
  // Right edge
  ctx.beginPath(); ctx.moveTo(W-3, 0); ctx.lineTo(W-3, H); ctx.stroke();

  // ── Yellow center double line (lanes 2|3 boundary = center) ──
  const centerX = W / 2;
  ctx.strokeStyle = "#FFD700";
  ctx.lineWidth   = 2.5;
  ctx.setLineDash([]);
  ctx.beginPath(); ctx.moveTo(centerX - 3, 0); ctx.lineTo(centerX - 3, H); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(centerX + 3, 0); ctx.lineTo(centerX + 3, H); ctx.stroke();

  // ── White dashed lane dividers (all inner lanes except center) ──
  const dashLen = 40, gapLen = 40;
  ctx.strokeStyle = "rgba(255,255,255,0.75)";
  ctx.lineWidth   = 2;
  ctx.setLineDash([dashLen, gapLen]);

  for (let i = 1; i < LANE_COUNT; i++) {
    const lx = i * laneW;
    // skip center lines (already drawn yellow)
    if (Math.abs(lx - centerX) < 6) continue;
    ctx.lineDashOffset = -roadOffset;
    ctx.beginPath(); ctx.moveTo(lx, 0); ctx.lineTo(lx, H); ctx.stroke();
  }
  ctx.setLineDash([]);

  // ── Rumble strips on edges (red/white checkers) ──
  const stripW = laneW * 0.09;
  const blockH = 28;
  for (let y = 0; y < H + blockH; y += blockH) {
    const scrolledY = y - (roadOffset % blockH);
    const isRed = Math.floor(scrolledY / blockH) % 2 === 0;
    // Left strip
    ctx.fillStyle = isRed ? "rgba(220,30,30,0.85)" : "rgba(255,255,255,0.85)";
    ctx.fillRect(4, scrolledY, stripW, blockH - 1);
    // Right strip
    ctx.fillStyle = isRed ? "rgba(255,255,255,0.85)" : "rgba(220,30,30,0.85)";
    ctx.fillRect(W - 4 - stripW, scrolledY, stripW, blockH - 1);
  }

  // ── Distance markers (small tick marks on edge lines) ──
  ctx.strokeStyle = "rgba(255,255,255,0.4)";
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  const tickSpacing = 120;
  for (let y = -(roadOffset % tickSpacing); y < H; y += tickSpacing) {
    ctx.beginPath(); ctx.moveTo(3+stripW+1, y); ctx.lineTo(3+stripW+12, y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(W-3-stripW-1, y); ctx.lineTo(W-3-stripW-12, y); ctx.stroke();
  }

  // ── Subtle road surface sheen ──
  const sheen = ctx.createLinearGradient(0, 0, W, 0);
  sheen.addColorStop(0,    "rgba(0,0,0,0.18)");
  sheen.addColorStop(0.15, "rgba(0,0,0,0)");
  sheen.addColorStop(0.5,  "rgba(255,255,255,0.025)");
  sheen.addColorStop(0.85, "rgba(0,0,0,0)");
  sheen.addColorStop(1,    "rgba(0,0,0,0.18)");
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, W, H);
}

// ─── RALLY CAR (top-down F1/WRC style) ────────────────────
function drawRallyCar(x, y, w, h, bodyColor, accentColor, glowColor, isPlayer) {
  ctx.save();

  const cx = x + w / 2;

  // ── Exhaust / boost flames (player only) ──
  if (isPlayer) {
    const flameW = w * 0.12;
    const flameH = h * 0.18 + Math.random() * h * 0.06;
    // Left exhaust
    drawFlame(cx - w*0.22, y + h + 2, flameW, flameH, glowColor);
    // Right exhaust
    drawFlame(cx + w*0.22, y + h + 2, flameW, flameH, glowColor);
  }

  // ── Car glow ──
  ctx.shadowColor = glowColor;
  ctx.shadowBlur  = isPlayer ? 22 : 10;

  // ── Rear wing (spoiler) ──
  ctx.fillStyle = isPlayer ? "#0a1a44" : darken(bodyColor, 0.55);
  const wingY = y + h * 0.80;
  const wingW = w * 1.08, wingH = h * 0.07;
  ctx.fillRect(cx - wingW/2, wingY, wingW, wingH);
  // Wing endplates
  ctx.fillRect(cx - wingW/2,       wingY - h*0.03, w*0.06, wingH + h*0.03);
  ctx.fillRect(cx + wingW/2-w*0.06, wingY - h*0.03, w*0.06, wingH + h*0.03);

  // ── Main body (elongated teardrop / F1 shape) ──
  ctx.fillStyle = bodyColor;
  ctx.shadowBlur = isPlayer ? 16 : 8;
  // Pontoons (side pods)
  const podW = w * 0.22, podH = h * 0.55;
  const podY = y + h * 0.28;
  roundRect(ctx, x + w*0.02,       podY, podW, podH, w*0.06);
  ctx.fill();
  roundRect(ctx, x + w - w*0.02 - podW, podY, podW, podH, w*0.06);
  ctx.fill();

  // Center monocoque
  const monoX = cx - w*0.28, monoW = w*0.56;
  roundRect(ctx, monoX, y + h*0.1, monoW, h*0.72, w*0.12);
  ctx.fill();

  // Nose cone (pointed front)
  ctx.beginPath();
  ctx.moveTo(monoX,           y + h*0.1);
  ctx.lineTo(monoX + monoW,   y + h*0.1);
  ctx.lineTo(cx,              y + h*0.01);
  ctx.closePath();
  ctx.fill();

  // ── Livery accent stripes ──
  ctx.fillStyle = accentColor;
  ctx.globalAlpha = 0.85;
  ctx.shadowBlur  = 4;
  ctx.shadowColor = accentColor;
  // Central spine stripe
  roundRect(ctx, cx - w*0.055, y + h*0.04, w*0.11, h*0.65, 2);
  ctx.fill();
  // Side accent on pods
  ctx.globalAlpha = 0.6;
  ctx.fillRect(x + w*0.03,            podY + podH*0.35, podW - w*0.02, podH*0.12);
  ctx.fillRect(x + w - w*0.01 - podW, podY + podH*0.35, podW - w*0.02, podH*0.12);
  ctx.globalAlpha = 1;

  // ── Cockpit canopy ──
  ctx.fillStyle = isPlayer ? "#0a2060" : darken(bodyColor, 0.4);
  ctx.shadowBlur = 0;
  roundRect(ctx, cx - w*0.14, y + h*0.28, w*0.28, h*0.26, w*0.07);
  ctx.fill();
  // Cockpit glint
  ctx.fillStyle = "rgba(180,210,255,0.18)";
  roundRect(ctx, cx - w*0.09, y + h*0.30, w*0.12, h*0.10, w*0.04);
  ctx.fill();

  // ── Headlights / taillights ──
  ctx.shadowBlur = 14;
  if (isPlayer) {
    ctx.fillStyle  = "#DDEEFF";
    ctx.shadowColor = "#AACCFF";
    // Headlights (front)
    ctx.fillRect(cx - w*0.22, y + h*0.04, w*0.12, h*0.045);
    ctx.fillRect(cx + w*0.10, y + h*0.04, w*0.12, h*0.045);
  } else {
    // Taillights (red) — opponents face away
    ctx.fillStyle  = "#FF2200";
    ctx.shadowColor = "#FF0000";
    ctx.fillRect(cx - w*0.22, y + h*0.88, w*0.12, h*0.045);
    ctx.fillRect(cx + w*0.10, y + h*0.88, w*0.12, h*0.045);
  }

  // ── Front wing ──
  ctx.shadowBlur = 0;
  ctx.fillStyle = isPlayer ? "#0a1a44" : darken(bodyColor, 0.55);
  const fwY = y + h*0.01, fwW = w*0.95, fwH = h*0.05;
  ctx.fillRect(cx - fwW/2, fwY, fwW, fwH);

  // ── Wheels (large F1 style) ──
  ctx.shadowBlur  = 6;
  ctx.shadowColor = "#000";
  const tireW = w * 0.21, tireH = h * 0.165;
  const tireInset = -tireW * 0.15;
  // Front left
  drawTire(ctx, x + tireInset,            y + h*0.08, tireW, tireH, accentColor);
  // Front right
  drawTire(ctx, x + w - tireInset - tireW, y + h*0.08, tireW, tireH, accentColor);
  // Rear left
  drawTire(ctx, x + tireInset,            y + h*0.72, tireW, tireH, accentColor);
  // Rear right
  drawTire(ctx, x + w - tireInset - tireW, y + h*0.72, tireW, tireH, accentColor);

  ctx.restore();
}

function drawTire(ctx, x, y, w, h, rimColor) {
  // Tire rubber
  ctx.fillStyle = "#111111";
  roundRect(ctx, x, y, w, h, w * 0.25);
  ctx.fill();
  // Rim
  ctx.fillStyle = rimColor;
  const rp = w * 0.22;
  roundRect(ctx, x+rp, y+rp*0.8, w-rp*2, h-rp*1.6, w*0.1);
  ctx.fill();
  // Center hub
  ctx.fillStyle = "#222";
  ctx.beginPath();
  ctx.arc(x+w/2, y+h/2, w*0.12, 0, Math.PI*2);
  ctx.fill();
}

function drawFlame(cx, y, fw, fh, color) {
  // Animated exhaust flame
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur  = 10;
  const grad = ctx.createLinearGradient(cx, y, cx, y + fh);
  grad.addColorStop(0,   color);
  grad.addColorStop(0.5, "rgba(255,150,0,0.6)");
  grad.addColorStop(1,   "rgba(255,80,0,0)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.ellipse(cx, y + fh*0.5, fw*0.5, fh*0.5, 0, 0, Math.PI*2);
  ctx.fill();
  ctx.restore();
}

function darken(hex, factor) {
  const r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
  return `rgb(${Math.floor(r*factor)},${Math.floor(g*factor)},${Math.floor(b*factor)})`;
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w/2, h/2);
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.lineTo(x+w-r, y); ctx.arcTo(x+w,y,   x+w,y+r,   r);
  ctx.lineTo(x+w,   y+h-r); ctx.arcTo(x+w,y+h, x+w-r,y+h, r);
  ctx.lineTo(x+r,   y+h); ctx.arcTo(x,  y+h, x,  y+h-r, r);
  ctx.lineTo(x,     y+r); ctx.arcTo(x,  y,   x+r,y,     r);
  ctx.closePath();
}

function drawIdleBg() {
  ctx.fillStyle = "#1C1C1E";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

// ─── HUD ──────────────────────────────────────────────────
function updateHUD() {
  hudScore.textContent = Math.floor(score);
  hudTime.textContent  = Math.floor(elapsed) + "s";
  // Speed indicator in health bar
  const maxSpeed = INITIAL_SPEED + 10 * SPEED_STEP;
  const pct = Math.min(100, ((currentSpeed - INITIAL_SPEED) / (maxSpeed - INITIAL_SPEED)) * 100);
  healthBar.style.width = (20 + pct * 0.8) + "%";
  healthBar.style.background = speedFlashTimer > 0
    ? "linear-gradient(90deg,#FFD700,#FF6600)"
    : "linear-gradient(90deg,#0052FF,#60A5FA)";
}

// ─── GAME OVER ────────────────────────────────────────────
function endGame() {
  const finalScore   = Math.floor(score);
  const survivalSecs = Math.floor(elapsed);
  gamesPlayed++;
  if (finalScore > bestScore) bestScore = finalScore;
  savePlayerData();
  document.getElementById("final-score").textContent = finalScore;
  document.getElementById("go-time").textContent     = survivalSecs + "s";
  document.getElementById("go-best").textContent     = bestScore;
  document.getElementById("tx-status").classList.add("hidden");
  document.getElementById("tx-done").classList.add("hidden");
  showScreen("gameover");
  recordScoreOnChain(finalScore, survivalSecs);
}

// ─── BUTTONS ──────────────────────────────────────────────
document.getElementById("btn-connect").addEventListener("click", connectWallet);
document.getElementById("btn-start").addEventListener("click", () => { showScreen("game"); startGame(); });
document.getElementById("btn-disconnect").addEventListener("click", () => { wallet=null; showScreen("connect"); });
document.getElementById("btn-play-again").addEventListener("click", () => { showScreen("game"); startGame(); });
document.getElementById("btn-to-menu").addEventListener("click", () => { updateStartScreen(); showScreen("start"); });

// ─── INIT ─────────────────────────────────────────────────
resizeCanvas();
showScreen("connect");
