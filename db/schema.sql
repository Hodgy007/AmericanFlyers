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

-- ================================================== trust and safety (round 3) ====
-- Stream D. Leaderboard sanity, "delete my account" and "download my data".

-- ------------------------------------------------------ leaderboard sanity ----
-- stage_limits holds, for every built-in stage with a finish line, the length
-- of the finish and the fastest believable ride. min_finish_s is 80% of the
-- time a 60 kg rider (+8 kg bike, CdA 0.25) takes at a sustained 6.5 W/kg
-- through the app's own physics, so drafting and tucking are allowed for;
-- max_avg_kmh is the same limit as a speed. Rides outside them, rides with an
-- average power above 2000 W, rides recorded with the demo slider or a sped-up
-- clock (activities.demo), and rides with no power that are also suspiciously
-- fast (under 1.5x the floor) are ignored by stage_leaderboard() and stage_ghost().
-- Stages that aren't listed (uploaded GPX routes) get only the power check.

create table if not exists public.stage_limits (
  stage_id text primary key,
  distance_m integer not null,
  min_finish_s integer not null check (min_finish_s > 0),
  max_avg_kmh real not null check (max_avg_kmh > 0)
);
alter table public.stage_limits enable row level security; -- no grants: only the functions below read it
revoke all on public.stage_limits from public, anonymous, authenticated;

insert into public.stage_limits (stage_id, distance_m, min_finish_s, max_avg_kmh) values
  ('route66', 25000, 1524, 60),
  ('hotw-morgul-bismark', 42263, 2675, 57),
  ('hotw-tour-of-the-moon', 37000, 2496, 54),
  ('hell-of-the-west', 20800, 1948, 39),
  ('alpe-dhuez', 14000, 1826, 28),
  ('stelvio', 24500, 3042, 30),
  ('ventoux', 21400, 2672, 29),
  ('tourmalet', 19000, 2328, 30),
  ('zoncolan', 10100, 1813, 21)
on conflict (stage_id) do update set distance_m = excluded.distance_m, min_finish_s = excluded.min_finish_s, max_avg_kmh = excluded.max_avg_kmh;

-- Set by the app when a ride used the demo slider or ?timescale: such rides never count for times.
alter table public.activities add column if not exists demo boolean default false;

create or replace function public.ride_is_plausible(p_stage text, p_finish_s integer, p_avg_power real, p_demo boolean)
returns boolean
language sql stable security definer set search_path = '' as $$
  select p_finish_s is not null and p_finish_s > 0
    and not coalesce(p_demo, false)
    and coalesce(p_avg_power, 0) <= 2000
    and not exists (
      select 1 from public.stage_limits l
      where l.stage_id = p_stage
        and (p_finish_s < l.min_finish_s
          or l.distance_m / p_finish_s::float * 3.6 > l.max_avg_kmh
          or (p_avg_power is null and p_finish_s < l.min_finish_s * 1.5)))
$$;
revoke execute on function public.ride_is_plausible(text, integer, real, boolean) from public, anonymous, authenticated;

-- Same signature and columns as before.
create or replace function public.stage_leaderboard(p_stage text, p_since timestamptz default null)
returns table (rank bigint, activity_id uuid, name text, finish_s integer, avg_power real, ridden_at timestamptz, is_me boolean)
language sql stable security definer set search_path = '' as $$
  with best as (
    select distinct on (a.user_id) a.user_id, a.id, a.finish_s, a.avg_power, a.started_at
    from public.activities a
    join neon_auth."user" u on u.id::text = a.user_id and not coalesce(u.banned, false)
    where a.stage_id = p_stage and a.finish_s is not null and (p_since is null or a.started_at >= p_since)
      and public.ride_is_plausible(a.stage_id, a.finish_s, a.avg_power, a.demo)
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
    and public.ride_is_plausible(a.stage_id, a.finish_s, a.avg_power, a.demo)
$$;

revoke execute on function public.stage_leaderboard(text, timestamptz), public.stage_ghost(uuid) from public, anonymous;
grant execute on function public.stage_leaderboard(text, timestamptz), public.stage_ghost(uuid) to authenticated;

-- ------------------------------------------- delete my account / my data ----
-- delete_my_account(): deletes everything the caller owns, then their Neon
-- Auth user (sessions, linked Google accounts and organisation memberships
-- go with it through foreign-key cascades; pending verification codes are
-- removed here). It only ever touches the caller's own rows. Admins (anyone
-- whose email is in public.admins) are refused: remove them from that table first.
-- It also clears every other public table that has a text user_id column, so
-- tables added later (purchases, event results, challenge claims...) are covered
-- without editing this function.
-- my_data_extras(): the parts of "Download my data" that the app can't read
-- through its own table access: the account itself, ride-ons (counts and
-- emoji only, no names) and any other table with a text user_id column.

