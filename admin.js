/* Eli's World — back office for the eli team (orders, rewards, members, coins, team).
   Static page + the Supabase project of the app (config.js = { url, key }). Every action is checked again on the server
   (eli_app/backend/supabase/migrations/…_admin.sql): only accounts listed as admins get any data. */
const CFG = window.ELI_ADMIN || {};
const sb = supabase.createClient(CFG.url, CFG.key, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'eli_admin_auth' } });

/* ── helpers ── */
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => Number(n || 0).toLocaleString('en-US');
const compact = n => n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K' : fmt(n);
const dTH = d => new Date(d).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
const dyTH = d => new Date(d).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });
const dtTH = d => new Date(d).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const daysAgo = d => { if (!d) return '—'; const n = Math.round((new Date(new Date().toDateString()) - new Date(d + 'T00:00:00')) / 864e5); return n <= 0 ? 'วันนี้' : n === 1 ? 'เมื่อวาน' : `${n} วันก่อน`; };
const avatar = a => /^(data:image\/|https:\/\/)/.test(a || '') ? a : 'assets/w_avatar.webp';
const pimg = img => /^https?:\/\//.test(img || '') ? img : `assets/products/${img}.webp`;
const coin = '<i class="coin-ic" aria-hidden="true"></i>';
const ageOf = b => { if (!b) return null; const d = new Date(b), n = new Date(); let a = n.getFullYear() - d.getFullYear(); if (n < new Date(n.getFullYear(), d.getMonth(), d.getDate())) a--; return a; };

