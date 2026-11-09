from __future__ import annotations

import asyncio
import math
import threading
from pathlib import Path
from typing import Any

from .ts_logging import TSLogVerbose

TS_HISTORY_LIMIT = 100
TS_PROMPT_ID_MAX = 256
TS_MAX_DURATION_SECONDS = 7 * 24 * 60 * 60


def TSExtractSuccessfulPrompt(history_entry: Any) -> tuple[float, str, list[dict[str, str]]] | None:
    """Extract trusted timing and file descriptors from one Comfy history item."""
    if not isinstance(history_entry, dict):
        return None
    ts_status = history_entry.get("status")
    ts_messages_value = ts_status.get("messages", []) if isinstance(ts_status, dict) else []
    ts_messages = ts_messages_value if isinstance(ts_messages_value, list) else []
    ts_start = ts_success = None
    for ts_message in ts_messages[:1000] if isinstance(ts_messages, list) else []:
        if not isinstance(ts_message, (list, tuple)) or len(ts_message) < 2:
            continue
        ts_kind, ts_data = ts_message[0], ts_message[1]
        if ts_kind not in {"execution_start", "execution_success"} or not isinstance(ts_data, dict):
            continue
        try:
            ts_timestamp = float(ts_data.get("timestamp")) / 1000.0
        except (TypeError, ValueError, OverflowError):
            continue
        if not math.isfinite(ts_timestamp) or ts_timestamp <= 0:
            continue
        if ts_kind == "execution_start":
            ts_start = ts_timestamp
        else:
            ts_success = ts_timestamp
    if ts_start is None or ts_success is None or ts_success < ts_start:
        return None
    ts_duration = ts_success - ts_start
    if ts_duration > TS_MAX_DURATION_SECONDS:
        return None
    ts_cached_nodes: set[str] = set()
    for ts_message in ts_messages:
        if not isinstance(ts_message, (list, tuple)) or len(ts_message) < 2 or ts_message[0] != "execution_cached":
            continue
        ts_data = ts_message[1]
        if isinstance(ts_data, dict) and isinstance(ts_data.get("nodes"), list):
            ts_cached_nodes.update(str(ts_node)[:128] for ts_node in ts_data["nodes"][:1000])
        elif isinstance(ts_data, list):
            ts_cached_nodes.update(str(ts_node)[:128] for ts_node in ts_data[:1000])
    ts_outputs = history_entry.get("outputs")
    ts_meta = history_entry.get("meta") if isinstance(history_entry.get("meta"), dict) else {}
    ts_descriptors: list[dict[str, str]] = []
    if isinstance(ts_outputs, dict):
        for ts_node_id, ts_node_output in list(ts_outputs.items())[:1000]:
            if not isinstance(ts_node_output, dict):
                continue
            ts_node_meta = ts_meta.get(str(ts_node_id), {})
            ts_real_node_id = str(ts_node_meta.get("real_node_id", "")) if isinstance(ts_node_meta, dict) else ""
            ts_logical_node_id = str(ts_node_meta.get("node_id", "")) if isinstance(ts_node_meta, dict) else ""
            if str(ts_node_id) in ts_cached_nodes or ts_real_node_id in ts_cached_nodes or ts_logical_node_id in ts_cached_nodes:
                continue
            for ts_array in list(ts_node_output.values())[:64]:
                if not isinstance(ts_array, list):
                    continue
                for ts_item in ts_array[:1000]:
                    if not isinstance(ts_item, dict) or not isinstance(ts_item.get("filename"), str):
                        continue
                    ts_filename = ts_item["filename"]
                    ts_subfolder = ts_item.get("subfolder", "")
                    ts_kind = ts_item.get("type", "output")
                    if len(ts_filename) > 512 or len(str(ts_subfolder)) > 1024 or ts_kind != "output":
                        continue
                    ts_descriptors.append({"filename": ts_filename, "subfolder": str(ts_subfolder), "node_id": str(ts_node_id)[:128]})
                    if len(ts_descriptors) >= 2000:
                        return (ts_duration, "comfy_history", ts_descriptors)
    if not ts_descriptors:
        return None
    return ts_duration, "comfy_history", ts_descriptors


