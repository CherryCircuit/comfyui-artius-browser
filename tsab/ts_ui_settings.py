from __future__ import annotations

import re
from typing import Any

from .ts_settings import TS_DEFAULT_PREVIEW_SIZE, TS_PREVIEW_SIZE_MAX, TS_PREVIEW_SIZE_MIN

TS_BROWSER_SECTIONS = {"assets", "workflows"}
TS_VIEW_MODES = {"flat", "tree"}
TS_ASSET_SORT_KEYS = {"created_at", "mtime", "filename", "size_bytes"}
TS_WORKFLOW_SORT_KEYS = {"created_at", "filename"}
TS_SORT_DIRECTIONS = {"asc", "desc"}
TS_ASSET_TYPES = {"image", "video", "audio", "3d"}
TS_SEARCH_SCOPES = {"filename", "all"}

# Assets larger than any real render but small enough to stay a plausible pixel
# dimension — bounds the persisted resolution filter so a garbage value cannot
# be stored.
TS_FILTER_DIMENSION_MAX = 100_000
_TS_DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# Free-text settings values are persisted verbatim to config.json and echoed
# back on every settings GET; without bounds a client could grow the file up
# to the request-size cap. Generous for real values, hard stop for abuse.
TS_SETTINGS_STRING_MAX_LENGTH = 512
TS_SETTINGS_LIST_MAX_ENTRIES = 1000

TS_VISIBLE_CONTROLS = {"section", "root", "types", "sort", "tree", "size", "favorites", "filters", "rescan", "compare", "download", "delete", "autoscan", "rebuild"}
TS_METADATA_FIELDS = {"type", "resolution", "fps", "duration", "generation_time", "size_bytes"}
TS_SELECTION_ACTIONS = {"compare", "download", "delete"}
TS_ROOT_PROFILE_KEYS = {"tsSortKey", "tsSortDirection", "tsPreviewSize", "tsMode", "tsFolder", "tsTypes", "tsFavoritesOnly", "tsFilterDateFrom", "tsFilterDateTo", "tsFilterMinWidth", "tsFilterMaxWidth", "tsFilterMinHeight", "tsFilterMaxHeight", "tsSearchScope", "tsRecurse", "tsSearch"}


