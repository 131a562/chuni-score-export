// CHUNITHM B50 / 定数筛选 图片生成器（在 CHUNITHM-NET 登录状态下以书签运行）
// 数据：CHUNITHM-NET 的 rating 页面 / 全曲成绩页面 + otoge-db 的谱面定数
(async function () {
  'use strict';

  const TEST = window.__B50_TEST__ || null;
  // 打开书签时读到的数据 { player, best, news, all, db, at }（见「读取」）。fail() 一开始就可能用到，所以放在最前面
  let DATA = null;
  const TEST_DB = (TEST && TEST.db) || { byId: new Map(), byTitle: new Map(), byImage: new Map() };
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
  // 测试模式只用 TEST.syncUrl（未指定则不同步），避免测试数据写进真实的同步服务
  const SYNC_URL = TEST ? (TEST.syncUrl || '') : 'https://otoge-sync.131a562-index01.workers.dev';

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
    // 数据已经读好了就回菜单；还没读好（打开时读取失败）就重试
    const b = document.createElement('button');
    b.textContent = DATA ? '返回菜单' : '重试';
    b.style.cssText = btnCss + 'background:#ffffff22;color:#fff;padding:8px 20px;margin:12px 0 0;';
    b.onclick = DATA ? showMenu : start;
    box.appendChild(b);
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

  // ---------- 读取 ----------
  // 打开书签时一次读完：玩家信息、B50、EXPERT / MASTER / ULTIMA 全曲成绩、プレイ履歴，并记录历史、同步。
  // 之后生成 B50 / 按定数筛选 / 历史走势都用这份数据，不再重新获取；要最新数据时点「重新读取」

  async function loadAll() {
    const { player, best, news, db } = await readB50();
    if (aborted) return;
    const hist = await recordAndSync({ player, best, news, db }); // 全曲成绩也在这里读（lastRun.all）
    if (aborted) return;
    DATA = { player, best, news, all: (lastRun && lastRun.all) || [], db, at: nowStr() };
    histView = { hist, player, db };
  }

  function start() {
    return run(async () => {
      await loadAll();
      if (!aborted) showMenu();
    });
  }

  // 「重新读取」：重新获取后回到 then（菜单 / 历史走势页）
  const reload = (then) => run(async () => {
    await loadAll();
    if (!aborted) then();
  });

  // ---------- 菜单 ----------

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
    b3.onclick = () => showHistoryPanel(histView.hist, histView.player, histView.db);
    const small = 'background:#ffffff22;color:#fff;padding:8px 20px;font-size:14px;';
    const b5 = document.createElement('button');
    b5.textContent = '重新读取';
    b5.style.cssText = btnCss + small;
    b5.onclick = () => reload(showMenu);
    const b4 = document.createElement('button');
    b4.textContent = '同步账号';
    b4.style.cssText = btnCss + small;
    b4.onclick = showAccounts;
    // 这次读到的数据
    const info = document.createElement('div');
    info.style.cssText = 'margin:-6px 0 14px;font-size:13px;color:#ffffffaa;';
    if (DATA) {
      info.textContent = DATA.player.name + '　·　Rating ' + (DATA.player.rating || '-') + '　·　' + DATA.all.length + ' 首成绩　·　' +
        DATA.at.slice(11) + ' 读取';
    }
    const note = document.createElement('div');
    note.style.cssText = 'margin-top:14px;font-size:13px;color:#ffffff99;';
    note.textContent = syncNote || (SYNC_URL ? '' : '历史记录仅保存在本机');
    wrap.append(info, b1, document.createElement('br'), b2, document.createElement('br'), b3, document.createElement('br'), b5);
    if (SYNC_URL) wrap.append(b4);
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

  // 调试样本里把表单的 token 打码（token 和登录状态有关，不要发给别人）
  const redact = (html) => html
    .replace(/(name="token"[^>]*value=")[^"]*/g, '$1***')
    .replace(/(value=")[^"]*("[^>]*name="token")/g, '$1***$2');

  // 解析带 sendMusicDetail 表单的曲目列表（rating 页面和全曲成绩页面结构相同）
  // 返回的数组带 total：页面上的曲目条目数（含没打过的），用来判断这个页面是否解析成功
  const parseSongList = (doc) => {
    const forms = doc.querySelectorAll('form[action*="sendMusicDetail"]');
    const list = [...forms].map((f) => {
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
    list.total = forms.length;
    if (typeof listSample === 'string' && (!listSample || !/fullcombo|alljustice/i.test(listSample))) {
      const f = [...forms].find((x) => /fullcombo|alljustice/i.test(x.innerHTML)) || [...forms].find((x) => x.querySelector('.play_musicdata_highscore'));
      if (f) listSample = redact(f.outerHTML.replace(/\s+/g, ' ')).slice(0, 3000);
    }
    return list;
  };

  let constDb = null;
  const loadConstDb = async () => {
    if (constDb) return constDb;
    say('正在下载谱面定数表（otoge-db，约 3MB）…');
    const db = await fetch(CONST_URL).then((r) => { if (!r.ok) throw new Error('定数表下载失败 ' + r.status); return r.json(); });
    const group = (key) => {
      const map = new Map();
      db.forEach((m) => { const k = key(m); if (k) { if (!map.has(k)) map.set(k, []); map.get(k).push(m); } });
      return map;
    };
    const titleList = group((m) => normTitle(m.title));
    constDb = {
      byId: new Map(db.map((m) => [String(m.id), m])),
      // 同名的 WORLD'S END 谱面（例：Oshama Scramble! 的「改」）排在后面，按曲名查时优先普通谱面
      byTitle: new Map([...titleList].map(([k, l]) => [k, l.find((m) => !isWE(m)) || l[0]])),
      byImage: new Map(db.filter((m) => m.image).map((m) => [m.image, m])),
      titleList,
      imageList: group((m) => m.image),
    };
    return constDb;
  };
  const isWE = (m) => !!(m.we_kanji || m.catname === "WORLD'S END");
  // 按曲绘 / 曲名找谱面：排除 WORLD'S END，并且要有这个难度（同名曲很多，例：Oshama Scramble! 有普通谱面和 WORLD'S END「改」）
  const resolveChart = (db, title, d, img) => {
    const ok = (m) => m && !isWE(m) && DIFFS[d] && m['lev_' + DIFFS[d].key];
    const pick = (list) => (list || []).find(ok);
    if (db.titleList) return (img && pick(db.imageList.get(img))) || pick(db.titleList.get(normTitle(title))) || null;
    const m = (img && db.byImage.get(img)) || db.byTitle.get(title) || db.byTitle.get(normTitle(title));
    return ok(m) ? m : null;
  };
  const enrich = (s, db) => {
    if (s.constant != null) return s;
    const m = db.byId.get(String(s.idx)) || resolveChart(db, s.title, s.diff);
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
    out.pages = {}; // 难度 → 页面上的曲目条目数（含没打过的）。> 0 说明这个难度的页面解析成功
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
      let total = list.total || 0;
      if (!list.length) {
        list = parseSongList(await fetchDoc(BASE + 'record/musicGenre/' + name.toLowerCase()));
        total = Math.max(total, list.total || 0);
      }
      out.pages[d] = total;
      // 列表页的 diff 值可能缺失，这里统一以当前难度为准
      list.forEach((s) => { s.diff = d; });
      out.push(...list);
      await new Promise((r) => setTimeout(r, 500));
    }
    return out;
  };

  const loadJackets = async (list, progress) => {
    progress = progress || say;
    const loadImg = (src) => new Promise((res) => {
      if (!src) return res(null);
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => res(null);
      img.src = src;
    });
    for (let i = 0; i < list.length; i += 8) {
      progress('正在加载曲绘… ' + Math.min(i + 8, list.length) + '/' + list.length);
      const batch = list.slice(i, i + 8);
      const imgs = await Promise.all(batch.map((s) => loadImg(s.jacket)));
      imgs.forEach((img, j) => { batch[j].img = img; });
      if (aborted) return;
    }
  };

  // ---------- 计算 ----------
  // 単曲レート（VERSE 以降の計算式。攻略 Wiki「レーティング・OVER POWER」の表）
  //   SSS+ 1,009,000 定数+2.15（上限）/ SSS 1,007,500 +2.00（100 点毎 +0.01）/ SS+ 1,005,000 +1.50（50 点毎）
  //   SS 1,000,000 +1.00（100 点毎）/ S+ 990,000 +0.60・S 975,000 ±0（250 点毎）
  //   A〜AAA：A 900,000 の −5.00 から「(900,000 を超えた分 / 75,000) × 5.00」（150 点毎 +0.01。AAA −1.67、AA −3.34）
  //   旧バージョンの「925,000〜975,000 で −3.00〜±0」とは違う。プレイヤーの実際の Rating（3 回分）で確認済み
  const songRating = (s, c) => {
    if (!c) return 0;
    let r;
    if (s >= 1009000) r = c + 2.15;
    else if (s >= 1007500) r = c + 2.0 + (s - 1007500) / 100 * 0.01;
    else if (s >= 1005000) r = c + 1.5 + (s - 1005000) / 50 * 0.01;
    else if (s >= 1000000) r = c + 1.0 + (s - 1000000) / 100 * 0.01;
    else if (s >= 975000) r = c + (s - 975000) / 250 * 0.01;
    else if (s >= 900000) r = c - 5 + (s - 900000) / 15000;
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
  // 用打开时读到的数据（DATA），不重新获取
  async function runB50() {
    const { player, best, news } = DATA;
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
      const bdoc = await fetchDoc(URL_PLAYER + 'ratingDetailBest/');
      const bf = bdoc.querySelector('form[action*="sendMusicDetail"]');
      if (bf) ratingSample = redact(bf.outerHTML.replace(/\s+/g, ' ')).slice(0, 3000);
      best = parseSongList(bdoc);
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
  // 从打开时读到的全曲成绩（DATA.all，EXPERT / MASTER / ULTIMA）里按难度挑，不重新获取
  async function runFilter(opt) {
    const { player, db } = DATA;
    if (!DATA.all.length) throw new Error('打开时没有读到全曲成绩（需要开通 CHUNITHM-NET スタンダードコース，或页面结构已变更）。可以在菜单里「重新读取」。');
    const all = DATA.all.filter((s) => opt.diffs.includes(s.diff));
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
    // 返回到筛选条件页面（换个定数范围再生成）
    await showResult(pages.map((p, i) => () => drawFilter(player, opt, list, p, i, pages.length, i * per)),
      'chunithm-' + opt.min.toFixed(1) + '-' + opt.max.toFixed(1), { label: '返回筛选', fn: showFilterForm });
  }

  // ---------- 历史记录 ----------
  // 规则与 ongeki-score-export / maimai-dx-score 保持一致。数据结构（history.json）：
  //   since: 起点（第一次记录的时间）。起点之前的游玩不知道当时的最佳是多少，统计会出错，所以不记
  //   obs:   观测记录 {t:'YYYY/MM/DD HH:MM', k:'曲目id:难度', n:曲名, d:难度, s:分数, src:'p'(プレイ履歴)|'b'(成绩扫描),
  //            nr:1(NEW RECORD), l:''|'FC'|'AJ'|'AJC'(标记)}
  //          l 缺省 = 这条记录没有标记信息（旧版本的记录、或プレイ履歴里读不到）。「没有 → 有」只是补记，不算推分
  //   snaps: Rating 快照 {t, r:Rating, b30, n20, best/news:[[k, 曲名, 分数, 单曲 Rating(0.01 单位), 标记]]}
  // 当前最佳和每一次推分都由 obs 按时间重放得出，所以多台设备的数据合并时只需取并集。
  let syncNote = '';
  let playlogSample = ''; // 调试用：プレイ履歴第一条的原始 HTML
  let listSample = '';    // 调试用：全曲成绩列表里一首带 FC/AJ 标记（没有就取有成绩）的歌的原始 HTML
  let ratingSample = '';  // 调试用：B50（ratingDetailBest）页面第一首歌的原始 HTML（看有没有直接写单曲 Rating）
  let playlogFirstForm = null; // プレイ履歴第一条的「詳細を見る」表单（调试信息里打开游玩详情用，不输出）
  let lastRun = null;     // 最近一次读到的数据，「更改同步名字」「从现在重新开始记录」时复用

  const pad2 = (n) => String(n).padStart(2, '0');
  // 「这次运行」的时间用日本时间：プレイ履歴的时间是日本时间，手机设在别的时区（例：中国时间慢 1 小时）时，
  // 成绩扫描的时间会排到刚打完的游玩前面，推分就判断错了
  const nowStr = () => {
    const p = {};
    new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date()).forEach((x) => { p[x.type] = x.value; });
    return p.year + '/' + p.month + '/' + p.day + ' ' + p.hour + ':' + p.minute;
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
  const normTitle = (s) => String(s).normalize('NFKC').replace(/\s+/g, ' ').trim();
  // v3：加了起点 since。v2 以前的记录不丢弃：把第一次成绩扫描的时间当作起点，丢掉起点之前的游玩（见 migrateHist）
  const HIST_V = 3;
  // scans：每次完整全曲扫描的时间和覆盖的难度，'YYYY/MM/DD HH:MM|2,3,4'。
  //   起点之后才第一次出现的谱面，如果之前已经有覆盖这个难度的完整扫描（那时还没打过），就是新打的，算推分（首次）
  // resetAt：「从现在重新开始记录」的时间。只有这个标记会让合并时丢掉更早的记录；
  //   新设备、清过浏览器数据等「本机没有记录」的情况不会写这个标记，合并时起点取较早的，数据只增不减
  const emptyHist = () => ({ v: HIST_V, game: 'chunithm', name: '', since: '', resetAt: '', obs: [], snaps: [], scans: [] });
  function migrateHist(h) {
    if (!h || !h.obs) return emptyHist();
    if (h.v === HIST_V) return h;
    const firstScan = h.obs.filter((o) => o.src === 'b').map((o) => o.t).sort()[0] || '';
    const since = firstScan || h.snaps.map((s) => s.t).sort()[0] || '';
    return { ...h, v: HIST_V, game: 'chunithm', since, obs: h.obs.filter((o) => o.t >= since), snaps: h.snaps.filter((s) => s.t >= since) };
  }
  // 同一次游玩 = 时间 + 曲名 + 难度 + 分数（不看曲目 id，id 对应方式变了也能去重）
  const playId = (o) => o.t + '|' + normTitle(o.n) + '|' + o.d + '|' + o.s;
  // 旧版本的记录没有 l 字段，id 只在有标记信息时才追加，保证和旧记录去重一致
  const obsId = (o) => (o.src === 'p' ? 'p|' + playId(o) : [o.t, o.k, o.s, o.src].join('|') + (o.l != null ? '|l' + o.l : ''));
  const LAMP_RANK = { '': 0, FC: 1, AJ: 2, AJC: 3 };
  const lampFromIcons = (icons) => (/alljusticecritical|_ajc/i.test(icons) ? 'AJC' : /alljustice/i.test(icons) ? 'AJ' : /fullcombo/i.test(icons) ? 'FC' : '');

  // プレイ履歴（最近 50 次游玩）。各字段按出现顺序一一对应，与 chu2view 的解析方式相同。只记 EXPERT 以上
  const parsePlaylog = (doc, db) => {
    const all = (sel) => [...doc.querySelectorAll(sel)];
    const titles = all('.play_musicdata_title');
    const dates = all('.play_datalist_date');
    const diffs = all('.play_track_result img');
    const scores = all('.play_musicdata_score_text');
    const jackets = all('.play_jacket_img img');
    if (titles.length) {
      let el = titles[0].parentElement;
      while (el && el.parentElement && !el.querySelector('.play_datalist_date')) el = el.parentElement;
      playlogSample = el ? redact(el.outerHTML.replace(/\s+/g, ' ')).slice(0, 3000) : '';
      playlogFirstForm = el ? el.querySelector('form[action*="laylog"]') : null;
    }
    if (!titles.length || dates.length !== titles.length || diffs.length !== titles.length || scores.length !== titles.length) return [];
    const names = ['basic', 'advanced', 'expert', 'master', 'ultima'];
    return titles.map((te, i) => {
      const dm = (diffs[i].getAttribute('src') || '').match(/(basic|advanced|expert|master|ultima|worldsend)/i);
      const d = dm ? names.indexOf(dm[1].toLowerCase()) : -1;
      const t = normTime(dates[i].textContent);
      const s = parseInt(scores[i].textContent.replace(/[^0-9]/g, ''), 10) || 0;
      if (d < 2 || !t || !s) return null;
      const n = te.textContent.trim();
      // 曲绘是延迟加载的（<img class="lazy" data-original="…/img/xxxx.jpg">），没有 src
      const jsrc = jackets.length === titles.length ? jackets[i].getAttribute('data-original') || jackets[i].getAttribute('src') || '' : '';
      const img = jsrc.split('/').pop().split('?')[0];
      const m = resolveChart(db, n, d, img);
      const o = { t, k: m ? songKey(m.id, d) : 'n:' + n + ':' + d, n, d, s, src: 'p' };
      // NEW RECORD 和这次的标记：只在能确定所属条目时读取
      let box = te.parentElement;
      while (box && !box.querySelector('.play_datalist_date')) box = box.parentElement;
      if (box && box.querySelectorAll('.play_musicdata_title').length === 1) {
        const icons = [...box.querySelectorAll('img')].map((x) => x.getAttribute('src') || '').join(' ');
        // NEW RECORD：分数旁边 .play_musicdata_score_img 里的 icon_new.png
        if (box.querySelector('.play_musicdata_score_img img[src*="new"]') || /new_?record/i.test(icons)) o.nr = 1;
        const l = lampFromIcons(icons);
        if (l) o.l = s >= 1010000 && l === 'AJ' ? 'AJC' : l;
      }
      return o;
    }).filter(Boolean);
  };

  // 某首歌在某一时刻的最佳状态 {s, l, has:{l}}。合并一条观测，返回这次带来的变化
  const blankState = () => ({ s: 0, l: '', has: { l: false } });
  function absorb(state, o) {
    const ch = [];
    const next = { ...state, has: { ...state.has } };
    if (o.s > state.s) { ch.push({ type: 'score', from: state.s, to: o.s }); next.s = o.s; }
    let l = state.l;
    if (o.l != null) {
      if (LAMP_RANK[o.l] > LAMP_RANK[l]) l = o.l;
      next.has.l = true;
    }
    // AJC 只由分数理论值决定：分数到 1,010,000 且已有 AJ 时，标记跟着升级
    if (next.has.l && next.s >= 1010000 && l === 'AJ') l = 'AJC';
    if (l !== state.l && state.has.l) ch.push({ type: 'lamp', from: state.l, to: l });
    next.l = l;
    return { next, ch };
  }

  // 按时间重放观测记录：每首歌的当前状态、每一次推分（before / after 状态和具体变化）
  // 一首谱面先要被成绩扫描记录过最佳，之后的提升才算推分；在那之前，只有游戏标了 NEW RECORD 的游玩才算
  // （否则プレイ履歴里没刷新的旧游玩会被当成「旧最佳」，扫描到真正的最佳时就误记成推分）。
  // 第一次出现的谱面：之前已有覆盖这个难度的完整全曲扫描、而那次扫描里没有它 → 那时还没打过，这次是新打的，算推分（首次）。
  // 起点那次扫描本身（之前没有完整扫描）里的谱面都只当起点。プレイ履歴里对应不到曲目 id 的（k 以 n: 开头）不按首次算，避免误判
  function derive(hist) {
    const state = {}, pb = {}, scanned = new Set(), updates = [];
    const fullScans = (hist.scans || []).map((x) => { const [t, ds] = x.split('|'); return { t, ds: (ds || '').split(',').map(Number) }; });
    const newChart = (o) => !o.k.startsWith('n:') && fullScans.some((f) => f.t < o.t && f.ds.includes(o.d));
    const fresh = new Set(); // 新打的谱面：最佳从 0 开始是确定的，之后的提升也都算推分（同 ongeki-score-export）
    hist.obs.slice().sort(byTime).forEach((o) => {
      const before = state[o.k];
      if (!before && newChart(o)) fresh.add(o.k);
      const known = scanned.has(o.k) || fresh.has(o.k);
      if (o.src === 'b') scanned.add(o.k);
      if (!before) {
        state[o.k] = absorb(blankState(), o).next;
        if ((o.src === 'p' && o.nr) || fresh.has(o.k)) {
          const ch = [{ type: 'score', from: null, to: o.s }];
          if (state[o.k].l) ch.push({ type: 'lamp', from: null, to: state[o.k].l });
          updates.push({ ...o, before: null, after: state[o.k], changes: ch });
        }
      } else {
        const { next, ch } = absorb(before, o);
        state[o.k] = next;
        if (ch.length && (known || (o.src === 'p' && o.nr))) updates.push({ ...o, before, after: next, changes: ch });
      }
      pb[o.k] = state[o.k].s;
    });
    return { state, pb, updates };
  }

  const mergeHist = (a, b) => {
    const out = emptyHist();
    out.name = b.name || a.name;
    // 起点取较早的：一边是新设备（本机没有记录，起点 = 这次）时，另一边更早的历史要全部保留。
    // 只有「从现在重新开始记录」（resetAt）才丢掉它之前的记录，在任何一台设备上点过都对所有设备生效
    out.resetAt = [a.resetAt || '', b.resetAt || ''].sort().pop();
    out.since = [a.since, b.since].filter(Boolean).sort()[0] || '';
    if (out.resetAt > out.since) out.since = out.resetAt;
    const seen = new Set();
    // 同一条记录两边都有时以 b（本机，已经重新对应过谱面）为准
    [...b.obs, ...a.obs].forEach((o) => { const id = obsId(o); if (!seen.has(id)) { seen.add(id); out.obs.push(o); } });
    out.obs = out.obs.filter((o) => o.t >= out.since).sort(byTime);
    const snaps = new Map();
    [...a.snaps, ...b.snaps].forEach((s) => snaps.set(s.t, s));
    out.snaps = [...snaps.values()].filter((s) => s.t >= out.since).sort(byTime);
    out.scans = [...new Set([...(a.scans || []), ...(b.scans || [])])].filter((x) => x >= out.since).sort();
    return out;
  };

  // プレイ履歴的游玩重新对应谱面：旧版本按曲名对应时，同名曲会对应到 WORLD'S END 谱面（没有定数，
  // 例：Oshama Scramble! → 「改」），或者对应不到（k = n:曲名:难度）。成绩扫描的记录用的是 CHUNITHM-NET 的曲目 id，不用改
  const fixPlayKeys = (hist, db) => {
    if (!db || !db.titleList) return hist;
    hist.obs.forEach((o) => {
      if (o.src !== 'p') return;
      const cur = o.k.startsWith('n:') ? null : db.byId.get(o.k.split(':')[0]);
      if (cur && !isWE(cur) && DIFFS[o.d] && cur['lev_' + DIFFS[o.d].key]) return;
      const m = resolveChart(db, o.n, o.d);
      if (m) o.k = songKey(m.id, o.d);
    });
    return hist;
  };

  const sameSnap = (a, b) => a && b && a.r === b.r &&
    JSON.stringify(a.best) === JSON.stringify(b.best) && JSON.stringify(a.news) === JSON.stringify(b.news);

  // 把本次读到的数据并入历史。all = 全曲成绩扫描（带标记），best/news = rating 页面（不带标记）
  //   scanDiffs：all 覆盖了哪些难度（完整读完的难度），记进 hist.scans
  const applyUpdate = (hist, { player, best, news, all, plays, scanDiffs }) => {
    const t = nowStr();
    if (player && player.name) hist.name = player.name;
    hist.v = HIST_V;
    hist.game = 'chunithm';
    if (!hist.since) hist.since = t; // 起点：这次的成绩扫描和快照就是历史的开始
    hist.scans = hist.scans || [];
    if (all && scanDiffs && scanDiffs.length) {
      const mark = t + '|' + scanDiffs.slice().sort().join(',');
      if (!hist.scans.includes(mark)) hist.scans.push(mark);
    }
    const ids = new Set(hist.obs.map(obsId));
    const byId = new Map(hist.obs.filter((o) => o.src === 'p').map((o) => [obsId(o), o]));
    (plays || []).forEach((o) => {
      const old = byId.get(obsId(o));
      if (!old) { if (!ids.has(obsId(o))) { ids.add(obsId(o)); hist.obs.push(o); } return; }
      // 以前解析时没认出来的信息（旧版本没识别 NEW RECORD 的图标）：重新读到同一次游玩时补上
      if (o.nr && !old.nr) old.nr = 1;
      if (o.l && old.l == null) old.l = o.l;
      if (old.k.startsWith('n:') && !o.k.startsWith('n:')) old.k = o.k;
    });
    // 成绩扫描：第一次见到、分数或标记提升、或者补记以前没有的标记信息时记录
    const { state } = derive(hist);
    const scan = new Map();
    [...(best || []), ...(news || [])].forEach((s) => scan.set(songKey(s.idx, s.diff), { s, lamp: false }));
    (all || []).forEach((s) => scan.set(songKey(s.idx, s.diff), { s, lamp: true }));
    const lampByKey = new Map();
    scan.forEach(({ s, lamp }, k) => {
      const o = { t, k, n: s.title, d: s.diff, s: s.score, src: 'b' };
      if (lamp) { o.l = s.lamp || ''; lampByKey.set(k, o.l); }
      const old = state[k];
      if (!old) { hist.obs.push(o); return; }
      const { ch } = absorb(old, o);
      if (ch.length || (o.l != null && !old.has.l)) hist.obs.push(o);
    });
    hist.obs.sort(byTime);
    if (best && news) {
      const sum = (l) => l.reduce((a, s) => a + s.rating, 0);
      const row = (s) => {
        const k = songKey(s.idx, s.diff);
        return [k, s.title, s.score, Math.floor(s.rating * 100 + 1e-6), lampByKey.has(k) ? lampByKey.get(k) : null];
      };
      const snap = {
        t,
        r: parseFloat(player.rating) || Math.floor((sum(best) + sum(news)) / 50 * 100) / 100,
        b30: best.length ? Math.round(sum(best) / best.length * 10000) / 10000 : 0,
        n20: news.length ? Math.round(sum(news) / news.length * 10000) / 10000 : 0,
        best: best.map(row),
        news: news.map(row),
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
    return migrateHist(h);
  };
  const saveLocalHist = (playerName, h) => {
    try { localStorage.setItem('b50:hist:' + playerName, JSON.stringify(h)); return true; } catch (e) { return false; }
  };

  // ---- 同步（经由 otoge-sync 读写 GitHub 私有仓库 otoge-history 的 chunithm/<玩家名>.json）----
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
      res = await fetch(SYNC_URL.replace(/\/+$/, '') + '/chunithm/' + encodeURIComponent(acc) + (suffix || ''), Object.assign({ cache: 'no-store' }, init));
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
      // 云端是旧版本（没有起点）的记录：先按起点转换再合并
      // 云端有文件但不是历史记录的格式：不覆盖，报错（避免用本机数据把云端冲掉）
      if (data && !data.obs) throw new Error('云端数据格式不对，没有改动云端');
      const merged = data ? mergeHist(migrateHist(data), local) : local;
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

  // 读取全曲成绩和プレイ履歴、并入历史、同步。任何一步失败都不影响出图，只在结果页提示
  //   opts.forceAsk：重新询问同步名字（「更改同步名字」）
  //   opts.reset：清空历史，从现在重新开始（起点 = 这次）
  async function recordAndSync({ player, best, news, all, db, scanDiffs }, opts) {
    opts = opts || {};
    let note = '';
    // 每次都扫描 EXPERT / MASTER / ULTIMA 全曲成绩，分数和 FC/AJ 标记的提升都能记下来
    if (!all) {
      try {
        all = TEST ? TEST.all : await readAllScores([2, 3, 4]);
        scanDiffs = [2, 3, 4];
      } catch (e) {
        if (/登录|维护/.test(e.message)) throw e;
        note += '（全曲成绩读取失败，只用 rating 页面）';
      }
    }
    // 只把页面解析成功的难度当作「完整扫描过」：页面上有曲目条目（含没打过的）就算，
    // 一首都没打过的难度（例：从没打过 ULTIMA）也算扫描过，之后第一次打的才能算「首次」。
    // 页面解析失败（一个条目都没有）时不算，免得下一次扫描把这个难度的全部谱面误判成「首次」
    if (all && scanDiffs) scanDiffs = scanDiffs.filter((d) => (all.pages ? all.pages[d] > 0 : all.some((s) => s.diff === d)));
    lastRun = { player, best, news, all, db, scanDiffs };
    let plays = [];
    try {
      if (TEST) plays = TEST.plays || [];
      else {
        say('正在读取游玩记录…');
        plays = parsePlaylog(await fetchDoc(BASE + 'record/playlog/'), db);
        if (!plays.length) note += '（未能解析游玩记录，只用成绩扫描）';
      }
    } catch (e) {
      if (/登录|维护/.test(e.message)) throw e;
      note += '（游玩记录读取失败）';
    }
    // 「从现在重新开始记录」：清空本机记录并写下 resetAt 标记，同步时云端更早的记录也会丢掉
    let local = loadLocalHist(player.name);
    if (opts.reset) { local = emptyHist(); local.resetAt = nowStr(); }

    // 开启了同步：先把云端的历史并入本机，再记录这次的数据。
    // 这样新设备 / 清过浏览器数据时，第一次运行就能接上云端的历史，「上一次查询之后」的游玩也不会漏记
    let acc = null, pending = [], syncErr = null;
    const accounts = store.get('accounts', {});
    if (SYNC_URL) {
      acc = opts.forceAsk ? undefined : accounts[player.name];
      try {
        if (acc === undefined) {
          await syncFetch('_ping'); // 先确认连得上，连不上就不询问（错误会显示在结果页 / 历史页）
          acc = await askAccount(player);
          // 选「暂不同步」也记下来，避免每次都问；可在「历史走势」里「更改同步名字」
          accounts[player.name] = acc;
          store.set('accounts', accounts);
        }
        if (acc) {
          // 2026/10/15 版本保存的名字没有统一全角/半角：改用统一后的名字，并把旧写法文件里的记录合并过来
          const legacy = [...new Set([acc, legacyAccount(player.name)])].filter((n) => n && n !== cleanAccount(n) && cleanAccount(n) === cleanAccount(acc));
          if (acc !== cleanAccount(acc)) {
            acc = cleanAccount(acc);
            accounts[player.name] = acc;
            store.set('accounts', accounts);
          }
          const migrated = store.get('migrated', []);
          pending = legacy.filter((old) => !migrated.includes(old + '>' + acc));
          say('正在读取云端历史…');
          for (const name of [...pending, acc]) {
            const { data } = await syncGet(name);
            if (data && !data.obs) throw new Error('云端数据格式不对（' + name + '），没有改动云端');
            if (data) local = mergeHist(migrateHist(data), local);
          }
        }
      } catch (e) { syncErr = e; }
    }

    fixPlayKeys(local, db);
    // 只记「上一次查询之后」的游玩（第一次 = 起点，之前的游玩都不记）。
    // 上一次查询时间 = 历史里最后一个快照 / 成绩扫描的时间。和上次同一分钟的游玩按「时间 + 曲名 + 难度 + 分数」去重
    const lastQuery = [...local.snaps.map((x) => x.t), ...local.obs.filter((o) => o.src === 'b').map((o) => o.t)].sort().pop() || '';
    const stored = new Set(local.obs.filter((o) => o.src === 'p').map(obsId));
    plays = lastQuery ? plays.filter((o) => o.t >= lastQuery || stored.has(obsId(o))) : [];
    let hist = applyUpdate(local, { player, best, news, all, plays, scanDiffs });
    const savedLocal = saveLocalHist(player.name, hist);
    syncNote = (savedLocal ? '历史记录已保存在本机' : '本机存储空间不足，历史记录未保存') + note;
    if (!SYNC_URL) return hist;
    if (syncErr) { syncNote = '同步失败：' + syncErr.message + '。已保存在本机，下次运行会重试' + note; return hist; }
    if (!acc) { syncNote += '（未开启云端同步）'; return hist; }
    try {
      say('正在同步…');
      hist = await syncMerge(acc, hist);
      saveLocalHist(player.name, hist);
      const migrated = store.get('migrated', []);
      if (pending.length) store.set('migrated', migrated.concat(pending.map((old) => old + '>' + acc)));
      syncNote = '历史记录已同步（chunithm/' + acc + '）' + note;
    } catch (e) {
      syncNote = '同步失败：' + e.message + '。已保存在本机，下次运行会重试' + note;
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

  if (TEST) window.__B50_INTERNAL__ = { parsePlaylog, derive, mergeHist, migrateHist, applyUpdate, b64enc, b64dec, syncMerge, syncGet, accountImpact, songRating, loadConstDb, resolveChart, fixPlayKeys };

  // 打开プレイ履歴第一条的「詳細を見る」，返回页面主要内容（打码后）。看游玩详情上有没有游玩后的 Rating
  async function readPlaylogDetailSample() {
    if (TEST || !playlogFirstForm) return null;
    try {
      const body = new URLSearchParams();
      playlogFirstForm.querySelectorAll('input[name]').forEach((i) => body.set(i.name, i.value));
      const doc = await fetchDoc(new URL(playlogFirstForm.getAttribute('action'), BASE).href, { method: 'POST', body });
      // 去掉菜单（#main_menu / #submenu 很长，会把真正的详情挤出截取范围），只留文字和图片文件名
      doc.querySelectorAll('script, style, header, footer, nav, #main_menu, #submenu, form').forEach((x) => x.remove());
      const main = doc.querySelector('.frame01') || doc.querySelector('#inner') || doc.body;
      if (!main) return null;
      return {
        text: main.textContent.replace(/\s+/g, ' ').trim().slice(0, 3000),
        imgs: [...main.querySelectorAll('img')].map((i) => (i.getAttribute('src') || i.getAttribute('data-original') || '').split('/').pop()).filter(Boolean).slice(0, 80),
        classes: [...new Set([...main.querySelectorAll('[class]')].map((x) => x.className))].slice(0, 80),
      };
    } catch (e) { return '读取失败：' + e.message; }
  }

  // ---------- 历史走势 ----------
  // 最近一次读到的历史（任何功能运行后都会更新）。从菜单再进「历史走势」时直接用它，不用重新读取
  let histView = null;

  const showHistory = () => showHistoryPanel(histView.hist, histView.player, histView.db);

  // 历史走势页（同 ongeki-score-export）：概况 + 走势图 + 单曲分数曲线。图都画在页面里，点曲目不用离开这个页面
  function showHistoryPanel(hist, player, db) {
    histView = { hist, player, db };
    const { pb, updates } = derive(hist);
    box.innerHTML = '';
    const p = document.createElement('div');
    p.style.cssText = 'margin:2vh auto 0;max-width:960px;text-align:left;';
    box.appendChild(p);
    const card = (css) => {
      const d = document.createElement('div');
      d.style.cssText = 'background:#1b2140;border:1px solid #fff2;border-radius:14px;padding:14px;margin-bottom:12px;' + (css || '');
      p.appendChild(d);
      return d;
    };
    const first = hist.snaps[0];
    const last = hist.snaps[hist.snaps.length - 1];
    const info = card();
    info.innerHTML =
      '<div style="font-size:20px;font-weight:bold;margin-bottom:6px;">历史走势</div>' +
      '<div style="font-size:14px;color:#ffffffcc;">' + esc(syncNote) + '</div>' +
      '<div style="font-size:14px;color:#ffffffcc;margin:6px 0 8px;">' +
      (hist.since ? '从 ' + esc(hist.since) + ' 开始记录　·　' : '') +
      hist.snaps.length + ' 个 Rating 快照　·　' +
      hist.obs.filter((o) => o.src === 'p').length + ' 条游玩记录　·　' + updates.length + ' 次推分' +
      (last ? '<br>当前 Rating ' + last.r.toFixed(2) + (first && first !== last ? '（' + signed(last.r - first.r) + '）' : '') : '') + '</div>';
    const mk = (label, css, fn) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = btnCss + css;
      b.onclick = fn;
      info.appendChild(b);
      return b;
    };
    const small = 'background:#ffffff22;color:#fff;margin:4px 8px 4px 0;padding:8px 16px;font-size:14px;';
    mk('返回菜单', small, showMenu);
    // 重新读取 CHUNITHM-NET 的数据（平时用的是打开书签时读到的）
    mk('重新读取', small, () => reload(showHistory));
    if (SYNC_URL) {
      mk('更改同步名字', small, () => run(async () => {
        const h = await recordAndSync(lastRun, { forceAsk: true });
        showHistoryPanel(h, player, db);
      }));
    }
    // 清空历史（本机和云端），把现在的成绩和 Rating 当作新的起点
    mk('从现在重新开始记录', small, () => {
      if (!confirm('清空这个账号的全部历史记录' + (SYNC_URL ? '（本机和云端）' : '') +
        '，把现在全部谱面的成绩当作新的起点，从现在开始重新记录？\n清空后无法恢复。')) return;
      run(async () => {
        const h = await recordAndSync(lastRun, { reset: true });
        showHistoryPanel(h, player, db);
      });
    });
    // 调试信息：プレイ履歴第一条的原始 HTML 等。复制后发给开发者
    mk('调试信息', small, async () => {
      const text = JSON.stringify({
        ua: navigator.userAgent,
        scanned: lastRun && lastRun.all ? lastRun.all.length : null,
        scanPages: lastRun && lastRun.all ? lastRun.all.pages || null : null,
        scanByDiff: lastRun && lastRun.all ? [2, 3, 4].map((d) => DIFFS[d].short + ':' + lastRun.all.filter((s) => s.diff === d).length).join(' ') : null,
        scanDiffs: lastRun ? lastRun.scanDiffs : null,
        unresolvedPlays: hist.obs.filter((o) => o.src === 'p' && o.k.startsWith('n:')).map((o) => o.n + ' ' + DIFFS[o.d].short).slice(0, 20),
        lamps: lastRun && lastRun.all ? lastRun.all.filter((s) => s.lamp).length : null,
        playlogSample,
        listSample,
        ratingSample,
        playlogDetailSample: await readPlaylogDetailSample(),
        history: { since: hist.since, snaps: hist.snaps.length, obs: hist.obs.length, plays: hist.obs.filter((o) => o.src === 'p').length, updates: updates.length, syncNote },
      }, null, 1);
      let ta = info.querySelector('textarea');
      if (!ta) {
        ta = document.createElement('textarea');
        ta.readOnly = true;
        ta.style.cssText = 'display:block;width:100%;height:180px;box-sizing:border-box;margin:8px 0 0;font:11px monospace;background:#0d1020;color:#ddd;border:1px solid #fff3;border-radius:8px;';
        info.appendChild(ta);
      }
      ta.value = text;
      try { await navigator.clipboard.writeText(text); alert('调试信息已复制，粘贴发给开发者即可。'); } catch (e) { ta.focus(); ta.select(); }
    });

    // 时间段：快捷按钮 + 自选起止日期。走势图、B50 变化、推分、单曲曲线都按它显示（选择会记住）
    let rangeSel = store.get('histRange', { kind: 'all' });
    // 以前选过、现在已经没有的快捷按钮（例：最近 90 天）当作「全部」
    if (rangeSel.kind !== 'custom' && !RANGE_PRESETS.some((p) => p[0] === rangeSel.kind)) rangeSel = { kind: 'all' };
    const rangeCard = card('padding:10px 14px;');
    const dateCss = 'padding:4px 6px;border-radius:6px;border:1px solid #fff4;background:#0d1020;color:#fff;font:15px ' + FONT + ';color-scheme:dark;';
    rangeCard.innerHTML = '<div style="font-weight:bold;margin-bottom:6px;">时间段</div><div id="b50-rbtns"></div>' +
      '<div style="margin-top:6px;font-size:14px;display:flex;flex-wrap:wrap;align-items:center;gap:6px;">自选 ' +
      '<input id="b50-rfrom" type="date" style="' + dateCss + '"> ～ <input id="b50-rto" type="date" style="' + dateCss + '"></div>';
    const rbtns = rangeCard.querySelector('#b50-rbtns');
    const rFrom = rangeCard.querySelector('#b50-rfrom'), rTo = rangeCard.querySelector('#b50-rto');
    const toInput = (ymd) => ymd.split('/').join('-');
    const apply = document.createElement('button');
    apply.textContent = '应用';
    apply.style.cssText = btnCss + 'background:#7ee0ff;color:#222;margin:0;padding:4px 14px;font-size:14px;';
    rTo.after(apply);
    // 推分只看让账号 Rating 变化的（选择会记住）
    let onlyRated = !!store.get('onlyRated', false);
    const orLabel = document.createElement('label');
    orLabel.style.cssText = 'display:flex;align-items:center;gap:6px;margin-top:8px;font-size:14px;cursor:pointer;';
    orLabel.innerHTML = '<input type="checkbox" style="width:18px;height:18px;margin:0;"> 推分只看账号 Rating 有变化的';
    const orBox = orLabel.querySelector('input');
    orBox.checked = onlyRated;
    orBox.onchange = () => { onlyRated = orBox.checked; store.set('onlyRated', onlyRated); drawTrendNow(); };
    rangeCard.appendChild(orLabel);
    const paintRange = () => {
      const r = rangeOf(rangeSel, hist);
      rbtns.innerHTML = '';
      RANGE_PRESETS.forEach(([kind, label]) => {
        const b = document.createElement('button');
        b.textContent = label;
        const on = rangeSel.kind === kind;
        b.style.cssText = btnCss + 'margin:3px 6px 3px 0;padding:6px 12px;font-size:14px;' + (on ? 'background:#c9a2ff;color:#222;' : 'background:#ffffff1a;color:#fff;');
        b.onclick = () => setRange({ kind });
        rbtns.appendChild(b);
      });
      // 日期框显示当前的时间段（全部 = 从开始记录到今天）
      rFrom.value = toInput(r ? r.from.slice(0, 10) : (hist.since || nowStr()).slice(0, 10));
      rTo.value = toInput(r ? r.to.slice(0, 10) : nowStr().slice(0, 10));
      apply.style.background = rangeSel.kind === 'custom' ? '#c9a2ff' : '#7ee0ff';
    };
    const setRange = (sel) => {
      rangeSel = sel;
      store.set('histRange', sel);
      paintRange();
      drawTrendNow();
      if (openCurve) showCurve(openCurve, false);
    };
    apply.onclick = () => {
      let a = rFrom.value.split('-').join('/'), b = rTo.value.split('-').join('/');
      if (!a || !b) { alert('请选择开始和结束日期'); return; }
      if (a > b) [a, b] = [b, a];
      setRange({ kind: 'custom', from: a, to: b });
    };

    // 走势图：直接画在页面里
    const trendBox = card('padding:10px;text-align:center;color:#ffffffaa;');
    trendBox.textContent = '正在生成走势图…';
    const drawTrendNow = () => {
      trendBox.textContent = '正在生成走势图…';
      renderImages(trendBox, [() => drawTrend(hist, player, db, rangeOf(rangeSel, hist), onlyRated)], 'chunithm-history', { inline: true })
        .catch((err) => { trendBox.textContent = '走势图生成失败：' + (err.message || err); });
    };

    // 单曲分数曲线：只列出プレイ履歴里出现过、或有推分记录的谱面；点一首，曲线画在列表下面
    const pushed = new Set(updates.map((u) => u.k));
    const songs = new Map();
    hist.obs.forEach((o) => {
      if (o.d < 2) return;
      const e = songs.get(o.k) || { k: o.k, n: o.n, d: o.d, plays: 0, last: '' };
      e.plays += o.src === 'p' ? 1 : 0;
      if (o.t > e.last) e.last = o.t;
      songs.set(o.k, e);
    });
    const sec = card();
    sec.innerHTML = '<div style="font-weight:bold;margin-bottom:6px;">单曲分数曲线</div>' +
      '<input id="b50-q" placeholder="输入曲名搜索" autocomplete="off" style="width:100%;box-sizing:border-box;padding:8px 10px;' +
      'border-radius:8px;border:1px solid #fff4;background:#0d1020;color:#fff;font:16px ' + FONT + ';">' +
      '<div id="b50-songs" style="margin-top:8px;"></div>';
    const curveBox = card('display:none;padding:10px;text-align:center;color:#ffffffaa;');
    const listEl = sec.querySelector('#b50-songs');
    let curveSeq = 0;
    const render = () => {
      const q = normTitle(sec.querySelector('#b50-q').value).toLowerCase();
      const items = [...songs.values()]
        .filter((e) => (e.plays > 0 || pushed.has(e.k)) && (!q || normTitle(e.n).toLowerCase().includes(q)))
        .sort((a, b) => b.plays - a.plays || (a.last < b.last ? 1 : -1))
        .slice(0, 30);
      listEl.innerHTML = '';
      if (!items.length) {
        listEl.innerHTML = '<div style="color:#ffffff88;font-size:14px;">没有记录（プレイ履歴里出现过、或有推分记录的谱面才会列在这里）</div>';
        return;
      }
      items.forEach((e) => {
        const row = document.createElement('button');
        row.style.cssText = '-webkit-appearance:none;display:flex;width:100%;align-items:center;gap:8px;text-align:left;margin:4px 0;padding:8px 10px;' +
          'border:1px solid #fff2;border-radius:8px;background:#0d1020;color:#fff;font:14px ' + FONT + ';cursor:pointer;';
        row.innerHTML = '<span style="background:' + DIFFS[e.d].color + ';border-radius:4px;padding:0 6px;font-weight:bold;font-size:12px;">' +
          DIFFS[e.d].short + '</span><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(e.n) +
          '</span><span style="color:#ffffff99;font-size:12px;">' + (pb[e.k] || 0).toLocaleString('en-US') + '　' + e.plays + ' 次</span>';
        row.onclick = () => showCurve(e, true);
        listEl.appendChild(row);
      });
    };
    sec.querySelector('#b50-q').oninput = render;
    render();

    // 单曲曲线画在列表下面。切换时间段时重画当前打开的那首（scroll = false）
    let openCurve = null;
    async function showCurve(e, scroll) {
      const seq = ++curveSeq; // 连续点了几首时，只显示最后点的那首
      openCurve = e;
      curveBox.style.display = '';
      curveBox.textContent = '正在生成 ' + e.n + ' 的走势图…';
      if (scroll) curveBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
      try {
        const idx = e.k.startsWith('n:') ? 'n' : e.k.split(':')[0];
        const s = enrich({ idx, diff: e.d, title: e.n, score: pb[e.k] || 0 }, db);
        if (s.jacket) await loadJackets([s], (t) => { if (seq === curveSeq) curveBox.textContent = t; });
        if (seq !== curveSeq) return;
        await renderImages(curveBox, [() => drawSongCurve(hist, e, s, player, db, rangeOf(rangeSel, hist))],
          'chunithm-' + e.n.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40), {
            inline: true,
            back: { label: '收起', fn: () => { openCurve = null; curveBox.style.display = 'none'; sec.scrollIntoView({ block: 'start' }); } },
          });
      } catch (err) {
        if (seq === curveSeq) curveBox.textContent = '生成失败：' + (err.message || err);
      }
    }

    paintRange();

    drawTrendNow();
  }

  // 时间段的快捷按钮 [kind, 文字, 往前几天（含今天）]。日期按日本时间
  const RANGE_PRESETS = [['since', '上次以来', null], ['today', '今天', 0], ['7d', '最近 7 天', 6], ['30d', '最近 30 天', 29], ['all', '全部', null]];
  const shiftDay = (ymd, n) => {
    const [y, m, d] = ymd.split('/').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + n));
    return dt.getUTCFullYear() + '/' + pad2(dt.getUTCMonth() + 1) + '/' + pad2(dt.getUTCDate());
  };
  const addMinute = (t) => {
    const m = t.match(/(\d+)\/(\d+)\/(\d+) (\d+):(\d+)/);
    const d = new Date(Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5] + 1));
    return d.getUTCFullYear() + '/' + pad2(d.getUTCMonth() + 1) + '/' + pad2(d.getUTCDate()) + ' ' + pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes());
  };
  // 选择 → {from, to, label}（'YYYY/MM/DD HH:MM'）；全部 → null
  //   上次以来：上一次读取（倒数第二次完整扫描 / 快照）之后 → 这次读取。上一次读取时发现的推分不算
  const rangeOf = (sel, hist) => {
    if (!sel || sel.kind === 'all') return null;
    if (sel.kind === 'since') {
      const runs = [...new Set([...(hist.scans || []).map((x) => x.split('|')[0]), ...hist.snaps.map((x) => x.t)])].sort();
      if (runs.length < 2) return null;
      return { from: addMinute(runs[runs.length - 2]), to: runs[runs.length - 1], label: '上次以来' };
    }
    if (sel.kind === 'custom' && sel.from && sel.to) {
      return { from: sel.from + ' 00:00', to: sel.to + ' 23:59', label: sel.from === sel.to ? sel.from.slice(5) : sel.from.slice(5) + '–' + sel.to.slice(5) };
    }
    const p = RANGE_PRESETS.find((x) => x[0] === sel.kind);
    if (!p || p[2] == null) return null;
    const today = nowStr().slice(0, 10);
    return { from: shiftDay(today, -p[2]) + ' 00:00', to: today + ' 23:59', label: p[1] };
  };

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
    if (opt.xLabels) { t0 = -0.5; t1 = Math.max(opt.xLabels.length - 1, 0) + 0.5; } // 等间隔：两端各留半格
    else if (t1 - t0 < 864e5) { t0 -= 432e5; t1 += 432e5; }
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
    if (opt.xLabels) {
      // 点太多时只标一部分（最多 8 个），保证首尾都标
      const n = opt.xLabels.length, step = Math.max(1, Math.ceil(n / 8));
      opt.xLabels.forEach((lb, i) => { if (i % step === 0 || i === n - 1) g.fillText(lb, X(i), B + 24); });
    } else {
      const ticks = Math.min(6, Math.max(2, Math.round((t1 - t0) / 864e5) + 1));
      for (let i = 0; i < ticks; i++) {
        const t = t0 + (t1 - t0) * i / (ticks - 1);
        const d = new Date(t);
        g.fillText((d.getMonth() + 1) + '/' + d.getDate(), X(t), B + 24);
      }
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

  // 某首歌（观测记录的 k / 曲名 / 难度）的定数，查不到时 c = 0
  const constOf = (k, n, d, db) => {
    const s = enrich({ idx: k.startsWith('n:') ? 'n' : k.split(':')[0], diff: d, title: n, score: 0 }, db);
    return { c: s.constant || 0, est: !!s.estimated };
  };
  const diffOfKey = (k) => Number(k.slice(k.lastIndexOf(':') + 1));
  // 单曲 Rating（0.01 单位，截断）
  const centsOf = (score, c) => (c ? Math.floor(songRating(score, c) * 100 + 1e-6) : 0);

  // 单曲 Rating 的变化，画在 (x, y) 处右对齐：「Rating 15.42 → 15.67  +0.25」；返回占用的宽度
  function ratingChange(g, x, y, from, to, cInfo, size) {
    const px = size || 14;
    let cx = x;
    const seg = (text, color, bold) => {
      g.font = (bold ? 'bold ' : '') + px + 'px ' + FONT;
      g.fillStyle = color;
      const w = g.measureText(text).width;
      g.fillText(text, cx - w, y);
      cx -= w + 8;
    };
    if (!cInfo.c) { seg('定数未知', '#ffffff66'); return x - cx; }
    const r1 = centsOf(to, cInfo.c);
    const r0 = from != null ? centsOf(from, cInfo.c) : null;
    // 用显示出来的两个数（各自截到 0.01）相减，保证差值和左边的数字对得上
    if (r0 != null) seg(r1 > r0 ? '+' + ((r1 - r0) / 100).toFixed(2) : '±0.00', r1 > r0 ? '#7ee0a0' : '#ffffff66', true);
    seg((r1 / 100).toFixed(2) + (cInfo.est ? '*' : ''), '#ffd65a', true);
    seg('Rating ' + (r0 != null ? (r0 / 100).toFixed(2) + ' →' : '→'), '#ffffff99');
    return x - cx;
  }

  // 推分内容的文字：「1,003,000 → 1,005,000（+2,000）· FC→AJ」
  function changeText(u) {
    return u.changes.map((c) => (c.type === 'score'
      ? (c.from != null ? c.from.toLocaleString('en-US') + ' → ' + c.to.toLocaleString('en-US') + '（+' + (c.to - c.from).toLocaleString('en-US') + '）'
        : c.to.toLocaleString('en-US') + '（首次）')
      : c.from === null ? c.to : (c.from || 'CLEAR') + '→' + c.to)).join(' · ');
  }

  // 每次推分对账号 Rating 的影响。
  // 两个快照之间的推分按时间顺序放进 B50：以前一个快照（当时完整的 BEST 30 / NEW 20）为起点，
  // 放入推分后的单曲 Rating，超出枠的数量时挤掉最低的一首。账号 Rating = 50 首单曲 Rating 之和 ÷ 50 截断到 0.01。
  // 首尾都对齐游戏里显示的真实 Rating：游戏只显示到 0.01，后面的余数不知道，取一个让「开始 = 前一个快照的 Rating、
  // 结束 = 后一个快照的 Rating」同时成立的余数，再逐条计算，所以同一段里各条推分的变化加起来正好等于两个快照的差。
  // 怎么取都对不上时（两次运行之间有没记录到的游玩等），差额写在这一段最后一条推分上，不硬凑。
  // 新曲 / 旧曲看后一个快照里这首歌在哪个框；不在 B50 里的才按版本判断。CHUNITHM 的 Rating 和 FC/AJ 无关
  function accountImpact(hist, updates, db) {
    const snaps = hist.snaps;
    const cache = new Map();
    const cents = (k, n, s) => {
      const id = k + '|' + s;
      if (!cache.has(id)) cache.set(id, centsOf(s, constOf(k, n, diffOfKey(k), db).c));
      return cache.get(id);
    };
    const verCount = {};
    const latest = snaps[snaps.length - 1];
    if (latest) latest.news.forEach((e) => { const m = db.byId.get(e[0].split(':')[0]); if (m && m.version) verCount[m.version] = (verCount[m.version] || 0) + 1; });
    const newVer = Object.keys(verCount).sort((a, b) => verCount[b] - verCount[a])[0];
    const inNew = new Set(), inBest = new Set();
    snaps.forEach((s) => { s.news.forEach((e) => inNew.add(e[0])); s.best.forEach((e) => inBest.add(e[0])); });
    const isNewGuess = (k) => (inNew.has(k) ? true : inBest.has(k) ? false : !!(newVer && (db.byId.get(k.split(':')[0]) || {}).version === newVer));
    // 快照里存了单曲 Rating（e[3]）就直接用，旧版本的快照按分数和现在的定数计算
    const fromSnap = (s) => ({
      // 快照里存的单曲 Rating（e[3]）是当时按本工具的公式算的（旧版本用过有误的公式），一律按分数用现在的公式重算
      best: new Map(s.best.map((e) => [e[0], cents(e[0], e[1], e[2])])),
      news: new Map(s.news.map((e) => [e[0], cents(e[0], e[1], e[2])])),
    });
    const sum = (st) => [...st.best.values(), ...st.news.values()].reduce((a, v) => a + v, 0);
    // 放入一个值；超出 cap 时挤掉最低的一首（可能就是它自己）。
    // keep = 后一个快照里这首歌确实在这个框里：一定留下，挤掉的是除它以外最低的一首
    const put = (m, k, v, cap, keep) => {
      const was = m.has(k);
      if (!was || v > m.get(k)) m.set(k, v);
      if (m.size > cap) {
        let low = null, lowV = Infinity;
        m.forEach((x, kk) => { if (keep && kk === k) return; if (x < lowV || (x === lowV && kk === k)) { low = kk; lowV = x; } });
        m.delete(low);
        if (low !== k) return { entered: !was, inFrame: true, out: low, outCents: lowV }; // 挤掉了别的歌
      }
      return { entered: !was && m.has(k), inFrame: m.has(k) };
    };

    // 定数表和游戏的偏差：按定数表算的 50 首合计 − 游戏里的真实合计（0.01 单位）。
    // 每个快照只知道游戏 Rating（截断到 0.01），所以偏差在一个范围里：[合计 − (r×50+49), 合计 − r×50]。
    // 连续的快照能取到同一个偏差就合在一起（约束越多越准）；对不上了（定数表更新、B50 换了一批歌等）就从那里重新开始。
    // 在范围里取最接近 0 的值：定数表尽量当作是对的，只修正必须修正的部分
    const runOf = [], runRange = [];
    snaps.forEach((s, idx) => {
      const r = Math.round((s.r || 0) * 100);
      const rng = r && (s.best.length || s.news.length) ? (() => { const T = sum(fromSnap(s)); return [T - (r * 50 + 49), T - r * 50]; })() : null;
      const run = runRange.length - 1;
      const cur = run >= 0 ? runRange[run] : null;
      if (!rng) { runOf[idx] = Math.max(run, 0); if (run < 0) runRange.push([-Infinity, Infinity]); return; }
      if (cur && Math.max(cur[0], rng[0]) <= Math.min(cur[1], rng[1])) {
        runRange[run] = [Math.max(cur[0], rng[0]), Math.min(cur[1], rng[1])];
        runOf[idx] = run;
      } else {
        runRange.push(rng);
        runOf[idx] = runRange.length - 1;
      }
    });
    const offsetOf = (idx) => { const [lo, hi] = runRange[runOf[idx]]; return Math.min(hi, Math.max(lo, 0)); };

    // 按「在哪两个快照之间」分组
    const out = new Map();
    const groups = new Map();
    updates.slice().sort(byTime).forEach((u) => {
      let i = -1;
      while (i + 1 < snaps.length && snaps[i + 1].t < u.t) i++;
      if (i < 0 || !(snaps[i].best.length || snaps[i].news.length)) { out.set(u, { noSnap: true }); return; }
      if (!groups.has(i)) groups.set(i, []);
      groups.get(i).push(u);
    });

    groups.forEach((list, i) => {
      const prev = snaps[i], next = snaps[i + 1] || null;
      const nextBest = next ? new Set(next.best.map((e) => e[0])) : null;
      const nextNew = next ? new Set(next.news.map((e) => e[0])) : null;
      const st = fromSnap(prev);
      const s0 = sum(st);
      const steps = []; // [{u, res, d}]  d = 50 首合计的变化（0.01 单位）
      // 后一个快照里在 B50 里 = 这首歌在这一段里**最后一次**推分后在里面。同一首歌在一段里推了好几次时，
      // 前面几次不一定进了（第一把比 B50 最低的还低，后来推高了才进），只有最后一次一定留下，前面的照常比较
      const lastPush = new Map();
      list.forEach((u) => { if (u.changes.some((c) => c.type === 'score')) lastPush.set(u.k, u); });
      list.forEach((u) => {
        if (!constOf(u.k, u.n, u.d, db).c) { steps.push({ u, res: { noConst: true }, d: 0 }); return; }
        if (!u.changes.some((c) => c.type === 'score')) { steps.push({ u, res: { lampOnly: true }, d: 0 }); return; }
        const frame = nextBest && nextBest.has(u.k) ? 'best' : nextNew && nextNew.has(u.k) ? 'news'
          : st.best.has(u.k) ? 'best' : st.news.has(u.k) ? 'news' : (isNewGuess(u.k) ? 'news' : 'best');
        const before = sum(st);
        const res = { frame: frame === 'best' ? 'BEST 30' : 'NEW 20' };
        // 后一个快照里有真实的 B50：在里面 → 一定算进去；不在里面（也不在原来的 B50 里）→ 没进，账号 Rating 不变
        const inNext = next ? (nextBest.has(u.k) || nextNew.has(u.k)) : null;
        if (inNext === false && !st[frame].has(u.k)) Object.assign(res, { entered: false, inFrame: false });
        else Object.assign(res, put(st[frame], u.k, cents(u.k, u.n, u.after.s), frame === 'best' ? 30 : 20, inNext === true && lastPush.get(u.k) === u));
        steps.push({ u, res, d: sum(st) - before });
      });
      // 起点：按定数表算的合计减去偏差（见上面 offsetOf），保证 floor(起点/50) = 前一个快照的游戏 Rating。
      // 结束时和后一个快照的游戏 Rating 还差多少（没记录到的游玩、定数表在这段时间里变了等），写在最后一条推分上
      const total = steps.reduce((a, x) => a + x.d, 0);
      const t0 = prev.r ? s0 - offsetOf(i) : s0;
      const gap = next && next.r && prev.r ? Math.round(next.r * 100) - Math.floor((t0 + total) / 50) : 0;
      let cur = t0;
      steps.forEach((x, k) => {
        const delta = Math.floor((cur + x.d) / 50) - Math.floor(cur / 50);
        x.res.ratingBefore = Math.floor(cur / 50); // 这次推分前后的账号 Rating（0.01 单位），按时间段统计时用
        cur += x.d;
        if (x.res.frame) { x.res.delta = delta; x.res.exact = x.d / 50 / 100; }
        if (gap && k === steps.length - 1) x.res.gap = gap;
        x.res.ratingAfter = Math.floor(cur / 50) + (k === steps.length - 1 ? gap : 0);
        out.set(x.u, x.res);
      });
    });
    return out;
  }

  // 「进入 BEST 30 · 账号 Rating +0.02」之类的说明文字和颜色
  const GOOD = '#7ee0a0';
  const impactText = (im) => {
    if (!im || im.noSnap) return ['之前没有快照，算不出账号 Rating 的变化', '#ffffff55'];
    const gap = im.gap ? (im.gap > 0 ? ' · 另有 +' : ' · 另有 −') + (Math.abs(im.gap) / 100).toFixed(2) + ' 来自没记录到的变化' : '';
    if (im.noConst) return ['定数未知，算不出账号 Rating 的变化' + gap, '#ffffff66'];
    if (im.lampOnly) return ['只有标记提升 · 单曲 Rating 和账号 Rating 不变' + gap, '#ffffff66'];
    const head = im.entered ? '进入 ' + im.frame : im.inFrame ? im.frame + ' 内提升' : '未进入 ' + im.frame;
    if (im.delta > 0) return [head + ' · 账号 Rating +' + (im.delta / 100).toFixed(2) + gap, GOOD];
    if (im.exact > 0) return [head + ' · 账号 Rating 不变（+' + im.exact.toFixed(4) + '，未进位）' + gap, '#ffffff99'];
    return [head + ' · 账号 Rating 不变' + gap, '#ffffff66'];
  };

  const LAMP_COLOR = { FC: '#7ee0ff', AJ: '#ffb86b', AJC: '#ffd65a' };
  // 小标签（FC / AJ / AJC），返回宽度
  function pill(g, text, x, y, color) {
    g.font = 'bold 12px ' + FONT;
    const w = g.measureText(text).width + 12;
    round(g, x, y - 14, w, 18, 4);
    g.fillStyle = color; g.fill();
    g.fillStyle = '#16151c'; g.fillText(text, x + 6, y);
    return w;
  }

  // 一首歌在这段时间里的推分合起来写：「最初分数 → 最后分数（+差）· 最初标记→最后标记 · 共 n 次推分」
  const firstLast = (en) => {
    const f = (x) => x.toLocaleString('en-US');
    let t = en.s0 == null ? f(en.s1) + '（首次）'
      : en.s1 > en.s0 ? f(en.s0) + ' → ' + f(en.s1) + '（+' + f(en.s1 - en.s0) + '）' : f(en.s1);
    if (en.l1 && en.l1 !== (en.l0 || '')) t += ' · ' + (en.l0 == null ? en.l1 : (en.l0 || 'CLEAR') + '→' + en.l1);
    if (en.n > 1) t += ' · 共 ' + en.n + ' 次推分';
    return t;
  };

  // range：{from, to, label}（'YYYY/MM/DD HH:MM'），null = 全部。
  //   走势线画这段时间（再接上开始前最后一个快照），B50 变化比较「开始时 → 结束时」，推分只列这段时间里的
  //   onlyRated：推分列表只列让账号 Rating 变了的（没进 B50、进了但没进位、只有标记提升的都不列）
  function drawTrend(hist, player, db, range, onlyRated) {
    const { updates } = derive(hist);
    const impact = accountImpact(hist, updates, db); // 账号 Rating 的影响要用全部记录算，显示时再按时间段筛
    const inRange = (t) => !range || (t >= range.from && t <= range.to);
    const allSnaps = hist.snaps;
    const upto = allSnaps.filter((s) => !range || s.t <= range.to);
    const last = upto[upto.length - 1];
    // 对比的起点：全部 = 上一次快照；时间段 = 开始前最后一个快照（没有就用这段时间里的第一个）
    const prev = !range ? allSnaps[allSnaps.length - 2]
      : [...allSnaps].reverse().find((s) => s.t < range.from) || allSnaps.find((s) => inRange(s.t));
    const snaps = !range ? allSnaps : allSnaps.filter((s) => inRange(s.t) || s === prev);
    const hasPrev = prev && last && prev !== last;
    // 快照里存的单曲 Rating 可能是旧公式算的，按分数用现在的公式重算
    const rowCents = (e) => centsOf(e[2], constOf(e[0], e[1], diffOfKey(e[0]), db).c);

    // 某个时刻的账号 Rating（0.01 单位）：那之前最后一次推分后的值（按推分的时间算），没有就用那之前最后一个快照。
    // strict = 不含这个时刻（「开始前」）
    const ratingAt = (t, strict) => {
      const ok = (x) => (strict ? x < t : x <= t);
      let best = null;
      allSnaps.forEach((sn) => { if (sn.r && ok(sn.t) && (!best || sn.t >= best.t)) best = { t: sn.t, r: Math.round(sn.r * 100) }; });
      updates.forEach((u) => {
        const im = impact.get(u);
        if (im && im.ratingAfter != null && ok(u.t) && (!best || u.t >= best.t)) best = { t: u.t, r: im.ratingAfter };
      });
      return best ? best.r : null;
    };
    const startR = range ? ratingAt(range.from, true) : null;
    const endR = range ? ratingAt(range.to, false) : null;
    // 时间段在同一天之内（今天 / 自选的同一天 / 上次以来在同一天）：走势图按每次 Rating 上涨等间隔画
    const sameDay = range && range.from.slice(0, 10) === range.to.slice(0, 10);
    const nameOf = new Map();
    allSnaps.forEach((sn) => [...sn.best, ...sn.news].forEach((e) => nameOf.set(e[0], e[1])));
    hist.obs.forEach((o) => nameOf.set(o.k, o.n));

    const rows = []; // {side:'L'|'R', e, color, right, sub}
    let upMore = 0;
    if (range) {
      // 这段时间里的推分带来的 B50 变化（按推分的时间，比快照更准）：新进 / 提升 / 被挤出
      // k → {start, end, before, after（单曲 Rating）, s0 / s1（最初 / 最后的分数）, l0 / l1（最初 / 最后的标记）, n（推分次数）}
      const mem = new Map();
      const entry = (k, start) => { if (!mem.has(k)) mem.set(k, { start, end: start, before: null, after: null, s0: null, s1: null, l0: null, l1: null, n: 0 }); return mem.get(k); };
      updates.filter((u) => inRange(u.t)).forEach((u) => {
        const im = impact.get(u);
        if (!im || !im.frame) return;
        if (im.inFrame) {
          const en = entry(u.k, !im.entered);
          en.end = true;
          if (en.before == null && !im.entered && u.before) en.before = centsOf(u.before.s, constOf(u.k, u.n, u.d, db).c);
          en.after = centsOf(u.after.s, constOf(u.k, u.n, u.d, db).c);
          // 同一首歌推了几次：只记最初和最后的分数 / 标记
          if (!en.n) { en.s0 = u.before ? u.before.s : null; en.l0 = u.before && u.before.has.l ? u.before.l : null; }
          en.n++;
          en.s1 = u.after.s;
          if (u.after.has.l) en.l1 = u.after.l;
        }
        if (im.out) {
          const en = entry(im.out, true);
          en.end = false;
          if (en.after == null) en.after = im.outCents;
        }
      });
      const ups = [];
      mem.forEach((en, k) => {
        const e = [k, nameOf.get(k) || k];
        if (!en.start && en.end) rows.push({ side: 'L', e, color: GOOD, right: '新进 ' + (en.after / 100).toFixed(2), sub: firstLast(en) });
        else if (en.start && !en.end) rows.push({ side: 'R', e, color: '#ff8a8a', right: '移出 ' + (en.after / 100).toFixed(2) });
        else if (en.start && en.end) ups.push({ e, dr: en.after - (en.before == null ? en.after : en.before), en });
      });
      ups.sort((p, q) => q.dr - p.dr);
      upMore = Math.max(0, ups.length - 10);
      ups.slice(0, 10).forEach(({ e, dr, en }) => rows.push({
        side: 'L', e, color: dr > 0 ? '#ffd65a' : '#ffffff77',
        right: dr > 0 ? (en.before / 100).toFixed(2) + ' → ' + (en.after / 100).toFixed(2) + '（+' + (dr / 100).toFixed(2) + '）'
          : (en.after / 100).toFixed(2) + '（rating 不变）',
        sub: firstLast(en),
      }));
    } else if (hasPrev) {
      const toMap = (s) => new Map([...s.best, ...s.news].map((e) => [e[0], e]));
      const a = toMap(prev), b = toMap(last);
      const ups = [];
      b.forEach((e, k) => {
        const o = a.get(k);
        if (!o) { rows.push({ side: 'L', e, color: GOOD, right: '新进 ' + (rowCents(e) / 100).toFixed(2) }); return; }
        const why = [];
        if (e[2] > o[2]) why.push(o[2].toLocaleString('en-US') + ' → ' + e[2].toLocaleString('en-US') + '（+' + (e[2] - o[2]).toLocaleString('en-US') + '）');
        if (e[4] != null && o[4] != null && LAMP_RANK[e[4]] > LAMP_RANK[o[4]]) why.push((o[4] || 'CLEAR') + '→' + e[4]);
        const dr = rowCents(e) - rowCents(o);
        if (why.length || dr > 0) ups.push({ e, dr, why });
      });
      ups.sort((p, q) => q.dr - p.dr);
      upMore = Math.max(0, ups.length - 10);
      // 分数 / 标记提升了但单曲 Rating 没变的，用灰色写「rating 不变」
      ups.slice(0, 10).forEach(({ e, dr, why }) => rows.push({
        side: 'L', e, color: dr > 0 ? '#ffd65a' : '#ffffff77',
        right: dr > 0 ? ((rowCents(e) - dr) / 100).toFixed(2) + ' → ' + (rowCents(e) / 100).toFixed(2) + '（+' + (dr / 100).toFixed(2) + '）'
          : (rowCents(e) / 100).toFixed(2) + '（rating 不变）',
        sub: why.join(' · '),
      }));
      a.forEach((e, k) => { if (!b.has(k)) rows.push({ side: 'R', e, color: '#ff8a8a', right: '移出 ' + (rowCents(e) / 100).toFixed(2) }); });
    }
    const inRAll = updates.filter((u) => inRange(u.t));
    // 只看这次推分本身带来的变化（「另有 … 来自没记录到的变化」不是这次推分带来的，不算）
    const rated = (u) => { const im = impact.get(u); return !!im && (im.delta || 0) !== 0; };
    const inR = onlyRated ? inRAll.filter(rated) : inRAll;
    const hiddenN = inRAll.length - inR.length;
    const RECENT_MAX = range ? 30 : 20;
    const recent = inR.slice(-RECENT_MAX).reverse();
    const recentMore = inR.length - recent.length;
    const ROW = 34, SUBROW = 20, PB_ROW = 58;
    const colRows = (side) => rows.filter((r) => r.side === side).reduce((a, r) => a + ROW + (r.sub ? SUBROW : 0), 0);
    const changeH = Math.max(colRows('L') + (upMore ? ROW : 0), colRows('R'), ROW);
    const H = 170 + 440 + 20 + 86 + changeH + 30 + 64 + Math.max(recent.length, 1) * PB_ROW + (recentMore ? 34 : 0) + 60;
    const { cv, g } = newCanvas(H, HW);

    // 头部。Rating 按天连线：每天取当天最后一次查询的值，点放在当天中午
    g.fillStyle = '#ffffff99'; g.font = '600 20px ' + FONT;
    g.fillText('CHUNITHM  RATING  HISTORY', PAD, PAD + 22);
    g.fillStyle = '#fff'; g.font = 'bold 44px ' + FONT;
    g.fillText(fit(g, player.name || hist.name, 560), PAD, PAD + 78);
    const daily = (f) => {
      const days = new Map();
      snaps.filter((s) => f(s)).forEach((s) => {
        const d = new Date(timeMs(s.t));
        days.set(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12).getTime(), f(s));
      });
      return [...days.entries()].sort((x, y) => x[0] - y[0]);
    };
    const line = daily((s) => s.r);
    const rx = HW - PAD;
    if (range && endR != null) {
      stat(g, 'RATING', (endR / 100).toFixed(2), rx, '#ffd65a', true);
      stat(g, range.label, startR != null ? signed((endR - startR) / 100) : '-', rx - 230, '#7ee0ff');
      stat(g, '累计', allSnaps[0] ? signed(endR / 100 - allSnaps[0].r) : '-', rx - 400, '#c9a2ff');
    } else if (line.length && last) {
      const now = last.r;
      {
        const base30 = [...line].reverse().find((pt) => pt[0] <= Date.now() - 30 * 864e5) || line[0];
        stat(g, 'RATING', now.toFixed(2), rx, '#ffd65a', true);
        stat(g, '30 天', signed(now - base30[1]), rx - 230, '#7ee0ff');
        stat(g, '累计', signed(now - line[0][1]), rx - 400, '#c9a2ff');
      }
    }
    g.fillStyle = '#ffffff80'; g.font = '14px ' + FONT; g.textAlign = 'right';
    const span = range ? range.label + '（' + (sameDay ? range.from.slice(0, 10) + ' ' + range.from.slice(11) + ' – ' + range.to.slice(11)
      : range.from.slice(0, 10) + ' – ' + range.to.slice(0, 10)) + '）'
      : line.length ? line.length + ' 天的记录（' + new Date(line[0][0]).toLocaleDateString('ja-JP') + ' – ' + new Date(line[line.length - 1][0]).toLocaleDateString('ja-JP') + '）' : '';
    g.fillText(span + (hist.since ? '　·　从 ' + hist.since + ' 开始记录' : ''), rx, PAD + 122);
    g.textAlign = 'left';
    g.fillStyle = '#ffffff33'; g.fillRect(PAD, 148, HW - PAD * 2, 2);

    let y = 170;
    if (sameDay) {
      const pts = [], labels = [];
      let curR = startR;
      if (curR != null) { pts.push([0, curR / 100]); labels.push(range.from.slice(11) === '00:00' ? '0:00' : range.from.slice(11)); }
      updates.filter((u) => inRange(u.t)).forEach((u) => {
        const im = impact.get(u);
        if (!im || im.ratingAfter == null) return;
        if (curR == null) { curR = im.ratingBefore; pts.push([0, curR / 100]); labels.push('开始'); }
        if (im.ratingAfter > curR) { curR = im.ratingAfter; pts.push([pts.length, curR / 100]); labels.push(u.t.slice(11)); }
      });
      if (pts.length) {
        lineChart(g, PAD, y, HW - PAD * 2, 440, [
          { label: 'RATING（每次上涨）', color: '#ffd65a', pts, width: 4, dot: 6 },
        ], { minSpan: 0.05, fmt: (v) => v.toFixed(2), xLabels: labels });
      }
      if (pts.length <= 1) {
        g.fillStyle = '#ffffffaa'; g.font = '16px ' + FONT; g.textAlign = 'center';
        g.fillText(pts.length ? '这段时间里账号 Rating 没有上涨' : '这段时间里没有记录', HW / 2, y + 60); g.textAlign = 'left';
      }
    } else if (line.length) {
      lineChart(g, PAD, y, HW - PAD * 2, 440, [
        { label: 'RATING（每天）', color: '#ffd65a', pts: line, width: 4 },
        { label: 'BEST 30 平均', color: '#c9a2ff', pts: daily((s) => s.b30), width: 2, dot: 3 },
        { label: 'NEW 20 平均', color: '#7ee0ff', pts: daily((s) => s.n20), width: 2, dot: 3 },
      ], { minSpan: 0.2, fmt: (v) => v.toFixed(2) });
      if (line.length === 1) {
        g.fillStyle = '#ffffffaa'; g.font = '16px ' + FONT; g.textAlign = 'center';
        g.fillText('目前只有 1 天的记录，以后每天运行一次就能连成线', HW / 2, y + 60); g.textAlign = 'left';
      }
    }
    y += 460;

    // B50 变化：标题行右边写两次快照之间账号 Rating 的实际变化，以及 BEST 30 / NEW 20 各自对账号 Rating 的贡献变化
    sectionTitle(g, 'B50 变化' + (range ? '（' + range.label + '）' : hasPrev ? '（对比 ' + prev.t + '）' : ''), y, '#c9a2ff');
    if (range && startR != null && endR != null) {
      const dr = endR - startR;
      g.textAlign = 'right'; g.font = 'bold 18px ' + FONT;
      g.fillStyle = dr > 0 ? GOOD : dr < 0 ? '#ff8a8a' : '#ffffff88';
      g.fillText('账号 Rating ' + (startR / 100).toFixed(2) + ' → ' + (endR / 100).toFixed(2) + '　' + (dr > 0 ? '+' : dr < 0 ? '−' : '±') + (Math.abs(dr) / 100).toFixed(2), rx, y + 32);
      g.font = '14px ' + FONT; g.fillStyle = '#ffffff88';
      g.fillText('按推分的游玩时间统计（成绩扫描发现的推分按读取的时间）', rx, y + 56);
      g.textAlign = 'left';
    } else if (!range && hasPrev) {
      const dr = Math.round((last.r - prev.r) * 100);
      g.textAlign = 'right'; g.font = 'bold 18px ' + FONT;
      g.fillStyle = dr > 0 ? GOOD : dr < 0 ? '#ff8a8a' : '#ffffff88';
      g.fillText('账号 Rating ' + prev.r.toFixed(2) + ' → ' + last.r.toFixed(2) + '　' + (dr > 0 ? '+' : dr < 0 ? '−' : '±') + (Math.abs(dr) / 100).toFixed(2), rx, y + 32);
      const part = (s, f) => s[f].reduce((a, e) => a + rowCents(e), 0) / 50 / 100;
      const fmt = (d) => (d > 0.00005 ? '+' : d < -0.00005 ? '−' : '±') + Math.abs(d).toFixed(4);
      g.font = '14px ' + FONT; g.fillStyle = '#ffffff88';
      g.fillText('BEST 30 ' + fmt(part(last, 'best') - part(prev, 'best')) + '　·　NEW 20 ' + fmt(part(last, 'news') - part(prev, 'news')) + '（对账号 Rating 的贡献）', rx, y + 56);
      g.textAlign = 'left';
    }
    y += 86;
    const colW = (HW - PAD * 2 - 24) / 2;
    const rowText = (x, yy, r) => {
      const bw = diffBadge(g, diffOfKey(r.e[0]), x, yy);
      g.font = 'bold 15px ' + FONT;
      const rw = g.measureText(r.right).width;
      g.fillStyle = '#fff'; g.font = '16px ' + FONT;
      g.fillText(fit(g, r.e[1], colW - bw - rw - 24), x + bw + 8, yy);
      g.textAlign = 'right'; g.fillStyle = r.color; g.font = 'bold 15px ' + FONT;
      g.fillText(r.right, x + colW - 6, yy);
      if (r.sub) { g.fillStyle = '#ffffff88'; g.font = '13px ' + FONT; g.fillText(r.sub, x + colW - 6, yy + SUBROW); }
      g.textAlign = 'left';
      return ROW + (r.sub ? SUBROW : 0);
    };
    g.font = 'bold 15px ' + FONT;
    if (!range && !hasPrev) {
      g.fillStyle = '#ffffff88'; g.fillText('还没有上一次的快照可以对比', PAD, y);
    } else if (!rows.length) {
      g.fillStyle = '#ffffff88'; g.fillText(range ? '这段时间里 B50 没有变化' : '和上次相比没有变化', PAD, y);
    } else {
      let yy = y;
      rows.filter((r) => r.side === 'L').forEach((r) => { yy += rowText(PAD, yy, r); });
      if (upMore) { g.fillStyle = '#ffffff88'; g.font = '15px ' + FONT; g.fillText('另有 ' + upMore + ' 首提升', PAD, yy); }
      yy = y;
      rows.filter((r) => r.side === 'R').forEach((r) => { yy += rowText(PAD + colW + 24, yy, r); });
    }
    y += changeH;

    // 推分记录：每条两行。上行 时间 / 难度 / 曲名 / 推分内容；下行 对账号 Rating 的影响 / 单曲 Rating 的变化
    y += 6;
    sectionTitle(g, (range ? '推分（' + range.label + '，' + inR.length + ' 次）' : '最近的推分') + (onlyRated ? '　只看账号 Rating 有变化的' : ''), y, '#ffd65a');
    if (onlyRated && hiddenN) {
      g.textAlign = 'right'; g.fillStyle = '#ffffff88'; g.font = '14px ' + FONT;
      g.fillText('另有 ' + hiddenN + ' 次推分没有让账号 Rating 变化（已隐藏）', HW - PAD, y + 34);
      g.textAlign = 'left';
    }
    y += 64;
    if (!recent.length) {
      g.fillStyle = '#ffffff88'; g.font = 'bold 15px ' + FONT;
      g.fillText(onlyRated ? (range ? '这段时间里没有让账号 Rating 变化的推分' : '还没有让账号 Rating 变化的推分')
        : range ? '这段时间里没有推分' : '暂无记录。分数、FC/AJ 标记有提升时会记在这里', PAD, y);
    }
    recent.forEach((u) => {
      g.fillStyle = '#ffffff88'; g.font = '14px ' + FONT;
      g.fillText(u.t + (u.src === 'b' ? '*' : ''), PAD, y);
      const bw = diffBadge(g, u.d, PAD + 150, y);
      const what = changeText(u);
      g.font = 'bold 15px ' + FONT;
      const ww = Math.min(g.measureText(what).width, 520);
      g.fillStyle = '#fff'; g.font = '16px ' + FONT;
      g.fillText(fit(g, u.n, HW - PAD * 2 - 150 - bw - ww - 30), PAD + 150 + bw + 8, y);
      g.textAlign = 'right'; g.fillStyle = '#ffd65a'; g.font = 'bold 15px ' + FONT;
      g.fillText(fit(g, what, 520), rx, y);
      g.textAlign = 'left';
      const rw = ratingChange(g, rx, y + 24, u.before ? u.before.s : null, u.after.s, constOf(u.k, u.n, u.d, db), 14);
      const [itext, icolor] = impactText(impact.get(u));
      g.fillStyle = icolor; g.font = (icolor === GOOD ? 'bold ' : '') + '14px ' + FONT;
      g.fillText(fit(g, itext, HW - PAD * 2 - 150 - rw - 20), PAD + 150, y + 24);
      g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(PAD, y + 36, HW - PAD * 2, 1);
      y += PB_ROW;
    });
    if (recentMore) {
      g.fillStyle = '#ffffff88'; g.font = '15px ' + FONT;
      g.fillText('更早的 ' + recentMore + ' 次推分没有列出（可以把时间段选短一点）', PAD, y);
    }
    const d = new Date();
    g.fillStyle = '#ffffff66'; g.font = '13px ' + FONT;
    g.fillText(fit(g, 'Generated ' + d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate() +
      '  ·  时间后的 * = 由成绩扫描发现（时间为运行书签的时间）  ·  Rating 后的 * = 定数未公开（推定）  ·  单曲 Rating 按现在的定数计算', HW - PAD * 2), PAD, H - 20);
    return cv;
  }

  // range：同 drawTrend。曲线、推分、最近的游玩只看这段时间；BEST / 标记显示现在的
  function drawSongCurve(hist, e, s, player, db, range) {
    const inRange = (t) => !range || (t >= range.from && t <= range.to);
    const obs = hist.obs.filter((o) => o.k === e.k).sort(byTime);
    const plays = obs.filter((o) => o.src === 'p' && inRange(o.t));
    const { state, updates } = derive(hist);
    const impact = accountImpact(hist, updates, db);
    const mine = updates.filter((u) => u.k === e.k && inRange(u.t)).reverse().slice(0, 12);
    const cur = state[e.k];
    // 个人最佳的阶梯线：从这段时间开始时的最佳画起
    const pbPts = [];
    let best = -1;
    obs.forEach((o) => {
      if (o.s <= best) return;
      best = o.s;
      if (range && o.t < range.from) pbPts[0] = [timeMs(range.from), o.s];
      else if (inRange(o.t)) pbPts.push([timeMs(o.t), o.s]);
    });
    const rows = plays.slice(-15).reverse();
    const ROW = 32, UROW = 58;
    const H = 190 + 420 + 20 + 64 + Math.max(mine.length, 1) * UROW + 20 + 64 + Math.max(rows.length, 1) * ROW + 50;
    const { cv, g } = newCanvas(H, HW);
    const cInfo = { c: s.constant || 0, est: !!s.estimated };

    const J = 120;
    if (s.img) { g.save(); round(g, PAD, PAD, J, J, 10); g.clip(); g.drawImage(s.img, PAD, PAD, J, J); g.restore(); }
    const tx = s.img ? PAD + J + 20 : PAD;
    g.fillStyle = '#ffffff99'; g.font = '600 18px ' + FONT;
    g.fillText('CHUNITHM  SCORE HISTORY  ·  ' + (player.name || hist.name), tx, PAD + 20);
    g.fillStyle = '#fff'; g.font = 'bold 38px ' + FONT;
    g.fillText(fit(g, e.n, HW - tx - 300), tx, PAD + 68);
    let px = tx + diffBadge(g, e.d, tx, PAD + 106, s.constant ? s.constant.toFixed(1) + (s.estimated ? '*' : '') : '') + 8;
    if (cur && cur.l) px += pill(g, cur.l, px, PAD + 106, LAMP_COLOR[cur.l]) + 6;
    const rx = HW - PAD;
    stat(g, 'BEST', best > 0 ? best.toLocaleString('en-US') : '-', rx, '#ffd65a', true);
    g.fillStyle = '#ffffff80'; g.font = '14px ' + FONT; g.textAlign = 'right';
    g.fillText([best > 0 ? scoreRank(best) : '', cInfo.c && best > 0 ? '单曲 Rating ' + (centsOf(best, cInfo.c) / 100).toFixed(2) : '',
      (range ? range.label + ' ' : '记录到 ') + plays.length + ' 次游玩'].filter(Boolean).join('　·　'), rx, PAD + 122);
    g.textAlign = 'left';
    g.fillStyle = '#ffffff33'; g.fillRect(PAD, 168, HW - PAD * 2, 2);

    let y = 190;
    // 曲线图只画 AAA（950,000）以上的成绩，更低的不画（会把纵轴拉得很长），但推分记录、最近的游玩、游玩次数照常统计
    const CHART_MIN = 950000;
    const shownPlays = plays.filter((o) => o.s >= CHART_MIN);
    const shownPb = pbPts.filter((pt) => pt[1] >= CHART_MIN);
    if (!shownPlays.length && !shownPb.length) {
      g.fillStyle = 'rgba(255,255,255,0.05)'; round(g, PAD, y, HW - PAD * 2, 400, 12); g.fill();
      g.fillStyle = '#ffffff88'; g.font = '16px ' + FONT; g.textAlign = 'center';
      g.fillText('还没有 AAA（950,000）以上的成绩，曲线图只画 AAA 以上的成绩', HW / 2, y + 200);
      g.textAlign = 'left';
    } else {
      lineChart(g, PAD, y, HW - PAD * 2, 400, [
        // 画出来的游玩不到 2 次时没有「变化」可画，不画个人最佳的线（否则会从成绩扫描的点连出一条线）
        ...(shownPlays.length >= 2 ? [{ label: '个人最佳', color: '#ffd65a', pts: shownPb, step: true, dots: false, width: 3 }] : []),
        { label: '每次游玩（AAA 以上）', color: '#7ee0ff', pts: shownPlays.map((o) => [timeMs(o.t), o.s]), line: false, dot: 5 },
      ], {
        minSpan: 4000, maxV: 1010000, fmt: (v) => Math.round(v).toLocaleString('en-US'),
        refs: [{ v: 1009000, label: 'SSS+' }, { v: 1007500, label: 'SSS' }, { v: 1005000, label: 'SS+' }, { v: 1000000, label: 'SS' }, { v: 975000, label: 'S' }],
      });
    }
    y += 420;

    // 这首歌的推分记录（分数、标记）
    sectionTitle(g, '推分记录', y, '#ffd65a');
    y += 64;
    if (!mine.length) {
      g.fillStyle = '#ffffff88'; g.font = 'bold 15px ' + FONT;
      g.fillText(range ? '这段时间里没有这首歌的推分' : '还没有这首歌的推分记录', PAD, y);
    }
    mine.forEach((u) => {
      g.fillStyle = '#ffffff99'; g.font = '15px ' + FONT;
      g.fillText(u.t + (u.src === 'b' ? '*' : ''), PAD, y);
      g.fillStyle = '#ffd65a'; g.font = 'bold 16px ' + FONT;
      g.fillText(fit(g, changeText(u), HW - PAD * 2 - 180), PAD + 170, y);
      const rw = ratingChange(g, rx, y + 24, u.before ? u.before.s : null, u.after.s, cInfo, 14);
      const [itext, icolor] = impactText(impact.get(u));
      g.fillStyle = icolor; g.font = (icolor === GOOD ? 'bold ' : '') + '14px ' + FONT;
      g.fillText(fit(g, itext, HW - PAD * 2 - 170 - rw - 20), PAD + 170, y + 24);
      g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(PAD, y + 36, HW - PAD * 2, 1);
      y += UROW;
    });
    y += 20;

    sectionTitle(g, '最近的游玩', y, '#7ee0ff');
    y += 64;
    if (!rows.length) {
      g.fillStyle = '#ffffff88'; g.font = 'bold 15px ' + FONT;
      g.fillText(range ? '这段时间里没有这首歌的游玩记录' : '还没有这首歌的プレイ履歴记录（只有成绩扫描的数据）', PAD, y);
    }
    // 计算每次游玩时的历史最佳，用于显示「刷新了多少」
    const pbAt = new Map();
    let runBest = -1;
    obs.forEach((o) => { if (o.src === 'p') pbAt.set(o, runBest); if (o.s > runBest) runBest = o.s; });
    rows.forEach((o) => {
      g.fillStyle = '#ffffff99'; g.font = '15px ' + FONT;
      g.fillText(o.t, PAD, y);
      g.fillStyle = '#fff'; g.font = 'bold 18px ' + FONT;
      g.fillText(o.s.toLocaleString('en-US'), PAD + 200, y);
      g.fillStyle = '#ffd65a'; g.font = 'bold 15px ' + FONT;
      g.fillText(scoreRank(o.s), PAD + 330, y);
      // 这次游玩的标记（プレイ履歴里读得到时）
      let bx = PAD + 390;
      if (o.l) bx += pill(g, o.l, bx, y, LAMP_COLOR[o.l]) + 4;
      const nx = Math.max(bx + 8, PAD + 450);
      const before = pbAt.get(o);
      const isPB = (before >= 0 && o.s > before) || (before < 0 && o.nr);
      g.font = 'bold 15px ' + FONT;
      if (before >= 0 && o.s > before) { g.fillStyle = GOOD; g.fillText('NEW RECORD  +' + (o.s - before).toLocaleString('en-US'), nx, y); }
      else if (before < 0 && o.nr) { g.fillStyle = GOOD; g.fillText('NEW RECORD', nx, y); }
      else if (before >= 0) { g.fillStyle = '#ffffff66'; g.font = '14px ' + FONT; g.fillText('距最佳 −' + (before - o.s).toLocaleString('en-US'), nx, y); }
      // 单曲 Rating：刷新最佳时显示变化，其他游玩用灰色显示这次分数对应的 Rating
      if (isPB) ratingChange(g, rx, y, before >= 0 ? before : null, o.s, cInfo, 15);
      else if (cInfo.c) {
        g.textAlign = 'right'; g.fillStyle = '#ffffff66'; g.font = '14px ' + FONT;
        g.fillText('Rating ' + (centsOf(o.s, cInfo.c) / 100).toFixed(2), rx, y);
        g.textAlign = 'left';
      }
      y += ROW;
    });
    const d = new Date();
    g.fillStyle = '#ffffff66'; g.font = '13px ' + FONT;
    g.fillText('Generated ' + d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate() + '  ·  data: CHUNITHM-NET プレイ履歴 / 成绩扫描  ·  * = 由成绩扫描发现', PAD, H - 20);
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

  // 逐张绘制 → 导出为 PNG Blob → 立即释放 canvas，避免 iOS 的 canvas 总内存上限。
  // 画到 target 里（整页时 target = box；历史走势页里是页面中的一块区域）。
  //   opts.progress(text)：进度提示；opts.back：{label, fn} 左下的返回按钮；opts.inline：显示在页面里（提示文字简短，不显示同步状态）
  async function renderImages(target, drawers, name, opts) {
    opts = opts || {};
    const progress = opts.progress || ((t) => { target.textContent = t; });
    const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    (target._urls || []).forEach((u) => URL.revokeObjectURL(u)); // 同一块区域重新生成时，释放上一次的图片
    target._urls = [];
    const results = [];
    let tainted = false;
    for (let i = 0; i < drawers.length; i++) {
      if (aborted) return;
      progress('正在绘制图片…' + (drawers.length > 1 ? ' ' + (i + 1) + '/' + drawers.length : ''));
      await new Promise((r) => setTimeout(r, 30));
      const cv = drawers[i]();
      let blob = null;
      try {
        blob = await new Promise((res, rej) => { try { cv.toBlob(res, 'image/png'); } catch (e) { rej(e); } });
      } catch (e) { tainted = true; }
      if (blob) {
        cv.width = cv.height = 0;
        const fname = name + (drawers.length > 1 ? '-' + (i + 1) : '') + '.png';
        const url = URL.createObjectURL(blob);
        target._urls.push(url);
        results.push({ blob, url, file: new File([blob], fname, { type: 'image/png' }), fname });
      } else {
        results.push({ canvas: cv });
      }
    }

    target.innerHTML = '';
    const tip = document.createElement('div');
    tip.style.cssText = opts.inline ? 'margin:0 0 4px;font-size:13px;color:#ffffffaa;text-align:center;'
      : 'margin:8px 0 4px;padding:0 44px;font-size:14px;color:#ffffffcc;';
    const top = document.createElement('div');
    top.style.cssText = opts.inline ? 'margin:0 0 8px;text-align:center;' : 'margin:0 0 12px;';
    target.append(tip, top);
    const small = opts.inline ? 'padding:6px 16px;font-size:14px;margin:4px;' : 'padding:8px 20px;';

    const files = results.filter((r) => r.file).map((r) => r.file);
    let canShare = false;
    try { canShare = files.length > 0 && !!navigator.canShare && navigator.canShare({ files }); } catch (e) { canShare = false; }
    if (canShare) {
      // iOS：分享面板里选「存储图像」即可直接存进相册
      const sb = document.createElement('button');
      sb.textContent = isIOS ? '保存到相册 / 分享' : '分享';
      sb.style.cssText = btnCss + 'background:#7ee0ff;color:#222;' + small;
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
      a.style.cssText = btnCss + 'background:#ffd65a;color:#222;text-decoration:none;' + small;
      top.appendChild(a);
    });
    if (opts.back) {
      const back = document.createElement('button');
      back.textContent = opts.back.label;
      back.style.cssText = btnCss + 'background:#ffffff22;color:#fff;' + small;
      back.onclick = opts.back.fn;
      top.appendChild(back);
    }

    results.forEach((r) => {
      if (r.url) {
        const img = document.createElement('img');
        img.src = r.url;
        img.alt = r.fname;
        // 允许 iOS 长按弹出「存储到照片」
        img.style.cssText = 'display:block;width:100%;height:auto;border-radius:8px;margin-bottom:16px;' +
          '-webkit-touch-callout:default;-webkit-user-select:auto;user-select:auto;';
        target.appendChild(img);
      } else {
        r.canvas.style.cssText = 'display:block;width:100%;height:auto;margin-bottom:16px;';
        target.appendChild(r.canvas);
      }
    });

    const many = results.length > 1 ? '（共 ' + results.length + ' 张）' : '';
    if (tainted) tip.textContent = '图片已生成，但浏览器不允许导出（曲绘跨域），请截图保存。';
    else if (opts.inline) tip.textContent = isIOS ? '长按图片 →「存储到照片」' : '可以下载，手机也可以长按图片保存';
    else if (isIOS) {
      tip.textContent = '生成完成' + many + '！' + (canShare ? '点「保存到相册」后选「存储图像」，或' : '') +
        '长按图片 →「存储到照片」。「下载 PNG」会存到「文件」App。';
    }
    else tip.textContent = '生成完成' + many + '！点「下载 PNG」，手机也可以长按图片保存。';
    if (syncNote && !opts.inline) {
      const sn = document.createElement('div');
      sn.style.cssText = 'margin-top:4px;font-size:13px;color:' + (/失败|不足/.test(syncNote) ? '#ff8a8a' : '#ffffff88') + ';';
      sn.textContent = syncNote;
      tip.appendChild(sn);
    }
  }

  // 整页显示（B50、定数筛选）
  function showResult(drawers, name, back) {
    return renderImages(box, drawers, name, { progress: say, back: back || { label: '返回菜单', fn: showMenu } });
  }
  // 打开书签：先把数据全部读好，再显示菜单
  start();
})();
