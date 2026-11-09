import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { startHarness } from "./harness.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const harness = await startHarness();
const browser = await chromium.launch({ headless: true }).catch(async error => { await harness.close(); throw error; });
const page = await browser.newPage({ viewport: { width: 1100, height: 960 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(8000);
const errors = [];
page.on("pageerror", error => errors.push(error.message));
const panel = page.locator("ts-artius-browser-panel");
const artifacts = new URL("../artifacts/", import.meta.url);
await mkdir(artifacts, { recursive: true });
let failed = 0;
async function check(name, run) {
    try { await run(); console.log(`PASS ${name}`); }
    catch (error) { failed++; console.error(`FAIL ${name}: ${error.stack || error}`); }
}

try {
    await page.goto(harness.url);
    await page.waitForFunction(() => window.panel?.tsState.tsItems.length > 0);
    await panel.locator(".ts-card").first().waitFor();
    await check("defaults and actual asset modules render", async () => {
        assert.equal(await page.evaluate(() => window.panel.tsState.tsBrowserPreferences.appearance), "finder");
        assert.ok(await panel.locator(".ts-card").count() > 0);
        assert.equal(await panel.locator(".ts-card-media img").first().evaluate(el => getComputedStyle(el).objectFit), "contain");
        assert.ok((await panel.locator(".ts-card").first().innerText()).includes("02:"));
    });
    await page.screenshot({ path: new URL("finder-desktop.png", artifacts).pathname });
    await check("viewport width and row spacing", async () => {
        for (const width of [760, 560, 380, 280]) {
            await page.locator("#mount").evaluate((el, w) => el.style.width = `${w}px`, width);
            await page.waitForTimeout(280);
            const geometry = await page.evaluate(() => {
                const p = window.panel, scroll = p.tsRefs.tsGalleryScroll, m = p.tsGetGridMetrics();
                return { width: scroll.clientWidth, overflow: scroll.scrollWidth - scroll.clientWidth, cols: m.tsColumns, card: m.tsCardWidth };
            });
            assert.ok(geometry.cols >= 1);
            assert.ok(geometry.overflow <= 1, `width ${width}: horizontal overflow ${JSON.stringify(geometry)}`);
            const clusters = await panel.locator('.ts-toolbar-main .ts-type-chips, .ts-toolbar-main .ts-mode-group').evaluateAll(nodes => nodes.filter(n => n.getBoundingClientRect().width).map(n => ({ height: n.getBoundingClientRect().height, cls: n.className })));
            assert.ok(clusters.every(c => c.height <= 44), `Toolbar wraps at ${width}: ${JSON.stringify(clusters)}`);
            const bounds = await page.evaluate(() => {
                const main = window.panel.tsRefs.tsToolbarMain, box = main.getBoundingClientRect();
                return [...main.children].map(el => ({ cls: el.className, rect: el.getBoundingClientRect().toJSON() }))
                    .filter(({ rect }) => rect.width && rect.height).map(({ cls, rect }) => ({ cls, left: rect.left - box.left, right: rect.right - box.right }));
            });
            assert.ok(bounds.every(b => b.left >= -1 && b.right <= 1), `Toolbar clipped at ${width}: ${JSON.stringify(bounds)}`);
        }
        await page.screenshot({ path: new URL("finder-narrow.png", artifacts).pathname });
        await page.locator("#mount").evaluate(el => el.style.width = "760px");
        await page.waitForTimeout(280);
    });
    await check("compact toolbar uses icons, gear beside help and working overflow", async () => {
        const gear = await panel.locator('.ts-settings-toggle').boundingBox();
        const help = await panel.locator('.ts-help-toggle').boundingBox();
        assert.ok(gear.x > 600 && help.x - gear.x < 65, JSON.stringify({ gear, help }));
        assert.ok(await panel.locator('.ts-type-chips svg').count() >= 4);
        const overflow = panel.locator('.ts-toolbar-overflow-button');
        assert.ok(await overflow.isVisible());
        await overflow.click();
        assert.ok(await panel.locator('.ts-toolbar-overflow').isVisible());
        assert.ok(await panel.locator('.ts-toolbar-overflow button, .ts-toolbar-overflow select, .ts-toolbar-overflow input').count() > 0);
        await page.keyboard.press('Escape');
        assert.ok(await panel.locator('.ts-toolbar-overflow').isHidden());
    });
    await check("preferences dialog opens and closes without grid side effects", async () => {
        await panel.locator(".ts-settings-toggle").click();
        assert.ok(await panel.locator(".ts-preferences").isVisible());
        await panel.locator("[data-pref='show_filenames']").uncheck();
        assert.equal(await page.evaluate(() => window.panel.tsState.tsBrowserPreferences.show_filenames), false);
        await panel.locator(".ts-preferences-done").click();
        assert.ok(await panel.locator(".ts-preferences").isHidden());
    });
    await check("settings survive reload", async () => {
        await page.waitForTimeout(500);
        await page.reload();
        await page.waitForFunction(() => window.panel?.tsState.tsItems.length > 0);
        assert.equal(await page.evaluate(() => window.panel.tsState.tsBrowserPreferences.show_filenames), false);
    });
    await check("multiple preference edits survive the real Python settings normalizer", async () => {
        await panel.locator('.ts-settings-toggle').click();
        await panel.locator('[data-control="favorites"]').uncheck();
        await panel.locator('[data-control="filters"]').uncheck();
        await panel.locator('[data-pref="inline_video_muted"]').uncheck();
        await panel.locator('[data-meta-type="image"][data-meta-field="size_bytes"]').check();
        await panel.locator('[data-meta-type="image"][data-meta-field="type"]').check();
        const prefs = await page.evaluate(() => window.panel.tsState.tsBrowserPreferences);
        assert.ok(!prefs.visible_controls.includes('favorites') && !prefs.visible_controls.includes('filters'));
        assert.ok(prefs.metadata_fields.image.includes('size_bytes') && prefs.metadata_fields.image.includes('type'));
        await panel.locator('.ts-preferences-done').click();
        await page.waitForTimeout(400);
        assert.equal(harness.state.settings.ui.browser_preferences.inline_video_muted, false);
        await page.reload();
        await page.waitForFunction(() => window.panel?.tsState.tsItems.length > 0);
        const restored = await page.evaluate(() => window.panel.tsState.tsBrowserPreferences);
        assert.equal(restored.inline_video_muted, false);
        assert.ok(!restored.visible_controls.includes('favorites') && !restored.visible_controls.includes('filters'));
        await panel.locator('.ts-settings-toggle').click();
        await panel.locator('.ts-preferences-reset').click();
        await panel.locator('.ts-preferences-done').click();
    });
    await check("card appearance, filename-only captions and unknown timing", async () => {
        assert.ok(!(await panel.locator('.ts-card[data-card-id="7"]').innerText()).includes('Gen '));
        await panel.locator('.ts-settings-toggle').click();
        await panel.locator('[data-pref="metadata_style"]').selectOption('hidden');
        await panel.locator('[data-pref="card_background"]').selectOption('theme');
        await panel.locator('[data-pref="card_border"]').check();
        await panel.locator('[data-pref="corner_radius"]').evaluate(el => { el.value = '14'; el.dispatchEvent(new Event('change', { bubbles: true })); });
        await panel.locator('.ts-preferences-done').click();
        await page.waitForTimeout(100);
        const caption = panel.locator('.ts-card[data-card-id="1"] .ts-card-caption');
        assert.ok(await caption.isVisible());
        assert.ok((await caption.innerText()).includes('Generation_00001'));
        assert.ok(!(await caption.innerText()).includes('Gen '));
        assert.ok((await caption.boundingBox()).height > 10);
        const media = panel.locator('.ts-card[data-card-id="1"] .ts-card-media');
        assert.notEqual(await media.evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)');
        assert.equal(await panel.locator('.ts-card[data-card-id="1"]').evaluate(el => getComputedStyle(el).borderRadius), '14px');
        await panel.locator('.ts-settings-toggle').click();
        await panel.locator('[data-pref="appearance"]').selectOption('classic');
        await panel.locator('.ts-preferences-done').click();
        assert.equal(await panel.locator('.ts-card[data-card-id="1"] .ts-card-badge').count(), 0);
        await panel.locator('.ts-settings-toggle').click();
        await panel.locator('.ts-preferences-reset').click();
        await panel.locator('.ts-preferences-done').click();
    });
    await check("root preferences restore size, sort, search and recursion", async () => {
        await page.evaluate(() => {
            const p = window.panel;
            p.tsRefs.tsPreviewSize.value = '224'; p.tsRefs.tsPreviewSize.dispatchEvent(new Event('input', { bubbles: true }));
            p.tsRefs.tsSortSelect.value = 'mtime'; p.tsRefs.tsSortSelect.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await panel.locator('.ts-search').fill('Motion');
        await page.waitForTimeout(300);
        await panel.locator('.ts-root-select').selectOption('input');
        await page.waitForFunction(() => !window.panel.tsState.tsLoading && window.panel.tsState.tsRootId === 'input');
        await page.evaluate(() => { const p = window.panel; p.tsRefs.tsPreviewSize.value = '112'; p.tsRefs.tsPreviewSize.dispatchEvent(new Event('input', { bubbles: true })); });
        await panel.locator('.ts-search').fill('Generation');
        await page.waitForTimeout(300);
        await panel.locator('.ts-root-select').selectOption('output');
        await page.waitForFunction(() => !window.panel.tsState.tsLoading && window.panel.tsState.tsRootId === 'output');
        const restored = await page.evaluate(() => ({ size: window.panel.tsState.tsPreviewSize, sort: window.panel.tsState.tsSortKey, search: window.panel.tsRefs.tsSearch.value }));
        assert.deepEqual(restored, { size: 224, sort: 'mtime', search: 'Motion' });
        await panel.locator('.ts-search').fill('');
        await page.waitForTimeout(300);
        await page.evaluate(() => { const p = window.panel; p.tsRefs.tsPreviewSize.value = '160'; p.tsRefs.tsPreviewSize.dispatchEvent(new Event('input', { bubbles: true })); });
    });
    await check("layout resizing animates while reduced-motion disables movement", async () => {
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await page.locator('#mount').evaluate(el => el.style.width = '680px');
        await page.waitForTimeout(35);
        const motion = await panel.locator('.ts-card').first().evaluate(el => getComputedStyle(el).transitionProperty);
        assert.ok(motion.includes('transform'), motion);
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.locator('#mount').evaluate(el => el.style.width = '760px');
        await page.waitForTimeout(35);
        const reduced = await panel.locator('.ts-card').first().evaluate(el => getComputedStyle(el).transitionProperty);
        assert.ok(reduced === 'none' || !reduced.includes('transform'), reduced);
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await page.waitForTimeout(220);
    });
    await check("breadcrumbs, folder history and root-only recursion update the listing", async () => {
        await page.evaluate(() => window.panel.tsNavigateFolder('sessions/portraits'));
        await page.waitForFunction(() => !window.panel.tsState.tsLoading);
        assert.ok((await panel.locator('.ts-breadcrumbs').innerText()).includes('portraits'));
        await panel.locator('[data-nav="up"]').click();
        await page.waitForFunction(() => window.panel.tsState.tsFolder === 'sessions' && !window.panel.tsState.tsLoading);
        await panel.locator('[data-nav="back"]').click();
        await page.waitForFunction(() => window.panel.tsState.tsFolder === 'sessions/portraits' && !window.panel.tsState.tsLoading);
        await panel.locator('[data-nav-folder=""]').click();
        await page.waitForFunction(() => window.panel.tsState.tsFolder === '' && !window.panel.tsState.tsLoading);
        await panel.locator('.ts-settings-toggle').click();
        await panel.locator('[data-pref="recurse"]').uncheck();
        await panel.locator('.ts-preferences-done').click();
        await page.waitForFunction(() => window.panel.tsState.tsItems.length <= 12 && !window.panel.tsState.tsLoading);
        const request = harness.state.requests.filter(r => r.url.startsWith('/asset_browser/search')).at(-1).url;
        const query = new URL(request, harness.url).searchParams;
        assert.equal(query.get('recurse'), '0'); assert.equal(query.get('folder'), '');
        await panel.locator('.ts-settings-toggle').click();
        await panel.locator('.ts-preferences-reset').click();
        await panel.locator('.ts-preferences-done').click();
        await page.evaluate(() => window.panel.tsSetMode('flat'));
        await page.waitForFunction(() => !window.panel.tsState.tsLoading && window.panel.tsState.tsMode === 'flat');
    });
    await check("video plays on click and is stopped on disconnect", async () => {
        const card = panel.locator('.ts-card[data-card-id="2"]');
        await card.hover();
        const actions = await card.locator("button").evaluateAll(nodes => nodes.map(n => ({ action: n.dataset.action, title: n.title })));
        const play = card.locator('[data-action="play"], [data-action="inline-play"], .ts-inline-play');
        assert.ok(await play.count(), `Missing video play affordance: ${JSON.stringify(actions)}`);
        await play.first().click();
        await page.waitForFunction(() => {
            const video = window.panel.shadowRoot.querySelector('[data-card-id="2"] video');
            return video && !video.paused && video.currentTime > 0;
        });
        await page.evaluate(() => window.playingBeforeResize = window.panel.tsActiveInlineVideo);
        await page.locator('#mount').evaluate(el => el.style.width = '640px');
        await page.waitForTimeout(280);
        assert.ok(await page.evaluate(() => window.playingBeforeResize === window.panel.tsActiveInlineVideo && !window.playingBeforeResize.paused));
        await page.locator('#mount').evaluate(el => el.style.width = '760px');
        await page.evaluate(() => { window.testVideo = window.panel.shadowRoot.querySelector('[data-card-id="2"] video'); window.panel.remove(); });
        assert.ok(await page.evaluate(() => window.testVideo.paused));
        await page.evaluate(() => document.getElementById("mount").append(window.panel));
    });
    await check("selection-only bulk actions are available by default", async () => {
        await panel.locator('.ts-card[data-card-id="1"]').click();
        const bar = panel.locator('.ts-selection-bar');
        assert.ok(await bar.isVisible());
        assert.ok(await bar.locator('.ts-download-selected').isVisible());
        assert.ok(await bar.locator('.ts-delete-selected').isVisible());
        assert.ok(await bar.locator('.ts-compare-selected').isVisible());
    });
    await check("Quick Look opens and closes with Space", async () => {
        await panel.locator('.ts-card[data-card-id="1"]').click();
        await page.keyboard.press("Space");
        await page.waitForFunction(() => window.panel.tsViewer.tsIsViewerOpen());
        await page.keyboard.press("Space");
        await page.waitForTimeout(250);
        assert.equal(await page.evaluate(() => window.panel.tsViewer.tsIsViewerOpen()), false);
    });
    await check("viewer info collapse persists and video size modes render", async () => {
        await page.evaluate(() => window.panel.tsOpenViewer(2));
        const viewer = page.locator('ts-artius-browser-viewer');
        await viewer.locator('.ts-video-size-mode').waitFor();
        await viewer.locator('.ts-video-size-mode').selectOption('centered');
        assert.equal(await viewer.locator('.ts-video-shell').getAttribute('data-size-mode'), 'centered');
        await viewer.locator('.ts-viewer-info-toggle').click();
        assert.equal(await viewer.locator('.ts-meta').getAttribute('data-collapsed'), 'true');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(250);
        await page.evaluate(() => window.panel.tsOpenViewer(1));
        assert.equal(await viewer.locator('.ts-meta').getAttribute('data-collapsed'), 'true');
        await page.keyboard.press('i');
        assert.equal(await viewer.locator('.ts-meta').getAttribute('data-collapsed'), 'false');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(250);
    });
    await check("video wipe compares three clips with keyboard and pointer dividers", async () => {
        await page.evaluate(() => { window.panel.tsState.tsSelection = new Set([2,4,8]); window.panel.tsCompareSelected(); });
        const viewer = page.locator('ts-artius-browser-viewer');
        const shell = viewer.locator('.ts-video-compare-shell');
        await shell.waitFor();
        assert.equal(await shell.locator('video').count(), 3);
        await shell.locator('.ts-video-size-mode').selectOption('fit');
        await shell.locator('.ts-video-compare-layout').click();
        assert.equal(await shell.getAttribute('data-layout'), 'wipe');
        const range = shell.locator('.ts-video-compare-wipe-range').first();
        const before = Number(await range.inputValue());
        await range.focus(); await page.keyboard.press('ArrowRight');
        assert.ok(Number(await range.inputValue()) > before);
        const divider = shell.locator('.ts-video-compare-divider').first();
        const rect = await divider.boundingBox();
        await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
        await page.mouse.down(); await page.mouse.move(rect.x + 70, rect.y + rect.height / 2); await page.mouse.up();
        assert.ok(Number(await range.inputValue()) > before + 1);
        const gridBox = await shell.locator('.ts-video-compare-grid').boundingBox();
        const controlsBox = await shell.locator('.ts-video-compare-controls').boundingBox();
        assert.ok(controlsBox.y >= gridBox.y + gridBox.height - 1, JSON.stringify({ gridBox, controlsBox }));
        await page.screenshot({ path: new URL('video-wipe.png', artifacts).pathname });
        await page.keyboard.press('Escape'); await page.waitForTimeout(250);
    });
    await check("virtualization keeps DOM bounded during long scrolling", async () => {
        await page.evaluate(async () => { window.panel.tsRefs.tsGalleryScroll.scrollTop = 0; await window.panel.tsFetchAssets(true); });
        for (let index = 0; index < 6; index++) {
            await page.evaluate(() => { const s = window.panel.tsRefs.tsGalleryScroll; s.scrollTop = s.scrollHeight; });
            await page.waitForTimeout(120);
        }
        const data = await page.evaluate(() => ({ loaded: window.panel.tsState.tsItems.length, dom: window.panel.shadowRoot.querySelectorAll('.ts-card').length }));
        assert.ok(data.loaded > 60, JSON.stringify(data));
        assert.ok(data.dom < 100, JSON.stringify(data));
    });
    await check("no uncaught browser errors", async () => assert.deepEqual(errors, []));
    console.log(JSON.stringify({ failed, loaded: harness.state.assets.length, requests: harness.state.requests.length, artifacts: artifacts.pathname }));
} finally {
    await browser.close();
    await harness.close();
}
if (failed) process.exitCode = 1;
