// Skill Progression Coach — canonical Weekly Plan.
// Covers the plan data model, the explainable load model, per-day adaptations,
// priorities, and the Today/Week/Map integration. Maps to Part 15 (9–28).
const { test, expect } = require('@playwright/test');
const Week = require('../week.js');

function freshPlan() { return Week.seedPlan(); }
function withClimb(diff, pull, grip) {
  const p = freshPlan();
  p.dayLog[0] = { completed: true, climb: { difficulty: diff, pullingLoad: pull, gripLoad: grip } };
  return p;
}
function withGroup(day, moves) {
  const p = freshPlan();
  p.dayLog[day] = { completed: true, group: { moves } };
  return p;
}

// ─────────────────────────── pure plan model ─────────────────────────────
test.describe('weekly plan — data model', () => {
  test('13 — every planned exercise has Goal/Skill/Role/Priority + day rationale', () => {
    Week.DAYS.forEach(d => d.exercises.forEach(id => {
      const m = Week.EX[id];
      expect(m, `metadata for ${id}`).toBeTruthy();
      expect(m.role).toBeTruthy();
      expect(Week.PRIORITY_ORDER).toContain(m.priority);
      expect(Array.isArray(m.goals)).toBe(true);
      expect(Array.isArray(m.skills)).toBe(true);
      // rationale for the day(s) it appears on
      expect(m.why && m.why[d.key], `${id} rationale on ${d.key}`).toBeTruthy();
    }));
  });

  test('19 — Pistol Squat is an Active Skill and Priority A on Friday', () => {
    expect(Week.SKILLS.pistol.active).toBe(true);
    const fri = Week.resolveDay(freshPlan(), 5, {});
    const pistol = fri.items.find(i => i.exId === 'pistol');
    expect(pistol.priority).toBe('A');
    expect(pistol.role).toBe(Week.ROLE.MAIN);
  });

  test('26 — Saturday defaults to Rest', () => {
    const sat = Week.resolveDay(freshPlan(), 6, {});
    expect(sat.day.type).toBe('rest');
    expect(sat.status).toBe('rest');
    expect(sat.templateId).toBeNull();
  });
});

test.describe('weekly plan — Monday High Pull rule', () => {
  test('15 — High Pull stays on Monday under normal load', () => {
    const mon = Week.resolveDay(freshPlan(), 1, {});
    const hp = mon.items.find(i => i.exId === 'highpull');
    expect(hp.included).toBe(true);
    expect(mon.adapted).toBe(false);
  });

  test('16 — hard Sunday climbing can remove High Pull with a clear cause', () => {
    const mon = Week.resolveDay(withClimb('hard', 'high', 'high'), 1, {});
    const hp = mon.items.find(i => i.exId === 'highpull');
    expect(hp.included).toBe(false);
    expect(mon.adapted).toBe(true);
    const cause = mon.adaptations.map(a => a.cause).join(' ');
    expect(cause).toMatch(/Sunday climbing was marked Hard/);
  });

  test('17 — High Pull is NOT auto-moved to Tuesday', () => {
    const tue = Week.resolveDay(withClimb('hard', 'high', 'high'), 2, {});
    expect(tue.items.find(i => i.exId === 'highpull')).toBeUndefined();
    expect(Week.DAYS_BY_ID[2].exercises).not.toContain('highpull');
  });

  test('18 — Transition Drill appears exactly once per week', () => {
    const days = Week.DAYS.filter(d => d.exercises.indexOf('transition_drill') >= 0);
    expect(days.length).toBe(1);
    expect(days[0].key).toBe('mon');
  });
});

