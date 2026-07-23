// Skill Progression Coach — standalone PWA on its own GitHub Pages project site
// (/skill-progression-coach/). Verifies identity, relative paths, service-worker
// scope + private cache namespace, and offline shell. HTTP/asset checks use the
// `request` fixture; SW/cache checks use a real page (127.0.0.1 is a secure
// context, so service workers register).
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

test.describe('standalone PWA (project site)', () => {
  test('the root project page serves Skill Progression Coach', async ({ page }) => {
    await page.goto('index.html');
    await expect(page).toHaveTitle('Skill Progression Coach');
    await expect(page.locator('text=Skill Progression Coach').first()).toBeVisible();
  });

  test('all scripts and assets load under /skill-progression-coach/', async ({ request }) => {
    for (const f of ['app.js', 'data.js', 'engine.js', 'progress.js', 'store.js',
                     'duration.js', 'adapt.js', 'settings.js', 'sw.js', 'manifest.webmanifest',
                     'icon.svg', 'icon-192.png', 'icon-512.png', 'icon-512-maskable.png', 'apple-touch-icon.png']) {
      expect((await request.get(f)).ok(), f).toBeTruthy();
    }
    const html = await (await request.get('index.html')).text();
    expect(html).toMatch(/src="app\.js/);   // modules referenced as siblings
    expect(html).not.toMatch(/src="\//);    // no root-absolute paths (break on project sites)
    expect(html).not.toMatch(/coach\/app\.js/);
  });

  test('no production path depends on /pullup-coach/coach/ or /coach/', () => {
    for (const f of ['index.html', 'app.js', 'sw.js', 'manifest.webmanifest', 'store.js']) {
      const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
      expect(s.includes('/pullup-coach/coach/'), f).toBeFalsy();
      expect(s.includes('/coach/'), f).toBeFalsy();
    }
  });

  test('manifest name, short name, unique path id, and ./-scoped start_url/scope', async ({ request }) => {
    const m = await (await request.get('manifest.webmanifest')).json();
    expect(m.name).toBe('Skill Progression Coach');
    expect(m.short_name).toBe('Skill Coach');
    expect(m.id).toBe('/skill-progression-coach/');
    expect(m.start_url).toBe('./');
    expect(m.scope).toBe('./');
    expect(m.display).toBe('standalone');
    expect(m.theme_color).toBe('#12b76a');
    expect(m.background_color).toBe('#0b1220');
  });

  test('green icon assets exist and are green (not the purple original)', async ({ request }) => {
    const m = await (await request.get('manifest.webmanifest')).json();
    expect(m.icons.some(i => (i.purpose || '').includes('maskable'))).toBeTruthy();
    const svg = fs.readFileSync(path.join(ROOT, 'icon.svg'), 'utf8');
    expect(svg).toMatch(/12b76a|0e9f6e/i); // green
    expect(svg).not.toMatch(/6c63ff/i);     // not the purple Pull-Up Coach colour
  });

  test('service worker registers and resolves to the project-site scope', async ({ page }) => {
    await page.goto('index.html');
    const reg = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return null;
      const r = await navigator.serviceWorker.getRegistration();
      return r ? { scope: r.scope } : null;
    });
    expect(reg).not.toBeNull();
    expect(reg.scope).toMatch(/\/skill-progression-coach\/$/);
    expect(reg.scope).not.toMatch(/pullup-coach/); // never controls /pullup-coach/
  });

  test('cache namespace is unique and only its own obsolete caches are pruned', () => {
    const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    expect(sw).toMatch(/skill-progression-coach-v\d+/);        // unique versioned namespace
    expect(sw).not.toMatch(/['"]pullup-coach-v\d+['"]/);        // never opens/deletes original caches
    expect(sw).toMatch(/indexOf\('skill-progression-coach-'\)\s*===\s*0/);
  });

  test('the app coexists with an existing pullup-coach cache (never removes it)', async ({ page }) => {
    await page.goto('index.html');
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    const keys = await page.evaluate(async () => {
      await window.caches.open('pullup-coach-v4'); // simulate the Pull-Up Coach cache on the host
      return await window.caches.keys();
    });
    expect(keys).toContain('pullup-coach-v4');
    expect(keys.some(k => k.indexOf('skill-progression-coach-') === 0)).toBeTruthy();
  });

  test('offline shell: the app opens from cache after a first online load', async ({ page, context }) => {
    await page.goto('index.html');
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.waitForTimeout(600); // let the shell finish caching
    await context.setOffline(true);
    await page.goto('index.html');
    await expect(page.locator('text=Skill Progression Coach').first()).toBeVisible();
    await context.setOffline(false);
  });

  test('the GitHub Pages workflow is present and publishes the repo root on main', () => {
    const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'pages.yml'), 'utf8');
    expect(yml).toMatch(/branches:\s*\[main\]/);
    expect(yml).toMatch(/upload-pages-artifact/);
    expect(yml).toMatch(/deploy-pages/);
    expect(yml).toMatch(/path:\s*'\.'/);
  });
});