const MSG = [
  [/invalid login credentials/i, 'อีเมลหรือรหัสผ่านไม่ถูกต้อง'], [/forbidden/, 'บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้'],
  [/need_reason/, 'ใส่เหตุผลอย่างน้อย 3 ตัวอักษร'], [/bad_amount/, 'จำนวนเหรียญไม่ถูกต้อง'], [/not_enough_coins/, 'สมาชิกมีเหรียญไม่พอให้หัก'],
  [/order_cancelled/, 'คำสั่งนี้ยกเลิกไปแล้ว เปลี่ยนสถานะไม่ได้'], [/bad_step/, 'เปลี่ยนสถานะแบบนี้ไม่ได้ (ส่งถึงแล้วยกเลิกไม่ได้)'], [/no_account/, 'ไม่พบบัญชีที่ใช้อีเมลนี้ (ให้เขาสมัครในแอปก่อน)'],
  [/not_yourself/, 'ลบสิทธิ์ของตัวเองไม่ได้'], [/duplicate key/, 'รหัสนี้มีอยู่แล้ว'], [/violates foreign key/, 'ยังมีข้อมูลอื่นอ้างถึงอยู่'],
  [/row-level security|permission denied/i, 'บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้'], [/payload too large|exceeded the maximum/i, 'รูปใหญ่เกิน 2 MB'],
  [/mfa_required/, 'ทีมบังคับยืนยัน 2 ขั้น — ออกจากระบบแล้วเข้าใหม่ด้วยรหัส 6 หลัก'], [/mfa_first/, 'เปิดยืนยัน 2 ขั้นของคุณเองก่อน (หน้า "ทีมงาน") แล้วเข้าระบบใหม่'],
  [/is_admin/, 'ทำกับบัญชีของทีมหลังบ้านไม่ได้'], [/digital_order/, 'คำสั่งคูปองดิจิทัลเปลี่ยนสถานะไม่ได้'], [/bad_value/, 'ค่าที่ใส่อยู่นอกช่วงที่อนุญาต'],
  [/too_many/, 'มากเกินไปในครั้งเดียว'], [/last_owner/, 'ทีมต้องมีเจ้าของอย่างน้อย 1 คน'], [/no_factor/, 'คนนี้ยังไม่ได้ตั้งค่ายืนยัน 2 ขั้น'],
  [/coupon_codes/, 'ของรางวัลนี้มีโค้ดคูปองผูกอยู่ — ปิด "แสดงในแอป" แทนการลบ'], [/no_member/, 'ไม่พบสมาชิกคนนี้'], [/no_product/, 'ไม่พบของรางวัลนี้'],
  [/failed to fetch|network/i, 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองใหม่อีกครั้ง'],
];
const thai = e => { const m = String(e?.message || e || ''); if (/[฀-๿]/.test(m)) return m; return (MSG.find(([re]) => re.test(m)) || [0, 'มีบางอย่างผิดพลาด: ' + m.slice(0, 80)])[1]; };
const rpc = async (fn, args) => { const { data, error } = await sb.rpc(fn, args); if (error) throw error; return data; };
const toast = (m, bad) => { const t = document.createElement('div'); t.className = 'toast' + (bad ? ' bad' : ''); t.textContent = m; $('#toasts').append(t); setTimeout(() => t.remove(), 3600); };
const oops = e => { console.error(e); toast(thai(e), true); };
const busyBtn = async (b, job) => { if (b.disabled) return; const h = b.innerHTML; b.disabled = true; b.innerHTML = '<i class="spin"></i>'; try { return await job(); } catch (e) { oops(e); } finally { b.disabled = false; b.innerHTML = h; } };

const STATUS = {
  new: ['รอจัดส่ง', '<svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 5v5.4l3.5 2.1-1 1.7L11 13.5V7z"/></svg>'],
  shipping: ['กำลังจัดส่ง', '<svg viewBox="0 0 24 24"><path d="M3 5h11v9h1.6l1.4-4H21l2 4v4h-2a3 3 0 0 1-6 0H9a3 3 0 0 1-6 0H1V7a2 2 0 0 1 2-2zm3 12a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm12 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"/></svg>'],
  done: ['ส่งถึงแล้ว', '<svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1.5 14.2-4.2-4.2 1.4-1.4 2.8 2.8 5.8-5.8 1.4 1.4z"/></svg>'],
  cancelled: ['ยกเลิก', '<svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm4.2 12.8-1.4 1.4L12 13.4l-2.8 2.8-1.4-1.4 2.8-2.8-2.8-2.8 1.4-1.4 2.8 2.8 2.8-2.8 1.4 1.4-2.8 2.8z"/></svg>'],
};
const stChip = s => `<span class="st ${s}">${STATUS[s][1]}${STATUS[s][0]}</span>`;
const REASON = { quest: 'เควสต์ประจำวัน', walk: 'เดินครบ 7,000 ก้าว', sleep: 'นอน 7–9 ชม.', garden: 'เหรียญในสวน', chest: 'Dream Chest', run: 'วิ่ง', level: 'โบนัสเลเวล', shield: 'Streak Shield', redeem: 'แลกของรางวัล', refund: 'คืนเหรียญ (ยกเลิก)', admin: 'แอดมินปรับ' };

/* ── drawer, modal, confirm ── */
const drawer = html => { $('#drawerIn').innerHTML = html; $('#drawer').classList.add('on'); $('#drawer').setAttribute('aria-hidden', 'false'); $('#scrim').classList.add('on'); $('#drawer').scrollTop = 0; $$('[data-x]', $('#drawer')).forEach(b => b.onclick = closeDrawer); return $('#drawerIn'); };
const closeDrawer = () => { $('#drawer').classList.remove('on'); $('#drawer').setAttribute('aria-hidden', 'true'); $('#scrim').classList.remove('on'); };
const modal = html => { $('#modalIn').innerHTML = html; $('#modal').hidden = false; $$('[data-x]', $('#modal')).forEach(b => b.onclick = closeModal); setTimeout(() => $('#modalIn input:not([type=checkbox]):not([type=file]), #modalIn textarea')?.focus(), 50); return $('#modalIn'); };
const closeModal = () => { $('#modal').hidden = true; $('#modalIn').innerHTML = ''; };
const confirmBox = (title, body, ok = 'ยืนยัน', danger = false) => new Promise(res => {
  const m = modal(`<h3>${esc(title)}</h3><p class="sub">${body}</p><div class="acts"><button class="btn ghost" data-no>กลับ</button><button class="btn ${danger ? 'danger' : 'pri'}" data-ok>${esc(ok)}</button></div>`);
  $('[data-no]', m).onclick = () => { closeModal(); res(false); }; $('[data-ok]', m).onclick = () => { closeModal(); res(true); };
});
const askForm = (title, sub, fields, ok = 'ยืนยัน', danger = false) => new Promise(res => {
  const m = modal(`<h3>${esc(title)}</h3><p class="sub">${sub}</p><form id="af">${fields.map(f => `<label class="fld"><span>${esc(f.label)}</span><input name="${f.name}" type="${f.type || 'text'}" ${f.min != null ? `min="${f.min}"` : ''} ${f.max != null ? `max="${f.max}"` : ''} maxlength="${f.maxlength || 200}" value="${esc(f.value ?? '')}" placeholder="${esc(f.placeholder || '')}" required></label>`).join('')}
    <div class="acts"><button type="button" class="btn ghost" data-no>กลับ</button><button class="btn ${danger ? 'danger' : 'pri'}" type="submit">${esc(ok)}</button></div></form>`);
  $('[data-no]', m).onclick = () => { closeModal(); res(null); };
  $('#af', m).onsubmit = e => { e.preventDefault(); const v = Object.fromEntries(fields.map(f => [f.name, e.target[f.name].value.trim()])); closeModal(); res(v); };
});
$('#scrim').onclick = closeDrawer;
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
addEventListener('keydown', e => { if (e.key === 'Escape') { if (!$('#modal').hidden) closeModal(); else closeDrawer(); } });

/* ── a bar chart (one series, brand indigo; today in gold, it isn't over yet) with hover/focus tooltips and a table view ── */
function barChart(host, rows, { name, unit }) {
  const tip = $('#tip'), today = rows.length - 1;
  const step = m => { const p = 10 ** Math.floor(Math.log10(m || 1)); return [1, 2, 5, 10].map(k => k * p).find(s => m / s <= 4) || p * 10; };
  const draw = () => {
    const W = Math.max(280, host.clientWidth), H = 220, L = 34, B = 26, T = 22, n = rows.length, vals = rows.map(r => r.v);
    const max = Math.max(1, ...vals), st = step(max), top = Math.ceil(max / st) * st, band = (W - L) / n, bw = Math.min(24, band * .62);
    const y = v => T + (H - T - B) * (1 - v / top), every = band < 30 ? Math.ceil(30 / band) : 1, pk = vals.indexOf(max), peak = Math.abs(pk - today) * band < 44 && pk !== today ? -1 : pk;   // no label right beside today's
    let s = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="${esc(name)}">`;
    for (let v = 0; v <= top; v += st) s += `<line class="gl" x1="${L}" x2="${W}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${compact(v)}</text>`;
    rows.forEach((r, i) => {
      const cx = L + band * i + band / 2, x = cx - bw / 2, yy = y(r.v), h = H - B - yy, rr = Math.min(4, h);
      const path = h > 0 ? `M${x},${H - B} V${yy + rr} Q${x},${yy} ${x + rr},${yy} H${x + bw - rr} Q${x + bw},${yy} ${x + bw},${yy + rr} V${H - B} Z` : '';
      s += `<g data-i="${i}" tabindex="0" aria-label="${esc(r.label)} ${r.v} ${esc(unit)}">${path ? `<path class="bar ${i === today ? 'today' : ''}" d="${path}"/>` : ''}
        <rect class="hit" x="${L + band * i}" y="${T}" width="${band}" height="${H - T - B + 4}"/>
        ${i === peak || i === today ? `<text class="vl" x="${cx}" y="${yy - 6}" text-anchor="middle">${fmt(r.v)}</text>` : ''}
        ${i % every === (n - 1) % every ? `<text class="ax" x="${cx}" y="${H - 6}" text-anchor="middle">${esc(r.short)}</text>` : ''}</g>`;
    });
    host.innerHTML = s + '</svg>';
    $$('g[data-i]', host).forEach(g => {
      const r = rows[g.dataset.i], show = () => { $$('g.on', host).forEach(x => x.classList.remove('on')); g.classList.add('on'); tip.innerHTML = `<b>${fmt(r.v)} ${esc(unit)}</b>${esc(r.label)}${+g.dataset.i === today ? ' · ยังไม่จบวัน' : ''}`; tip.hidden = false; const b = g.getBoundingClientRect(); place(b.left + b.width / 2, b.top); };
      const place = (x, yy) => { tip.style.left = Math.min(innerWidth - tip.offsetWidth - 8, Math.max(8, x - tip.offsetWidth / 2)) + 'px'; tip.style.top = Math.max(8, yy - tip.offsetHeight - 10) + 'px'; };
      g.addEventListener('pointerenter', show); g.addEventListener('focus', show);
      g.addEventListener('pointerleave', () => { g.classList.remove('on'); tip.hidden = true; }); g.addEventListener('blur', () => { g.classList.remove('on'); tip.hidden = true; });
    });
  };
  draw(); new ResizeObserver(draw).observe(host);
}

/* ── session ── */
let ME = null;
const showLogin = msg => { $('#shell').hidden = true; $('#login').hidden = false; $('#loginErr').textContent = msg || ''; };
async function start() {
  if (!CFG.url || !CFG.key) return showLogin('ยังไม่ได้ตั้งค่า config.js (URL และ key ของโปรเจกต์)');
  const { data } = await sb.auth.getSession();
  if (!data.session) return showLogin();
  try { ME = await rpc('admin_me'); } catch (e) { return showLogin(thai(e)); }
  if (!ME?.admin) { await sb.auth.signOut(); return showLogin('บัญชีนี้ไม่มีสิทธิ์เข้าหลังบ้าน'); }
  if (!(await mfaGate())) return;   // admin2.js: the 6-digit code, or setting it up when the team requires it
  ME = await rpc('admin_me');
  if (ME.mfa_required && !ME.mfa_ok) { await sb.auth.signOut(); return showLogin('ยืนยัน 2 ขั้นของคุณรอเจ้าของอนุมัติที่หน้า "ทีมงาน" ก่อนเข้าใช้'); }
  $('#login').hidden = true; $('#shell').hidden = false;
  $('#me').innerHTML = `<b title="${esc(ME.email)}">${esc(ME.email)}</b><div class="row"><span class="chip ${ME.role === 'owner' ? 'owner' : ''}">${ME.role === 'owner' ? 'เจ้าของ' : 'ทีมงาน'}</span><button class="btn ghost sm" id="out">ออกจากระบบ</button></div>`;
  $('#out').onclick = async () => { await sb.auth.signOut(); location.hash = ''; location.reload(); };
  route(); refreshBadge(); setInterval(refreshBadge, 60000);
}
$('#loginForm').onsubmit = async e => {
  e.preventDefault(); const f = e.target, b = $('button', f);
  await busyBtn(b, async () => {
    const { error } = await sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
    if (error) { $('#loginErr').textContent = thai(error); return; }
    f.password.value = ''; await start();
  });
};
$('#forgot').onclick = async e => {   // the reset link opens the account page (CFG.accountUrl), the same one members use
  const email = $('#loginForm').email.value.trim();
  if (!/^\S+@\S+\.\S+$/.test(email)) { $('#loginErr').textContent = 'กรอกอีเมลก่อน แล้วกด "ลืมรหัสผ่าน?" อีกครั้ง'; return $('#loginForm').email.focus(); }
  await busyBtn(e.currentTarget, async () => {
    const { error } = await sb.auth.resetPasswordForEmail(email, CFG.accountUrl ? { redirectTo: CFG.accountUrl } : {});
    if (error) throw error;
    $('#loginErr').textContent = ''; toast(`ส่งลิงก์ตั้งรหัสผ่านใหม่ไปที่ ${email} แล้ว`);
  });
};
const refreshBadge = async () => {
  try { const s = await rpc('admin_orders', { p_status: 'new', p_limit: 1 }); const n = s.counts?.new || 0; $('#navNew').textContent = n; $('#navNew').hidden = !n; } catch (e) {}
  try { const n = (await rpc('admin_reports', { p_status: 'open', p_limit: 1 })).open || 0; $('#navRep').textContent = n; $('#navRep').hidden = !n; } catch (e) {}
};

/* ── router ── */
const PAGES = {};
let curPage = null;
async function route() {
  const p = (location.hash.slice(1) || 'overview').split('/')[0], page = PAGES[p] ? p : 'overview';
  $$('#nav a').forEach(a => a.classList.toggle('on', a.dataset.p === page));
  if (page !== curPage) { $('#page').innerHTML = ''; $('#topR').innerHTML = ''; scrollTo(0, 0); }
  curPage = page; closeDrawer();
  $('#title').textContent = PAGES[page].title;
  $('#page').classList.add('busy');
  try { await PAGES[page].render($('#page')); } catch (e) { oops(e); $('#page').innerHTML = `<div class="card empty">โหลดข้อมูลไม่สำเร็จ · ${esc(thai(e))}</div>`; }
  $('#page').classList.remove('busy');
}
addEventListener('hashchange', () => ME && route());

/* ═══════ ภาพรวม ═══════ */
PAGES.overview = {
  title: 'ภาพรวม',
  async render(pg) {
    const [s, o] = await Promise.all([rpc('admin_stats', { p_days: 14 }), rpc('admin_orders', { p_status: 'new', p_limit: 5 })]);
    const pct = s.members ? Math.round(s.active_today / s.members * 100) : 0;
    $('#topR').innerHTML = `${s.event ? `<a class="chip owner" href="#news">🎉 ${esc(s.event.name)} · เหรียญ ×${+s.event.mult}</a>` : ''}<span class="chip">ข้อมูลวันที่ ${dyTH(s.today)}</span><button class="btn sm" id="reload"><svg viewBox="0 0 24 24"><path d="M17.6 6.4A8 8 0 1 0 20 12h-2a6 6 0 1 1-1.8-4.3L13 11h7V4z"/></svg>รีเฟรช</button>`;
    $('#reload').onclick = route;
    pg.innerHTML = `<div class="tiles">
        <div class="tile hero"><div class="lb">สมาชิกทั้งหมด</div><div class="v num">${fmt(s.members)}</div><div class="d">+${fmt(s.new_7d)} คนใน 7 วันที่ผ่านมา</div></div>
        <div class="tile"><div class="lb">เข้าแอปวันนี้</div><div class="v num">${fmt(s.active_today)} <small>คน</small></div><div class="d">${pct}% ของสมาชิก · 7 วัน ${fmt(s.active_7d)} คน</div></div>
        <div class="tile"><div class="lb">คำสั่งแลกรอจัดส่ง</div><div class="v num"><a href="#orders">${fmt(s.orders_new)}</a></div><div class="d">กำลังจัดส่ง ${fmt(s.orders_shipping)} รายการ</div></div>
        <div class="tile"><div class="lb">เหรียญที่แจกไป · 30 วัน</div><div class="v num">${fmt(s.coins_out_30d)}</div><div class="d">ใช้แลกของไป ${fmt(s.coins_spent_30d)}</div></div>
        <div class="tile"><div class="lb">เหรียญที่สมาชิกถืออยู่</div><div class="v num">${compact(s.coins_held)}</div><div class="d">ยอดรวมทุกบัญชีตอนนี้</div></div>
        <div class="tile"><div class="lb">ระยะวิ่ง · 7 วัน</div><div class="v num">${fmt(s.km_7d)} <small>กม.</small></div><div class="d">${fmt(s.runs_7d)} ครั้ง</div></div>
      </div>
      <div class="cols">
        <div class="stack">
          <section class="card"><h2>คนเข้าแอปต่อวัน <small>14 วันล่าสุด</small></h2><div class="chart" id="ch"></div>
            <div class="key"><span><i style="background:var(--wi)"></i>จำนวนคนที่เปิดแอปในวันนั้น</span><span><i style="background:var(--gold)"></i>วันนี้ (ยังไม่จบวัน)</span><button class="btn ghost sm" id="tblT" style="margin-left:auto">ดูเป็นตาราง</button></div>
            <div id="tbl" hidden></div></section>
          <section class="card"><h2>รอจัดส่ง <a class="btn sm" href="#orders">ดูทั้งหมด</a></h2>
            ${o.rows.length ? o.rows.map(r => `<div class="li" data-code="${esc(r.code)}" style="cursor:pointer"><img class="thumb" src="${esc(pimg(r.items[0]?.img))}" alt=""><div class="grow"><div class="t1">${esc(r.items.map(i => i.name).join(', '))}</div><div class="t2">${esc(r.code)} · ${esc(r.member)} · ${dtTH(r.created_at)}</div></div>${r.ship_address ? '' : '<span class="chip">ยังไม่กรอกที่อยู่</span>'}</div>`).join('') : '<div class="empty">ไม่มีคำสั่งรอจัดส่ง 🎉</div>'}
          </section>
        </div>
        <div class="stack">
          <section class="card"><h2>Life Power สูงสุด</h2>
            ${s.top.map((m, i) => `<div class="li" data-mid="${esc(m.id)}" style="cursor:pointer"><span class="rank">${i + 1}</span><img class="av" src="${esc(avatar(m.avatar))}" alt=""><div class="grow"><div class="t1">${esc(m.name)}</div><div class="t2">ID ${esc(m.citizen_id)} · Streak ${fmt(m.streak)} วัน</div></div><b class="num">${fmt(m.total_lp)}</b></div>`).join('') || '<div class="empty">ยังไม่มีสมาชิก</div>'}
          </section>
          <section class="card"><h2>สต็อกใกล้หมด <a class="btn sm" href="#products">จัดการ</a></h2>
            ${s.stock_low.length ? s.stock_low.map(p => `<div class="li"><div class="grow"><div class="t1">${esc(p.name)}</div></div><span class="st ${p.stock ? 'new' : 'cancelled'}">${p.stock ? `${STATUS.new[1]}เหลือ ${p.stock}` : `${STATUS.cancelled[1]}หมดแล้ว`}</span></div>`).join('') : '<div class="empty">สต็อกยังพอทุกชิ้น</div>'}
          </section>
        </div>
      </div>`;
    const rows = s.daily.map(d => ({ v: d.active, label: new Date(d.day).toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short' }), short: String(new Date(d.day).getDate()) }));
    barChart($('#ch', pg), rows, { name: 'คนเข้าแอปต่อวัน', unit: 'คน' });
    $('#tblT', pg).onclick = e => { const t = $('#tbl', pg); t.hidden = !t.hidden; e.target.textContent = t.hidden ? 'ดูเป็นตาราง' : 'ซ่อนตาราง';
      t.innerHTML = `<div class="tbl-wrap" style="box-shadow:none;margin-top:10px"><table class="tbl"><thead><tr><th>วันที่</th><th class="r">เข้าแอป</th><th class="r">สมัครใหม่</th></tr></thead><tbody>${s.daily.slice().reverse().map(d => `<tr style="cursor:default"><td>${dyTH(d.day)}</td><td class="r num">${fmt(d.active)}</td><td class="r num">${fmt(d.new)}</td></tr>`).join('')}</tbody></table></div>`; };
    $$('[data-code]', pg).forEach(r => r.onclick = () => openOrder(o.rows.find(x => x.code === r.dataset.code)));
    $$('[data-mid]', pg).forEach(r => r.onclick = () => openMember(r.dataset.mid));
  },
};

/* ═══════ คำสั่งแลก ═══════ */
const OQ = { status: 'new', q: '', offset: 0 }, PAGE = 30;
PAGES.orders = {
  title: 'คำสั่งแลกของรางวัล',
  async render(pg) {
    const r = await rpc('admin_orders', { p_status: OQ.status, p_q: OQ.q, p_limit: PAGE, p_offset: OQ.offset });
    const c = r.counts || {}, all = Object.values(c).reduce((a, b) => a + b, 0);
    $('#topR').innerHTML = `<button class="btn sm" id="prAll"><svg viewBox="0 0 24 24"><path d="M6 3h12v5H6zM4 9h16a2 2 0 0 1 2 2v6h-4v4H6v-4H2v-6a2 2 0 0 1 2-2zm4 7v3h8v-3z"/></svg>พิมพ์ใบปะหน้า</button><button class="btn sm" id="csv"><svg viewBox="0 0 24 24"><path d="M12 3v10.2l3.6-3.6L17 11l-5 5-5-5 1.4-1.4 3.6 3.6V3zM5 19h14v2H5z"/></svg>ดาวน์โหลด CSV</button>`;
    $('#csv').onclick = e => busyBtn(e.currentTarget, exportOrders);
    $('#prAll').onclick = e => busyBtn(e.currentTarget, async () => printLabels((await rpc('admin_orders', { p_status: OQ.status, p_q: OQ.q, p_limit: 200 })).rows));
    pg.innerHTML = `<div class="bar"><div class="seg" id="seg">${[['new', 'รอจัดส่ง'], ['shipping', 'กำลังจัดส่ง'], ['done', 'ส่งถึงแล้ว'], ['cancelled', 'ยกเลิก'], ['', 'ทั้งหมด']].map(([k, n]) => `<button data-s="${k}" class="${OQ.status === k ? 'on' : ''}">${n}<em>${fmt(k ? c[k] || 0 : all)}</em></button>`).join('')}</div>
      <input class="in" id="q" type="search" placeholder="ค้นหาโค้ด ชื่อ หรือเบอร์โทร" value="${esc(OQ.q)}"></div>
      <div class="bulk" id="bulk" hidden><b>เลือก <span id="selN">0</span> รายการ</b>
        ${OQ.status === 'new' || !OQ.status ? '<button class="btn pri sm" data-bulk="shipping">เริ่มจัดส่ง</button>' : ''}${OQ.status === 'shipping' || !OQ.status ? '<button class="btn pri sm" data-bulk="done">ส่งถึงแล้ว</button>' : ''}
        <button class="btn sm" id="selPr">พิมพ์ใบปะหน้า</button><button class="btn ghost sm" id="selX">ล้าง</button></div>
      ${r.rows.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th class="ck"><input type="checkbox" id="selAll" aria-label="เลือกทั้งหมด"></th><th>โค้ด</th><th>วันที่แลก</th><th>สมาชิก</th><th>ของรางวัล</th><th class="r">เหรียญ</th><th>ผู้รับ</th><th>สถานะ</th></tr></thead><tbody>
        ${r.rows.map(o => `<tr data-code="${esc(o.code)}"><td class="ck">${o.digital || o.status === 'cancelled' || o.status === 'done' ? '' : `<input type="checkbox" data-sel="${esc(o.code)}" aria-label="เลือก ${esc(o.code)}">`}</td><td><b class="num">${esc(o.code)}</b></td><td class="mut">${dtTH(o.created_at)}</td>
          <td><div class="who"><div><b>${esc(o.member)}</b><small>ID ${esc(o.citizen_id)}</small></div></div></td>
          <td><div class="who"><img class="thumb" src="${esc(pimg(o.items[0]?.img))}" alt=""><div><b>${esc(o.items[0]?.name)}</b>${o.items.length > 1 ? `<small>+ อีก ${o.items.length - 1} ชิ้น</small>` : ''}</div></div></td>
          <td class="r num">${fmt(o.total)}</td><td>${o.digital ? '<span class="chip">คูปอง · ไม่ต้องจัดส่ง</span>' : o.ship_name ? `${esc(o.ship_name)}<br><small class="mut">${esc(o.ship_phone)}</small>` : '<span class="chip">ยังไม่กรอกที่อยู่</span>'}</td><td>${stChip(o.status)}</td></tr>`).join('')}
        </tbody></table></div>${pager(r.total, OQ)}` : '<div class="card empty">ไม่มีคำสั่งในหมวดนี้</div>'}`;
    $$('#seg button', pg).forEach(b => b.onclick = () => { OQ.status = b.dataset.s; OQ.offset = 0; route(); });
    let tm; $('#q', pg).oninput = e => { clearTimeout(tm); tm = setTimeout(() => { OQ.q = e.target.value.trim(); OQ.offset = 0; route().then(() => { const q = $('#q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }); }, 350); };
    $$('tr[data-code]', pg).forEach(tr => tr.onclick = e => { if (e.target.closest('.ck')) return; openOrder(r.rows.find(o => o.code === tr.dataset.code)); });
    // pick several orders: ship them together, or print their labels
    const sel = () => $$('[data-sel]:checked', pg).map(c => c.dataset.sel);
    const paint = () => { const n = sel().length; $('#bulk', pg).hidden = !n; $('#selN', pg).textContent = n; if ($('#selAll', pg)) $('#selAll', pg).checked = n && n === $$('[data-sel]', pg).length; };
    $$('[data-sel]', pg).forEach(c => c.onchange = paint);
    $('#selAll', pg) && ($('#selAll', pg).onchange = e => { $$('[data-sel]', pg).forEach(c => c.checked = e.target.checked); paint(); });
    $('#selX', pg).onclick = () => { $$('[data-sel]', pg).forEach(c => c.checked = false); paint(); };
    $('#selPr', pg).onclick = () => printLabels(r.rows.filter(o => sel().includes(o.code)));
    $$('[data-bulk]', pg).forEach(b => b.onclick = async () => {
      const codes = sel(), st = b.dataset.bulk;
      if (!(await confirmBox(`${STATUS[st][0]} ${codes.length} รายการ?`, st === 'shipping' ? 'ใส่เลขพัสดุทีละรายการได้ทีหลัง (เปิดคำสั่งแล้วกรอก)' : 'ส่งถึงแล้วยกเลิกไม่ได้', 'ยืนยัน'))) return;
      busyBtn(b, async () => { const x = await rpc('admin_bulk_orders', { p_codes: codes, p_status: st });
        toast(`เปลี่ยน ${x.ok} รายการแล้ว${x.failed.length ? ` · ไม่สำเร็จ ${x.failed.length}: ${x.failed.map(f => f.code).join(', ')}` : ''}`, x.failed.length > 0); refreshBadge(); route(); });
    });
    bindPager(pg, OQ);
  },
};
// address labels, two per row on A4, opened in a new tab to print (or save as PDF)
function printLabels(rows) {
  const list = rows.filter(o => !o.digital && o.ship_name && o.status !== 'cancelled');
  if (!list.length) return toast('ไม่มีคำสั่งที่กรอกที่อยู่แล้วให้พิมพ์', true);
  const w = open('', '_blank'); if (!w) return toast('เบราว์เซอร์บล็อกหน้าต่างใหม่ — อนุญาต pop-up ก่อน', true);
  w.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>ใบปะหน้า ${list.length} รายการ</title><style>
    @page{size:A4;margin:10mm}*{box-sizing:border-box}body{margin:0;font-family:"Noto Sans Thai",Tahoma,sans-serif;color:#111}
    .g{display:grid;grid-template-columns:1fr 1fr;gap:6mm}.l{border:1.5px dashed #444;border-radius:3mm;padding:5mm;height:64mm;display:flex;flex-direction:column;break-inside:avoid}
    .from{font-size:9pt;color:#555}.to{margin-top:3mm;font-size:12pt;line-height:1.5}.to b{font-size:15pt}.ft{margin-top:auto;display:flex;justify-content:space-between;gap:4mm;padding-top:2mm;border-top:1px solid #ccc;font-size:9pt}
    .bar{position:sticky;top:0;padding:8px;background:#fff;text-align:right}@media print{.bar{display:none}}</style></head><body>
    <div class="bar"><button onclick="print()">พิมพ์</button></div><div class="g">${list.map(o => `<div class="l"><div class="from">ผู้ส่ง: ${esc(CFG.sender || "eli · eliofficialth.store")}</div>
      <div class="to">ผู้รับ: <b>${esc(o.ship_name)}</b><br>โทร ${esc(o.ship_phone)}<br>${esc(o.ship_address)}${o.ship_note ? `<br>หมายเหตุ: ${esc(o.ship_note)}` : ''}</div>
      <div class="ft"><b>${esc(o.code)}</b><span>${esc(o.items.map(i => i.name).join(' + ').slice(0, 70))}</span></div></div>`).join('')}</div>
    <script>onload = () => setTimeout(() => print(), 300)<\/script></body></html>`);
  w.document.close();
  rpc('admin_log_event', { p_action: 'print_labels', p_detail: { count: list.length } }).catch(() => {});
}
const pager = (total, q) => total > PAGE ? `<div class="pager"><span>${fmt(q.offset + 1)}–${fmt(Math.min(total, q.offset + PAGE))} จาก ${fmt(total)}</span><span class="row"><button class="btn sm" data-pg="-1" ${q.offset ? '' : 'disabled'}>‹ ก่อนหน้า</button><button class="btn sm" data-pg="1" ${q.offset + PAGE < total ? '' : 'disabled'}>ถัดไป ›</button></span></div>` : '';
const bindPager = (pg, q) => $$('[data-pg]', pg).forEach(b => b.onclick = () => { q.offset = Math.max(0, q.offset + PAGE * +b.dataset.pg); route(); });

function openOrder(o) {
  const addr = o.ship_name ? `${o.ship_name}\n${o.ship_phone}\n${o.ship_address}${o.ship_note ? `\nหมายเหตุ: ${o.ship_note}` : ''}` : '';
  const d = drawer(`<div class="dh"><div><h3 class="num">${esc(o.code)}</h3><div class="sub">แลกเมื่อ ${dtTH(o.created_at)} · ${stChip(o.status)}</div></div><button class="x" data-x aria-label="ปิด">×</button></div>
    <section class="card"><h2>ของรางวัล <small>${fmt(o.total)} เหรียญ</small></h2>${o.items.map(i => `<div class="li"><img class="thumb" src="${esc(pimg(i.img))}" alt=""><div class="grow"><div class="t1">${esc(i.name)}</div>${i.coupon ? `<div class="t2">โค้ดพาร์ทเนอร์ <b class="num">${esc(i.coupon)}</b></div>` : ''}</div><span class="row num">${coin}${fmt(i.coins)}</span></div>`).join('')}</section>
    <div class="sec"><h4>ผู้รับ</h4>${o.digital ? '<div class="card empty">คูปองดิจิทัล — สมาชิกได้โค้ดในแอปทันที ไม่ต้องจัดส่ง</div>' : addr ? `<div class="addr">${esc(addr)}<button class="btn sm" id="cp">คัดลอก</button></div>` : '<div class="card empty">สมาชิกยังไม่ได้กรอกที่อยู่จัดส่ง</div>'}</div>
    <div class="sec"><h4>สมาชิก</h4>${o.user_id ? `<div class="card li" style="cursor:pointer" id="mem"><div class="grow"><div class="t1">${esc(o.member)}</div><div class="t2">Eli Citizen ID ${esc(o.citizen_id)}</div></div><span class="mut">ดูโปรไฟล์ ›</span></div>` : '<div class="card empty">สมาชิกลบบัญชีไปแล้ว — ยังจัดส่งตามที่อยู่นี้ได้ (ยกเลิกจะไม่มีเหรียญให้คืน)</div>'}</div>
    <div class="sec card">
      <label class="fld" ${o.digital ? 'hidden' : ''}><span>เลขพัสดุ (สมาชิกเห็นในแอป)</span><input id="trk" value="${esc(o.tracking || '')}" placeholder="เช่น TH0123456789" ${o.status === 'cancelled' ? 'disabled' : ''}></label>
      <label class="fld"><span>โน้ตภายในทีม</span><textarea id="note" rows="2" placeholder="สมาชิกไม่เห็นโน้ตนี้">${esc(o.admin_note || '')}</textarea></label>
      <div class="row" style="flex-wrap:wrap;justify-content:flex-end">
        ${['new', 'shipping'].includes(o.status) && !o.digital ? `<button class="btn danger" data-st="cancelled">${o.user_id ? 'ยกเลิกและคืนเหรียญ' : 'ยกเลิกคำสั่ง'}</button>` : ''}
        ${o.status === 'shipping' ? '<button class="btn ghost" data-st="new">ย้อนเป็นรอจัดส่ง</button>' : ''}
        ${o.status === 'done' && ME.role === 'owner' && !o.digital ? '<button class="btn ghost" data-st="shipping">เปิดกลับเป็นกำลังจัดส่ง</button>' : ''}
        ${o.status !== 'cancelled' ? `<button class="btn" data-st="${o.status}">บันทึก</button>` : ''}
        ${o.status === 'new' ? '<button class="btn pri" data-st="shipping">เริ่มจัดส่ง</button>' : o.status === 'shipping' ? '<button class="btn pri" data-st="done">ส่งถึงแล้ว</button>' : ''}
      </div>${o.status === 'done' && !o.digital ? '<p class="mut" style="margin:10px 0 0;font-size:13px">ส่งถึงแล้วยกเลิกไม่ได้ ถ้าสมาชิกคืนของ ให้เจ้าของปรับเหรียญคืนที่หน้าสมาชิกพร้อมเหตุผล</p>' : ''}</div>`);
  $('#cp', d) && ($('#cp', d).onclick = async () => { try { await navigator.clipboard.writeText(addr); toast('คัดลอกที่อยู่แล้ว'); } catch (e) { toast('คัดลอกไม่ได้', true); } });
  $('#mem', d) && ($('#mem', d).onclick = () => openMember(o.user_id));
  $$('[data-st]', d).forEach(b => b.onclick = () => busyBtn(b, async () => {
    const st = b.dataset.st;
    if (st === 'cancelled' && !(await confirmBox('ยกเลิกคำสั่งนี้?', o.user_id ? `คืน <b>${fmt(o.total)} เหรียญ</b> ให้ ${esc(o.member)} และคืนสต็อกของรางวัล — ทำแล้วย้อนกลับไม่ได้` : 'คืนสต็อกของรางวัล (สมาชิกลบบัญชีแล้ว ไม่มีเหรียญให้คืน) — ทำแล้วย้อนกลับไม่ได้', 'ยกเลิกคำสั่ง', true))) return;
    if (st === 'shipping' && !$('#trk', d).value.trim() && !(await confirmBox('ยังไม่ใส่เลขพัสดุ', 'เริ่มจัดส่งโดยไม่มีเลขพัสดุใช่ไหม ใส่ทีหลังได้', 'เริ่มจัดส่ง'))) return;
    await rpc('admin_set_order', { p_code: o.code, p_status: st, p_tracking: $('#trk', d).value, p_note: $('#note', d).value });
    toast(st === o.status ? 'บันทึกแล้ว' : `เปลี่ยนเป็น "${STATUS[st][0]}" แล้ว`); closeDrawer(); refreshBadge(); route();
  }));
}
async function exportOrders() {
  const rows = [];
  for (let off = 0; ; off += 200) { const r = await rpc('admin_orders', { p_status: OQ.status, p_q: OQ.q, p_limit: 200, p_offset: off }); rows.push(...r.rows); if (r.rows.length < 200 || off > 20000) break; }
  const r = { rows };
  // what members typed may start with = + - @ — Excel would run it as a formula, so it gets a ' in front
  const cell = v => { let t = String(v ?? ''); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return `"${t.replace(/"/g, '""')}"`; };
  const lines = [['โค้ด', 'วันที่แลก', 'สถานะ', 'สมาชิก', 'Eli Citizen ID', 'ของรางวัล', 'เหรียญ', 'ชื่อผู้รับ', 'เบอร์โทร', 'ที่อยู่', 'หมายเหตุ', 'เลขพัสดุ'].map(cell).join(',')]
    .concat(r.rows.map(o => [o.code, new Date(o.created_at).toLocaleString('th-TH'), STATUS[o.status][0], o.member, o.citizen_id, o.items.map(i => i.name).join(' + '), o.total, o.ship_name, o.ship_phone, o.ship_address, o.ship_note, o.tracking].map(cell).join(',')));
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  a.download = `eli-orders-${OQ.status || 'all'}-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  toast(`ดาวน์โหลด ${r.rows.length} รายการแล้ว`);
  rpc('admin_log_event', { p_action: 'export_orders', p_detail: { count: r.rows.length, status: OQ.status || 'all' } }).catch(() => {});
}

/* ═══════ ของรางวัล ═══════ */
const APP_IMGS = ['p_shorts', 'p_tee', 'p_cap', 'p_socks', 'it_tee', 'it_cap', 'it_bottle', 'it_gift', 'it_medal', 'it_coins', 'it_crown', 'it_heart', 'it_shield', 'it_potion', 'it_bolt', 'it_sprout', 'it_chest', 'i_sneaker', 'i_shoe', 'i_bag', 'i_gift', 'i_medal', 'i_watch', 'i_water', 'i_trophy', 'i_star', 'i_coin'];
let PTAB = '';
PAGES.products = {
  title: 'ของรางวัลใน Treasury',
  async render(pg) {
    const { data, error } = await sb.from('products').select('*').order('tab', { ascending: false }).order('sort').order('name'); if (error) throw error;
    $('#topR').innerHTML = '<button class="btn pri" id="add"><svg viewBox="0 0 24 24"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/></svg>เพิ่มของรางวัล</button>';
    $('#add').onclick = () => editProduct(null);
    const list = data.filter(p => !PTAB || p.tab === PTAB);
    pg.innerHTML = `<div class="bar"><div class="seg" id="seg">${[['', 'ทั้งหมด'], ['orig', 'Eli Originals'], ['fr', 'Eli friends']].map(([k, n]) => `<button data-t="${k}" class="${PTAB === k ? 'on' : ''}">${n}<em>${data.filter(p => !k || p.tab === k).length}</em></button>`).join('')}</div>
      <span class="mut" style="font-size:13.5px">ปิด "แสดงในแอป" เพื่อซ่อนชั่วคราวโดยไม่ต้องลบ</span></div>
      ${list.length ? `<div class="pgrid">${list.map(p => `<article class="pcard ${p.active ? '' : 'off'}">
        <div class="pi"><img src="${esc(pimg(p.img))}" alt="" onerror="this.src='assets/products/it_gift.webp'"></div>
        ${p.is_new ? '<span class="chip owner flag">NEW</span>' : ''}
        <div class="pb"><div class="nm">${esc(p.name)}</div><div class="pr">${coin}<span class="num">${fmt(p.coins)}</span> เหรียญ</div>
          <div class="meta"><span class="chip">${p.tab === 'orig' ? 'Eli Originals' : 'Eli friends'}</span>${p.uses_codes ? '<span class="chip">โค้ดคูปอง</span>' : ''}${p.stock == null ? '<span class="chip">ไม่จำกัดจำนวน</span>' : p.stock === 0 ? `<span class="st cancelled">${STATUS.cancelled[1]}หมด</span>` : `<span class="st ${p.stock <= 5 ? 'new' : 'done'}">${(p.stock <= 5 ? STATUS.new : STATUS.done)[1]}เหลือ ${fmt(p.stock)}${p.uses_codes ? ' โค้ด' : ''}</span>`}</div>
          <div class="acts"><label class="sw"><input type="checkbox" data-act="${esc(p.id)}" ${p.active ? 'checked' : ''}><i></i>แสดงในแอป</label><button class="btn sm" data-ed="${esc(p.id)}">แก้ไข</button></div></div></article>`).join('')}</div>` : '<div class="card empty">ยังไม่มีของรางวัลในหมวดนี้</div>'}`;
    $$('#seg button', pg).forEach(b => b.onclick = () => { PTAB = b.dataset.t; route(); });
    $$('[data-ed]', pg).forEach(b => b.onclick = () => editProduct(data.find(p => p.id === b.dataset.ed)));
    $$('[data-act]', pg).forEach(c => c.onchange = async () => {
      const { error } = await sb.from('products').update({ active: c.checked }).eq('id', c.dataset.act);
      if (error) { c.checked = !c.checked; return oops(error); }
      c.closest('.pcard').classList.toggle('off', !c.checked); toast(c.checked ? 'แสดงในแอปแล้ว' : 'ซ่อนจากแอปแล้ว');
    });
  },
};
function editProduct(p) {
  const isNew = !p; p = p || { tab: PTAB || 'orig', name: '', coins: 500, img: 'it_gift', stock: null, is_new: true, active: true, sort: 0 };
  let img = p.img;
  const m = modal(`<h3>${isNew ? 'เพิ่มของรางวัล' : 'แก้ไขของรางวัล'}</h3><p class="sub">${isNew ? 'สมาชิกจะเห็นในแอปทันทีที่บันทึก (ถ้าเปิด "แสดงในแอป")' : `รหัส ${esc(p.id)} · ราคาใหม่มีผลกับการแลกครั้งถัดไป`}</p>
    <form id="pf">
      <div class="prev"><img id="pv" src="${esc(pimg(img))}" alt=""></div>
      <div class="row" style="margin-bottom:8px"><label class="btn sm"><input type="file" id="up" accept="image/png,image/jpeg,image/webp" hidden>อัปโหลดรูป (ไม่เกิน 2 MB)</label><span class="mut" style="font-size:13px">หรือเลือกรูปจากแอป</span></div>
      <div class="imgpick" id="pick">${APP_IMGS.map(n => `<button type="button" data-i="${n}" class="${img === n ? 'on' : ''}" aria-label="${n}"><img src="assets/products/${n}.webp" alt=""></button>`).join('')}</div>
      <div style="height:14px"></div>
      <label class="fld"><span>ชื่อของรางวัล</span><input name="name" maxlength="60" required value="${esc(p.name)}"></label>
      <div class="grid2">
        <label class="fld"><span>หมวด</span><select name="tab"><option value="orig" ${p.tab === 'orig' ? 'selected' : ''}>Eli Originals (สินค้าแบรนด์)</option><option value="fr" ${p.tab === 'fr' ? 'selected' : ''}>Eli friends (พาร์ทเนอร์)</option></select></label>
        <label class="fld"><span>ราคา (เหรียญ)</span><input name="coins" type="number" min="1" max="100000" required value="${p.coins}"></label>
        <label class="fld"><span>จำนวนในสต็อก</span><input name="stock" type="number" min="0" value="${p.stock ?? ''}" placeholder="เว้นว่าง = ไม่จำกัด" ${p.uses_codes ? 'disabled' : ''}>${p.uses_codes ? '<small>= จำนวนโค้ดคูปองที่เหลือ</small>' : ''}</label>
        <label class="fld"><span>ลำดับการแสดง</span><input name="sort" type="number" value="${p.sort}"><small>เลขน้อยขึ้นก่อน</small></label>
        <label class="fld"><span>ต้นทุนต่อชิ้น (บาท)</span><input name="cost" type="number" min="0" step="0.01" value="${p.cost_thb ?? ''}" placeholder="ไม่บังคับ"><small>ใช้คำนวณภาระของรางวัลที่หน้า "เศรษฐกิจเหรียญ"</small></label>
      </div>
      <div class="row" style="gap:22px;margin:2px 0 14px"><label class="sw"><input type="checkbox" name="is_new" ${p.is_new ? 'checked' : ''}><i></i>ป้าย NEW</label><label class="sw"><input type="checkbox" name="active" ${p.active ? 'checked' : ''}><i></i>แสดงในแอป</label></div>
      ${isNew ? '' : `<div class="sec card cpn"><h2>โค้ดคูปองพาร์ทเนอร์ <small id="cpN">กำลังโหลด…</small></h2>
        <p class="hint" style="margin-top:0">สำหรับสิทธิ์จากร้านพาร์ทเนอร์: วางโค้ดที่ร้านให้มา 1 บรรทัดต่อ 1 โค้ด สมาชิกที่แลกจะได้โค้ดในแอปทันที ไม่ต้องจัดส่ง</p>
        <textarea id="cpIn" rows="3" placeholder="SHOE10-AB12&#10;SHOE10-CD34"></textarea>
        <div class="row" style="flex-wrap:wrap;margin-top:8px"><button type="button" class="btn sm" id="cpAdd">เพิ่มโค้ด</button><button type="button" class="btn ghost sm" id="cpCsv">ดาวน์โหลดโค้ดที่แจกแล้ว (ส่งให้ร้าน)</button><button type="button" class="btn ghost sm" id="cpClr">ลบโค้ดที่ยังไม่แจก</button></div></div>`}
      <div class="acts">${isNew ? '' : '<button type="button" class="btn danger" id="del" style="margin-right:auto">ลบ</button>'}<button type="button" class="btn ghost" data-x>ยกเลิก</button><button class="btn pri" type="submit">บันทึก</button></div>
    </form>`);
  if (!isNew) {
    const load = async () => { try { const c = await rpc('admin_coupons', { p_product: p.id }); $('#cpN', m).textContent = c.free + c.used ? `เหลือ ${fmt(c.free)} · แจกแล้ว ${fmt(c.used)}` : 'ยังไม่มีโค้ด'; return c; } catch (e) { oops(e); } };
    load();
    $('#cpAdd', m).onclick = e => busyBtn(e.currentTarget, async () => {
      const codes = $('#cpIn', m).value.split(/\r?\n|,/).map(x => x.trim()).filter(Boolean);
      if (!codes.length) return toast('วางโค้ดก่อน', true);
      const x = await rpc('admin_add_coupons', { p_product: p.id, p_codes: codes });
      $('#cpIn', m).value = ''; toast(`เพิ่ม ${x.added} โค้ด${x.skipped ? ` (ข้าม ${x.skipped} ที่ซ้ำ/ว่าง)` : ''} · เหลือ ${x.free}`); load(); m.querySelector('[name=stock]').value = x.free; m.querySelector('[name=stock]').disabled = true; p.uses_codes = true;
    });
    $('#cpCsv', m).onclick = e => busyBtn(e.currentTarget, async () => {
      const c = await rpc('admin_coupons', { p_product: p.id, p_with_codes: true }); if (!c?.given.length) return toast('ยังไม่มีโค้ดที่แจก', true);
      const cell = v => { let t = String(v ?? ''); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return `"${t.replace(/"/g, '""')}"`; };
      const lines = ['code,order,given_at'].concat(c.given.map(g => [g.code, g.order, new Date(g.at).toLocaleString('th-TH')].map(cell).join(',')));
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })); a.download = `eli-coupons-${p.id}.csv`; a.click();
      rpc('admin_log_event', { p_action: 'export_coupons', p_detail: { product: p.id, count: c.given.length } }).catch(() => {});
    });
    $('#cpClr', m).onclick = async e => { const b = e.currentTarget; closeModal(); if (!(await confirmBox('ลบโค้ดที่ยังไม่แจก?', `โค้ดที่แจกไปแล้วยังอยู่ · "${esc(p.name)}" จะหมดสต็อก`, 'ลบ', true))) return editProduct(p);
      try { const x = await rpc('admin_clear_coupons', { p_product: p.id }); toast(`ลบ ${x.removed} โค้ดแล้ว`); route(); } catch (err) { oops(err); } };
  }
  const setImg = v => { img = v; $('#pv', m).src = pimg(v); $$('#pick button', m).forEach(b => b.classList.toggle('on', b.dataset.i === v)); };
  $$('#pick button', m).forEach(b => b.onclick = () => setImg(b.dataset.i));
  $('#up', m).onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    if (f.size > 2 * 1024 * 1024) return toast('รูปใหญ่เกิน 2 MB', true);
    const lb = e.target.closest('label'); lb.classList.add('busy'); lb.lastChild.textContent = 'กำลังอัปโหลด…';
    const path = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}.${(f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`;
    const { error } = await sb.storage.from('products').upload(path, f, { contentType: f.type, cacheControl: '31536000' });
    lb.lastChild.textContent = 'อัปโหลดรูป (ไม่เกิน 2 MB)';
    if (error) return oops(error);
    setImg(sb.storage.from('products').getPublicUrl(path).data.publicUrl); toast('อัปโหลดรูปแล้ว');
  };
  $('#pf', m).onsubmit = e => {
    e.preventDefault(); const f = e.target;
    const row = { name: f.name.value.trim(), tab: f.tab.value, coins: +f.coins.value, sort: +f.sort.value || 0, is_new: f.is_new.checked, active: f.active.checked, img, cost_thb: f.cost.value === '' ? null : +f.cost.value };
    if (!p.uses_codes) row.stock = f.stock.value === '' ? null : +f.stock.value;   // a coupon's stock follows its codes
    if (!row.name) return toast('ใส่ชื่อของรางวัลก่อน', true);
    busyBtn($('[type=submit]', f), async () => {
      const q = isNew ? sb.from('products').insert({ id: 'p' + Date.now().toString(36), ...row }) : sb.from('products').update(row).eq('id', p.id);
      const { error } = await q; if (error) throw error;
      closeModal(); toast(isNew ? 'เพิ่มของรางวัลแล้ว' : 'บันทึกแล้ว'); route();
    });
  };
  $('#del', m) && ($('#del', m).onclick = async () => {
    closeModal();
    if (!(await confirmBox(`ลบ "${p.name}"?`, 'คำสั่งแลกเก่ายังเก็บชื่อและราคาของชิ้นนี้ไว้ครบ ถ้าแค่อยากหยุดแลกชั่วคราว ให้ปิด "แสดงในแอป" แทน', 'ลบ', true))) return;
    const { error } = await sb.from('products').delete().eq('id', p.id); if (error) return oops(error);
    toast('ลบแล้ว'); route();
  });
}

/* ═══════ สมาชิก ═══════ */
const MQ = { q: '', sort: 'new', offset: 0 };
PAGES.members = {
  title: 'สมาชิก',
  async render(pg) {
    const r = await rpc('admin_members', { p_q: MQ.q, p_sort: MQ.sort, p_limit: PAGE, p_offset: MQ.offset });
    pg.innerHTML = `<div class="bar"><input class="in" id="q" type="search" placeholder="ค้นหาชื่อ, Eli Citizen ID หรืออีเมล" value="${esc(MQ.q)}">
      <div class="seg" id="seg">${[['new', 'สมัครล่าสุด'], ['lp', 'Life Power สูงสุด'], ['coins', 'เหรียญมากสุด'], ['suspended', 'ถูกระงับ']].map(([k, n]) => `<button data-s="${k}" class="${MQ.sort === k ? 'on' : ''}">${n}</button>`).join('')}</div>
      <span class="mut" style="margin-left:auto">${fmt(r.total)} คน</span></div>
      ${r.rows.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>สมาชิก</th><th>อีเมล</th><th class="r">เลเวล</th><th class="r">Life Power</th><th class="r">เหรียญ</th><th class="r">Streak</th><th>เข้าแอปล่าสุด</th><th>สมัครเมื่อ</th></tr></thead><tbody>
        ${r.rows.map(m => `<tr data-id="${esc(m.id)}"><td><div class="who"><img class="av" src="${esc(avatar(m.avatar))}" alt=""><div><b>${esc(m.name)}</b><small>ID ${esc(m.citizen_id)}${m.hall_hidden ? ' · ซ่อนจาก Hero Hall' : ''}${m.suspended_at ? ' · <span class="neg">ระงับอยู่</span>' : ''}</small></div></div></td>
          <td class="mut">${esc(m.email)}</td><td class="r num">${m.level}</td><td class="r num">${fmt(m.total_lp)}</td><td class="r num">${fmt(m.coins)}</td><td class="r num">${fmt(m.streak)}</td><td>${daysAgo(m.last_day)}</td><td class="mut">${dyTH(m.created_at)}</td></tr>`).join('')}
        </tbody></table></div>${pager(r.total, MQ)}` : '<div class="card empty">ไม่พบสมาชิก</div>'}`;
    let tm; $('#q', pg).oninput = e => { clearTimeout(tm); tm = setTimeout(() => { MQ.q = e.target.value.trim(); MQ.offset = 0; route().then(() => { const q = $('#q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }); }, 350); };
    $$('#seg button', pg).forEach(b => b.onclick = () => { MQ.sort = b.dataset.s; MQ.offset = 0; route(); });
    $$('tr[data-id]', pg).forEach(tr => tr.onclick = () => openMember(tr.dataset.id));
    bindPager(pg, MQ);
  },
};
async function openMember(id) {
  drawer('<div class="empty"><i class="spin"></i></div>');
  let m; try { m = await rpc('admin_member', { p_id: id }); } catch (e) { closeDrawer(); return oops(e); }
  if (!m) { closeDrawer(); return toast('ไม่พบสมาชิกคนนี้ (อาจลบบัญชีไปแล้ว)', true); }
  const p = m.profile, age = ageOf(p.birth), own = ME.role === 'owner';
  const d = drawer(`${p.suspended_at ? `<div class="warn-b">ระงับบัญชีเมื่อ ${dtTH(p.suspended_at)} · ${esc(p.suspended_reason || '')}</div>` : ''}<div class="dh"><div class="row" style="align-items:center;gap:14px"><img class="av lg" src="${esc(avatar(p.avatar))}" alt=""><div><h3>${esc(p.name)}</h3><div class="sub">Eli Citizen ID <b>${esc(p.citizen_id)}</b><br>${esc(p.email)}</div></div></div><button class="x" data-x aria-label="ปิด">×</button></div>
    <div class="minis"><div class="mini"><div class="lb">Life Power</div><div class="v num">${fmt(p.total_lp)}</div></div><div class="mini"><div class="lb">เลเวล</div><div class="v num">${p.level}</div></div><div class="mini"><div class="lb">เหรียญ</div><div class="v num">${fmt(p.coins)}</div></div>
      <div class="mini"><div class="lb">Streak</div><div class="v num">${fmt(p.streak)} วัน</div></div><div class="mini"><div class="lb">LP สัปดาห์นี้</div><div class="v num">${fmt(p.week_lp)}</div></div><div class="mini"><div class="lb">เพื่อน</div><div class="v num">${fmt(m.friends)}</div></div></div>
    <div class="sec card"><dl class="kv"><dt>อายุจริง</dt><dd>${age != null ? `${age} ปี (${dyTH(p.birth)})` : '—'}</dd><dt>เพศ</dt><dd>${p.gender === 'm' ? 'ชาย' : p.gender === 'f' ? 'หญิง' : '—'}</dd><dt>แคปชั่น</dt><dd>${esc(p.bio) || '—'}</dd>
      <dt>สมัครเมื่อ</dt><dd>${dtTH(p.created_at)}</dd><dt>เข้าระบบล่าสุด</dt><dd>${p.last_sign_in ? dtTH(p.last_sign_in) : '—'}</dd><dt>Hero Hall</dt><dd>${p.hall_hidden ? 'ซ่อนตัวอยู่' : 'แสดงอันดับ'}</dd></dl></div>
    ${ME.role === 'owner' ? `<div class="sec card"><h2>ปรับเหรียญ <small>บันทึกในประวัติเหรียญพร้อมชื่อคุณ</small></h2><form id="adj" class="row" style="flex-wrap:wrap;align-items:flex-end">
      <label class="fld" style="width:120px;margin:0"><span>จำนวน</span><input name="n" type="number" placeholder="+50 หรือ -50" required></label>
      <label class="fld" style="flex:1;min-width:180px;margin:0"><span>เหตุผล</span><input name="why" maxlength="120" placeholder="เช่น ชดเชยเหรียญที่หาย" required></label>
      <button class="btn gold" type="submit">ปรับเหรียญ</button></form></div>` : ''}
    ${own ? `<div class="sec card"><h2>จัดการบัญชี <small>เจ้าของเท่านั้น · บันทึกทุกครั้ง</small></h2><div class="row" style="flex-wrap:wrap">
      <button class="btn sm" id="mExp">ดาวน์โหลดข้อมูล (PDPA)</button><button class="btn sm" id="mStr">ตั้ง Streak</button>
      ${p.suspended_at ? '<button class="btn sm" id="mUns">ยกเลิกการระงับ</button>' : '<button class="btn danger sm" id="mSus">ระงับบัญชี</button>'}<button class="btn danger sm" id="mDel">ลบบัญชี</button></div></div>` : ''}
    <div class="sec"><h4>14 วันล่าสุด</h4>${!m.health_access ? `<div class="card empty">ข้อมูลสุขภาพรายวัน (ก้าว การนอน หัวใจ) ดูได้เฉพาะเจ้าของและทีมงานที่ได้รับสิทธิ์ตาม PDPA<br>14 วันล่าสุดเปิดแอป ${fmt(m.days_summary?.active)} วัน</div>` : m.days.length ? `<p class="hint" style="margin:-4px 0 8px">การเปิดดูข้อมูลสุขภาพครั้งนี้ถูกบันทึกไว้ (PDPA)</p><div class="tbl-wrap"><table class="tbl"><thead><tr><th>วันที่</th><th class="r">ก้าว</th><th class="r">นอน</th><th>ลูบน้อง</th><th>ส่งพลังใจ</th><th class="r">LP</th></tr></thead><tbody>${m.days.map(x => `<tr style="cursor:default"><td>${dTH(x.day)}</td><td class="r num">${fmt(x.steps)}</td><td class="r num">${x.sleep ?? '—'}</td><td>${x.pet ? '✓' : '—'}</td><td>${x.sent ? '✓' : '—'}</td><td class="r num">${x.earned == null ? '<span class="mut">วันนี้</span>' : fmt(x.earned + x.bonus)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="card empty">ยังไม่เคยเข้าแอป</div>'}</div>
    <div class="sec"><h4>การวิ่ง</h4><div class="card">${m.runs.length ? m.runs.map(x => `<div class="li"><div class="grow"><div class="t1">${esc(x.sport)} ${(x.meters / 1000).toFixed(2)} กม. · ${Math.floor(x.sec / 60)} นาที</div><div class="t2">${dtTH(x.started_at)}${x.hr_avg ? ` · หัวใจเฉลี่ย ${x.hr_avg}` : ''}</div></div><span class="mut num">+${x.lp} LP</span></div>`).join('') : '<div class="empty">ยังไม่มีการวิ่ง</div>'}</div></div>
    <div class="sec"><h4>คำสั่งแลก</h4><div class="card">${m.orders.length ? m.orders.map(x => `<div class="li"><div class="grow"><div class="t1 num">${esc(x.code)}</div><div class="t2">${dtTH(x.created_at)} · ${fmt(x.total)} เหรียญ</div></div>${stChip(x.status)}</div>`).join('') : '<div class="empty">ยังไม่เคยแลก</div>'}</div></div>
    <div class="sec"><h4>ประวัติเหรียญล่าสุด</h4><div class="card">${m.coins.length ? m.coins.map(x => `<div class="li"><div class="grow"><div class="t1">${esc(REASON[x.reason] || x.reason)}</div><div class="t2">${dtTH(x.at)}${x.reason === 'admin' && x.note ? ` · ${esc(x.note)}` : ''}</div></div><span class="${x.delta > 0 ? 'pos' : 'neg'} num">${x.delta > 0 ? '+' : ''}${fmt(x.delta)}</span></div>`).join('') : '<div class="empty">ยังไม่มี</div>'}</div></div>`);
  // owners: account actions (each one goes to the back-office log on the server)
  const act = (sel, job) => $(sel, d) && ($(sel, d).onclick = async e => { const b = e.currentTarget; try { await job(b); } catch (err) { oops(err); } });
  act('#mExp', async b => busyBtn(b, async () => {
    const x = await rpc('admin_export_member', { p_id: id }), a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(x, null, 2)], { type: 'application/json' })); a.download = `eli-member-${p.citizen_id}.json`; a.click(); toast('ดาวน์โหลดข้อมูลแล้ว (บันทึกการส่งออกไว้แล้ว)');
  }));
  act('#mStr', async () => { const v = await askForm('ตั้ง Streak', `${esc(p.name)} · ตอนนี้ ${fmt(p.streak)} วัน`, [{ name: 'n', label: 'Streak ใหม่ (วัน)', type: 'number', min: 0, max: 10000, value: p.streak }, { name: 'why', label: 'เหตุผล', placeholder: 'เช่น แอปค้างวันที่ 3 ทำให้ Streak หาย' }]);
    if (!v) return; await rpc('admin_set_streak', { p_id: id, p_streak: +v.n, p_reason: v.why }); toast('ตั้ง Streak แล้ว'); openMember(id); });
  act('#mSus', async () => { const v = await askForm('ระงับบัญชี?', `${esc(p.name)} จะถูกออกจากระบบทุกเครื่อง เข้าใหม่ไม่ได้ ไม่ได้รางวัล และหายจาก Hero Hall จนกว่าจะยกเลิก`, [{ name: 'why', label: 'เหตุผล (บันทึกไว้)', placeholder: 'เช่น ใช้หลายบัญชีรับเหรียญ' }], 'ระงับบัญชี', true);
    if (!v) return; await rpc('admin_suspend', { p_id: id, p_reason: v.why }); toast('ระงับบัญชีแล้ว'); openMember(id); if (curPage === 'members') route(); });
  act('#mUns', async b => { if (!(await confirmBox('ยกเลิกการระงับ?', `${esc(p.name)} จะเข้าใช้แอปได้ตามปกติ`, 'ยกเลิกการระงับ'))) return;
    await rpc('admin_unsuspend', { p_id: id }); toast('ยกเลิกการระงับแล้ว'); openMember(id); if (curPage === 'members') route(); });
  act('#mDel', async () => { const v = await askForm('ลบบัญชีถาวร?', `ข้อมูลทั้งหมดของ ${esc(p.name)} (ID ${esc(p.citizen_id)}) จะถูกลบ กู้คืนไม่ได้ · คำสั่งแลกที่ยังไม่ส่งยังอยู่ให้ส่งต่อ<br>พิมพ์ Eli Citizen ID <b>${esc(p.citizen_id)}</b> เพื่อยืนยัน`,
      [{ name: 'id', label: 'Eli Citizen ID', placeholder: p.citizen_id }, { name: 'why', label: 'เหตุผล (บันทึกไว้)', placeholder: 'เช่น สมาชิกขอลบทาง LINE วันที่ …' }], 'ลบบัญชีถาวร', true);
    if (!v) return; if (v.id !== p.citizen_id) return toast('Eli Citizen ID ไม่ตรง ยังไม่ได้ลบ', true);
    await rpc('admin_delete_member', { p_id: id, p_reason: v.why }); closeDrawer(); toast('ลบบัญชีแล้ว'); if (curPage === 'members') route(); });
  const adj = $('#adj', d);
  adj && (adj.onsubmit = async e => {
    e.preventDefault(); const n = +adj.n.value, why = adj.why.value.trim();
    if (!n) return toast('ใส่จำนวนที่ไม่ใช่ 0', true);
    if (!(await confirmBox(n > 0 ? 'เพิ่มเหรียญ?' : 'หักเหรียญ?', `${n > 0 ? 'เพิ่ม' : 'หัก'} <b>${fmt(Math.abs(n))} เหรียญ</b> ${n > 0 ? 'ให้' : 'จาก'} ${esc(p.name)} · เหตุผล: ${esc(why)}`, 'ยืนยัน'))) return;
    busyBtn($('button', adj), async () => { const r = await rpc('admin_adjust_coins', { p_user: id, p_delta: n, p_reason: why }); toast(`ปรับแล้ว · ตอนนี้มี ${fmt(r.coins)} เหรียญ`); openMember(id); if (curPage === 'members') route(); });
  });
}

/* ═══════ ประวัติเหรียญ ═══════ */
const CQ = { reason: '', offset: 0 };
PAGES.coins = {
  title: 'ประวัติเหรียญ',
  async render(pg) {
    const r = await rpc('admin_coin_log', { p_reason: CQ.reason, p_limit: PAGE, p_offset: CQ.offset });
    const reasons = Object.entries(REASON).filter(([k]) => ME.can_health ? k !== 'quest' : !['walk', 'sleep'].includes(k));   // without health access walk + sleep are one quest
    pg.innerHTML = `<div class="bar"><div class="seg" id="seg">${[['', 'ทั้งหมด'], ...reasons].map(([k, n]) => `<button data-r="${k}" class="${CQ.reason === k ? 'on' : ''}">${n}</button>`).join('')}</div></div>
      ${r.rows.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>เวลา</th><th>สมาชิก</th><th>รายการ</th><th>รายละเอียด</th><th class="r">เหรียญ</th></tr></thead><tbody>
        ${r.rows.map(x => `<tr data-id="${esc(x.user_id)}"><td class="mut">${dtTH(x.at)}</td><td><div class="who"><div><b>${esc(x.member)}</b><small>ID ${esc(x.citizen_id)}</small></div></div></td><td>${esc(REASON[x.reason] || x.reason)}</td>
          <td class="mut">${esc(x.reason === 'admin' ? x.note || '' : x.reason === 'redeem' || x.reason === 'refund' ? x.ref : '')}</td><td class="r"><span class="${x.delta > 0 ? 'pos' : 'neg'} num">${x.delta > 0 ? '+' : ''}${fmt(x.delta)}</span></td></tr>`).join('')}
        </tbody></table></div>${pager(r.total, CQ)}` : '<div class="card empty">ยังไม่มีรายการ</div>'}`;
    $$('#seg button', pg).forEach(b => b.onclick = () => { CQ.reason = b.dataset.r; CQ.offset = 0; route(); });
    $$('tr[data-id]', pg).forEach(tr => tr.onclick = () => openMember(tr.dataset.id));
    bindPager(pg, CQ);
  },
};
