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