class TSGenerationTimingService:
    def __init__(self, ts_database, ts_output_directory: Path, ts_get_server, ts_interval_seconds: float = 15.0):
        self.ts_database = ts_database
        self.ts_output_directory = ts_output_directory.resolve()
        self.ts_get_server = ts_get_server
        self.ts_interval_seconds = max(5.0, min(300.0, float(ts_interval_seconds)))
        self.ts_stop_event = threading.Event()
        self.ts_thread: threading.Thread | None = None
        self.ts_processed_prompt_ids: dict[str, None] = {}
        self.ts_processed_limit = 2000
        self.ts_on_timing_recorded = None

    def TSStart(self) -> None:
        if self.ts_thread is not None and self.ts_thread.is_alive():
            return
        self.ts_stop_event.clear()
        ts_server = self.ts_get_server()
        ts_app = getattr(ts_server, "app", None) if ts_server else None
        ts_cleanup = getattr(ts_app, "on_cleanup", None)
        if ts_cleanup is not None:
            try:
                if self._TSAiohttpCleanup not in ts_cleanup:
                    ts_cleanup.append(self._TSAiohttpCleanup)
            except (AttributeError, RuntimeError):
                pass
        self.ts_thread = threading.Thread(target=self._TSRun, name="TSGenerationTiming", daemon=True)
        self.ts_thread.start()

    async def _TSAiohttpCleanup(self, _ts_app) -> None:
        await asyncio.to_thread(self.TSStop)

    def TSStop(self) -> None:
        self.ts_stop_event.set()
        if self.ts_thread is not None and self.ts_thread is not threading.current_thread():
            self.ts_thread.join(timeout=min(10.0, self.ts_interval_seconds + 1.0))

    def _TSRun(self) -> None:
        while not self.ts_stop_event.is_set():
            try:
                self.TSReconcileOnce()
            except Exception:
                TSLogVerbose("generation_timing.poll_failed")
            self.ts_stop_event.wait(self.ts_interval_seconds)

    def TSReconcileOnce(self) -> int:
        ts_server = self.ts_get_server()
        ts_queue = getattr(ts_server, "prompt_queue", None) if ts_server else None
        ts_get_history = getattr(ts_queue, "get_history", None)
        if not callable(ts_get_history):
            return 0
        try:
            ts_history = ts_get_history(max_items=TS_HISTORY_LIMIT)
        except TypeError:
            # In ComfyUI, the positional argument is prompt_id. Passing the
            # item limit positionally silently asks for the wrong history.
            try:
                ts_history = ts_get_history()
            except TypeError:
                return 0
        if not isinstance(ts_history, dict):
            return 0
        ts_changed = 0
        ts_candidates = []
        for ts_prompt_id, ts_entry in list(ts_history.items())[-TS_HISTORY_LIMIT:]:
            ts_prompt_id = str(ts_prompt_id)
            if not ts_prompt_id or len(ts_prompt_id) > TS_PROMPT_ID_MAX or ts_prompt_id in self.ts_processed_prompt_ids:
                continue
            ts_result = TSExtractSuccessfulPrompt(ts_entry)
            if ts_result is None:
                continue
            ts_duration, ts_source, ts_files = ts_result
            ts_success = self._TSGetExecutionSuccess(ts_entry)
            if ts_success is None:
                continue
            ts_candidates.append((ts_success, ts_prompt_id, ts_duration, ts_source, ts_files))
        # Newest first ensures same-path rapid re-renders get their newest
        # successful history attribution before stale history is considered.
        ts_candidates.sort(reverse=True, key=lambda item: item[0])
        for ts_success, ts_prompt_id, ts_duration, ts_source, ts_files in ts_candidates:
            for ts_file in ts_files:
                ts_relative = (Path(ts_file["subfolder"].replace("\\", "/")) / ts_file["filename"].replace("\\", "/")).as_posix()
                if Path(ts_relative).is_absolute() or any(part in {"..", "."} for part in Path(ts_relative).parts):
                    continue
                try:
                    ts_path = (self.ts_output_directory / ts_relative).resolve(strict=True)
                    ts_path.relative_to(self.ts_output_directory)
                    if not ts_path.is_file():
                        continue
                    ts_stat = ts_path.stat()
                except (OSError, ValueError):
                    continue
                # History includes old prompts, and filenames are often reused.
                # Attribute only when the current file mtime falls inside this
                # execution window, allowing for coarse (1–2s) filesystem clocks.
                ts_mtime_seconds = float(ts_stat.st_mtime)
                ts_start = ts_success - ts_duration
                if ts_mtime_seconds < ts_start - 2.5 or ts_mtime_seconds > ts_success + 2.5:
                    continue
                if self.ts_database.TSRecordGenerationTiming(
                    str(ts_path), int(ts_stat.st_size), int(ts_stat.st_mtime_ns), ts_duration, ts_source, ts_prompt_id, ts_success
                ):
                    ts_changed += 1
                    if callable(self.ts_on_timing_recorded):
                        try:
                            self.ts_on_timing_recorded(str(ts_path))
                        except Exception:
                            TSLogVerbose("generation_timing.update_emit_failed")
            self.ts_processed_prompt_ids[ts_prompt_id] = None
            while len(self.ts_processed_prompt_ids) > self.ts_processed_limit:
                self.ts_processed_prompt_ids.pop(next(iter(self.ts_processed_prompt_ids)))
        return ts_changed

    @staticmethod
    def _TSGetExecutionSuccess(ts_entry: dict[str, Any]) -> float | None:
        ts_status = ts_entry.get("status")
        ts_messages = ts_status.get("messages", []) if isinstance(ts_status, dict) else []
        for ts_message in reversed(ts_messages if isinstance(ts_messages, list) else []):
            if isinstance(ts_message, (list, tuple)) and len(ts_message) >= 2 and ts_message[0] == "execution_success":
                try:
                    ts_value = float(ts_message[1].get("timestamp")) / 1000.0
                except (AttributeError, TypeError, ValueError, OverflowError):
                    return None
                return ts_value if math.isfinite(ts_value) else None
        return None
