// Account UI: the sign-in dialog (Google or Apple), the rider's profile
// (stats, achievements, activities), feedback, and the admin dashboard.

import type { Settings } from '../settings';
import { BEST_WINDOWS } from '../stats';
import { HR_ZONES, POWER_ZONES, addZones, zoneBars } from '../zones';
import { account, onAccountChange, rename, signInWith, signOut } from './account';
import { achievements, weekIndex } from './achievements';
import { barChart, lineChart, statTiles } from './charts';
import { toTcx } from './recorder';
import {
  activitySamples, adminDeleteFeedback, adminFeedback, adminOverview, adminSetBan, adminUpdateFeedback, adminUsers,
  deleteActivity, ftpHistory, isAdmin, listActivities, myFeedback, submitFeedback,
  type Activity, type Feedback, type FeedbackCategory, type FeedbackStatus,
} from './sync';

interface Deps {
  settings: () => Settings;
  toast: (msg: string, ms?: number) => void;
  /** Extra context sent with feedback (stage, browser, trainer…). */
  context: () => Record<string, unknown>;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: { class?: string; text?: string; title?: string } = {}, ...kids: (Node | string | null | false)[]) {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.text !== undefined) el.textContent = props.text;
  if (props.title) el.title = props.title;
  for (const k of kids) if (k) el.append(k);
  return el;
}

