-- ── prelude.sql ──
-- DEMO ONLY: the bits of Supabase (auth, storage, roles) the migrations expect, for Postgres running in the browser (PGlite).
-- a rebuild (new demo version, or "reset") starts from empty schemas; roles stay
drop schema if exists public, private, auth, storage cascade;
create schema public; grant usage on schema public to public;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema auth; create schema storage;
grant usage on schema auth, storage to anon, authenticated;
create table auth.users (id uuid primary key default gen_random_uuid(), email text unique, raw_user_meta_data jsonb not null default '{}', raw_app_meta_data jsonb not null default '{}',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), last_sign_in_at timestamptz, banned_until timestamptz, email_confirmed_at timestamptz default now());
create table auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users on delete cascade, created_at timestamptz not null default now());
create table auth.mfa_factors (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users on delete cascade, friendly_name text, factor_type text not null default 'totp',
  status text not null default 'unverified', secret text, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt()->>'sub', '')::uuid $$;
create function auth.role() returns text language sql stable as $$ select auth.jwt()->>'role' $$;
grant execute on all functions in schema auth to anon, authenticated;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now());
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, metadata jsonb, created_at timestamptz default now());
alter table storage.objects enable row level security;

-- ── 20261025000001_eli_world.sql ──
-- Eli's World — database (Supabase / Postgres).
-- The app reads its own rows. Coins, Life Power and streak change only inside the functions below
-- (security definer, run as the owner), so a modified app cannot hand itself coins or LP.
-- Life Power rules = "Life power ในฟีเจอร์ hero hall.docx" (same formulas as LPX in html_world/life.js).
-- Days follow Thai time (Asia/Bangkok).

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

/* ───────────── formulas ───────────── */
create or replace function private.today() returns date language sql stable
as $$ select (now() at time zone 'Asia/Bangkok')::date $$;

-- LP_Base = S_Walk (max 40) + S_Sleep (max 40) + S_App (pet 10 + send power 10)
create or replace function private.lp_base(steps int, sleep numeric, pet boolean, sent boolean) returns int language sql immutable
as $$ select least(40, floor(steps / 7000.0 * 40))::int
           + case when sleep is null then 10 when sleep >= 7 then 40 when sleep >= 6 then 30 when sleep >= 5 then 20 else 10 end
           + case when pet then 10 else 0 end + case when sent then 10 else 0 end $$;
create or replace function private.lp_mult(streak int) returns numeric language sql immutable
as $$ select 1 + 0.05 * least(streak, 30) $$;                                   -- M_Streak, ×2.5 at 30 days
create or replace function private.lp_earn(base int, streak int) returns int language sql immutable
as $$ select floor(base * private.lp_mult(streak) + 0.000001)::int $$;           -- ⌊LP_Base × M_Streak⌋
create or replace function private.lp_level(total int) returns int language sql immutable
as $$ select floor(sqrt(greatest(total, 0) / 100.0))::int + 1 $$;
create or replace function private.lp_rate(n int) returns numeric language sql immutable
as $$ select case when n <= 3 then 0 when n <= 7 then 0.02 when n <= 14 then 0.05 else 0.10 end $$;   -- decay on the n-th day away

/* ───────────── tables ───────────── */
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  citizen_no bigint generated always as identity unique,                 -- Eli Citizen ID (shown as 6 digits)
  name text not null default 'พลเมือง eli''s world' check (char_length(name) between 1 and 24 and name !~ '[<>]'),   -- shown to other people: no HTML
  birth date check (birth > '1900-01-01'),
  gender text check (gender in ('f', 'm')),
  bio text not null default '' check (char_length(bio) <= 150),
  avatar text check (avatar is null or (char_length(avatar) <= 80000 and avatar ~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$')),   -- 256 px JPEG from the app, nothing else
  setup boolean not null default false,                                  -- the first-login profile wizard is done
  hall_hidden boolean not null default false,                            -- hide me from other people's Hero Hall
  invite_code text not null unique default upper(substr(md5(gen_random_uuid()::text), 1, 8)),   -- for adding friends (can't be guessed, unlike citizen_no)
  total_lp int not null default 0,
  streak int not null default 0,
  coins int not null default 0 check (coins >= 0),
  shield_streak int,                 -- the streak before an absence halved it; buy it back with use_shield() (away ≤ 3 days)
  away_days int not null default 0,  -- days missed before the latest return (ELi's mood)
  away_lost int not null default 0,  -- Life Power that decayed during that absence
  settled_to date not null default private.today() - 1,                  -- last day whose Life Power is counted
  suspended_at timestamptz,          -- set by an owner in the back office: no rewards, no Hero Hall, can't sign in
  suspended_reason text,
  created_at timestamptz not null default now()
);

create table public.days (
  user_id uuid not null references public.profiles on delete cascade,
  day date not null,
  steps int not null default 0 check (steps between 0 and 100000),
  sleep numeric(3, 1) check (sleep between 0 and 16),
  sleep_stages jsonb,
  pet boolean not null default false,
  sent boolean not null default false,
  garden int not null default 0,     -- garden coins picked up (max 5)
  chest int,                         -- Dream Chest coins (null = not opened)
  bonus int not null default 0,      -- Life Power from runs
  earned int,                        -- daily Life Power, set when the day is settled
  primary key (user_id, day)
);

create table public.runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles on delete cascade,
  started_at timestamptz not null,
  sec int not null check (sec between 1 and 86400),
  meters int not null check (meters between 0 and 300000),
  sport text not null default 'วิ่ง' check (char_length(sport) <= 30),
  hr_avg int check (hr_avg between 30 and 240),
  zones int[],                        -- seconds in heart-rate zones 1–5
  route jsonb,                        -- [[lat, lon, t], …]
  caption text check (char_length(caption) <= 500),
  visibility text not null default 'public' check (visibility in ('public', 'friends', 'private')),
  lp int not null default 0,
  coin int not null default 0,
  created_at timestamptz not null default now()
);
create index runs_user on public.runs (user_id, created_at desc);

create table public.friends (
  user_id uuid not null references public.profiles on delete cascade,
  friend_id uuid not null references public.profiles on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id),
  check (user_id <> friend_id)
);

create table public.hearts (
  from_id uuid not null references public.profiles on delete cascade,
  to_id uuid not null references public.profiles on delete cascade,
  day date not null,
  primary key (from_id, to_id, day)
);

create table public.products (
  id text primary key,
  tab text not null check (tab in ('orig', 'fr')),   -- Eli Originals / Eli friends
  name text not null check (char_length(name) between 1 and 80 and name !~ '[<>]'),
  coins int not null check (coins > 0),
  img text not null check (img ~ '^(https://[^"''<>[:space:]]+|[A-Za-z0-9_-]+)$'),   -- app asset name (p_tee) or a plain https:// image URL
  stock int check (stock >= 0),                       -- null = unlimited
  is_new boolean not null default false,
  active boolean not null default true,
  sort int not null default 0,
  uses_codes boolean not null default false,          -- a partner coupon: each redemption gets one code from coupon_codes (no shipping)
  cost_thb numeric(10, 2) check (cost_thb >= 0)       -- what one costs the brand (back office: what the coins people hold are worth)
);

-- codes a partner gave us for an Eli friends coupon; one per redemption
create table public.coupon_codes (
  id bigint generated always as identity primary key,
  product_id text not null references public.products on delete restrict,   -- keep the record of given codes (hide the product instead)
  code text not null check (char_length(code) between 1 and 64),
  redemption_code text,              -- which order got it (null = still free)
  assigned_at timestamptz,
  created_at timestamptz not null default now(),
  unique (product_id, code)
);
create index coupon_free on public.coupon_codes (product_id, id) where redemption_code is null;

create table public.redemptions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  user_id uuid references public.profiles on delete set null,   -- kept (without the person) if they delete their account before it ships
  items jsonb not null,               -- [{id, name, coins}]
  total int not null,
  status text not null default 'new' check (status in ('new', 'shipping', 'done', 'cancelled')),
  digital boolean not null default false,   -- coupons only: nothing to ship, done at once
  ship_name text, ship_phone text, ship_address text, ship_note text,
  created_at timestamptz not null default now()
);

create table public.coin_log (         -- every coin in or out; (reason, ref) makes each reward one-time
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles on delete cascade,
  delta int not null,
  reason text not null,
  ref text not null default '',
  note text,                         -- back office only (why an admin changed coins, and who): never shown to the member
  at timestamptz not null default now(),
  unique (user_id, reason, ref)
);

-- the numbers the eli team can change from the back office without new code (read through private.cfg)
create table public.settings (
  key text primary key,
  value numeric not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users on delete set null
);
insert into public.settings (key, value) values
  ('coin_walk', 1), ('coin_sleep', 1), ('garden_max', 5), ('chest_min', 3), ('chest_max', 7),
  ('run_coin', 1), ('run_rewards_per_day', 3), ('run_min_m', 200), ('level_bonus', 5), ('shield_cost', 10),
  ('require_admin_mfa', 0);

-- coin events ("coins ×2 this weekend"): rewards from walking, sleep, the garden, the chest and runs are multiplied
create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80 and name !~ '[<>]'),
  coin_mult numeric(3, 1) not null check (coin_mult between 1 and 5),
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);

-- news from the eli team, shown once in the app while it runs
create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 80 and title !~ '[<>]'),
  body text not null check (char_length(body) between 1 and 1000),
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null check (ends_at > starts_at),
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);

/* ───────────── access ───────────── */
alter table public.profiles enable row level security;
alter table public.days enable row level security;
alter table public.runs enable row level security;
alter table public.friends enable row level security;
alter table public.hearts enable row level security;
alter table public.products enable row level security;
alter table public.redemptions enable row level security;
alter table public.coin_log enable row level security;
alter table public.coupon_codes enable row level security;
alter table public.settings enable row level security;
alter table public.campaigns enable row level security;
alter table public.announcements enable row level security;

create policy own on public.profiles for select to authenticated using (id = auth.uid());
create policy own_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy own on public.days for select to authenticated using (user_id = auth.uid());
create policy own on public.runs for select to authenticated using (user_id = auth.uid());
create policy own on public.friends for select to authenticated using (user_id = auth.uid());
create policy own on public.redemptions for select to authenticated using (user_id = auth.uid());
create policy own on public.coin_log for select to authenticated using (user_id = auth.uid());
create policy shop on public.products for select to authenticated using (active);

revoke all on all tables in schema public from anon, authenticated;
grant select on all tables in schema public to authenticated;
revoke all on public.coupon_codes, public.settings from authenticated;   -- back-office functions only
revoke select on public.coin_log from authenticated;
grant select (id, user_id, delta, reason, ref, at) on public.coin_log to authenticated;   -- not the team's note
grant update (name, birth, gender, bio, avatar, setup, hall_hidden) on public.profiles to authenticated;   -- never coins / LP

/* a profile for every new account */
create or replace function private.new_user() returns trigger language plpgsql security definer set search_path = ''
as $$ begin insert into public.profiles (id) values (new.id); return new; end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function private.new_user();

/* ───────────── internals ───────────── */
create or replace function private.cfg(k text, d numeric) returns numeric language sql stable security definer set search_path = ''
as $$ select coalesce((select value from public.settings where key = k), d) $$;

-- the running coin event, if any (the biggest multiplier wins)
create or replace function private.coin_mult() returns numeric language sql stable security definer set search_path = ''
as $$ select coalesce(max(coin_mult), 1) from public.campaigns where now() >= starts_at and now() < ends_at $$;

-- signed in and not suspended
create or replace function private.member(uid uuid) returns void language plpgsql stable security definer set search_path = ''
as $$ begin
  if uid is null then raise exception 'not signed in'; end if;
  if exists (select 1 from public.profiles where id = uid and suspended_at is not null) then raise exception 'suspended'; end if;
