"use strict";

const BASE_CHAIN_ID  = 8453;
const BASE_RPC       = "https://mainnet.base.org";
const BASE_CHAIN_HEX = "0x" + BASE_CHAIN_ID.toString(16);
const BASESCAN        = "https://basescan.org";
const SCORE_PER_SEC  = 5;
const LANE_COUNT     = 5;
const BASE_SPEED     = 220;
const SPEED_STEP     = 35;
const SPAWN_BASE     = 1.6;

const CONTRACT_ABI = [
  { name:"submitScore", type:"function", stateMutability:"nonpayable", inputs:[{name:"points",type:"uint256"},{name:"timeSeconds",type:"uint256"}], outputs:[] },
  { name:"bestScore", type:"function", stateMutability:"view", inputs:[{name:"player",type:"address"}], outputs:[{name:"points",type:"uint256"},{name:"timeSeconds",type:"uint256"},{name:"timestamp",type:"uint256"},{name:"gameNumber",type:"uint256"}] },
  { name:"gamesPlayed", type:"function", stateMutability:"view", inputs:[{name:"player",type:"address"}], outputs:[{name:"",type:"uint256"}] },
  { name:"getLeaderboard", type:"function", stateMutability:"view", inputs:[{name:"n",type:"uint256"}], outputs:[{name:"addrs",type:"address[]"},{name:"points",type:"uint256[]"},{name:"times",type:"uint256[]"}] },
  { name:"ScoreSubmitted", type:"event", inputs:[{name:"player",type:"address",indexed:true},{name:"points",type:"uint256",indexed:false},{name:"timeSeconds",type:"uint256",indexed:false},{name:"gameNumber",type:"uint256",indexed:false},{name:"isNewBest",type:"bool",indexed:false}] }
];

const CONTRACT_BYTECODE = "0x608060405234801561001057600080fd5b50610b3f806100206000396000f3fe608060405234801561001057600080fd5b50600436106100575760003560e01c806304c0ae041461005c57806318c4f5a21461008957806348e74543146100a45780636d4ce63c146100c5578063b07c41bf146100e6575b600080fd5b61006f61006a366004610881565b610107565b604051610080949392919061089a565b60405180910390f35b6100a2610097366004610881565b610141565b005b6100b76100b23660046108d4565b6102d7565b6040516100809392919061090e565b6100d86100d3366004610881565b61044c565b604051908152602001610080565b6100f96100f43660046108d4565b61045e565b60405161008092919061093a565b60006020819052908152604090208054600182015460028301546003909301549192909184565b336000908152602081905260409020600301546000036101785760038054600181019091556000908152600460205260409020805433600160a060020a031916179055505b33600090815260208190526040812060038054919261019691610958565b905060405180608001604052808381526020018381526020014281526020018581525090508060008054906101000a9004600160a060020a0316600160a060020a03166001600160a01b0316336001600160a01b031614156101f5575050565b33600160a060020a031660009081526020819052604090205481111561025a5733600160a060020a03166000908152602081905260409020819055604051339082907f5a9d7a8e6c2b5f8e1d3c4a7b9e2f5c8d1a4b7e3f6c9d2a5b8e1f4c7d0a3b6e960405160405180910390a35b604051339082907fb1cb476b1a5b9e8d3c2a7f4e1b8d5c0a9f6e3b0d7c4a1b8f5e2c9d6a3b0e7c460405160405180910390a3505050565b60606000806000806003548767ffffffffffffffff8111156102fb576102fb610975565b60405190808252806020026020018201604052801561032e57816020015b60608152602001906001900390816103195790505b509350878510610340578795506103445760009550505b60005b8681101561043e5760006004600060038381548110610368576103688061098b565b60009182526020808320909101546001600160a01b031683528201929092526040018120549091508a1161039c578792505b6001600160a01b031660009081526020819052604090205484106103c2578192508391505b8281106103d057806103d2565b815b935050508181106103e6578093508192505b80600460006003858154811061040057610400806109ab565b60009182526020808320909101546001600160a01b031683528201929092526040018120919091555081019050610347565b505050505050509392505050565b6001600160a01b031660009081526001602052604090205490565b606060008067ffffffffffffffff81111561047b5761047b610975565b6040519080825280602002602001820160405280156104a4578160200160200181029003820190505b5090506000805b600354811015610507576000600482600381548110610482576104826109cb565b60009182526020808320909101546001600160a01b0316835282019290925260400190205411156104fc576001909101905b6001016104ab565b508067ffffffffffffffff81111561052157610521610975565b60405190808252806020026020018201604052801561054a578160200181029003820190505b5093508067ffffffffffffffff81111561056657610566610975565b60405190808252806020026020018201604052801561058f578160200181029003820190505b5092508067ffffffffffffffff8111156105ab576105ab610975565b6040519080825280602002602001820160405280156105d4578160200181029003820190505b50915060005b8181101561074c57600354811015610744576000806000806000806000806004600060038b8154811061060f5761060f6109eb565b60009182526020808320909101546001600160a01b031683528201929092526040018120548a8110610643578095508394505b6001600160a01b0316600090815260208190526040902054878110610669578096508395505b8087106106a2576003898154811061068357610683610a0b565b60009182526020909120015480891061069e578098508799505b5050505b80881461072457600380548a9081106106be576106be610a2b565b906000526020600020015460038a8154811061067657610676610a4b565b506001600160a01b039081166000908152602081905260408082205492851682529020548110156107245780600386815481106107045761070476109a1565b60009182526020909120015588600388815481106106f2576106f2610a6b565b9060005260206000200155505b8060010190506105da565b505050505050505b60010161060f565b5060005b818110156107c657600381815481106107695761076961098b565b60009182526020808320909101546001600160a01b031683528281526040808420548985015260018085528285205492890152918452822054928601529054169083018190526001016107505b50505050509250925092565b6001600160a01b03811681146107e657600080fd5b50565b6000602082840312156107fc57600080fd5b8135610807816107d2565b9392505050565b6000806040838503121561082157600080fd5b823561082c816107d2565b946020939093013593505050565b600080600060608486031215610856576108568061084f565b600080fd5b6000806040838503121561086e57600080fd5b50508035926020909101359150565b60006020828403121561088f5761088f80610889565b5b60006108a184356107d2565b60006020828403121561089357600080fd5b81356108a0816107d2565b9392505050565b60808101818360005b60048110156108d1578151835260209283019290910190600101610476565b50505092915050565b6000602082840312156108e657600080fd5b5035919050565b6000815180845260005b818110156109125760208185018101518683018201520161090a565b50600060208285010152601f01601f19169290920160200192915050565b606081526000610943606083018661089d565b828103602084015261095581866108ed565b9050828103604084015261096981856108ed565b98975050505050505050565b634e487b7160e01b600052604160045260246000fd5b634e487b7160e01b600052603260045260246000fd5b634e487b7160e01b600052603260045260246000fdfea264697066735822122012a4b6c8d0e2f4a6b8c0d2e4f6a8b0c2d4e6f8a0b2c4d6e8f0a2b4c6d8e0f2a264736f6c63430008140033";

