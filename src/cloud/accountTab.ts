// The "Privacy & data" tab of the profile: download everything we store about
// you, read the privacy page, and delete your account (type DELETE to confirm).

import { DELETE_PHRASE, confirmsDeletion, deleteMyAccount, downloadMyData } from './privacy';

interface Deps {
  toast: (msg: string, ms?: number) => void;
  /** Closes the profile dialog. */
  close: () => void;
}

const msgOf = (e: unknown) => (e as Error)?.message ?? String(e);

export function accountTab(deps: Deps): HTMLElement {
  const root = document.createElement('div');
  root.className = 'tab-privacy';
  root.innerHTML = `
    <section>
      <h3>Your data</h3>
      <p class="muted">You own your rides and settings. Download a copy of everything we store about you as a single file (JSON), or read how we look after it.</p>
      <div class="dialog-actions left">
        <button type="button" class="pv-download">⬇ Download my data</button>
        <button type="button" data-privacy>🔒 Read the privacy page</button>
      </div>
      <p class="error pv-download-error" role="alert"></p>
    </section>
    <section class="danger-zone">
      <h3>Delete my account</h3>
      <p>This permanently deletes your account and everything in it: your rides, workouts, routes, settings, FTP history, feedback and ride-ons. It can’t be undone. Download your data first if you want to keep it.</p>
      <label>Type <strong>${DELETE_PHRASE}</strong> to confirm
        <input type="search" class="pv-confirm" enterkeyhint="done" autocomplete="off" autocapitalize="characters" spellcheck="false" />
      </label>
      <p class="error pv-delete-error" role="alert"></p>
      <div class="dialog-actions left"><button type="button" class="danger pv-delete" disabled>Delete my account for good</button></div>
    </section>`;

  const q = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const download = q<HTMLButtonElement>('.pv-download');
  download.addEventListener('click', async () => {
    q('.pv-download-error').textContent = '';
    download.disabled = true;
    download.textContent = 'Preparing…';
    try {
      const name = await downloadMyData();
      deps.toast(`Saved ${name}`, 5000);
    } catch (e) {
      q('.pv-download-error').textContent = `Couldn’t build your download: ${msgOf(e)}`;
    } finally {
      download.disabled = false;
      download.textContent = '⬇ Download my data';
    }
  });

  const confirm = q<HTMLInputElement>('.pv-confirm');
  const del = q<HTMLButtonElement>('.pv-delete');
  confirm.addEventListener('input', () => { del.disabled = !confirmsDeletion(confirm.value); });
  del.addEventListener('click', async () => {
    if (!confirmsDeletion(confirm.value)) return;
    q('.pv-delete-error').textContent = '';
    del.disabled = true;
    del.textContent = 'Deleting…';
    try {
      await deleteMyAccount();
      deps.close();
      (document.getElementById('goodbye') as HTMLDialogElement | null)?.showModal();
    } catch (e) {
      // Admins get the database's plain refusal here.
      q('.pv-delete-error').textContent = msgOf(e);
      del.textContent = 'Delete my account for good';
      del.disabled = !confirmsDeletion(confirm.value);
    }
  });
  return root;
}