end $$;

-- one-time coin reward (or a payment when n < 0); false if this (reason, ref) was already paid
create or replace function private.give(uid uuid, n int, why text, ref text) returns boolean language plpgsql security definer set search_path = ''
as $$ begin
  insert into public.coin_log (user_id, delta, reason, ref) values (uid, n, why, ref) on conflict do nothing;
  if not found then return false; end if;
  update public.profiles set coins = coins + n where id = uid;
  return true;
end $$;

-- a reward from playing (walk, sleep, garden, chest, run): the running coin event multiplies it
create or replace function private.reward(uid uuid, n int, why text, ref text) returns boolean language sql security definer set search_path = ''
as $$ select private.give(uid, greatest(0, round(n * private.coin_mult()))::int, why, ref) $$;

-- +5 coins (setting level_bonus) for every 5 levels, each level paid once even if the LP decays and comes back
create or replace function private.level_bonus(uid uuid, l0 int, l1 int) returns void language plpgsql security definer set search_path = ''
as $$ declare l int; begin
  for l in (l0 + 1)..l1 loop if l % 5 = 0 then perform private.give(uid, private.cfg('level_bonus', 5)::int, 'level', l::text); end if; end loop;
end $$;

-- count every finished day since the last visit: active days earn LP and grow the streak,
-- missing days decay lifetime LP (after a 3-day grace, floor 100) and halve the streak each day (buy back: use_shield)
create or replace function private.settle(uid uuid) returns void language plpgsql security definer set search_path = ''
as $$ declare
  p public.profiles; d date; r public.days; e int; away int := 0; l0 int; t numeric; before int;
begin
  select * into p from public.profiles where id = uid for update;
  l0 := private.lp_level(p.total_lp);
  if p.settled_to >= private.today() - 1 then return; end if;
  if p.settled_to < private.today() - 400 then p.settled_to := private.today() - 400; end if;   -- don't walk years of absence day by day
  d := p.settled_to + 1;
  while d < private.today() loop
    select * into r from public.days where user_id = uid and day = d;
    if found then                                         -- opened the app that day
      e := private.lp_earn(private.lp_base(r.steps, r.sleep, r.pet, r.sent), p.streak);
      update public.days set earned = e where user_id = uid and day = d;
      p.total_lp := p.total_lp + e; p.streak := p.streak + 1; away := 0;
      p.shield_streak := null;                            -- the buy-back offer lasts until the next settled day
    else
      away := away + 1;
      if away = 1 then p.shield_streak := nullif(p.streak, 0); before := p.total_lp; end if;
      p.streak := p.streak / 2;                          -- the streak halves for every day missed
      t := p.total_lp * (1 - private.lp_rate(away));
      if p.total_lp > 100 then p.total_lp := greatest(100, round(t))::int; end if;
    end if;
    d := d + 1;
  end loop;
  update public.profiles set total_lp = p.total_lp, streak = p.streak, shield_streak = p.shield_streak,
    away_days = away, away_lost = case when away > 0 then before - p.total_lp else 0 end, settled_to = private.today() - 1 where id = uid;
  perform private.level_bonus(uid, l0, private.lp_level(p.total_lp));
end $$;

create or replace function private.week_lp(uid uuid) returns int language sql stable security definer set search_path = ''
as $$ select coalesce(sum(coalesce(d.earned, private.lp_earn(private.lp_base(d.steps, d.sleep, d.pet, d.sent), p.streak)) + d.bonus), 0)::int   -- not settled yet (today, or they haven't been back) → the live value
      from public.days d join public.profiles p on p.id = d.user_id
      where d.user_id = uid and d.day >= date_trunc('week', private.today())::date $$;   -- weeks start on Monday

-- everything the app shows about the signed-in person, in one object
create or replace function private.state(uid uuid) returns jsonb language sql stable security definer set search_path = ''
as $$ select jsonb_build_object(
    'profile', to_jsonb(p) - 'settled_to',
    'citizen_id', lpad(p.citizen_no::text, 6, '0'),
    'today', coalesce((select to_jsonb(d) - 'user_id' from public.days d where d.user_id = uid and d.day = private.today()), '{}'),
    'today_date', private.today(),
    'week_lp', private.week_lp(uid),
    'sent_to', coalesce((select jsonb_agg(h.to_id) from public.hearts h where h.from_id = uid and h.day = private.today()), '[]'),
    'event', (select jsonb_build_object('name', c.name, 'mult', c.coin_mult, 'ends_at', c.ends_at) from public.campaigns c
              where now() >= c.starts_at and now() < c.ends_at order by c.coin_mult desc, c.ends_at limit 1))
  from public.profiles p where p.id = uid $$;

/* ───────────── what the app calls ───────────── */

-- on every open and whenever Health data arrives: settle past days, record today, pay today's quest coins
create or replace function public.sync_day(p_steps int default null, p_sleep numeric default null, p_stages jsonb default null, p_pet boolean default false)
returns jsonb language plpgsql security definer set search_path = ''
as $$ declare uid uuid := auth.uid(); r public.days; begin
  perform private.member(uid);
  perform private.settle(uid);
  insert into public.days (user_id, day) values (uid, private.today()) on conflict do nothing;
  update public.days set
      steps = greatest(steps, least(coalesce(p_steps, 0), 100000)),           -- steps only go up during a day
      sleep = case when p_sleep is null then sleep else least(greatest(p_sleep, 0), 16) end,   -- (greatest() would turn a missing value into 0)
      sleep_stages = coalesce(p_stages, sleep_stages),
      pet = pet or coalesce(p_pet, false)
    where user_id = uid and day = private.today() returning * into r;
  if r.steps >= 7000 then perform private.reward(uid, private.cfg('coin_walk', 1)::int, 'walk', r.day::text); end if;
  if r.sleep between 7 and 9 then perform private.reward(uid, private.cfg('coin_sleep', 1)::int, 'sleep', r.day::text); end if;
  return private.state(uid);
end $$;

-- garden coins (max 5 a day) and the Dream Chest (after 7 h of sleep, 3–7 coins, once a night)
create or replace function public.claim(p_kind text) returns jsonb language plpgsql security definer set search_path = ''
as $$ declare uid uuid := auth.uid(); r public.days; n int; begin
  perform private.member(uid);
  insert into public.days (user_id, day) values (uid, private.today()) on conflict do nothing;
  select * into r from public.days where user_id = uid and day = private.today() for update;
  if p_kind = 'garden' then
    if r.garden >= private.cfg('garden_max', 5) then raise exception 'garden_done'; end if;
    update public.days set garden = garden + 1 where user_id = uid and day = r.day;
    n := round(private.coin_mult())::int;
    perform private.reward(uid, 1, 'garden', r.day || '#' || (r.garden + 1));
  elsif p_kind = 'chest' then
    if r.chest is not null then raise exception 'chest_done'; end if;
    if coalesce(r.sleep, 0) < 7 then raise exception 'chest_sleep'; end if;
    n := private.cfg('chest_min', 3)::int + floor(random() * (private.cfg('chest_max', 7) - private.cfg('chest_min', 3) + 1))::int;
    n := round(n * private.coin_mult())::int;   -- (shown as it is paid)
    update public.days set chest = n where user_id = uid and day = r.day;
    perform private.give(uid, n, 'chest', r.day::text);
  else raise exception 'unknown claim'; end if;
  return private.state(uid) || jsonb_build_object('got', n);
end $$;

-- a finished Step Trek run: LP by distance and +1 coin (rewarded for up to 3 runs a day of 200 m or more)
create or replace function public.log_run(p jsonb) returns jsonb language plpgsql security definer set search_path = ''
as $$ declare uid uuid := auth.uid(); v_sec int; v_m int; v_n int; v_lp int := 0; v_c int := 0; rid uuid; l0 int; begin
  perform private.member(uid);
  v_sec := round((p->>'sec')::numeric)::int; v_m := round((p->>'meters')::numeric)::int;
  if v_sec is null or v_sec < 1 or v_m is null or v_m < 0 then raise exception 'bad run'; end if;
  if v_m > v_sec * 12.5 + 50 then raise exception 'too fast'; end if;              -- faster than a sprinter for the whole run
  perform 1 from public.profiles where id = uid for update;
  select count(*) into v_n from public.runs r where r.user_id = uid and r.lp > 0 and (r.created_at at time zone 'Asia/Bangkok')::date = private.today();
  if v_m >= private.cfg('run_min_m', 200) and v_n < private.cfg('run_rewards_per_day', 3) then
    v_lp := least(700, greatest(12, round(v_m / 1000.0 * 14.3)))::int; v_c := round(private.cfg('run_coin', 1) * private.coin_mult())::int;
  end if;
  insert into public.runs (user_id, started_at, sec, meters, sport, hr_avg, zones, route, caption, visibility, lp, coin)
    values (uid, coalesce((p->>'started_at')::timestamptz, now() - make_interval(secs => v_sec)), v_sec, v_m, left(coalesce(p->>'sport', 'วิ่ง'), 30),
            (select h from (select round((p->>'hr_avg')::numeric)::int h) x where h between 30 and 240),   -- no / odd watch reading → null
            case when jsonb_typeof(p->'zones') = 'array' then (select array_agg(round(x::numeric)::int) from jsonb_array_elements_text(p->'zones') x) end,
            case when jsonb_typeof(p->'route') = 'array' then p->'route' end, left(p->>'caption', 500), coalesce(p->>'visibility', 'public'), v_lp, v_c)
    returning id into rid;
  if v_lp > 0 then
    perform private.settle(uid);
    insert into public.days (user_id, day) values (uid, private.today()) on conflict do nothing;
    update public.days set bonus = bonus + v_lp where user_id = uid and day = private.today();
    select total_lp into l0 from public.profiles where id = uid;
    update public.profiles set total_lp = total_lp + v_lp where id = uid;
    perform private.level_bonus(uid, private.lp_level(l0), private.lp_level(l0 + v_lp));
    perform private.give(uid, v_c, 'run', rid::text);
  end if;
  return private.state(uid) || jsonb_build_object('run_id', rid, 'lp', v_lp, 'coin', v_c);
end $$;

-- send power to someone in your Hero Hall: once a day per person; the first one of the day is S_App +10
create or replace function public.send_heart(p_to uuid) returns jsonb language plpgsql security definer set search_path = ''
as $$ declare uid uuid := auth.uid(); begin
  perform private.member(uid);
  if p_to = uid or not exists (select 1 from public.profiles where id = p_to) then raise exception 'bad target'; end if;
  insert into public.hearts (from_id, to_id, day) values (uid, p_to, private.today()) on conflict do nothing;
  insert into public.days (user_id, day) values (uid, private.today()) on conflict do nothing;
  update public.days set sent = true where user_id = uid and day = private.today();
  return private.state(uid);
end $$;

-- the Streak Shield: back within 3 days, 10 coins buy the full streak back (until the next day is settled)
create or replace function public.use_shield() returns jsonb language plpgsql security definer set search_path = ''
as $$ declare uid uuid := auth.uid(); p public.profiles; begin
  perform private.member(uid);
  perform private.settle(uid);   -- the days since the last visit count first
  select * into p from public.profiles where id = uid for update;
  if p.shield_streak is null or p.away_days > 3 then raise exception 'no_shield'; end if;
  if p.coins < private.cfg('shield_cost', 10) then raise exception 'not_enough_coins'; end if;
  perform private.give(uid, -private.cfg('shield_cost', 10)::int, 'shield', p.settled_to::text);
  update public.profiles set streak = shield_streak, shield_streak = null where id = uid;
  return private.state(uid);
end $$;
create or replace function public.drop_shield() returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform private.member(auth.uid()); perform private.settle(auth.uid()); update public.profiles set shield_streak = null where id = auth.uid(); return private.state(auth.uid()); end $$;

-- invite code (or link ?invite=<code>) → friends both ways. The code is random, so nobody can walk through every member.
create or replace function public.add_friend(p_code text) returns jsonb language plpgsql security definer set search_path = ''
as $$ declare uid uuid := auth.uid(); f uuid; nm text; begin
  perform private.member(uid);
  select id, name into f, nm from public.profiles where invite_code = upper(trim(coalesce(p_code, '')));
  if f is null or f = uid then raise exception 'no_such_code'; end if;
  insert into public.friends (user_id, friend_id) values (uid, f), (f, uid) on conflict do nothing;
  return jsonb_build_object('id', f, 'name', nm);
end $$;

-- Hero Hall: me + my friends + the overall top 20 (people who hide themselves are left out)
create or replace function public.hall() returns jsonb language sql stable security definer set search_path = ''
as $$ with ids as (
    select auth.uid() as id
    union select friend_id from public.friends where user_id = auth.uid()
    union (select id from public.profiles where not hall_hidden and suspended_at is null order by total_lp desc limit 20)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.name, 'avatar', p.avatar, 'total', p.total_lp, 'streak', p.streak,
      'week', private.week_lp(p.id), 'me', p.id = auth.uid(),
      'friend', exists (select 1 from public.friends f where f.user_id = auth.uid() and f.friend_id = p.id),
      'away', not exists (select 1 from public.days d where d.user_id = p.id and d.day >= private.today() - 3),
      'sent', exists (select 1 from public.hearts h where h.from_id = auth.uid() and h.to_id = p.id and h.day = private.today()))), '[]')
  from public.profiles p join ids on ids.id = p.id
  where p.id = auth.uid() or (not p.hall_hidden and p.suspended_at is null) $$;

