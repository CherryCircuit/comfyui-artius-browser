import test from "node:test";
import assert from "node:assert/strict";
import { tsNormalizeCompareWipeBoundaries, tsNormalizeVideoSizeMode } from "../js/ts-artius-browser-viewer-state.js";

test("video size mode accepts only the three supported display modes", () => {
    assert.equal(tsNormalizeVideoSizeMode("actual"), "actual");
    assert.equal(tsNormalizeVideoSizeMode("centered"), "centered");
    assert.equal(tsNormalizeVideoSizeMode("unknown"), "fit");
});

test("wipe dividers stay ordered and leave visible slices for two through four clips", () => {
    assert.deepEqual(tsNormalizeCompareWipeBoundaries([50], 2), [0, 50, 100]);
    assert.deepEqual(tsNormalizeCompareWipeBoundaries([99, 2], 3), [0, 96, 98, 100]);
    assert.deepEqual(tsNormalizeCompareWipeBoundaries([50, 50, 50], 4), [0, 50, 52, 54, 100]);
});
