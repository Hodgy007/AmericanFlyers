// The AI switches in the Settings dialog: signed-out riders can't turn them on,
// so they see a sign-in prompt instead. (Saving the choice is AiRide.applyConsent.)

export function syncAiSettingsForm(form: HTMLFormElement, signedIn: boolean, openSignIn: () => void) {
  for (const name of ['aiCoach', 'aiRivals']) {
    const input = form.elements.namedItem(name) as HTMLInputElement | null;
    if (!input) continue;
    input.disabled = !signedIn;
    if (!signedIn) input.checked = false;
  }
  const prompt = form.querySelector<HTMLElement>('#ai-signin');
  if (prompt) prompt.hidden = signedIn;
  const btn = form.querySelector<HTMLButtonElement>('#ai-signin-btn');
  if (btn) btn.onclick = () => { (form.closest('dialog') as HTMLDialogElement | null)?.close('cancel'); openSignIn(); };
}
