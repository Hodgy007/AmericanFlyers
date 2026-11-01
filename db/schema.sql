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
  my_kit text := case when p_kit ~ '^#[0-9a-fA-F]{6},#[0-9a-fA-F]{6},#[0-9a-fA-F]{6}$' then lower(p_kit) else null end;
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

-- ------------------------------------------- scheduled rides and races ----
-- A daily race (19:30 UTC) and a group ride (12:30 UTC) appear on their own:
-- upcoming_events() lazily creates the schedule, so there is always something
-- on without an admin. Admins can add one-off events. Riders in an event see
-- each other through ride_presence() under the stage key "<stage>#event-<id>".
-- Everyone in an event races the same seeded bots (the seed is on the event).
-- All access goes through the functions below; the tables have no grants.

-- Stages the schedule rotates through (built-in stages with a finish line).
create table if not exists public.event_stage_pool (
  stage_id text primary key,
  name text not null,
  length_m integer not null,
  position integer not null
);
alter table public.event_stage_pool enable row level security;
insert into public.event_stage_pool (stage_id, name, length_m, position) values
  ('hotw-morgul-bismark', 'Morgul-Bismark', 42263, 0),
  ('alpe-dhuez', 'Alpe d''Huez', 14000, 1),
  ('hotw-tour-of-the-moon', 'Tour of the Moon', 37000, 2),
  ('stelvio', 'Stelvio Pass', 24500, 3),
  ('route66', 'Route 66 Flats', 25000, 4),
  ('ventoux', 'Mont Ventoux', 21400, 5),
  ('hell-of-the-west', 'Echo Lake', 20800, 6),
  ('tourmalet', 'Col du Tourmalet', 19000, 7),
  ('zoncolan', 'Monte Zoncolan', 10100, 8)
on conflict (stage_id) do nothing;

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('race', 'group_ride')),
  stage_id text not null check (stage_id ~ '^[a-z0-9-]{1,60}$'),
  starts_at timestamptz not null,
  title text not null check (char_length(title) between 3 and 80),
  created_by text, -- the admin who added it; null = the automatic schedule
  seed integer not null, -- seeds the bots, so everyone sees the same field
  pace_wkg real check (pace_wkg is null or pace_wkg between 1 and 6), -- group rides: the pace group's W/kg
  created_at timestamptz not null default now(),
  unique (kind, stage_id, starts_at)
);
create index if not exists events_starts_idx on public.events (starts_at);
alter table public.events enable row level security;

create table if not exists public.event_results (
  event_id uuid not null references public.events (id) on delete cascade,
  user_id text not null,
  finish_s integer not null check (finish_s > 0),
  avg_power real,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);
alter table public.event_results enable row level security;

-- The server's clock, so clients can line up their start (offset = server - local).
create or replace function public.server_now() returns timestamptz
language sql stable security definer set search_path = '' as $$ select now() $$;

-- Events from 12 hours ago to p_hours ahead, creating the schedule as needed.
create or replace function public.upcoming_events(p_hours integer default 48)
returns table (id uuid, kind text, stage_id text, title text, starts_at timestamptz, seed integer, pace_wkg real,
               duration_min integer, waiting integer, results integer, my_finish_s integer)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  me text := auth.user_id();
  hrs integer := greatest(1, least(coalesce(p_hours, 48), 24 * 14));
  n integer := (select count(*) from public.event_stage_pool);
  day0 timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  d timestamptz;
  idx integer;
  pool record;
begin
  if me is null then raise exception 'Sign in to see events' using errcode = '42501'; end if;
  if n > 0 then
    for i in -1 .. (hrs / 24 + 1) loop
      d := day0 + i * interval '1 day';
      idx := (extract(epoch from d)::bigint / 86400)::integer;
      select p.stage_id, p.name into pool from public.event_stage_pool p where p.position = idx % n;
      -- The evening race.
      if d + interval '19 hours 30 minutes' > now() - interval '3 hours' and d + interval '19 hours 30 minutes' < now() + make_interval(hours => hrs) then
        insert into public.events (kind, stage_id, starts_at, title, seed)
        values ('race', pool.stage_id, d + interval '19 hours 30 minutes', 'Evening race: ' || pool.name,
                ('x' || lpad(substr(md5('race' || d::text), 1, 7), 8, '0'))::bit(32)::integer)
        on conflict (kind, stage_id, starts_at) do nothing;
      end if;
      -- The midday group ride on Heartland Rollers.
      if d + interval '12 hours 30 minutes' > now() - interval '3 hours' and d + interval '12 hours 30 minutes' < now() + make_interval(hours => hrs) then
        insert into public.events (kind, stage_id, starts_at, title, seed, pace_wkg)
        values ('group_ride', 'heartland', d + interval '12 hours 30 minutes', 'Group ride: Heartland Rollers, 2.6 W/kg',
                ('x' || lpad(substr(md5('ride' || d::text), 1, 7), 8, '0'))::bit(32)::integer, 2.6)
        on conflict (kind, stage_id, starts_at) do nothing;
      end if;
    end loop;
  end if;
  return query
    select e.id, e.kind, e.stage_id, e.title, e.starts_at, e.seed, e.pace_wkg,
           case when e.kind = 'race' then 150 else 90 end,
           (select count(*)::integer from public.live_riders l
             where l.stage_id = left(e.stage_id || '#event-' || e.id::text, 80) and l.updated_at > now() - interval '15 seconds'),
           (select count(*)::integer from public.event_results r where r.event_id = e.id),
           (select r.finish_s from public.event_results r where r.event_id = e.id and r.user_id = me)
    from public.events e
    where e.starts_at > now() - interval '12 hours' and e.starts_at < now() + make_interval(hours => hrs)
    order by e.starts_at;
