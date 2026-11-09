import { tsLerp } from "./ts-artius-browser-panel-format.js";

function tsClamp(tsValue, tsMin, tsMax) {
    return Math.max(tsMin, Math.min(tsMax, tsValue));
}

export function tsCalculateGridMetrics(tsOptions = {}) {
    const tsLayout = tsOptions.gridLayout || {};
    const tsRange = tsOptions.previewSizeRange || { min: 96, max: 320 };
    const tsChrome = tsOptions.cardChromeScale || {};
    const tsGap = Math.max(0, Number(tsLayout.spacing) || 0);
    const tsPaddingTop = tsGap;
    const tsPaddingRight = tsGap;
    const tsPaddingBottom = tsGap;
    const tsPaddingLeft = tsGap;
    const tsViewportWidth = Math.max(0, Math.round(Number(tsOptions.viewportWidth || 0)));
    const tsAppearance = tsOptions.appearance === "finder" ? "finder" : "classic";
    const tsMinCardWidth = Math.max(1, Number(tsRange.min) || 96);
    const tsMaxCardWidth = Math.max(tsMinCardWidth, Number(tsRange.max) || 320);
    const tsRequestedCardWidth = tsClamp(Number(tsOptions.cardWidth) || tsMinCardWidth, tsMinCardWidth, tsMaxCardWidth);
    const tsAvailableWidth = Math.max(1, tsViewportWidth - (tsPaddingLeft + tsPaddingRight + 4));
    const tsContentWidth = tsAppearance === "finder" ? tsAvailableWidth : Math.max(220, tsAvailableWidth);
    // Finder cells remain square/equal in each row. At very narrow widths the
    // requested size yields to the available width so a one-column layout fits.
    const tsCardWidth = tsAppearance === "finder"
        ? Math.max(1, Math.min(tsRequestedCardWidth, tsContentWidth))
        : tsRequestedCardWidth;
    const tsShowFilenameCaption = Boolean(tsOptions.showFilenames);
    const tsShowMetadataCaption = Boolean(tsOptions.showMetadata) && tsOptions.metadataStyle === "text";
    const tsShowCaption = tsShowFilenameCaption || tsShowMetadataCaption;
    const tsCaptionHeight = tsShowCaption ? Math.max(24, Number(tsOptions.captionHeight) || 36) : 0;
    const tsCardPreviewHeight = Math.round(tsCardWidth * (tsAppearance === "finder" ? 1 : 0.92));
    const tsCardHeight = tsCardPreviewHeight + tsCaptionHeight;
    const tsPreviewRatio = tsClamp((tsCardWidth - tsMinCardWidth) / Math.max(1, tsMaxCardWidth - tsMinCardWidth), 0, 1);
    const tsMetrics = {
        tsGap,
        tsGapX: tsGap,
        tsAppearance,
        tsCaptionHeight,
        tsShowCaption,
        tsShowFilenameCaption,
        tsShowMetadataCaption,
        tsPaddingTop,
        tsPaddingRight,
        tsPaddingBottom,
        tsPaddingLeft,
        tsContentWidth,
        tsCardWidth,
        tsCardPreviewHeight,
        tsCardHeight,
        tsCardInset: Math.round(tsLerp(tsChrome.insetMin || 0, tsChrome.insetMax || 0, tsPreviewRatio)),
        tsActionSize: Math.round(tsLerp(tsChrome.actionSizeMin || 0, tsChrome.actionSizeMax || 0, tsPreviewRatio)),
        tsActionRadius: Math.round(tsLerp(tsChrome.actionRadiusMin || 0, tsChrome.actionRadiusMax || 0, tsPreviewRatio)),
        tsActionFontSize: Math.round(tsLerp(tsChrome.actionFontMin || 0, tsChrome.actionFontMax || 0, tsPreviewRatio)),
        tsActionGap: Math.round(tsLerp(tsChrome.actionGapMin || 0, tsChrome.actionGapMax || 0, tsPreviewRatio)),
        tsBadgeFontSize: Math.round(tsLerp(tsChrome.badgeFontMin || 0, tsChrome.badgeFontMax || 0, tsPreviewRatio)),
        tsBadgePadY: Math.round(tsLerp(tsChrome.badgePadYMin || 0, tsChrome.badgePadYMax || 0, tsPreviewRatio)),
        tsBadgePadX: Math.round(tsLerp(tsChrome.badgePadXMin || 0, tsChrome.badgePadXMax || 0, tsPreviewRatio)),
        tsBadgeRadius: Math.round(tsLerp(tsChrome.badgeRadiusMin || 0, tsChrome.badgeRadiusMax || 0, tsPreviewRatio)),
        tsOverlayPadX: Math.round(tsLerp(tsChrome.overlayPadXMin || 0, tsChrome.overlayPadXMax || 0, tsPreviewRatio)),
        tsOverlayPadBottom: Math.round(tsLerp(tsChrome.overlayPadBottomMin || 0, tsChrome.overlayPadBottomMax || 0, tsPreviewRatio)),
        tsOverlayTop: Math.round(tsLerp(tsChrome.overlayTopMin || 0, tsChrome.overlayTopMax || 0, tsPreviewRatio)),
        tsOverlayTitleSize: Math.round(tsLerp(tsChrome.overlayTitleMin || 0, tsChrome.overlayTitleMax || 0, tsPreviewRatio)),
        tsOverlayMetaSize: Math.round(tsLerp(tsChrome.overlayMetaMin || 0, tsChrome.overlayMetaMax || 0, tsPreviewRatio)),
        tsCardRadius: Math.round(tsLerp(tsChrome.cardRadiusMin || 0, tsChrome.cardRadiusMax || 0, tsPreviewRatio)),
    };
    tsMetrics.tsColumns = Math.max(1, Math.floor((tsMetrics.tsContentWidth + tsGap) / (tsCardWidth + tsGap)));
    if (tsAppearance === "finder") {
        // Share all spare horizontal space between columns. A single column is
        // left aligned and keeps the minimum requested gutter on either side.
        const tsSpare = Math.max(0, tsMetrics.tsContentWidth - tsMetrics.tsColumns * tsCardWidth);
        tsMetrics.tsGapX = tsMetrics.tsColumns > 1
            ? Math.max(tsGap, tsSpare / (tsMetrics.tsColumns - 1))
            : tsGap;
        tsMetrics.tsColumnPositions = Array.from({ length: tsMetrics.tsColumns }, (_, tsIndex) =>
            tsPaddingLeft + tsIndex * (tsCardWidth + tsMetrics.tsGapX));
    } else {
        tsMetrics.tsColumnPositions = Array.from({ length: tsMetrics.tsColumns }, (_, tsIndex) =>
            tsPaddingLeft + tsIndex * (tsCardWidth + tsGap));
    }
    tsMetrics.tsRowHeight = tsMetrics.tsCardHeight + tsGap;
    return tsMetrics;
}

