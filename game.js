/* ══════════════════════════════════════════════════════════
   BASE RACER — game.js
   Top-down lane racer + Base (EVM chain 8453) Web3 integration
══════════════════════════════════════════════════════════ */

"use strict";

// ─── CONSTANTS ────────────────────────────────────────────
const BASE_CHAIN_ID   = 8453;
const BASE_RPC        = "https://mainnet.base.org";
const BASE_CHAIN_HEX  = "0x" + BASE_CHAIN_ID.toString(16);
const BASESCAN_TX     = "https://basescan.org/tx/";
const SCORE_PER_SEC   = 5;          // points added every second
const LANE_COUNT      = 5;
const INITIAL_SPEED   = 180;        // px per second
const SPEED_INCREMENT = 6;          // increase per 10 seconds
const OPPONENT_COLORS = [
  "#EF4444","#F97316","#EAB308","#A855F7","#EC4899","#14B8A6"
];

// ─── STATE ────────────────────────────────────────────────
let wallet   = null;   // { address, provider, signer }
let gameLoop = null;
let score = 0, elapsed = 0, lives = 3;
let playerX = 0, playerY = 0, playerW = 0, playerH = 0;
let lanes   = [];
let opponents = [];
let roadOffset = 0;
let lastTs  = 0;
let gameRunning = false;
let bestScore = 0, gamesPlayed = 0;

// ─── DOM REFS ─────────────────────────────────────────────
const screens = {
  connect:  document.getElementById("screen-connect"),
  start:    document.getElementById("screen-start"),
  game:     document.getElementById("screen-game"),
  gameover: document.getElementById("screen-gameover"),
};
const canvas  = document.getElementById("game-canvas");
const ctx     = canvas.getContext("2d");
const hudScore = document.getElementById("hud-score");
const hudTime  = document.getElementById("hud-time");
const healthBar = document.getElementById("health-bar");

// ─── SCREEN MANAGER ───────────────────────────────────────
function showScreen(name) {
  Object.entries(screens).forEach(([k, el]) => {
    el.classList.toggle("active", k === name);
  });
}

// ─── SPEED LINES DECORATION ───────────────────────────────
(function spawnSpeedLines() {
  const wrap = document.getElementById("speedlines");
  if (!wrap) return;
  for (let i = 0; i < 18; i++) {
    const line = document.createElement("div");
    const left = Math.random() * 100;
    const dur  = 0.4 + Math.random() * 0.6;
    const delay = -Math.random() * 1;
    line.style.cssText = `
      position:absolute;
      left:${left}%;top:0;
      width:1px;height:${30 + Math.random()*60}px;
      background:linear-gradient(180deg,transparent,rgba(0,82,255,0.4),transparent);
      animation:fall ${dur}s ${delay}s linear infinite;
    `;
    wrap.appendChild(line);
  }
  const style = document.createElement("style");
  style.textContent = `@keyframes fall{from{top:-80px}to{top:110%}}`;
  document.head.appendChild(style);
})();

// ─── WEB3 ─────────────────────────────────────────────────
async function connectWallet() {
  if (!window.ethereum) {
    alert("No EVM wallet detected.\nPlease install MetaMask or a compatible wallet.");
    return;
  }
  try {
    // Request accounts
    await window.ethereum.request({ method: "eth_requestAccounts" });

    // Switch to / add Base
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
            chainId: BASE_CHAIN_HEX,
            chainName: "Base",
            nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
            rpcUrls: [BASE_RPC],
            blockExplorerUrls: ["https://basescan.org"],
          }],
        });
      } else { throw swErr; }
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
  if (raw) {
    try {
      const d = JSON.parse(raw);
      bestScore   = d.bestScore   || 0;
      gamesPlayed = d.gamesPlayed || 0;
    } catch {}
  }
}

function savePlayerData() {
  if (!wallet) return;
  localStorage.setItem(storageKey(wallet.address), JSON.stringify({ bestScore, gamesPlayed }));
}

function updateStartScreen() {
  document.getElementById("wallet-address-display").textContent =
    wallet.address.slice(0, 6) + "…" + wallet.address.slice(-4);
  document.getElementById("best-score-display").textContent  = bestScore;
  document.getElementById("games-played-display").textContent = gamesPlayed;
}