end $$;

-- Admins add one-off events (a race or a group ride on any stage).
create or replace function public.admin_create_event(p_kind text, p_stage text, p_starts_at timestamptz, p_title text, p_pace_wkg real default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare new_id uuid;
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  if p_kind not in ('race', 'group_ride') then raise exception 'Kind must be race or group_ride'; end if;
  if p_stage !~ '^[a-z0-9-]{1,60}$' then raise exception 'Stage id looks wrong'; end if;
  if p_starts_at < now() - interval '1 hour' or p_starts_at > now() + interval '90 days' then raise exception 'Pick a start time within the next 90 days'; end if;
  insert into public.events (kind, stage_id, starts_at, title, created_by, seed, pace_wkg)
  values (p_kind, p_stage, p_starts_at, left(trim(p_title), 80), auth.user_id(), floor(random() * 268435455)::integer,
          case when p_kind = 'group_ride' then coalesce(p_pace_wkg, 2.6) else null end)
  returning events.id into new_id;
  return new_id;
end $$;

-- Admins can take back an event nobody has a result in yet.
create or replace function public.admin_delete_event(p_event uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  if exists (select 1 from public.event_results where event_id = p_event) then raise exception 'That event already has results'; end if;
  delete from public.events where id = p_event;
end $$;

-- One result per rider per event: moving time from the event's start. Checked against the
-- clock (you can't take longer than has passed, or finish before the event) and against
-- sanity limits (the stage length at 80 km/h, public.stage_limits when it exists, power).
create or replace function public.submit_event_result(p_event uuid, p_finish_s integer, p_avg_power real default null)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  me text := auth.user_id();
  ev public.events;
  len integer;
  floor_s integer;
  lim integer;
  n integer;
begin
  if me is null then raise exception 'Sign in to submit a result' using errcode = '42501'; end if;
  if exists (select 1 from neon_auth."user" u where u.id::text = me and coalesce(u.banned, false)) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select * into ev from public.events where id = p_event;
  if not found then raise exception 'No such event'; end if;
  if ev.kind <> 'race' then raise exception 'Only races have results'; end if;
  if now() < ev.starts_at then raise exception 'The event has not started'; end if;
  if now() > ev.starts_at + interval '4 hours' then raise exception 'That event is over'; end if;
  if p_finish_s is null or p_finish_s <= 0 or p_finish_s > extract(epoch from now() - ev.starts_at) + 20 then
    raise exception 'That time does not fit the event';
  end if;
  if p_avg_power is null or p_avg_power <= 0 or p_avg_power > 2000 then raise exception 'That power does not look right'; end if;
  select length_m into len from public.event_stage_pool where stage_id = ev.stage_id;
  floor_s := coalesce(ceil(len / 22.0)::integer, 300);
  if to_regclass('public.stage_limits') is not null then
    begin
      execute 'select min_finish_s from public.stage_limits where stage_id = $1' into lim using ev.stage_id;
      floor_s := greatest(floor_s, coalesce(lim, 0));
    exception when others then null;
    end;
  end if;
  if p_finish_s < floor_s then raise exception 'That time is faster than the stage allows'; end if;
  insert into public.event_results (event_id, user_id, finish_s, avg_power) values (p_event, me, p_finish_s, p_avg_power)
  on conflict (event_id, user_id) do nothing;
  get diagnostics n = row_count;
  return n > 0;
end $$;

-- The real riders' results for an event, fastest first (short names).
create or replace function public.event_results(p_event uuid)
returns table (rank bigint, name text, finish_s integer, avg_power real, is_me boolean)
language sql stable security definer set search_path = '' as $$
  select rank() over (order by r.finish_s, r.created_at), public.short_name(u.name), r.finish_s, r.avg_power, r.user_id = auth.user_id()
  from public.event_results r
  join neon_auth."user" u on u.id::text = r.user_id and not coalesce(u.banned, false)
  where r.event_id = p_event and auth.user_id() is not null
  order by r.finish_s, r.created_at
  limit 100
$$;

revoke all on public.events, public.event_results, public.event_stage_pool from public, anonymous, authenticated;
revoke execute on function public.server_now(), public.upcoming_events(integer), public.admin_create_event(text, text, timestamptz, text, real),
  public.admin_delete_event(uuid), public.submit_event_result(uuid, integer, real), public.event_results(uuid) from public, anonymous;
grant execute on function public.server_now(), public.upcoming_events(integer), public.admin_create_event(text, text, timestamptz, text, real),
  public.admin_delete_event(uuid), public.submit_event_result(uuid, integer, real), public.event_results(uuid) to authenticated;
notify pgrst, 'reload schema';
