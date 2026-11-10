# The new shell — Today | Plan | Goals (rebuild slice 1)

The front-end rebuild follows APP-BLUEPRINT.md (kept with the product documents,
outside this repository). This first slice replaces the Foundation Path home
(Path | Academy) with the approved structure, and adds the one piece of data the
structure needs: the athlete's week plan. The engine underneath is unchanged.

```
new shell (Today, Plan, Plan › The program, Goals*, Settings, sheets)
        ↓ reads / starts
existing capabilities: program.js (position, outcomes, Foundation, goal entry),
the runner, the Max Test screen, the Foundation screen*, History, backup, sheet sync
        + weekplan.js (new): which program item is on which day
```
\* transitional, replaced by the Goals rebuild.

## 1. Navigation
- Bottom bar: **Today · Plan · Goals**, icon + label, no badges. The gear sits top
  right on all three, in the same place.
- The runner, the workout summary and the Foundation-complete moment have no tab
  bar. Screens pushed on a tab (Plan › The program, Goals › Foundation, Settings,
  History) keep the bar and their own way back.
- A workout in progress: Today shows it (RESUME); Plan and Goals show one slim bar
  above the tab bar, "Workout in progress · Pull · Resume".
- Every exit of the runner, the Max Test and the summary lands on Today.
- `setScreen('path')` and `setScreen('academy')` still resolve (to Today and Goals)
  so nothing that refers to them breaks.

## 2. Today
One session, one action. Precedence:
1. no program on the device → "Add your program to start" + IMPORT PROGRAM FILE
   (labelled temporary);
2. a workout in progress → its name, "In progress", RESUME, View workout;
3. today's first planned item not done → its name, START WORKOUT (or Max Test,
   "Five short tests.", START TEST); if the program has not reached it yet (a Max
   Test planned while a workout of the week is open), what comes first and
   DO <IT> NOW;
4. something done today → "✓ Pull — done", "Next: Saturday · Core & Stability",
   See results;
5. the program is in a recovery week → "Recovery week", VIEW LAST WEEK'S WORKOUTS,
   Mark the recovery week done;
6. an open day → "Nothing planned today." + TRAIN ANYWAY; when a session of this
   week was missed: "Push wasn't done on Tuesday." + DO PUSH NOW / Train something
   else; when this week had workouts, all of them are done and the Max Test is
   next: "This week's training is done. Next: …" (a week with no workouts in it
   is never called done).

No program position, week progress, goal line, exercise list or readiness on
Today. There is no "adjusted" state: no adaptation rule exists, so none is shown.

