// Caps for the results and leaderboard tables: long fields render their first MAX_ROWS riders (and you),
// then one row that says how many more there were.

export const MAX_ROWS = 100;

/** The last row of a capped results table: how many more riders there were. Links nowhere. */
export function moreRow(count: number, cols: number): HTMLTableRowElement {
  const tr = document.createElement('tr');
  const td = document.createElement('td');
  td.colSpan = cols;
  td.className = 'muted small';
  td.textContent = `+${count.toLocaleString('en-US')} more rider${count === 1 ? '' : 's'}`;
  tr.append(td);
  return tr;
}