create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
declare
  me text := auth.user_id();
  my_email text;
  t record;
begin
  if me is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select u.email into my_email from neon_auth."user" u where u.id::text = me;
  if my_email is null then raise exception 'No such account' using errcode = '42501'; end if;
  if exists (select 1 from public.admins a where lower(a.email) = lower(my_email)) then
    raise exception 'Admin accounts can''t be deleted here. Ask another admin to remove you from the admin list first.' using errcode = '42501';
  end if;

  delete from public.live_riders where user_id = me;
  delete from public.ride_ons where from_user = me or to_user = me;
  delete from public.feedback where user_id = me;
  delete from public.ftp_history where user_id = me;
  delete from public.activities where user_id = me;
  delete from public.routes where user_id = me;
  delete from public.workouts where user_id = me;
  delete from public.profiles where user_id = me;

  -- Any other table that keeps a rider's rows under a text user_id column.
  for t in
    select c.table_name from information_schema.columns c
    join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.column_name = 'user_id' and c.data_type = 'text'
      and c.table_name not in ('live_riders', 'feedback', 'ftp_history', 'activities', 'routes', 'workouts', 'profiles')
  loop
    execute format('delete from public.%I where user_id = $1', t.table_name) using me;
  end loop;

  -- Pending one-time codes for this email address (exact identifiers only, never someone else's).
  delete from neon_auth.verification where lower(identifier) in (
    lower(my_email), 'email-verification-otp-' || lower(my_email), 'sign-in-otp-' || lower(my_email),
    'forget-password-otp-' || lower(my_email), 'change-email-otp-' || lower(my_email));
  delete from neon_auth."user" where id::text = me; -- cascades to session, account, member, invitation
end $$;

create or replace function public.my_data_extras() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  me text := auth.user_id();
  r jsonb;
  extras jsonb := '{}'::jsonb;
  t record;
  rows_json jsonb;
begin
  if me is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select jsonb_build_object('id', u.id, 'name', u.name, 'email', u.email, 'email_verified', u."emailVerified", 'created_at', u."createdAt")
    into r from neon_auth."user" u where u.id::text = me;
  for t in
    select c.table_name from information_schema.columns c
    join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.column_name = 'user_id' and c.data_type = 'text'
      and c.table_name not in ('live_riders', 'feedback', 'ftp_history', 'activities', 'routes', 'workouts', 'profiles')
  loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from public.%I x where x.user_id = $1', t.table_name) into rows_json using me;
    extras := extras || jsonb_build_object(t.table_name, rows_json);
  end loop;
  return jsonb_build_object(
    'account', r,
    'live_position', (select to_jsonb(l) - 'user_id' from public.live_riders l where l.user_id = me),
    'ride_ons_sent', (select coalesce(jsonb_agg(jsonb_build_object('emote', emote, 'at', created_at) order by created_at), '[]'::jsonb) from public.ride_ons where from_user = me),
    'ride_ons_received', (select coalesce(jsonb_agg(jsonb_build_object('emote', emote, 'at', created_at) order by created_at), '[]'::jsonb) from public.ride_ons where to_user = me),
    'other_tables', extras);
end $$;

revoke execute on function public.delete_my_account(), public.my_data_extras() from public, anonymous;
grant execute on function public.delete_my_account(), public.my_data_extras() to authenticated;
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

-- ------------------------------------------------ AI coach and rivals ----
-- Riders opt in (ai_consent). The Vercel function api/ai.ts calls ai_claim()
-- with the rider's own token: it checks consent, ban and the daily quota,
-- records the use, and returns what the prompt needs (first name, FTP, weight,
-- last four weeks, and for rivals the rival's memory). Every table has row-level
-- security and no grants; the functions run as their owner. Each public function
-- is a one-line wrapper over an internal "_for(me, ...)" version so the logic can
-- be tested with a made-up rider (the _for functions are granted to nobody).

create table if not exists public.ai_consent (
  user_id text primary key default auth.user_id(),
  coach boolean not null default false,
  rivals boolean not null default false,
  updated_at timestamptz not null default now()
);
create table if not exists public.ai_usage (
  user_id text not null default auth.user_id(),
  day date not null,
  kind text not null check (kind in ('coach_debrief', 'coach_plan', 'coach_tip', 'rival_pre', 'rival_post')),
  count integer not null default 0,
  primary key (user_id, day, kind)
);
create table if not exists public.rival_memory (
  user_id text not null default auth.user_id(),
  rival_id text not null check (rival_id ~ '^[a-z0-9_-]{1,24}$'),
  wins integer not null default 0,
  losses integer not null default 0,
  rides integer not null default 0,
  last_ride timestamptz,
  notes jsonb not null default '[]'::jsonb, -- up to 8 short facts the rival remembers
  primary key (user_id, rival_id)
);
create table if not exists public.coach_notes (
  user_id text not null default auth.user_id(),
  activity_id uuid not null references public.activities (id) on delete cascade,
  created_at timestamptz not null default now(),
  debrief jsonb not null,
  primary key (user_id, activity_id)
);
alter table public.ai_consent enable row level security;
alter table public.ai_usage enable row level security;
alter table public.rival_memory enable row level security;
alter table public.coach_notes enable row level security;
-- (no policies and no grants: only the functions below touch them)
revoke all on public.ai_consent, public.ai_usage, public.rival_memory, public.coach_notes from public, anonymous, authenticated;

-- Consent -------------------------------------------------------------------
create or replace function public.my_ai_consent_for(me text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c record;
begin
  if me is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select a.coach, a.rivals into c from public.ai_consent a where a.user_id = me;
  return jsonb_build_object('coach', coalesce(c.coach, false), 'rivals', coalesce(c.rivals, false));
end $$;

create or replace function public.set_ai_consent_for(me text, p_coach boolean, p_rivals boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if me is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  insert into public.ai_consent as a (user_id, coach, rivals, updated_at)
  values (me, coalesce(p_coach, false), coalesce(p_rivals, false), now())
  on conflict (user_id) do update set coach = excluded.coach, rivals = excluded.rivals, updated_at = excluded.updated_at;
  return public.my_ai_consent_for(me);
end $$;

-- The gate the Vercel function calls with the rider's token ---------------------
-- Returns {ok:false, reason:'no_consent'|'banned'|'quota'} for the three ways to be turned away,
-- else {ok:true, name, ftp, weight_kg, last4w, rivals, used, limit}. Not signed in raises 42501.
create or replace function public.ai_claim_for(me text, p_kind text, p_rival text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  usr record;
  con record;
  lim integer;
  used integer := null;
  today date := (now() at time zone 'utc')::date;
  prof jsonb;
  ftp numeric;
  kg numeric;
  fname text;
  wk jsonb;
  mem jsonb := '[]'::jsonb;
  is_adm boolean;
begin
  if me is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_kind is null or p_kind not in ('coach_debrief', 'coach_plan', 'coach_tip', 'rival_pre', 'rival_post') then
    raise exception 'Unknown AI request' using errcode = '22023';
  end if;
  select u.name as name, coalesce(u.banned, false) as banned into usr from neon_auth."user" u where u.id::text = me;
  if not found then raise exception 'No such account' using errcode = '42501'; end if;
  if usr.banned then return jsonb_build_object('ok', false, 'reason', 'banned'); end if;

  select a.coach, a.rivals into con from public.ai_consent a where a.user_id = me;
  if not coalesce(case when left(p_kind, 5) = 'coach' then con.coach else con.rivals end, false) then
    return jsonb_build_object('ok', false, 'reason', 'no_consent');
  end if;

  -- Today's quota (UTC day). Admins are unlimited. One atomic upsert: the WHERE stops the count at the limit.
  is_adm := exists (
    select 1 from neon_auth."user" u join public.admins ad on lower(ad.email) = lower(u.email)
    where u.id::text = me and u."emailVerified");
  lim := case when is_adm then 100000 else case p_kind when 'coach_debrief' then 10 when 'coach_plan' then 6 when 'coach_tip' then 30 else 10 end end;
  insert into public.ai_usage as a (user_id, day, kind, count) values (me, today, p_kind, 1)
  on conflict (user_id, day, kind) do update set count = a.count + 1 where a.count < lim
  returning a.count into used;
  if used is null then return jsonb_build_object('ok', false, 'reason', 'quota', 'limit', lim); end if;

  -- What the prompt may say about the rider: a first name made only of letters (never an email address).
  fname := case when position('@' in coalesce(usr.name, '')) > 0 then null
    else nullif(left(regexp_replace(split_part(trim(coalesce(usr.name, '')), ' ', 1), '[^[:alpha:]''-]', '', 'g'), 20), '') end;
  select p.settings into prof from public.profiles p where p.user_id = me;
  ftp := case when jsonb_typeof(prof -> 'ftp') = 'number' then (prof ->> 'ftp')::numeric end;
  kg := case when jsonb_typeof(prof -> 'riderKg') = 'number' then (prof ->> 'riderKg')::numeric end;
  select jsonb_build_object(
    'rides', count(*),
    'hours', round((coalesce(sum(a.duration_s), 0) / 3600.0)::numeric, 1),
    'km', round((coalesce(sum(a.distance_m), 0) / 1000.0)::numeric, 0),
    'climbed_m', round(coalesce(sum(a.climbed_m), 0)::numeric, 0),
    'tss', round(coalesce(sum(a.tss), 0)::numeric, 0))
    into wk from public.activities a where a.user_id = me and a.started_at > now() - interval '28 days';
  if left(p_kind, 5) = 'rival' then
    select coalesce(jsonb_agg(jsonb_build_object('rival', m.rival_id, 'wins', m.wins, 'losses', m.losses, 'rides', m.rides, 'last_ride', m.last_ride, 'notes', m.notes)), '[]'::jsonb)
      into mem from public.rival_memory m where m.user_id = me and (p_rival is null or m.rival_id = p_rival);
  end if;
  return jsonb_build_object(
    'ok', true,
    'name', coalesce(fname, 'Rider'),
    'ftp', case when ftp between 30 and 800 then round(ftp) end,
    'weight_kg', case when kg between 30 and 200 then round(kg, 1) end,
    'last4w', wk, 'rivals', mem, 'used', used, 'limit', lim);
end $$;

-- Rival memory --------------------------------------------------------------
create or replace function public.rival_record_for(me text, p_rival text, p_won boolean, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  cur jsonb;
  note text := left(trim(regexp_replace(coalesce(p_note, ''), '[[:cntrl:]]+', ' ', 'g')), 140);
  merged jsonb;
  kept jsonb;
begin
  if me is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_rival is null or p_rival !~ '^[a-z0-9_-]{1,24}$' then raise exception 'Unknown rival' using errcode = '22023'; end if;
  if not coalesce((select a.rivals from public.ai_consent a where a.user_id = me), false) then
    raise exception 'Turn on AI rivals first' using errcode = '42501';
  end if;
  select m.notes into cur from public.rival_memory m where m.user_id = me and m.rival_id = p_rival;
  if cur is null and (select count(*) from public.rival_memory m where m.user_id = me) >= 12 then
    raise exception 'Too many rivals' using errcode = '22023';
  end if;
  merged := coalesce(cur, '[]'::jsonb) || case when note <> '' then jsonb_build_array(note) else '[]'::jsonb end;
  select coalesce(jsonb_agg(t.x order by t.ord), '[]'::jsonb) into kept
    from (select e.x, e.ord from jsonb_array_elements(merged) with ordinality as e(x, ord) order by e.ord desc limit 8) t;
  insert into public.rival_memory as m (user_id, rival_id, wins, losses, rides, last_ride, notes)
  values (me, p_rival, case when p_won then 1 else 0 end, case when p_won then 0 else 1 end, 1, now(), kept)
  on conflict (user_id, rival_id) do update set
    wins = m.wins + excluded.wins, losses = m.losses + excluded.losses, rides = m.rides + 1,
    last_ride = now(), notes = excluded.notes;
end $$;

create or replace function public.my_rivals_for(me text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if me is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('rival', m.rival_id, 'wins', m.wins, 'losses', m.losses, 'rides', m.rides, 'last_ride', m.last_ride, 'notes', m.notes) order by m.rival_id), '[]'::jsonb)
    from public.rival_memory m where m.user_id = me);
end $$;

-- Forgets one rival's memory, or all of them when p_rival is null.
create or replace function public.forget_rival_for(me text, p_rival text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if me is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  delete from public.rival_memory m where m.user_id = me and (p_rival is null or m.rival_id = p_rival);
end $$;

-- Coach debriefs kept with the ride -----------------------------------------
create or replace function public.save_coach_debrief_for(me text, p_activity uuid, p_debrief jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if me is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_debrief is null or jsonb_typeof(p_debrief) <> 'object' or octet_length(p_debrief::text) > 6000 then
    raise exception 'That debrief is too big' using errcode = '22023';
  end if;
  if not exists (select 1 from public.activities a where a.id = p_activity and a.user_id = me) then
    raise exception 'Save the ride first' using errcode = '22023';
  end if;
  insert into public.coach_notes as n (user_id, activity_id, debrief) values (me, p_activity, p_debrief)
  on conflict (user_id, activity_id) do update set debrief = excluded.debrief, created_at = now();
end $$;

create or replace function public.my_coach_debrief_for(me text, p_activity uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if me is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  return (select n.debrief from public.coach_notes n where n.user_id = me and n.activity_id = p_activity);
end $$;

-- The public functions the browser and api/ai.ts call (rider's own token) ----------
create or replace function public.my_ai_consent() returns jsonb language sql stable security definer set search_path = '' as $$ select public.my_ai_consent_for(auth.user_id()) $$;
create or replace function public.set_ai_consent(p_coach boolean, p_rivals boolean) returns jsonb language sql security definer set search_path = '' as $$ select public.set_ai_consent_for(auth.user_id(), p_coach, p_rivals) $$;
create or replace function public.ai_claim(p_kind text, p_rival text default null) returns jsonb language sql security definer set search_path = '' as $$ select public.ai_claim_for(auth.user_id(), p_kind, p_rival) $$;
create or replace function public.rival_record(p_rival text, p_won boolean, p_note text default null) returns void language sql security definer set search_path = '' as $$ select public.rival_record_for(auth.user_id(), p_rival, p_won, p_note) $$;
create or replace function public.my_rivals() returns jsonb language sql stable security definer set search_path = '' as $$ select public.my_rivals_for(auth.user_id()) $$;
create or replace function public.forget_rival(p_rival text default null) returns void language sql security definer set search_path = '' as $$ select public.forget_rival_for(auth.user_id(), p_rival) $$;
create or replace function public.save_coach_debrief(p_activity uuid, p_debrief jsonb) returns void language sql security definer set search_path = '' as $$ select public.save_coach_debrief_for(auth.user_id(), p_activity, p_debrief) $$;
create or replace function public.my_coach_debrief(p_activity uuid) returns jsonb language sql stable security definer set search_path = '' as $$ select public.my_coach_debrief_for(auth.user_id(), p_activity) $$;

revoke execute on function
  public.my_ai_consent_for(text), public.set_ai_consent_for(text, boolean, boolean), public.ai_claim_for(text, text, text),
  public.rival_record_for(text, text, boolean, text), public.my_rivals_for(text), public.forget_rival_for(text, text),
  public.save_coach_debrief_for(text, uuid, jsonb), public.my_coach_debrief_for(text, uuid)
  from public, anonymous, authenticated;
revoke execute on function
  public.my_ai_consent(), public.set_ai_consent(boolean, boolean), public.ai_claim(text, text), public.rival_record(text, boolean, text),
  public.my_rivals(), public.forget_rival(text), public.save_coach_debrief(uuid, jsonb), public.my_coach_debrief(uuid)
  from public, anonymous;
grant execute on function
  public.my_ai_consent(), public.set_ai_consent(boolean, boolean), public.ai_claim(text, text), public.rival_record(text, boolean, text),
  public.my_rivals(), public.forget_rival(text), public.save_coach_debrief(uuid, jsonb), public.my_coach_debrief(uuid)
  to authenticated;
notify pgrst, 'reload schema';
