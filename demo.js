/* Eli's World back office — DEMO MODE (no server).
   Stands in for the Supabase client: the real database rules (backend/supabase/migrations) run in this browser
   on Postgres compiled to WebAssembly (PGlite) with the sample data, kept in this browser's storage only.
   Sign-in, 2-step codes and the parts of Supabase the admin uses are imitated here; nothing leaves the browser. */
(() => {
  const BUILD = '202610251357';                       // build.mjs: a new bundle starts a fresh demo database
  const STORE = 'eli-admin-demo', SKEY = 'eli_admin_demo_auth';
  const USERS = { 'admin@eli.test': 'eliadmin123', 'staff@eli.test': 'elistaff123' };   // members: eliworld123
  const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} };

  /* ── the database ── */
  let ready;
  const boot = () => ready || (ready = (async () => {
    const { PGlite } = await import('./vendor/pglite/index.js');
    let db;
    try { db = await PGlite.create('idb://' + STORE); } catch (e) { db = await PGlite.create(); }   // private windows: memory only
    const has = (await db.query("select to_regclass('public.profiles') is not null as ok")).rows[0].ok;
    if (!has || lsGet('eli_admin_demo_build') !== BUILD) {   // db.sql starts by clearing what an older demo left
      await db.exec(await (await fetch('demo/db.sql?b=' + BUILD)).text());
      lsSet('eli_admin_demo_build', BUILD); lsSet(SKEY, null);
    }
    return db;
  })());

  // values become quoted literals; Postgres reads each one as the type the column or argument wants
  const q = s => `'${String(s).replace(/'/g, "''")}'`;
  const lit = v => v == null ? 'null'
    : Array.isArray(v) ? q('{' + v.map(x => x == null ? 'NULL' : '"' + String(x).replace(/[\\"]/g, '\\$&') + '"').join(',') + '}')
    : typeof v === 'object' ? q(JSON.stringify(v)) : q(v);
  const ident = s => { if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error('bad name ' + s); return s; };
  const err = e => ({ message: e?.message || String(e), code: e?.code });

  const session = () => { try { return JSON.parse(lsGet(SKEY) || 'null'); } catch (e) { return null; } };
  // every call runs as the signed-in person, under the same row rules as the real server
  const asUser = async job => {
    const db = await boot(), s = session();
    return db.transaction(async tx => {
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(s ? { sub: s.user.id, email: s.user.email, role: 'authenticated', aal: s.aal } : { role: 'anon' })]);
      await tx.exec(`set local role ${s ? 'authenticated' : 'anon'}`);
      return job(tx);
    });
  };
  const sys = async (sql, params) => (await (await boot()).query(sql, params)).rows;

  /* ── table queries (the few the admin makes) ── */
  class Query {
    constructor(table) { this.t = ident(table); this.kind = 'select'; this.where = []; this.ord = []; this.lim = null; }
    select() { return this; }
    insert(row) { this.kind = 'insert'; this.row = row; return this; }
    update(row) { this.kind = 'update'; this.row = row; return this; }
    delete() { this.kind = 'delete'; return this; }
    eq(c, v) { this.where.push(`${ident(c)} = ${lit(v)}`); return this; }
    order(c, o) { this.ord.push(`${ident(c)} ${o?.ascending === false ? 'desc' : 'asc'}`); return this; }
    limit(n) { this.lim = Math.max(0, n | 0); return this; }
    sql() {
      const w = this.where.length ? ' where ' + this.where.join(' and ') : '', T = 'public.' + this.t;
      const cols = r => Object.keys(r).map(ident), vals = r => Object.values(r).map(lit);
      if (this.kind === 'insert') return `insert into ${T} (${cols(this.row).join(',')}) values (${vals(this.row).join(',')})`;
      if (this.kind === 'update') return `update ${T} set ${cols(this.row).map((c, i) => `${c} = ${vals(this.row)[i]}`).join(', ')}${w}`;
      if (this.kind === 'delete') return `delete from ${T}${w}`;
      return `select * from ${T}${w}${this.ord.length ? ' order by ' + this.ord.join(', ') : ''}${this.lim != null ? ' limit ' + this.lim : ''}`;
    }
    async run() {
      try {
        const rows = await asUser(async tx => (await tx.query(this.sql())).rows);
        return { data: this.kind === 'select' ? rows : null, error: null };
      } catch (e) { return { data: null, error: err(e) }; }
    }
    then(ok, bad) { return this.run().then(ok, bad); }
  }

  /* ── 2-step codes (TOTP, RFC 6238) ── */
  const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const b32enc = bytes => { let bits = '', out = ''; bytes.forEach(b => bits += b.toString(2).padStart(8, '0')); for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)]; return out; };
  const b32dec = s => { let bits = ''; for (const c of s) bits += B32.indexOf(c).toString(2).padStart(5, '0'); return new Uint8Array(bits.match(/.{8}/g).map(b => parseInt(b, 2))); };
  const totp = async (secret, step) => {
    const key = await crypto.subtle.importKey('raw', b32dec(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
    const msg = new DataView(new ArrayBuffer(8)); msg.setUint32(4, step);
    const h = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg)), o = h[19] & 15;
    return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, '0');
  };
  const codeOk = async (secret, code) => { const now = Math.floor(Date.now() / 30000); for (const d of [0, -1, 1]) if (await totp(secret, now + d) === code) return true; return false; };
  const qr = text => { const q = qrcode(0, 'M'); q.addData(text); q.make(); return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(q.createSvgTag({ cellSize: 5, margin: 2, scalable: true })); };
  const factors = async () => {
    const s = session(); if (!s) return [];
    return (await sys('select id, friendly_name, factor_type, status, created_at, updated_at from auth.mfa_factors where user_id = $1 order by created_at', [s.user.id]));
  };

  const auth = {
    async getSession() { await boot(); const s = session(); return { data: { session: s }, error: null }; },
    async signInWithPassword({ email, password }) {
      email = String(email || '').trim().toLowerCase();
      const u = (await sys('select id, email, banned_until from auth.users where lower(email) = $1', [email]))[0];
      const pass = USERS[email] || (/^member\d+@eli\.test$/.test(email) ? 'eliworld123' : null);
      if (!u || password !== pass) return { data: {}, error: { message: 'รหัสผ่านหรืออีเมลไม่ถูกต้อง' } };
      if (u.banned_until && new Date(u.banned_until) > new Date()) return { data: {}, error: { message: 'บัญชีนี้ถูกระงับ' } };
      await sys('update auth.users set last_sign_in_at = now() where id = $1', [u.id]);
      const s = { user: { id: u.id, email: u.email }, aal: 'aal1' }; lsSet(SKEY, JSON.stringify(s));
      return { data: { session: s, user: s.user }, error: null };
    },
    async signOut() { lsSet(SKEY, null); return { error: null }; },
    async resetPasswordForEmail() { return { data: null, error: { message: 'โหมดเดโมไม่ส่งอีเมล — ใช้รหัสผ่านเดโมได้เลย' } }; },
    mfa: {
      async listFactors() { const all = (await factors()).map(f => ({ ...f, factor_type: 'totp' })); return { data: { all, totp: all.filter(f => f.status === 'verified') }, error: null }; },
      async getAuthenticatorAssuranceLevel() {
        const s = session(), v = (await factors()).some(f => f.status === 'verified');
        return { data: { currentLevel: s?.aal || null, nextLevel: v ? 'aal2' : 'aal1' }, error: null };
      },
      async enroll({ friendlyName }) {
        const s = session(); if (!s) return { data: null, error: { message: 'not signed in' } };
        const secret = b32enc(crypto.getRandomValues(new Uint8Array(20)));
        const id = (await sys("insert into auth.mfa_factors (user_id, friendly_name, status, secret) values ($1, $2, 'unverified', $3) returning id", [s.user.id, friendlyName || 'totp', secret]))[0].id;
        const uri = `otpauth://totp/${encodeURIComponent("Eli's World admin (demo)")}:${encodeURIComponent(s.user.email)}?secret=${secret}&issuer=${encodeURIComponent("Eli's World demo")}`;
        return { data: { id, type: 'totp', totp: { qr_code: qr(uri), secret, uri } }, error: null };
      },
      async challengeAndVerify({ factorId, code }) {
        const s = session(), f = s && (await sys('select id, secret, status from auth.mfa_factors where id = $1 and user_id = $2', [factorId, s.user.id]))[0];
        if (!f || !(await codeOk(f.secret, String(code || '')))) return { data: null, error: { message: 'Invalid TOTP code entered' } };
        if (f.status !== 'verified') await sys("update auth.mfa_factors set status = 'verified', updated_at = now() where id = $1", [f.id]);
        s.aal = 'aal2'; lsSet(SKEY, JSON.stringify(s));
        return { data: {}, error: null };
      },
      async unenroll({ factorId }) {
        const s = session(); if (!s) return { error: { message: 'not signed in' } };
        await sys('delete from auth.mfa_factors where id = $1 and user_id = $2', [factorId, s.user.id]);
        if (!(await factors()).some(f => f.status === 'verified')) { s.aal = 'aal1'; lsSet(SKEY, JSON.stringify(s)); }
        return { data: {}, error: null };
      },
    },
  };

  const client = {
    auth,
    from: t => new Query(t),
    async rpc(fn, args = {}) {
      try {
        const named = Object.entries(args || {}).map(([k, v]) => `${ident(k)} => ${lit(v)}`).join(', ');
        const rows = await asUser(async tx => (await tx.query(`select public.${ident(fn)}(${named}) as r`)).rows);
        return { data: rows[0]?.r ?? null, error: null };
      } catch (e) { return { data: null, error: err(e) }; }
    },
    storage: { from: () => ({
      upload: async () => ({ data: null, error: { message: 'โหมดเดโมอัปโหลดรูปไม่ได้ — เลือกรูปจากแอปด้านบนแทน' } }),
      getPublicUrl: p => ({ data: { publicUrl: '' } }),
    }) },
  };

  // the first visit downloads the database engine and builds the sample data (a few seconds)
  const wait = document.createElement('div');
  wait.style.cssText = 'position:fixed;inset:0;z-index:80;display:grid;place-items:center;padding:16px;background:#F4EFE6;font:500 15px "Noto Sans Thai",system-ui,sans-serif;color:#2A3B9C;text-align:center';
  wait.innerHTML = '<div><i class="spin" style="display:block;margin:0 auto 12px;width:28px;height:28px;border-width:3px"></i>กำลังเตรียมหลังบ้านเดโม…<br><small style="color:#6B6A75">ครั้งแรกใช้เวลาสักครู่</small></div>';
  document.body.append(wait);
  boot().then(() => wait.remove(), e => { console.error(e); wait.innerHTML = 'เปิดหลังบ้านเดโมไม่ได้ในเบราว์เซอร์นี้ — ลอง Chrome / Safari / Edge รุ่นใหม่'; });

  window.supabase = { createClient: () => client };
  window.ELI_ADMIN = { url: 'demo', key: 'demo', accountUrl: '', sender: 'eli · eliofficialth.store' };
  window.ELI_DEMO = { reset: () => { lsSet(SKEY, null); lsSet('eli_admin_demo_build', null); location.hash = ''; location.reload(); } };   // the reload rebuilds the sample data
})();
