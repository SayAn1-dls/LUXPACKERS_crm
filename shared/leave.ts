/* Pure leave arithmetic, shared by the Worker (validation) and the web app (live day count). */

/** Working days in [start, end]: Mon-Fri not in `holidays`. Half day: start must equal end, result 0.5 (0 if that day is off).
    Weekdays come from the date string in UTC, so there is no timezone drift. */
export function leaveDays(start: string, end: string, halfDay: boolean, holidays: string[]): number {
  if (halfDay && start !== end) throw new Error("A half day must start and end on the same date");
  const off = new Set(holidays);
  let n = 0;
  const last = Date.parse(`${end}T00:00:00Z`);
  for (let t = Date.parse(`${start}T00:00:00Z`); t <= last; t += 86_400_000) {
    const dow = new Date(t).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    if (off.has(new Date(t).toISOString().slice(0, 10))) continue;
    n++;
  }
  return halfDay ? n * 0.5 : n;
}