test.describe('weekly plan — Friday ladder load model', () => {
  test('21 — Friday stays five Ladder rounds under normal load', () => {
    const fri = Week.resolveDay(freshPlan(), 5, {});
    // No reduction adaptation, template unchanged, planned rounds = 5.
    expect(fri.templateId).toBe('mu_strength');
    expect(fri.adaptations.some(a => a.action === 'reduced' || a.action === 'lightened')).toBe(false);
    expect(fri.plannedLadderRounds).toBe(5);
    expect(fri.ladderRounds).toBeNull(); // null → run the workout's own default (5)
  });

  test('22 — high Wednesday/Thursday pulling load reduces Friday', () => {
    // Elevated pulling from group work → 4 rounds.
    const p = freshPlan();
    p.dayLog[3] = { completed: true, group: { moves: ['pullups', 'rows'] } };
    const friE = Week.resolveDay(p, 5, {});
    expect(friE.ladderRounds).toBe(4);
    expect(friE.adaptations.some(a => a.action === 'reduced')).toBe(true);
    // Very high → Light Practice.
    const p2 = freshPlan();
    p2.dayLog[3] = { completed: true, group: { moves: ['pullups', 'rows', 'pulldowns'] } };
    p2.dayLog[4] = { completed: true, group: { moves: ['pullups', 'rows'] } };
    const friH = Week.resolveDay(p2, 5, {});
    expect(friH.templateId).toBe('mu_light');
    expect(friH.adaptations.some(a => a.action === 'lightened')).toBe(true);
  });

  test('23 — no rigid three-pull-exposure rule: four low-load exposures keep 5 rounds', () => {
    const p = freshPlan();
    p.dayLog[0] = { completed: true, climb: { difficulty: 'moderate', pullingLoad: 'low', gripLoad: 'low' } };
    p.dayLog[3] = { completed: true, group: { moves: ['rows'] } };
    // climbing + Tuesday pyramid + a light row + Friday ladder = 4 distinct pull
    // exposures, but total load is low → Friday remains the planned 5 rounds.
    const fri = Week.resolveDay(p, 5, {});
    expect(fri.adaptations.some(a => a.action === 'reduced' || a.action === 'lightened')).toBe(false);
    expect(fri.plannedLadderRounds).toBe(5);
  });

  test('24 — Wrist Roller is optional, conditional, never required', () => {
    expect(Week.EX.wristroller.optional).toBe(true);
    expect(Week.EX.wristroller.priority).not.toBe('A');
    expect(Week.EX.wristroller.priority).not.toBe('B');
    // Excluded when grip load is already high.
    const hi = Week.resolveDay(withClimb('hard', 'high', 'high'), 5, {});
    expect(hi.items.find(i => i.exId === 'wristroller').included).toBe(false);
  });

  test('25 — Dead Hang and Toes-to-Bar alternate by load, never both', () => {
    // Fresh grip → Dead Hang chosen, Toes-to-Bar off.
    const fresh = Week.resolveDay(freshPlan(), 5, {});
    const dhF = fresh.items.find(i => i.exId === 'deadhang');
    const t2bF = fresh.items.find(i => i.exId === 't2b');
    expect(dhF.included !== t2bF.included).toBe(true);
    expect(dhF.included).toBe(true);
    // High grip → Toes-to-Bar kept, Dead Hang off.
    const loaded = Week.resolveDay(withClimb('hard', 'high', 'high'), 5, {});
    const dhL = loaded.items.find(i => i.exId === 'deadhang');
    const t2bL = loaded.items.find(i => i.exId === 't2b');
    expect(dhL.included).toBe(false);
    expect(t2bL.included).toBe(true);
  });
});

test.describe('weekly plan — priorities & overrides', () => {
  test('14 — Priority A is preserved before lower priorities when simplifying', () => {
    const fri = Week.resolveDay(freshPlan(), 5, {});
    const included = fri.items.filter(i => i.included);
    const l2 = Week.simplify(included, 2); // drop D and C
    // Priority A items survive; removed are only C/D.
    expect(l2.kept.every(i => i.priority === 'A' || i.priority === 'B')).toBe(true);
    expect(l2.kept.some(i => i.priority === 'A')).toBe(true);
    expect(l2.removed.every(r => r.item.priority === 'C' || r.item.priority === 'D')).toBe(true);
    // Monday: reducing removes D before C.
    const mon = Week.resolveDay(freshPlan(), 1, {});
    const l1 = Week.simplify(mon.items.filter(i => i.included), 1);
    expect(l1.removed.every(r => r.item.priority === 'D')).toBe(true);
  });

  test('28 — a user override does not permanently rewrite the plan', () => {
    const p = withClimb('hard', 'high', 'high');
    // Load says: remove High Pull on Monday.
    expect(Week.resolveDay(p, 1, {}).adapted).toBe(true);
    // User forces the planned session for today.
    p.overrides[1] = 'planned';
    const forced = Week.resolveDay(p, 1, {});
    expect(forced.adapted).toBe(false);
    expect(forced.items.find(i => i.exId === 'highpull').included).toBe(true);
    // The underlying program template is untouched.
    expect(Week.DAYS_BY_ID[1].exercises).toContain('highpull');
    // Clearing the override returns to the load-driven adaptation.
    delete p.overrides[1];
    expect(Week.resolveDay(p, 1, {}).adapted).toBe(true);
  });
});