def TSNormalizeBrowserPreferences(ts_preferences: Any) -> dict[str, Any]:
    ts_preferences = ts_preferences if isinstance(ts_preferences, dict) else {}
    ts_fields = ts_preferences.get("metadata_fields") if isinstance(ts_preferences.get("metadata_fields"), dict) else {}
    ts_field_defaults = {"image": ["resolution", "generation_time"], "video": ["resolution", "fps", "duration", "generation_time"], "audio": ["duration", "generation_time"], "3d": ["type", "generation_time"]}
    ts_normalized_fields = {}
    for ts_type, ts_defaults in ts_field_defaults.items():
        ts_values = ts_fields.get(ts_type, ts_defaults)
        ts_normalized_fields[ts_type] = list(dict.fromkeys(str(x) for x in ts_values if str(x) in TS_METADATA_FIELDS))[:len(TS_METADATA_FIELDS)] if isinstance(ts_values, (list, tuple, set)) else list(ts_defaults)
    ts_profiles = ts_preferences.get("root_profiles") if isinstance(ts_preferences.get("root_profiles"), dict) else {}
    ts_selection_actions = ts_preferences.get("selection_actions") if isinstance(ts_preferences.get("selection_actions"), dict) else {}
    ts_normalized_profiles = {}
    for ts_root, ts_profile in list(ts_profiles.items())[:64]:
        if not isinstance(ts_root, str) or not ts_root or len(ts_root) > 512 or not isinstance(ts_profile, dict):
            continue
        ts_clean: dict[str, Any] = {}
        for ts_key, ts_value in ts_profile.items():
            if ts_key not in TS_ROOT_PROFILE_KEYS:
                continue
            if ts_key in {"tsTypes"}:
                ts_clean[ts_key] = [str(x)[:32] for x in ts_value[:4] if str(x) in TS_ASSET_TYPES] if isinstance(ts_value, (list, tuple)) else []
            elif ts_key in {"tsFavoritesOnly", "tsRecurse"}:
                ts_clean[ts_key] = bool(ts_value)
            elif ts_key == "tsPreviewSize":
                ts_clean[ts_key] = TSClampInt(ts_value, TS_PREVIEW_SIZE_MIN, TS_PREVIEW_SIZE_MAX, TS_DEFAULT_PREVIEW_SIZE)
            elif ts_key in {"tsFilterMinWidth", "tsFilterMaxWidth", "tsFilterMinHeight", "tsFilterMaxHeight"}:
                ts_clean[ts_key] = TSClampInt(ts_value, 0, TS_FILTER_DIMENSION_MAX, 0)
            elif ts_key == "tsSortKey":
                ts_clean[ts_key] = TSNormalizeChoice(ts_value, TS_ASSET_SORT_KEYS, "created_at")
            elif ts_key == "tsSortDirection":
                ts_clean[ts_key] = TSNormalizeChoice(ts_value, TS_SORT_DIRECTIONS, "desc")
            elif ts_key == "tsMode":
                ts_clean[ts_key] = TSNormalizeChoice(ts_value, TS_VIEW_MODES, "flat")
            elif ts_key == "tsSearchScope":
                ts_clean[ts_key] = TSNormalizeChoice(ts_value, TS_SEARCH_SCOPES, "filename")
            elif ts_key in {"tsFilterDateFrom", "tsFilterDateTo"}:
                ts_clean[ts_key] = TSNormalizeFilterDate(ts_value)
            else:
                ts_clean[ts_key] = TSBoundedString(ts_value)
        ts_normalized_profiles[ts_root] = ts_clean
    ts_controls = ts_preferences.get("visible_controls", ["section", "root", "types", "sort", "tree", "size", "favorites", "filters", "rescan"])
    return {
        "appearance": TSNormalizeChoice(ts_preferences.get("appearance"), {"finder", "classic"}, "finder"),
        "toolbar_style": TSNormalizeChoice(ts_preferences.get("toolbar_style"), {"icons", "labels"}, "icons"),
        "visible_controls": [x for x in TSNormalizeStringSequence(ts_controls) if x in TS_VISIBLE_CONTROLS],
        "selection_actions": {
            key: ts_selection_actions.get(key) if isinstance(ts_selection_actions.get(key), bool) else True
            for key in TS_SELECTION_ACTIONS
        },
        "show_filenames": bool(ts_preferences.get("show_filenames", True)),
        "metadata_style": TSNormalizeChoice(ts_preferences.get("metadata_style"), {"text", "badges", "hover", "hidden"}, "text"),
        "metadata_fields": ts_normalized_fields,
        "corner_radius": TSClampInt(ts_preferences.get("corner_radius"), 0, 24, 0),
        "card_background": TSNormalizeChoice(ts_preferences.get("card_background"), {"transparent", "theme"}, "transparent"),
        "card_border": bool(ts_preferences.get("card_border", False)),
        "animate_layout": bool(ts_preferences.get("animate_layout", True)),
        "inline_video": bool(ts_preferences.get("inline_video", True)),
        "inline_video_loop": bool(ts_preferences.get("inline_video_loop", False)),
        "inline_video_muted": ts_preferences.get("inline_video_muted") if isinstance(ts_preferences.get("inline_video_muted"), bool) else True,
        "recurse": bool(ts_preferences.get("recurse", True)),
        "root_memory": bool(ts_preferences.get("root_memory", True)),
        "root_profiles": ts_normalized_profiles,
    }


def TSBoundedString(ts_value: Any, ts_default: str = "") -> str:
    return str(ts_value or ts_default)[:TS_SETTINGS_STRING_MAX_LENGTH]


def TSNormalizeFolderPath(ts_value: Any) -> str:
    return str(ts_value or "").replace("\\", "/").strip("/")


def TSNormalizeFilterDate(ts_value: Any) -> str:
    # Empty string = no filter. Otherwise must be an ISO YYYY-MM-DD date; any
    # other shape is discarded rather than stored.
    ts_text = str(ts_value or "").strip()
    return ts_text if _TS_DATE_PATTERN.match(ts_text) else ""


