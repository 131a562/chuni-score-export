// CHUNITHM B50 / 定数筛选 图片生成器（在 CHUNITHM-NET 登录状态下以书签运行）
// 数据：CHUNITHM-NET 的 rating 页面 / 全曲成绩页面 + otoge-db 的谱面定数
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
    { key: 'bas', name: 'Basic', short: 'BAS', color: '#22bb5b' },
    { key: 'adv', name: 'Advanced', short: 'ADV', color: '#e8a10a' },
    { key: 'exp', name: 'Expert', short: 'EXP', color: '#e3374c' },
    { key: 'mas', name: 'Master', short: 'MAS', color: '#9b3fd6' },
    { key: 'ult', name: 'Ultima', short: 'ULT', color: '#1a1a1a' },
  ];
  // iOS / macOS 用 Hiragino，Android 用 Noto CJK，Windows 用 Meiryo；简体中文字形缺失时由 PingFang / YaHei 补上
  const FONT = '"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","Noto Sans CJK JP","Yu Gothic","Meiryo",' +
    '"PingFang SC","Microsoft YaHei",system-ui,sans-serif';
  const PER_IMAGE = 200;

  if (document.getElementById('b50-overlay')) document.getElementById('b50-overlay').remove();

  // ---------- 浮层 UI ----------
  const overlay = document.createElement('div');
  overlay.id = 'b50-overlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:99999;background:#0d1020;color:#fff;' +
    'font:15px/1.6 ' + FONT + ';overflow:auto;-webkit-overflow-scrolling:touch;-webkit-text-size-adjust:100%;' +
    'padding:16px;padding-top:max(16px,env(safe-area-inset-top));box-sizing:border-box;';
  const box = document.createElement('div');
  box.style.cssText = 'max-width:960px;margin:0 auto;text-align:center;';
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '×';
  closeBtn.style.cssText = 'position:fixed;top:max(10px,env(safe-area-inset-top));right:14px;-webkit-appearance:none;padding:0;line-height:1;width:40px;height:40px;border-radius:50%;' +
    'border:1px solid #fff8;background:#0006;color:#fff;font-size:24px;cursor:pointer;z-index:100000;';
  let aborted = false;
  closeBtn.onclick = () => { aborted = true; overlay.remove(); };
  overlay.append(closeBtn, box);
  document.body.appendChild(overlay);

  const status = document.createElement('div');
  const say = (t) => {
    if (!box.contains(status)) { box.innerHTML = ''; status.style.cssText = 'margin-top:30vh;font-size:17px;'; box.appendChild(status); }
    status.textContent = t;
  };
  const fail = (t) => {
    say('');
    status.style.cssText += 'background:#c62f3b33;border:1px solid #c62f3b;border-radius:10px;padding:16px;';
    status.textContent = '出错了：' + t;
  };
  const btnCss = '-webkit-appearance:none;display:inline-block;margin:8px;padding:12px 26px;border:0;border-radius:999px;font:bold 16px ' + FONT + ';cursor:pointer;';

  if (!TEST && HOST !== 'new.chunithm-net.com' && HOST !== 'chunithm-net-eng.com') {
    fail('请先登录 CHUNITHM-NET（new.chunithm-net.com），在其页面上运行本书签。');
    return;
  }

  const store = {
    get(k, d) { try { const v = localStorage.getItem('b50:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('b50:' + k, JSON.stringify(v)); } catch (e) { /* 忽略 */ } },
  };

  // ---------- 菜单 ----------
  showMenu();

  function showMenu() {
    box.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-top:12vh;';
    wrap.innerHTML = '<div style="font-size:22px;font-weight:bold;margin-bottom:18px;">CHUNITHM 成绩图片</div>';
    const b1 = document.createElement('button');
    b1.textContent = '生成 B50';
    b1.style.cssText = btnCss + 'background:#ffd65a;color:#222;';
    b1.onclick = () => run(runB50);
    const b2 = document.createElement('button');
    b2.textContent = '按定数筛选';
    b2.style.cssText = btnCss + 'background:#7ee0ff;color:#222;';
    b2.onclick = showFilterForm;
    wrap.append(b1, document.createElement('br'), b2);
    box.appendChild(wrap);
  }

  function showFilterForm() {
    const saved = store.get('filter', { min: 14.0, max: 14.9, diffs: [2, 3, 4], sort: 'const' });
    box.innerHTML = '';
    const f = document.createElement('div');
    f.style.cssText = 'margin:8vh auto 0;max-width:360px;text-align:left;background:#1b2140;border:1px solid #fff2;border-radius:14px;padding:18px;';
    const inp = 'width:90px;padding:6px 8px;border-radius:8px;border:1px solid #fff4;background:#0d1020;color:#fff;font:16px ' + FONT + ';';
    f.innerHTML =
      '<div style="font-size:19px;font-weight:bold;margin-bottom:12px;">按定数筛选（已游玩的成绩）</div>' +
      '<div style="margin:10px 0;">定数 <input id="b50-min" type="text" inputmode="decimal" autocomplete="off" style="' + inp + '"> ～ ' +
      '<input id="b50-max" type="text" inputmode="decimal" autocomplete="off" style="' + inp + '"></div>' +
      '<div style="margin:10px 0;">难度 ' + [2, 3, 4].map((d) =>
        '<label style="margin-right:12px;white-space:nowrap;"><input type="checkbox" class="b50-diff" value="' + d + '"> ' + DIFFS[d].short + '</label>').join('') + '</div>' +
      '<div style="margin:10px 0;">排序 <select id="b50-sort" style="' + inp + 'width:auto;">' +
      '<option value="const">定数 → 分数</option><option value="score">分数</option><option value="rating">单曲 Rating</option></select></div>';
    box.appendChild(f);
    f.querySelector('#b50-min').value = saved.min;
    f.querySelector('#b50-max').value = saved.max;
    f.querySelector('#b50-sort').value = saved.sort;
    f.querySelectorAll('.b50-diff').forEach((c) => { c.checked = saved.diffs.includes(Number(c.value)); });

    const go = document.createElement('button');
    go.textContent = '生成图片';
    go.style.cssText = btnCss + 'background:#7ee0ff;color:#222;margin:12px 0 0;';
    const back = document.createElement('button');
    back.textContent = '返回';
    back.style.cssText = btnCss + 'background:#ffffff22;color:#fff;margin:12px 0 0 10px;';
    back.onclick = showMenu;
    go.onclick = () => {
      // iOS 的日文/欧洲键盘小数点可能是逗号，全角数字也一并转换
      const num = (id) => parseFloat(f.querySelector(id).value
        .replace(/[０-９．，]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(',', '.'));
      let min = num('#b50-min');
      let max = num('#b50-max');
      if (isNaN(min)) min = 1;
      if (isNaN(max)) max = 16;
      if (min > max) [min, max] = [max, min];
      const diffs = [...f.querySelectorAll('.b50-diff')].filter((c) => c.checked).map((c) => Number(c.value));
      if (!diffs.length) { alert('请至少选一个难度'); return; }
      const opt = { min, max, diffs, sort: f.querySelector('#b50-sort').value };
      store.set('filter', opt);
      run(() => runFilter(opt));
    };
    f.append(go, back);
  }

  async function run(fn) {
    try { await fn(); } catch (e) { console.error(e); fail(e.message || String(e)); }
  }

  // ---------- 取数工具 ----------
  const checkHtml = (html) => {
    if (html.includes('再度ログインしてください') || html.includes('Please log in again')) {
      throw new Error('登录已失效，请重新登录 CHUNITHM-NET（在别处登录也会使这里失效）。');
    }
    return new DOMParser().parseFromString(html, 'text/html');
  };
  const fetchDoc = async (url, init) => {
    const res = await fetch(url, Object.assign({ credentials: 'include' }, init));
    if (res.status === 503) throw new Error('CHUNITHM-NET 正在维护中。');
    if (!res.ok) throw new Error('HTTP ' + res.status + '：' + url);
    return checkHtml(await res.text());
  };

  // 解析带 sendMusicDetail 表单的曲目列表（rating 页面和全曲成绩页面结构相同）
  const parseSongList = (doc) => {
    const forms = doc.querySelectorAll('form[action*="sendMusicDetail"]');
    return [...forms].map((f) => {
      const val = (n) => (f.querySelector('input[name="' + n + '"]') || {}).value;
      const hs = f.querySelector('.play_musicdata_highscore');
      const scoreEl = (hs && hs.querySelector('.text_b')) || f.querySelector('.text_b') || hs;
      const icons = [...f.querySelectorAll('img')].map((i) => i.getAttribute('src') || '').join(' ');
      let lamp = '';
      if (/alljusticecritical|_ajc/i.test(icons)) lamp = 'AJC';
      else if (/alljustice/i.test(icons)) lamp = 'AJ';
      else if (/fullcombo/i.test(icons)) lamp = 'FC';
      return {
        idx: val('idx'),
        diff: Number(val('diff')),
        title: ((f.querySelector('.music_title') || {}).textContent || '').trim(),
        score: parseInt((scoreEl ? scoreEl.textContent : '0').replace(/[^0-9]/g, ''), 10) || 0,
        lamp,
      };
    }).filter((s) => s.idx != null && s.score > 0);
  };

  let constDb = null;
  const loadConstDb = async () => {
    if (constDb) return constDb;
    say('正在下载谱面定数表（otoge-db，约 3MB）…');
    const db = await fetch(CONST_URL).then((r) => { if (!r.ok) throw new Error('定数表下载失败 ' + r.status); return r.json(); });
    constDb = { byId: new Map(db.map((m) => [String(m.id), m])), byTitle: new Map(db.map((m) => [m.title, m])) };
    return constDb;
  };
  const enrich = (s, db) => {
    if (s.constant != null) return s;
    const m = db.byId.get(String(s.idx)) || db.byTitle.get(s.title);
    const d = DIFFS[s.diff] || DIFFS[3];
    let c = m ? parseFloat(m['lev_' + d.key + '_i']) : NaN;
    let estimated = false;
    if (!(c > 0) && m && m['lev_' + d.key]) {
      // 定数未公开时按等级估算：14+ → 14.5
      const lv = m['lev_' + d.key];
      c = parseFloat(lv) + (lv.endsWith('+') ? 0.5 : 0);
      estimated = true;
    }
    return { ...s, constant: c > 0 ? c : 0, estimated, jacket: m && m.image ? BASE + 'img/' + m.image : null };
  };

  const readPlayer = async () => {
    const pdoc = await fetchDoc(URL_PLAYER);
    const nameEl = pdoc.querySelector('.player_name_in');
    let rating = '';
    pdoc.querySelectorAll('.player_rating_num_block img').forEach((img) => {
      // 数字图片文件名末尾是数字，小数点图片以 "comma.png" 结尾
      const ch = (img.getAttribute('src') || '').replace(/\.png.*$/, '').slice(-1);
      if (/\d/.test(ch)) rating += ch;
      else if (ch === 'a') rating += '.';
    });
    return { player: { name: nameEl ? nameEl.textContent.trim() : 'PLAYER', rating }, doc: pdoc };
  };

  // 全曲成绩：先在 musicGenre 页选择「全部类别」，再读取对应难度的列表
  const readAllScores = async (diffs) => {
    say('正在打开全曲成绩页面…');
    const gdoc = await fetchDoc(BASE + 'record/musicGenre/');
    const cookieToken = (document.cookie.match(/(?:^|;\s*)_t=([^;]+)/) || [])[1];
    const pageToken = (gdoc.querySelector('input[name="token"]') || {}).value;
    const token = pageToken || (cookieToken && decodeURIComponent(cookieToken));
    const out = [];
    for (const d of diffs) {
      if (aborted) return out;
      const name = DIFFS[d].name;
      say('正在读取 ' + name.toUpperCase() + ' 全曲成绩…');
      const form = [...gdoc.querySelectorAll('form[action]')].find((f) => new RegExp('send' + name + '\\b', 'i').test(f.getAttribute('action')));
      const action = form ? new URL(form.getAttribute('action'), BASE + 'record/musicGenre/').href : BASE + 'record/musicGenre/send' + name;
      const body = new URLSearchParams();
      if (form) form.querySelectorAll('input[name],select[name]').forEach((i) => body.set(i.name, i.value));
      body.set('genre', '99');
      if (token) body.set('token', token);
      let list = [];
      try { list = parseSongList(await fetchDoc(action, { method: 'POST', body })); } catch (e) { if (/登录|维护/.test(e.message)) throw e; }
      if (!list.length) list = parseSongList(await fetchDoc(BASE + 'record/musicGenre/' + name.toLowerCase()));
      // 列表页的 diff 值可能缺失，这里统一以当前难度为准
      list.forEach((s) => { s.diff = d; });
      out.push(...list);
      await new Promise((r) => setTimeout(r, 500));
    }
    return out;
  };

  const loadJackets = async (list) => {
    const loadImg = (src) => new Promise((res) => {
      if (!src) return res(null);
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => res(null);
      img.src = src;
    });
    for (let i = 0; i < list.length; i += 8) {
      say('正在加载曲绘… ' + Math.min(i + 8, list.length) + '/' + list.length);
      const batch = list.slice(i, i + 8);
      const imgs = await Promise.all(batch.map((s) => loadImg(s.jacket)));
      imgs.forEach((img, j) => { batch[j].img = img; });
      if (aborted) return;
    }
  };

  // ---------- 计算 ----------
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

  // ---------- B50 ----------
  async function runB50() {
    let player, best, news;
    if (TEST) {
      ({ player, best, news } = TEST);
    } else {
      say('正在读取玩家信息…');
      const r = await readPlayer();
      player = r.player;
      // 新曲枠页面的路径从玩家页链接里找，找不到则用 ratingDetailRecent
      const links = [...r.doc.querySelectorAll('a[href],form[action]')].map((e) => e.getAttribute('href') || e.getAttribute('action'));
      const newPath = ['ratingDetailNew', 'ratingDetailRecent'].find((p) => links.some((l) => l && l.includes(p))) || 'ratingDetailRecent';
      if (aborted) return;
      say('正在读取 BEST 枠…');
      best = parseSongList(await fetchDoc(URL_PLAYER + 'ratingDetailBest/'));
      if (aborted) return;
      say('正在读取新曲枠…');
      news = parseSongList(await fetchDoc(URL_PLAYER + newPath + '/'));
      if (!best.length) throw new Error('BEST 枠为空。需要开通 CHUNITHM-NET スタンダードコース，或页面结构已变更。');
    }
    const db = TEST ? null : await loadConstDb();
    best = best.map((s) => enrich(s, db));
    news = news.map((s) => enrich(s, db));
    if (aborted) return;
    [...best, ...news].forEach((s) => { s.rating = songRating(s.score, s.constant); });
    await loadJackets([...best, ...news]);
    if (aborted) return;
    await showResult([() => drawB50(player, best, news)], 'chunithm-b50');
  }

  // ---------- 定数筛选 ----------
  async function runFilter(opt) {
    let player, all;
    if (TEST) {
      ({ player, all } = TEST);
      all = all.filter((s) => opt.diffs.includes(s.diff));
    } else {
      say('正在读取玩家信息…');
      player = (await readPlayer()).player;
      all = await readAllScores(opt.diffs);
      if (aborted) return;
      if (!all.length) throw new Error('没有读到成绩。需要开通 CHUNITHM-NET スタンダードコース，或页面结构已变更。');
    }
    const db = TEST ? null : await loadConstDb();
    const eps = 1e-6;
    let list = all.map((s) => enrich(s, db))
      .filter((s) => s.constant >= opt.min - eps && s.constant <= opt.max + eps);
    list.forEach((s) => { s.rating = songRating(s.score, s.constant); });
    const cmp = {
      const: (a, b) => b.constant - a.constant || b.score - a.score,
      score: (a, b) => b.score - a.score || b.constant - a.constant,
      rating: (a, b) => b.rating - a.rating || b.score - a.score,
    }[opt.sort];
    list.sort(cmp);
    if (!list.length) throw new Error('定数 ' + opt.min.toFixed(1) + '～' + opt.max.toFixed(1) + ' 范围内没有已游玩的成绩。');
    await loadJackets(list);
    if (aborted) return;
    // 太多时拆成多张（iOS 的 canvas 有面积和总内存上限），每张数量平均分配
    const per = Math.ceil(list.length / Math.ceil(list.length / PER_IMAGE));
    const pages = [];
    for (let i = 0; i < list.length; i += per) pages.push(list.slice(i, i + per));
    await showResult(pages.map((p, i) => () => drawFilter(player, opt, list, p, i, pages.length, i * per)),
      'chunithm-' + opt.min.toFixed(1) + '-' + opt.max.toFixed(1));
  }

  // ---------- 绘制 ----------
  const COLS = 5, CW = 296, CH = 112, GAP = 12, PAD = 32;
  const W = PAD * 2 + COLS * CW + (COLS - 1) * GAP;
  const rows = (n) => Math.ceil(n / COLS);

  function newCanvas(h) {
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = h;
    const g = cv.getContext('2d');
    if (!g) throw new Error('浏览器无法创建这么大的图片（' + W + '×' + h + '），请缩小定数范围。');
    const bg = g.createLinearGradient(0, 0, W, h);
    bg.addColorStop(0, '#141a33'); bg.addColorStop(0.55, '#1d1438'); bg.addColorStop(1, '#0d2230');
    g.fillStyle = bg; g.fillRect(0, 0, W, h);
    g.globalAlpha = 0.06; g.strokeStyle = '#fff'; g.lineWidth = 1;
    for (let x = -h; x < W; x += 28) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + h, h); g.stroke(); }
    g.globalAlpha = 1;
    g.textBaseline = 'alphabetic';
    return { cv, g };
  }

  function header(g, kicker, name) {
    g.fillStyle = '#ffffff99'; g.font = '600 20px ' + FONT;
    g.fillText(kicker, PAD, PAD + 22);
    g.fillStyle = '#fff'; g.font = 'bold 48px ' + FONT;
    g.fillText(fit(g, name, 620), PAD, PAD + 82);
  }

  function stat(g, label, val, x, color, big) {
    g.textAlign = 'right';
    g.fillStyle = '#ffffff99'; g.font = '600 16px ' + FONT;
    g.fillText(label, x, PAD + 30);
    g.fillStyle = color; g.font = 'bold ' + (big ? 56 : 36) + 'px ' + FONT;
    g.fillText(val, x, PAD + (big ? 88 : 80));
    g.textAlign = 'left';
  }

  function sectionTitle(g, label, y, color) {
    g.fillStyle = color; g.fillRect(PAD, y + 12, 6, 28);
    g.fillStyle = '#fff'; g.font = 'bold 26px ' + FONT;
    g.fillText(label, PAD + 16, y + 36);
  }

  function footer(g, h, extra) {
    const d = new Date();
    g.fillStyle = '#ffffff66'; g.font = '13px ' + FONT;
    g.fillText('Generated ' + d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate() +
      '  ·  data: CHUNITHM-NET / otoge-db  ·  * = 定数未公開（推定）' + (extra || ''), PAD, h - 20);
  }

  function drawB50(player, best, news) {
    const HEAD = 190, SEC = 56, FOOT = 50;
    const H = HEAD + SEC + rows(best.length) * (CH + GAP) + SEC + rows(news.length) * (CH + GAP) + FOOT;
    const { cv, g } = newCanvas(H);
    const sum = (l) => l.reduce((a, s) => a + s.rating, 0);
    const bAvg = best.length ? sum(best) / best.length : 0;
    const nAvg = news.length ? sum(news) / news.length : 0;
    const total = (sum(best) + sum(news)) / 50;

    header(g, 'CHUNITHM  RATING  BEST 50', player.name);
    const rx = W - PAD;
    stat(g, 'RATING', player.rating || floor2(total), rx, '#ffd65a', true);
    stat(g, 'NEW 20 AVG', floor2(nAvg), rx - 260, '#7ee0ff');
    stat(g, 'BEST 30 AVG', floor2(bAvg), rx - 460, '#c9a2ff');
    g.fillStyle = '#ffffff80'; g.font = '14px ' + FONT; g.textAlign = 'right';
    g.fillText('计算值 (B30+N20)/50 = ' + floor2(total) + '　·　单曲最高 ' + floor2(Math.max(0, ...[...best, ...news].map((s) => s.rating))), rx, PAD + 122);
    g.textAlign = 'left';
    g.fillStyle = '#ffffff33'; g.fillRect(PAD, HEAD - 22, W - PAD * 2, 2);

    let y = HEAD;
    const section = (label, list, color) => {
      sectionTitle(g, label, y, color);
      y += SEC;
      list.forEach((s, i) => card(g, s, '#' + (i + 1), PAD + (i % COLS) * (CW + GAP), y + Math.floor(i / COLS) * (CH + GAP)));
      y += rows(list.length) * (CH + GAP);
    };
    section('BEST 30', best, '#c9a2ff');
    section('NEW 20', news, '#7ee0ff');
    footer(g, H);
    return cv;
  }

  function drawFilter(player, opt, all, page, pageNo, pageCount, offset) {
    const HEAD = 200, SEC = 56, FOOT = 50;
    // 按定数排序时每个定数单独成组，否则整体一组
    const groups = [];
    if (opt.sort === 'const') {
      page.forEach((s) => {
        const k = s.constant.toFixed(1) + (s.estimated ? '*' : '');
        if (!groups.length || groups[groups.length - 1].key !== k) groups.push({ key: k, list: [] });
        groups[groups.length - 1].list.push(s);
      });
    } else groups.push({ key: null, list: page });
    const H = HEAD + groups.reduce((h, gr) => h + (gr.key ? SEC : 0) + rows(gr.list.length) * (CH + GAP), 0) + FOOT;
    const { cv, g } = newCanvas(H);

    const range = opt.min === opt.max ? opt.min.toFixed(1) : opt.min.toFixed(1) + ' – ' + opt.max.toFixed(1);
    header(g, 'CHUNITHM  定数 ' + range + '  ·  ' + opt.diffs.map((d) => DIFFS[d].short).join(' / '), player.name);
    const avg = all.reduce((a, s) => a + s.score, 0) / all.length;
    const cnt = (f) => all.filter(f).length;
    const rx = W - PAD;
    stat(g, 'PLAYED', String(all.length), rx, '#ffd65a', true);
    stat(g, 'AVG SCORE', Math.floor(avg).toLocaleString('en-US'), rx - 200, '#7ee0ff');
    stat(g, 'SSS+', String(cnt((s) => s.score >= 1009000)), rx - 440, '#c9a2ff');
    stat(g, 'AJ', String(cnt((s) => s.lamp === 'AJ' || s.lamp === 'AJC')), rx - 560, '#ffb86b');
    g.fillStyle = '#ffffff80'; g.font = '14px ' + FONT; g.textAlign = 'right';
    g.fillText('SSS 以上 ' + cnt((s) => s.score >= 1007500) + '　·　FC 以上 ' + cnt((s) => !!s.lamp) +
      (pageCount > 1 ? '　·　第 ' + (pageNo + 1) + '/' + pageCount + ' 张' : ''), rx, PAD + 122);
    g.textAlign = 'left';
    g.fillStyle = '#ffffff33'; g.fillRect(PAD, HEAD - 22, W - PAD * 2, 2);

    let y = HEAD, n = offset;
    groups.forEach((gr) => {
      if (gr.key) { sectionTitle(g, gr.key + '　(' + gr.list.length + ')', y, '#7ee0ff'); y += SEC; }
      gr.list.forEach((s, i) => card(g, s, '#' + (++n), PAD + (i % COLS) * (CW + GAP), y + Math.floor(i / COLS) * (CH + GAP)));
      y += rows(gr.list.length) * (CH + GAP);
    });
    footer(g, H);
    return cv;
  }

  function card(g, s, label, x, y) {
    const w = CW, h = CH;
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
    g.font = 'bold 13px ' + FONT;
    const lw = Math.max(34, g.measureText(label).width + 10);
    g.fillStyle = 'rgba(0,0,0,.7)'; round(g, jx, jy, lw, 20, 5); g.fill();
    g.fillStyle = '#fff'; g.textAlign = 'center';
    g.fillText(label, jx + lw / 2, jy + 15); g.textAlign = 'left';

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
    if (s.lamp) {
      const rw = g.measureText(rk).width;
      g.fillStyle = s.lamp === 'FC' ? '#7ee0ff' : '#ffb86b';
      g.font = 'bold 13px ' + FONT;
      g.fillText(s.lamp, tx + bw + 8 + rw + 8, y + 54);
    }

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

  // 逐张绘制 → 导出为 PNG Blob → 立即释放 canvas，避免 iOS 的 canvas 总内存上限
  async function showResult(drawers, name) {
    const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const results = [];
    let tainted = false;
    for (let i = 0; i < drawers.length; i++) {
      if (aborted) return;
      say('正在绘制图片…' + (drawers.length > 1 ? ' ' + (i + 1) + '/' + drawers.length : ''));
      await new Promise((r) => setTimeout(r, 30));
      const cv = drawers[i]();
      let blob = null;
      try {
        blob = await new Promise((res, rej) => { try { cv.toBlob(res, 'image/png'); } catch (e) { rej(e); } });
      } catch (e) { tainted = true; }
      if (blob) {
        cv.width = cv.height = 0;
        const fname = name + (drawers.length > 1 ? '-' + (i + 1) : '') + '.png';
        results.push({ blob, url: URL.createObjectURL(blob), file: new File([blob], fname, { type: 'image/png' }), fname });
      } else {
        results.push({ canvas: cv });
      }
    }

    box.innerHTML = '';
    const tip = document.createElement('div');
    tip.style.cssText = 'margin:8px 0 4px;padding:0 44px;font-size:14px;color:#ffffffcc;';
    const top = document.createElement('div');
    top.style.cssText = 'margin:0 0 12px;';
    box.append(tip, top);

    const files = results.filter((r) => r.file).map((r) => r.file);
    let canShare = false;
    try { canShare = files.length > 0 && !!navigator.canShare && navigator.canShare({ files }); } catch (e) { canShare = false; }
    if (canShare) {
      // iOS：分享面板里选「存储图像」即可直接存进相册
      const sb = document.createElement('button');
      sb.textContent = isIOS ? '保存到相册 / 分享' : '分享';
      sb.style.cssText = btnCss + 'background:#7ee0ff;color:#222;padding:8px 20px;';
      sb.onclick = () => {
        navigator.share({ files }).catch((e) => { if (e && e.name !== 'AbortError') alert('分享失败：' + e.message); });
      };
      top.appendChild(sb);
    }
    results.forEach((r, i) => {
      if (!r.url) return;
      const a = document.createElement('a');
      a.href = r.url; a.download = r.fname;
      a.textContent = '下载 PNG' + (results.length > 1 ? ' ' + (i + 1) : '');
      a.style.cssText = btnCss + 'background:#ffd65a;color:#222;padding:8px 20px;text-decoration:none;';
      top.appendChild(a);
    });
    const back = document.createElement('button');
    back.textContent = '返回菜单';
    back.style.cssText = btnCss + 'background:#ffffff22;color:#fff;padding:8px 20px;';
    back.onclick = () => { results.forEach((r) => r.url && URL.revokeObjectURL(r.url)); showMenu(); };
    top.appendChild(back);

    results.forEach((r) => {
      if (r.url) {
        const img = document.createElement('img');
        img.src = r.url;
        img.alt = r.fname;
        // 允许 iOS 长按弹出「存储到照片」
        img.style.cssText = 'display:block;width:100%;height:auto;border-radius:8px;margin-bottom:16px;' +
          '-webkit-touch-callout:default;-webkit-user-select:auto;user-select:auto;';
        box.appendChild(img);
      } else {
        r.canvas.style.cssText = 'display:block;width:100%;height:auto;margin-bottom:16px;';
        box.appendChild(r.canvas);
      }
    });

    const many = results.length > 1 ? '（共 ' + results.length + ' 张）' : '';
    if (tainted) tip.textContent = '图片已生成，但浏览器不允许导出（曲绘跨域），请截图保存。';
    else if (isIOS) {
      tip.textContent = '生成完成' + many + '！' + (canShare ? '点「保存到相册」后选「存储图像」，或' : '') +
        '长按图片 →「存储到照片」。「下载 PNG」会存到「文件」App。';
    }
    else tip.textContent = '生成完成' + many + '！点「下载 PNG」，手机也可以长按图片保存。';
  }
})();