export function tsApplyGridMetricStyles(tsGalleryContent, tsMetrics) {
    tsGalleryContent.style.setProperty("--ts-card-width", `${tsMetrics.tsCardWidth}px`);
    tsGalleryContent.style.setProperty("--ts-card-height", `${tsMetrics.tsCardHeight}px`);
    tsGalleryContent.style.setProperty("--ts-card-gap-x", `${tsMetrics.tsGapX}px`);
    tsGalleryContent.style.setProperty("--ts-card-gap-y", `${tsMetrics.tsGap}px`);
    tsGalleryContent.style.setProperty("--ts-grid-padding-left", `${tsMetrics.tsPaddingLeft}px`);
    tsGalleryContent.style.setProperty("--ts-grid-padding-right", `${tsMetrics.tsPaddingRight}px`);
    tsGalleryContent.style.setProperty("--ts-card-preview-height", `${tsMetrics.tsCardPreviewHeight}px`);
    tsGalleryContent.style.setProperty("--ts-card-radius", `${tsMetrics.tsCardRadius}px`);
    tsGalleryContent.style.setProperty("--ts-card-inset", `${tsMetrics.tsCardInset}px`);
    tsGalleryContent.style.setProperty("--ts-card-action-size", `${tsMetrics.tsActionSize}px`);
    tsGalleryContent.style.setProperty("--ts-card-action-radius", `${tsMetrics.tsActionRadius}px`);
    tsGalleryContent.style.setProperty("--ts-card-action-font-size", `${tsMetrics.tsActionFontSize}px`);
    tsGalleryContent.style.setProperty("--ts-card-action-gap", `${tsMetrics.tsActionGap}px`);
    tsGalleryContent.style.setProperty("--ts-card-badge-font-size", `${tsMetrics.tsBadgeFontSize}px`);
    tsGalleryContent.style.setProperty("--ts-card-badge-pad-y", `${tsMetrics.tsBadgePadY}px`);
    tsGalleryContent.style.setProperty("--ts-card-badge-pad-x", `${tsMetrics.tsBadgePadX}px`);
    tsGalleryContent.style.setProperty("--ts-card-badge-radius", `${tsMetrics.tsBadgeRadius}px`);
    tsGalleryContent.style.setProperty("--ts-card-overlay-pad-x", `${tsMetrics.tsOverlayPadX}px`);
    tsGalleryContent.style.setProperty("--ts-card-overlay-pad-bottom", `${tsMetrics.tsOverlayPadBottom}px`);
    tsGalleryContent.style.setProperty("--ts-card-overlay-top", `${tsMetrics.tsOverlayTop}px`);
    tsGalleryContent.style.setProperty("--ts-card-overlay-title-size", `${tsMetrics.tsOverlayTitleSize}px`);
    tsGalleryContent.style.setProperty("--ts-card-overlay-meta-size", `${tsMetrics.tsOverlayMetaSize}px`);
}