-- Treasury: check the coins, take the stock (and a partner code for a coupon), pay — all at once.
-- An order of coupons only is digital: nothing to ship, done at once.
create or replace function public.redeem(p_items text[]) returns jsonb language plpgsql security definer set search_path = ''
as $$ declare uid uuid := auth.uid(); tot int := 0; it jsonb := '[]'; pr public.products; c text; i text; cp record; ship boolean := false; begin
  perform private.member(uid);
  if coalesce(array_length(p_items, 1), 0) = 0 or array_length(p_items, 1) > 20 then raise exception 'empty_cart'; end if;
  c := 'ELI-' || upper(substr(md5(gen_random_uuid()::text), 1, 4)) || '-' || upper(substr(md5(gen_random_uuid()::text), 1, 4));
  foreach i in array p_items loop
    select * into pr from public.products where id = i and active for update;
    if not found then raise exception 'no_product %', i; end if;
    if pr.stock is not null then
      if pr.stock < 1 then raise exception 'out_of_stock %', pr.name; end if;
      perform set_config('eli.internal', '1', true);
      update public.products set stock = stock - 1 where id = i;
      perform set_config('eli.internal', '', true);
    end if;
    if pr.uses_codes then
      select id, code into cp from public.coupon_codes where product_id = i and redemption_code is null order by id limit 1 for update skip locked;
      if not found then raise exception 'out_of_stock %', pr.name; end if;
      update public.coupon_codes set redemption_code = c, assigned_at = now() where id = cp.id;
      it := it || jsonb_build_object('id', pr.id, 'name', pr.name, 'coins', pr.coins, 'img', pr.img, 'coupon', cp.code);
    else
      ship := true;
      it := it || jsonb_build_object('id', pr.id, 'name', pr.name, 'coins', pr.coins, 'img', pr.img);
    end if;
    tot := tot + pr.coins;
  end loop;
  if (select coins from public.profiles where id = uid for update) < tot then raise exception 'not_enough_coins'; end if;
  insert into public.redemptions (code, user_id, items, total, digital, status) values (c, uid, it, tot, not ship, case when ship then 'new' else 'done' end);
  perform private.give(uid, -tot, 'redeem', c);
  return private.state(uid) || jsonb_build_object('code', c, 'items', it, 'total', tot, 'digital', not ship);
end $$;

create or replace function public.set_shipping(p_code text, p_name text, p_phone text, p_address text, p_note text default '')
returns void language plpgsql security definer set search_path = ''
as $$ begin
  if char_length(trim(coalesce(p_name, ''))) < 1 or char_length(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')) < 9 or char_length(trim(coalesce(p_address, ''))) < 5 then raise exception 'bad_address'; end if;
  update public.redemptions set ship_name = left(trim(p_name), 100), ship_phone = left(trim(p_phone), 20), ship_address = left(trim(p_address), 500), ship_note = left(trim(coalesce(p_note, '')), 300)
    where code = p_code and user_id = auth.uid() and status = 'new';
  if not found then raise exception 'no_order'; end if;
end $$;

-- news from the eli team that is running now (the app shows each one once)
create or replace function public.my_news() returns jsonb language sql stable security definer set search_path = ''
as $$ select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'title', a.title, 'body', a.body, 'starts_at', a.starts_at) order by a.starts_at desc), '[]')
      from (select * from public.announcements where now() >= starts_at and now() < ends_at order by starts_at desc limit 5) a $$;

-- everything the server keeps about one person, as one file (PDPA: the right to a copy of my data)
create or replace function private.export_user(uid uuid) returns jsonb language plpgsql stable security definer set search_path = ''
as $$ begin
  return jsonb_build_object(
    'exported_at', now(),
    'account', (select jsonb_build_object('email', email, 'created_at', created_at, 'last_sign_in_at', last_sign_in_at) from auth.users where id = uid),
    'profile', (select to_jsonb(p) - 'settled_to' - 'shield_streak' from public.profiles p where id = uid),
    'days', (select coalesce(jsonb_agg(to_jsonb(d) - 'user_id' order by d.day), '[]') from public.days d where user_id = uid),
    'runs', (select coalesce(jsonb_agg(to_jsonb(r) - 'user_id' order by r.created_at), '[]') from public.runs r where user_id = uid),
    'redemptions', (select coalesce(jsonb_agg(to_jsonb(o) - 'user_id' - 'admin_note' order by o.created_at), '[]') from public.redemptions o where user_id = uid),
    'coins', (select coalesce(jsonb_agg(to_jsonb(c) - 'user_id' - 'note' order by c.at), '[]') from public.coin_log c where user_id = uid),
    'friends', (select coalesce(jsonb_agg(p.name), '[]') from public.friends f join public.profiles p on p.id = f.friend_id where f.user_id = uid));
end $$;
create or replace function public.export_me() returns jsonb language plpgsql stable security definer set search_path = ''
as $$ begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  return private.export_user(auth.uid());   -- (a suspended account may still take its data)
end $$;

-- delete my account and everything in it (App Store rule 5.1.1(v)); an order still waiting to ship stays, without the person
create or replace function public.delete_me() returns void language plpgsql security definer set search_path = ''
as $$ begin
  if to_regclass('public.admins') is not null and exists (select 1 from public.admins where user_id = auth.uid() and role = 'owner')
     and not exists (select 1 from public.admins where role = 'owner' and user_id <> auth.uid()) then raise exception 'last_owner'; end if;
  delete from auth.users where id = auth.uid();
end $$;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;
alter default privileges in schema private revoke execute on functions from public;
-- new tables in public start closed for app users too (grant what each one needs, like above)
alter default privileges in schema public revoke all on tables from anon, authenticated;

-- ── 20261025000002_admin.sql ──
-- Eli's World — the eli team's web back office (eli_app/admin).
-- Admins sign in with a normal account that is listed in public.admins; everything below checks that list on the server.
-- Make the first admin (SQL editor, once):  insert into public.admins (user_id, role) select id, 'owner' from auth.users where email = 'you@brand.com';
-- Roles: owner = everything; staff = orders, rewards, news, looking up members. Daily health data (steps, sleep, heart rate)
-- is sensitive personal data under PDPA §26: only owners and staff with can_health see it, and every look is logged.

create table public.admins (
  user_id uuid primary key references auth.users on delete cascade,
  role text not null default 'staff' check (role in ('owner', 'staff')),
  can_health boolean not null default false,   -- staff who may see a member's daily health data
  mfa_factor uuid,                              -- a 2-step factor an owner approved (one set up after 2-step became required)
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;
revoke all on public.admins from anon, authenticated;   -- read through the policy below; changed only by admin_set_team()

-- every change and every look at sensitive data in the back office: who, when, what
create table public.admin_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  admin_id uuid references auth.users on delete set null,
  admin_email text,
  action text not null,
  target text,
  detail jsonb not null default '{}'
);
alter table public.admin_log enable row level security;
revoke all on public.admin_log from anon, authenticated;
create index admin_log_at on public.admin_log (at desc);

/* ── who is an admin (with 2-step sign-in once require_admin_mfa is on) ── */
-- When 2-step is required, a 2-step session counts only with a factor the team trusts: one that already existed when the rule
-- was turned on, or one an owner approved later. (Otherwise a leaked password could set up its own authenticator and walk in.)
create or replace function private.mfa_ok() returns boolean language sql stable security definer set search_path = ''
as $$ select private.cfg('require_admin_mfa', 0) = 0 or (coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2' and exists (
      select 1 from auth.mfa_factors f join public.admins a on a.user_id = f.user_id
      where f.user_id = auth.uid() and f.status = 'verified'
        and (f.created_at <= (select updated_at from public.settings where key = 'require_admin_mfa') or f.id = a.mfa_factor))) $$;
create or replace function private.is_admin() returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.admins where user_id = auth.uid()) and private.mfa_ok() $$;
create or replace function private.is_owner() returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.admins where user_id = auth.uid() and role = 'owner') and private.mfa_ok() $$;
create or replace function private.can_health() returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.admins where user_id = auth.uid() and (role = 'owner' or can_health)) and private.mfa_ok() $$;
create or replace function private.need_admin() returns void language plpgsql stable security definer set search_path = ''
as $$ begin
  if not exists (select 1 from public.admins where user_id = auth.uid()) then raise exception 'forbidden'; end if;
  if not private.mfa_ok() then raise exception 'mfa_required'; end if;
end $$;
create or replace function private.need_owner() returns void language plpgsql stable security definer set search_path = ''
as $$ begin perform private.need_admin(); if not private.is_owner() then raise exception 'forbidden'; end if; end $$;

create or replace function private.audit(p_action text, p_target text, p_detail jsonb default '{}') returns void language sql security definer set search_path = ''
as $$ insert into public.admin_log (admin_id, admin_email, action, target, detail)
      values (auth.uid(), (select email from auth.users where id = auth.uid()), p_action, p_target, coalesce(p_detail, '{}')) $$;

-- changes made straight to a table from the back office (products, news, events) land in the log too
create or replace function private.audit_row() returns trigger language plpgsql security definer set search_path = ''
as $$ declare o jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end; n jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end; d jsonb := '{}'; k text; begin
  if not exists (select 1 from public.admins where user_id = auth.uid()) then return null; end if;   -- members redeeming, seeds, migrations
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(n) loop if n->k is distinct from o->k then d := d || jsonb_build_object(k, jsonb_build_array(o->k, n->k)); end if; end loop;
    if d = '{}' or (d - 'stock' = '{}' and current_setting('eli.internal', true) = '1') then return null; end if;   -- stock moved by an order / coupons (logged there)
  else d := coalesce(n, o); end if;
  perform private.audit(tg_table_name || '.' || lower(tg_op), coalesce(n->>'id', o->>'id'), d);
  return null;
end $$;

grant usage on schema private to authenticated;
grant execute on function private.is_admin(), private.is_owner(), private.can_health(), private.mfa_ok(), private.cfg(text, numeric) to authenticated;   -- used inside the policies below