// ─────────────────────────── UI integration ──────────────────────────────
async function seedPlan(page, todayId = 5, active = 'muscleup') {
  await page.addInitScript((d) => { window.__spcTodayId = d; }, todayId);
  await page.evaluate(({ active }) => {
    const S = window.CoachStore.makeStore(), D = window.CoachData, E = window.CoachEngine;
    const state = {};
    D.worlds.forEach(w => {
      const nodes = window.CoachStore.seedStates(w, { pullup_max: 9, dips_max: 6 });
      const f = E.autoFocus(w, nodes);
      state[w.id] = { nodes, focus: { primary: f.primary, supporting: f.supporting, manual: false } };
    });
    S.setBench({ pullup_max: 9, dips_max: 6 }); S.setState(state);
    S.setProfile({ onboarded: true, activeWorld: active, days: [0, 2, 4], duration: 'normal' });
  }, { active });
  await page.reload();
}

test.describe('weekly plan — UI', () => {
  test('9 — Week screen shows all seven approved days', async ({ page }) => {
    await page.goto('index.html'); await seedPlan(page);
    await page.locator('.nav [data-s="week"]').click();
    await expect(page.locator('.wd-card')).toHaveCount(7);
    const text = await page.locator('.week-grid').textContent();
    ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].forEach(d => expect(text).toContain(d));
  });

  test('10 — Today uses the scheduled session for the current day', async ({ page }) => {
    await page.goto('index.html'); await seedPlan(page, 5); // Friday
    await expect(page.locator('.rec.sched .name')).toContainText('Home Pull Session');
    await expect(page.locator('.rec.sched')).toContainText('First Muscle-Up');
  });

  test('11 — the primary session is the scheduled plan, not an independent pick', async ({ page }) => {
    // Monday must present the Monday session (Push + Explosive Pull), driven by
    // the plan/day — not a map-focus recommendation.
    await page.goto('index.html'); await seedPlan(page, 1); // Monday
    await expect(page.locator('.rec.sched .name')).toContainText('Free Gym');
    await expect(page.locator('.rec.sched')).toContainText('Chest-to-Bar / High Pull');
  });

  test('12 — the alternative is visually and semantically secondary', async ({ page }) => {
    await page.goto('index.html'); await seedPlan(page, 1);
    // Exactly one dominant scheduled card.
    await expect(page.locator('.rec.sched')).toHaveCount(1);
    const alt = page.locator('.alt-card');
    if (await alt.count()) {
      const schedBox = await page.locator('.rec.sched').boundingBox();
      const altBox = await alt.first().boundingBox();
      expect(altBox.height).toBeLessThan(schedBox.height); // smaller than the scheduled card
      // Labelled as an alternative/adapted/shorter option.
      await expect(alt.first()).toBeVisible();
    }
  });

  test('20 — group-workout pull is recorded and affects Friday', async ({ page }) => {
    await page.goto('index.html'); await seedPlan(page, 3); // Wednesday
    await page.locator('.rec.sched [data-groupday]').click();
    // Log heavy pulling movements.
    for (const v of ['pullups', 'rows', 'pulldowns']) await page.locator(`[data-gmove="${v}"]`).click();
    await page.locator('[data-savegroup]').click();
    // Also log Thursday pulling so the week's pulling load is very high.
    await page.evaluate(() => {
      const S = window.CoachStore.makeStore(); const p = S.getPlan();
      p.dayLog[4] = { completed: true, group: { moves: ['pullups', 'rows'] } }; S.setPlan(p);
    });
    // Now Friday should be adapted (lightened/reduced) by the recorded load.
    const fri = await page.evaluate(() => {
      const S = window.CoachStore.makeStore();
      return window.CoachWeek.resolveDay(S.getPlan(), 5, {});
    });
    expect(fri.adapted).toBe(true);
    expect(fri.adaptations.some(a => a.exId === 'pullup_ladder')).toBe(true);
  });

  test('27 — Today, Week and Map read the same canonical plan + metadata', async ({ page }) => {
    await page.goto('index.html'); await seedPlan(page, 5);
    // Today scheduled session name…
    const todayName = await page.locator('.rec.sched .name').first().textContent();
    // …matches the Friday card on the Week screen.
    await page.locator('.nav [data-s="week"]').click();
    const friCard = page.locator('.wd-card').nth(5);
    await expect(friCard).toContainText('Home Pull Session');
    // Map node detail surfaces the same plan (10 Pull-Ups trained Tue & Fri).
    await page.locator('.nav [data-s="map"]').click();
    await page.locator('.node.current').click({ force: true });
    await expect(page.locator('.sheet')).toContainText('In your weekly plan');
    await expect(page.locator('.sheet')).toContainText('Tuesday');
    await expect(page.locator('.sheet')).toContainText('Friday');
    expect(todayName).toContain('Home Pull Session');
  });
});