function button(label: string, onClick: () => void, cls = '') {
  const b = h('button', { class: cls, text: label });
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

export function fmtDuration(s: number) {
  s = Math.round(s);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  return hh ? `${hh}h ${String(mm).padStart(2, '0')}m` : `${mm}m ${String(s % 60).padStart(2, '0')}s`;
}

const KM_PER_MI = 1.609344;
const units = (s: Settings) => {
  const imp = s.units === 'imperial';
  return {
    dist: (m: number, dp = 1) => imp ? `${(m / 1000 / KM_PER_MI).toFixed(dp)} mi` : `${(m / 1000).toFixed(dp)} km`,
    distN: (m: number) => imp ? m / 1000 / KM_PER_MI : m / 1000,
    distUnit: imp ? 'mi' : 'km',
    climb: (m: number) => imp ? `${Math.round(m * 3.28084).toLocaleString()} ft` : `${Math.round(m).toLocaleString()} m`,
  };
};

const shortDate = (d: string | number | Date) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const longDate = (d: string | number | Date) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const errMsg = (e: unknown) => (e as Error)?.message ?? String(e);

const BEST_LABELS: Record<number, string> = { 5: '5 s', 60: '1 min', 300: '5 min', 1200: '20 min' };

export function initAccountUi(deps: Deps) {
  const accountBtn = $<HTMLButtonElement>('btn-account');
  const adminBtn = $<HTMLButtonElement>('btn-admin');
  const signinDialog = $<HTMLDialogElement>('signin');
  const profileDialog = $<HTMLDialogElement>('profile-dialog');
  const feedbackDialog = $<HTMLDialogElement>('feedback-dialog');
  let admin = false;
  let pendingAfterSignIn: (() => void) | null = null;

  // ----------------------------------------------------------- sign-in ----

  function openSignIn(reason?: string, then?: () => void) {
    $('signin-reason').textContent = reason ?? 'Sign in to save your rides, settings, workouts and routes, track your FTP and earn achievements.';
    $('signin-error').textContent = '';
    pendingAfterSignIn = then ?? null;
    signinDialog.showModal();
  }

  for (const provider of ['google', 'apple'] as const) {
    $(`signin-${provider}`).addEventListener('click', async () => {
      $('signin-error').textContent = '';
      try {
        await signInWith(provider); // leaves the page for Google / Apple
      } catch (e) {
        $('signin-error').textContent = provider === 'apple' && /provider|not.*(found|enabled|configured)/i.test(errMsg(e))
          ? 'Sign in with Apple isn’t switched on yet. Please use Google for now.'
          : errMsg(e);
      }
    });
  }

  // On returning from Google / Apple with an error, the URL carries it.
  const params = new URLSearchParams(location.search);
  if (params.has('error')) {
    deps.toast(`Sign-in didn’t finish: ${params.get('error_description') ?? params.get('error')}`, 7000);
    const url = new URL(location.href);
    url.searchParams.delete('error');
    url.searchParams.delete('error_description');
    history.replaceState(null, '', url);
  }

  async function refreshAccountButton() {
    const a = account();
    accountBtn.textContent = a ? `👤 ${a.name.split(' ')[0]}` : '👤 Sign in';
    accountBtn.title = a ? `${a.name} (${a.email}): profile & stats` : 'Sign in with Google or Apple';
    admin = a ? await isAdmin() : false;
    adminBtn.hidden = !admin;
  }

  onAccountChange(() => {
    refreshAccountButton();
    if (account()) {
      if (signinDialog.open) signinDialog.close();
      const then = pendingAfterSignIn;
      pendingAfterSignIn = null;
      then?.();
    } else if (profileDialog.open) profileDialog.close();
  });
  refreshAccountButton();

  accountBtn.addEventListener('click', () => (account() ? openProfile('stats') : openSignIn()));
  adminBtn.addEventListener('click', () => openProfile('admin'));
  $('btn-feedback').addEventListener('click', () => openFeedback());

  // ----------------------------------------------------------- profile ----

  type Tab = 'stats' | 'achievements' | 'activities' | 'admin';
  let activities: Activity[] | null = null;

  /** Forget cached activities so the next look reloads them (after a save). */
  function invalidate() {
    activities = null;
  }

  async function loadActivities() {
    activities ??= await listActivities();
    return activities;
  }

  function openProfile(tab: Tab) {
    const a = account();
    if (!a) return openSignIn();
    $('profile-name').textContent = a.name;
    $('profile-email').textContent = a.email;
    const tabs = $('profile-tabs');
    tabs.querySelector<HTMLElement>('[data-tab=admin]')!.hidden = !admin;
    if (!profileDialog.open) profileDialog.showModal();
    showTab(admin || tab !== 'admin' ? tab : 'stats');
  }

  // Enter in a search box mustn't submit (and so close) the profile.
  profileDialog.querySelector('form')!.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.target as HTMLElement).matches('input')) e.preventDefault();
  });

  $('profile-tabs').addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]');
    if (t) showTab(t.dataset.tab as Tab);
  });

  let tabToken = 0;
  async function showTab(tab: Tab) {
    for (const b of $('profile-tabs').querySelectorAll<HTMLElement>('[data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    const body = $('profile-body');
    const token = ++tabToken;
    body.replaceChildren(h('p', { class: 'muted', text: 'Loading…' }));
    try {
      const content = tab === 'stats' ? await statsTab()
        : tab === 'achievements' ? await achievementsTab()
        : tab === 'activities' ? await activitiesTab()
        : await adminTab();
      if (token === tabToken) body.replaceChildren(content);
    } catch (e) {
      if (token === tabToken) body.replaceChildren(h('p', { class: 'error', text: `Couldn’t load this: ${errMsg(e)}` }));
    }
  }

  $('profile-rename').addEventListener('click', async () => {
    const a = account();
    const name = a && prompt('Your name, as shown in American Flyers:', a.name)?.trim();
    if (!name || name === a?.name) return;
    try {
      await rename(name.slice(0, 60));
      $('profile-name').textContent = name;
    } catch (e) {
      deps.toast(`Couldn’t rename: ${errMsg(e)}`);
    }
  });
  $('profile-signout').addEventListener('click', async () => {
    profileDialog.close();
    await signOut();
    deps.toast('Signed out. Your rides are safe in your account.');
  });

  // Stats --------------------------------------------------------------

  async function statsTab() {
    const s = deps.settings();
    const u = units(s);
    const [acts, ftp] = await Promise.all([loadActivities(), ftpHistory()]);
    const root = h('div', { class: 'tab-stats' });
    const sum = (f: (a: Activity) => number | null) => acts.reduce((t, a) => t + (f(a) ?? 0), 0);

    root.append(statTiles([
      ['Rides', acts.length.toLocaleString()],
      ['Time', fmtDuration(sum((a) => a.duration_s))],
      ['Distance', u.dist(sum((a) => a.distance_m), 0)],
      ['Climbed', u.climb(sum((a) => a.climbed_m))],
      ['Energy', `${Math.round(sum((a) => a.kj)).toLocaleString()} kJ`],
      ['FTP', `${s.ftp} W`, `${(s.ftp / s.riderKg).toFixed(2)} W/kg`],
    ]));

    // Personal bests
    root.append(h('h3', { text: 'Personal bests' }));
    root.append(statTiles(BEST_WINDOWS.map((w): [string, string, string?] => {
      let best = 0;
      let when: Activity | null = null;
      for (const a of acts) {
        const v = a.best_power?.[String(w)] ?? 0;
        if (v > best) { best = v; when = a; }
      }
      return [`Best ${BEST_LABELS[w]}`, best ? `${Math.round(best)} W` : '--', when ? `${(best / s.riderKg).toFixed(1)} W/kg · ${shortDate(when.started_at)}` : 'No rides yet'];
    })));

    // Distance per week, last 12 weeks
    const thisWeek = weekIndex(new Date());
    const weeks = Array.from({ length: 12 }, (_, i) => thisWeek - 11 + i);
    const perWeek = new Map<number, number>();
    for (const a of acts) {
      const w = weekIndex(new Date(a.started_at));
      perWeek.set(w, (perWeek.get(w) ?? 0) + a.distance_m);
    }
    const weekStart = (w: number) => new Date((w * 7 - 3) * 86400000);
    root.append(barChart(`Distance per week (${u.distUnit})`, weeks.map((w) => ({
      label: shortDate(weekStart(w)),
      value: u.distN(perWeek.get(w) ?? 0),
      tip: `Week of ${shortDate(weekStart(w))}`,
    })), { format: (v) => v.toFixed(v < 10 && v > 0 ? 1 : 0), axisEvery: 2 }));

    // FTP progress
    const ftpPoints = ftp.map((f) => ({
      x: new Date(f.recorded_at).getTime(),
      y: f.ftp,
      tip: `${longDate(f.recorded_at)} · ${f.source === 'ramp_test' ? 'ramp test' : f.source === 'signup' ? 'starting FTP' : 'set by hand'}`,
    }));
    const ftpMin = Math.min(...ftp.map((f) => f.ftp));
    const ftpChart = lineChart('FTP progress (W)', ftpPoints, { step: true, dots: true, unit: 'W', xLabel: shortDate, extendTo: Date.now(), yMin: Math.max(0, Math.floor((ftpMin - 30) / 50) * 50) });
    if (ftp.length) {
      const change = ftp[ftp.length - 1].ftp - ftp[0].ftp;
      ftpChart.append(h('p', { class: 'muted small', text: `${ftp[0].ftp} W on ${longDate(ftp[0].recorded_at)} → ${ftp[ftp.length - 1].ftp} W now (${change >= 0 ? '+' : ''}${change} W). Change it in Settings or with a ramp test.` }));
    }
    root.append(ftpChart);

    // Zones across all rides
    const hrTotal = acts.reduce((t, a) => addZones(t, a.hr_zones, HR_ZONES.length), HR_ZONES.map(() => 0));
    const pTotal = acts.reduce((t, a) => addZones(t, a.power_zones, POWER_ZONES.length), POWER_ZONES.map(() => 0));
    root.append(h('div', { class: 'zones-pair' },
      zoneBars('Heart-rate zones, all rides', HR_ZONES, hrTotal, { ref: s.maxHr, unit: 'bpm' }),
      zoneBars('Power zones, all rides', POWER_ZONES, pTotal, { ref: s.ftp, unit: 'W' }),
    ));
    root.append(h('p', { class: 'muted small', text: `Heart-rate zones use your max HR (${s.maxHr} bpm) and power zones your FTP (${s.ftp} W), as they were on each ride. Change them in Settings.` }));
    return root;
  }

  // Achievements -------------------------------------------------------

  async function achievementsTab() {
    const [acts, ftp] = await Promise.all([loadActivities(), ftpHistory()]);
    const list = achievements(acts, ftp, deps.settings().riderKg);
    const done = list.filter((a) => a.done).length;
    const root = h('div');
    root.append(h('p', { class: 'muted', text: `${done} of ${list.length} earned.` }));
    const grid = h('div', { class: 'badges' });
    for (const a of list) {
      const bar = h('span', { class: 'badge-progress' }, h('span'));
      (bar.firstChild as HTMLElement).style.width = `${Math.round(a.progress * 100)}%`;
      grid.append(h('div', { class: `badge-card${a.done ? ' done' : ''}` },
        h('span', { class: 'badge-icon', text: a.icon }),
        h('strong', { text: a.name }),
        h('span', { class: 'muted small', text: a.description }),
        bar,
        h('span', { class: 'small', text: a.done ? `✓ ${a.detail}` : a.detail }),
      ));
    }
    root.append(grid);
    return root;
  }

  // Activities ---------------------------------------------------------

  async function activitiesTab() {
    const s = deps.settings();
    const u = units(s);
    const acts = await loadActivities();
    const root = h('div', { class: 'activity-list' });
    if (!acts.length) {
      root.append(h('p', { class: 'muted', text: 'No rides saved yet. Rides save automatically when you finish a stage or workout, or press Reset after riding for a minute or more.' }));
      return root;
    }
    for (const a of acts) {
      const row = h('details', { class: 'activity' });
      const summary = h('summary', {},
        h('span', { class: 'act-date', text: new Date(a.started_at).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) }),
        h('strong', { text: a.title }),
        h('span', { class: 'act-meta', text: [fmtDuration(a.duration_s), u.dist(a.distance_m), a.avg_power ? `${a.avg_power} W` : '', a.finished ? '🏁' : ''].filter(Boolean).join(' · ') }),
      );
      row.append(summary);
      row.addEventListener('toggle', () => {
        if (row.open && row.childElementCount === 1) row.append(activityDetail(a, row));
      }, { once: false });
      root.append(row);
    }
    return root;
  }

  function activityDetail(a: Activity, row: HTMLElement) {
    const s = deps.settings();
    const u = units(s);
    const el = h('div', { class: 'act-detail' });
    const w = (v: number | null) => (v ? `${Math.round(v)} W` : '--');
    el.append(statTiles([
      ['Time', fmtDuration(a.duration_s)],
      ['Distance', u.dist(a.distance_m, 2)],
      ['Climbed', u.climb(a.climbed_m)],
      ['Avg power', w(a.avg_power)],
      ['Norm. power', w(a.np)],
      ['Max power', w(a.max_power)],
      ['Avg HR', a.avg_hr ? `${a.avg_hr} bpm` : '--'],
      ['Max HR', a.max_hr ? `${a.max_hr} bpm` : '--'],
      ['Cadence', a.avg_cadence ? `${a.avg_cadence} rpm` : '--'],
      ['Energy', a.kj ? `${a.kj} kJ` : '--'],
      ['TSS', a.tss !== null ? String(Math.round(a.tss)) : '--', a.ftp ? `FTP ${a.ftp} W` : undefined],
      ...BEST_WINDOWS.filter((bw) => a.best_power?.[String(bw)]).map((bw): [string, string] => [`Best ${BEST_LABELS[bw]}`, w(a.best_power![String(bw)])]),
    ]));
    el.append(h('div', { class: 'zones-pair' },
      zoneBars('Heart-rate zones', HR_ZONES, a.hr_zones, { ref: a.max_hr_setting ?? s.maxHr, unit: 'bpm' }),
      zoneBars('Power zones', POWER_ZONES, a.power_zones, { ref: a.ftp ?? s.ftp, unit: 'W' }),
    ));
    const charts = h('div', { class: 'act-charts' }, h('p', { class: 'muted small', text: 'Loading the ride…' }));
    el.append(charts);
    const actions = h('div', { class: 'dialog-actions' });
    el.append(actions);
    activitySamples(a.id).then((samples) => {
      charts.replaceChildren();
      if (!samples?.power.length) {
        charts.append(h('p', { class: 'muted small', text: 'No second-by-second data for this ride.' }));
        return;
      }
      const series = (vals: number[]) => {
        // Average into at most ~400 points so long rides stay quick.
        const step = Math.max(1, Math.ceil(vals.length / 400));
        const pts = [];
        for (let i = 0; i < vals.length; i += step) {
          const chunk = vals.slice(i, i + step);
          pts.push({ x: i, y: chunk.reduce((t, v) => t + v, 0) / chunk.length });
        }
        return pts;
      };
      const mmss = (x: number) => {
        const t = Math.round(x);
        const hh = Math.floor(t / 3600);
        const mm = Math.floor((t % 3600) / 60);
        return hh ? `${hh}:${String(mm).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}` : `${mm}:${String(t % 60).padStart(2, '0')}`;
      };
      charts.append(lineChart('Power (W)', series(samples.power), { unit: 'W', xLabel: mmss, height: 130 }));
      if (samples.hr.some((v) => v > 0)) charts.append(lineChart('Heart rate (bpm)', series(samples.hr).filter((p) => p.y > 0), { unit: 'bpm', xLabel: mmss, height: 110, color: '#e5383b', yMin: Math.max(0, Math.min(...samples.hr.filter((v) => v > 0)) - 10) }));
      actions.prepend(button('⬇ Export .tcx', () => {
        const blob = new Blob([toTcx(a, samples)], { type: 'application/vnd.garmin.tcx+xml' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `${a.title.replace(/[^\w\- ]+/g, '').trim() || 'ride'} ${a.started_at.slice(0, 10)}.tcx`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      }));
    }).catch((e) => charts.replaceChildren(h('p', { class: 'error', text: errMsg(e) })));
    actions.append(button('🗑 Delete ride', async () => {
      if (!confirm(`Delete "${a.title}" from ${longDate(a.started_at)}? This can’t be undone.`)) return;
      try {
        await deleteActivity(a.id);
        activities = activities?.filter((x) => x.id !== a.id) ?? null;
        row.remove();
        deps.toast('Ride deleted');
      } catch (e) {
        deps.toast(`Couldn’t delete: ${errMsg(e)}`);
      }
    }));
    return el;
  }

  // Admin --------------------------------------------------------------

  async function adminTab() {
    const [o, users, feedback] = await Promise.all([adminOverview(), adminUsers(), adminFeedback()]);
    const root = h('div', { class: 'tab-admin' });
    root.append(h('div', { class: 'admin-head' },
      h('p', { class: 'muted', text: `Updated ${new Date().toLocaleTimeString()}` }),
      button('↻ Refresh', () => showTab('admin')),
    ));
    root.append(statTiles([
      ['Registered riders', o.users_total.toLocaleString(), `+${o.users_7d} this week · +${o.users_30d} in 30 days`],
      ['Active riders', o.active_7d.toLocaleString(), `this week · ${o.active_30d} in 30 days`],
      ['Rides saved', o.activities_total.toLocaleString(), `+${o.activities_7d} this week`],
      ['Hours ridden', Math.round(o.hours_total).toLocaleString()],
      ['Distance', `${Math.round(o.km_total).toLocaleString()} km`],
      ['Climbed', `${Math.round(o.climbed_total).toLocaleString()} m`],
      ['Workouts / routes saved', `${o.workouts_saved} / ${o.routes_saved}`],
      ['Feedback', `${o.feedback_new} new`, `${o.feedback_total} in total`],
      ['Banned', String(o.banned)],
    ]));

    const days = (rows: { day: string; n: number }[]) => {
      // Fill gaps so there's one bar per day for the last 30 days.
      const by = new Map(rows.map((r) => [r.day.slice(0, 10), r.n]));
      return Array.from({ length: 30 }, (_, i) => {
        const d = new Date(Date.now() - (29 - i) * 86400000);
        const key = d.toISOString().slice(0, 10);
        return { label: shortDate(d), value: by.get(key) ?? 0, tip: longDate(d) };
      });
    };
    root.append(h('div', { class: 'charts-pair' },
      barChart('New riders per day, last 30 days', days(o.signups_by_day ?? []), { axisEvery: 7 }),
      barChart('Rides per day, last 30 days', days(o.rides_by_day ?? []), { axisEvery: 7 }),
    ));

    const table = (head: string[], rows: (string | Node)[][]) => {
      const t = h('table', { class: 'admin-table' });
      t.append(h('thead', {}, h('tr', {}, ...head.map((x) => h('th', { text: x })))));
      const body = h('tbody');
      for (const r of rows) body.append(h('tr', {}, ...r.map((c) => (typeof c === 'string' ? h('td', { text: c }) : h('td', {}, c)))));
      if (!rows.length) body.append(h('tr', {}, h('td', { class: 'muted', text: 'None yet' })));
      t.append(body);
      return h('div', { class: 'table-wrap' }, t);
    };
    root.append(h('div', { class: 'charts-pair' },
      h('div', {}, h('h3', { text: 'Top stages' }), table(['Stage', 'Rides', 'Riders', 'Finishes'], (o.top_stages ?? []).map((r) => [r.name, String(r.rides), String(r.riders), String(r.finishes)]))),
      h('div', {}, h('h3', { text: 'Top workouts' }), table(['Workout', 'Rides', 'Riders'], (o.top_workouts ?? []).map((r) => [r.name, String(r.rides), String(r.riders)]))),
    ));

    // Riders
    root.append(h('h3', { text: `Riders (${users.length})` }));
    const search = h('input', { class: 'search' });
    search.type = 'search';
    search.placeholder = 'Search by name or email';
    root.append(search);
    const me = account()?.id;
    const userRows = () => users
      .filter((x) => `${x.name} ${x.email}`.toLowerCase().includes(search.value.toLowerCase()))
      .map((x) => {
        const status = x.admin ? 'Admin' : x.banned ? 'Banned' : 'Active';
        const action: string | Node = x.admin || x.id === me ? '' : button(x.banned ? 'Unban' : 'Ban', async () => {
          const reason = x.banned ? null : prompt(`Ban ${x.name} (${x.email})? They’ll be signed out and can’t sign in again. Reason (optional):`, '');
          if (reason === null && !x.banned) return;
          try {
            await adminSetBan(x.id, !x.banned, reason || undefined);
            deps.toast(x.banned ? `${x.name} unbanned` : `${x.name} banned`);
            showTab('admin');
          } catch (e) {
            deps.toast(errMsg(e));
          }
        }, x.banned ? '' : 'danger');
        return [x.name, x.email, shortDate(x.joined), String(x.rides), Number(x.hours).toFixed(1), String(Math.round(Number(x.km))), x.last_ride ? shortDate(x.last_ride) : '--', String(x.feedback), status, action];
      });
    const usersHolder = h('div');
    const drawUsers = () => usersHolder.replaceChildren(table(['Name', 'Email', 'Joined', 'Rides', 'Hours', 'km', 'Last ride', 'Feedback', 'Status', ''], userRows()));
    search.addEventListener('input', drawUsers);
    drawUsers();
    root.append(usersHolder);

    // Feedback inbox
    root.append(h('h3', { text: 'Feedback inbox' }));
    const filter = h('select');
    for (const [v, label] of [['open', 'Open (new, planned, in progress)'], ['all', 'All'], ...STATUSES.map((st) => [st, STATUS_LABEL[st]])]) {
      const opt = h('option', { text: label });
      opt.value = v;
      filter.append(opt);
    }
    root.append(filter);
    const inbox = h('div', { class: 'feedback-list' });
    const drawInbox = () => {
      const f = filter.value;
      const items = feedback.filter((x) => f === 'all' || (f === 'open' ? ['new', 'planned', 'in_progress'].includes(x.status) : x.status === f));
      inbox.replaceChildren(...(items.length ? items.map((x) => adminFeedbackCard(x, () => { feedback.splice(feedback.indexOf(x), 1); drawInbox(); })) : [h('p', { class: 'muted', text: 'Nothing here.' })]));
    };
    filter.addEventListener('change', drawInbox);
    drawInbox();
    root.append(inbox);
    return root;
  }

  function adminFeedbackCard(f: Feedback, onDelete: () => void) {
    const card = h('div', { class: `feedback-card status-${f.status}` });
    card.append(h('div', { class: 'fb-head' },
      h('span', { class: 'badge', text: CATEGORY_LABEL[f.category] }),
      h('strong', { text: f.user_name || 'Unknown rider' }),
      h('span', { class: 'muted small', text: `${f.user_email ?? ''} · ${new Date(f.created_at).toLocaleString()}` }),
    ));
    card.append(h('p', { class: 'fb-message', text: f.message }));
    if (f.context && Object.keys(f.context).length) {
      card.append(h('p', { class: 'muted small', text: Object.entries(f.context).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ') }));
    }
    const status = h('select');
    for (const st of STATUSES) {
      const opt = h('option', { text: STATUS_LABEL[st] });
      opt.value = st;
      opt.selected = st === f.status;
      status.append(opt);
    }
    const reply = h('textarea');
    reply.placeholder = 'Reply to the rider (they see this with their suggestion)';
    reply.value = f.admin_reply ?? '';
    reply.rows = 2;
    reply.maxLength = 2000;
    const save = button('Save', async () => {
      try {
        await adminUpdateFeedback(f.id, { status: status.value as FeedbackStatus, admin_reply: reply.value.trim() || null });
        f.status = status.value as FeedbackStatus;
        f.admin_reply = reply.value.trim() || null;
        card.className = `feedback-card status-${f.status}`;
        deps.toast('Feedback updated');
      } catch (e) {
        deps.toast(errMsg(e));
      }
    }, 'primary');
    const del = button('Delete', async () => {
      if (!confirm('Delete this feedback for good?')) return;
      try {
        await adminDeleteFeedback(f.id);
        onDelete();
      } catch (e) {
        deps.toast(errMsg(e));
      }
    });
    card.append(reply, h('div', { class: 'fb-actions' }, status, save, del));
    return card;
  }

  // ---------------------------------------------------------- feedback ----

  async function openFeedback() {
    if (!account()) return openSignIn('Sign in to send ideas and bug reports, and to see our replies.', openFeedback);
    const form = feedbackDialog.querySelector('form')!;
    form.reset();
    $('feedback-error').textContent = '';
    if (!feedbackDialog.open) feedbackDialog.showModal();
    drawMyFeedback();
  }

  async function drawMyFeedback() {
    const list = $('my-feedback');
    list.replaceChildren(h('p', { class: 'muted small', text: 'Loading…' }));
    try {
      const items = await myFeedback();
      list.replaceChildren(...(items.length ? items.map((f) => h('div', { class: `feedback-card status-${f.status}` },
        h('div', { class: 'fb-head' },
          h('span', { class: 'badge', text: CATEGORY_LABEL[f.category] }),
          h('span', { class: `status-pill`, text: STATUS_LABEL[f.status] }),
          h('span', { class: 'muted small', text: longDate(f.created_at) }),
        ),
        h('p', { class: 'fb-message', text: f.message }),
        f.admin_reply ? h('p', { class: 'fb-reply' }, h('strong', { text: 'Reply: ' }), f.admin_reply) : null,
      )) : [h('p', { class: 'muted small', text: 'You haven’t sent anything yet.' })]));
    } catch (e) {
      list.replaceChildren(h('p', { class: 'error', text: errMsg(e) }));
    }
  }

  feedbackDialog.querySelector('form')!.addEventListener('submit', async (e) => {
    const submitter = (e as SubmitEvent).submitter as HTMLButtonElement | null;
    if (submitter?.value !== 'send') return; // "Close" just closes
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const data = new FormData(form);
    const message = String(data.get('message') ?? '').trim();
    if (message.length < 3) {
      $('feedback-error').textContent = 'Please write a little more.';
      return;
    }
    submitter.disabled = true;
    try {
      await submitFeedback(data.get('category') as FeedbackCategory, message.slice(0, 4000), deps.context());
      form.reset();
      deps.toast('Thanks! Your feedback has been sent.');
      drawMyFeedback();
    } catch (err) {
      $('feedback-error').textContent = errMsg(err);
    } finally {
      submitter.disabled = false;
    }
  });

  return { openSignIn, openProfile, invalidate };
}

const STATUSES: FeedbackStatus[] = ['new', 'planned', 'in_progress', 'done', 'declined'];
const STATUS_LABEL: Record<FeedbackStatus, string> = { new: 'New', planned: 'Planned', in_progress: 'In progress', done: 'Done', declined: 'Declined' };
const CATEGORY_LABEL: Record<FeedbackCategory, string> = { idea: '💡 Idea', bug: '🐞 Bug', other: '💬 Other' };