def TSNormalizeFilterDimension(ts_value: Any) -> int:
    # 0 = no filter. Negatives and junk collapse to 0; huge values are clamped.
    ts_parsed = TSParseClampedInt(ts_value, 0, TS_FILTER_DIMENSION_MAX)
    return ts_parsed if ts_parsed is not None else 0


def TSParseClampedInt(ts_value: Any, ts_minimum: int, ts_maximum: int) -> int | None:
    try:
        return max(ts_minimum, min(ts_maximum, int(ts_value)))
    except (TypeError, ValueError, OverflowError):
        # OverflowError: json.loads("1e400") yields inf, and int(inf) raises.
        # Without it one junk value aborts the whole settings POST and silently
        # discards every other valid key sent with it.
        return None


def TSClampInt(ts_value: Any, ts_minimum: int, ts_maximum: int, ts_default: int) -> int:
    ts_clamped_value = TSParseClampedInt(ts_value or ts_default, ts_minimum, ts_maximum)
    return ts_clamped_value if ts_clamped_value is not None else ts_default


def TSParseClampedFloat(ts_value: Any, ts_minimum: float, ts_maximum: float) -> float | None:
    try:
        return max(ts_minimum, min(ts_maximum, float(ts_value)))
    except (TypeError, ValueError):
        return None


def TSClampFloat(ts_value: Any, ts_minimum: float, ts_maximum: float, ts_default: float) -> float:
    ts_clamped_value = TSParseClampedFloat(ts_value if ts_value is not None else ts_default, ts_minimum, ts_maximum)
    return ts_clamped_value if ts_clamped_value is not None else ts_default


def TSNormalizeChoice(ts_value: Any, ts_allowed_values: set[str], ts_default: str) -> str:
    ts_text_value = str(ts_value or ts_default)
    return ts_text_value if ts_text_value in ts_allowed_values else ts_default


def TSNormalizeStringSequence(ts_value: Any) -> list[str]:
    if not isinstance(ts_value, (list, tuple, set)):
        return []
    ts_items = [str(ts_item)[:TS_SETTINGS_STRING_MAX_LENGTH] for ts_item in ts_value if str(ts_item)]
    return ts_items[:TS_SETTINGS_LIST_MAX_ENTRIES]


