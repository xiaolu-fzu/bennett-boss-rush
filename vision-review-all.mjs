// 素材总览视觉审查：sharp 拼图 → 免费视觉链一次性审查全部素材
// 用法: node vision-review-all.mjs
import https from 'node:https';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sharp = require('E:/dev/.dsh/profiles/web/node_modules/sharp');

const files = [
  'assets/bennett_character.png',
  'assets/icon_10000051.png',
  'assets/splash_10000051.png',
  'assets/boss1_geo_slime.png',
  'assets/boss2_abyss_mage.png',
  'assets/boss3_abyss_herald.png',
];
const COLS = 3, CELL = 320;
const ROWS = Math.ceil(files.length / COLS);
const W = COLS * CELL, H = ROWS * CELL;

async function buildCollage() {
  const layers = [];
  for (let i = 0; i < files.length; i++) {
    const thumb = await sharp(files[i]).resize(280, 280, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
    const meta = await sharp(thumb).metadata();
    const x = (i % COLS) * CELL + Math.floor((CELL - meta.width) / 2);
    const y = Math.floor(i / COLS) * CELL + Math.floor((CELL - meta.height) / 2);
    layers.push({ input: thumb, left: x, top: y });
  }
  await sharp({ create: { width: W, height: H, channels: 3, background: { r: 235, g: 235, b: 235 } } })
    .composite(layers).png().toFile('assets/_review_collage.png');
  console.log('collage built:', W + 'x' + H);
}

function askVision(question, maxAttempts = 8) {
  const b64 = fs.readFileSync('assets/_review_collage.png').toString('base64');
  const body = JSON.stringify({
    model: 'Qwen2.5-VL-72B-Instruct',
    max_tokens: 1000,
    messages: [{ role: 'user', content: [
      { type: 'text', text: question },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,' + b64 } },
    ] }],
  });
  return new Promise((resolve) => {
    const req = https.request('https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        try {
          const j = JSON.parse(d);
          if (j.choices && j.choices[0] && j.choices[0].message) resolve({ ok: true, text: j.choices[0].message.content });
          else resolve({ ok: false, text: JSON.stringify(j).slice(0, 200) });
        } catch (e) { resolve({ ok: false, text: d.slice(0, 200) }); }
      });
    });
    req.on('error', (e) => resolve({ ok: false, text: 'ERR ' + e.code }));
    req.setTimeout(90000, () => { req.destroy(); resolve({ ok: false, text: 'TIMEOUT' }); });
    req.write(body);
    req.end();
  });
}

(async () => {
  await buildCollage();
  const Q = '这是一个 3 列网格拼图，每格一张游戏素材图，顺序为：第1行(左到右)：班尼特角色立绘、班尼特头像图标、班尼特横版立绘；第2行(左到右)：Boss1大型岩史莱姆图鉴图、Boss2雷深渊法师图鉴图、Boss3深渊使徒图鉴图。请逐格客观评估：1) 该格图片内容主体是什么；2) 背景是透明/纯色/还是复杂场景，是否带文字、水印、边框、UI说明；3) 主体是否清晰、居中、完整；4) 作为游戏内的角色或敌人立绘是否合适，有什么明显问题（如背景太乱、主体太小、带文字）。用中文分点回答。';
  const out = [];
  for (let a = 1; a <= 8; a++) {
    const r = await askVision(Q);
    if (r.ok) { out.push('=== 视觉审查结果 ===\n' + r.text); break; }
    const msg = 'attempt ' + a + ' failed: ' + r.text;
    console.log(msg + '（150s 后重试）');
    out.push(msg);
    await new Promise((r2) => setTimeout(r2, 150000));
  }
  fs.writeFileSync('vision-review-result.txt', out.join('\n\n'));
  console.log('DONE -> vision-review-result.txt');
})();
