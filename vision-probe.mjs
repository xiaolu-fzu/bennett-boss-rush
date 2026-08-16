// 直接调用 dsh-vision-router 的内置免费视觉链（OVHcloud 匿名端点，无需 key）
// 用法: node vision-probe.mjs <图片1> <图片2> ... （每张间隔 35s，满足 2req/min 限速）
import https from 'node:https';
import fs from 'node:fs';

const ENDPOINT = 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions';
const MODEL = 'Qwen2.5-VL-72B-Instruct';
const files = process.argv.slice(2);

function ask(path, question) {
  const b64 = fs.readFileSync(path).toString('base64');
  const ext = /\.png$/i.test(path) ? 'png' : (/\.jpe?g$/i.test(path) ? 'jpeg' : 'webp');
  const body = JSON.stringify({
    model: MODEL,
    max_tokens: 700,
    messages: [{ role: 'user', content: [
      { type: 'text', text: question },
      { type: 'image_url', image_url: { url: 'data:image/' + ext + ';base64,' + b64 } },
    ] }],
  });
  return new Promise((resolve) => {
    const req = https.request(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        try {
          const j = JSON.parse(d);
          resolve({ ok: true, text: (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || JSON.stringify(j).slice(0, 300) });
        } catch (e) { resolve({ ok: false, text: d.slice(0, 300) }); }
      });
    });
    req.on('error', (e) => resolve({ ok: false, text: 'ERR ' + e.code + ' ' + e.message }));
    req.setTimeout(90000, () => { req.destroy(); resolve({ ok: false, text: 'TIMEOUT' }); });
    req.write(body);
    req.end();
  });
}

const Q = '这是游戏素材图。请客观描述：1) 图片内容主体是什么；2) 背景是透明/纯色/还是复杂场景，是否带文字/水印/边框/说明；3) 主体是否清晰、居中、完整；4) 作为游戏内的角色或敌人立绘是否合适，有什么明显问题。用中文回答，简洁分点。';

(async () => {
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    console.log('=== ' + f + ' ===');
    const r = await ask(f, Q);
    console.log(r.ok ? r.text : 'FAIL: ' + r.text);
    if (i < files.length - 1) await new Promise((r) => setTimeout(r, 35000));
  }
  console.log('DONE');
})();