-- orders get shipping progress; members see the parcel number, never the team's note
alter table public.redemptions
  add column tracking text,
  add column admin_note text,
  add column updated_at timestamptz not null default now();
revoke select on public.redemptions from authenticated;
grant select (id, code, user_id, items, total, status, digital, tracking, ship_name, ship_phone, ship_address, ship_note, created_at, updated_at) on public.redemptions to authenticated;

/* ── what admins can read (members keep seeing only their own rows) ── */
create policy admin_read on public.admins for select to authenticated using (user_id = auth.uid() or private.is_admin());
create policy admin_read on public.profiles for select to authenticated using (private.is_admin());
create policy admin_read on public.days for select to authenticated using (private.can_health());   -- daily health data
create policy admin_read on public.runs for select to authenticated using (private.can_health());   -- heart rate + GPS route
create policy admin_read on public.redemptions for select to authenticated using (private.is_admin());
create policy admin_read on public.coin_log for select to authenticated using (private.is_admin());
create policy admin_read on public.products for select to authenticated using (private.is_admin());   -- hidden items too
-- products, news and coin events are edited straight from the back office
create policy admin_write on public.products for insert to authenticated with check (private.is_admin());
create policy admin_edit on public.products for update to authenticated using (private.is_admin()) with check (private.is_admin());
create policy admin_delete on public.products for delete to authenticated using (private.is_admin());
create policy admin_all on public.campaigns for all to authenticated using (private.is_admin()) with check (private.is_admin());
create policy admin_all on public.announcements for all to authenticated using (private.is_admin()) with check (private.is_admin());
grant insert, update, delete on public.products, public.campaigns, public.announcements to authenticated;
grant select on public.admins to authenticated;
create or replace function private.stamp_creator() returns trigger language plpgsql security definer set search_path = ''
as $$ begin
  if tg_op = 'INSERT' then new.created_by := auth.uid(); new.created_at := now(); else new.created_by := old.created_by; new.created_at := old.created_at; end if;
  return new;
end $$;
create trigger stamp before insert or update on public.campaigns for each row execute function private.stamp_creator();
create trigger stamp before insert or update on public.announcements for each row execute function private.stamp_creator();
create trigger audit after insert or update or delete on public.products for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.campaigns for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.announcements for each row execute function private.audit_row();

/* ── product photos: a public bucket, uploads by admins only ── */
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('products', 'products', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;
create policy "products: admins upload" on storage.objects for insert to authenticated with check (bucket_id = 'products' and private.is_admin());
create policy "products: admins replace" on storage.objects for update to authenticated using (bucket_id = 'products' and private.is_admin());
create policy "products: admins remove" on storage.objects for delete to authenticated using (bucket_id = 'products' and private.is_admin());

/* ═══════════ back-office functions (each one checks the caller first) ═══════════ */

-- who am I in the back office
create or replace function public.admin_me() returns jsonb language sql stable security definer set search_path = ''
as $$ select jsonb_build_object('admin', a.user_id is not null, 'role', a.role, 'email', u.email, 'can_health', a.role = 'owner' or coalesce(a.can_health, false),
        'mfa_required', private.cfg('require_admin_mfa', 0) = 1, 'aal', coalesce(auth.jwt()->>'aal', 'aal1'), 'mfa_ok', private.mfa_ok())
      from auth.users u left join public.admins a on a.user_id = u.id where u.id = auth.uid() $$;

-- a few back-office actions happen in the browser (exports, printing); they are logged through here
create or replace function public.admin_log_event(p_action text, p_detail jsonb default '{}') returns void language plpgsql security definer set search_path = ''
as $$ begin
  perform private.need_admin();
  if p_action not in ('export_orders', 'print_labels', 'export_coupons') then raise exception 'bad_action'; end if;
  perform private.audit(p_action, null, p_detail);
end $$;

/* ── overview ── */
create or replace function public.admin_stats(p_days int default 14) returns jsonb language plpgsql stable security definer set search_path = ''
as $$ declare t date := private.today(); n int := least(greatest(p_days, 7), 90); begin
  perform private.need_admin();
  return jsonb_build_object(
    'today', t,
    'members', (select count(*) from public.profiles),
    'new_7d', (select count(*) from public.profiles where (created_at at time zone 'Asia/Bangkok')::date > t - 7),
    'active_today', (select count(*) from public.days where day = t),
    'active_7d', (select count(distinct user_id) from public.days where day > t - 7),
    'orders_new', (select count(*) from public.redemptions where status = 'new'),
    'orders_shipping', (select count(*) from public.redemptions where status = 'shipping'),
    'coins_out_30d', (select coalesce(sum(c.delta), 0) from public.coin_log c where c.delta > 0 and c.reason not in ('refund', 'admin') and (c.at at time zone 'Asia/Bangkok')::date > t - 30),
    'coins_spent_30d', (select coalesce(-sum(c.delta), 0) from public.coin_log c where c.reason in ('redeem', 'refund') and (c.at at time zone 'Asia/Bangkok')::date > t - 30),   -- net of cancelled orders
    'coins_held', (select coalesce(sum(coins), 0) from public.profiles),
    'runs_7d', (select count(*) from public.runs where (created_at at time zone 'Asia/Bangkok')::date > t - 7),
    'km_7d', (select coalesce(round(sum(meters) / 1000.0, 1), 0) from public.runs where (created_at at time zone 'Asia/Bangkok')::date > t - 7),
    'event', (select jsonb_build_object('name', name, 'mult', coin_mult, 'ends_at', ends_at) from public.campaigns where now() >= starts_at and now() < ends_at order by coin_mult desc limit 1),
    'daily', (select jsonb_agg(jsonb_build_object('day', d::date,
                 'active', (select count(*) from public.days x where x.day = d::date),
                 'new', (select count(*) from public.profiles p where (p.created_at at time zone 'Asia/Bangkok')::date = d::date)) order by d)
              from generate_series(t - (n - 1), t, interval '1 day') d),
    'top', (select coalesce(jsonb_agg(r), '[]') from (select id, lpad(citizen_no::text, 6, '0') citizen_id, name, avatar, total_lp, streak
              from public.profiles where suspended_at is null order by total_lp desc limit 5) r),
    'stock_low', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'stock', stock)), '[]')
              from public.products where active and stock is not null and stock <= 5));
end $$;

