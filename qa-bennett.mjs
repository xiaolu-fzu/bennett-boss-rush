/* ============================================================
   qa-bennett.mjs — 班尼特·炎光试炼 无头自动化测试
   测试工程师角色产出：在 Node 中模拟浏览器环境，驱动游戏
   完成「标题→三关→通关」与「死亡→重试」全流程，报告异常。
   用法：node qa-bennett.mjs
   ============================================================ */
import fs from 'node:fs';
import vm from 'node:vm';

const HTML = fs.readFileSync('bennett-trial.html', 'utf8');
const m = HTML.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error('✗ 未找到 <script> 块'); process.exit(1); }
const code = m[1];

/* ---- 画布 2D 上下文桩：任何方法调用都不抛错 ---- */
function makeCanvasStub() {
  const canvas = { width: 960, height: 540, style: {}, addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 540 }) };
  const ctxTarget = { canvas, measureText: () => ({ width: 10, height: 10 }) };
  const ctx = new Proxy(ctxTarget, {
    get(t, p) {
      if (p in t) return t[p];
      return () => ({ width: 10, height: 10, addColorStop() {} });
    },
    set() { return true; }
  });
  canvas.getContext = () => ctx;
  return canvas;
}

/* ---- 沙箱 ---- */
const canvasStub = makeCanvasStub();
const sandbox = {
  console,
  performance: { now: () => 0 },
  requestAnimationFrame: () => {},
  setTimeout, clearTimeout,
  Image: class { constructor(){} set src(v){} get src(){return '';} },
  navigator: { userAgent: 'node-qa' },
  Math, JSON, Date, isNaN, parseInt, parseFloat,
  __DSH_QA__: true,
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.document = {
  readyState: 'complete',
  addEventListener() {},
  getElementById: () => canvasStub,
  createElement: () => ({ style: {}, getContext: () => ctxFor(canvasStub), addEventListener() {} }),
};
function ctxFor(c) { return c.getContext(); }

vm.createContext(sandbox);
try {
  vm.runInContext(code, sandbox, { filename: 'bennett-trial.html<script>' });
} catch (e) {
  console.error('✗ 脚本编译/初始化失败:', e.stack || e);
  process.exit(1);
}

const G = sandbox.__game;
if (!G) { console.error('✗ window.__game 未暴露'); process.exit(1); }
console.log('✓ 脚本加载成功，__game API 可用');

/* ---- 工具 ---- */
const dt = 1 / 60;
const R = 30; // 每 R 帧读取一次状态
let frames = 0;
let errors = [];
let deaths = 0;
let bossHpSamples = {};   // 各关 Boss 血量抽样
let maxFramesPerLevel = 60 * 180; // 每关最多 3 分钟

function tickSafe() {
  try { G.tick(dt); return true; }
  catch (e) { errors.push({ frame: frames, err: (e && e.stack) || String(e) }); return false; }
}
function press(code) { try { G.press(code); } catch (e) { errors.push({ frame: frames, err: 'press:' + code + ' ' + (e && e.stack) }); } }

/* ---- 简单 AI：走向 Boss、随机跳跃/攻击/冲刺/大招 ---- */
function ai() {
  const p = G.player, b = G.boss;
  if (!p || !b) return;
  const px = p.x + p.w / 2, bx = b.x + b.w / 2;
  const dist = Math.abs(px - bx);
  G.held['KeyA'] = false; G.held['KeyD'] = false;
  // 前摇时后退保持距离，平时贴近
  if (b.state === 'windup') {
    if (Math.random() < 0.5) press('Space');       // 起跳闪避
    if (bx > px) G.held['KeyA'] = true; else G.held['KeyD'] = true;
  } else if (dist > 46) {
    if (bx > px) G.held['KeyD'] = true; else G.held['KeyA'] = true;
  }
  if (dist < 130 && Math.random() < 0.30) press('KeyJ');
  if (Math.random() < 0.05) press('KeyK');
  if (p.energy >= p.maxEnergy && Math.random() < 0.4) press('KeyE');
  if (p.hp < 30 && Math.random() < 0.3) { G.held['KeyD'] = false; G.held['KeyA'] = false; }
}

function sampleBoss() {
  const lv = G.level;
  const b = G.boss;
  if (!b) return;
  if (!bossHpSamples[lv]) bossHpSamples[lv] = [];
  bossHpSamples[lv].push(b.hp);
}

/* ================= 场景 A：完整通关（随机 AI，仅供参考） ================= */
console.log('—— 场景A：完整通关流程（随机AI，信息性） ——');
let levelStartFrame = 0;
let won = false;
for (; frames < 60 * 300; frames++) {
  const st = G.state;
  if (st === 'title') { press('Enter'); }
  else if (st === 'gameover') { deaths++; press('KeyR'); }
  else if (st === 'fight') ai();
  else if (st === 'finale') { won = true; break; }
  else if (st === 'victory') { sampleBoss(); }
  else if (st === 'intro') { /* 等待入场动画 */ }

  // 关卡超时保护：强制杀死 Boss 推进流程（避免测试挂死）
  if ((st === 'fight' || st === 'intro' || st === 'victory') && frames - levelStartFrame > maxFramesPerLevel && G.boss && !G.boss.dead) {
    console.log(`  [超时保护] 第${G.level + 1}关强制结束`);
    G.debug.killBoss();
  }
  if (st === 'fight' && frames - levelStartFrame === 0) { /* noop */ }

  if (!tickSafe()) break;
  if (frames % R === 0) sampleBoss();

  // 检测关卡推进
  if (st !== G.state) {
    if (G.state === 'fight' || G.state === 'intro') levelStartFrame = frames;
  }
}
console.log('  总帧数:', frames, '| 死亡次数:', deaths, '| 最终状态:', G.state);

if (!won && !errors.length) console.log('  ⚠ 未在限定帧内通关（可能 AI 太菜，但无异常）');

/* ================= 场景 B：死亡 → 重试路径 ================= */
console.log('—— 场景B：死亡与重试 ——');
G.debug.setState('fight');
G.debug.forcePlayerHp(1);
G.debug.forceBossHp(1);       // Boss 一击可杀，但先让玩家被打死
// 把玩家直接传送到 Boss 面前，保证接触伤害稳定触发（不依赖 Boss 随机近身招）
const GROUND_B = 470;
G.player.x = G.boss.x - G.player.w - 10;
G.player.y = GROUND_B - G.player.h;
let sawGameover = false;
for (let i = 0; i < 60 * 30; i++) {
  frames++;
  if (G.state === 'gameover') { sawGameover = true; press('KeyR'); }
  if (G.state === 'fight') {
    // 站着不动挨打，等死亡（若被击退则每帧拉回 Boss 面前）
    G.held['KeyA'] = false; G.held['KeyD'] = false;
    if (G.player.state === 'normal' && G.player.invuln <= 0) {
      G.player.x = G.boss.x - G.player.w - 10;
      G.player.y = GROUND_B - G.player.h;
    }
  }
  if (G.state === 'intro') break; // 重试成功回到入场
  if (!tickSafe()) break;
}
console.log('  触发 gameover:', sawGameover, '| 重试后状态:', G.state, '| 玩家血量:', G.player.hp, '| Boss血量:', G.boss.hp);
if (!sawGameover || G.state !== 'intro') {
  console.error('✗ 死亡重试流程异常');
  process.exitCode = 1;
}

/* ================= 场景 B2：战斗输出验证（伤害必须稳定生效） ================= */
console.log('—— 场景B2：玩家攻击能稳定削减 Boss 血量 ——');
G.debug.skipIntro();
const p2 = G.player, b2 = G.boss;
const GROUND = 470; // 竞技场地面高度（与游戏内常量一致）
// 重置双方状态，避免继承前序场景（B 遗留的 1 血 Boss）
G.debug.forceBossHp(b2.maxHp);
G.debug.forcePlayerHp(p2.maxHp);
// 直接把玩家贴脸放在 Boss 面前（注意：测试脚本里 G 是游戏 API 对象，勿与地面高度混淆）
b2.x = 600; b2.y = GROUND - b2.h; p2.x = 600 - p2.w - 24; p2.y = GROUND - p2.h;
p2.hp = p2.maxHp; p2.invuln = 9999; p2.state = 'normal'; p2.deathT = 0; // 免伤专注测量纯输出
const hpStart = b2.hp;
let dpsFrames = 0;
while (dpsFrames < 60 * 20 && G.boss && G.boss.hp > 0) {
  dpsFrames++;
  if (Math.random() < 0.5) press('KeyJ');     // 持续攻击
  if (G.player.energy >= G.player.maxEnergy) press('KeyE');
  if (!tickSafe()) break;
}
const dmgDealt = hpStart - G.boss.hp;
console.log('  20秒贴脸输出：Boss 血量 ' + hpStart + ' → ' + G.boss.hp + '（造成 ' + dmgDealt + ' 伤害）');
if (dmgDealt < 60) {
  console.error('✗ 伤害输出异常偏低，战斗系统可能失效');
  process.exitCode = 1;
}

/* ================= 场景 C：胜利推进到下一关/通关 ================= */
console.log('—— 场景C：击杀推进与通关结算 ——');
G.debug.setState('title'); G.press('Enter');   // 全新开局
for (let i = 0; i < 60 * 10; i++) { if (!tickSafe()) break; if (G.state !== 'title' && G.state !== 'intro') break; }
let sawVictory = false, sawFinale = false;
for (let i = 0; i < 60 * 90; i++) {
  frames++;
  if (G.state === 'fight' && G.boss) {
    G.debug.forceBossHp(1);            // 每帧强制 Boss 一击可杀
    G.debug.killBoss();
    G.debug.forcePlayerHp(100); G.player.invuln = 2;
  }
  if (G.state === 'victory') sawVictory = true;
  if (G.state === 'finale') { sawFinale = true; break; }
  if (G.state === 'gameover') { console.log('  [场景C] 意外死亡，重置'); G.debug.setState('fight'); G.debug.forcePlayerHp(100); }
  if (!tickSafe()) break;
}
console.log('  胜利状态:', sawVictory, '| 通关状态:', sawFinale, '| 当前状态:', G.state);
if (!sawFinale) { console.error('✗ 未推进到通关画面'); process.exitCode = 1; }

/* ================= 汇总 ================= */
console.log('—— 汇总 ——');
console.log('  Boss 血量抽样(首/末):', JSON.stringify(Object.fromEntries(
  Object.entries(bossHpSamples).map(([k, v]) => [k, v.length ? [v[0], v[v.length - 1]] : null])
)));
if (errors.length) {
  console.error('✗ 发现 ' + errors.length + ' 个运行时错误：');
  for (const e of errors.slice(0, 10)) console.error('  [帧' + e.frame + '] ' + e.err);
  process.exitCode = 1;
} else {
  console.log('✓ 全流程无运行时异常');
}
console.log('QA 完成', process.exitCode ? '(有失败)' : '(全部通过)');