def TSNormalizeUISettings(ts_ui: dict[str, Any] | None) -> dict[str, Any]:
    ts_ui = ts_ui if isinstance(ts_ui, dict) else {}
    return {
        "language": TSBoundedString(ts_ui.get("language"), "en"),
        "autoscan": bool(ts_ui.get("autoscan", True)),
        "browser_section": TSNormalizeChoice(ts_ui.get("browser_section"), TS_BROWSER_SECTIONS, "assets"),
        "asset_view_mode": TSNormalizeChoice(ts_ui.get("asset_view_mode"), TS_VIEW_MODES, "flat"),
        "workflow_view_mode": TSNormalizeChoice(ts_ui.get("workflow_view_mode"), TS_VIEW_MODES, "flat"),
        "asset_sort_key": TSNormalizeChoice(ts_ui.get("asset_sort_key"), TS_ASSET_SORT_KEYS, "created_at"),
        "asset_sort_direction": TSNormalizeChoice(ts_ui.get("asset_sort_direction"), TS_SORT_DIRECTIONS, "desc"),
        "asset_preview_size": TSClampInt(ts_ui.get("asset_preview_size"), TS_PREVIEW_SIZE_MIN, TS_PREVIEW_SIZE_MAX, TS_DEFAULT_PREVIEW_SIZE),
        "asset_search": TSBoundedString(ts_ui.get("asset_search")),
        "asset_search_scope": TSNormalizeChoice(ts_ui.get("asset_search_scope"), TS_SEARCH_SCOPES, "filename"),
        "asset_favorites_only": bool(ts_ui.get("asset_favorites_only", False)),
        "workflow_sort_key": TSNormalizeChoice(ts_ui.get("workflow_sort_key"), TS_WORKFLOW_SORT_KEYS, "created_at"),
        "workflow_sort_direction": TSNormalizeChoice(ts_ui.get("workflow_sort_direction"), TS_SORT_DIRECTIONS, "desc"),
        "workflow_preview_size": TSClampInt(ts_ui.get("workflow_preview_size"), TS_PREVIEW_SIZE_MIN, TS_PREVIEW_SIZE_MAX, TS_DEFAULT_PREVIEW_SIZE),
        "workflow_search": TSBoundedString(ts_ui.get("workflow_search")),
        "asset_types": [ts_type for ts_type in TSNormalizeStringSequence(ts_ui.get("asset_types")) if ts_type in TS_ASSET_TYPES],
        "asset_date_from": TSNormalizeFilterDate(ts_ui.get("asset_date_from")),
        "asset_date_to": TSNormalizeFilterDate(ts_ui.get("asset_date_to")),
        "asset_min_width": TSNormalizeFilterDimension(ts_ui.get("asset_min_width")),
        "asset_max_width": TSNormalizeFilterDimension(ts_ui.get("asset_max_width")),
        "asset_min_height": TSNormalizeFilterDimension(ts_ui.get("asset_min_height")),
        "asset_max_height": TSNormalizeFilterDimension(ts_ui.get("asset_max_height")),
        "selected_root_id": TSBoundedString(ts_ui.get("selected_root_id"), "all"),
        "selected_folder_path": TSBoundedString(TSNormalizeFolderPath(ts_ui.get("selected_folder_path"))),
        "workflow_selected_folder_path": TSBoundedString(TSNormalizeFolderPath(ts_ui.get("workflow_selected_folder_path"))),
        "expanded_folders": TSNormalizeStringSequence(ts_ui.get("expanded_folders")),
        "browser_width": TSClampInt(ts_ui.get("browser_width"), 0, 1600, 0),
        "asset_tree_panel_width": TSClampInt(ts_ui.get("asset_tree_panel_width"), 120, 700, 220),
        "workflow_tree_panel_width": TSClampInt(ts_ui.get("workflow_tree_panel_width"), 120, 700, 220),
        "toolbar_scale": TSClampFloat(ts_ui.get("toolbar_scale"), 0.6, 1.0, 1.0),
        "browser_preferences": TSNormalizeBrowserPreferences(ts_ui.get("browser_preferences")),
    }


