// The main dialogs of the ride screen, shared by smoke.spec.ts and csp.spec.ts.

/**
 * Each entry opens a dialog from the top bar or from ☰ Menu. `dialog` lists the
 * dialogs that count as success. (An account is required to ride, so every entry opens its own dialog.)
 */
export const DIALOGS: { name: string; button: string; dialog: string[]; menu?: boolean }[] = [
  { name: 'stages', button: '#btn-stage', dialog: ['#stages'] },
  { name: 'workouts', button: '#btn-workouts', dialog: ['#workouts'] },
  { name: 'riders', button: '#btn-riders', dialog: ['#riders'] },
  { name: 'leaderboard', button: '#btn-leaderboard', dialog: ['#leaderboard'], menu: true },
  { name: 'time and weather', button: '#btn-weather', dialog: ['#atmosphere'], menu: true },
  { name: 'training plans', button: '#btn-menu-plans', dialog: ['#plans'], menu: true },
  { name: 'kit', button: '#btn-menu-kit', dialog: ['#kit-dialog'], menu: true },
  { name: 'garage', button: '#btn-menu-garage', dialog: ['#garage-dialog'], menu: true },
  { name: 'tour', button: '#btn-tour', dialog: ['#tour'], menu: true },
  { name: 'events', button: '#btn-events', dialog: ['#events'], menu: true },
  { name: 'rivals', button: '#btn-rivals', dialog: ['#rivals'], menu: true },
  { name: 'settings', button: '#btn-settings', dialog: ['#settings'], menu: true },
  { name: 'feedback', button: '#btn-feedback', dialog: ['#feedback-dialog'], menu: true },
  { name: 'privacy', button: '#btn-privacy', dialog: ['#privacy'], menu: true },
  { name: 'profile', button: '#btn-account', dialog: ['#profile-dialog'] },
];