Sheets: View workout (the prescription, lighter than the old preview), Train anyway
(this week's sessions and Not placed, then Repeat a recent workout), What the Max
Test measures, Recovery week (the program's guidance verbatim, last week's
workouts), Session results (the existing History sheet, with Delete).

## 3. Plan
- "This week", the program position ("Phase 4 · Week 4 · 2 of 4 done"), the
  calendar week Sunday to Saturday as hairline rows: weekday and date, the
  session or "—", and its state — ✓ done (sage), ● today (clay), planned, not done
  (muted), "moved from Thu", "done Wed", unavailable.
- Not placed: open work of the program that is on no day this week, with Place.
- "Proposed week" with ACCEPT WEEK / Edit first until the week is accepted.
- When everything planned this week is done and the program has more to give:
  "Week 4 is done. Plan the rest of this week with the Max Test?" ACCEPT / Not now.
- A recovery week: one band instead of the remaining rows, with the program's
  guidance and Mark done.
- Next (the program's next two items) and The program › (phases, weeks, Max Tests
  and recovery weeks with "you are here"; earlier content "placed past").
- Edit: each row opens Day actions — Move (onto a busy day it offers Swap), Swap,
  Replace with… (Legs, a recent workout, rest), Remove (to Not placed), Mark
  unavailable (then "Move Pull to Friday?" MOVE / Leave in Not placed), Place a
  workout here, Mark available. Every change applies at once and shows in the row.

## 4. The week plan (weekplan.js, `spc_c_weekplan`)
Additive, athlete-owned, append-only, kept apart from the training record.
Events (APP-BLUEPRINT §12):

| Event | Fields | Written when |
|---|---|---|
| `week_proposed` | `weekStart`, `placements: [{date, item}]` | the athlete accepts a proposal or first changes it: the proposal exactly as shown |
| `week_accepted` | `weekStart` | ACCEPT WEEK |
| `placement_changed` | `weekStart`, `item`, `from`, `to`, `reason` | a move, swap, replace, remove, place, DO X NOW, Train anyway; `from`/`to` are dates or `null` (Not placed); `reason` is `athlete`, or `suggestion` when the athlete accepted a coach suggestion |
| `day_unavailable` / `day_available` | `date` | Mark unavailable / available |

- An item is a program workout id (`P4W4-3`, the optional `P4W4-L`) or a Max Test
  node id (`MT4`). A recovery week is never placed on a day: it is the whole week,
  read from the program position.
- Implementation detail: the blueprint writes `placement_changed {date, from, to}`;
  here the event names the item and carries the two dates, so a move is one event.
  `day_available` is the undo of `day_unavailable`.
- **Until a week is stored, its proposal is computed, never written.** It places,
  from today on, the program's open work in program order on the training days:
  the current week's required workouts not done yet, then the Max Test that
  follows the week. The optional session waits under Not placed unless "Include
  optional sessions" is on (D4). A recovery week or the next training week is
  never pulled into the same calendar week. A day with work already done is not
  given more.
- **Once stored, only the athlete's own events change it.** New training days,
  optional sessions, program progress or a date passing never move a placement.
- A placement is done when its item was completed (or its Max Test recorded)
  during that calendar week; the record on another day shows as "done Wed" on
  the planned row. Anything else done that week shows on its own day.
- A day that passes undone stays where it was, marked not done; Today offers it
  on the next open day; nothing moves it until the athlete does.
- **The program position never reads the week plan.** It stays derived from
  completions (program.js). Deleting `spc_c_weekplan` loses no training data and
  returns every week to a proposal. The key is in the backup (`PROTECTED_KEYS`)
  and in `ADDED_KEYS`, so older backups still restore and leave it as it is.
- Training days and "Include optional sessions" live in the profile
  (`spc_c_profile.days`, `.includeOptional`), set in Settings › Training days.

## 5. Goals (transitional)
The blueprint's overview rows over today's engine: each goal with "In the way:
Foundation" / "In the way: 6 pull-ups and 6 parallel-bar dips" / "Open"; the
Foundation row "n of 6 confirmed · View what's missing" until complete, then
"Foundation complete · date". A goal opens a sheet with what opens it and, after
the Foundation, the entry checks (record a test, or confirm a workout set). The
Foundation row opens the existing Foundation screen, reworded. All of this sits in
one block of app.js marked TRANSITIONAL, replaced as a whole by the Goals rebuild.
"Academy" no longer appears anywhere the athlete can reach.

## 6. Settings
Training days · Program (the program file and history import, both labelled
temporary; the starting point) · History · Google Sheet (labelled temporary) ·
Timer & sounds · Data & backup (install, backup, restore, reset) · the build
(asset version), so a phone can be checked against what was deployed. Done
returns to the tab Settings was opened from. "Re-run Onboarding" (the earlier
app's onboarding) is offered only in the legacy shell.

## 7. Visual system
Quiet Paper, Earned Illustration: paper `--bg`, ink `--text`, clay `--accent` only
for the one primary button and "today", sage `--good` for done, hairlines
`--hair`. Serif for Today's session (30/36) and screen titles (22/28); sans for
everything used. One filled button per screen (52 px, radius 14); secondary actions
are ink text links, tertiary muted. Rows are hairline rows on paper; the only raised
surfaces are sheets. No gradients, glow, shadows or illustrations on Today and
Plan. The Path's discs, watercolour filter and path CSS were removed.

## 8. Not in this slice
The runner rebuild (and Workout complete), the Goals rebuild (Foundation detail,
Goal detail, parts), the assessment runner, milestones beyond the existing
Foundation moment, readiness, free workout / one exercise, onboarding,
localisation / right-to-left, in-goal progression, viewing a past or next week in
Plan.