let wallet       = null;
let contract     = null;
let contractAddr = localStorage.getItem("br_contract") || null;
let score        = 0;
let elapsed      = 0;
let gameRunning  = false;
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

function showScreen(id) {
  Object.entries(screens).forEach(([k,el]) => {
    if(el) el.classList.toggle("active", k === id);
  });
}

(function buildSpeedLines() {
  const wrap = document.getElementById("speedlines");
  if (!wrap) return;
  for (let i=0;i<20;i++) {
    const d = document.createElement("div");
    d.style.cssText = `position:absolute;left:${Math.random()*100}%;top:0;width:1px;height:${25+Math.random()*55}px;background:linear-gradient(180deg,transparent,rgba(0,82,255,.45),transparent);animation:fall ${.35+Math.random()*.65}s ${-Math.random()}s linear infinite;`;
    wrap.appendChild(d);
  }
  const s = document.createElement("style");
  s.textContent = `@keyframes fall{from{top:-80px}to{top:110%}}`;
  document.head.appendChild(s);
})();

async function switchToBase() {
  try {
    await window.ethereum.request({ method:"wallet_switchEthereumChain", params:[{chainId:BASE_CHAIN_HEX}] });
  } catch(e) {
    if (e.code===4902) await window.ethereum.request({ method:"wallet_addEthereumChain", params:[{
      chainId:BASE_CHAIN_HEX, chainName:"Base",
      nativeCurrency:{name:"Ether",symbol:"ETH",decimals:18},
      rpcUrls:[BASE_RPC], blockExplorerUrls:[BASESCAN]
    }]});
    else throw e;
  }
}

async function connectWallet() {
  if (!window.ethereum) { alert("No EVM wallet found."); return; }
  try {
    await window.ethereum.request({ method:"eth_requestAccounts" });
    await switchToBase();
    const provider = new ethers.BrowserProvider(window.ethereum);
    const signer   = await provider.getSigner();
    const address  = await signer.getAddress();
    wallet = { address, provider, signer };
    await initContract();
    loadData();
    updateStartScreen();
    showScreen("start");
  } catch(err) { console.error(err); alert("Connection failed: "+(err.message||err)); }
}

async function initContract() {
  if (!wallet) return;
  if (contractAddr) {
    contract = new ethers.Contract(contractAddr, CONTRACT_ABI, wallet.signer);
    try {
      await contract.totalPlayers();
    } catch {
      contractAddr = null;
      localStorage.removeItem("br_contract");
      contract = null;
    }
  }
  if (!contract) await deployContract();
}

async function deployContract() {
  const txEl  = document.getElementById("tx-status");
  const msgEl = document.getElementById("tx-msg");
  if (txEl) { txEl.classList.remove("hidden"); }
  if (msgEl) { msgEl.textContent = "Deploying scoreboard contract…"; }
  try {
    const factory = new ethers.ContractFactory(CONTRACT_ABI, CONTRACT_BYTECODE, wallet.signer);
    const c       = await factory.deploy({ gasLimit: 1500000n });
    if (msgEl) msgEl.textContent = "Waiting for confirmation…";
    await c.waitForDeployment();
    contractAddr = await c.getAddress();
    localStorage.setItem("br_contract", contractAddr);
    contract = c;
    if (txEl) txEl.classList.add("hidden");
  } catch(err) {
    if (txEl) txEl.classList.add("hidden");
    console.error("Deploy failed:", err);
  }
}

