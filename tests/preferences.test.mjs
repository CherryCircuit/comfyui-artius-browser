import test from "node:test";
import assert from "node:assert/strict";
import { tsBrowserPreferenceDefaults, tsNormalizeBrowserPreferences, tsCaptureRootProfile, tsApplyRootProfile } from "../js/ts-artius-browser-preferences.js";
import { tsBuildAssetSearchParams } from "../js/ts-artius-browser-panel-query.js";

test("Finder defaults and metadata selections are independent and immutable across normalization", () => {
    const first = tsNormalizeBrowserPreferences({});
    assert.equal(first.appearance, "finder");
    assert.equal(first.toolbar_style, "icons");
    assert.ok(first.metadata_fields.image.includes("generation_time"));
    first.metadata_fields.image.push("size_bytes");
    assert.ok(!tsNormalizeBrowserPreferences({}).metadata_fields.image.includes("size_bytes"));
    assert.ok(!tsBrowserPreferenceDefaults.metadata_fields.image.includes("size_bytes"));
});

test("custom controls, muted playback and selection actions normalize without discarding false", () => {
    const prefs = tsNormalizeBrowserPreferences({ visible_controls: ["root", "types", "root", "bad"], inline_video_muted: false, selection_actions: { delete: false }, corner_radius: 99 });
    assert.deepEqual(prefs.visible_controls, ["root", "types"]);
    assert.equal(prefs.inline_video_muted, false);
    assert.equal(prefs.selection_actions.delete, false);
    assert.equal(prefs.selection_actions.download, true);
    assert.equal(prefs.corner_radius, 24);
});

test("per-root snapshots restore actual view, sort, size and filtering values", () => {
    const output = { tsSortKey: "mtime", tsSortDirection: "asc", tsPreviewSize: 224, tsMode: "tree", tsFolder: "sessions/portraits", tsTypes: new Set(["image"]), tsFavoritesOnly: true, tsFilterMinWidth: 720, tsSearchScope: "all", tsSearch: "portrait" };
    const restored = {};
    const prefs = { recurse: false };
    tsApplyRootProfile(restored, tsCaptureRootProfile(output, prefs), prefs);
    assert.equal(restored.tsSortKey, "mtime");
    assert.equal(restored.tsFolder, "sessions/portraits");
    assert.equal(restored.tsPreviewSize, 224);
    assert.deepEqual([...restored.tsTypes], ["image"]);
    assert.equal(restored.tsFilterMinWidth, 720);
    assert.equal(restored.tsSearch, "portrait");
    assert.equal(prefs.recurse, false);
});

test("folder queries preserve exact-root intent and precise nanosecond paging cursors", () => {
    const params = tsBuildAssetSearchParams({ defaultLimit: 60, view: "tree", folder: "", recurse: false, sortKey: "mtime", cursorAfter: { sort_value: "1780000000123456789", id: 42 } });
    assert.equal(params.get("view"), "tree");
    assert.equal(params.get("recurse"), "0");
    assert.ok(params.has("folder"));
    assert.equal(params.get("folder"), "");
    assert.equal(params.get("after_sort"), "1780000000123456789");
    assert.equal(params.get("sort"), "mtime");
    assert.ok(!tsBuildAssetSearchParams({ defaultLimit: 60, view: "flat", folder: "", recurse: false }).has("folder"));
});
