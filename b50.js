// CHUNITHM B50 图片生成器（在 CHUNITHM-NET 登录状态下以书签运行）
// 数据：CHUNITHM-NET 的 ratingDetailBest / 新曲枠页面 + otoge-db 的谱面定数
(async function () {
  'use strict';

  const TEST = window.__B50_TEST__ || null;
  const CONST_URL = 'https://raw.githubusercontent.com/zvuc/otoge-db/master/chunithm/data/music-ex.json';
  const HOST = location.hostname;
  const BASE = HOST === 'chunithm-net-eng.com'
    ? 'https://chunithm-net-eng.com/mobile/'
    : 'https://new.chunithm-net.com/chuni-mobile/html/mobile/';
  const URL_PLAYER = BASE + 'home/playerData/';
  const DIFFS = [
    { key: 'bas', name: 'BASIC', short: 'BAS', color: '#22bb5b' },
    { key: 'adv', name: 'ADVANCED', short: 'ADV', color: '#e8a10a' },
    { key: 'exp', name: 'EXPERT', short: 'EXP', color: '#e3374c' },
    { key: 'mas', name: 'MASTER', short: 'MAS', color: '#9b3fd6' },
    { key: 'ult', name: 'ULTIMA', short: 'ULT', color: '#1a1a1a' },
  ];
  const FONT = '"Noto Sans JP","Hiragino Kaku Gothic ProN","Meiryo","Microsoft YaHei",sans-serif';

  if (document.getElementById('b50-overlay')) document.getElementById('b50-overlay').remove();

  // ---------- 浮层 UI ----------
  const overlay = document.createElement('div');
  overlay.id = 'b50-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#0d1020;color:#fff;' +
    'font:15px/1.6 ' + FONT + ';overflow:auto;-webkit-overflow-scrolling:touch;padding:16px;box-sizing:border-box;';
  const box = document.createElement('div');
  box.style.cssText = 'max-width:960px;margin:0 auto;text-align:center;';
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '×';
  closeBtn.style.cssText = 'position:fixed;top:10px;right:14px;width:40px;height:40px;border-radius:50%;' +
    'border:1px solid #fff8;background:#0006;color:#fff;font-size:24px;cursor:pointer;z-index:100000;';
  let aborted = false;
  closeBtn.onclick = () => { aborted = true; overlay.remove(); };
  const status = document.createElement('div');
  status.style.cssText = 'margin-top:30vh;font-size:17px;';
  box.appendChild(status);
  overlay.append(closeBtn, box);
  document.body.appendChild(overlay);
  const say = (t) => { status.textContent = t; };
  const fail = (t) => {
    status.style.cssText += 'background:#c62f3b33;border:1px solid #c62f3b;border-radius:10px;padding:16px;';
    status.textContent = '出错了：' + t;
  };

  if (!TEST && HOST !== 'new.chunithm-net.com' && HOST !== 'chunithm-net-eng.com') {
    fail('请先登录 CHUNITHM-NET（new.chunithm-net.com），在其页面上运行本书签。');
    return;
  }

  // ---------- 工具函数 ----------
  const fetchDoc = async (url) => {
    const res = await fetch(url, { credentials: 'include' });
    if (res.status === 503) throw new Error('CHUNITHM-NET 正在维护中。');
    if (!res.ok) throw new Error('HTTP ' + res.status + '：' + url);
    const html = await res.text();
    if (html.includes('再度ログインしてください') || html.includes('Please log in again')) {
      throw new Error('登录已失效，请重新登录 CHUNITHM-NET（在别处登录也会使这里失效）。');
    }
    return new DOMParser().parseFromString(html, 'text/html');
  };

  const parseRatingList = (doc) => {
    const forms = doc.querySelectorAll('form[action*="sendMusicDetail"]');
    return [...forms].map((f) => {
      const val = (n) => (f.querySelector('input[name="' + n + '"]') || {}).value;
      const scoreEl = f.querySelector('.text_b') || f.querySelector('.play_musicdata_highscore');
      return {
        idx: val('idx'),
        diff: Number(val('diff')),
        title: (f.querySelector('.music_title') || {}).textContent.trim(),
        score: parseInt((scoreEl ? scoreEl.textContent : '0').replace(/[^0-9]/g, ''), 10) || 0,
      };
    }).filter((s) => s.idx != null && s.score > 0);
  };

  // 単曲レート（VERSE 以降の計算式）
  const songRating = (s, c) => {
    if (!c) return 0;
    let r;
    if (s >= 1009000) r = c + 2.15;
    else if (s >= 1007500) r = c + 2.0 + (s - 1007500) / 100 * 0.01;
    else if (s >= 1005000) r = c + 1.5 + (s - 1005000) / 50 * 0.01;
    else if (s >= 1000000) r = c + 1.0 + (s - 1000000) / 100 * 0.01;
    else if (s >= 975000) r = c + (s - 975000) / 250 * 0.01;
    else if (s >= 925000) r = c - 3 + (s - 925000) * 3 / 50000;
    else if (s >= 900000) r = c - 5 + (s - 900000) * 2 / 25000;
    else if (s >= 800000) r = (c - 5) / 2 + (s - 800000) * ((c - 5) / 2) / 100000;
    else if (s >= 500000) r = ((c - 5) / 2) * (s - 500000) / 300000;
    else r = 0;
    return Math.max(0, Math.floor(r * 10000 + 1e-6) / 10000);
  };

  const scoreRank = (s) => [
    [1009000, 'SSS+'], [1007500, 'SSS'], [1005000, 'SS+'], [1000000, 'SS'], [990000, 'S+'], [975000, 'S'],
    [950000, 'AAA'], [925000, 'AA'], [900000, 'A'], [800000, 'BBB'], [700000, 'BB'], [600000, 'B'], [500000, 'C'],
  ].find(([b]) => s >= b)?.[1] || 'D';

  const floor2 = (x) => (Math.floor(x * 100 + 1e-6) / 100).toFixed(2);

  // ---------- 取数 ----------
  let player, best, news;
  try {
    if (TEST) {
      ({ player, best, news } = TEST);
    } else {
      say('正在读取玩家信息…');
      const pdoc = await fetchDoc(URL_PLAYER);
      const nameEl = pdoc.querySelector('.player_name_in');
      let ratingStr = '';
      pdoc.querySelectorAll('.player_rating_num_block img').forEach((img) => {
        // 数字图片文件名末尾是数字，小数点图片以 "comma.png" 结尾
        const ch = (img.getAttribute('src') || '').replace(/\.png.*$/, '').slice(-1);
        if (/\d/.test(ch)) ratingStr += ch;
        else if (ch === 'a') ratingStr += '.';
      });
      player = { name: nameEl ? nameEl.textContent.trim() : 'PLAYER', rating: ratingStr };

      // 新曲枠页面的路径从玩家页链接里找，找不到则用 ratingDetailRecent
      const links = [...pdoc.querySelectorAll('a[href],form[action]')].map((e) => e.getAttribute('href') || e.getAttribute('action'));
      const newPath = ['ratingDetailNew', 'ratingDetailRecent'].find((p) => links.some((l) => l && l.includes(p))) || 'ratingDetailRecent';
      if (aborted) return;

      say('正在读取 BEST 枠…');
      best = parseRatingList(await fetchDoc(URL_PLAYER + 'ratingDetailBest/'));
      if (aborted) return;
      say('正在读取新曲枠…');
      news = parseRatingList(await fetchDoc(URL_PLAYER + newPath + '/'));
      if (!best.length) throw new Error('BEST 枠为空。需要开通 CHUNITHM-NET スタンダードコース，或页面结构已变更。');

      say('正在下载谱面定数表（otoge-db，约 3MB）…');
      const db = await fetch(CONST_URL).then((r) => { if (!r.ok) throw new Error('定数表下载失败 ' + r.status); return r.json(); });
      const byId = new Map(db.map((m) => [String(m.id), m]));
      const byTitle = new Map(db.map((m) => [m.title, m]));
      const enrich = (s) => {
        const m = byId.get(String(s.idx)) || byTitle.get(s.title);
        const d = DIFFS[s.diff] || DIFFS[3];
        let c = m ? parseFloat(m['lev_' + d.key + '_i']) : NaN;
        let estimated = false;
        if (!(c > 0) && m && m['lev_' + d.key]) {
          // 定数未公开时按等级估算：14+ → 14.5
          const lv = m['lev_' + d.key];
          c = parseFloat(lv) + (lv.endsWith('+') ? 0.5 : 0);
          estimated = true;
        }
        if (!(c > 0)) c = 0;
        return {
          ...s, constant: c, estimated,
          jacket: m && m.image ? BASE + 'img/' + m.image : null,
        };
      };
      best = best.map(enrich);
      news = news.map(enrich);
    }
    if (aborted) return;

    [...best, ...news].forEach((s) => { s.rating = songRating(s.score, s.constant); });

    say('正在加载曲绘…');
    const loadImg = (src) => new Promise((res) => {
      if (!src) return res(null);
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => res(null);
      img.src = src;
    });
    const all = [...best, ...news];
    for (let i = 0; i < all.length; i += 8) {
      const batch = all.slice(i, i + 8);
      const imgs = await Promise.all(batch.map((s) => loadImg(s.jacket)));
      imgs.forEach((img, j) => { batch[j].img = img; });
      if (aborted) return;
    }

    say('正在绘制图片…');
    const canvas = draw(player, best, news);
    showResult(canvas);
  } catch (e) {
    console.error(e);
    fail(e.message || String(e));
  }

  // ---------- 绘制 ----------
  function draw(player, best, news) {
    const COLS = 5, CW = 296, CH = 112, GAP = 12, PAD = 32, HEAD = 190, SEC = 56, FOOT = 50;
    const rows = (n) => Math.ceil(n / COLS);
    const W = PAD * 2 + COLS * CW + (COLS - 1) * GAP;
    const H = HEAD + SEC + rows(best.length) * (CH + GAP) + SEC + rows(news.length) * (CH + GAP) + FOOT;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d');

    // 背景
    const bg = g.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#141a33'); bg.addColorStop(0.55, '#1d1438'); bg.addColorStop(1, '#0d2230');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.globalAlpha = 0.06; g.strokeStyle = '#fff'; g.lineWidth = 1;
    for (let x = -H; x < W; x += 28) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + H, H); g.stroke(); }
    g.globalAlpha = 1;

    const sum = (l) => l.reduce((a, s) => a + s.rating, 0);
    const bAvg = best.length ? sum(best) / best.length : 0;
    const nAvg = news.length ? sum(news) / news.length : 0;
    const total = (sum(best) + sum(news)) / 50;

    // 头部
    g.textBaseline = 'alphabetic';
    g.fillStyle = '#ffffff99'; g.font = '600 20px ' + FONT;
    g.fillText('CHUNITHM  RATING  BEST 50', PAD, PAD + 22);
    g.fillStyle = '#fff'; g.font = 'bold 48px ' + FONT;
    g.fillText(fit(g, player.name, 640), PAD, PAD + 82);

    const stat = (label, val, x, color, big) => {
      g.textAlign = 'right';
      g.fillStyle = '#ffffff99'; g.font = '600 16px ' + FONT;
      g.fillText(label, x, PAD + 30);
      g.fillStyle = color; g.font = 'bold ' + (big ? 56 : 36) + 'px ' + FONT;
      g.fillText(val, x, PAD + (big ? 88 : 80));
      g.textAlign = 'left';
    };
    const rx = W - PAD;
    stat('RATING', player.rating || floor2(total), rx, '#ffd65a', true);
    stat('NEW 20 AVG', floor2(nAvg), rx - 260, '#7ee0ff');
    stat('BEST 30 AVG', floor2(bAvg), rx - 460, '#c9a2ff');
    g.fillStyle = '#ffffff80'; g.font = '14px ' + FONT;
    g.textAlign = 'right';
    g.fillText('计算值 (B30+N20)/50 = ' + floor2(total) + '　·　单曲最高 ' + floor2(Math.max(0, ...[...best, ...news].map((s) => s.rating))), rx, PAD + 122);
    g.textAlign = 'left';
    g.fillStyle = '#ffffff33'; g.fillRect(PAD, HEAD - 22, W - PAD * 2, 2);

    let y = HEAD;
    const section = (label, list, color, offset) => {
      g.fillStyle = color; g.fillRect(PAD, y + 12, 6, 28);
      g.fillStyle = '#fff'; g.font = 'bold 26px ' + FONT;
      g.fillText(label, PAD + 16, y + 36);
      y += SEC;
      list.forEach((s, i) => {
        const cx = PAD + (i % COLS) * (CW + GAP);
        const cy = y + Math.floor(i / COLS) * (CH + GAP);
        card(g, s, i + 1 + offset, cx, cy, CW, CH);
      });
      y += rows(list.length) * (CH + GAP);
    };
    section('BEST 30', best, '#c9a2ff', 0);
    section('NEW 20', news, '#7ee0ff', 0);

    const d = new Date();
    g.fillStyle = '#ffffff66'; g.font = '13px ' + FONT;
    g.fillText('Generated ' + d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate() +
      '  ·  data: CHUNITHM-NET / otoge-db  ·  * = 定数未公開（推定）', PAD, H - 20);
    return cv;
  }

  function card(g, s, no, x, y, w, h) {
    const d = DIFFS[s.diff] || DIFFS[3];
    round(g, x, y, w, h, 10);
    g.fillStyle = 'rgba(255,255,255,0.07)'; g.fill();
    g.lineWidth = 2; g.strokeStyle = d.key === 'ult' ? '#e8e8e8' : d.color; g.stroke();

    // 曲绘
    const J = h - 16, jx = x + 8, jy = y + 8;
    g.save(); round(g, jx, jy, J, J, 6); g.clip();
    if (s.img) g.drawImage(s.img, jx, jy, J, J);
    else { g.fillStyle = '#ffffff1a'; g.fillRect(jx, jy, J, J); g.fillStyle = '#ffffff55'; g.font = '12px ' + FONT; g.fillText('NO IMAGE', jx + 18, jy + J / 2 + 4); }
    g.restore();
    // 序号
    g.fillStyle = 'rgba(0,0,0,.7)'; round(g, jx, jy, 34, 20, 5); g.fill();
    g.fillStyle = '#fff'; g.font = 'bold 13px ' + FONT; g.textAlign = 'center';
    g.fillText('#' + no, jx + 17, jy + 15); g.textAlign = 'left';

    const tx = jx + J + 10, tw = x + w - tx - 10;
    g.fillStyle = '#fff'; g.font = 'bold 16px ' + FONT;
    g.fillText(fit(g, s.title, tw), tx, y + 28);

    // 难度 + 定数徽章
    const badge = d.short + ' ' + (s.constant ? s.constant.toFixed(1) : '?') + (s.estimated ? '*' : '');
    g.font = 'bold 13px ' + FONT;
    const bw = g.measureText(badge).width + 14;
    round(g, tx, y + 38, bw, 20, 4);
    g.fillStyle = d.color; g.fill();
    if (d.key === 'ult') { g.strokeStyle = '#e33'; g.lineWidth = 1.5; g.stroke(); }
    g.fillStyle = '#fff'; g.fillText(badge, tx + 7, y + 53);
    const rk = scoreRank(s.score);
    g.fillStyle = rk.startsWith('SSS') ? '#ffd65a' : rk.startsWith('SS') ? '#ffe9a8' : '#ddd';
    g.font = 'bold 15px ' + FONT;
    g.fillText(rk, tx + bw + 8, y + 54);

    g.fillStyle = '#fff'; g.font = 'bold 22px ' + FONT;
    g.fillText(s.score.toLocaleString('en-US'), tx, y + h - 16);
    g.textAlign = 'right';
    g.fillStyle = '#ffd65a'; g.font = 'bold 20px ' + FONT;
    g.fillText(floor2(s.rating), x + w - 10, y + h - 16);
    g.textAlign = 'left';
  }

  function round(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }

  function fit(g, text, max) {
    if (g.measureText(text).width <= max) return text;
    let t = text;
    while (t.length > 1 && g.measureText(t + '…').width > max) t = t.slice(0, -1);
    return t + '…';
  }

  function showResult(cv) {
    box.innerHTML = '';
    let url;
    try { url = cv.toDataURL('image/png'); } catch (e) { url = null; }
    const tip = document.createElement('div');
    tip.style.cssText = 'margin:8px 0 12px;';
    tip.textContent = url ? '生成完成！手机可长按图片保存。' : '图片已生成，但浏览器不允许导出（曲绘跨域），请截图保存。';
    box.appendChild(tip);
    if (url) {
      const a = document.createElement('a');
      a.href = url; a.download = 'chunithm-b50-' + Date.now() + '.png';
      a.textContent = '下载 PNG';
      a.style.cssText = 'display:inline-block;margin-bottom:12px;padding:8px 22px;border-radius:999px;background:#ffd65a;color:#222;font-weight:bold;text-decoration:none;';
      box.appendChild(a);
      const img = document.createElement('img');
      img.src = url;
      img.style.cssText = 'display:block;width:100%;height:auto;border-radius:8px;';
      box.appendChild(img);
    } else {
      cv.style.cssText = 'width:100%;height:auto;';
      box.appendChild(cv);
    }
  }
})();