async function submitScoreOnChain(points, secs) {
  if (!wallet) return;
  const txEl   = document.getElementById("tx-status");
  const doneEl = document.getElementById("tx-done");
  const msgEl  = document.getElementById("tx-msg");
  const linkEl = document.getElementById("tx-link");
  if (txEl)   txEl.classList.remove("hidden");
  if (doneEl) doneEl.classList.add("hidden");
  try {
    if (!contract) await deployContract();
    if (!contract) throw new Error("Contract unavailable");
    if (msgEl) msgEl.textContent = "Confirm in wallet…";
    const tx = await contract.submitScore(BigInt(points), BigInt(secs), { gasLimit: 200000n });
    if (msgEl) msgEl.textContent = "Broadcasting…";
    await tx.wait(1);
    if (txEl)   txEl.classList.add("hidden");
    if (doneEl) doneEl.classList.remove("hidden");
    if (linkEl) linkEl.href = `${BASESCAN}/tx/${tx.hash}`;
    await refreshChainStats();
  } catch(err) {
    if (txEl)   txEl.classList.add("hidden");
    if (err.code !== 4001) console.error("submitScore error:", err);
  }
}

async function refreshChainStats() {
  if (!contract || !wallet) return;
  try {
    const [pts,,,,] = await contract.bestScore(wallet.address);
    const gp        = await contract.gamesPlayed(wallet.address);
    bestScore   = Number(pts);
    gamesPlayed = Number(gp);
    saveData();
    updateStartScreen();
  } catch(err) { console.error(err); }
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
  localStorage.setItem(storeKey(wallet.address), JSON.stringify({ b:bestScore, g:gamesPlayed }));
}
function updateStartScreen() {
  const addrDisp = document.getElementById("wallet-address-display");
  const scoreDisp = document.getElementById("best-score-display");
  const playedDisp = document.getElementById("games-played-display");
  if(addrDisp) addrDisp.textContent = wallet.address.slice(0,6)+"…"+wallet.address.slice(-4);
  if(scoreDisp) scoreDisp.textContent     = bestScore;
  if(playedDisp) playedDisp.textContent   = gamesPlayed;
}

function resize() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  const lw = canvas.width / LANE_COUNT;
  lanes    = Array.from({length:LANE_COUNT}, (_,i) => ({ x:i*lw, cx:i*lw+lw/2, w:lw }));
  playerW  = lw * 0.54;
  playerH  = playerW * 1.9;
  playerX  = lanes[Math.floor(LANE_COUNT/2)].cx - playerW/2;
  playerY  = canvas.height - playerH - 55;
}
window.addEventListener("resize", resize);

const keys = { left:false, right:false };
window.addEventListener("keydown", e => {
  if (e.key==="ArrowLeft"  || e.key==="a" || e.key==="A") keys.left  = true;
  if (e.key==="ArrowRight" || e.key==="d" || e.key==="D") keys.right = true;
});
window.addEventListener("keyup", e => {
  if (e.key==="ArrowLeft"  || e.key==="a" || e.key==="A") keys.left  = false;
  if (e.key==="ArrowRight" || e.key==="d" || e.key==="D") keys.right = false;
});
let tx0 = null;
canvas.addEventListener("touchstart", e => { tx0 = e.touches[0].clientX; }, { passive:true });
canvas.addEventListener("touchmove",  e => {
  if (tx0 === null) return;
  const dx = e.touches[0].clientX - tx0;
  if (Math.abs(dx) > 8) { keys.left = dx<0; keys.right = dx>0; }
}, { passive:true });
canvas.addEventListener("touchend", () => { keys.left = keys.right = false; tx0 = null; });

function spawnParticle(x, y, type) {
  const base = type === "smoke"
    ? { vx:(Math.random()-.5)*30, vy:-20-Math.random()*40, life:1.2, maxLife:1.2, size:4+Math.random()*6, color:"200,200,200" }
    : { vx:(Math.random()-.5)*80, vy:-60-Math.random()*60, life:.6,  maxLife:.6,  size:2+Math.random()*4, color:"255,160,40"  };
  particles.push({ ...base, x:x+(Math.random()-.5)*8, y, type });
}
function updateParticles(dt) {
  for (const p of particles) { p.x+=p.vx*dt; p.y+=p.vy*dt; p.vy+=40*dt; p.life-=dt; }
  particles = particles.filter(p => p.life > 0);
}
function drawParticles() {
  for (const p of particles) {
    const a = p.life/p.maxLife, s = p.size*a;
    ctx.save(); ctx.globalAlpha = a*.85; ctx.fillStyle = `rgb(${p.color})`;
    if (p.type==="smoke") {
      ctx.shadowColor=`rgba(${p.color},.3)`; ctx.shadowBlur=8;
      ctx.beginPath(); ctx.arc(p.x,p.y,s,0,Math.PI*2); ctx.fill();
    } else {
      ctx.fillStyle=`rgba(${p.color},${a})`; ctx.fillRect(p.x-s/2,p.y-s/2,s,s);
    }
    ctx.restore();
  }
}

function startGame() {
  score=0; elapsed=0; roadOffset=0; bgOffset=0;
  opponents=[]; particles=[]; spawnTimer=0;
  currentSpeed=BASE_SPEED; speedLevel=0; flashTimer=0; shakeMag=0;
  showScreen("game");
  resize();
  lastTs=performance.now(); 
  gameRunning=true;
  updateHUD();
  requestAnimationFrame(tick);
}

