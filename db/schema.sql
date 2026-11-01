-- American Flyers database (Neon Postgres, project "americanflyers").
-- Applied through the Neon console / MCP; kept here for reference and to
-- rebuild a branch. Auth is Neon Auth (Better Auth): users live in
-- neon_auth."user" and auth.user_id() returns the signed-in user's id.
-- The browser talks to these tables through the Neon Data API as the
-- "authenticated" role; row-level security keeps each rider to their own rows.

-- ------------------------------------------------------------ riders ----

create table public.profiles (
  user_id text primary key default auth.user_id(),
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.workouts (
  id text primary key,
  user_id text not null default auth.user_id(),
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create index workouts_user_idx on public.workouts (user_id);

create table public.routes (
  id text primary key,
  user_id text not null default auth.user_id(),
  name text not null,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create index routes_user_idx on public.routes (user_id);

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default auth.user_id(),
  started_at timestamptz not null,
  title text not null,
  stage_id text,
  stage_name text,
  finished boolean not null default false,
  workout_name text,
  duration_s integer not null,
  distance_m real not null default 0,
  climbed_m real not null default 0,
  avg_power real,
  np real,
  max_power real,
  avg_hr real,
  max_hr real,
  avg_cadence real,
  kj real,
  tss real,
  ftp integer,
  best_power jsonb,      -- {"5": W, "60": W, "300": W, "1200": W}
  hr_zones jsonb,        -- seconds in each of the 5 heart-rate zones
  power_zones jsonb,     -- seconds in each of the 6 power zones
  max_hr_setting integer,
  samples jsonb,         -- 1 s samples: power, cadence, hr, speed, distance, elevation
  finish_s integer check (finish_s > 0), -- moving time to the finish line, for rides of a whole stage
  created_at timestamptz not null default now()
);
create index activities_user_started_idx on public.activities (user_id, started_at desc);

create table public.ftp_history (
  id bigint generated always as identity primary key,
  user_id text not null default auth.user_id(),
  ftp integer not null check (ftp between 30 and 800),
  source text not null default 'manual' check (source in ('manual', 'ramp_test', 'signup')),
  recorded_at timestamptz not null default now()
);
create index ftp_history_user_idx on public.ftp_history (user_id, recorded_at);

do $$
declare t text;
begin
  foreach t in array array['profiles', 'workouts', 'routes', 'activities', 'ftp_history'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for all to authenticated using (user_id = (select auth.user_id())) with check (user_id = (select auth.user_id()))', t || '_owner', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('revoke all on public.%I from anonymous', t);
  end loop;
end $$;

-- ------------------------------------------------------------- admin ----

create table public.admins (email text primary key);
alter table public.admins enable row level security; -- no grants: only security-definer functions read it
insert into public.admins values ('sirhodgson@gmail.com');

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from neon_auth."user" u
    join public.admins a on lower(a.email) = lower(u.email)
    where u.id::text = auth.user_id() and u."emailVerified" and not coalesce(u.banned, false)
  )
$$;

-- ---------------------------------------------------------- feedback ----

create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default auth.user_id(),
  category text not null check (category in ('idea', 'bug', 'other')),
  message text not null check (char_length(message) between 3 and 4000),
  context jsonb,
  status text not null default 'new' check (status in ('new', 'planned', 'in_progress', 'done', 'declined')),
  admin_reply text check (char_length(admin_reply) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index feedback_user_idx on public.feedback (user_id, created_at desc);

-- Riders can't pick their status or reply; admins can't rewrite the message.
create or replace function public.feedback_on_insert() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.user_id := auth.user_id();
  new.status := 'new';
  new.admin_reply := null;
  new.created_at := now();
  new.updated_at := now();
  return new;
end $$;
create trigger feedback_on_insert before insert on public.feedback for each row execute function public.feedback_on_insert();

create or replace function public.feedback_on_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.user_id := old.user_id;
  new.message := old.message;
  new.category := old.category;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end $$;
create trigger feedback_on_update before update on public.feedback for each row execute function public.feedback_on_update();

alter table public.feedback enable row level security;
create policy feedback_insert_own on public.feedback for insert to authenticated with check (user_id = (select auth.user_id()));
create policy feedback_read on public.feedback for select to authenticated using (user_id = (select auth.user_id()) or (select public.is_admin()));
create policy feedback_admin_update on public.feedback for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy feedback_admin_delete on public.feedback for delete to authenticated using ((select public.is_admin()));
grant select, insert, update, delete on public.feedback to authenticated;
revoke all on public.feedback from anonymous;

-- ------------------------------------------------- admin dashboard ----

create or replace function public.admin_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r jsonb;
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  select jsonb_build_object(
    'users_total', (select count(*) from neon_auth."user"),
    'users_7d', (select count(*) from neon_auth."user" where "createdAt" > now() - interval '7 days'),
    'users_30d', (select count(*) from neon_auth."user" where "createdAt" > now() - interval '30 days'),
    'banned', (select count(*) from neon_auth."user" where coalesce(banned, false)),
    'active_7d', (select count(distinct user_id) from public.activities where started_at > now() - interval '7 days'),
    'active_30d', (select count(distinct user_id) from public.activities where started_at > now() - interval '30 days'),
    'activities_total', (select count(*) from public.activities),
    'activities_7d', (select count(*) from public.activities where started_at > now() - interval '7 days'),
    'hours_total', (select round(coalesce(sum(duration_s), 0) / 3600.0, 1) from public.activities),
    'km_total', (select round(coalesce(sum(distance_m), 0)::numeric / 1000, 1) from public.activities),
    'climbed_total', (select round(coalesce(sum(climbed_m), 0)::numeric) from public.activities),
    'kj_total', (select round(coalesce(sum(kj), 0)::numeric) from public.activities),
    'workouts_saved', (select count(*) from public.workouts),
    'routes_saved', (select count(*) from public.routes),
    'feedback_new', (select count(*) from public.feedback where status = 'new'),
    'feedback_total', (select count(*) from public.feedback),
    'signups_by_day', (
      select coalesce(jsonb_agg(jsonb_build_object('day', d::date, 'n', (select count(*) from neon_auth."user" u where u."createdAt"::date = d::date)) order by d), '[]'::jsonb)
      from generate_series(current_date - 29, current_date, interval '1 day') d),
    'rides_by_day', (
      select coalesce(jsonb_agg(jsonb_build_object('day', d::date, 'n', (select count(*) from public.activities a where a.started_at::date = d::date)) order by d), '[]'::jsonb)
      from generate_series(current_date - 29, current_date, interval '1 day') d),
    'top_stages', (
      select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select coalesce(stage_name, stage_id, 'Unknown') as name, count(*) as rides, count(distinct user_id) as riders, count(*) filter (where finished) as finishes
        from public.activities group by 1 order by 2 desc limit 8) t),
    'top_workouts', (
      select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select workout_name as name, count(*) as rides, count(distinct user_id) as riders
        from public.activities where workout_name is not null group by 1 order by 2 desc limit 8) t)
  ) into r;
  return r;
end $$;

create or replace function public.admin_users()
returns table (id text, name text, email text, joined timestamptz, banned boolean, admin boolean, rides bigint, hours numeric, km numeric, last_ride timestamptz, feedback bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  return query
  select u.id::text, u.name, u.email, u."createdAt", coalesce(u.banned, false),
         exists (select 1 from public.admins ad where lower(ad.email) = lower(u.email)),
         count(act.id), round(coalesce(sum(act.duration_s), 0) / 3600.0, 1), round(coalesce(sum(act.distance_m), 0)::numeric / 1000, 1),
         max(act.started_at),
         (select count(*) from public.feedback f where f.user_id = u.id::text)
  from neon_auth."user" u
  left join public.activities act on act.user_id = u.id::text
  group by u.id
  order by u."createdAt" desc;
end $$;

create or replace function public.admin_set_ban(target text, ban boolean, reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  if target = auth.user_id() then raise exception 'You can''t ban yourself'; end if;
  if ban and exists (select 1 from neon_auth."user" u join public.admins a on lower(a.email) = lower(u.email) where u.id::text = target) then
    raise exception 'Admins can''t be banned. Remove them from public.admins first.';
  end if;
  update neon_auth."user" set banned = ban, "banReason" = case when ban then reason end, "banExpires" = null where id::text = target;
  if ban then delete from neon_auth.session where "userId"::text = target; end if;
end $$;

create or replace function public.admin_feedback()
returns table (id uuid, category text, message text, context jsonb, status text, admin_reply text, created_at timestamptz, user_name text, user_email text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  return query
  select f.id, f.category, f.message, f.context, f.status, f.admin_reply, f.created_at, u.name, u.email
  from public.feedback f left join neon_auth."user" u on u.id::text = f.user_id
  order by (f.status = 'new') desc, f.created_at desc
  limit 500;
end $$;

revoke execute on function public.is_admin(), public.admin_overview(), public.admin_users(), public.admin_set_ban(text, boolean, text), public.admin_feedback() from public, anonymous;
grant execute on function public.is_admin(), public.admin_overview(), public.admin_users(), public.admin_set_ban(text, boolean, text), public.admin_feedback() to authenticated;

-- ----------------------------------------------------- riding together ----
-- Where each signed-in rider is right now, so riders on the same stage see
-- each other on the road. The browser calls ride_presence() every couple of
-- seconds: it records the caller's position and returns the other riders on
-- that stage seen in the last 15 s (names shortened to "First L.", ids
-- hashed), with the kit (jersey, accent and frame colours) each is wearing.
-- No direct table access.

create table public.live_riders (
  user_id text primary key,
  stage_id text not null,
  distance real not null,
  speed real not null default 0,
  power smallint not null default 0,
  cadence smallint not null default 0,
  kit text, -- "#jersey,#accent,#frame", validated by ride_presence(); null = the default kit
  updated_at timestamptz not null default now()
);
create index live_riders_stage_idx on public.live_riders (stage_id, updated_at);
alter table public.live_riders enable row level security; -- no grants: only the functions below touch it

create or replace function public.short_name(full_name text) returns text
language sql immutable set search_path = '' as $$
  select case
    when coalesce(trim(full_name), '') = '' then 'Rider'
    when position(' ' in trim(full_name)) = 0 then left(trim(full_name), 20)
    else left(split_part(trim(full_name), ' ', 1), 20) || ' ' || upper(left(split_part(trim(full_name), ' ', 2), 1)) || '.'
  end
$$;

-- p_kit is optional, so clients from before kits existed (six arguments) still work.
create or replace function public.ride_presence(p_stage text, p_distance real, p_speed real, p_power integer, p_cadence integer, p_visible boolean default true, p_kit text default null)
returns table (id text, name text, distance real, speed real, power integer, cadence integer, age_ms integer, kit text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  me text := auth.user_id();
  my_kit text := case when p_kit ~ '^#[0-9a-fA-F]{6},#[0-9a-fA-F]{6},#[0-9a-fA-F]{6}(;[a-z]{1,2}=[a-z0-9]{1,12}){0,8}$' then lower(p_kit) else null end;
begin
  if me is null then raise exception 'Sign in to ride with others' using errcode = '42501'; end if;
  if p_visible then
    insert into public.live_riders as l (user_id, stage_id, distance, speed, power, cadence, kit, updated_at)
    values (me, left(p_stage, 80), greatest(-1000, least(p_distance, 1000000)), greatest(0, least(p_speed, 40)),
            greatest(0, least(p_power, 3000)), greatest(0, least(p_cadence, 250)), my_kit, now())
    on conflict (user_id) do update set stage_id = excluded.stage_id, distance = excluded.distance, speed = excluded.speed,
      power = excluded.power, cadence = excluded.cadence, kit = excluded.kit, updated_at = excluded.updated_at;
  else
    delete from public.live_riders where user_id = me;
  end if;
  -- Riders who closed the tab without saying goodbye.
  delete from public.live_riders where updated_at < now() - interval '10 minutes';
  return query
    select md5(l.user_id), public.short_name(u.name), l.distance, l.speed, l.power::integer, l.cadence::integer,
           (extract(epoch from now() - l.updated_at) * 1000)::integer, l.kit
    from public.live_riders l
    join neon_auth."user" u on u.id::text = l.user_id
    where l.stage_id = left(p_stage, 80) and l.user_id <> me and l.updated_at > now() - interval '15 seconds'
      and not coalesce(u.banned, false)
    order by abs(l.distance - p_distance)
    limit 30;
end $$;

create or replace function public.leave_ride() returns void
language sql security definer set search_path = '' as $$
  delete from public.live_riders where user_id = auth.user_id()
$$;

revoke all on public.live_riders from public, anonymous, authenticated;
revoke execute on function public.ride_presence(text, real, real, integer, integer, boolean, text), public.leave_ride(), public.short_name(text) from public, anonymous;
grant execute on function public.ride_presence(text, real, real, integer, integer, boolean, text), public.leave_ride() to authenticated;

-- ---------------------------------------------------------- ride-ons ----
-- A quick 👍 🔥 💪 👋 sent to another rider on the road (no free text). The
-- target is named by the md5 id that ride_presence() returns, and must have
-- been seen in the last 15 s. Limits: one per target per 20 s, 20 a minute.
-- No direct table access; my_ride_ons() also clears rows older than a day.

create table public.ride_ons (
  id bigserial primary key,
  from_user text not null,
  to_user text not null,
  emote text not null check (emote in ('👍','🔥','💪','👋')),
  created_at timestamptz not null default now()
);
create index ride_ons_to_idx on public.ride_ons (to_user, created_at);
create index ride_ons_from_idx on public.ride_ons (from_user, created_at);
alter table public.ride_ons enable row level security; -- no grants: only the functions below touch it
revoke all on public.ride_ons from public, anonymous, authenticated;
revoke all on sequence public.ride_ons_id_seq from public, anonymous, authenticated;

create or replace function public.send_ride_on(p_to text, p_emote text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me text := auth.user_id();
  target text;
begin
  if me is null then raise exception 'Sign in to send ride-ons' using errcode = '42501'; end if;
  if p_emote is null or p_emote not in ('👍','🔥','💪','👋') then raise exception 'Unknown ride-on'; end if;
  select l.user_id into target
  from public.live_riders l
  left join neon_auth."user" u on u.id::text = l.user_id
  where md5(l.user_id) = p_to and l.updated_at > now() - interval '15 seconds' and not coalesce(u.banned, false)
  limit 1;
  if target is null then raise exception 'That rider isn''t riding right now'; end if;
  if target = me then raise exception 'You can''t send a ride-on to yourself'; end if;
  if exists (select 1 from public.ride_ons where from_user = me and to_user = target and created_at > now() - interval '20 seconds') then
    raise exception 'You just sent them one. Give it a few seconds';
  end if;
  if (select count(*) from public.ride_ons where from_user = me and created_at > now() - interval '1 minute') >= 20 then
    raise exception 'Easy there: too many ride-ons this minute';
  end if;
  insert into public.ride_ons (from_user, to_user, emote) values (me, target, p_emote);
end $$;

create or replace function public.my_ride_ons(p_since timestamptz default null)
returns table (id bigint, from_id text, name text, emote text, created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare me text := auth.user_id();
begin
  if me is null then raise exception 'Sign in to get ride-ons' using errcode = '42501'; end if;
  delete from public.ride_ons where created_at < now() - interval '1 day';
  return query
    select r.id, md5(r.from_user), public.short_name(u.name), r.emote, r.created_at
    from public.ride_ons r
    left join neon_auth."user" u on u.id::text = r.from_user
    where r.to_user = me and r.created_at > coalesce(p_since, now() - interval '1 minute') and not coalesce(u.banned, false)
    order by r.created_at
    limit 20;
end $$;

revoke execute on function public.send_ride_on(text, text), public.my_ride_ons(timestamptz) from public, anonymous;
grant execute on function public.send_ride_on(text, text), public.my_ride_ons(timestamptz) to authenticated;

-- -------------------------------------------------- leaderboards & ghosts ----
-- A rider's fastest whole-stage ride counts on that stage's leaderboard
-- (finish_s: moving time from the start line to the finish). Any signed-in
-- rider can race the ghost of a leaderboard ride: only its distance trace is
-- shared.

create index activities_stage_finish_idx on public.activities (stage_id, finish_s) where finish_s is not null;

create or replace function public.stage_leaderboard(p_stage text, p_since timestamptz default null)
returns table (rank bigint, activity_id uuid, name text, finish_s integer, avg_power real, ridden_at timestamptz, is_me boolean)
language sql stable security definer set search_path = '' as $$
  with best as (
    select distinct on (a.user_id) a.user_id, a.id, a.finish_s, a.avg_power, a.started_at
    from public.activities a
    join neon_auth."user" u on u.id::text = a.user_id and not coalesce(u.banned, false)
    where a.stage_id = p_stage and a.finish_s is not null and (p_since is null or a.started_at >= p_since)
    order by a.user_id, a.finish_s, a.started_at
  ), ranked as (
    select rank() over (order by b.finish_s) as rank, b.* from best b
  )
  select r.rank, r.id, public.short_name(u.name), r.finish_s, r.avg_power, r.started_at, r.user_id = auth.user_id()
  from ranked r join neon_auth."user" u on u.id::text = r.user_id
  where r.rank <= 25 or r.user_id = auth.user_id()
  order by r.rank, r.started_at
$$;

create or replace function public.stage_ghost(p_activity uuid)
returns table (name text, finish_s integer, distance jsonb, is_me boolean)
language sql stable security definer set search_path = '' as $$
  select public.short_name(u.name), a.finish_s, a.samples -> 'distance', a.user_id = auth.user_id()
  from public.activities a
  join neon_auth."user" u on u.id::text = a.user_id and not coalesce(u.banned, false)
  where a.id = p_activity and a.finish_s is not null and auth.user_id() is not null
$$;

revoke execute on function public.stage_leaderboard(text, timestamptz), public.stage_ghost(uuid) from public, anonymous;
grant execute on function public.stage_leaderboard(text, timestamptz), public.stage_ghost(uuid) to authenticated;


-- ------------------------------------- garage, credits, levels, challenges ----
-- Credits and XP come from saved rides (never from the browser): per ride, 1
-- credit per km and 1 per 10 m climbed, 5 XP per km and 0.5 XP per metre
-- climbed, plus weekly-challenge rewards (credits) and 25 XP per challenge.
-- Rides count only if they have power data (avg_power <= 1500 W), last at
-- least a minute, aren't demo rides, and distance/climb are capped by what's
-- physically possible for the ride's duration. Levels 1-50 follow
-- level_xp(n) = 100 * (n - 1)^1.6. rider_progress is a high-water mark of km and
-- climbing, so deleting a ride never takes an unlocked item (or the Tron
-- bike, 8,848 m of climbing) away. No direct table access: everything goes
-- through the security-definer functions below.

alter table public.activities add column if not exists race_place smallint;  -- finishing place in a race
alter table public.activities add column if not exists race_size smallint;   -- riders in that race
alter table public.activities add column if not exists pro_m real;           -- metres ridden alongside a pro team

create table if not exists public.store_items (
  id text primary key,
  slot text not null,                 -- frame | wheels | tyres | helmet | jersey | socks
  name text not null,
  price integer not null,
  level_req integer not null default 1,
  unlock jsonb not null default '{}', -- e.g. {"climbed_m": 8848}
  effects jsonb not null default '{}',-- {"cda": -0.025, "mass": -0.8, "crr": -0.0005}: informational, the app applies them
  starter boolean not null default false,
  sort integer not null default 0
);
create table if not exists public.purchases (
  user_id text not null default auth.user_id(),
  item_id text not null,
  price integer not null,
  bought_at timestamptz not null default now(),
  primary key (user_id, item_id)
);
create table if not exists public.challenge_claims (
  user_id text not null default auth.user_id(),
  challenge_id text not null,
  week text not null,                 -- ISO week, e.g. 2026-W44
  credits integer not null,
  claimed_at timestamptz not null default now(),
  primary key (user_id, challenge_id, week)
);
create table if not exists public.rider_progress (
  user_id text primary key,
  km numeric not null default 0,
  climbed_m numeric not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.store_items enable row level security;
alter table public.purchases enable row level security;
alter table public.challenge_claims enable row level security;
alter table public.rider_progress enable row level security;
-- (no policies: only the functions below, which run as their owner, touch them)

-- The catalogue. Generated from src/garage/catalogue.ts by `node scripts/gen-store-sql.mjs`.
insert into public.store_items (id, slot, name, price, level_req, unlock, effects, starter, sort) values
  ('frame-classic', 'frame', 'Classic road bike', 0, 1, '{}'::jsonb, '{}'::jsonb, true, 0),
  ('frame-aero', 'frame', 'Aero road frame', 700, 4, '{}'::jsonb, '{"cda":-0.025}'::jsonb, false, 1),
  ('frame-climber', 'frame', 'Climbing frame', 700, 4, '{}'::jsonb, '{"mass":-0.8}'::jsonb, false, 2),
  ('frame-tt', 'frame', 'Time-trial bike', 1200, 8, '{}'::jsonb, '{"cda":-0.05,"mass":0.4}'::jsonb, false, 3),
  ('frame-tron', 'frame', 'The Tron bike', 0, 1, '{"climbed_m":8848}'::jsonb, '{"cda":-0.025,"mass":-0.3}'::jsonb, false, 4),
  ('wheels-alloy35', 'wheels', '35 mm alloy wheels', 0, 1, '{}'::jsonb, '{}'::jsonb, true, 5),
  ('wheels-carbon50', 'wheels', '50 mm carbon wheels', 450, 3, '{}'::jsonb, '{"cda":-0.015}'::jsonb, false, 6),
  ('wheels-deep80', 'wheels', '80 mm deep wheels', 650, 6, '{}'::jsonb, '{"cda":-0.025,"mass":0.25}'::jsonb, false, 7),
  ('wheels-climb', 'wheels', 'Lightweight climbing wheels', 500, 5, '{}'::jsonb, '{"mass":-0.45}'::jsonb, false, 8),
  ('wheels-disc', 'wheels', 'Disc wheel (time-trial bike only)', 900, 10, '{}'::jsonb, '{"cda":-0.035,"mass":0.4}'::jsonb, false, 9),
  ('tyres-standard', 'tyres', 'Standard tyres', 0, 1, '{}'::jsonb, '{}'::jsonb, true, 10),
  ('tyres-race', 'tyres', 'Race tyres', 250, 2, '{}'::jsonb, '{"crr":-0.0005}'::jsonb, false, 11),
  ('helmet-standard', 'helmet', 'White road helmet', 0, 1, '{}'::jsonb, '{}'::jsonb, true, 12),
  ('helmet-black', 'helmet', 'Black road helmet', 60, 1, '{}'::jsonb, '{}'::jsonb, false, 13),
  ('helmet-aero', 'helmet', 'Aero helmet', 300, 3, '{}'::jsonb, '{"cda":-0.015}'::jsonb, false, 14),
  ('helmet-aero-dark', 'helmet', 'Aero helmet (carbon black)', 340, 3, '{}'::jsonb, '{"cda":-0.015}'::jsonb, false, 15),
  ('jersey-plain', 'jersey', 'Plain jersey', 0, 1, '{}'::jsonb, '{}'::jsonb, true, 16),
  ('jersey-stripes', 'jersey', 'Stripes', 120, 2, '{}'::jsonb, '{}'::jsonb, false, 17),
  ('jersey-hoops', 'jersey', 'Hoops', 150, 3, '{}'::jsonb, '{}'::jsonb, false, 18),
  ('jersey-chevrons', 'jersey', 'Chevrons', 200, 3, '{}'::jsonb, '{}'::jsonb, false, 19),
  ('jersey-stars', 'jersey', 'Stars', 220, 5, '{}'::jsonb, '{}'::jsonb, false, 20),
  ('jersey-dots', 'jersey', 'Polka dots', 220, 5, '{}'::jsonb, '{}'::jsonb, false, 21),
  ('jersey-skinsuit', 'jersey', 'Skinsuit', 500, 7, '{}'::jsonb, '{"cda":-0.02}'::jsonb, false, 22),
  ('socks-white', 'socks', 'White socks', 0, 1, '{}'::jsonb, '{}'::jsonb, true, 23),
  ('socks-black', 'socks', 'Black socks', 40, 1, '{}'::jsonb, '{}'::jsonb, false, 24),
  ('socks-red', 'socks', 'Red socks', 50, 1, '{}'::jsonb, '{}'::jsonb, false, 25),
  ('socks-neon', 'socks', 'Neon socks', 90, 2, '{}'::jsonb, '{}'::jsonb, false, 26)
on conflict (id) do update set slot = excluded.slot, name = excluded.name, price = excluded.price, level_req = excluded.level_req,
  unlock = excluded.unlock, effects = excluded.effects, starter = excluded.starter, sort = excluded.sort;

create or replace function public.level_xp(n integer) returns integer
language sql immutable set search_path = '' as $$ select round(100 * power(greatest(n, 1) - 1, 1.6))::integer $$;

create or replace function public.rider_totals(uid text, since timestamptz default null)
returns table (km numeric, climbed_m numeric, rides integer)
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(least(a.distance_m, a.duration_s * 18.0, 400000)), 0) / 1000.0,
         coalesce(sum(least(a.climbed_m, a.duration_s * 0.7, a.distance_m * 0.25, 10000)), 0),
         count(*)::integer
  from public.activities a
  where a.user_id = uid and a.avg_power is not null and a.avg_power <= 1500 and a.duration_s >= 60
    and not coalesce(a.demo, false) and (since is null or a.started_at >= since)
$$;

-- Everything about a rider's progress: level, XP, credits, totals and owned items.
create or replace function public.wallet_of(uid text) returns jsonb
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_km numeric; v_climb numeric; v_rides integer;
  v_claims integer; v_claim_credits integer;
  v_xp integer; v_level integer; v_earned integer; v_spent integer; v_owned jsonb;
begin
  select t.km, t.climbed_m, t.rides into v_km, v_climb, v_rides from public.rider_totals(uid) t;
  insert into public.rider_progress as rp (user_id, km, climbed_m) values (uid, v_km, v_climb)
    on conflict (user_id) do update set km = greatest(rp.km, excluded.km), climbed_m = greatest(rp.climbed_m, excluded.climbed_m), updated_at = now()
    returning rp.km, rp.climbed_m into v_km, v_climb;
  select count(*), coalesce(sum(credits), 0) into v_claims, v_claim_credits from public.challenge_claims where user_id = uid;
  v_earned := floor(v_km + v_climb / 10.0)::integer + v_claim_credits;
  v_xp := floor(v_km * 5 + v_climb * 0.5)::integer + v_claims * 25;
  select max(n) into v_level from generate_series(1, 50) n where public.level_xp(n) <= v_xp;
  select coalesce(sum(price), 0) into v_spent from public.purchases where user_id = uid;
  select coalesce(jsonb_agg(id order by sort), '[]'::jsonb) into v_owned
    from public.store_items where starter or id in (select item_id from public.purchases where user_id = uid);
  return jsonb_build_object(
    'level', v_level, 'xp', v_xp, 'xp_this', public.level_xp(v_level),
    'xp_next', case when v_level >= 50 then null else public.level_xp(v_level + 1) end,
    'credits_earned', v_earned, 'credits_spent', v_spent, 'balance', v_earned - v_spent,
    'km', round(v_km, 1), 'climbed_m', round(v_climb), 'rides', v_rides,
    'challenges_done', v_claims, 'owned', v_owned);
end $$;

create or replace function public.my_wallet() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if auth.user_id() is null then raise exception 'Sign in to use the garage' using errcode = '42501'; end if;
  return public.wallet_of(auth.user_id());
end $$;

-- Buys (or, for a free unlock such as the Tron bike, claims) an item. Checks level, unlock rule and balance.
create or replace function public.buy_item(p_item text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me text := auth.user_id();
  it public.store_items;
  w jsonb;
begin
  if me is null then raise exception 'Sign in to use the garage' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext('wallet:' || me));
  select * into it from public.store_items where id = p_item;
  if not found then raise exception 'There is no such item'; end if;
  if it.starter or exists (select 1 from public.purchases where user_id = me and item_id = it.id) then
    raise exception 'You already own this';
  end if;
  w := public.wallet_of(me);
  if (w ->> 'level')::integer < it.level_req then raise exception 'Reach level % to get this', it.level_req; end if;
  if (it.unlock ->> 'climbed_m') is not null and (w ->> 'climbed_m')::numeric < (it.unlock ->> 'climbed_m')::numeric then
    raise exception 'Climb % m in total to unlock this', (it.unlock ->> 'climbed_m');
  end if;
  if (it.unlock ->> 'km') is not null and (w ->> 'km')::numeric < (it.unlock ->> 'km')::numeric then
    raise exception 'Ride % km in total to unlock this', (it.unlock ->> 'km');
  end if;
  if (w ->> 'balance')::integer < it.price then raise exception 'Not enough credits'; end if;
  insert into public.purchases (user_id, item_id, price) values (me, it.id, it.price);
  return public.wallet_of(me);
end $$;

-- The weekly pool: one challenge from each family is picked per ISO week (by md5 of week + id; the app does the same to preview them).
create or replace function public.challenge_pool()
returns table (id text, family text, title text, metric text, target numeric, reward integer)
language sql immutable set search_path = '' as $$
  values
    ('climb-1000', 'climb', 'Climb 1,000 m', 'climbed_m', 1000::numeric, 80),
    ('climb-2000', 'climb', 'Climb 2,000 m', 'climbed_m', 2000::numeric, 150),
    ('ride-50', 'distance', 'Ride 50 km', 'km', 50::numeric, 80),
    ('ride-100', 'distance', 'Ride 100 km', 'km', 100::numeric, 150),
    ('stages-1', 'stages', 'Finish a stage', 'stages', 1::numeric, 50),
    ('stages-3', 'stages', 'Finish 3 stages', 'stages', 3::numeric, 120),
    ('race-win', 'special', 'Win a race', 'race_wins', 1::numeric, 200),
    ('race-podium', 'special', 'Finish on a race podium', 'race_podiums', 1::numeric, 120),
    ('pro-20', 'special', 'Ride with a pro team for 20 km', 'pro_km', 20::numeric, 120),
    ('days-4', 'special', 'Ride on 4 different days', 'days', 4::numeric, 100)
$$;

create or replace function public.my_challenges() returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
declare
  me text := auth.user_id();
  wk text := to_char(now() at time zone 'utc', 'IYYY-"W"IW');
  start_at timestamptz := date_trunc('week', now() at time zone 'utc') at time zone 'utc';
  res jsonb;
begin
  if me is null then raise exception 'Sign in to see your challenges' using errcode = '42501'; end if;
  with picked as (
    select distinct on (p.family) p.* from public.challenge_pool() p order by p.family, md5(wk || p.id)
  ), prog as (
    select
      coalesce(sum(least(a.climbed_m, a.duration_s * 0.7, a.distance_m * 0.25, 10000)), 0)::numeric as climbed_m,
      (coalesce(sum(least(a.distance_m, a.duration_s * 18.0, 400000)), 0) / 1000.0)::numeric as km,
      (count(*) filter (where a.finished and a.distance_m >= 3000))::numeric as stages,
      (count(*) filter (where a.race_place = 1))::numeric as race_wins,
      (count(*) filter (where a.race_place between 1 and 3))::numeric as race_podiums,
      (coalesce(sum(least(coalesce(a.pro_m, 0), a.distance_m, 400000)), 0) / 1000.0)::numeric as pro_km,
      (count(distinct (a.started_at at time zone 'utc')::date) filter (where a.duration_s >= 600))::numeric as days
    from public.activities a
    where a.user_id = me and a.started_at >= start_at and a.avg_power is not null and a.avg_power <= 1500 and a.duration_s >= 60 and not coalesce(a.demo, false)
  )
  select jsonb_build_object('week', wk, 'starts_at', start_at, 'ends_at', start_at + interval '7 days',
    'challenges', coalesce(jsonb_agg(jsonb_build_object(
      'id', k.id, 'title', k.title, 'metric', k.metric, 'target', k.target, 'reward', k.reward,
      'progress', round(case k.metric when 'climbed_m' then g.climbed_m when 'km' then g.km when 'stages' then g.stages
                         when 'race_wins' then g.race_wins when 'race_podiums' then g.race_podiums when 'pro_km' then g.pro_km else g.days end, 1),
      'claimed', exists (select 1 from public.challenge_claims c where c.user_id = me and c.challenge_id = k.id and c.week = wk)
    ) order by k.family), '[]'::jsonb))
  into res from picked k cross join prog g;
  return res;
end $fn$;

-- Pays out a finished challenge once (the primary key makes a second claim impossible).
create or replace function public.claim_challenge(p_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me text := auth.user_id();
  wk text := to_char(now() at time zone 'utc', 'IYYY-"W"IW');
  ch jsonb;
begin
  if me is null then raise exception 'Sign in to claim rewards' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext('wallet:' || me));
  select c into ch from jsonb_array_elements(public.my_challenges() -> 'challenges') c where c ->> 'id' = p_id;
  if ch is null then raise exception 'That challenge isn''t on this week'; end if;
  if (ch ->> 'claimed')::boolean then raise exception 'You already claimed this one'; end if;
  if (ch ->> 'progress')::numeric < (ch ->> 'target')::numeric then raise exception 'Not finished yet'; end if;
  insert into public.challenge_claims (user_id, challenge_id, week, credits) values (me, p_id, wk, (ch ->> 'reward')::integer);
  return public.wallet_of(me);
end $$;

revoke execute on function public.level_xp(integer), public.rider_totals(text, timestamptz), public.wallet_of(text),
  public.challenge_pool() from public, anonymous, authenticated;
revoke execute on function public.my_wallet(), public.buy_item(text), public.my_challenges(), public.claim_challenge(text) from public, anonymous;
grant execute on function public.my_wallet(), public.buy_item(text), public.my_challenges(), public.claim_challenge(text) to authenticated;

-- ride_presence(): the kit string may now carry the bike and clothes after the three colours,
-- e.g. '#d62839,#14213d,#1f3c88;f=tron;w=deep80' (up to 8 short key=value parts):
--   my_kit text := case when p_kit ~ '^#[0-9a-fA-F]{6},#[0-9a-fA-F]{6},#[0-9a-fA-F]{6}(;[a-z]{1,2}=[a-z0-9]{1,12}){0,8}$' then lower(p_kit) else null end;
-- (applied in the ride_presence() definition above; same signature as before)
notify pgrst, 'reload schema';