// ─── BASE TRANSACTION (score memo) ────────────────────────
async function recordScoreOnChain(finalScore, survivalSecs) {
  if (!wallet) return;

  const txStatus = document.getElementById("tx-status");
  const txDone   = document.getElementById("tx-done");
  const txMsg    = document.getElementById("tx-msg");
  const txLink   = document.getElementById("tx-link");

  txStatus.classList.remove("hidden");
  txDone.classList.add("hidden");

  try {
    // Encode score + time in data field as a simple memo (0-cost data tx to self)
    const memo = `BASE RACER | Score: ${finalScore} | Time: ${survivalSecs}s`;
    const hexData = "0x" + Array.from(new TextEncoder().encode(memo))
      .map(b => b.toString(16).padStart(2, "0")).join("");

    txMsg.textContent = "Confirm in your wallet…";

    const tx = await wallet.signer.sendTransaction({
      to:    wallet.address,   // send to self — zero-value memo tx
      value: 0n,
      data:  hexData,
    });

    txMsg.textContent = "Broadcasting to Base…";
    await tx.wait(1);

    txStatus.classList.add("hidden");
    txDone.classList.remove("hidden");
    txLink.href = BASESCAN_TX + tx.hash;
  } catch (err) {
    txStatus.classList.add("hidden");
    if (err.code !== 4001) { // 4001 = user rejected
      console.error("TX error:", err);
    }
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
    x: i * laneW,
    cx: i * laneW + laneW / 2,
    w: laneW,
  }));
  // Reset player to center lane
  playerW = laneW * 0.52;
  playerH = playerW * 1.7;
  playerX = lanes[Math.floor(LANE_COUNT / 2)].cx - playerW / 2;
  playerY = canvas.height - playerH - 40;
}

window.addEventListener("resize", () => {
  resizeCanvas();
  if (!gameRunning) drawIdleBg();
});

// ─── PLAYER INPUT ─────────────────────────────────────────
const keys = { left: false, right: false };

window.addEventListener("keydown", e => {
  if (e.key === "ArrowLeft"  || e.key === "a" || e.key === "A") keys.left  = true;
  if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") keys.right = true;
});
window.addEventListener("keyup", e => {
  if (e.key === "ArrowLeft"  || e.key === "a" || e.key === "A") keys.left  = false;
  if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") keys.right = false;
});

// Touch / swipe support
let touchStartX = null;
canvas.addEventListener("touchstart", e => { touchStartX = e.touches[0].clientX; }, { passive: true });
canvas.addEventListener("touchmove", e => {
  if (touchStartX === null) return;
  const dx = e.touches[0].clientX - touchStartX;
  if (Math.abs(dx) > 10) {
    keys.left  = dx < 0;
    keys.right = dx > 0;
  }
}, { passive: true });
canvas.addEventListener("touchend", () => { keys.left = keys.right = false; touchStartX = null; });

// ─── GAME INIT ────────────────────────────────────────────
function startGame() {
  score = 0; elapsed = 0; lives = 3;
  roadOffset = 0; opponents = [];
  lastTs = performance.now();
  gameRunning = true;
  resizeCanvas();
  updateHUD();
  if (gameLoop) cancelAnimationFrame(gameLoop);
  requestAnimationFrame(tick);
}

// ─── OPPONENTS ────────────────────────────────────────────
let spawnTimer = 0;
const SPAWN_INTERVAL = 1.6; // seconds between spawns

function spawnOpponent(speed) {
  const lane = lanes[Math.floor(Math.random() * LANE_COUNT)];
  const color = OPPONENT_COLORS[Math.floor(Math.random() * OPPONENT_COLORS.length)];
  opponents.push({
    x: lane.cx - playerW / 2,
    y: -playerH,
    w: playerW,
    h: playerH,
    speed,
    color,
  });
}

// ─── MAIN TICK ────────────────────────────────────────────
function tick(ts) {
  if (!gameRunning) return;
  const dt = Math.min((ts - lastTs) / 1000, 0.1); // delta seconds (cap at 100ms)
  lastTs = ts;

  elapsed += dt;
  score += SCORE_PER_SEC * dt;

  const speed = INITIAL_SPEED + Math.floor(elapsed / 10) * SPEED_INCREMENT;

  // Scroll road
  roadOffset = (roadOffset + speed * dt) % (canvas.height / 4);

  // Move player
  const playerSpeed = speed * 1.4;
  if (keys.left)  playerX = Math.max(0, playerX - playerSpeed * dt);
  if (keys.right) playerX = Math.min(canvas.width - playerW, playerX + playerSpeed * dt);

  // Spawn opponents
  spawnTimer += dt;
  if (spawnTimer >= SPAWN_INTERVAL) {
    spawnTimer = 0;
    spawnOpponent(speed * (0.7 + Math.random() * 0.6));
  }

  // Move opponents
  for (const op of opponents) {
    op.y += op.speed * dt;
  }
  // Remove off-screen
  opponents = opponents.filter(op => op.y < canvas.height + 20);

  // Collision check
  let crashed = false;
  for (const op of opponents) {
    if (rectsOverlap(playerX, playerY, playerW, playerH,
                     op.x + 6, op.y + 6, op.w - 12, op.h - 12)) {
      crashed = true;
      break;
    }
  }

  // Draw
  drawGame(speed);
  updateHUD();

  if (crashed) {
    gameRunning = false;
    endGame();
    return;
  }

  gameLoop = requestAnimationFrame(tick);
}

