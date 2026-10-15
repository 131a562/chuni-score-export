// CHUNITHM B50 / 定数筛选 图片生成器（在 CHUNITHM-NET 登录状态下以书签运行）
// 数据：CHUNITHM-NET 的 rating 页面 / 全曲成绩页面 + otoge-db 的谱面定数
(async function () {
  'use strict';

  const TEST = window.__B50_TEST__ || null;
  const TEST_DB = { byId: new Map(), byTitle: new Map(), byImage: new Map() };
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
  // 历史记录同步服务（worker/worker.js 部署到 Cloudflare 后的网址）。留空则只保存在本机。
  // otoge-sync：CHUNITHM / オンゲキ / maimai 共用的同步 Worker（见 ../otoge-sync/DEPLOY.md）。
  // 书签请求的 /users/<玩家名> 会被当作 /chunithm/<玩家名>，chuni-sync 时代存在 users/ 下的记录也会自动读到
  const SYNC_URL = (TEST && TEST.syncUrl) || 'https://otoge-sync.131a562-index01.workers.dev';

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
  // 清理旧版本保存的 GitHub Token（现在由同步服务保管，浏览器里不再需要）
  try { localStorage.removeItem('b50:gh'); } catch (e) { /* 忽略 */ }

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
    const b3 = document.createElement('button');
    b3.textContent = '历史走势';
    b3.style.cssText = btnCss + 'background:#c9a2ff;color:#222;';
    b3.onclick = () => run(runHistory);
    const b4 = document.createElement('button');
    b4.textContent = '同步账号';
    b4.style.cssText = btnCss + 'background:#ffffff22;color:#fff;padding:8px 20px;font-size:14px;';
    b4.onclick = showAccounts;
    const note = document.createElement('div');
    note.style.cssText = 'margin-top:14px;font-size:13px;color:#ffffff99;';
    note.textContent = SYNC_URL ? '历史记录会自动同步，首次同步时会询问要存入的玩家名' : '历史记录仅保存在本机';
    wrap.append(b1, document.createElement('br'), b2, document.createElement('br'), b3);
    if (SYNC_URL) wrap.append(document.createElement('br'), b4);
    wrap.append(note);
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
    constDb = {
      byId: new Map(db.map((m) => [String(m.id), m])),
      byTitle: new Map(db.map((m) => [m.title, m])),
      byImage: new Map(db.filter((m) => m.image).map((m) => [m.image, m])),
    };
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
    const { player, best, news, db } = await readB50();
    if (aborted) return;
    await recordAndSync({ player, best, news, db });
    if (aborted) return;
    await loadJackets([...best, ...news]);
    if (aborted) return;
    await showResult([() => drawB50(player, best, news)], 'chunithm-b50');
  }

  async function readB50() {
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
    const db = TEST ? TEST_DB : await loadConstDb();
    best = best.map((s) => enrich(s, db));
    news = news.map((s) => enrich(s, db));
    [...best, ...news].forEach((s) => { s.rating = songRating(s.score, s.constant); });
    return { player, best, news, db };
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
    const db = TEST ? TEST_DB : await loadConstDb();
    await recordAndSync({ player, all, db });
    if (aborted) return;
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

  // ---------- 历史记录 ----------
  // 数据结构（history.json）：
  //   obs:   观测记录 {t:'YYYY/MM/DD HH:MM', k:'曲目id:难度', n:曲名, d:难度, s:分数, src:'p'(プレイ履歴)|'b'(成绩扫描), nr:1(NEW RECORD)}
  //   snaps: Rating 快照 {t, r:Rating, b30, n20, best:[[k,n,s]], news:[[k,n,s]]}
  // 个人最佳和更新记录都由 obs 按时间重放得出，多设备合并时只需取并集。
  let syncNote = '';

  const pad2 = (n) => String(n).padStart(2, '0');
  const nowStr = () => {
    const d = new Date();
    return d.getFullYear() + '/' + pad2(d.getMonth() + 1) + '/' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  };
  const normTime = (s) => {
    const m = (s || '').match(/(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/);
    return m ? m[1] + '/' + pad2(m[2]) + '/' + pad2(m[3]) + ' ' + pad2(m[4]) + ':' + m[5] : null;
  };
  const timeMs = (t) => {
    const m = t.match(/(\d+)\/(\d+)\/(\d+) (\d+):(\d+)/);
    return new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5]).getTime();
  };
  const byTime = (a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0);
  const songKey = (idx, diff) => idx + ':' + diff;
  const emptyHist = () => ({ v: 1, name: '', obs: [], snaps: [] });

  // プレイ履歴（最近 50 次游玩）。各字段按出现顺序一一对应，与 chu2view 的解析方式相同
  const parsePlaylog = (doc, db) => {
    const all = (sel) => [...doc.querySelectorAll(sel)];
    const titles = all('.play_musicdata_title');
    const dates = all('.play_datalist_date');
    const diffs = all('.play_track_result img');
    const scores = all('.play_musicdata_score_text');
    const jackets = all('.play_jacket_img img');
    if (!titles.length || dates.length !== titles.length || diffs.length !== titles.length || scores.length !== titles.length) return [];
    const names = ['basic', 'advanced', 'expert', 'master', 'ultima'];
    return titles.map((te, i) => {
      const dm = (diffs[i].getAttribute('src') || '').match(/(basic|advanced|expert|master|ultima|worldsend)/i);
      const d = dm ? names.indexOf(dm[1].toLowerCase()) : -1;
      const t = normTime(dates[i].textContent);
      const s = parseInt(scores[i].textContent.replace(/[^0-9]/g, ''), 10) || 0;
      if (d < 0 || !t || !s) return null;
      const n = te.textContent.trim();
      const img = jackets.length === titles.length ? (jackets[i].getAttribute('src') || '').split('/').pop().split('?')[0] : '';
      const m = (img && db.byImage.get(img)) || db.byTitle.get(n);
      // NEW RECORD 标记：只在能确定所属条目时读取
      let box = te.parentElement;
      while (box && !box.querySelector('.play_datalist_date')) box = box.parentElement;
      const nr = box && box.querySelectorAll('.play_musicdata_title').length === 1 &&
        [...box.querySelectorAll('img')].some((x) => /new_?record/i.test(x.getAttribute('src') || ''));
      const o = { t, k: m ? songKey(m.id, d) : 'n:' + n + ':' + d, n, d, s, src: 'p' };
      if (nr) o.nr = 1;
      return o;
    }).filter(Boolean);
  };

  const obsId = (o) => o.t + '|' + o.k + '|' + o.s + '|' + o.src;

  // 按时间重放观测记录，得到每首歌的当前最佳和每一次个人最佳的更新
  const derive = (hist) => {
    const pb = {}, log = [];
    hist.obs.slice().sort(byTime).forEach((o) => {
      const p = pb[o.k];
      if (p == null) {
        pb[o.k] = o.s;
        if (o.src === 'p' && o.nr) log.push({ ...o, f: null });
      } else if (o.s > p) {
        pb[o.k] = o.s;
        log.push({ ...o, f: p });
      }
    });
    return { pb, log };
  };

  const mergeHist = (a, b) => {
    const out = emptyHist();
    out.name = b.name || a.name;
    const seen = new Set();
    [...a.obs, ...b.obs].forEach((o) => { const id = obsId(o); if (!seen.has(id)) { seen.add(id); out.obs.push(o); } });
    out.obs.sort(byTime);
    const snaps = new Map();
    [...a.snaps, ...b.snaps].forEach((s) => snaps.set(s.t, s));
    out.snaps = [...snaps.values()].sort(byTime);
    return out;
  };

  const sameSnap = (a, b) => a && b && a.r === b.r &&
    JSON.stringify(a.best) === JSON.stringify(b.best) && JSON.stringify(a.news) === JSON.stringify(b.news);

  // 把本次读到的数据并入历史
  const applyUpdate = (hist, { player, best, news, all, plays }) => {
    const t = nowStr();
    if (player && player.name) hist.name = player.name;
    const ids = new Set(hist.obs.map(obsId));
    (plays || []).forEach((o) => { if (!ids.has(obsId(o))) { ids.add(obsId(o)); hist.obs.push(o); } });
    // 成绩扫描：只有比已知最佳更高（或第一次见到）时才记录，避免每次重复写入
    const { pb } = derive(hist);
    const scanned = [...(best || []), ...(news || []), ...(all || [])];
    const done = new Set();
    scanned.forEach((s) => {
      const k = songKey(s.idx, s.diff);
      if (done.has(k)) return;
      done.add(k);
      if (pb[k] == null || s.score > pb[k]) hist.obs.push({ t, k, n: s.title, d: s.diff, s: s.score, src: 'b' });
    });
    hist.obs.sort(byTime);
    if (best && news) {
      const sum = (l) => l.reduce((a, s) => a + s.rating, 0);
      const snap = {
        t,
        r: parseFloat(player.rating) || Math.floor((sum(best) + sum(news)) / 50 * 100) / 100,
        b30: best.length ? Math.round(sum(best) / best.length * 10000) / 10000 : 0,
        n20: news.length ? Math.round(sum(news) / news.length * 10000) / 10000 : 0,
        best: best.map((s) => [songKey(s.idx, s.diff), s.title, s.score]),
        news: news.map((s) => [songKey(s.idx, s.diff), s.title, s.score]),
      };
      // 和上一次完全相同且在同一天就不重复记录
      const last = hist.snaps[hist.snaps.length - 1];
      if (!(sameSnap(last, snap) && last.t.slice(0, 10) === t.slice(0, 10))) hist.snaps.push(snap);
    }
    return hist;
  };

  // 本机历史按 CHUNITHM 玩家名分开存放，同一台设备换账号登录不会混在一起
  const loadLocalHist = (playerName) => {
    let h = store.get('hist:' + playerName, null);
    if (!h) {
      // 旧版本只存了一份 b50:hist，归到名字相同（或没有名字）的玩家名下
      const old = store.get('hist', null);
      if (old && old.obs && (!old.name || old.name === playerName)) {
        h = old;
        try { localStorage.removeItem('b50:hist'); } catch (e) { /* 忽略 */ }
      }
    }
    return h && h.obs ? h : emptyHist();
  };
  const saveLocalHist = (playerName, h) => {
    try { localStorage.setItem('b50:hist:' + playerName, JSON.stringify(h)); return true; } catch (e) { return false; }
  };

  // ---- 同步（经由 Cloudflare Worker 读写 GitHub 私有仓库的 users/<玩家名>.json）----
  // 「玩家名」= 同步时存入的名字，默认是 CHUNITHM 的玩家名；同一个人换设备时填相同的名字即可接着同步
  // 统一写法，避免同一个名字因输入方式不同存成两个文件：
  // NFKC 把全角英数字/符号/空格转成半角、半角片假名转成全角；英文字母统一大写（CHUNITHM 玩家名本来就是大写）
  const cleanAccount = (s) => s.normalize('NFKC').replace(/[a-z]/g, (c) => c.toUpperCase()).trim()
    .replace(/[\\/:*?"<>|#%\u0000-\u001f]+/g, '_').replace(/\s+/g, ' ').replace(/^\.+/, '').slice(0, 40);
  // 2026/10/15 的版本没有做上面的统一，名字按原样（多为全角）保存。用于把那时的文件合并过来
  const legacyAccount = (s) => s.trim().replace(/[\\/:*?"<>|#%\u0000-\u001f]+/g, '_').replace(/\s+/g, ' ').replace(/^\.+/, '').slice(0, 40);
  const b64enc = (str) => {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  };
  const b64dec = (b64) => {
    const bin = atob(b64.replace(/\s/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  };
  const syncFetch = async (acc, suffix, init) => {
    let res;
    try {
      res = await fetch(SYNC_URL.replace(/\/+$/, '') + '/users/' + encodeURIComponent(acc) + (suffix || ''), Object.assign({ cache: 'no-store' }, init));
    } catch (e) { throw new Error('连不上同步服务'); }
    if (res.status === 401 || res.status === 403 || res.status >= 500) {
      throw new Error('同步服务出错（HTTP ' + res.status + '），请联系书签提供者');
    }
    return res;
  };
  const syncGet = async (acc) => {
    const res = await syncFetch(acc);
    if (res.status === 404) return { data: null, sha: null };
    if (!res.ok) throw new Error('读取失败 HTTP ' + res.status);
    const j = await res.json();
    let text;
    if (j.encoding === 'base64' && j.content) text = b64dec(j.content);
    else {
      // 超过 1MB 时 GitHub 不在 JSON 里返回内容，改为读取原始文件
      const raw = await syncFetch(acc, '/raw');
      if (!raw.ok) throw new Error('读取失败 HTTP ' + raw.status);
      text = await raw.text();
    }
    try { return { data: JSON.parse(text), sha: j.sha }; } catch (e) { throw new Error('云端数据损坏'); }
  };
  const syncPut = async (acc, data, sha) => {
    const body = { message: 'update ' + acc + ' ' + nowStr(), content: b64enc(JSON.stringify(data)) };
    if (sha) body.sha = sha;
    const res = await syncFetch(acc, '', { method: 'PUT', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
    if (res.status === 409 || res.status === 422) return false;
    if (!res.ok) throw new Error('写入失败 HTTP ' + res.status);
    return true;
  };
  const syncMerge = async (acc, local) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data, sha } = await syncGet(acc);
      const merged = data && data.obs ? mergeHist(data, local) : local;
      if (data && JSON.stringify(data) === JSON.stringify(merged)) return merged;
      // 写入冲突（别的设备刚好也在写）时重新读取再合并
      if (await syncPut(acc, merged, sha)) return merged;
    }
    throw new Error('多次写入冲突，请稍后再试');
  };

  // 询问这个 CHUNITHM 玩家的记录要存到哪个名字下。返回名字；选「暂不同步」返回 null
  const askAccount = (player) => new Promise((resolve) => {
    box.innerHTML = '';
    const f = document.createElement('div');
    f.style.cssText = 'margin:10vh auto 0;max-width:400px;text-align:left;background:#1b2140;border:1px solid #fff2;border-radius:14px;padding:18px;';
    f.innerHTML =
      '<div style="font-size:19px;font-weight:bold;margin-bottom:8px;">要把记录存到哪个玩家名？</div>' +
      '<div style="font-size:13px;color:#ffffffaa;margin-bottom:12px;">历史记录会以这个名字保存到云端。每个人请用不同的名字；' +
      '换手机时填相同的名字即可接着同步。之后可以在菜单的「同步账号」里修改。</div>' +
      '<input id="b50-acc" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" style="display:block;width:100%;box-sizing:border-box;' +
      'padding:8px 10px;border-radius:8px;border:1px solid #fff4;background:#0d1020;color:#fff;font:16px ' + FONT + ';">' +
      '<div id="b50-acc-msg" style="min-height:1.6em;font-size:14px;margin-top:6px;"></div>';
    box.appendChild(f);
    const input = f.querySelector('#b50-acc');
    const msg = f.querySelector('#b50-acc-msg');
    input.value = cleanAccount(player.name) || '';
    const ok = document.createElement('button');
    ok.textContent = '确定';
    ok.style.cssText = btnCss + 'background:#7ee0ff;color:#222;margin:8px 8px 0 0;padding:10px 24px;';
    const skip = document.createElement('button');
    skip.textContent = '暂不同步';
    skip.style.cssText = btnCss + 'background:#ffffff22;color:#fff;margin:8px 0 0;padding:10px 20px;';
    skip.onclick = () => resolve(null);
    ok.onclick = async () => {
      const acc = cleanAccount(input.value);
      if (!acc) { msg.style.color = '#ff8a8a'; msg.textContent = '请填写玩家名'; return; }
      ok.disabled = true;
      msg.style.color = '#ffffffaa'; msg.textContent = '正在检查…';
      try {
        const { data } = await syncGet(acc);
        if (data && data.name && data.name !== player.name &&
          !confirm('「' + acc + '」里已经有玩家「' + data.name + '」的记录。\n确定要把你的记录也存进去吗？（不是同一个人的话请换一个名字）')) {
          ok.disabled = false; msg.textContent = '';
          return;
        }
        resolve(acc);
      } catch (e) {
        ok.disabled = false;
        msg.style.color = '#ff8a8a'; msg.textContent = '失败：' + e.message;
      }
    };
    f.append(ok, skip);
    input.focus();
  });

  // 读取プレイ履歴、并入历史、同步。任何一步失败都不影响出图，只在结果页提示
  async function recordAndSync({ player, best, news, all, db }) {
    let plays = [];
    let playNote = '';
    try {
      if (TEST) plays = TEST.plays || [];
      else {
        say('正在读取游玩记录…');
        plays = parsePlaylog(await fetchDoc(BASE + 'record/playlog/'), db);
        if (!plays.length) playNote = '（未能解析游玩记录）';
      }
    } catch (e) {
      if (/登录|维护/.test(e.message)) throw e;
      playNote = '（游玩记录读取失败）';
    }
    let hist = applyUpdate(loadLocalHist(player.name), { player, best, news, all, plays });
    const savedLocal = saveLocalHist(player.name, hist);
    syncNote = (savedLocal ? '历史记录已保存在本机' : '本机存储空间不足，历史记录未保存') + playNote;
    if (!SYNC_URL) return hist;

    const accounts = store.get('accounts', {});
    let acc = accounts[player.name];
    if (acc === undefined) {
      acc = await askAccount(player);
      // 选「暂不同步」也记下来，避免每次都问；可在「同步账号」里重新设置
      accounts[player.name] = acc;
      store.set('accounts', accounts);
    }
    if (!acc) { syncNote += '（未开启同步）'; return hist; }
    // 旧版本保存的名字没有统一全角/半角：改用统一后的名字，并把旧写法文件里的记录合并过来
    const legacy = [...new Set([acc, legacyAccount(player.name)])].filter((n) => n && n !== cleanAccount(n) && cleanAccount(n) === cleanAccount(acc));
    if (acc !== cleanAccount(acc)) {
      acc = cleanAccount(acc);
      accounts[player.name] = acc;
      store.set('accounts', accounts);
    }
    const migrated = store.get('migrated', []);
    const pending = legacy.filter((old) => !migrated.includes(old + '>' + acc));
    try {
      say('正在同步…');
      for (const old of pending) {
        const { data } = await syncGet(old);
        if (data && data.obs) hist = mergeHist(data, hist);
      }
      hist = await syncMerge(acc, hist);
      saveLocalHist(player.name, hist);
      if (pending.length) store.set('migrated', migrated.concat(pending.map((old) => old + '>' + acc)));
      syncNote = '历史记录已同步（' + acc + '）' + playNote;
    } catch (e) {
      syncNote = '同步失败：' + e.message + '。已保存在本机，下次运行会重试' + playNote;
    }
    return hist;
  }

  // 本浏览器里「CHUNITHM 玩家 → 同步用的名字」的对应关系
  function showAccounts() {
    box.innerHTML = '';
    const f = document.createElement('div');
    f.style.cssText = 'margin:8vh auto 0;max-width:420px;text-align:left;background:#1b2140;border:1px solid #fff2;border-radius:14px;padding:18px;';
    f.innerHTML = '<div style="font-size:19px;font-weight:bold;margin-bottom:8px;">同步账号</div>' +
      '<div style="font-size:13px;color:#ffffffaa;margin-bottom:12px;">这台设备上每个 CHUNITHM 玩家的记录同步到哪个名字。' +
      '「重新设置」后，下次运行时会再询问。</div>';
    box.appendChild(f);
    const accounts = store.get('accounts', {});
    const names = Object.keys(accounts);
    if (!names.length) f.insertAdjacentHTML('beforeend', '<div style="color:#ffffff88;">还没有同步过</div>');
    names.forEach((p) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 0;border-top:1px solid #fff1;';
      row.innerHTML = '<div style="flex:1;min-width:0;"><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(p) + '</div>' +
        '<div style="font-size:13px;color:#ffffff99;">→ ' + (accounts[p] ? esc(accounts[p]) : '未开启同步') + '</div></div>';
      const reset = document.createElement('button');
      reset.textContent = '重新设置';
      reset.style.cssText = btnCss + 'background:#ffffff22;color:#fff;margin:0;padding:6px 14px;font-size:13px;';
      reset.onclick = () => {
        const a = store.get('accounts', {});
        delete a[p];
        store.set('accounts', a);
        showAccounts();
      };
      row.appendChild(reset);
      f.appendChild(row);
    });
    const back = document.createElement('button');
    back.textContent = '返回';
    back.style.cssText = btnCss + 'background:#ffffff22;color:#fff;margin:12px 0 0;padding:10px 20px;';
    back.onclick = showMenu;
    f.appendChild(back);
  }

  if (TEST) window.__B50_INTERNAL__ = { parsePlaylog, derive, mergeHist, applyUpdate, b64enc, b64dec, syncMerge, syncGet };

  // ---------- 历史走势 ----------
  async function runHistory() {
    const { player, best, news, db } = await readB50();
    if (aborted) return;
    const hist = await recordAndSync({ player, best, news, db });
    if (aborted) return;
    showHistoryPanel(hist, player, db);
  }

  function showHistoryPanel(hist, player, db) {
    const { pb, log } = derive(hist);
    box.innerHTML = '';
    const p = document.createElement('div');
    p.style.cssText = 'margin:4vh auto 0;max-width:520px;text-align:left;';
    const first = hist.snaps[0];
    const last = hist.snaps[hist.snaps.length - 1];
    p.innerHTML =
      '<div style="font-size:20px;font-weight:bold;margin-bottom:6px;">历史走势</div>' +
      '<div style="font-size:14px;color:#ffffffcc;">' + esc(syncNote) + '</div>' +
      '<div style="font-size:14px;color:#ffffffcc;margin:6px 0 12px;">' +
      hist.snaps.length + ' 个 Rating 快照' + (first ? '（' + first.t.slice(0, 10) + ' 起）' : '') + '　·　' +
      hist.obs.filter((o) => o.src === 'p').length + ' 条游玩记录　·　' + log.length + ' 次个人最佳更新' +
      (last ? '<br>当前 Rating ' + last.r.toFixed(2) + (first && first !== last ? '（' + signed(last.r - first.r) + '）' : '') : '') + '</div>';
    box.appendChild(p);

    const b1 = document.createElement('button');
    b1.textContent = '生成走势图';
    b1.style.cssText = btnCss + 'background:#c9a2ff;color:#222;margin:4px 8px 12px 0;';
    b1.onclick = () => run(() => showResult([() => drawTrend(hist, player)], 'chunithm-history'));
    const back = document.createElement('button');
    back.textContent = '返回菜单';
    back.style.cssText = btnCss + 'background:#ffffff22;color:#fff;margin:4px 0 12px;padding:12px 20px;';
    back.onclick = showMenu;
    p.append(b1, back);

    // 单曲曲线：搜索有记录的曲目
    const songs = new Map();
    hist.obs.forEach((o) => {
      if (o.d < 2) return;
      const e = songs.get(o.k) || { k: o.k, n: o.n, d: o.d, plays: 0, last: '' };
      e.plays += o.src === 'p' ? 1 : 0;
      if (o.t > e.last) e.last = o.t;
      songs.set(o.k, e);
    });
    const sec = document.createElement('div');
    sec.style.cssText = 'background:#1b2140;border:1px solid #fff2;border-radius:14px;padding:14px;';
    sec.innerHTML = '<div style="font-weight:bold;margin-bottom:6px;">单曲分数曲线</div>' +
      '<input id="b50-q" placeholder="输入曲名搜索" autocomplete="off" style="width:100%;box-sizing:border-box;padding:8px 10px;' +
      'border-radius:8px;border:1px solid #fff4;background:#0d1020;color:#fff;font:16px ' + FONT + ';">' +
      '<div id="b50-songs" style="margin-top:8px;"></div>';
    p.appendChild(sec);
    const listEl = sec.querySelector('#b50-songs');
    const render = () => {
      const q = sec.querySelector('#b50-q').value.trim().toLowerCase();
      const items = [...songs.values()]
        .filter((e) => !q || e.n.toLowerCase().includes(q))
        .sort((a, b) => b.plays - a.plays || (a.last < b.last ? 1 : -1))
        .slice(0, 30);
      listEl.innerHTML = '';
      if (!items.length) { listEl.innerHTML = '<div style="color:#ffffff88;font-size:14px;">没有记录</div>'; return; }
      items.forEach((e) => {
        const row = document.createElement('button');
        row.style.cssText = '-webkit-appearance:none;display:flex;width:100%;align-items:center;gap:8px;text-align:left;margin:4px 0;padding:8px 10px;' +
          'border:1px solid #fff2;border-radius:8px;background:#0d1020;color:#fff;font:14px ' + FONT + ';cursor:pointer;';
        row.innerHTML = '<span style="background:' + DIFFS[e.d].color + ';border-radius:4px;padding:0 6px;font-weight:bold;font-size:12px;">' +
          DIFFS[e.d].short + '</span><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(e.n) +
          '</span><span style="color:#ffffff99;font-size:12px;">' + (pb[e.k] || 0).toLocaleString('en-US') + '　' + e.plays + ' 次</span>';
        row.onclick = () => run(async () => {
          const idx = e.k.split(':')[0];
          const s = enrich({ idx, diff: e.d, title: e.n, score: pb[e.k] || 0 }, db);
          if (s.jacket) await loadJackets([s]);
          await showResult([() => drawSongCurve(hist, e, s, player)], 'chunithm-' + e.n.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40));
        });
        listEl.appendChild(row);
      });
    };
    sec.querySelector('#b50-q').oninput = render;
    render();
  }

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const signed = (x, digits) => (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(digits == null ? 2 : digits);

  // ---------- 绘制 ----------
  const COLS = 5, CW = 296, CH = 112, GAP = 12, PAD = 32;
  const W = PAD * 2 + COLS * CW + (COLS - 1) * GAP;
  const rows = (n) => Math.ceil(n / COLS);

  function newCanvas(h, w) {
    w = w || W;
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const g = cv.getContext('2d');
    if (!g) throw new Error('浏览器无法创建这么大的图片（' + w + '×' + h + '），请缩小定数范围。');
    const bg = g.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, '#141a33'); bg.addColorStop(0.55, '#1d1438'); bg.addColorStop(1, '#0d2230');
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.globalAlpha = 0.06; g.strokeStyle = '#fff'; g.lineWidth = 1;
    for (let x = -h; x < w; x += 28) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + h, h); g.stroke(); }
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

  // ---- 历史图 ----
  const HW = 1200;

  // 折线图。series: [{label, color, pts:[[ms, val]], step, dots}]；refs: [{v, label}]
  function lineChart(g, x, y, w, h, series, opt) {
    const pts = series.flatMap((s) => s.pts);
    let t0 = Math.min(...pts.map((p) => p[0])), t1 = Math.max(...pts.map((p) => p[0]));
    let v0 = Math.min(...pts.map((p) => p[1])), v1 = Math.max(...pts.map((p) => p[1]));
    if (t1 - t0 < 864e5) { t0 -= 432e5; t1 += 432e5; }
    const span = Math.max(v1 - v0, opt.minSpan);
    const mid = (v0 + v1) / 2;
    v0 = mid - span * 0.6; v1 = mid + span * 0.6;
    if (opt.maxV != null) v1 = Math.min(v1, opt.maxV);
    const L = x + 90, R = x + w - 16, T = y + 16, B = y + h - 70;
    const X = (t) => L + (t - t0) / (t1 - t0) * (R - L);
    const Y = (v) => B - (v - v0) / (v1 - v0) * (B - T);
    g.fillStyle = 'rgba(255,255,255,0.05)'; round(g, x, y, w, h, 12); g.fill();
    // 横向网格
    g.font = '14px ' + FONT; g.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const v = v0 + (v1 - v0) * i / 4;
      g.strokeStyle = 'rgba(255,255,255,0.1)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(L, Y(v)); g.lineTo(R, Y(v)); g.stroke();
      g.fillStyle = '#ffffff88'; g.fillText(opt.fmt(v), L - 10, Y(v) + 5);
    }
    (opt.refs || []).forEach((r) => {
      if (r.v < v0 || r.v > v1) return;
      g.strokeStyle = 'rgba(255,214,90,0.35)'; g.setLineDash([6, 6]);
      g.beginPath(); g.moveTo(L, Y(r.v)); g.lineTo(R, Y(r.v)); g.stroke(); g.setLineDash([]);
      g.fillStyle = '#ffd65a'; g.textAlign = 'left'; g.fillText(r.label, L + 6, Y(r.v) - 5); g.textAlign = 'right';
    });
    // 时间刻度
    g.textAlign = 'center'; g.fillStyle = '#ffffff88';
    const ticks = Math.min(6, Math.max(2, Math.round((t1 - t0) / 864e5) + 1));
    for (let i = 0; i < ticks; i++) {
      const t = t0 + (t1 - t0) * i / (ticks - 1);
      const d = new Date(t);
      g.fillText((d.getMonth() + 1) + '/' + d.getDate(), X(t), B + 24);
    }
    g.textAlign = 'left';
    series.forEach((s) => {
      if (!s.pts.length) return;
      g.strokeStyle = s.color; g.fillStyle = s.color; g.lineWidth = s.width || 3;
      if (s.line !== false) {
        g.beginPath();
        s.pts.forEach((p, i) => {
          if (i === 0) g.moveTo(X(p[0]), Y(p[1]));
          else if (s.step) { g.lineTo(X(p[0]), Y(s.pts[i - 1][1])); g.lineTo(X(p[0]), Y(p[1])); } else g.lineTo(X(p[0]), Y(p[1]));
        });
        if (s.step) g.lineTo(R, Y(s.pts[s.pts.length - 1][1]));
        g.stroke();
      }
      if (s.dots !== false) s.pts.forEach((p) => { g.beginPath(); g.arc(X(p[0]), Y(p[1]), s.dot || 4, 0, Math.PI * 2); g.fill(); });
    });
    // 图例
    let lx = L;
    series.forEach((s) => {
      if (!s.label) return;
      g.fillStyle = s.color; g.fillRect(lx, y + h - 22, 18, 4);
      g.fillStyle = '#ffffffcc'; g.font = '14px ' + FONT;
      g.fillText(s.label, lx + 24, y + h - 15);
      lx += 40 + g.measureText(s.label).width;
    });
  }

  function diffBadge(g, d, x, y, extra) {
    const dd = DIFFS[d] || DIFFS[3];
    const label = dd.short + (extra ? ' ' + extra : '');
    g.font = 'bold 13px ' + FONT;
    const bw = g.measureText(label).width + 12;
    round(g, x, y - 15, bw, 20, 4); g.fillStyle = dd.color; g.fill();
    if (dd.key === 'ult') { g.strokeStyle = '#e33'; g.lineWidth = 1.5; g.stroke(); }
    g.fillStyle = '#fff'; g.fillText(label, x + 6, y);
    return bw;
  }

  function drawTrend(hist, player) {
    const { log } = derive(hist);
    const snaps = hist.snaps;
    const last = snaps[snaps.length - 1], prev = snaps[snaps.length - 2];
    // B50 变化
    const changes = { inn: [], out: [], up: [] };
    if (last && prev) {
      const toMap = (s) => new Map([...s.best, ...s.news].map((e) => [e[0], e]));
      const a = toMap(prev), b = toMap(last);
      b.forEach((e, k) => { if (!a.has(k)) changes.inn.push(e); else if (e[2] > a.get(k)[2]) changes.up.push([...e, a.get(k)[2]]); });
      a.forEach((e, k) => { if (!b.has(k)) changes.out.push(e); });
      // 提升的曲目只列出幅度最大的 10 首，其余汇总成一行
      changes.up.sort((p, q) => (q[2] - q[3]) - (p[2] - p[3]));
      changes.upMore = Math.max(0, changes.up.length - 10);
      changes.up = changes.up.slice(0, 10);
    }
    const recent = log.slice(-20).reverse();
    const ROW = 34;
    const changeRows = Math.max(changes.inn.length + changes.up.length + (changes.upMore ? 1 : 0), changes.out.length, 1);
    const H = 170 + 460 + 70 + changeRows * ROW + 70 + Math.max(recent.length, 1) * ROW + 60;
    const { cv, g } = newCanvas(H, HW);

    // 头部
    g.fillStyle = '#ffffff99'; g.font = '600 20px ' + FONT;
    g.fillText('CHUNITHM  RATING  HISTORY', PAD, PAD + 22);
    g.fillStyle = '#fff'; g.font = 'bold 44px ' + FONT;
    g.fillText(fit(g, player.name || hist.name, 560), PAD, PAD + 78);
    const rx = HW - PAD;
    const msAgo = (days) => Date.now() - days * 864e5;
    const at = (ms) => [...snaps].reverse().find((s) => timeMs(s.t) <= ms) || snaps[0];
    if (last) {
      stat(g, 'RATING', last.r.toFixed(2), rx, '#ffd65a', true);
      const d30 = at(msAgo(30));
      stat(g, '30 天', d30 ? signed(last.r - d30.r) : '-', rx - 230, '#7ee0ff');
      stat(g, '累计', signed(last.r - snaps[0].r), rx - 400, '#c9a2ff');
    }
    g.fillStyle = '#ffffff80'; g.font = '14px ' + FONT; g.textAlign = 'right';
    g.fillText(snaps.length + ' 个快照' + (snaps[0] ? '（' + snaps[0].t.slice(0, 10) + ' – ' + last.t.slice(0, 10) + '）' : ''), rx, PAD + 122);
    g.textAlign = 'left';
    g.fillStyle = '#ffffff33'; g.fillRect(PAD, 148, HW - PAD * 2, 2);

    let y = 170;
    if (snaps.length) {
      const pts = (f) => snaps.map((s) => [timeMs(s.t), f(s)]);
      lineChart(g, PAD, y, HW - PAD * 2, 440, [
        { label: 'RATING', color: '#ffd65a', pts: pts((s) => s.r), width: 4 },
        { label: 'BEST 30 平均', color: '#c9a2ff', pts: pts((s) => s.b30), width: 2, dot: 3 },
        { label: 'NEW 20 平均', color: '#7ee0ff', pts: pts((s) => s.n20), width: 2, dot: 3 },
      ], { minSpan: 0.2, fmt: (v) => v.toFixed(2) });
      if (snaps.length === 1) {
        g.fillStyle = '#ffffffaa'; g.font = '16px ' + FONT; g.textAlign = 'center';
        g.fillText('目前只有 1 个快照，多运行几次后就能看到曲线', HW / 2, y + 60); g.textAlign = 'left';
      }
    }
    y += 460;

    // B50 变化
    sectionTitle(g, 'B50 变化' + (prev ? '（对比 ' + prev.t + '）' : ''), y, '#c9a2ff');
    y += 64;
    const colW = (HW - PAD * 2 - 24) / 2;
    const rowText = (x, yy, e, color, right) => {
      const d = Number(e[0].split(':')[1]);
      const bw = diffBadge(g, d, x, yy);
      g.fillStyle = '#fff'; g.font = '16px ' + FONT;
      g.fillText(fit(g, e[1], colW - bw - 170), x + bw + 8, yy);
      g.textAlign = 'right'; g.fillStyle = color; g.font = 'bold 16px ' + FONT;
      g.fillText(right, x + colW - 6, yy); g.textAlign = 'left';
    };
    g.font = 'bold 15px ' + FONT;
    if (!prev) {
      g.fillStyle = '#ffffff88'; g.fillText('还没有上一次的快照可以对比', PAD, y);
    } else if (!changes.inn.length && !changes.out.length && !changes.up.length) {
      g.fillStyle = '#ffffff88'; g.fillText('和上次相比没有变化', PAD, y);
    } else {
      let yy = y;
      changes.inn.forEach((e) => { rowText(PAD, yy, e, '#7ee0a0', '新进 ' + e[2].toLocaleString('en-US')); yy += ROW; });
      changes.up.forEach((e) => { rowText(PAD, yy, e, '#ffd65a', '+' + (e[2] - e[3]).toLocaleString('en-US') + ' → ' + e[2].toLocaleString('en-US')); yy += ROW; });
      if (changes.upMore) {
        g.fillStyle = '#ffffff88'; g.font = '15px ' + FONT;
        g.fillText('另有 ' + changes.upMore + ' 首分数提升', PAD, yy); yy += ROW;
      }
      yy = y;
      changes.out.forEach((e) => { rowText(PAD + colW + 24, yy, e, '#ff8a8a', '移出 ' + e[2].toLocaleString('en-US')); yy += ROW; });
    }
    y += changeRows * ROW;

    // 个人最佳更新
    y += 6;
    sectionTitle(g, '最近的个人最佳更新', y, '#ffd65a');
    y += 64;
    if (!recent.length) {
      g.fillStyle = '#ffffff88'; g.font = 'bold 15px ' + FONT;
      g.fillText('暂无记录。プレイ履歴里出现刷新记录、或成绩扫描发现更高分时会记在这里', PAD, y);
    }
    recent.forEach((o) => {
      g.fillStyle = '#ffffff88'; g.font = '14px ' + FONT;
      g.fillText(o.t + (o.src === 'b' ? '*' : ''), PAD, y);
      const bw = diffBadge(g, o.d, PAD + 150, y);
      g.fillStyle = '#fff'; g.font = '16px ' + FONT;
      g.fillText(fit(g, o.n, HW - PAD * 2 - 150 - bw - 330), PAD + 150 + bw + 8, y);
      g.textAlign = 'right';
      g.fillStyle = '#ffffff99'; g.font = '15px ' + FONT;
      g.fillText(o.f != null ? o.f.toLocaleString('en-US') + ' →' : 'NEW RECORD', HW - PAD - 200, y);
      g.fillStyle = '#ffd65a'; g.font = 'bold 17px ' + FONT;
      g.fillText(o.s.toLocaleString('en-US') + '  ' + scoreRank(o.s), HW - PAD - 60, y);
      g.fillStyle = '#7ee0a0'; g.font = 'bold 14px ' + FONT;
      g.fillText(o.f != null ? '+' + (o.s - o.f).toLocaleString('en-US') : '', HW - PAD, y);
      g.textAlign = 'left';
      y += ROW;
    });
    const d = new Date();
    g.fillStyle = '#ffffff66'; g.font = '13px ' + FONT;
    g.fillText('Generated ' + d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate() +
      '  ·  * = 由成绩扫描发现（时间为运行书签的时间）', PAD, H - 20);
    return cv;
  }

  function drawSongCurve(hist, e, s, player) {
    const obs = hist.obs.filter((o) => o.k === e.k).sort(byTime);
    const plays = obs.filter((o) => o.src === 'p');
    // 个人最佳的阶梯线
    const pbPts = [];
    let best = -1;
    obs.forEach((o) => { if (o.s > best) { best = o.s; pbPts.push([timeMs(o.t), o.s]); } });
    const rows = plays.slice(-15).reverse();
    const ROW = 32;
    const H = 190 + 420 + 70 + Math.max(rows.length, 1) * ROW + 60;
    const { cv, g } = newCanvas(H, HW);

    const J = 120;
    if (s.img) { g.save(); round(g, PAD, PAD, J, J, 10); g.clip(); g.drawImage(s.img, PAD, PAD, J, J); g.restore(); }
    const tx = s.img ? PAD + J + 20 : PAD;
    g.fillStyle = '#ffffff99'; g.font = '600 18px ' + FONT;
    g.fillText('CHUNITHM  SCORE HISTORY  ·  ' + (player.name || hist.name), tx, PAD + 20);
    g.fillStyle = '#fff'; g.font = 'bold 38px ' + FONT;
    g.fillText(fit(g, e.n, HW - tx - 300), tx, PAD + 68);
    diffBadge(g, e.d, tx, PAD + 106, s.constant ? s.constant.toFixed(1) + (s.estimated ? '*' : '') : '');
    const rx = HW - PAD;
    stat(g, 'BEST', best > 0 ? best.toLocaleString('en-US') : '-', rx, '#ffd65a', true);
    g.fillStyle = '#ffffff80'; g.font = '14px ' + FONT; g.textAlign = 'right';
    g.fillText(scoreRank(best) + (s.constant ? '　·　单曲 Rating ' + floor2(songRating(best, s.constant)) : '') + '　·　记录到 ' + plays.length + ' 次游玩', rx, PAD + 122);
    g.textAlign = 'left';
    g.fillStyle = '#ffffff33'; g.fillRect(PAD, 168, HW - PAD * 2, 2);

    let y = 190;
    lineChart(g, PAD, y, HW - PAD * 2, 400, [
      { label: '个人最佳', color: '#ffd65a', pts: pbPts, step: true, dots: false, width: 3 },
      { label: '每次游玩', color: '#7ee0ff', pts: plays.map((o) => [timeMs(o.t), o.s]), line: false, dot: 5 },
    ], {
      minSpan: 4000, maxV: 1010000, fmt: (v) => Math.round(v).toLocaleString('en-US'),
      refs: [{ v: 1009000, label: 'SSS+' }, { v: 1007500, label: 'SSS' }, { v: 1005000, label: 'SS+' }, { v: 1000000, label: 'SS' }, { v: 975000, label: 'S' }],
    });
    y += 420;
    sectionTitle(g, '最近的游玩', y, '#7ee0ff');
    y += 62;
    if (!rows.length) {
      g.fillStyle = '#ffffff88'; g.font = 'bold 15px ' + FONT;
      g.fillText('还没有这首歌的游玩记录（只有成绩扫描的数据）', PAD, y);
    }
    // 计算每次游玩时的历史最佳，用于显示“刷新了多少”
    const pbAt = new Map();
    let run = -1;
    obs.forEach((o) => { if (o.src === 'p') pbAt.set(o, run); if (o.s > run) run = o.s; });
    rows.forEach((o) => {
      g.fillStyle = '#ffffff99'; g.font = '15px ' + FONT;
      g.fillText(o.t, PAD, y);
      g.fillStyle = '#fff'; g.font = 'bold 18px ' + FONT;
      g.fillText(o.s.toLocaleString('en-US'), PAD + 200, y);
      g.fillStyle = '#ffd65a'; g.font = 'bold 15px ' + FONT;
      g.fillText(scoreRank(o.s), PAD + 330, y);
      const before = pbAt.get(o);
      if (before >= 0 && o.s > before) { g.fillStyle = '#7ee0a0'; g.fillText('NEW RECORD  +' + (o.s - before).toLocaleString('en-US'), PAD + 410, y); }
      else if (before < 0 && o.nr) { g.fillStyle = '#7ee0a0'; g.fillText('NEW RECORD', PAD + 410, y); }
      else if (before >= 0) { g.fillStyle = '#ffffff66'; g.font = '14px ' + FONT; g.fillText('距最佳 −' + (before - o.s).toLocaleString('en-US'), PAD + 410, y); }
      y += ROW;
    });
    const d = new Date();
    g.fillStyle = '#ffffff66'; g.font = '13px ' + FONT;
    g.fillText('Generated ' + d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate() + '  ·  data: CHUNITHM-NET プレイ履歴', PAD, H - 20);
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
    if (syncNote) {
      const sn = document.createElement('div');
      sn.style.cssText = 'margin-top:4px;font-size:13px;color:' + (/失败|不足/.test(syncNote) ? '#ff8a8a' : '#ffffff88') + ';';
      sn.textContent = syncNote;
      tip.appendChild(sn);
    }
  }
})();