/* ── growth: actives, retention, the journey from sign-up to first reward, habits ── */
create or replace function public.admin_growth(p_days int default 30) returns jsonb language plpgsql stable security definer set search_path = ''
as $$ declare t date := private.today(); n int := least(greatest(p_days, 7), 90); begin
  perform private.need_admin();
  return jsonb_build_object(
    'today', t,
    'dau', (select count(*) from public.days where day = t),
    'wau', (select count(distinct user_id) from public.days where day > t - 7),
    'mau', (select count(distinct user_id) from public.days where day > t - 30),
    'members', (select count(*) from public.profiles),
    'daily', (select jsonb_agg(jsonb_build_object('day', d::date,
                 'active', (select count(*) from public.days x where x.day = d::date),
                 'new', (select count(*) from public.profiles p where (p.created_at at time zone 'Asia/Bangkok')::date = d::date)) order by d)
              from generate_series(t - (n - 1), t, interval '1 day') d),
    -- came back exactly N days after signing up (among people who joined at least N days ago, in the last 120 days)
    'retention', (select jsonb_object_agg('d' || k, jsonb_build_object('base', base, 'back', back)) from (
        select k, count(*) base, count(*) filter (where exists (select 1 from public.days d where d.user_id = p.id and d.day = (p.created_at at time zone 'Asia/Bangkok')::date + k)) back
        from unnest(array[1, 7, 30]) k cross join public.profiles p
        where (p.created_at at time zone 'Asia/Bangkok')::date <= t - k and p.created_at > now() - interval '120 days'
        group by k) r),
    -- weekly cohorts (week of sign-up) × share active in each later week
    'cohorts', (select coalesce(jsonb_agg(c order by c->>'week'), '[]') from (
        select jsonb_build_object('week', w::date, 'size', count(p.id),
               'weeks', (select jsonb_agg(case when w::date + 7 * k > t then null else
                           (select count(distinct d.user_id) from public.days d join public.profiles q on q.id = d.user_id
                            where date_trunc('week', (q.created_at at time zone 'Asia/Bangkok'))::date = w::date and d.day between w::date + 7 * k and w::date + 7 * k + 6) end order by k)
                         from generate_series(0, 7) k)) c
        from generate_series(date_trunc('week', t::timestamp) - interval '7 weeks', date_trunc('week', t::timestamp), interval '1 week') w
        left join public.profiles p on date_trunc('week', (p.created_at at time zone 'Asia/Bangkok'))::date = w::date
        group by w) x),
    -- the journey of people who joined in the last 90 days
    'funnel', (select jsonb_build_object(
        'signed_up', count(*),
        'profile', count(*) filter (where p.setup),
        'health', count(*) filter (where exists (select 1 from public.days d where d.user_id = p.id and (d.steps > 0 or d.sleep is not null))),
        'run', count(*) filter (where exists (select 1 from public.runs r where r.user_id = p.id)),
        'redeem', count(*) filter (where exists (select 1 from public.redemptions o where o.user_id = p.id)))
      from public.profiles p where p.created_at > now() - interval '90 days'),
    -- habits over the last 7 days (everyone together: no single person's data)
    'habits', (select jsonb_build_object(
        'days', count(*),
        'avg_steps', round(avg(steps) filter (where steps > 0)),
        'walk_goal', round(100.0 * count(*) filter (where steps >= 7000) / nullif(count(*), 0)),
        'sleep_ok', round(100.0 * count(*) filter (where sleep between 7 and 9) / nullif(count(*) filter (where sleep is not null), 0)),
        'avg_sleep', round(avg(sleep), 1),
        'pet', round(100.0 * count(*) filter (where pet) / nullif(count(*), 0)),
        'sent', round(100.0 * count(*) filter (where sent) / nullif(count(*), 0)))
      from public.days where day > t - 7),
    'runs', (select jsonb_build_object('count', count(*), 'km', coalesce(round(sum(meters) / 1000.0, 1), 0), 'people', count(distinct user_id))
      from public.runs where (created_at at time zone 'Asia/Bangkok')::date > t - 7),
    'levels', (select jsonb_agg(jsonb_build_object('tier', tier, 'count', c) order by o) from (
        select case when l >= 30 then 'Eternal Legend' when l >= 20 then 'Champion Life' when l >= 10 then 'Guardian Life' when l >= 5 then 'Vibrant Life' else 'Sprout Life' end tier,
               case when l >= 30 then 5 when l >= 20 then 4 when l >= 10 then 3 when l >= 5 then 2 else 1 end o, count(*) c
        from (select private.lp_level(total_lp) l from public.profiles) z group by 1, 2) y));
end $$;

/* ── the coin economy: what goes in, what goes out, what is owed, who looks odd ── */
create or replace function public.admin_economy(p_days int default 30) returns jsonb language plpgsql security definer set search_path = ''
as $$ declare t date := private.today(); n int := least(greatest(p_days, 7), 90); held bigint; rate numeric; p90 numeric; health boolean := private.can_health(); begin
  perform private.need_admin();
  if health then perform private.audit('view_health', 'economy_flags', '{}'); end if;
  select coalesce(sum(coins), 0) into held from public.profiles;
  select sum(cost_thb) / nullif(sum(coins), 0) into rate from public.products where active and cost_thb is not null;   -- ฿ per coin across the catalogue
  select percentile_cont(.9) within group (order by s) into p90 from (
    select sum(delta) s from public.coin_log where delta > 0 and reason not in ('refund', 'admin') and at > now() - interval '7 days' group by user_id) z;
  return jsonb_build_object(
    'today', t, 'held', held, 'thb_per_coin', round(rate, 4), 'owed_thb', round(held * rate),
    'minted', (select coalesce(sum(delta), 0) from public.coin_log where delta > 0 and reason not in ('refund', 'admin') and (at at time zone 'Asia/Bangkok')::date > t - n),
    'spent', (select coalesce(-sum(delta), 0) from public.coin_log where reason in ('redeem', 'refund', 'shield') and (at at time zone 'Asia/Bangkok')::date > t - n),
    'admin_net', (select coalesce(sum(delta), 0) from public.coin_log where reason = 'admin' and (at at time zone 'Asia/Bangkok')::date > t - n),
    'event', (select jsonb_build_object('name', name, 'mult', coin_mult, 'ends_at', ends_at) from public.campaigns where now() >= starts_at and now() < ends_at order by coin_mult desc limit 1),
    'daily', (select jsonb_agg(jsonb_build_object('day', d::date,
                 'minted', (select coalesce(sum(delta), 0) from public.coin_log c where c.delta > 0 and c.reason not in ('refund', 'admin') and (c.at at time zone 'Asia/Bangkok')::date = d::date),
                 'spent', (select coalesce(-sum(delta), 0) from public.coin_log c where c.reason in ('redeem', 'refund', 'shield') and (c.at at time zone 'Asia/Bangkok')::date = d::date)) order by d)
              from generate_series(t - (n - 1), t, interval '1 day') d),
    'sources', (select coalesce(jsonb_agg(jsonb_build_object('reason', reason, 'coins', s, 'times', c) order by abs(s) desc), '[]') from (
        select reason, sum(delta) s, count(*) c from public.coin_log where (at at time zone 'Asia/Bangkok')::date > t - n group by reason) z),
    'top', (select coalesce(jsonb_agg(r), '[]') from (
        select p.id, p.name, lpad(p.citizen_no::text, 6, '0') citizen_id, sum(c.delta) earned
        from public.coin_log c join public.profiles p on p.id = c.user_id
        where c.delta > 0 and c.reason not in ('refund', 'admin') and c.at > now() - interval '7 days'
        group by p.id order by earned desc limit 10) r),
    'p90_week', round(coalesce(p90, 0)),
    -- people worth a second look (last 30 days). A flag is a reason to check, not proof.
    'flags', (select coalesce(jsonb_agg(f order by jsonb_array_length(f->'why') desc, f->>'name'), '[]') from (
        select jsonb_build_object('id', p.id, 'name', p.name, 'citizen_id', lpad(p.citizen_no::text, 6, '0'), 'suspended', p.suspended_at is not null,
               'created_at', p.created_at, 'why', jsonb_agg(distinct w)) f
        from (
          select user_id id, case when health then 'ก้าว ' || to_char(max(steps), 'FM999,999') || ' ใน 1 วัน' else 'กิจกรรมผิดปกติ (รายละเอียดเป็นข้อมูลสุขภาพ)' end w
            from public.days where day > t - 30 and steps >= 40000 group by user_id
          union all
          select user_id, case when health then 'วิ่งเร็วผิดปกติ (' || to_char(round(meters / 1000.0, 1), 'FM990.0') || ' กม. เพซ ' || to_char(floor(sec / (meters / 1000.0) / 60), 'FM90') || ':' || to_char(floor(sec / (meters / 1000.0))::int % 60, 'FM00') || ')'
                  else 'กิจกรรมผิดปกติ (รายละเอียดเป็นข้อมูลสุขภาพ)' end
            from public.runs where created_at > now() - interval '30 days' and meters >= 3000 and meters::numeric / sec > 6.0
          union all
          select user_id, case when health then 'วิ่งไกล/นานผิดปกติ (' || to_char(round(meters / 1000.0, 1), 'FM990.0') || ' กม. ' || sec / 3600 || ' ชม.)' else 'กิจกรรมผิดปกติ (รายละเอียดเป็นข้อมูลสุขภาพ)' end
            from public.runs where created_at > now() - interval '30 days' and (meters >= 42195 or sec >= 18000)
          union all
          select user_id, 'ได้ ' || sum(delta) || ' เหรียญใน 7 วัน (คนส่วนใหญ่ ≤ ' || round(coalesce(p90, 0)) || ')'
            from public.coin_log where delta > 0 and reason not in ('refund', 'admin') and at > now() - interval '7 days'
            group by user_id having sum(delta) > greatest(50, 3 * coalesce(p90, 0))
          union all
          select o.user_id, 'แลกของหลังสมัครไม่ถึง 3 วัน' from public.redemptions o join public.profiles q on q.id = o.user_id
            where o.created_at > now() - interval '30 days' and o.created_at < q.created_at + interval '3 days'
          union all
          select o.user_id, 'เบอร์จัดส่งซ้ำกับบัญชีอื่น (' || o.ph || ')' from (
              select user_id, regexp_replace(ship_phone, '\D', '', 'g') ph from public.redemptions
              where user_id is not null and ship_phone is not null and created_at > now() - interval '30 days') o
            where o.ph in (select regexp_replace(ship_phone, '\D', '', 'g') from public.redemptions where user_id is not null and ship_phone is not null
                           group by 1 having count(distinct user_id) > 1)
        ) z(id, w) join public.profiles p on p.id = z.id
        group by p.id) y));
end $$;

/* ── members ── */
create or replace function public.admin_members(p_q text default '', p_sort text default 'new', p_limit int default 50, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$ declare q text := trim(coalesce(p_q, '')); res jsonb; total int; begin
  perform private.need_admin();
  select coalesce(jsonb_agg(j), '[]'), coalesce(max(n), 0) into res, total from (
    select to_jsonb(m) - 'n' j, m.n from (
      select p.id, lpad(p.citizen_no::text, 6, '0') citizen_id, p.name, p.avatar, u.email, p.total_lp, private.lp_level(p.total_lp) level,
             p.coins, p.streak, p.hall_hidden, p.suspended_at, p.created_at,
             (select max(day) from public.days d where d.user_id = p.id) last_day, count(*) over () n   -- counted before the page is cut
      from public.profiles p join auth.users u on u.id = p.id
      where (q = '' or p.name ilike '%' || q || '%' or u.email ilike '%' || q || '%' or lpad(p.citizen_no::text, 6, '0') like '%' || q || '%')
        and (p_sort <> 'suspended' or p.suspended_at is not null)
      order by case when p_sort = 'lp' then p.total_lp when p_sort = 'coins' then p.coins end desc nulls last, p.created_at desc
      limit least(p_limit, 200) offset greatest(p_offset, 0)) m) x;
  return jsonb_build_object('rows', res, 'total', total);
end $$;

-- one member. Daily health data only for owners / staff with can_health, and each look is logged.
create or replace function public.admin_member(p_id uuid) returns jsonb language plpgsql security definer set search_path = ''
as $$ declare health boolean := private.can_health(); res jsonb; begin
  perform private.need_admin();
  select jsonb_build_object(
    'profile', to_jsonb(p) - 'settled_to' || jsonb_build_object('citizen_id', lpad(p.citizen_no::text, 6, '0'), 'email', u.email, 'level', private.lp_level(p.total_lp),
                 'week_lp', private.week_lp(p.id), 'last_sign_in', u.last_sign_in_at),
    'health_access', health,
    'days', case when health then (select coalesce(jsonb_agg(to_jsonb(d) - 'user_id' - 'sleep_stages' order by d.day desc), '[]') from (select * from public.days where user_id = p.id order by day desc limit 14) d) end,
    'days_summary', (select jsonb_build_object('active', count(*), 'last_day', max(day)) from public.days where user_id = p.id and day > private.today() - 14),
    'runs', (select coalesce(jsonb_agg((to_jsonb(r) - 'route' - 'user_id' - 'zones') - case when health then '' else 'hr_avg' end order by r.created_at desc), '[]')
             from (select * from public.runs where user_id = p.id order by created_at desc limit 10) r),
    'orders', (select coalesce(jsonb_agg(to_jsonb(o) order by o.created_at desc), '[]') from (select code, total, status, digital, created_at from public.redemptions where user_id = p.id order by created_at desc limit 10) o),
    'coins', (select coalesce(jsonb_agg((to_jsonb(c) - 'user_id') || case when not health and c.reason in ('walk', 'sleep') then '{"reason":"quest"}'::jsonb else '{}' end order by c.at desc), '[]')
              from (select * from public.coin_log where user_id = p.id order by at desc limit 30) c),
    'friends', (select count(*) from public.friends where user_id = p.id))
  into res from public.profiles p join auth.users u on u.id = p.id where p.id = p_id;
  if res is not null and health then perform private.audit('view_health', p_id::text, jsonb_build_object('citizen_id', res->'profile'->>'citizen_id')); end if;
  return res;
end $$;

-- a copy of everything about one member (PDPA request that came in by LINE / e-mail) — owners, logged
create or replace function public.admin_export_member(p_id uuid) returns jsonb language plpgsql security definer set search_path = ''
as $$ begin
  perform private.need_owner();
  perform private.audit('export_member', p_id::text, jsonb_build_object('citizen_id', (select lpad(citizen_no::text, 6, '0') from public.profiles where id = p_id)));
  return private.export_user(p_id);
end $$;

-- suspend: no rewards, out of Hero Hall, signed out everywhere and can't sign in again — owners, with a reason
create or replace function public.admin_suspend(p_id uuid, p_reason text) returns void language plpgsql security definer set search_path = ''
as $$ begin
  perform private.need_owner();
  if char_length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'need_reason'; end if;
  if exists (select 1 from public.admins where user_id = p_id) then raise exception 'is_admin'; end if;
  update public.profiles set suspended_at = now(), suspended_reason = left(trim(p_reason), 200) where id = p_id;
  if not found then raise exception 'no_member'; end if;
  update auth.users set banned_until = now() + interval '100 years' where id = p_id;
  delete from auth.sessions where user_id = p_id;
  perform private.audit('suspend', p_id::text, jsonb_build_object('reason', left(trim(p_reason), 200)));
end $$;
create or replace function public.admin_unsuspend(p_id uuid) returns void language plpgsql security definer set search_path = ''
as $$ begin
  perform private.need_owner();
  update public.profiles set suspended_at = null, suspended_reason = null where id = p_id;
  if not found then raise exception 'no_member'; end if;
  update auth.users set banned_until = null where id = p_id;
  perform private.audit('unsuspend', p_id::text);
end $$;

-- put a streak right (an app bug, a lost day) — owners, with a reason
create or replace function public.admin_set_streak(p_id uuid, p_streak int, p_reason text) returns void language plpgsql security definer set search_path = ''
as $$ declare was int; begin
  perform private.need_owner();
  if p_streak not between 0 and 10000 then raise exception 'bad_amount'; end if;
  if char_length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'need_reason'; end if;
  select streak into was from public.profiles where id = p_id for update;
  if not found then raise exception 'no_member'; end if;
  update public.profiles set streak = p_streak, shield_streak = null where id = p_id;
  perform private.audit('set_streak', p_id::text, jsonb_build_object('from', was, 'to', p_streak, 'reason', left(trim(p_reason), 200)));
end $$;

-- delete a member's account for them (PDPA request) — owners, logged; orders still on their way are kept
create or replace function public.admin_delete_member(p_id uuid, p_reason text) returns void language plpgsql security definer set search_path = ''
as $$ declare cid text; begin
  perform private.need_owner();
  if char_length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'need_reason'; end if;
  if p_id = auth.uid() or exists (select 1 from public.admins where user_id = p_id) then raise exception 'is_admin'; end if;
  select lpad(citizen_no::text, 6, '0') into cid from public.profiles where id = p_id;
  if cid is null then raise exception 'no_member'; end if;
  perform private.audit('delete_member', p_id::text, jsonb_build_object('citizen_id', cid, 'reason', left(trim(p_reason), 200)));
  delete from auth.users where id = p_id;
end $$;

-- give or take coins by hand (owners only), always with a reason in the coin log
create or replace function public.admin_adjust_coins(p_user uuid, p_delta int, p_reason text) returns jsonb language plpgsql security definer set search_path = ''
as $$ declare c int; v_ref text := now()::text || ' #' || substr(md5(random()::text), 1, 6); begin
  perform private.need_owner();
  if p_delta = 0 or abs(p_delta) > 100000 then raise exception 'bad_amount'; end if;
  if char_length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'need_reason'; end if;
  select coins into c from public.profiles where id = p_user for update;
  if c is null then raise exception 'no_member'; end if;
  if c + p_delta < 0 then raise exception 'not_enough_coins'; end if;
  perform private.give(p_user, p_delta, 'admin', v_ref);
  update public.coin_log set note = left(trim(p_reason), 120) || ' · ' || (select email from auth.users where id = auth.uid())
    where user_id = p_user and reason = 'admin' and ref = v_ref;
  perform private.audit('adjust_coins', p_user::text, jsonb_build_object('delta', p_delta, 'reason', left(trim(p_reason), 120)));
  return jsonb_build_object('coins', c + p_delta);
end $$;

/* ── orders ── */
create or replace function public.admin_orders(p_status text default '', p_q text default '', p_limit int default 50, p_offset int default 0)
returns jsonb language plpgsql security definer set search_path = ''
as $$ declare q text := trim(coalesce(p_q, '')); res jsonb; total int; begin
  perform private.need_admin();
  if p_limit > 50 then perform private.audit('orders.bulk_read', nullif(p_status, ''), jsonb_build_object('limit', least(p_limit, 200), 'offset', p_offset, 'q', nullif(q, ''))); end if;
  select coalesce(jsonb_agg(j), '[]'), coalesce(max(n), 0) into res, total from (
    select to_jsonb(o) || jsonb_build_object('member', coalesce(p.name, '(ลบบัญชีแล้ว)'), 'citizen_id', coalesce(lpad(p.citizen_no::text, 6, '0'), '—'), 'user_id', p.id) j, count(*) over () n
    from public.redemptions o left join public.profiles p on p.id = o.user_id
    where (coalesce(p_status, '') = '' or o.status = p_status)
      and (q = '' or o.code ilike '%' || q || '%' or coalesce(p.name, '') ilike '%' || q || '%' or coalesce(o.ship_name, '') ilike '%' || q || '%' or coalesce(o.ship_phone, '') like '%' || q || '%')
    order by o.created_at desc limit least(p_limit, 200) offset greatest(p_offset, 0)) x;
  return jsonb_build_object('rows', res, 'total', total,
    'counts', (select jsonb_object_agg(status, c) from (select status, count(*) c from public.redemptions group by status) s));
end $$;

-- move an order along: new → shipping → done, a step back from shipping, cancel before it's delivered.
-- Cancelling gives the coins (if the account still exists) and the stock back, once. Delivered = final (only an owner may reopen it to shipping).
-- Coupon orders (digital) are done when redeemed and don't move.
create or replace function public.admin_set_order(p_code text, p_status text, p_tracking text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$ declare o public.redemptions; it jsonb; was text; was_note text; begin
  perform private.need_admin();
  if p_status not in ('new', 'shipping', 'done', 'cancelled') then raise exception 'bad_status'; end if;
  select * into o from public.redemptions where code = p_code for update;
  if not found then raise exception 'no_order'; end if;
  was := o.status; was_note := o.admin_note;
  if o.digital and p_status <> o.status then raise exception 'digital_order'; end if;
  if o.status = 'cancelled' and p_status <> 'cancelled' then raise exception 'order_cancelled'; end if;
  if o.status <> p_status and not (
       (o.status = 'new' and p_status in ('shipping', 'cancelled'))
    or (o.status = 'shipping' and p_status in ('done', 'new', 'cancelled'))
    or (o.status = 'done' and p_status = 'shipping' and private.is_owner())) then
    raise exception 'bad_step % → %', o.status, p_status;
  end if;
  if p_status = 'cancelled' and o.status <> 'cancelled' then
    -- a partner code in the order was already handed out (the member can see it), so it is not refunded or restocked
    if o.user_id is not null then
      perform private.give(o.user_id, (select coalesce(sum((x->>'coins')::int), 0) from jsonb_array_elements(o.items) x where x->>'coupon' is null)::int, 'refund', o.code);
    end if;
    perform set_config('eli.internal', '1', true);
    for it in select * from jsonb_array_elements(o.items) loop
      if it->>'coupon' is null then update public.products set stock = stock + 1 where id = it->>'id' and stock is not null; end if;
    end loop;
    perform set_config('eli.internal', '', true);
  end if;
  update public.redemptions set status = p_status, tracking = coalesce(nullif(trim(p_tracking), ''), tracking),
    admin_note = coalesce(p_note, admin_note), updated_at = now() where code = p_code returning * into o;
  perform private.audit('order', p_code, jsonb_build_object('from', was, 'to', p_status)
    || case when nullif(trim(p_tracking), '') is not null then jsonb_build_object('tracking', trim(p_tracking)) else '{}' end
    || case when p_note is not null and p_note is distinct from was_note then jsonb_build_object('note', left(p_note, 200)) else '{}' end);
  return to_jsonb(o);
end $$;

-- many orders at once (e.g. a morning's parcels handed to the courier)
create or replace function public.admin_bulk_orders(p_codes text[], p_status text) returns jsonb language plpgsql security definer set search_path = ''
as $$ declare c text; ok int := 0; bad jsonb := '[]'; begin
  perform private.need_admin();
  if coalesce(array_length(p_codes, 1), 0) > 500 then raise exception 'too_many'; end if;
  foreach c in array coalesce(p_codes, '{}') loop
    begin perform public.admin_set_order(c, p_status); ok := ok + 1;
    exception when others then bad := bad || jsonb_build_object('code', c, 'error', sqlerrm); end;
  end loop;
  return jsonb_build_object('ok', ok, 'failed', bad);
end $$;

/* ── partner coupons (Eli friends) ── */
create or replace function public.admin_coupons(p_product text, p_with_codes boolean default false) returns jsonb language plpgsql security definer set search_path = ''
as $$ begin
  perform private.need_admin();
  if p_with_codes then perform private.audit('coupons.export', p_product); end if;
  return jsonb_build_object(
    'free', (select count(*) from public.coupon_codes where product_id = p_product and redemption_code is null),
    'used', (select count(*) from public.coupon_codes where product_id = p_product and redemption_code is not null),
    'given', case when p_with_codes then (select coalesce(jsonb_agg(jsonb_build_object('code', code, 'order', redemption_code, 'at', assigned_at) order by assigned_at desc), '[]')
              from public.coupon_codes where product_id = p_product and redemption_code is not null) else '[]' end);
end $$;
-- add codes (pasted lines); the product then hands out codes and its stock = codes still free
create or replace function public.admin_add_coupons(p_product text, p_codes text[]) returns jsonb language plpgsql security definer set search_path = ''
as $$ declare added int; free int; begin
  perform private.need_admin();
  perform 1 from public.products where id = p_product for update;
  if not found then raise exception 'no_product'; end if;
  if coalesce(array_length(p_codes, 1), 0) > 5000 then raise exception 'too_many'; end if;
  perform set_config('eli.internal', '1', true);
  with ins as (insert into public.coupon_codes (product_id, code)
               select distinct p_product, left(trim(c), 64) from unnest(p_codes) c where trim(c) <> '' on conflict do nothing returning 1)
  select count(*) into added from ins;
  select count(*) into free from public.coupon_codes where product_id = p_product and redemption_code is null;
  update public.products set uses_codes = true, stock = free where id = p_product;
  perform set_config('eli.internal', '', true);
  perform private.audit('coupons.add', p_product, jsonb_build_object('added', added, 'free', free));
  return jsonb_build_object('added', added, 'skipped', coalesce(array_length(p_codes, 1), 0) - added, 'free', free);
end $$;
-- take back the codes nobody got yet (e.g. the partner campaign ended)
create or replace function public.admin_clear_coupons(p_product text) returns jsonb language plpgsql security definer set search_path = ''
as $$ declare removed int; begin
  perform private.need_admin();
  perform 1 from public.products where id = p_product for update;
  perform set_config('eli.internal', '1', true);
  with del as (delete from public.coupon_codes where product_id = p_product and redemption_code is null returning 1) select count(*) into removed from del;
  update public.products set stock = 0 where id = p_product and uses_codes;
  perform set_config('eli.internal', '', true);
  perform private.audit('coupons.clear', p_product, jsonb_build_object('removed', removed));
  return jsonb_build_object('removed', removed);
end $$;

/* ── game rules (owners change, everyone sees) ── */
create or replace function public.admin_settings() returns jsonb language plpgsql stable security definer set search_path = ''
as $$ begin
  perform private.need_admin();
  return (select jsonb_object_agg(key, jsonb_build_object('value', value, 'updated_at', updated_at, 'by', (select email from auth.users where id = updated_by))) from public.settings);
end $$;
create or replace function public.admin_set_setting(p_key text, p_value numeric) returns void language plpgsql security definer set search_path = ''
as $$ declare was numeric; lo numeric; hi numeric; begin
  perform private.need_owner();
  select value into was from public.settings where key = p_key for update;
  if not found then raise exception 'bad_setting'; end if;
  select a, b into lo, hi from (values ('coin_walk', 0, 10), ('coin_sleep', 0, 10), ('garden_max', 0, 20), ('chest_min', 0, 50), ('chest_max', 0, 100),
      ('run_coin', 0, 10), ('run_rewards_per_day', 0, 10), ('run_min_m', 0, 10000), ('level_bonus', 0, 100), ('shield_cost', 0, 1000), ('require_admin_mfa', 0, 1)) v(k, a, b) where k = p_key;
  if p_value is null or p_value < lo or p_value > hi or p_value <> round(p_value) then raise exception 'bad_value'; end if;
  if p_key = 'chest_max' and p_value < private.cfg('chest_min', 3) then raise exception 'bad_value'; end if;
  if p_key = 'chest_min' and p_value > private.cfg('chest_max', 7) then raise exception 'bad_value'; end if;
  -- turning 2-step sign-in on from a session that hasn't used it would lock everyone out (you included)
  if p_key = 'require_admin_mfa' and p_value = 1 and coalesce(auth.jwt()->>'aal', 'aal1') <> 'aal2' then raise exception 'mfa_first'; end if;
  update public.settings set value = p_value, updated_at = now(), updated_by = auth.uid() where key = p_key;
  perform private.audit('setting', p_key, jsonb_build_object('from', was, 'to', p_value));
end $$;

/* ── coin log, back-office log ── */
create or replace function public.admin_coin_log(p_reason text default '', p_limit int default 100, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$ declare res jsonb; total int; health boolean := private.can_health(); r text := coalesce(p_reason, ''); begin
  perform private.need_admin();
  if not health and r in ('walk', 'sleep') then r := 'quest'; end if;   -- without health access walk + sleep are one "daily quest"
  select coalesce(jsonb_agg(j), '[]'), coalesce(max(n), 0) into res, total from (
    select to_jsonb(c) || jsonb_build_object('member', p.name, 'citizen_id', lpad(p.citizen_no::text, 6, '0'))
           || case when not health and c.reason in ('walk', 'sleep') then '{"reason":"quest"}'::jsonb else '{}' end j, count(*) over () n
    from public.coin_log c join public.profiles p on p.id = c.user_id
    where r = '' or c.reason = r or (r = 'quest' and c.reason in ('walk', 'sleep'))
    order by c.at desc limit least(p_limit, 500) offset greatest(p_offset, 0)) x;
  return jsonb_build_object('rows', res, 'total', total);
end $$;
create or replace function public.admin_audit(p_action text default '', p_limit int default 100, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$ declare res jsonb; total int; begin
  perform private.need_admin();
  select coalesce(jsonb_agg(j), '[]'), coalesce(max(n), 0) into res, total from (
    select to_jsonb(l) || jsonb_build_object('member', p.name, 'member_id', lpad(p.citizen_no::text, 6, '0')) j, count(*) over () n
    from public.admin_log l left join public.profiles p on p.id::text = l.target
    where coalesce(p_action, '') = '' or l.action like p_action || '%'
    order by l.at desc limit least(p_limit, 500) offset greatest(p_offset, 0)) x;
  return jsonb_build_object('rows', res, 'total', total);
end $$;

/* ── the team ── */
create or replace function public.admin_team() returns jsonb language plpgsql stable security definer set search_path = ''
as $$ begin
  perform private.need_admin();
  return (select coalesce(jsonb_agg(jsonb_build_object('user_id', a.user_id, 'email', u.email, 'role', a.role, 'can_health', a.can_health, 'created_at', a.created_at,
            'mfa', exists (select 1 from auth.mfa_factors f where f.user_id = a.user_id and f.status = 'verified'),
            'mfa_trusted', exists (select 1 from auth.mfa_factors f where f.user_id = a.user_id and f.status = 'verified'
                                   and (f.created_at <= (select updated_at from public.settings where key = 'require_admin_mfa') or f.id = a.mfa_factor))) order by a.created_at), '[]')
          from public.admins a join auth.users u on u.id = a.user_id);
end $$;
create or replace function public.admin_set_team(p_email text, p_role text, p_can_health boolean default null) returns jsonb language plpgsql security definer set search_path = ''
as $$ declare uid uuid; begin
  perform private.need_owner();
  select id into uid from auth.users where lower(email) = lower(trim(p_email));
  if uid is null then raise exception 'no_account'; end if;
  if (p_role is null or p_role = '' or p_role = 'staff') and exists (select 1 from public.admins where user_id = uid and role = 'owner')
     and not exists (select 1 from public.admins where role = 'owner' and user_id <> uid) then raise exception 'last_owner'; end if;
  if p_role is null or p_role = '' then
    if uid = auth.uid() then raise exception 'not_yourself'; end if;
    delete from public.admins where user_id = uid;
  elsif p_role in ('owner', 'staff') then
    insert into public.admins (user_id, role, can_health) values (uid, p_role, coalesce(p_can_health, false))
      on conflict (user_id) do update set role = excluded.role, can_health = coalesce(p_can_health, public.admins.can_health);
  else raise exception 'bad_role'; end if;
  perform private.audit('team', lower(trim(p_email)), jsonb_build_object('role', nullif(p_role, ''), 'can_health', p_can_health));
  return public.admin_team();
end $$;

create or replace function public.admin_approve_mfa(p_email text) returns jsonb language plpgsql security definer set search_path = ''
as $$ declare uid uuid; f uuid; begin
  perform private.need_owner();
  select id into uid from auth.users where lower(email) = lower(trim(p_email));
  select id into f from auth.mfa_factors where user_id = uid and status = 'verified' order by created_at desc limit 1;
  if f is null then raise exception 'no_factor'; end if;
  update public.admins set mfa_factor = f where user_id = uid;
  if not found then raise exception 'no_account'; end if;
  perform private.audit('team.approve_mfa', lower(trim(p_email)), jsonb_build_object('factor', f));
  return public.admin_team();
end $$;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_admin(), private.is_owner(), private.can_health(), private.mfa_ok(), private.cfg(text, numeric) to authenticated;

-- ── 20261027000001_report_block.sql ──
-- Eli's World — report and block people in Hero Hall (Google Play's user-generated content rules: other people's names and
-- profile photos show in Hero Hall, so members can report one and block someone; the team reviews reports in the back office).

create table public.blocks (
  user_id uuid not null references public.profiles on delete cascade,
  blocked_id uuid not null references public.profiles on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, blocked_id),
  check (user_id <> blocked_id)
);

create table public.reports (
  id bigint generated always as identity primary key,
  reporter_id uuid references public.profiles on delete set null,   -- kept when the reporter deletes their account
  target_id uuid not null references public.profiles on delete cascade,
  reason text not null check (reason in ('name', 'photo', 'other')),
  note text not null default '' check (char_length(note) <= 300),
  status text not null default 'open' check (status in ('open', 'done', 'dismissed')),
  action text,                       -- what the team did: dismiss / clear_photo / reset_name / suspend
  handled_by uuid references auth.users on delete set null,
  handled_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index reports_one_open on public.reports (reporter_id, target_id) where status = 'open';   -- one open report per person each
create index reports_open on public.reports (created_at desc) where status = 'open';

alter table public.blocks enable row level security;
alter table public.reports enable row level security;
revoke all on public.blocks, public.reports from anon, authenticated;   -- only through the functions below

-- either one blocked the other
create or replace function private.blocked(a uuid, b uuid) returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.blocks where (user_id = a and blocked_id = b) or (user_id = b and blocked_id = a)) $$;

/* ───────────── what the app calls ───────────── */

create or replace function public.report_user(p_target uuid, p_reason text, p_note text default '') returns void language plpgsql security definer set search_path = ''
as $$ declare uid uuid := auth.uid(); begin
  perform private.member(uid);
  if p_target = uid or not exists (select 1 from public.profiles where id = p_target) then raise exception 'bad target'; end if;
  if p_reason not in ('name', 'photo', 'other') then raise exception 'bad reason'; end if;
  if (select count(*) from public.reports where reporter_id = uid and created_at > now() - interval '1 day') >= 20 then raise exception 'too_many_reports'; end if;
  insert into public.reports (reporter_id, target_id, reason, note) values (uid, p_target, p_reason, left(trim(coalesce(p_note, '')), 300))
  on conflict (reporter_id, target_id) where status = 'open' do update set reason = excluded.reason, note = excluded.note, created_at = now();
end $$;

-- block: they leave my Hero Hall and I leave theirs, the friendship ends, no hearts either way
create or replace function public.block_user(p_target uuid) returns void language plpgsql security definer set search_path = ''
as $$ declare uid uuid := auth.uid(); begin
  perform private.member(uid);
  if p_target = uid or not exists (select 1 from public.profiles where id = p_target) then raise exception 'bad target'; end if;
  insert into public.blocks (user_id, blocked_id) values (uid, p_target) on conflict do nothing;
  delete from public.friends where (user_id = uid and friend_id = p_target) or (user_id = p_target and friend_id = uid);
end $$;
create or replace function public.unblock_user(p_target uuid) returns void language plpgsql security definer set search_path = ''
as $$ begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  delete from public.blocks where user_id = auth.uid() and blocked_id = p_target;
end $$;
create or replace function public.my_blocks() returns jsonb language sql stable security definer set search_path = ''
as $$ select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'avatar', p.avatar) order by b.created_at desc), '[]')
      from public.blocks b join public.profiles p on p.id = b.blocked_id where b.user_id = auth.uid() $$;

-- Hero Hall without the people I blocked (or who blocked me)
create or replace function public.hall() returns jsonb language sql stable security definer set search_path = ''
as $$ with ids as (
    select auth.uid() as id
    union select friend_id from public.friends where user_id = auth.uid()
    union (select id from public.profiles p where not hall_hidden and suspended_at is null and not private.blocked(auth.uid(), p.id) order by total_lp desc limit 20)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.name, 'avatar', p.avatar, 'total', p.total_lp, 'streak', p.streak,
      'week', private.week_lp(p.id), 'me', p.id = auth.uid(),
      'friend', exists (select 1 from public.friends f where f.user_id = auth.uid() and f.friend_id = p.id),
      'away', not exists (select 1 from public.days d where d.user_id = p.id and d.day >= private.today() - 3),
      'sent', exists (select 1 from public.hearts h where h.from_id = auth.uid() and h.to_id = p.id and h.day = private.today()))), '[]')
  from public.profiles p join ids on ids.id = p.id
  where p.id = auth.uid() or (not p.hall_hidden and p.suspended_at is null and not private.blocked(auth.uid(), p.id)) $$;

