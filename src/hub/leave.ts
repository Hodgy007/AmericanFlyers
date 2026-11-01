// "Back to the hub?" for a ride in progress: Keep riding, or save it and go. Resolves true to leave.

export interface LeaveInfo {
  signedIn: boolean;
  /** Moving time so far, as text ("12:34"). */
  time: string;
  /** What is under way besides the ride itself: "a race", "a group ride", "a workout", or empty. */
  also: string;
}

export function askToLeave(info: LeaveInfo): Promise<boolean> {
  const dialog = document.getElementById('hub-leave') as HTMLDialogElement;
  const text = document.getElementById('hub-leave-text')!;
  const go = document.getElementById('hub-leave-go')!;
  const also = info.also ? ` This ends ${info.also}.` : '';
  text.textContent = info.signedIn
    ? `You’ve ridden ${info.time}. We’ll save this ride to your account before you go.${also}`
    : `You’ve ridden ${info.time}. You’re not signed in, so this ride won’t be saved.${also}`;
  go.textContent = info.signedIn ? 'Save and go to the hub' : 'End ride and go to the hub';
  return new Promise((resolve) => {
    dialog.returnValue = 'keep';
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'leave'), { once: true });
    dialog.showModal();
  });
}
