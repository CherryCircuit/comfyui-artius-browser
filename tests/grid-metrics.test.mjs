import test from "node:test";
import assert from "node:assert/strict";
import { tsCalculateGridMetrics } from "../js/ts-artius-browser-panel-grid.js";

const base = { viewportWidth: 1100, cardWidth: 200, previewSizeRange: { min: 96, max: 320 }, gridLayout: { spacing: 10 }, cardChromeScale: {} };

test("Finder grid distributes spare width into horizontal gutters", () => {
    const metrics = tsCalculateGridMetrics({ ...base, appearance: "finder" });
    assert.equal(metrics.tsColumns, 5);
    assert.ok(metrics.tsGapX > metrics.tsGap);
    assert.equal(metrics.tsColumnPositions[0], metrics.tsPaddingLeft);
    assert.ok(metrics.tsColumnPositions[4] + metrics.tsCardWidth <= metrics.tsPaddingLeft + metrics.tsContentWidth);
});

test("a partial last row reuses the same column starts as full rows", () => {
    const metrics = tsCalculateGridMetrics({ ...base, viewportWidth: 1100, appearance: "finder" });
    const lastRowCount = 2;
    const starts = metrics.tsColumnPositions.slice(0, lastRowCount);
    assert.deepEqual(starts, [metrics.tsPaddingLeft, metrics.tsPaddingLeft + metrics.tsCardWidth + metrics.tsGapX]);
    assert.ok(starts.at(-1) + metrics.tsCardWidth <= metrics.tsPaddingLeft + metrics.tsContentWidth);
});

test("Finder grid keeps equal cells and reserves caption height", () => {
    const metrics = tsCalculateGridMetrics({ ...base, appearance: "finder", showFilenames: true, metadataStyle: "text" });
    assert.equal(metrics.tsCardPreviewHeight, 200);
    assert.equal(metrics.tsCardHeight, metrics.tsCardPreviewHeight + metrics.tsCaptionHeight);
    assert.equal(metrics.tsRowHeight, metrics.tsCardHeight + metrics.tsGap);
});

test("filename captions reserve their own space even when metadata is hidden", () => {
    const metrics = tsCalculateGridMetrics({ ...base, appearance: "finder", showFilenames: true, showMetadata: true, metadataStyle: "hidden" });
    assert.equal(metrics.tsShowFilenameCaption, true);
    assert.equal(metrics.tsShowMetadataCaption, false);
    assert.equal(metrics.tsShowCaption, true);
});

test("metadata-only captions reserve space only in text style", () => {
    const text = tsCalculateGridMetrics({ ...base, appearance: "finder", showMetadata: true, metadataStyle: "text" });
    const badges = tsCalculateGridMetrics({ ...base, appearance: "finder", showMetadata: true, metadataStyle: "badges" });
    assert.equal(text.tsShowCaption, true);
    assert.equal(text.tsShowMetadataCaption, true);
    assert.equal(badges.tsShowCaption, false);
});

test("no selected filename or below-image metadata produces no caption row", () => {
    const metrics = tsCalculateGridMetrics({ ...base, appearance: "finder", showFilenames: false, showMetadata: false, metadataStyle: "text" });
    assert.equal(metrics.tsShowCaption, false);
    assert.equal(metrics.tsCaptionHeight, 0);
});

test("Finder grid collapses to a fitting single column in a narrow viewport", () => {
    const metrics = tsCalculateGridMetrics({ ...base, viewportWidth: 180, appearance: "finder" });
    assert.equal(metrics.tsColumns, 1);
    assert.ok(metrics.tsCardWidth <= metrics.tsContentWidth);
    assert.equal(metrics.tsGapX, metrics.tsGap);
});

test("Classic appearance preserves the historical preview height and fixed spacing", () => {
    const metrics = tsCalculateGridMetrics(base);
    assert.equal(metrics.tsCardWidth, 200);
    assert.equal(metrics.tsCardPreviewHeight, 184);
    assert.equal(metrics.tsGapX, 10);
});