function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

// ─── DRAWING ──────────────────────────────────────────────
function drawGame(speed) {
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  // Road background
  ctx.fillStyle = "#0A0E1A";
  ctx.fillRect(0, 0, W, H);

  // Lane dividers
  const segH   = H / 4;
  const dashH  = segH * 0.55;
  const gapH   = segH - dashH;
  ctx.strokeStyle = "rgba(0,82,255,0.22)";
  ctx.lineWidth   = 2;
  ctx.setLineDash([dashH, gapH]);
  ctx.lineDashOffset = -roadOffset;
  for (let i = 1; i < LANE_COUNT; i++) {
    const x = lanes[i].x;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  // Solid edges
  ctx.setLineDash([]);
  ctx.strokeStyle = "rgba(0,82,255,0.5)";
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(1, 0); ctx.lineTo(1, H); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(W-1, 0); ctx.lineTo(W-1, H); ctx.stroke();

  // Glow overlay (depth)
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0,   "rgba(0,5,20,0.6)");
  grad.addColorStop(0.3, "rgba(0,5,20,0)");
  grad.addColorStop(1,   "rgba(0,5,20,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Opponents
  for (const op of opponents) drawCar(ctx, op.x, op.y, op.w, op.h, op.color, false);

  // Player car
  drawCar(ctx, playerX, playerY, playerW, playerH, "#0052FF", true);
}

function drawIdleBg() {
  if (gameRunning) return;
  const W = canvas.width, H = canvas.height;
  ctx.fillStyle = "#0A0E1A";
  ctx.fillRect(0, 0, W, H);
}

function drawCar(ctx, x, y, w, h, color, isPlayer) {
  const r = w * 0.15;

  ctx.save();
  // Body glow
  ctx.shadowColor = color;
  ctx.shadowBlur  = isPlayer ? 20 : 10;

  // Body
  ctx.fillStyle = isPlayer ? "#1a3a8f" : "#1a1a2e";
  roundRect(ctx, x, y, w, h, r);
  ctx.fill();

  // Roof
  ctx.fillStyle = isPlayer ? "#0d2055" : "#111128";
  const rf = w * 0.15;
  roundRect(ctx, x + rf, y + h * 0.25, w - rf * 2, h * 0.42, r * 0.6);
  ctx.fill();

  // Hood stripe
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.7;
  roundRect(ctx, x + w * 0.35, y + h * 0.04, w * 0.3, h * 0.22, 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // Headlights / taillights
  ctx.fillStyle = isPlayer ? "#60A5FA" : "#EF4444";
  ctx.shadowColor = isPlayer ? "#60A5FA" : "#EF4444";
  ctx.shadowBlur  = 12;
  const eyeY  = isPlayer ? y + h * 0.05 : y + h - h * 0.12;
  const eyeW  = w * 0.18, eyeH = h * 0.06;
  ctx.fillRect(x + w * 0.12, eyeY, eyeW, eyeH);
  ctx.fillRect(x + w - w * 0.12 - eyeW, eyeY, eyeW, eyeH);

  // Wheels
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#111";
  const wheelW = w * 0.18, wheelH = h * 0.14;
  ctx.fillRect(x - wheelW * 0.35, y + h * 0.2, wheelW, wheelH);
  ctx.fillRect(x + w - wheelW * 0.65, y + h * 0.2, wheelW, wheelH);
  ctx.fillRect(x - wheelW * 0.35, y + h * 0.66, wheelW, wheelH);
  ctx.fillRect(x + w - wheelW * 0.65, y + h * 0.66, wheelW, wheelH);

  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

// ─── HUD UPDATE ───────────────────────────────────────────
function updateHUD() {
  hudScore.textContent = Math.floor(score);
  hudTime.textContent  = Math.floor(elapsed) + "s";
}

// ─── GAME OVER ────────────────────────────────────────────
function endGame() {
  const finalScore = Math.floor(score);
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

  // Auto-submit score to Base
  recordScoreOnChain(finalScore, survivalSecs);
}

// ─── BUTTON WIRING ────────────────────────────────────────
document.getElementById("btn-connect").addEventListener("click", connectWallet);

document.getElementById("btn-start").addEventListener("click", () => {
  showScreen("game");
  startGame();
});

document.getElementById("btn-disconnect").addEventListener("click", () => {
  wallet = null;
  showScreen("connect");
});

document.getElementById("btn-play-again").addEventListener("click", () => {
  showScreen("game");
  startGame();
});

document.getElementById("btn-to-menu").addEventListener("click", () => {
  updateStartScreen();
  showScreen("start");
});

// ─── INIT ─────────────────────────────────────────────────
resizeCanvas();
showScreen("connect");
