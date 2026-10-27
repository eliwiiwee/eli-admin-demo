/* Eli's World back office — part 2: growth, the coin economy, news & coin events, game rules, the back-office log,
   the team (with health-data access and 2-step sign-in). Loaded after admin.js (uses its helpers) and starts the app. */

const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
const dtLocal = d => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 16); };   // for <input type=datetime-local>
const live = (s, e) => { const n = Date.now(), a = new Date(s).getTime(), b = new Date(e).getTime(); return n < a ? 'soon' : n >= b ? 'over' : 'on'; };
const LIVE = { on: ['กำลังแสดง', 'done'], soon: ['ตั้งเวลาไว้', 'shipping'], over: ['จบแล้ว', 'cancelled'] };
const liveChip = k => `<span class="st ${LIVE[k][1]}">${STATUS[LIVE[k][1]][1]}${LIVE[k][0]}</span>`;
// a horizontal bar inside a table cell / list (one hue; the number is always printed next to it)
const hbar = (v, max, txt) => `<div class="hb"><span class="tr"><i style="width:${max ? Math.max(2, v / max * 100) : 0}%"></i></span><span class="num">${txt ?? fmt(v)}</span></div>`;

/* ═══════ การเติบโต ═══════ */
PAGES.growth = {
  title: 'การเติบโต',
  async render(pg) {
    const g = await rpc('admin_growth', { p_days: 30 });
    const R = g.retention || {}, ret = k => R[k] ? pct(R[k].back, R[k].base) : null, F = g.funnel, H = g.habits || {};
    const steps = [['signed_up', 'สมัครสมาชิก'], ['profile', 'ตั้งโปรไฟล์ครบ'], ['health', 'ให้ข้อมูล Health (ก้าว/การนอน)'], ['run', 'บันทึกการวิ่งครั้งแรก'], ['redeem', 'แลกของรางวัลครั้งแรก']];
    const lvMax = Math.max(1, ...g.levels.map(l => l.count));
    $('#topR').innerHTML = `<span class="chip">ข้อมูลวันที่ ${dyTH(g.today)}</span>`;
    pg.innerHTML = `<div class="tiles">
        <div class="tile hero"><div class="lb">ใช้งานวันนี้ (DAU)</div><div class="v num">${fmt(g.dau)}</div><div class="d">จากสมาชิก ${fmt(g.members)} คน</div></div>
        <div class="tile"><div class="lb">ใช้งาน 7 วัน (WAU)</div><div class="v num">${fmt(g.wau)}</div><div class="d">30 วัน (MAU) ${fmt(g.mau)} คน</div></div>
        <div class="tile"><div class="lb">ความเหนียวแน่น (DAU ÷ MAU)</div><div class="v num">${pct(g.dau, g.mau)}%</div><div class="d">แอปสุขภาพที่ดีมักอยู่ราว 20% ขึ้นไป</div></div>
        <div class="tile"><div class="lb">กลับมาวันถัดไป (D1)</div><div class="v num">${ret('d1') ?? '—'}${ret('d1') != null ? '%' : ''}</div><div class="d">${R.d1 ? `${fmt(R.d1.back)} จาก ${fmt(R.d1.base)} คน` : 'ยังไม่มีข้อมูลพอ'}</div></div>
        <div class="tile"><div class="lb">กลับมาวันที่ 7 (D7)</div><div class="v num">${ret('d7') ?? '—'}${ret('d7') != null ? '%' : ''}</div><div class="d">${R.d7 ? `${fmt(R.d7.back)} จาก ${fmt(R.d7.base)} คน` : 'ยังไม่มีข้อมูลพอ'}</div></div>
        <div class="tile"><div class="lb">กลับมาวันที่ 30 (D30)</div><div class="v num">${ret('d30') ?? '—'}${ret('d30') != null ? '%' : ''}</div><div class="d">${R.d30 ? `${fmt(R.d30.back)} จาก ${fmt(R.d30.base)} คน` : 'ยังไม่มีข้อมูลพอ'}</div></div>
      </div>
      <div class="grid-2">
        <section class="card"><h2>คนใช้งานต่อวัน <small>30 วันล่าสุด</small></h2><div class="chart" id="chA"></div><div class="key"><span><i style="background:var(--gold)"></i>วันนี้ (ยังไม่จบวัน)</span></div></section>
        <section class="card"><h2>สมาชิกใหม่ต่อวัน <small>30 วันล่าสุด</small></h2><div class="chart" id="chN"></div><div class="key"><span><i style="background:var(--gold)"></i>วันนี้ (ยังไม่จบวัน)</span></div></section>
      </div>
      <section class="card sec2"><h2>กลับมาใช้ต่อ แยกตามสัปดาห์ที่สมัคร <small>% ของคนที่สมัครสัปดาห์นั้น ที่ยังเปิดแอปในสัปดาห์ต่อ ๆ มา</small></h2>
        <div class="tbl-wrap flat"><table class="tbl coh"><thead><tr><th>สัปดาห์ที่สมัคร</th><th class="r">คน</th>${[...Array(8)].map((_, k) => `<th class="r">${k ? 'สัปดาห์ ' + k : 'สัปดาห์แรก'}</th>`).join('')}</tr></thead><tbody>
        ${g.cohorts.map(c => `<tr><td>${dTH(c.week)}</td><td class="r num">${fmt(c.size)}</td>${c.weeks.map(v => { if (v == null || !c.size) return '<td class="r mut">—</td>'; const p = pct(v, c.size), a = .08 + p / 100 * .85; return `<td class="r num heat" style="background:rgba(42,59,156,${a.toFixed(2)});color:${a > .5 ? '#fff' : 'var(--ink)'}" title="${fmt(v)} จาก ${fmt(c.size)} คน">${p}%</td>`; }).join('')}</tr>`).join('')}
        </tbody></table></div><p class="hint">ช่องยิ่งเข้มยิ่งดี · สัปดาห์ที่ยังมาไม่ถึงเว้นว่าง</p></section>
      <div class="cols sec2">
        <section class="card"><h2>เส้นทางสมาชิกใหม่ <small>คนที่สมัครใน 90 วันล่าสุด</small></h2>
          ${steps.map(([k, n], i) => `<div class="fun"><div class="fl"><b>${n}</b><span class="mut">${i ? `${pct(F[k], F[steps[i - 1][0]])}% จากขั้นก่อน` : ''}</span></div>${hbar(F[k], F.signed_up, `${fmt(F[k])} คน · ${pct(F[k], F.signed_up)}%`)}</div>`).join('')}
          <p class="hint">ขั้นที่หล่นเยอะที่สุดคือจุดที่ควรปรับก่อน</p></section>
        <div class="stack">
          <section class="card"><h2>พฤติกรรมสุขภาพ <small>7 วันล่าสุด · รวมทุกคน</small></h2>
            <div class="minis">
              <div class="mini"><div class="lb">ก้าวเฉลี่ย/วัน</div><div class="v num">${fmt(H.avg_steps)}</div></div>
              <div class="mini"><div class="lb">วันที่เดินครบ 7,000</div><div class="v num">${H.walk_goal ?? 0}%</div></div>
              <div class="mini"><div class="lb">คืนที่นอน 7–9 ชม.</div><div class="v num">${H.sleep_ok ?? 0}%</div></div>
              <div class="mini"><div class="lb">นอนเฉลี่ย</div><div class="v num">${H.avg_sleep ?? '—'} ชม.</div></div>
              <div class="mini"><div class="lb">วันที่ลูบน้อง</div><div class="v num">${H.pet ?? 0}%</div></div>
              <div class="mini"><div class="lb">วันที่ส่งพลังใจ</div><div class="v num">${H.sent ?? 0}%</div></div>
            </div><p class="hint">วิ่ง ${fmt(g.runs.count)} ครั้ง · ${fmt(g.runs.km)} กม. · ${fmt(g.runs.people)} คน</p></section>
          <section class="card"><h2>สมาชิกตามระดับ</h2>
            ${g.levels.map(l => `<div class="fun"><div class="fl"><b>${esc(l.tier)}</b></div>${hbar(l.count, lvMax, `${fmt(l.count)} คน`)}</div>`).join('')}</section>
        </div>
      </div>`;
    const row = k => g.daily.map(d => ({ v: d[k], label: new Date(d.day).toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short' }), short: String(new Date(d.day).getDate()) }));
    barChart($('#chA', pg), row('active'), { name: 'คนใช้งานต่อวัน', unit: 'คน' });
    barChart($('#chN', pg), row('new'), { name: 'สมาชิกใหม่ต่อวัน', unit: 'คน' });
  },
};

/* ═══════ เศรษฐกิจเหรียญ ═══════ */
PAGES.economy = {
  title: 'เศรษฐกิจเหรียญ',
  async render(pg) {
    const e = await rpc('admin_economy', { p_days: 30 });
    const srcMax = Math.max(1, ...e.sources.map(s => Math.abs(s.coins)));
    $('#topR').innerHTML = `${e.event ? `<span class="chip owner">🎉 ${esc(e.event.name)} · เหรียญ ×${+e.event.mult}</span>` : ''}<span class="chip">30 วันล่าสุด</span>`;
    pg.innerHTML = `<div class="tiles">
        <div class="tile hero"><div class="lb">เหรียญที่สมาชิกถืออยู่</div><div class="v num">${fmt(e.held)}</div><div class="d">${e.owed_thb != null ? `≈ ภาระของรางวัล ฿${fmt(e.owed_thb)} ถ้าทุกคนแลกหมด` : 'ใส่ "ต้นทุน (บาท)" ของรางวัล เพื่อดูภาระเป็นเงิน'}</div></div>
        <div class="tile"><div class="lb">เหรียญที่แจกไป</div><div class="v num">${fmt(e.minted)}</div><div class="d">จากการเล่น (ไม่รวมคืน/แอดมิน)</div></div>
        <div class="tile"><div class="lb">เหรียญที่ใช้ไป</div><div class="v num">${fmt(e.spent)}</div><div class="d">แลกของ + Shield (หักที่คืนแล้ว)</div></div>
        <div class="tile"><div class="lb">แจก ÷ ใช้</div><div class="v num">${e.spent ? (e.minted / e.spent).toFixed(1) + '×' : '—'}</div><div class="d">มากกว่า 1 = เหรียญสะสมในระบบเพิ่มขึ้น</div></div>
        <div class="tile"><div class="lb">แอดมินปรับสุทธิ</div><div class="v num">${e.admin_net > 0 ? '+' : ''}${fmt(e.admin_net)}</div><div class="d">ดูเหตุผลที่ "ประวัติเหรียญ"</div></div>
        <div class="tile"><div class="lb">มูลค่าต่อเหรียญ</div><div class="v num">${e.thb_per_coin != null ? '฿' + (+e.thb_per_coin).toFixed(2) : '—'}</div><div class="d">เฉลี่ยจากต้นทุนของรางวัลที่เปิดอยู่</div></div>
      </div>
      <div class="grid-2">
        <section class="card"><h2>เหรียญที่แจกต่อวัน</h2><div class="chart" id="chM"></div><div class="key"><span><i style="background:var(--gold)"></i>วันนี้ (ยังไม่จบวัน)</span></div></section>
        <section class="card"><h2>เหรียญที่ใช้ต่อวัน</h2><div class="chart" id="chS"></div><div class="key"><span><i style="background:var(--gold)"></i>วันนี้ (ยังไม่จบวัน)</span></div></section>
      </div>
      <div class="cols sec2">
        <section class="card"><h2>ตามแหล่งที่มา <small>+ ได้ · − ใช้</small></h2>
          <div class="tbl-wrap flat"><table class="tbl"><thead><tr><th>รายการ</th><th>เหรียญ</th><th class="r">ครั้ง</th></tr></thead><tbody>
          ${e.sources.map(s => `<tr style="cursor:default"><td>${esc(REASON[s.reason] || s.reason)}</td><td style="min-width:160px">${hbar(Math.abs(s.coins), srcMax, `${s.coins > 0 ? '+' : ''}${fmt(s.coins)}`)}</td><td class="r num">${fmt(s.times)}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">ยังไม่มีรายการ</td></tr>'}
          </tbody></table></div></section>
        <section class="card"><h2>ได้เหรียญมากสุด <small>7 วัน · คนส่วนใหญ่ ≤ ${fmt(e.p90_week)}</small></h2>
          ${e.top.map((m, i) => `<div class="li" data-mid="${esc(m.id)}" style="cursor:pointer"><span class="rank">${i + 1}</span><div class="grow"><div class="t1">${esc(m.name)}</div><div class="t2">ID ${esc(m.citizen_id)}</div></div><b class="num">+${fmt(m.earned)}</b></div>`).join('') || '<div class="empty">ยังไม่มี</div>'}</section>
      </div>
      <section class="card sec2"><h2>ควรตรวจสอบ <small>30 วันล่าสุด · เป็นสัญญาณให้ดู ไม่ใช่หลักฐานว่าโกง</small></h2>
        ${e.flags.length ? e.flags.map(f => `<div class="li flag" data-mid="${esc(f.id)}" style="cursor:pointer"><span class="st ${f.why.length > 1 ? 'new' : 'shipping'}">${STATUS.new[1]}${f.why.length} สัญญาณ</span>
          <div class="grow"><div class="t1">${esc(f.name)} <span class="mut">· ID ${esc(f.citizen_id)}${f.suspended ? ' · ระงับแล้ว' : ''}</span></div><div class="t2 wrap">${f.why.map(esc).join(' · ')}</div></div><span class="mut">ดู ›</span></div>`).join('')
          : '<div class="empty">ไม่พบอะไรผิดปกติ 🎉</div>'}
        <p class="hint">เกณฑ์: ก้าว ≥ 40,000/วัน · วิ่งเร็วกว่า 2:47 นาที/กม. ≥ 3 กม. · วิ่ง ≥ 42 กม. หรือ ≥ 5 ชม. · ได้เหรียญ 7 วันเกิน 3 เท่าของคนส่วนใหญ่ · แลกของภายใน 3 วันหลังสมัคร · เบอร์จัดส่งซ้ำกับบัญชีอื่น</p></section>`;
    const row = k => e.daily.map(d => ({ v: d[k], label: new Date(d.day).toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short' }), short: String(new Date(d.day).getDate()) }));
    barChart($('#chM', pg), row('minted'), { name: 'เหรียญที่แจกต่อวัน', unit: 'เหรียญ' });
    barChart($('#chS', pg), row('spent'), { name: 'เหรียญที่ใช้ต่อวัน', unit: 'เหรียญ' });
    $$('[data-mid]', pg).forEach(r => r.onclick = () => openMember(r.dataset.mid));
  },
};

/* ═══════ ประกาศ & อีเวนต์ ═══════ */
PAGES.news = {
  title: 'ประกาศ & อีเวนต์',
  async render(pg) {
    const [ev, an] = await Promise.all([sb.from('campaigns').select('*').order('starts_at', { ascending: false }).limit(50), sb.from('announcements').select('*').order('starts_at', { ascending: false }).limit(50)]);
    if (ev.error) throw ev.error; if (an.error) throw an.error;
    pg.innerHTML = `<div class="grid-2">
      <section class="card"><h2>ประกาศถึงสมาชิก <button class="btn pri sm" id="addN">+ ประกาศใหม่</button></h2>
        <p class="hint" style="margin-top:-4px">ขึ้นเป็นหน้าต่างในแอปครั้งเดียวต่อคน ระหว่างเวลาที่ตั้งไว้ (ยังไม่ใช่ push — push ต้องใช้บัญชี Apple / Google)</p>
        ${an.data.map(a => `<div class="li" data-an="${esc(a.id)}" style="cursor:pointer"><div class="grow"><div class="t1">${esc(a.title)}</div><div class="t2">${dtTH(a.starts_at)} – ${dtTH(a.ends_at)}</div></div>${liveChip(live(a.starts_at, a.ends_at))}</div>`).join('') || '<div class="empty">ยังไม่มีประกาศ</div>'}</section>
      <section class="card"><h2>อีเวนต์เหรียญ <button class="btn pri sm" id="addE">+ อีเวนต์ใหม่</button></h2>
        <p class="hint" style="margin-top:-4px">ช่วงอีเวนต์ เหรียญจากเดิน นอน สวน Dream Chest และวิ่ง คูณตามที่ตั้ง (ไม่รวมโบนัสเลเวล) · มีหลายอีเวนต์พร้อมกัน ใช้ตัวคูณสูงสุด</p>
        ${ev.data.map(c => `<div class="li" data-ev="${esc(c.id)}" style="cursor:pointer"><span class="chip owner">×${+c.coin_mult}</span><div class="grow"><div class="t1">${esc(c.name)}</div><div class="t2">${dtTH(c.starts_at)} – ${dtTH(c.ends_at)}</div></div>${liveChip(live(c.starts_at, c.ends_at))}</div>`).join('') || '<div class="empty">ยังไม่มีอีเวนต์</div>'}</section></div>`;
    $('#addN', pg).onclick = () => editNews(null);
    $('#addE', pg).onclick = () => editEvent(null);
    $$('[data-an]', pg).forEach(r => r.onclick = () => editNews(an.data.find(a => a.id === r.dataset.an)));
    $$('[data-ev]', pg).forEach(r => r.onclick = () => editEvent(ev.data.find(c => c.id === r.dataset.ev)));
  },
};
const timeFields = (s, e) => `<div class="grid2"><label class="fld"><span>เริ่ม</span><input name="s" type="datetime-local" required value="${dtLocal(s)}"></label><label class="fld"><span>จบ</span><input name="e" type="datetime-local" required value="${dtLocal(e)}"></label></div>`;
const saveRow = async (table, row, id) => { const { error } = id ? await sb.from(table).update(row).eq('id', id) : await sb.from(table).insert(row); if (error) throw error; };
const delRow = async (table, id) => { const { error } = await sb.from(table).delete().eq('id', id); if (error) throw error; };
function editNews(a) {
  const m = modal(`<h3>${a ? 'แก้ประกาศ' : 'ประกาศใหม่'}</h3><p class="sub">สมาชิกเห็นเป็นหน้าต่างตอนเปิดแอป ครั้งเดียวต่อคน</p><form id="nf">
    <label class="fld"><span>หัวข้อ</span><input name="t" maxlength="80" required value="${esc(a?.title)}"></label>
    <label class="fld"><span>ข้อความ</span><textarea name="b" rows="4" maxlength="1000" required>${esc(a?.body)}</textarea></label>
    ${timeFields(a?.starts_at || Date.now(), a?.ends_at || Date.now() + 7 * 864e5)}
    <div class="acts">${a ? '<button type="button" class="btn danger" id="del" style="margin-right:auto">ลบ</button>' : ''}<button type="button" class="btn ghost" data-x>ยกเลิก</button><button class="btn pri" type="submit">บันทึก</button></div></form>`);
  $('#nf', m).onsubmit = e => { e.preventDefault(); const f = e.target; busyBtn($('[type=submit]', f), async () => {
    await saveRow('announcements', { title: f.t.value.trim(), body: f.b.value.trim(), starts_at: new Date(f.s.value).toISOString(), ends_at: new Date(f.e.value).toISOString() }, a?.id);
    closeModal(); toast('บันทึกประกาศแล้ว'); route(); }); };
  $('#del', m) && ($('#del', m).onclick = async () => { closeModal(); if (await confirmBox('ลบประกาศนี้?', esc(a.title), 'ลบ', true)) { try { await delRow('announcements', a.id); toast('ลบแล้ว'); route(); } catch (e) { oops(e); } } });
}
function editEvent(c) {
  const m = modal(`<h3>${c ? 'แก้อีเวนต์' : 'อีเวนต์เหรียญใหม่'}</h3><p class="sub">ตัวอย่าง: "ฉลองเปิดแอป เหรียญ ×2 สุดสัปดาห์นี้"</p><form id="ef">
    <label class="fld"><span>ชื่ออีเวนต์ (สมาชิกเห็น)</span><input name="n" maxlength="80" required value="${esc(c?.name)}"></label>
    <label class="fld"><span>ตัวคูณเหรียญ</span><select name="x">${[1.5, 2, 3].map(x => `<option value="${x}" ${+(c?.coin_mult || 2) === x ? 'selected' : ''}>×${x}</option>`).join('')}</select></label>
    ${timeFields(c?.starts_at || Date.now(), c?.ends_at || Date.now() + 2 * 864e5)}
    <div class="acts">${c ? `${live(c.starts_at, c.ends_at) === 'on' ? '<button type="button" class="btn" id="stop">จบตอนนี้</button>' : ''}<button type="button" class="btn danger" id="del" style="margin-right:auto">ลบ</button>` : ''}<button type="button" class="btn ghost" data-x>ยกเลิก</button><button class="btn pri" type="submit">บันทึก</button></div></form>`);
  $('#ef', m).onsubmit = e => { e.preventDefault(); const f = e.target; busyBtn($('[type=submit]', f), async () => {
    await saveRow('campaigns', { name: f.n.value.trim(), coin_mult: +f.x.value, starts_at: new Date(f.s.value).toISOString(), ends_at: new Date(f.e.value).toISOString() }, c?.id);
    closeModal(); toast('บันทึกอีเวนต์แล้ว'); route(); }); };
  $('#stop', m) && ($('#stop', m).onclick = e => busyBtn(e.currentTarget, async () => { await saveRow('campaigns', { ends_at: new Date().toISOString() }, c.id); closeModal(); toast('จบอีเวนต์แล้ว'); route(); }));
  $('#del', m) && ($('#del', m).onclick = async () => { closeModal(); if (await confirmBox('ลบอีเวนต์นี้?', esc(c.name), 'ลบ', true)) { try { await delRow('campaigns', c.id); toast('ลบแล้ว'); route(); } catch (e) { oops(e); } } });
}

/* ═══════ กติกาเกม ═══════ */
const RULES = [
  ['เหรียญรายวัน', [['coin_walk', 'เดินครบ 7,000 ก้าว', 'เหรียญ'], ['coin_sleep', 'นอน 7–9 ชม.', 'เหรียญ'], ['garden_max', 'เหรียญในสวนสูงสุดต่อวัน', 'เหรียญ'], ['chest_min', 'Dream Chest ต่ำสุด', 'เหรียญ'], ['chest_max', 'Dream Chest สูงสุด', 'เหรียญ']]],
  ['การวิ่ง', [['run_coin', 'เหรียญต่อการวิ่ง 1 ครั้ง', 'เหรียญ'], ['run_rewards_per_day', 'ได้รางวัลวิ่งสูงสุดต่อวัน', 'ครั้ง'], ['run_min_m', 'ระยะขั้นต่ำที่ได้รางวัล', 'เมตร']]],
  ['อื่น ๆ', [['level_bonus', 'โบนัสทุก 5 เลเวล', 'เหรียญ'], ['shield_cost', 'ราคา Streak Shield', 'เหรียญ']]],
];
const ruleName = k => k === 'require_admin_mfa' ? 'บังคับยืนยัน 2 ขั้น' : RULES.flatMap(r => r[1]).find(r => r[0] === k)?.[1] || k;
PAGES.rules = {
  title: 'กติกาเกม',
  async render(pg) {
    const S = await rpc('admin_settings'), own = ME.role === 'owner';
    pg.innerHTML = `<div class="cols"><form class="card" id="rf"><h2>ค่าที่ปรับได้ <small>${own ? 'มีผลทันทีกับทุกคน' : 'เจ้าของเท่านั้นที่แก้ได้'}</small></h2>
      ${RULES.map(([g, rows]) => `<div class="sec"><h4>${g}</h4>${rows.map(([k, n, u]) => `<div class="rule"><label for="r_${k}">${n}</label><input class="in num" id="r_${k}" name="${k}" type="number" min="0" step="1" value="${+S[k]?.value}" ${own ? '' : 'disabled'}><span class="mut">${u}</span></div>`).join('')}</div>`).join('')}
      ${own ? '<div class="acts" style="display:flex;justify-content:flex-end;margin-top:14px"><button class="btn pri" type="submit">บันทึกการเปลี่ยนแปลง</button></div>' : ''}</form>
      <div class="stack"><section class="card"><h2>สิ่งที่แก้ที่นี่ไม่ได้</h2><p class="hint" style="margin:0">สูตร Life Power (ก้าว 40 + นอน 40 + ลูบน้อง/ส่งพลังใจ 20 × ตัวคูณ Streak), การสลายของ LP และเลเวล เป็นไปตามเอกสาร "Life power ในฟีเจอร์ hero hall" — เปลี่ยนต้องแก้โค้ดเซิร์ฟเวอร์</p></section>
        <section class="card"><h2>ยืนยันตัวตน 2 ขั้น (บังคับทั้งทีม)</h2>
          <p class="hint" style="margin-top:0">เปิดแล้ว ทุกคนในทีมต้องใช้รหัส 6 หลักจากแอป Authenticator ทุกครั้งที่เข้าหลังบ้าน ให้ทุกคนตั้งค่าที่หน้า "ทีมงาน" ก่อนเปิด</p>
          <label class="sw"><input type="checkbox" id="mfaReq" ${+S.require_admin_mfa?.value ? 'checked' : ''} ${own ? '' : 'disabled'}><i></i>บังคับยืนยัน 2 ขั้น</label></section>
        <section class="card"><h2>แก้ล่าสุด</h2>${Object.entries(S).filter(([, v]) => v.by).sort((a, b) => b[1].updated_at.localeCompare(a[1].updated_at)).slice(0, 5).map(([k, v]) => `<div class="li"><div class="grow"><div class="t1">${esc(ruleName(k))} = ${k === 'require_admin_mfa' ? (+v.value ? 'เปิด' : 'ปิด') : +v.value}</div><div class="t2">${esc(v.by)} · ${dtTH(v.updated_at)}</div></div></div>`).join('') || '<div class="empty">ยังเป็นค่าเริ่มต้น</div>'}</section></div></div>`;
    if (!own) return;
    $('#rf', pg).onsubmit = e => { e.preventDefault(); busyBtn($('[type=submit]', e.target), async () => {
      const changed = RULES.flatMap(r => r[1]).map(r => r[0]).filter(k => +e.target[k].value !== +S[k].value);
      if (!changed.length) return toast('ยังไม่ได้เปลี่ยนค่าไหน');
      // chest min / max are checked against each other on the server: going up, save the max first; going down, the min first
      const up = +e.target.chest_min.value > +S.chest_max.value;
      changed.sort((a, b) => ((b === 'chest_max') - (a === 'chest_max')) * (up ? 1 : -1));
      for (const k of changed) await rpc('admin_set_setting', { p_key: k, p_value: +e.target[k].value });
      toast(`บันทึก ${changed.length} ค่าแล้ว`); route(); }); };
    $('#mfaReq', pg).onchange = async e => {
      const on = e.target.checked;
      if (on && !(await confirmBox('บังคับยืนยัน 2 ขั้น?', 'ทุกคนในทีมที่ยังไม่ได้ตั้งค่า Authenticator จะเข้าหลังบ้านไม่ได้จนกว่าจะตั้งค่า', 'เปิดใช้'))) { e.target.checked = false; return; }
      try { await rpc('admin_set_setting', { p_key: 'require_admin_mfa', p_value: on ? 1 : 0 }); toast(on ? 'บังคับยืนยัน 2 ขั้นแล้ว' : 'ปิดการบังคับแล้ว'); ME = await rpc('admin_me'); }
      catch (err) { e.target.checked = !on; oops(err); }
    };
  },
};

/* ═══════ รายงานผู้ใช้ (from Hero Hall: a name or photo that isn't OK) ═══════ */
const RQ = { status: 'open', offset: 0 };
const WHY = { photo: 'รูปโปรไฟล์ไม่เหมาะสม', name: 'ชื่อไม่เหมาะสม', other: 'อื่น ๆ' };
const DID = { dismiss: 'ปิด (ไม่ผิด)', clear_photo: 'ลบรูปโปรไฟล์', reset_name: 'รีเซ็ตชื่อ', suspend: 'ระงับบัญชี' };
PAGES.reports = {
  title: 'รายงานผู้ใช้',
  async render(pg) {
    const r = await rpc('admin_reports', { p_status: RQ.status, p_limit: PAGE, p_offset: RQ.offset });
    pg.innerHTML = `<div class="bar"><div class="seg" id="seg">${[['open', `รอตรวจ${r.open ? ` (${fmt(r.open)})` : ''}`], ['done', 'จัดการแล้ว'], ['dismissed', 'ไม่ผิด'], ['', 'ทั้งหมด']].map(([k, n]) => `<button data-s="${k}" class="${RQ.status === k ? 'on' : ''}">${n}</button>`).join('')}</div>
      <span class="mut" style="font-size:13.5px">สมาชิกรายงานชื่อหรือรูปใน Hero Hall · ควรตรวจภายใน 24 ชม. · คนที่ถูกรายงานไม่เห็นว่าใครรายงาน</span></div>
      ${r.rows.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>ผู้ถูกรายงาน</th><th>เหตุผล</th><th>ผู้รายงาน</th><th>เมื่อ</th><th>${RQ.status === 'open' ? '' : 'ผล'}</th></tr></thead><tbody>
        ${r.rows.map(x => `<tr data-r="${x.id}" style="cursor:default"><td><div class="who" data-id="${esc(x.target.id)}" style="cursor:pointer"><img class="av" src="${esc(avatar(x.target.avatar))}" alt=""><div><b>${esc(x.target.name)}</b><small>ID ${esc(x.target.citizen_id)}${x.target.open_reports > 1 ? ` · <span class="neg">รอตรวจ ${x.target.open_reports} รายงาน</span>` : ''}${x.target.suspended_at ? ' · <span class="neg">ระงับอยู่</span>' : ''}</small></div></div></td>
          <td class="wrap" style="min-width:150px"><b>${esc(WHY[x.reason] || x.reason)}</b>${x.note ? `<br><span class="mut">${esc(x.note)}</span>` : ''}</td>
          <td>${x.reporter ? `${esc(x.reporter.name)} <small class="mut">ID ${esc(x.reporter.citizen_id)}</small>` : '<span class="mut">ลบบัญชีแล้ว</span>'}</td><td class="mut">${dtTH(x.created_at)}</td>
          <td>${x.status === 'open' ? `<div class="row" style="flex-wrap:wrap;gap:6px">${x.target.avatar ? '<button class="btn sm" data-a="clear_photo">ลบรูป</button>' : ''}<button class="btn sm" data-a="reset_name">รีเซ็ตชื่อ</button>
              ${ME.role === 'owner' && !x.target.suspended_at ? '<button class="btn danger sm" data-a="suspend">ระงับบัญชี</button>' : ''}<button class="btn ghost sm" data-a="dismiss">ไม่ผิด</button></div>`
            : `${esc(DID[x.action] || x.action || '')}<br><small class="mut">${x.handled_by ? esc(x.handled_by) + ' · ' : ''}${x.handled_at ? dtTH(x.handled_at) : ''}</small>`}</td></tr>`).join('')}
        </tbody></table></div>${pager(r.total, RQ)}` : `<div class="card empty">${RQ.status === 'open' ? 'ไม่มีรายงานที่รอตรวจ' : 'ยังไม่มีรายงาน'}</div>`}`;
    $$('#seg button', pg).forEach(b => b.onclick = () => { RQ.status = b.dataset.s; RQ.offset = 0; route(); });
    $$('.who[data-id]', pg).forEach(w => w.onclick = () => openMember(w.dataset.id));
    $$('[data-a]', pg).forEach(b => b.onclick = async () => {
      const x = r.rows.find(y => String(y.id) === b.closest('tr').dataset.r), a = b.dataset.a, nm = esc(x.target.name);
      let reason = '';
      if (a === 'suspend') { const v = await askForm('ระงับบัญชี?', `${nm} จะถูกออกจากระบบทุกเครื่อง เข้าใหม่ไม่ได้ และหายจาก Hero Hall จนกว่าจะยกเลิก`, [{ name: 'why', label: 'เหตุผล (บันทึกไว้)', value: `ถูกรายงาน: ${WHY[x.reason]}` }], 'ระงับบัญชี', true); if (!v) return; reason = v.why; }
      else if (!(await confirmBox({ clear_photo: 'ลบรูปโปรไฟล์?', reset_name: 'รีเซ็ตชื่อ?', dismiss: 'ปิดรายงานนี้?' }[a],
        { clear_photo: `รูปของ ${nm} จะกลับเป็นรูปเริ่มต้น`, reset_name: `ชื่อของ ${nm} จะเปลี่ยนเป็น "พลเมือง #${esc(x.target.citizen_id)}" (เจ้าตัวตั้งชื่อใหม่ได้)`, dismiss: 'ไม่พบสิ่งที่ผิด ปิดรายงานนี้โดยไม่เปลี่ยนอะไร' }[a], 'ยืนยัน', a !== 'dismiss'))) return;
      try { await rpc('admin_resolve_report', { p_id: x.id, p_action: a, p_reason: reason }); toast(a === 'dismiss' ? 'ปิดรายงานแล้ว' : `${DID[a]}แล้ว · ปิดรายงานของคนนี้ทั้งหมด`); refreshBadge(); route(); } catch (e) { oops(e); }
    });
    bindPager(pg, RQ);
  },
};

/* ═══════ บันทึกการกระทำ ═══════ */
const ACT = { order: 'คำสั่งแลก', 'orders.bulk_read': 'เปิดคำสั่งแลกจำนวนมาก', 'coupons.export': 'ดูโค้ดที่แจกแล้ว', 'team.approve_mfa': 'อนุมัติยืนยัน 2 ขั้น', 'products.insert': 'เพิ่มของรางวัล', 'products.update': 'แก้ของรางวัล', 'products.delete': 'ลบของรางวัล', 'coupons.add': 'เพิ่มโค้ดคูปอง', 'coupons.clear': 'ลบโค้ดที่ยังไม่แจก',
  adjust_coins: 'ปรับเหรียญ', suspend: 'ระงับบัญชี', unsuspend: 'ยกเลิกระงับ', set_streak: 'ตั้ง Streak', delete_member: 'ลบบัญชีสมาชิก', export_member: 'ส่งออกข้อมูลสมาชิก', view_health: 'ดูข้อมูลสุขภาพ',
  setting: 'แก้กติกา', 'campaigns.insert': 'สร้างอีเวนต์', 'campaigns.update': 'แก้อีเวนต์', 'campaigns.delete': 'ลบอีเวนต์', 'announcements.insert': 'สร้างประกาศ', 'announcements.update': 'แก้ประกาศ', 'announcements.delete': 'ลบประกาศ',
  team: 'จัดการทีม', export_orders: 'ดาวน์โหลดคำสั่งแลก', print_labels: 'พิมพ์ใบปะหน้า', export_coupons: 'ดาวน์โหลดโค้ดคูปอง',
  'report.dismiss': 'ปิดรายงาน (ไม่ผิด)', 'report.clear_photo': 'ลบรูปโปรไฟล์ (รายงาน)', 'report.reset_name': 'รีเซ็ตชื่อ (รายงาน)', 'report.suspend': 'ระงับบัญชี (รายงาน)' };
const AQ = { action: '', offset: 0 };
const detail = l => { const d = l.detail || {};
  if (l.action === 'order') return `${STATUS[d.from]?.[0] || d.from} → ${STATUS[d.to]?.[0] || d.to}${d.tracking ? ` · พัสดุ ${d.tracking}` : ''}`;
  if (l.action === 'setting') return `${ruleName(l.target)}: ${d.from} → ${d.to}`;
  if (l.action === 'adjust_coins') return `${d.delta > 0 ? '+' : ''}${d.delta} เหรียญ · ${d.reason}`;
  if (l.action.endsWith('.update')) return Object.entries(d).map(([k, v]) => `${k}: ${JSON.stringify(v[0])} → ${JSON.stringify(v[1])}`).join(' · ').slice(0, 160);
  return Object.entries(d).filter(([k]) => !['id', 'created_by', 'created_at'].includes(k)).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ').slice(0, 160); };
PAGES.audit = {
  title: 'บันทึกการกระทำ',
  async render(pg) {
    const r = await rpc('admin_audit', { p_action: AQ.action, p_limit: PAGE, p_offset: AQ.offset });
    pg.innerHTML = `<div class="bar"><select class="in" id="act" style="max-width:280px"><option value="">ทุกการกระทำ</option>${Object.entries(ACT).map(([k, n]) => `<option value="${k}" ${AQ.action === k ? 'selected' : ''}>${n}</option>`).join('')}</select>
      <span class="mut" style="font-size:13.5px">ทุกการเปลี่ยนแปลงในหลังบ้าน และทุกครั้งที่มีคนเปิดดูข้อมูลสุขภาพรายวัน (PDPA)</span></div>
      ${r.rows.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>เวลา</th><th>ใคร</th><th>ทำอะไร</th><th>กับ</th><th>รายละเอียด</th></tr></thead><tbody>
        ${r.rows.map(l => `<tr ${l.member_id ? `data-id="${esc(l.target)}"` : 'style="cursor:default"'}><td class="mut">${dtTH(l.at)}</td><td>${esc(l.admin_email || '—')}</td><td>${esc(ACT[l.action] || l.action)}</td>
          <td>${l.member ? `${esc(l.member)} <small class="mut">ID ${esc(l.member_id)}</small>` : esc(l.target || '')}</td><td class="mut wrap">${esc(detail(l))}</td></tr>`).join('')}
        </tbody></table></div>${pager(r.total, AQ)}` : '<div class="card empty">ยังไม่มีบันทึก</div>'}`;
    $('#act', pg).onchange = e => { AQ.action = e.target.value; AQ.offset = 0; route(); };
    $$('tr[data-id]', pg).forEach(tr => tr.onclick = () => openMember(tr.dataset.id));
    bindPager(pg, AQ);
  },
};

/* ═══════ ทีมงาน (+ 2-step sign-in for me) ═══════ */
PAGES.team = {
  title: 'ทีมงานหลังบ้าน',
  async render(pg) {
    const [t, f] = await Promise.all([rpc('admin_team'), sb.auth.mfa.listFactors()]);
    const own = ME.role === 'owner', mine = (f.data?.totp || []).filter(x => x.status === 'verified');
    pg.innerHTML = `<div class="cols"><section class="card"><h2>ผู้มีสิทธิ์เข้าหลังบ้าน <small>${t.length} คน</small></h2>
      <div class="tbl-wrap flat"><table class="tbl"><thead><tr><th>อีเมล</th><th>สิทธิ์</th><th>ข้อมูลสุขภาพรายวัน</th><th>ยืนยัน 2 ขั้น</th>${own ? '<th></th>' : ''}</tr></thead><tbody>
      ${t.map(a => { const me = a.email === ME.email; return `<tr style="cursor:default"><td>${esc(a.email)}${me ? ' <span class="mut">(คุณ)</span>' : ''}<br><small class="mut">เพิ่มเมื่อ ${dyTH(a.created_at)}</small></td>
        <td>${own && !me ? `<select class="in sm" data-role="${esc(a.email)}"><option value="staff" ${a.role === 'staff' ? 'selected' : ''}>ทีมงาน</option><option value="owner" ${a.role === 'owner' ? 'selected' : ''}>เจ้าของ</option></select>` : `<span class="chip ${a.role === 'owner' ? 'owner' : ''}">${a.role === 'owner' ? 'เจ้าของ' : 'ทีมงาน'}</span>`}</td>
        <td>${a.role === 'owner' ? '<span class="mut">เห็น (เจ้าของ)</span>' : own ? `<label class="sw"><input type="checkbox" data-health="${esc(a.email)}" ${a.can_health ? 'checked' : ''}><i></i>${a.can_health ? 'เห็น' : 'ไม่เห็น'}</label>` : (a.can_health ? 'เห็น' : 'ไม่เห็น')}</td>
        <td>${!a.mfa ? `<span class="st cancelled">${STATUS.cancelled[1]}ยังไม่เปิด</span>` : ME.mfa_required && !a.mfa_trusted
          ? `<span class="st new">${STATUS.new[1]}รออนุมัติ</span>${own && !me ? ` <button class="btn sm" data-ok-mfa="${esc(a.email)}">อนุมัติ</button>` : ''}` : `<span class="st done">${STATUS.done[1]}เปิดแล้ว</span>`}</td>
        ${own ? `<td class="r">${me ? '' : `<button class="btn ghost sm" data-rm="${esc(a.email)}">ลบสิทธิ์</button>`}</td>` : ''}</tr>`; }).join('')}
      </tbody></table></div></section>
      <div class="stack">
        <section class="card" id="mfaCard"><h2>ยืนยันตัวตน 2 ขั้นของฉัน</h2>
          ${mine.length ? `<p class="hint" style="margin-top:0"><span class="st done">${STATUS.done[1]}เปิดใช้แล้ว</span> ใช้รหัส 6 หลักจากแอป Authenticator ทุกครั้งที่เข้าหลังบ้าน</p><button class="btn danger sm" id="mfaOff">ปิดการยืนยัน 2 ขั้น</button>`
            : `<p class="hint" style="margin-top:0">กันคนอื่นเข้าหลังบ้านด้วยรหัสผ่านที่หลุด ใช้แอป Google Authenticator / Microsoft Authenticator / 1Password ก็ได้</p><button class="btn pri" id="mfaOn">ตั้งค่ายืนยัน 2 ขั้น</button>`}</section>
        ${own ? `<section class="card"><h2>เพิ่มคนในทีม</h2><form id="addT"><label class="fld"><span>อีเมล</span><input name="email" type="email" required placeholder="อีเมลที่สมัครในแอปไว้แล้ว"></label>
          <label class="fld"><span>สิทธิ์</span><select name="role"><option value="staff">ทีมงาน — ภาพรวม คำสั่งแลก ของรางวัล ประกาศ ค้นหาสมาชิก</option><option value="owner">เจ้าของ — ทุกอย่าง + ปรับเหรียญ ระงับบัญชี กติกา ทีม</option></select></label>
          <label class="sw" style="margin-bottom:14px"><input type="checkbox" name="health"><i></i>ให้เห็นข้อมูลสุขภาพรายวันของสมาชิก</label>
          <button class="btn pri" type="submit">เพิ่มสิทธิ์</button></form></section>` : ''}
        <section class="card"><h2>สิทธิ์แต่ละแบบ</h2><dl class="kv"><dt>ทีมงาน</dt><dd>ภาพรวม การเติบโต เศรษฐกิจเหรียญ · จัดการคำสั่งแลก ของรางวัล คูปอง ประกาศ อีเวนต์ · ค้นหาสมาชิก</dd><dt>เจ้าของ</dt><dd>ทุกอย่าง + ปรับเหรียญ ระงับ/ลบบัญชี ส่งออกข้อมูลสมาชิก ตั้ง Streak แก้กติกา จัดการทีม</dd><dt>ข้อมูลสุขภาพ</dt><dd>ก้าว การนอน หัวใจ รายวันของสมาชิก เป็นข้อมูลอ่อนไหวตาม PDPA เปิดให้เฉพาะคนที่จำเป็น ทุกครั้งที่เปิดดูถูกบันทึก</dd></dl></section></div></div>`;
    const set = (email, role, health, el) => busyBtn(el, async () => { await rpc('admin_set_team', { p_email: email, p_role: role, p_can_health: health }); toast(role ? 'บันทึกสิทธิ์แล้ว' : 'ลบสิทธิ์แล้ว'); route(); });
    $('#addT', pg) && ($('#addT', pg).onsubmit = e => { e.preventDefault(); const f2 = e.target; set(f2.email.value.trim(), f2.role.value, f2.health.checked, $('button', f2)); });
    $$('[data-role]', pg).forEach(s => s.onchange = () => set(s.dataset.role, s.value, null, s));
    $$('[data-health]', pg).forEach(c => c.onchange = () => set(c.dataset.health, t.find(a => a.email === c.dataset.health).role, c.checked, c));
    $$('[data-ok-mfa]', pg).forEach(b => b.onclick = async () => {
      if (!(await confirmBox('อนุมัติยืนยัน 2 ขั้น?', `ตรวจกับ ${esc(b.dataset.okMfa)} ก่อนว่าเพิ่งตั้งค่าแอป Authenticator เอง (ไม่ใช่คนอื่นที่ได้รหัสผ่านไป)`, 'อนุมัติ'))) return;
      busyBtn(b, async () => { await rpc('admin_approve_mfa', { p_email: b.dataset.okMfa }); toast('อนุมัติแล้ว'); route(); });
    });
    $$('[data-rm]', pg).forEach(b => b.onclick = async () => { if (await confirmBox('ลบสิทธิ์หลังบ้าน?', `${esc(b.dataset.rm)} จะเข้าหลังบ้านไม่ได้อีก (บัญชีในแอปยังอยู่)`, 'ลบสิทธิ์', true)) set(b.dataset.rm, '', null, b); });
    $('#mfaOn', pg) && ($('#mfaOn', pg).onclick = () => enrollMfa(() => route()));
    $('#mfaOff', pg) && ($('#mfaOff', pg).onclick = async e => {
      if (ME.mfa_required) return toast('ทีมบังคับยืนยัน 2 ขั้นอยู่ ปิดของตัวเองไม่ได้', true);
      if (!(await confirmBox('ปิดการยืนยัน 2 ขั้น?', 'บัญชีหลังบ้านของคุณจะใช้แค่รหัสผ่าน', 'ปิด', true))) return;
      busyBtn(e.currentTarget, async () => { for (const x of mine) { const { error } = await sb.auth.mfa.unenroll({ factorId: x.id }); if (error) throw error; } toast('ปิดแล้ว'); route(); });
    });
  },
};

/* ── 2-step sign-in (TOTP): set up, and the code at sign-in ── */
async function enrollMfa(done) {
  const old = (await sb.auth.mfa.listFactors()).data?.all?.filter(x => x.status !== 'verified') || [];
  for (const x of old) await sb.auth.mfa.unenroll({ factorId: x.id });   // a set-up that was never finished
  const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: `eli-admin-${Date.now().toString(36)}` });
  if (error) return oops(error);
  const m = modal(`<h3>ตั้งค่ายืนยัน 2 ขั้น</h3><p class="sub">1. เปิดแอป Authenticator แล้วสแกน QR นี้ · 2. ใส่รหัส 6 หลักที่แอปแสดง</p>
    <div class="qr"><img src="${esc(data.totp.qr_code)}" alt="QR code"></div><p class="hint" style="text-align:center">สแกนไม่ได้? ใส่รหัสนี้ในแอปแทน<br><code class="sec-code">${esc(data.totp.secret)}</code></p>
    <form id="mf"><label class="fld"><span>รหัส 6 หลัก</span><input name="c" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="\\d{6}" required></label>
    <div class="acts"><button type="button" class="btn ghost" data-x>ยกเลิก</button><button class="btn pri" type="submit">ยืนยัน</button></div></form>`);
  $('#mf', m).onsubmit = e => { e.preventDefault(); busyBtn($('[type=submit]', e.target), async () => {
    const { error: err } = await sb.auth.mfa.challengeAndVerify({ factorId: data.id, code: e.target.c.value.trim() });
    if (err) throw new Error(/invalid|expired/i.test(err.message) ? 'รหัสไม่ถูกต้องหรือหมดเวลา ลองรหัสใหม่' : err.message);
    closeModal(); toast('เปิดยืนยัน 2 ขั้นแล้ว'); ME = await rpc('admin_me'); done && done(); }); };
}
// after the password: ask for the 6-digit code when this account has 2-step on (or the team requires it)
async function mfaGate() {
  const { data: lv } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  if (lv?.currentLevel === 'aal2') return true;
  const f = (await sb.auth.mfa.listFactors()).data?.totp?.find(x => x.status === 'verified');
  if (!f) {
    if (!ME?.mfa_required) return true;
    showLogin(); $('#loginErr').textContent = 'ทีมบังคับยืนยัน 2 ขั้น — ตั้งค่าก่อนเข้าใช้';
    enrollMfa(() => start()); return false;
  }
  showLogin(); const card = $('#loginForm');
  card.dataset.mfa = f.id;
  $('#loginErr').textContent = '';
  card.querySelector('.mfa-step')?.remove();
  card.insertAdjacentHTML('beforeend', `<div class="mfa-step"><label class="fld"><span>รหัส 6 หลักจากแอป Authenticator</span><input id="mfaCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6"></label><button class="btn pri wide" type="button" id="mfaGo">ยืนยัน</button></div>`);
  $$('.fld, .btn.pri.wide:not(#mfaGo), #forgot', card).forEach(x => { if (!x.closest('.mfa-step')) x.hidden = true; });
  $('#mfaCode').focus();
  const go = () => busyBtn($('#mfaGo'), async () => {
    const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: f.id, code: $('#mfaCode').value.trim() });
    if (error) { $('#loginErr').textContent = 'รหัสไม่ถูกต้องหรือหมดเวลา ลองรหัสใหม่'; return; }
    location.reload();
  });
  $('#mfaGo').onclick = go; $('#mfaCode').onkeydown = e => { if (e.key === 'Enter') go(); };
  return false;
}

start();