function tick(ts) {
  if (!gameRunning) return;
  const dt = Math.min((ts-lastTs)/1000, .1);
  lastTs = ts;
  elapsed += dt;
  score   += SCORE_PER_SEC * dt;
  const newLevel = Math.floor(elapsed/10);
  if (newLevel > speedLevel) { speedLevel=newLevel; currentSpeed=BASE_SPEED+speedLevel*SPEED_STEP; flashTimer=2.0; }
  if (flashTimer>0) flashTimer-=dt;
  if (shakeMag>0)   shakeMag=Math.max(0, shakeMag-80*dt);
  roadOffset = (roadOffset+currentSpeed*dt)%120;
  bgOffset   = (bgOffset+currentSpeed*.15*dt)%canvas.height;
  const ps = currentSpeed*1.6;
  if (keys.left)  playerX = Math.max(0,                playerX-ps*dt);
  if (keys.right) playerX = Math.min(canvas.width-playerW, playerX+ps*dt);
  const interval = Math.max(.6, SPAWN_BASE-speedLevel*.08);
  spawnTimer += dt;
  if (spawnTimer>=interval) { spawnTimer=0; spawnOpponent(); }
  for (const op of opponents) {
    op.y += op.speed*dt;
    if (Math.random()<.1) spawnParticle(op.x+op.w*.25, op.y+op.h*.85, "smoke");
    if (Math.random()<.1) spawnParticle(op.x+op.w*.75, op.y+op.h*.85, "smoke");
  }
  opponents = opponents.filter(op => op.y < canvas.height+50);
  updateParticles(dt);
  if (speedLevel>=2) {
    if (Math.random()<.15) spawnParticle(playerX+playerW*.2, playerY+playerH*.88, "smoke");
    if (Math.random()<.15) spawnParticle(playerX+playerW*.8, playerY+playerH*.88, "smoke");
  }
  let crashed = false;
  for (const op of opponents) {
    if (overlap(playerX+5,playerY+8,playerW-10,playerH-14, op.x+5,op.y+8,op.w-10,op.h-14)) {
      crashed=true;
      for (let i=0;i<28;i++) spawnParticle(playerX+playerW/2, playerY+playerH/2, "spark");
      shakeMag=18; break;
    }
  }
  render(); updateHUD();
  if (crashed) { gameRunning=false; setTimeout(endGame,400); return; }
  requestAnimationFrame(tick);
}

function overlap(ax,ay,aw,ah,bx,by,bw,bh) { return ax<bx+bw&&ax+aw>bx&&ay<by+bh&&ay+ah>by; }

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
  opponents.push({ x:lane.cx-playerW/2, y:-playerH-Math.random()*60, w:playerW, h:playerH, speed:currentSpeed*(.55+Math.random()*.75), palette });
}

function render() {
  const W=canvas.width, H=canvas.height;
  ctx.save();
  if (shakeMag>0) ctx.translate((Math.random()-.5)*shakeMag,(Math.random()-.5)*shakeMag*.6);
  drawBackground(W,H); drawRoad(W,H); drawParticles();
  for (const op of opponents) { drawCarShadow(op.x,op.y,op.w,op.h); drawCar(op.x,op.y,op.w,op.h,op.palette,false); }
  drawCarShadow(playerX,playerY,playerW,playerH);
  drawCar(playerX,playerY,playerW,playerH,{body:"#0D2B6E",dark:"#060F2C",accent:"#0052FF",rim:"#A0C4FF",light:"#60A5FA"},true);
  if (flashTimer>0) {
    const a=Math.min(.4,flashTimer*.22)*(flashTimer>1.5?1:flashTimer/1.5);
    ctx.fillStyle=`rgba(0,100,255,${a})`; ctx.fillRect(0,0,W,H);
    if (flashTimer>1.2) {
      ctx.save(); ctx.font=`bold ${Math.floor(W*.058)}px 'Segoe UI',sans-serif`;
      ctx.textAlign="center"; ctx.shadowColor="#0052FF"; ctx.shadowBlur=30;
      ctx.fillStyle="#FFFFFF"; ctx.fillText("⚡  SPEED UP!",W/2,H*.2); ctx.restore();
    }
  }
  ctx.restore();
}

function drawBackground(W,H) {
  const sky=ctx.createLinearGradient(0,0,0,H*.22);
  sky.addColorStop(0,"#050A1E"); sky.addColorStop(.6,"#071030"); sky.addColorStop(1,"#0A1840");
  ctx.fillStyle=sky; ctx.fillRect(0,0,W,H*.22);
  ctx.save(); ctx.fillStyle="#060D22";
  const buildings=[[0,.85],[.04,.6],[.07,.75],[.10,.55],[.14,.80],[.18,.65],[.22,.5],[.26,.70],[.30,.6],[.35,.45],[.40,.68],[.44,.58],[.48,.72],[.52,.52],[.56,.65],[.60,.48],[.65,.72],[.70,.6],[.74,.55],[.78,.7],[.82,.62],[.86,.5],[.90,.73],[.94,.6],[.97,.8],[1,.85]];
  const BH=H*.22;
  ctx.beginPath(); ctx.moveTo(0,BH);
  for (const [bx,bh] of buildings) ctx.lineTo(bx*W,BH*(1-bh*.4));
  ctx.lineTo(W,BH); ctx.closePath(); ctx.fill();
  for (let i=0; i<60; i++) {
    const wx=(i*137.5)%W, wy=BH*.1+(i*53.7)%(BH*.55);
    const alpha=.3+.5*Math.abs(Math.sin(elapsed*1.3+i));
    ctx.fillStyle=`rgba(${[[0,120,255],[255,200,0],[0,220,180],[180,80,255]][i%4].join(",")},${alpha})`;
    ctx.fillRect(wx,wy,2,3);
  }
  ctx.restore();
  const hg=ctx.createLinearGradient(0,H*.18,0,H*.28);
  hg.addColorStop(0,"rgba(0,60,160,.55)"); hg.addColorStop(1,"rgba(0,0,0,0)");
  ctx.fillStyle=hg; ctx.fillRect(0,H*.18,W,H*.12);
}