def TSApplyUISettingsUpdates(ts_ui: dict[str, Any], ts_ui_updates: dict[str, Any] | None) -> None:
    ts_updates = ts_ui_updates if isinstance(ts_ui_updates, dict) else {}
    if "language" in ts_updates:
        ts_ui["language"] = TSBoundedString(ts_updates.get("language"), "en")
    if "autoscan" in ts_updates:
        ts_ui["autoscan"] = bool(ts_updates.get("autoscan", True))
    if "browser_section" in ts_updates:
        ts_ui["browser_section"] = TSNormalizeChoice(ts_updates.get("browser_section"), TS_BROWSER_SECTIONS, "assets")
    if "asset_view_mode" in ts_updates:
        ts_ui["asset_view_mode"] = TSNormalizeChoice(ts_updates.get("asset_view_mode"), TS_VIEW_MODES, "flat")
    if "workflow_view_mode" in ts_updates:
        ts_ui["workflow_view_mode"] = TSNormalizeChoice(ts_updates.get("workflow_view_mode"), TS_VIEW_MODES, "flat")
    if "asset_sort_key" in ts_updates:
        ts_ui["asset_sort_key"] = TSNormalizeChoice(ts_updates.get("asset_sort_key"), TS_ASSET_SORT_KEYS, "created_at")
    if "workflow_sort_key" in ts_updates:
        ts_ui["workflow_sort_key"] = TSNormalizeChoice(ts_updates.get("workflow_sort_key"), TS_WORKFLOW_SORT_KEYS, "created_at")
    if "asset_sort_direction" in ts_updates:
        ts_ui["asset_sort_direction"] = TSNormalizeChoice(ts_updates.get("asset_sort_direction"), TS_SORT_DIRECTIONS, "desc")
    if "workflow_sort_direction" in ts_updates:
        ts_ui["workflow_sort_direction"] = TSNormalizeChoice(ts_updates.get("workflow_sort_direction"), TS_SORT_DIRECTIONS, "desc")
    if "asset_preview_size" in ts_updates:
        ts_preview_size = TSParseClampedInt(ts_updates.get("asset_preview_size"), TS_PREVIEW_SIZE_MIN, TS_PREVIEW_SIZE_MAX)
        if ts_preview_size is not None:
            ts_ui["asset_preview_size"] = ts_preview_size
    if "asset_search" in ts_updates:
        ts_ui["asset_search"] = TSBoundedString(ts_updates.get("asset_search"))
    if "asset_search_scope" in ts_updates:
        ts_ui["asset_search_scope"] = TSNormalizeChoice(ts_updates.get("asset_search_scope"), TS_SEARCH_SCOPES, "filename")
    if "asset_favorites_only" in ts_updates:
        ts_ui["asset_favorites_only"] = bool(ts_updates.get("asset_favorites_only"))
    if "workflow_preview_size" in ts_updates:
        ts_preview_size = TSParseClampedInt(ts_updates.get("workflow_preview_size"), TS_PREVIEW_SIZE_MIN, TS_PREVIEW_SIZE_MAX)
        if ts_preview_size is not None:
            ts_ui["workflow_preview_size"] = ts_preview_size
    if "workflow_search" in ts_updates:
        ts_ui["workflow_search"] = TSBoundedString(ts_updates.get("workflow_search"))
    if "asset_types" in ts_updates:
        ts_asset_types = ts_updates.get("asset_types") or []
        if isinstance(ts_asset_types, (list, tuple, set)):
            ts_ui["asset_types"] = [str(ts_type) for ts_type in ts_asset_types if str(ts_type) in TS_ASSET_TYPES]
    for ts_date_key in ("asset_date_from", "asset_date_to"):
        if ts_date_key in ts_updates:
            ts_ui[ts_date_key] = TSNormalizeFilterDate(ts_updates.get(ts_date_key))
    for ts_dimension_key in ("asset_min_width", "asset_max_width", "asset_min_height", "asset_max_height"):
        if ts_dimension_key in ts_updates:
            ts_ui[ts_dimension_key] = TSNormalizeFilterDimension(ts_updates.get(ts_dimension_key))
    if "selected_root_id" in ts_updates:
        ts_ui["selected_root_id"] = TSBoundedString(ts_updates.get("selected_root_id"), "all")
    if "selected_folder_path" in ts_updates:
        ts_ui["selected_folder_path"] = TSBoundedString(TSNormalizeFolderPath(ts_updates.get("selected_folder_path")))
    if "workflow_selected_folder_path" in ts_updates:
        ts_ui["workflow_selected_folder_path"] = TSBoundedString(TSNormalizeFolderPath(ts_updates.get("workflow_selected_folder_path")))
    if "expanded_folders" in ts_updates:
        ts_ui["expanded_folders"] = TSNormalizeStringSequence(ts_updates.get("expanded_folders"))
    if "browser_width" in ts_updates:
        ts_browser_width = TSParseClampedInt(ts_updates.get("browser_width"), 0, 1600)
        if ts_browser_width is not None:
            ts_ui["browser_width"] = ts_browser_width
    if "asset_tree_panel_width" in ts_updates:
        ts_asset_tree_panel_width = TSParseClampedInt(ts_updates.get("asset_tree_panel_width"), 120, 700)
        if ts_asset_tree_panel_width is not None:
            ts_ui["asset_tree_panel_width"] = ts_asset_tree_panel_width
    if "workflow_tree_panel_width" in ts_updates:
        ts_workflow_tree_panel_width = TSParseClampedInt(ts_updates.get("workflow_tree_panel_width"), 120, 700)
        if ts_workflow_tree_panel_width is not None:
            ts_ui["workflow_tree_panel_width"] = ts_workflow_tree_panel_width
    if "toolbar_scale" in ts_updates:
        ts_toolbar_scale = TSParseClampedFloat(ts_updates.get("toolbar_scale"), 0.6, 1.0)
        if ts_toolbar_scale is not None:
            ts_ui["toolbar_scale"] = ts_toolbar_scale
    if "browser_preferences" in ts_updates:
        ts_ui["browser_preferences"] = TSNormalizeBrowserPreferences(ts_updates.get("browser_preferences"))
