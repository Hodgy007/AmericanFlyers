// The page's entry. It is small on purpose: it fetches the road of the stage the page opens on (usually Heartland, which needs no fetch),
// then runs the app, main.ts. The app's chunk is preloaded by index.html (see `preloadApp` in vite.config.ts) so both download together.
import { chooseStartupStage } from './startupStage';

void chooseStartupStage()
  .then(() => import('./main'))
  .catch((e) => {
    // The app itself couldn't load (a lost connection, a deploy that replaced the files): nothing else can say so yet.
    console.error('American Flyers could not start', e);
    // Built with the DOM, not an HTML string with a style attribute: the Content-Security-Policy allows no inline styles.
    const note = document.createElement('p');
    note.textContent = 'Couldn’t load American Flyers. Check your connection and reload the page.';
    Object.assign(note.style, { position: 'fixed', inset: 'auto 16px 16px', margin: '0', padding: '12px 16px', borderRadius: '8px', background: '#1a1d29', color: '#fff', font: '14px/1.4 system-ui, sans-serif', zIndex: '99999' });
    document.body.append(note);
  });