create or replace function public.send_heart(p_to uuid) returns jsonb language plpgsql security definer set search_path = ''
as $$ declare uid uuid := auth.uid(); begin
  perform private.member(uid);
  if p_to = uid or not exists (select 1 from public.profiles where id = p_to) or private.blocked(uid, p_to) then raise exception 'bad target'; end if;
  insert into public.hearts (from_id, to_id, day) values (uid, p_to, private.today()) on conflict do nothing;
  insert into public.days (user_id, day) values (uid, private.today()) on conflict do nothing;
  update public.days set sent = true where user_id = uid and day = private.today();
  return private.state(uid);
end $$;

create or replace function public.add_friend(p_code text) returns jsonb language plpgsql security definer set search_path = ''
as $$ declare uid uuid := auth.uid(); f uuid; nm text; begin
  perform private.member(uid);
  select id, name into f, nm from public.profiles where invite_code = upper(trim(coalesce(p_code, '')));
  if f is null or f = uid or private.blocked(uid, f) then raise exception 'no_such_code'; end if;
  insert into public.friends (user_id, friend_id) values (uid, f), (f, uid) on conflict do nothing;
  return jsonb_build_object('id', f, 'name', nm);
end $$;

-- the PDPA copy also lists who I blocked
create or replace function private.export_user(uid uuid) returns jsonb language plpgsql stable security definer set search_path = ''
as $$ begin
  return jsonb_build_object(
    'exported_at', now(),
    'account', (select jsonb_build_object('email', email, 'created_at', created_at, 'last_sign_in_at', last_sign_in_at) from auth.users where id = uid),
    'profile', (select to_jsonb(p) - 'settled_to' - 'shield_streak' from public.profiles p where id = uid),
    'days', (select coalesce(jsonb_agg(to_jsonb(d) - 'user_id' order by d.day), '[]') from public.days d where user_id = uid),
    'runs', (select coalesce(jsonb_agg(to_jsonb(r) - 'user_id' order by r.created_at), '[]') from public.runs r where user_id = uid),
    'redemptions', (select coalesce(jsonb_agg(to_jsonb(o) - 'user_id' - 'admin_note' order by o.created_at), '[]') from public.redemptions o where user_id = uid),
    'coins', (select coalesce(jsonb_agg(to_jsonb(c) - 'user_id' - 'note' order by c.at), '[]') from public.coin_log c where user_id = uid),
    'friends', (select coalesce(jsonb_agg(p.name), '[]') from public.friends f join public.profiles p on p.id = f.friend_id where f.user_id = uid),
    'blocked', (select coalesce(jsonb_agg(p.name), '[]') from public.blocks b join public.profiles p on p.id = b.blocked_id where b.user_id = uid));
