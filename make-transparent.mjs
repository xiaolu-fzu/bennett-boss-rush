// 批量抠图 + 质量验证：主体保留率、透明区域分布
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sharp = require('E:/dev/.dsh/profiles/web/node_modules/sharp');

const jobs = [
  ['assets/boss1_geo_slime.png', 55],
  ['assets/boss2_abyss_mage.png', 55],
  ['assets/boss3_abyss_herald.png', 55],
];

async function cutout(file, TH) {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;
  const corners = [[0, 0], [W - 8, 0], [0, H - 8], [W - 8, H - 8]];
  let sr = 0, sg = 0, sb = 0, n = 0;
  for (const [sx, sy] of corners) {
    for (let y = sy; y < sy + 8; y++) for (let x = sx; x < sx + 8; x++) {
      const i = (y * W + x) * C;
      sr += data[i]; sg += data[i + 1]; sb += data[i + 2]; n++;
    }
  }
  const bg = { r: sr / n, g: sg / n, b: sb / n };
  const out = Buffer.from(data);
  let transparent = 0, centerAlive = 0, centerTotal = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = (y * W + x) * C;
      const d = Math.hypot(data[p] - bg.r, data[p + 1] - bg.g, data[p + 2] - bg.b);
      let a = 255;
      if (d < TH) a = 0;
      else if (d < TH + 40) a = Math.round(255 * (1 - (d - TH) / 40));
      out[p + 3] = a;
      if (a === 0) transparent++;
      // 中心 45% 区域主体保留检查
      if (x > W * 0.28 && x < W * 0.72 && y > H * 0.25 && y < H * 0.75) {
        centerTotal++;
        if (a > 60) centerAlive++;
      }
    }
  }
  const outFile = file.replace(/\.png$/i, '_cutout.png');
  await sharp(out, { raw: { width: W, height: H, channels: C } }).png().toFile(outFile);
  const pct = (x) => (x * 100).toFixed(1) + '%';
  console.log(file.split('/').pop(), '| 背景色', Math.round(bg.r) + ',' + Math.round(bg.g) + ',' + Math.round(bg.b),
    '| 透明占比', pct(transparent / (W * H)),
    '| 中心主体保留', pct(centerAlive / centerTotal), '->', outFile.split('/').pop());
}
(async () => {
  for (const [f, t] of jobs) await cutout(f, t);
})();
