export const tsPreferenceControls = Object.freeze([
    "section", "root", "types", "sort", "tree", "size", "favorites", "filters",
    "rescan", "compare", "download", "delete", "autoscan", "rebuild",
]);

export const tsBrowserPreferenceDefaults = Object.freeze({
    appearance: "finder",
    toolbar_style: "icons",
    visible_controls: ["section", "root", "types", "sort", "tree", "size", "favorites", "filters", "rescan"],
    selection_actions: { compare: true, download: true, delete: true },
    show_filenames: true,
    metadata_style: "text",
    metadata_fields: {
        image: ["resolution", "generation_time"],
        video: ["resolution", "fps", "duration", "generation_time"],
        audio: ["duration", "generation_time"],
        "3d": ["type", "generation_time"],
    },
    corner_radius: 0,
    card_background: "transparent",
    card_border: false,
    animate_layout: true,
    inline_video: true,
    inline_video_loop: false,
    inline_video_muted: true,
    recurse: true,
    root_memory: true,
    root_profiles: {},
});

const tsMetadataFields = ["type", "resolution", "fps", "duration", "generation_time", "size_bytes"];

export function tsNormalizeBrowserPreferences(value) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const result = { ...tsBrowserPreferenceDefaults, ...source };
    result.appearance = source.appearance === "classic" ? "classic" : "finder";
    result.toolbar_style = source.toolbar_style === "labels" ? "labels" : "icons";
    result.visible_controls = Array.isArray(source.visible_controls)
        ? [...new Set(source.visible_controls.filter((key) => tsPreferenceControls.includes(key)))]
        : [...tsBrowserPreferenceDefaults.visible_controls];
    result.selection_actions = Object.fromEntries(["compare", "download", "delete"].map((key) => [key, typeof source.selection_actions?.[key] === "boolean" ? source.selection_actions[key] : true]));
    result.show_filenames = source.show_filenames !== false;
    result.metadata_style = ["text", "badges", "hover", "hidden"].includes(source.metadata_style)
        ? source.metadata_style : "text";
    result.metadata_fields = {};
    for (const type of ["image", "video", "audio", "3d"]) {
        const fields = source.metadata_fields?.[type];
        result.metadata_fields[type] = Array.isArray(fields)
            ? [...new Set(fields.filter((field) => tsMetadataFields.includes(field)))]
            : [...tsBrowserPreferenceDefaults.metadata_fields[type]];
    }
    result.corner_radius = Math.max(0, Math.min(24, Number.isFinite(Number(source.corner_radius)) ? Number(source.corner_radius) : 0));
    result.card_background = source.card_background === "theme" ? "theme" : "transparent";
    for (const key of ["card_border", "animate_layout", "inline_video", "inline_video_loop", "inline_video_muted", "recurse", "root_memory"]) {
        result[key] = typeof source[key] === "boolean" ? source[key] : tsBrowserPreferenceDefaults[key];
    }
    result.root_profiles = source.root_profiles && typeof source.root_profiles === "object" && !Array.isArray(source.root_profiles)
        ? Object.fromEntries(Object.entries(source.root_profiles).filter(([key, profile]) => key && profile && typeof profile === "object" && !Array.isArray(profile)))
        : {};
    return result;
}

export function tsCaptureRootProfile(state, prefs) {
    return {
        tsSortKey: state.tsSortKey,
        tsSortDirection: state.tsSortDirection,
        tsPreviewSize: state.tsPreviewSize,
        tsMode: state.tsMode,
        tsFolder: state.tsFolder || "",
        tsTypes: [...(state.tsTypes || [])],
        tsSearch: String(state.tsSearch || ""),
        tsRecurse: Boolean(prefs?.recurse),
        tsFavoritesOnly: Boolean(state.tsFavoritesOnly),
        tsFilterDateFrom: state.tsFilterDateFrom || "",
        tsFilterDateTo: state.tsFilterDateTo || "",
        tsFilterMinWidth: state.tsFilterMinWidth || 0,
        tsFilterMaxWidth: state.tsFilterMaxWidth || 0,
        tsFilterMinHeight: state.tsFilterMinHeight || 0,
        tsFilterMaxHeight: state.tsFilterMaxHeight || 0,
        tsSearchScope: state.tsSearchScope || "filename",
    };
}

export function tsApplyRootProfile(state, profile, prefs = null) {
    if (!profile || typeof profile !== "object") return;
    for (const key of ["tsSortKey", "tsSortDirection", "tsPreviewSize", "tsMode", "tsFolder", "tsSearch", "tsFavoritesOnly", "tsFilterDateFrom", "tsFilterDateTo", "tsFilterMinWidth", "tsFilterMaxWidth", "tsFilterMinHeight", "tsFilterMaxHeight", "tsSearchScope"]) {
        if (Object.hasOwn(profile, key)) state[key] = profile[key];
    }
    if (Array.isArray(profile.tsTypes)) state.tsTypes = new Set(profile.tsTypes);
    if (typeof profile.tsRecurse === "boolean" && prefs) prefs.recurse = profile.tsRecurse;
}