end $$;

/* ───────────── back office ───────────── */

-- reports, newest first; open ones by default. Who reported stays with the team only.
create or replace function public.admin_reports(p_status text default 'open', p_limit int default 50, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$ declare res jsonb; total int; begin
  perform private.need_admin();
  select coalesce(jsonb_agg(j), '[]'), coalesce(max(n), 0) into res, total from (
    select jsonb_build_object('id', r.id, 'reason', r.reason, 'note', r.note, 'status', r.status, 'action', r.action, 'created_at', r.created_at, 'handled_at', r.handled_at,
             'handled_by', (select email from auth.users where id = r.handled_by),
             'target', jsonb_build_object('id', t.id, 'name', t.name, 'avatar', t.avatar, 'citizen_id', lpad(t.citizen_no::text, 6, '0'), 'suspended_at', t.suspended_at,
                         'open_reports', (select count(*) from public.reports x where x.target_id = t.id and x.status = 'open')),
             'reporter', case when rp.id is null then null else jsonb_build_object('id', rp.id, 'name', rp.name, 'citizen_id', lpad(rp.citizen_no::text, 6, '0')) end) j,
           count(*) over () n
    from public.reports r join public.profiles t on t.id = r.target_id left join public.profiles rp on rp.id = r.reporter_id
    where coalesce(p_status, '') = '' or r.status = p_status
    order by r.created_at desc
    limit least(p_limit, 200) offset greatest(p_offset, 0)) x;
  return jsonb_build_object('rows', res, 'total', total, 'open', (select count(*) from public.reports where status = 'open'));
end $$;

-- act on a report: dismiss it, or remove the photo / reset the name (staff), or suspend (owners). Every open report on the
-- same person closes with it, and the step goes to the back-office log.
create or replace function public.admin_resolve_report(p_id bigint, p_action text, p_reason text default '') returns void language plpgsql security definer set search_path = ''
as $$ declare r public.reports; begin
  perform private.need_admin();
  select * into r from public.reports where id = p_id;
  if not found then raise exception 'no_report'; end if;
  if p_action = 'clear_photo' then update public.profiles set avatar = null where id = r.target_id;
  elsif p_action = 'reset_name' then update public.profiles set name = 'พลเมือง #' || lpad(citizen_no::text, 6, '0') where id = r.target_id;
  elsif p_action = 'suspend' then perform public.admin_suspend(r.target_id, coalesce(nullif(trim(p_reason), ''), 'ถูกรายงานใน Hero Hall'));
  elsif p_action <> 'dismiss' then raise exception 'bad_action'; end if;
  if p_action = 'dismiss' then
    update public.reports set status = 'dismissed', action = p_action, handled_by = auth.uid(), handled_at = now() where id = p_id;
  else
    update public.reports set status = 'done', action = p_action, handled_by = auth.uid(), handled_at = now() where target_id = r.target_id and (status = 'open' or id = p_id);
  end if;
  perform private.audit('report.' || p_action, r.target_id::text, jsonb_build_object('report', p_id, 'reason', r.reason));
end $$;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_admin(), private.is_owner(), private.can_health(), private.mfa_ok(), private.cfg(text, numeric) to authenticated;

-- ── seed.sql ──
-- Treasury items shown in the approved UI. Edit, add or hide them in the Supabase dashboard (Table editor → products).
insert into public.products (id, tab, name, coins, img, is_new, sort) values
  ('shorts',   'orig', 'กางเกงวิ่ง eli',          1200, 'p_shorts',      true,  1),
  ('tee',      'orig', 'เสื้อ eli Everyday',        900, 'p_tee',         false, 2),
  ('cap',      'orig', 'หมวกวิ่ง eli',              600, 'p_cap',         false, 3),
  ('socks',    'orig', 'ถุงเท้าวิ่ง',                300, 'p_socks',       false, 4),
  ('shoe10',   'fr',   'คูปองรองเท้าวิ่ง 10%',       500, 'i_sneaker',     false, 1),
  ('bottle',   'fr',   'ขวดน้ำ Sport',              450, 'it_bottle',     false, 2),
  ('smoothie', 'fr',   'สมูทตี้ฟรี 1 แก้ว',           250, 'it_gift',       false, 3),
  ('gym',      'fr',   'ฟิตเนส 1 เดือน',            1500, 'it_medal',      false, 4)
on conflict (id) do nothing;

-- ── users.sql ──
insert into auth.users (email, created_at, last_sign_in_at) select e, now() - interval '45 days', now() - interval '1 hour'
from unnest(array['admin@eli.test', 'staff@eli.test'] || array(select 'member' || lpad(n::text, 2, '0') || '@eli.test' from generate_series(1, 24) n)) e;

-- ── demo-data.sql ──
begin;
-- LOCAL TESTING ONLY: 30 days of history for the demo members (run after demo-users.mjs).
insert into public.admins (user_id, role) select id, 'owner' from auth.users where email = 'admin@eli.test' on conflict do nothing;
insert into public.admins (user_id, role) select id, 'staff' from auth.users where email = 'staff@eli.test' on conflict do nothing;
delete from public.profiles where id in (select id from auth.users where email in ('admin@eli.test', 'staff@eli.test'));   -- staff don't play
with names(nm, n) as (select nm, n::int from unnest(array['พลอย','ต้นกล้า','ฟ้า ใส','มินท์','แพรว','บอส','นุ่น','เจ','ปั้น','ใบเตย','กาย','น้ำหวาน','ภูมิ','ข้าวหอม','ไอซ์','แนน','โอ๊ต','เฟิร์น','ต้า','มายด์','บีม','ปลาย','ก้อง','จูน']) with ordinality as t(nm, n))
update public.profiles p set name = names.nm, setup = true, birth = date '1985-01-01' + (names.n * 397 % 6000)::int,
  gender = case when names.n % 3 = 0 then 'm' else 'f' end, bio = 'สายเดินยามเช้า',
  created_at = now() - make_interval(days => 40 - names.n),
  total_lp = (array[91000,38000,6000,9200,1750,420,100,15400,3300,12800,640,2200,27500,880,5100,300,7600,1100,19900,450,2600,9900,150,3900])[names.n::int],
  streak = (names.n * 7) % 31, coins = (names.n * 137) % 1900 + 40
from auth.users u, names where u.id = p.id and u.email = 'member' || lpad(names.n::text, 2, '0') || '@eli.test';
-- daily rows: most members open the app most days
insert into public.days (user_id, day, steps, sleep, pet, sent, earned)
select p.id, private.today() - k, 2500 + ((p.citizen_no * 977 + k * 331) % 9000), round((5 + ((p.citizen_no * 13 + k * 7) % 40) / 10.0)::numeric, 1),
       (p.citizen_no + k) % 3 > 0, (p.citizen_no + k) % 4 = 0, case when k > 0 then 40 + (p.citizen_no * 11 + k * 17) % 120 end
from public.profiles p, generate_series(0, 29) k
where p.id in (select id from auth.users where email like 'member%@eli.test') and ((p.citizen_no * 31 + k * 17) % 10 < 7 or k < 2)
on conflict do nothing;
update public.profiles set settled_to = private.today() - 1 where id in (select id from auth.users where email like 'member%@eli.test');
-- runs
insert into public.runs (user_id, started_at, sec, meters, lp, coin, created_at)
select p.id, now() - make_interval(days => k, hours => 7), (900 + (p.citizen_no * 97 + k * 61) % 2400)::int, (1500 + (p.citizen_no * 389 + k * 211) % 7500)::int, 30, 1, now() - make_interval(days => k, hours => 6)
from public.profiles p, generate_series(0, 20, 3) k where p.id in (select id from auth.users where email like 'member%@eli.test') and (p.citizen_no + k) % 2 = 0;
-- coin log (rewards) so the overview has numbers
insert into public.coin_log (user_id, delta, reason, ref, at)
select d.user_id, 1, 'walk', d.day::text, d.day + time '19:00' from public.days d where d.steps >= 7000 on conflict do nothing;
insert into public.coin_log (user_id, delta, reason, ref, at)
select d.user_id, 1, 'sleep', d.day::text, d.day + time '08:00' from public.days d where d.sleep between 7 and 9 on conflict do nothing;
-- orders in every state
insert into public.redemptions (code, user_id, items, total, status, ship_name, ship_phone, ship_address, ship_note, tracking, created_at)
select 'ELI-' || upper(substr(md5(p.id::text || k), 1, 4)) || '-' || upper(substr(md5(k || p.id::text), 1, 4)), p.id,
  jsonb_build_array(jsonb_build_object('id', pr.id, 'name', pr.name, 'coins', pr.coins, 'img', pr.img)), pr.coins,
  (array['new','new','shipping','done','done','cancelled'])[1 + (p.citizen_no + k) % 6],
  p.name || ' ' || (array['ใจดี','สุขสันต์','รักเดิน','มีสุข'])[1 + k % 4], '08' || lpad(((p.citizen_no * 7919 + k) % 100000000)::text, 8, '0'),
  (array['99/1 ถ.สุขุมวิท แขวงคลองเตย เขตคลองเตย กรุงเทพฯ 10110','12 ม.3 ต.สุเทพ อ.เมือง จ.เชียงใหม่ 50200','45/7 ซ.ลาดพร้าว 71 แขวงลาดพร้าว กรุงเทพฯ 10230','8 ถ.มิตรภาพ ต.ในเมือง อ.เมือง จ.ขอนแก่น 40000'])[1 + (p.citizen_no + k) % 4],
  case when k % 3 = 0 then 'ฝากป้อมยาม' else '' end,
  case when (array['new','new','shipping','done','done','cancelled'])[1 + (p.citizen_no + k) % 6] in ('shipping','done') then 'TH' || lpad(((p.citizen_no * 104729 + k) % 1000000000)::text, 10, '0') end,
  now() - make_interval(days => ((p.citizen_no * 3 + k * 5) % 25)::int, hours => k)
from public.profiles p, generate_series(1, 2) k, lateral (select * from public.products order by md5(p.id::text || k) limit 1) pr
where p.id in (select id from auth.users where email like 'member%@eli.test') and (p.citizen_no % 2 = 1 or k = 1);
update public.products set stock = 3 where id = 'shorts';
update public.products set stock = 40 where id = 'tee';
-- costs, partner coupon codes, a coin event, news, someone odd to look at
update public.products set cost_thb = v from (values ('shorts', 390), ('tee', 290), ('cap', 210), ('socks', 90), ('shoe10', 0), ('bottle', 150), ('smoothie', 65), ('gym', 590)) x(id, v) where products.id = x.id;
insert into public.coupon_codes (product_id, code) select 'shoe10', 'RUNSHOE10-' || upper(substr(md5(g::text), 1, 6)) from generate_series(1, 20) g;
update public.products set uses_codes = true, stock = 20 where id = 'shoe10';
insert into public.campaigns (name, coin_mult, starts_at, ends_at) values ('ฉลองเปิดตัว Eli''s World', 2, now() - interval '1 day', now() + interval '3 days');
insert into public.announcements (title, body, starts_at, ends_at) values ('ยินดีต้อนรับสู่ Eli''s World 💙', 'ช่วงเปิดตัว เดิน นอน และวิ่ง ได้เหรียญ ×2 ถึงสิ้นเดือนนี้ แลกของได้ที่ Treasury', now() - interval '1 day', now() + interval '7 days');
update public.days set steps = 71000 where user_id = (select id from auth.users where email = 'member07@eli.test') and day = private.today() - 1;
insert into public.runs (user_id, started_at, sec, meters, lp, coin) select id, now() - interval '2 days', 1200, 12000, 0, 0 from auth.users where email = 'member07@eli.test';
-- two reports from Hero Hall waiting for the team
insert into public.reports (reporter_id, target_id, reason, note, created_at)
select r.id, t.id, x.reason, x.note, now() - x.ago from (values ('member03', 'member12', 'name', 'ชื่อมีคำหยาบ', interval '3 hours'), ('member05', 'member12', 'name', '', interval '1 hour'), ('member09', 'member17', 'photo', 'รูปไม่เหมาะกับคนทั่วไป', interval '20 minutes')) x(rep, tgt, reason, note, ago)
join auth.users r on r.email = x.rep || '@eli.test' join auth.users t on t.email = x.tgt || '@eli.test';
select (select count(*) from public.profiles) members, (select count(*) from public.days) days, (select count(*) from public.runs) runs, (select count(*) from public.redemptions) orders;
commit;
