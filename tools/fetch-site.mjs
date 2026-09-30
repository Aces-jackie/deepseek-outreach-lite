#!/usr/bin/env node
/**
 * fetch-site.mjs — 独立站信息抓取工具（零依赖，需 Node 18+）
 * 用法：
 *   node fetch-site.mjs <店铺链接>          结果存到 ./site-data/<域名>/
 *   node fetch-site.mjs <店铺链接> --out D:\抓取结果
 * 产物：
 *   summary.txt      → 整段复制进 DeepSeek「建联文案」对话
 *   main-image.jpg   → 主图，手动插入 Excel
 *   products.json    → 原始产品目录（Shopify 站才有）
 */
import fs from 'node:fs';
import path from 'node:path';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function fail(msg) { console.error('✗ ' + msg); process.exit(1); }

const rawArg = process.argv[2];
if (!rawArg) fail('用法: node fetch-site.mjs <店铺链接> [--out 目录]');
const outIdx = process.argv.indexOf('--out');
const outRoot = outIdx > -1 ? process.argv[outIdx + 1] : path.join(process.cwd(), 'site-data');

let url = rawArg.trim();
if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
let host, origin;
try { const u = new URL(url); host = u.hostname; origin = u.origin; }
catch { fail('链接格式不对: ' + rawArg); }

const outDir = path.join(outRoot, host);
fs.mkdirSync(outDir, { recursive: true });

async function get(u, { binary = false, timeout = 25000 } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(u, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', Accept: '*/*' },
      redirect: 'follow', signal: ctl.signal,
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return binary ? Buffer.from(await res.arrayBuffer()) : await res.text();
  } finally { clearTimeout(t); }
}

function pick(re, s, g = 1) { const m = s.match(re); return m ? m[g].trim() : ''; }
function decode(s) { return s.replace(/&amp;/g, '&').replace(/&#\d+;/g, ''); }

const lines = [];
let mainImage = '';
let shopify = false;

// ---------- 1. Shopify 目录直取 ----------
try {
  const pj = JSON.parse(await get(`${origin}/products.json?limit=100`));
  if (Array.isArray(pj.products) && pj.products.length) {
    shopify = true;
    const ps = pj.products;
    fs.writeFileSync(path.join(outDir, 'products.json'), JSON.stringify(pj, null, 2));
    const prices = ps.flatMap(p => p.variants.map(v => parseFloat(v.price)).filter(n => !isNaN(n)));
    const lo = Math.min(...prices), hi = Math.max(...prices);
    const types = [...new Set(ps.map(p => p.product_type).filter(Boolean))];
    const tags = {};
    // 过滤 Shopify 内部管理标签（含 :: 或 => 的是商家后台元数据，非用户视角标签）
    ps.forEach(p => (p.tags || []).forEach(t => {
      if (t && !t.includes('::') && !t.includes('=>')) tags[t] = (tags[t] || 0) + 1;
    }));
    const topTags = Object.entries(tags).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([t, n]) => `${t}(${n})`);
    lines.push('【平台】Shopify（目录接口直取成功）');
    lines.push(`【在售产品数】约 ${ps.length}+ 款`);
    lines.push(`【价格区间】${lo} ~ ${hi}`);
    lines.push(`【品类(type)】${types.slice(0, 8).join(' / ') || '（未标 type）'}`);
    if (topTags.length) lines.push(`【高频标签】${topTags.join(', ')}`);
    lines.push('【在售样例】');
    for (const p of ps.slice(0, 8)) {
      const v = p.variants?.[0];
      lines.push(`  - ${p.title} | $${v?.price ?? '?'} | type: ${p.product_type || '-'} | tags: ${(p.tags || []).slice(0, 4).join(', ') || '-'}`);
    }
    const imgP = ps.find(p => p.images?.[0]?.src || p.featured_image);
    mainImage = imgP?.images?.[0]?.src || imgP?.featured_image || '';
  }
} catch { /* 非 Shopify，走首页 */ }

// ---------- 2. 首页 og 信息（补店名/slogan/主图） ----------
let html = '';
try { html = await get(origin + '/'); } catch (e) {
  if (!shopify) fail('抓取失败（' + e.message + '）。该站可能有防护，请走手动模式：自己开网页抄信息。');
}
if (html) {
  const title = pick(/<title[^>]*>([\s\S]*?)<\/title>/i, html);
  const ogTitle = decode(pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i, html));
  const ogDesc = decode(pick(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i, html)
    || pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i, html));
  const ogImg = decode(pick(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i, html));
  if (!shopify) {
    const h1h2 = [...html.matchAll(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/gi)]
      .map(m => pick(/>([^<>]+)</, m[1]) || m[1].replace(/<[^>]+>/g, '').trim())
      .filter(t => t && t.length < 80).slice(0, 8);
    const ship = [...html.matchAll(/([^<>]{0,60}(?:shipping|delivery|ship in|days)[^<>]{0,60})/gi)]
      .map(m => m[1].trim()).filter((v, i, a) => a.indexOf(v) === i).slice(0, 6);
    lines.unshift(
      '【平台】非 Shopify 或目录接口不可用（首页提取）',
      '【店名】' + (ogTitle || title || host),
      '【Slogan/描述】' + (ogDesc || '（未提取到，请首页自查）'),
    );
    if (h1h2.length) lines.push('【首页重点词】' + h1h2.join(' | '));
    if (ship.length) lines.push('【物流时效信号】' + ship.join(' ; '));
  } else {
    lines.unshift('【店名】' + (ogTitle || title || host));
    if (ogDesc) lines.splice(2, 0, '【Slogan/描述】' + ogDesc);
  }
  if (!mainImage) mainImage = ogImg;
}

// ---------- 3. 主图落盘 ----------
if (mainImage) {
  if (mainImage.startsWith('//')) mainImage = 'https:' + mainImage;
  try {
    const buf = await get(mainImage, { binary: true });
    const ext = (mainImage.match(/\.(png|webp|jpe?g)(\?|$)/i)?.[1] || 'jpg').toLowerCase();
    const file = path.join(outDir, 'main-image.' + ext);
    fs.writeFileSync(file, buf);
    lines.push(`【主图】已下载 → ${file}（手动插入 Excel）`);
  } catch { lines.push('【主图】下载失败（' + mainImage + '），请浏览器右键另存'); }
} else {
  lines.push('【主图】未提取到，请浏览器右键另存产品图');
}

lines.push('【链接】' + url);
const summary = lines.join('\n') + '\n\n——以下交给 DeepSeek——\n把上面全部信息复制进「建联文案」对话即可。\n';
fs.writeFileSync(path.join(outDir, 'summary.txt'), summary, 'utf8');

console.log('==========================================');
console.log(summary);
console.log('==========================================');
console.log('✓ 全部产物已存到: ' + outDir);
