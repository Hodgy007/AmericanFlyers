// The "My kit" dialog: pick a preset or your own jersey, accent and frame
// colours. The colours show on a little drawing of the bike and, as you change
// them, on your rider in the world behind (cancelling puts them back).

import { cleanKit, PRESETS, setPlayerKit, STARS_AND_STRIPES, type Kit } from './kit';

interface Options {
  /** The saved kit (null = default stars and stripes). */
  current: () => Kit | null;
  save: (kit: Kit | null) => void;
}

const same = (a: Kit | null, b: Kit | null) =>
  a === b || (!!a && !!b && a.jersey === b.jersey && a.accent === b.accent && a.frame === b.frame);

export function initKitUi(o: Options) {
  const dialog = document.getElementById('kit-dialog') as HTMLDialogElement;
  const form = dialog.querySelector('form')!;
  const preview = document.getElementById('kit-preview') as unknown as SVGElement;
  const presetsEl = document.getElementById('kit-presets')!;
  const inputs = {
    jersey: form.elements.namedItem('jersey') as HTMLInputElement,
    accent: form.elements.namedItem('accent') as HTMLInputElement,
    frame: form.elements.namedItem('frame') as HTMLInputElement,
  };
  let working: Kit | null = null; // null = default

  for (const p of PRESETS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'kit-preset';
    b.dataset.id = p.id;
    const k = p.kit ?? STARS_AND_STRIPES;
    b.innerHTML = `<span class="kit-swatch"><i style="background:${k.jersey}"></i><i style="background:${k.accent}"></i><i style="background:${k.frame}"></i></span><span class="kit-preset-name"></span>`;
    b.querySelector('.kit-preset-name')!.textContent = p.name;
    b.addEventListener('click', () => {
      working = p.kit ? { ...p.kit } : null;
      show();
    });
    presetsEl.append(b);
  }

  /** Shows `working` everywhere: inputs, preset highlight, drawing, and your rider. */
  function show() {
    const k = working ?? STARS_AND_STRIPES;
    inputs.jersey.value = k.jersey;
    inputs.accent.value = k.accent;
    inputs.frame.value = k.frame;
    preview.style.setProperty('--jersey', k.jersey);
    preview.style.setProperty('--accent', k.accent);
    preview.style.setProperty('--frame', k.frame);
    for (const b of presetsEl.querySelectorAll<HTMLElement>('.kit-preset')) {
      const p = PRESETS.find((x) => x.id === b.dataset.id)!;
      b.classList.toggle('selected', same(p.kit, working));
    }
    setPlayerKit(working);
  }

  for (const key of ['jersey', 'accent', 'frame'] as const) {
    inputs[key].addEventListener('input', () => {
      working = { jersey: inputs.jersey.value, accent: inputs.accent.value, frame: inputs.frame.value };
      show();
    });
  }

  dialog.addEventListener('close', () => {
    if (dialog.returnValue === 'save') {
      o.save(cleanKit(working));
    } else {
      setPlayerKit(o.current()); // cancelled: back to what was saved
    }
  });

  return {
    open() {
      working = cleanKit(o.current());
      dialog.returnValue = '';
      show();
      dialog.showModal();
    },
  };
}