function drawRoad(W,H) {
  const asph=ctx.createLinearGradient(0,0,W,0);
  asph.addColorStop(0,"#161618"); asph.addColorStop(.08,"#1E1E22"); asph.addColorStop(.5,"#222226");
  asph.addColorStop(.92,"#1E1E22"); asph.addColorStop(1,"#161618");
  ctx.fillStyle=asph; ctx.fillRect(0,H*.20,W,H*.80);
  const sheen=ctx.createLinearGradient(0,H*.20,0,H);
  sheen.addColorStop(0,"rgba(0,50,120,.12)"); sheen.addColorStop(.35,"rgba(0,30,80,.05)"); sheen.addColorStop(1,"rgba(0,0,0,0)");
  ctx.fillStyle=sheen; ctx.fillRect(0,H*.20,W,H*.80);
  const laneW=W/LANE_COUNT, rw=laneW*.10, blockH=28;
  for (let y=-(roadOffset%blockH); y<H; y+=blockH) {
    const odd=Math.floor(y/blockH)%2===0;
    ctx.fillStyle=odd?"rgba(230,30,30,.90)":"rgba(245,245,245,.90)"; ctx.fillRect(0,y,rw,blockH-1);
    ctx.fillStyle=odd?"rgba(245,245,245,.90)":"rgba(230,30,30,.90)"; ctx.fillRect(W-rw,y,rw,blockH-1);
  }
  ctx.strokeStyle="#E8E8E8"; ctx.lineWidth=3.5; ctx.setLineDash([]);
  ctx.beginPath(); ctx.moveTo(rw,0); ctx.lineTo(rw,H); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(W-rw,0); ctx.lineTo(W-rw,H); ctx.stroke();
  const cx=W/2;
  ctx.strokeStyle="#FFD740"; ctx.lineWidth=2.5;
  [-4.5,4.5].forEach(off=>{ ctx.beginPath(); ctx.moveTo(cx+off,0); ctx.lineTo(cx+off,H); ctx.stroke(); });
  ctx.fillStyle="rgba(180,130,0,.25)"; ctx.fillRect(cx-4.5,0,9,H);
  const dashH=120*.52, gapH=120-dashH;
  ctx.strokeStyle="rgba(230,230,230,.78)"; ctx.lineWidth=2; ctx.setLineDash([dashH,gapH]);
  for (let i=1; i<LANE_COUNT; i++) {
    const lx=i*laneW;
    if (Math.abs(lx-cx)<8) continue;
    ctx.lineDashOffset=-roadOffset; ctx.beginPath(); ctx.moveTo(lx,0); ctx.lineTo(lx,H); ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.strokeStyle="rgba(255,255,255,.28)"; ctx.lineWidth=1;
  for (let y=-(roadOffset%140); y<H; y+=140) {
    ctx.beginPath(); ctx.moveTo(rw+2,y); ctx.lineTo(rw+16,y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(W-rw-2,y); ctx.lineTo(W-rw-16,y); ctx.stroke();
  }
  ctx.fillStyle="rgba(255,240,180,.65)";
  for (let i=0; i<LANE_COUNT; i++) {
    const lx=lanes[i].cx;
    for (let y=-(roadOffset%80); y<H; y+=80) {
      ctx.save(); ctx.shadowColor="rgba(255,220,100,.8)"; ctx.shadowBlur=5;
      ctx.beginPath(); ctx.arc(lx,y,2.5,0,Math.PI*2); ctx.fill(); ctx.restore();
    }
  }
  const fog=ctx.createLinearGradient(0,H*.20,0,H*.38);
  fog.addColorStop(0,"rgba(5,10,30,.75)"); fog.addColorStop(1,"rgba(5,10,30,0)");
  ctx.fillStyle=fog; ctx.fillRect(0,H*.20,W,H*.20);
  const vig=ctx.createLinearGradient(0,0,W,0);
  vig.addColorStop(0,"rgba(0,0,0,.45)"); vig.addColorStop(.08,"rgba(0,0,0,0)");
  vig.addColorStop(.92,"rgba(0,0,0,0)"); vig.addColorStop(1,"rgba(0,0,0,.45)");
  ctx.fillStyle=vig; ctx.fillRect(0,0,W,H);
}

function drawCarShadow(x,y,w,h) {
  ctx.save();
  const cx=x+w/2;
  const grad=ctx.createRadialGradient(cx,y+h*.92,0,cx,y+h*.92,w*.72);
  grad.addColorStop(0,"rgba(0,0,0,.55)"); grad.addColorStop(.6,"rgba(0,0,0,.20)"); grad.addColorStop(1,"rgba(0,0,0,0)");
  ctx.scale(1,.32);
  ctx.fillStyle=grad;
  ctx.beginPath(); ctx.ellipse(cx,(y+h*.92)/.32,w*.72,h*.38,0,0,Math.PI*2); ctx.fill();
  ctx.restore();
}

function drawCar(x,y,w,h,pal,isPlayer) {
  const cx=x+w/2;
  ctx.save();
  function poly(pts,style) {
    ctx.fillStyle=style; ctx.beginPath(); ctx.moveTo(pts[0][0],pts[0][1]);
    for (let i=1; i<pts.length; i++) ctx.lineTo(pts[i][0],pts[i][1]);
    ctx.closePath(); ctx.fill();
  }
  function polyStroke(pts,style,lw) {
    ctx.strokeStyle=style; ctx.lineWidth=lw; ctx.beginPath(); ctx.moveTo(pts[0][0],pts[0][1]);
    for (let i=1; i<pts.length; i++) ctx.lineTo(pts[i][0],pts[i][1]);
    ctx.closePath(); ctx.stroke();
  }
  const X=f=>cx+f*w, Y=f=>y+f*h;

  const jetColor=isPlayer?pal.accent:pal.light;
  for (const jx of [X(-.18),X(.18)]) {
    const jLen=h*(.10+Math.random()*.06);
    const jg=ctx.createLinearGradient(jx,Y(1),jx,Y(1)+jLen);
    jg.addColorStop(0,hexA(jetColor,.95)); jg.addColorStop(.45,hexA(jetColor,.5)); jg.addColorStop(1,"rgba(0,0,0,0)");
    ctx.fillStyle=jg; ctx.beginPath(); ctx.ellipse(jx,Y(1)+jLen*.4,w*.055,jLen*.55,0,0,Math.PI*2); ctx.fill();
  }

  const tw=w*.24, th=h*.175, txOff=-tw*.08;
  [[x+txOff,y+h*.07],[x+w-txOff-tw,y+h*.07],[x+txOff,y+h*.72],[x+w-txOff-tw,y+h*.72]]
    .forEach(([tx,ty])=>drawWheel(tx,ty,tw,th,pal));

  const rwy=Y(.77);
  const rwg=ctx.createLinearGradient(X(0),rwy,X(0),rwy+h*.06);
  rwg.addColorStop(0,lighten(pal.body,.1)); rwg.addColorStop(1,pal.dark);
  poly([[X(-.56),rwy+h*.055],[X(-.56),rwy+h*.015],[X(-.22),rwy],[X(.22),rwy],[X(.56),rwy+h*.015],[X(.56),rwy+h*.055],[X(.22),rwy+h*.042],[X(-.22),rwy+h*.042]],rwg);
  ctx.fillStyle=pal.dark;
  ctx.fillRect(X(-.155),rwy+h*.042,w*.06,h*.038); ctx.fillRect(X(.095),rwy+h*.042,w*.06,h*.038);
  ctx.fillStyle=pal.accent; ctx.globalAlpha=.55;
  ctx.fillRect(X(-.50),rwy+h*.022,w*1.0,h*.016); ctx.globalAlpha=1;
  poly([[X(-.56),rwy+h*.015],[X(-.56),rwy+h*.065],[X(-.50),rwy+h*.065],[X(-.50),rwy+h*.015]],pal.dark);
  poly([[X(.50),rwy+h*.015],[X(.50),rwy+h*.065],[X(.56),rwy+h*.065],[X(.56),rwy+h*.015]],pal.dark);

  const podFY=Y(.24), podRY=Y(.76);
  const piFL=X(-.20), piRL=X(-.24), poFL=X(-.46), poRL=X(-.50);
  const plg=ctx.createLinearGradient(poFL,0,piFL,0);
  plg.addColorStop(0,pal.dark); plg.addColorStop(.4,pal.body); plg.addColorStop(.85,lighten(pal.body,.18)); plg.addColorStop(1,pal.body);
  poly([[piFL,podFY],[poFL,podFY+h*.04],[poRL,podRY],[piRL,podRY]],plg);
  poly([[poFL,podFY+h*.04],[poFL,podFY+h*.10],[poRL,podRY+h*.028],[poRL,podRY]],pal.dark);
  poly([[poFL+w*.03,podFY+h*.05],[poFL+w*.03,podFY+h*.14],[poFL+w*.10,podFY+h*.14],[poFL+w*.12,podFY+h*.05]],"rgba(0,0,0,.75)");
  const piFR=X(.20), piRR=X(.24), poFR=X(.46), poRR=X(.50);
  const prg=ctx.createLinearGradient(piFR,0,poFR,0);
  prg.addColorStop(0,pal.body); prg.addColorStop(.15,lighten(pal.body,.18)); prg.addColorStop(.6,pal.body); prg.addColorStop(1,pal.dark);
  poly([[piFR,podFY],[poFR,podFY+h*.04],[poRR,podRY],[piRR,podRY]],prg);
  poly([[poFR,podFY+h*.04],[poFR,podFY+h*.10],[poRR,podRY+h*.028],[poRR,podRY]],pal.dark);
  poly([[poFR-w*.03,podFY+h*.05],[poFR-w*.03,podFY+h*.14],[poFR-w*.10,podFY+h*.14],[poFR-w*.12,podFY+h*.05]],"rgba(0,0,0,.75)");

  const bRW=w*.28, bMW=w*.25, bFW=w*.13, bNT=w*.035;
  const fp=[[cx-bRW,Y(.74)],[cx-bMW,Y(.44)],[cx-bFW,Y(.16)],[cx-bNT,Y(.01)],[cx+bNT,Y(.01)],[cx+bFW,Y(.16)],[cx+bMW,Y(.44)],[cx+bRW,Y(.74)]];
  const fg=ctx.createLinearGradient(cx-bRW,0,cx+bRW,0);
  fg.addColorStop(0,pal.dark); fg.addColorStop(.18,pal.body); fg.addColorStop(.42,lighten(pal.body,.30)); fg.addColorStop(.55,lighten(pal.body,.15)); fg.addColorStop(.75,pal.body); fg.addColorStop(1,pal.dark);
  poly(fp,fg);
  ctx.save(); ctx.globalAlpha=.28; polyStroke(fp,lighten(pal.body,.55),1); ctx.globalAlpha=1; ctx.restore();
  poly([[cx-bRW,Y(.74)],[cx-bMW,Y(.44)],[cx-bFW,Y(.16)],[cx-w*.20,Y(.16)],[cx-w*.18,Y(.44)],[cx-w*.22,Y(.74)]],"rgba(0,0,0,.18)");
  poly([[cx+bRW,Y(.74)],[cx+bMW,Y(.44)],[cx+bFW,Y(.16)],[cx+w*.20,Y(.16)],[cx+w*.18,Y(.44)],[cx+w*.22,Y(.74)]],"rgba(0,0,0,.18)");
  const sg=ctx.createLinearGradient(0,Y(.01),0,Y(.74));
  sg.addColorStop(0,hexA(pal.accent,.9)); sg.addColorStop(.5,hexA(pal.accent,.6)); sg.addColorStop(1,hexA(pal.accent,.15));
  poly([[cx-w*.04,Y(.01)],[cx+w*.04,Y(.01)],[cx+w*.055,Y(.74)],[cx-w*.055,Y(.74)]],sg);

  const czY=Y(.26), czH=h*.32, czW=w*.22;
  ctx.fillStyle="#080A10"; ctx.beginPath();
  ctx.moveTo(cx-czW*.55,czY+czH); ctx.bezierCurveTo(cx-czW*.62,czY+czH*.6,cx-czW*.45,czY,cx,czY-h*.012);
  ctx.bezierCurveTo(cx+czW*.45,czY,cx+czW*.62,czY+czH*.6,cx+czW*.55,czY+czH); ctx.closePath(); ctx.fill();
  const gg=ctx.createRadialGradient(cx-czW*.15,czY+czH*.22,czH*.04,cx,czY+czH*.5,czH*.5);
  gg.addColorStop(0,"rgba(180,210,255,.75)"); gg.addColorStop(.3,isPlayer?"rgba(30,80,200,.70)":"rgba(15,15,40,.80)"); gg.addColorStop(.75,isPlayer?"rgba(5,20,100,.88)":"rgba(5,5,20,.90)"); gg.addColorStop(1,"rgba(0,0,0,.95)");
  ctx.fillStyle=gg; ctx.beginPath();
  ctx.moveTo(cx-czW*.44,czY+czH); ctx.bezierCurveTo(cx-czW*.50,czY+czH*.6,cx-czW*.35,czY+h*.01,cx,czY+h*.005);
  ctx.bezierCurveTo(cx+czW*.35,czY+h*.01,cx+czW*.50,czY+czH*.6,cx+czW*.44,czY+czH); ctx.closePath(); ctx.fill();
  ctx.save(); ctx.globalAlpha=.55;
  const spec=ctx.createRadialGradient(cx-czW*.18,czY+czH*.14,0,cx-czW*.18,czY+czH*.14,czH*.28);
  spec.addColorStop(0,"rgba(255,255,255,.9)"); spec.addColorStop(.4,"rgba(200,220,255,.4)"); spec.addColorStop(1,"rgba(0,0,0,0)");
  ctx.fillStyle=spec; ctx.beginPath();
  ctx.ellipse(cx-czW*.18,czY+czH*.18,czW*.28,czH*.20,-0.4,0,Math.PI*2); ctx.fill(); ctx.restore();
  ctx.save(); ctx.strokeStyle="#0A0C14"; ctx.lineWidth=w*.05; ctx.lineCap="round";
  ctx.beginPath(); ctx.moveTo(cx-czW*.42,czY+czH*.08); ctx.bezierCurveTo(cx-czW*.30,czY-h*.02,cx+czW*.30,czY-h*.02,cx+czW*.42,czY+czH*.08);
  ctx.stroke(); ctx.restore();

  const fwg=ctx.createLinearGradient(X(-.48),0,X(.48),0);
  fwg.addColorStop(0,pal.dark); fwg.addColorStop(.5,lighten(pal.body,.1)); fwg.addColorStop(1,pal.dark);
  poly([[cx-w*.01,Y(.02)],[cx-w*.27,Y(.02)],[cx-w*.48,Y(.06)],[cx-w*.46,Y(.10)],[cx-w*.24,Y(.07)],[cx-w*.01,Y(.055)]],fwg);
  poly([[cx+w*.01,Y(.02)],[cx+w*.27,Y(.02)],[cx+w*.48,Y(.06)],[cx+w*.46,Y(.10)],[cx+w*.24,Y(.07)],[cx+w*.01,Y(.055)]],fwg);
  ctx.fillStyle=pal.dark;
  poly([[cx-w*.46,Y(.04)],[cx-w*.50,Y(.04)],[cx-w*.50,Y(.11)],[cx-w*.46,Y(.11)]],pal.dark);
  poly([[cx+w*.46,Y(.04)],[cx+w*.50,Y(.04)],[cx+w*.50,Y(.11)],[cx+w*.46,Y(.11)]],pal.dark);
  const ntg=ctx.createLinearGradient(cx-w*.04,0,cx+w*.04,0);
  ntg.addColorStop(0,pal.dark); ntg.addColorStop(.5,lighten(pal.body,.25)); ntg.addColorStop(1,pal.dark);
  poly([[cx-bNT,Y(.01)],[cx-w*.025,Y(.055)],[cx+w*.025,Y(.055)],[cx+bNT,Y(.01)]],ntg);

  ctx.save();
  if (isPlayer) {
    ctx.shadowColor="#99CCFF"; ctx.shadowBlur=16; ctx.fillStyle="#DDEEFF";
    poly([[cx-w*.44,Y(.065)],[cx-w*.28,Y(.065)],[cx-w*.28,Y(.09)],[cx-w*.44,Y(.09)]],"#DDEEFF");
    poly([[cx+w*.28,Y(.065)],[cx+w*.44,Y(.065)],[cx+w*.44,Y(.09)],[cx+w*.28,Y(.09)]],"#DDEEFF");
    ctx.strokeStyle="rgba(160,200,255,.65)"; ctx.lineWidth=1.2;
    ctx.beginPath(); ctx.moveTo(cx-w*.25,Y(.04)); ctx.lineTo(cx-w*.03,Y(.04)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx+w*.03,Y(.04)); ctx.lineTo(cx+w*.25,Y(.04)); ctx.stroke();
  } else {
    ctx.shadowColor="#FF2200"; ctx.shadowBlur=18; ctx.fillStyle="#FF3311";
    poly([[cx-w*.22,Y(.87)],[cx-w*.06,Y(.87)],[cx-w*.05,Y(.91)],[cx-w*.23,Y(.91)]],"#FF3311");
    poly([[cx+w*.06,Y(.87)],[cx+w*.22,Y(.87)],[cx+w*.23,Y(.91)],[cx+w*.05,Y(.91)]],"#FF3311");
    ctx.shadowBlur=8; ctx.fillStyle="rgba(255,60,0,.4)";
    ctx.fillRect(cx-w*.15,Y(.91),w*.30,h*.015);
  }
  ctx.restore();
  ctx.restore();
}

function drawWheel(x,y,w,h,pal) {
  const cx=x+w/2, cy=y+h/2;
  ctx.save();
  const tGrad=ctx.createRadialGradient(cx-w*.15,cy-h*.15,0,cx,cy,w*.55);
  tGrad.addColorStop(0,"#303030"); tGrad.addColorStop(.55,"#1A1A1A"); tGrad.addColorStop(1,"#0A0A0A");
  ctx.fillStyle=tGrad; roundRect(x,y,w,h,w*.28); ctx.fill();
  const rp=w*.20, rimW=w-rp*2, rimH=h-rp*1.6;
  const rimGrad=ctx.createLinearGradient(x+rp,y+rp*.8,x+rp+rimW,y+rp*.8);
  rimGrad.addColorStop(0,darken(pal.rim,.55)); rimGrad.addColorStop(.3,pal.rim); rimGrad.addColorStop(.6,lighten(pal.rim,.15)); rimGrad.addColorStop(1,darken(pal.rim,.4));
  ctx.fillStyle=rimGrad; roundRect(x+rp,y+rp*.8,rimW,rimH,w*.10); ctx.fill();
  ctx.save(); ctx.translate(cx,cy); ctx.strokeStyle=darken(pal.rim,.3); ctx.lineWidth=w*.055;
  for (let i=0; i<5; i++) {
    ctx.save(); ctx.rotate(i*Math.PI/2.5); ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(0,-rimH/2); ctx.stroke(); ctx.restore();
  }
  ctx.restore();
  ctx.restore();
}

function hexA(hex, a) { return hex + Math.floor(a * 255).toString(16).padStart(2, '0'); }
function lighten(hex, percent) { return adjustBrightness(hex, percent); }
function darken(hex, percent) { return adjustBrightness(hex, -percent); }
function adjustBrightness(hex, percent) {
  let R = parseInt(hex.substring(1,3),16), G = parseInt(hex.substring(3,5),16), B = parseInt(hex.substring(5,7),16);
  R = Math.min(255, Math.max(0, parseInt(R * (1 + percent))));
  G = Math.min(255, Math.max(0, parseInt(G * (1 + percent))));
  B = Math.min(255, Math.max(0, parseInt(B * (1 + percent))));
  return `#${((1 << 24) + (R << 16) + (G << 8) + B).toString(16).slice(1)}`;
}
function roundRect(x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x+r, y); ctx.lineTo(x+w-r, y); ctx.quadraticCurveTo(x+w, y, x+w, y+r); ctx.lineTo(x+w, y+h-r); ctx.quadraticCurveTo(x+w, y+h, x+w-r, y+h); ctx.lineTo(x+r, y+h); ctx.quadraticCurveTo(x, y+h, x, y+h-r); ctx.lineTo(x, y+r); ctx.quadraticCurveTo(x, y, x+r, y); ctx.closePath();
}

function updateHUD() {
  if (hudScore) hudScore.textContent = Math.floor(score);
  if (hudTime) hudTime.textContent = elapsed.toFixed(1) + "s";
}

function endGame() {
  showScreen("gameover");
  const finalScoreEl = document.getElementById("final-score");
  if(finalScoreEl) finalScoreEl.textContent = Math.floor(score);
  submitScoreOnChain(Math.floor(score), Math.floor(elapsed));
}

document.getElementById("btn-connect")?.addEventListener("click", connectWallet);
document.getElementById("btn-start")?.addEventListener("click", startGame);
document.getElementById("btn-restart")?.addEventListener("click", () => { showScreen("start"); });
