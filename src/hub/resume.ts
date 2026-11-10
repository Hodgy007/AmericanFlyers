// "Pick up your ride?" after a crash or a closed tab (see src/rideSnapshot.ts). Same dialog pattern as leave.ts.
// Escape does nothing: the rider chooses, so an interrupted ride is never lost by accident.

export type ResumeChoice = 'resume' | 'save' | 'discard';

export function askToResume(info: { stageName: string; summary: string }): Promise<ResumeChoice> {
  const dialog = document.getElementById('hub-resume') as HTMLDialogElement;
  document.getElementById('hub-resume-title')!.textContent = `Pick up your ride on ${info.stageName}?`;
  document.getElementById('hub-resume-text')!.textContent = info.summary;
  return new Promise((resolve) => {
    dialog.returnValue = '';
    dialog.addEventListener('cancel', (e) => e.preventDefault(), { once: true });
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'resume' || dialog.returnValue === 'save' ? dialog.returnValue : 'discard'), { once: true });
    dialog.showModal();
  });
}
