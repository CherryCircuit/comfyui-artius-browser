import tempfile
import os
import sqlite3
import json
import time
import unittest
from pathlib import Path

from tsab.ts_db import TSDatabase
from tsab.ts_db_query import TSBuildAssetQueryParts, TSResolveAssetFolderFilter, TSResolveSortKey
from tsab.ts_config import TSConfigStore
from tsab.ts_generation_timing import TSExtractSuccessfulPrompt, TSGenerationTimingService
from tsab.ts_indexer_payload import TSCarryExistingRowValues
from tsab.ts_types import TSAssetPayload
from tsab.ts_ui_settings import TSApplyUISettingsUpdates, TSNormalizeUISettings


class BrowserPreferenceTests(unittest.TestCase):
    def test_preference_defaults_and_validation_round_trip(self):
        ui = TSNormalizeUISettings({})
        self.assertEqual(ui["browser_preferences"]["appearance"], "finder")
        self.assertEqual(ui["browser_preferences"]["metadata_fields"]["image"], ["resolution", "generation_time"])
        TSApplyUISettingsUpdates(ui, {"browser_preferences": {
            "appearance": "classic", "corner_radius": 90,
            "visible_controls": ["root", "bogus"],
            "selection_actions": {"compare": False, "download": False, "delete": False},
            "inline_video_muted": False,
            "root_profiles": {"output": {"tsSortKey": "mtime", "tsFolder": "renders", "tsRecurse": False, "tsSearch": "swan", "ignored": True}},
        }})
        prefs = TSNormalizeUISettings(ui)["browser_preferences"]
        self.assertEqual(prefs["appearance"], "classic")
        self.assertEqual(prefs["corner_radius"], 24)
        self.assertEqual(prefs["visible_controls"], ["root"])
        self.assertEqual(prefs["selection_actions"], {"compare": False, "download": False, "delete": False})
        self.assertFalse(prefs["inline_video_muted"])
        self.assertEqual(prefs["root_profiles"]["output"], {"tsSortKey": "mtime", "tsFolder": "renders", "tsRecurse": False, "tsSearch": "swan"})

    def test_config_store_keeps_nested_browser_preferences(self):
        with tempfile.TemporaryDirectory() as directory:
            store = TSConfigStore(Path(directory) / "config.json")
            config = store.TSLoadConfig()
            config["ui"]["browser_preferences"] = {"appearance": "classic", "root_profiles": {"output": {"tsFolder": "renders"}}}
            saved = store.TSSaveConfig(config)
            self.assertEqual(saved["ui"]["browser_preferences"]["appearance"], "classic")
            self.assertEqual(store.TSLoadConfig()["ui"]["browser_preferences"]["root_profiles"]["output"]["tsFolder"], "renders")


class GenerationTimingTests(unittest.TestCase):
    def test_successful_batch_and_rebuild_durability_and_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            database = TSDatabase(Path(directory) / "assets.db")
            self.assertTrue(database.TSRecordGenerationTiming("/out/a.png", 10, 100, 2.5, "comfy_history", "prompt-a", 10))
            # Same fingerprint refresh cannot replace the original attribution.
            self.assertFalse(database.TSRecordGenerationTiming("/out/a.png", 10, 100, 9, "comfy_history", "prompt-b", 9))
            row = database.TSGetConnection().execute("SELECT generation_time_seconds,generation_prompt_id FROM asset_generation_provenance").fetchone()
            self.assertEqual(tuple(row), (2.5, "prompt-a"))
            self.assertTrue(database.TSRecordGenerationTiming("/out/a.png", 11, 101, 4, "comfy_history", "prompt-c", 11))
            row = database.TSGetConnection().execute("SELECT generation_time_seconds,generation_prompt_id FROM asset_generation_provenance").fetchone()
            self.assertEqual(tuple(row), (4.0, "prompt-c"))
            database.TSResetIndex()
            database = TSDatabase(Path(directory) / "assets.db")
            row = database.TSGetConnection().execute("SELECT generation_time_seconds,generation_prompt_id FROM asset_generation_provenance").fetchone()
            self.assertEqual(tuple(row), (4.0, "prompt-c"))

    def test_schema_13_database_migrates_without_losing_assets_or_fts(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "legacy.db"
            database = TSDatabase(path)
            connection = database.TSGetConnection()
            connection.execute("INSERT INTO asset_roots(root_key,scope) VALUES('output','output')")
            root_id = connection.execute("SELECT id FROM asset_roots WHERE root_key='output'").fetchone()[0]
            connection.execute("INSERT INTO asset_types(type_key) VALUES('image')")
            type_id = connection.execute("SELECT id FROM asset_types WHERE type_key='image'").fetchone()[0]
            connection.execute("INSERT INTO asset_extensions(extension_key) VALUES('.png')")
            ext_id = connection.execute("SELECT id FROM asset_extensions WHERE extension_key='.png'").fetchone()[0]
            connection.execute("INSERT INTO asset_folders(root_lookup_id,folder_path) VALUES(?, '')", (root_id,))
            folder_id = connection.execute("SELECT id FROM asset_folders WHERE root_lookup_id=?", (root_id,)).fetchone()[0]
            connection.execute("""INSERT INTO assets(path,filename,created_at,type_lookup_id,extension_lookup_id,root_lookup_id,folder_lookup_id)
                                  VALUES('/output/legacy.png','legacy.png',123,?,?,?,?)""", (type_id, ext_id, root_id, folder_id))
            asset_id = connection.execute("SELECT id FROM assets WHERE path='/output/legacy.png'").fetchone()[0]
            connection.execute("INSERT INTO assets_fts(rowid,filename,prompt_text,model_text) VALUES(?,?,?,?)", (asset_id, "legacy.png", "legacy prompt", ""))
            connection.execute("DROP VIEW assets_view")
            connection.execute("DROP TABLE asset_generation_provenance")
            connection.execute("PRAGMA user_version=13")
            connection.close()

            upgraded = TSDatabase(path)
            row = upgraded.TSGetConnection().execute("SELECT filename,created_at,generation_time_seconds FROM assets_view WHERE id=?", (asset_id,)).fetchone()
            self.assertEqual(tuple(row), ("legacy.png", 123, None))
            fts_row = upgraded.TSGetConnection().execute("SELECT rowid FROM assets_fts WHERE assets_fts MATCH 'legacy'").fetchone()
            self.assertEqual(fts_row[0], asset_id)

    def test_only_successful_known_execution_is_timed(self):
        history = {"status": {"messages": [
            ["execution_start", {"timestamp": 1_000}],
            ["execution_cached", {"nodes": []}],
            ["execution_success", {"timestamp": 3_500}],
        ]}, "outputs": {"9": {"images": [{"filename": "a.png", "subfolder": "", "type": "output"}]}}}
        self.assertEqual(TSExtractSuccessfulPrompt(history)[:2], (2.5, "comfy_history"))
        failed = {"status": {"messages": [["execution_start", {"timestamp": 1000}]]}, "outputs": {}}
        self.assertIsNone(TSExtractSuccessfulPrompt(failed))
        cached_upstream = {"status": {"messages": [["execution_start", {"timestamp": 1000}], ["execution_cached", {"nodes": ["1"]}], ["execution_success", {"timestamp": 2000}]]},
                           "outputs": {"9": {"images": [{"filename": "new.png", "subfolder": "", "type": "output"}]}}}
        self.assertEqual(len(TSExtractSuccessfulPrompt(cached_upstream)[2]), 1)
        mixed = {"status": {"messages": [["execution_start", {"timestamp": 1000}], ["execution_cached", {"nodes": ["9"]}], ["execution_success", {"timestamp": 2000}]]},
                 "outputs": {"9": {"images": [{"filename": "old.png", "subfolder": "", "type": "output"}]},
                             "10": {"images": [{"filename": "new.png", "subfolder": "", "type": "output"}]}}}
        self.assertEqual([f["filename"] for f in TSExtractSuccessfulPrompt(mixed)[2]], ["new.png"])

    def test_history_reconciliation_records_batch_under_output_root(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ("a.png", "b.png", "cached.png"):
                (root / name).write_bytes(b"image")

            class Database:
                def __init__(self):
                    self.records = []

                def TSRecordGenerationTiming(self, *args):
                    self.records.append(args)
                    return True

            now_ms = int(time.time() * 1000)
            for name in ("a.png", "b.png", "cached.png"):
                os.utime(root / name, (now_ms / 1000, now_ms / 1000))
            entry = {"status": {"messages": [["execution_start", {"timestamp": now_ms - 3250}], ["execution_cached", {"nodes": ["8"]}], ["execution_success", {"timestamp": now_ms}]]},
                     "outputs": {"9": {"images": [{"filename": "a.png", "subfolder": "", "type": "output"}, {"filename": "b.png", "subfolder": "", "type": "output"}]}}}
            entry["outputs"]["8"] = {"images": [{"filename": "cached.png", "subfolder": "", "type": "output"}]}

            class Queue:
                def get_history(self, max_items):
                    return {"prompt-id": entry}

            database = Database()
            service = TSGenerationTimingService(database, root, lambda: type("Server", (), {"prompt_queue": Queue()})())
            self.assertEqual(service.TSReconcileOnce(), 2)
            self.assertEqual([record[3] for record in database.records], [3.25, 3.25])
            self.assertTrue(all(record[5] == "prompt-id" for record in database.records))
            self.assertTrue(all(not record[0].endswith("cached.png") for record in database.records))

    def test_stale_history_cannot_claim_overwritten_file_and_service_restarts(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / "a.png"
            output.write_bytes(b"new")
            now = time.time()
            os.utime(output, (now, now))
            old_ms = int((now - 120) * 1000)
            stale_entry = {"status": {"messages": [["execution_start", {"timestamp": old_ms - 5000}], ["execution_success", {"timestamp": old_ms}]]},
                           "outputs": {"9": {"images": [{"filename": "a.png", "subfolder": "", "type": "output"}]}}}

            class Database:
                def __init__(self):
                    self.records = []

                def TSRecordGenerationTiming(self, *args):
                    self.records.append(args)
                    return True

            class Queue:
                def get_history(self, max_items):
                    return {"stale": stale_entry}

            database = Database()
            service = TSGenerationTimingService(database, root, lambda: type("Server", (), {"prompt_queue": Queue()})())
            self.assertEqual(service.TSReconcileOnce(), 0)
            self.assertEqual(database.records, [])
            service.TSStart()
            service.TSStop()
            service.TSStart()
            service.TSStop()


class AssetQueryTests(unittest.TestCase):
    def test_existing_linux_ctime_value_is_preserved_without_birthtime(self):
        payload = TSAssetPayload(ts_path="/x.png", ts_type="image", ts_created_at=222)
        row = {"created_at": 111}
        self.assertEqual(TSCarryExistingRowValues(payload, row, ts_reset_processing=False).ts_created_at, 111)
        payload.ts_creation_time_is_birthtime = True
        self.assertEqual(TSCarryExistingRowValues(payload, row, ts_reset_processing=False).ts_created_at, 222)

    def test_exact_root_folder_and_mtime_sort(self):
        _, where, values, _ = TSBuildAssetQueryParts(ts_filters={"folder": "", "recurse": False})
        self.assertIn("assets_view.folder_path = ''", where)
        self.assertEqual(values, [])
        _, where, values, _ = TSBuildAssetQueryParts(ts_filters={"folder": "renders", "recurse": False})
        self.assertIn("assets_view.folder_path = ?", where)
        self.assertEqual(values, ["renders"])
        self.assertEqual(TSResolveSortKey("mtime"), "mtime")

    def test_root_recursive_and_exact_folder_query_semantics(self):
        connection = sqlite3.connect(":memory:")
        connection.execute("CREATE TABLE assets_view(folder_path TEXT, is_companion_image INTEGER)")
        connection.executemany("INSERT INTO assets_view VALUES(?,0)", [("",), ("renders",), ("renders/final",)])

        def folders(filters):
            from_sql, where_sql, parameters, _ = TSBuildAssetQueryParts(ts_filters=filters)
            return [row[0] for row in connection.execute(f"SELECT folder_path FROM {from_sql}{where_sql}", parameters)]

        recursive_root = TSResolveAssetFolderFilter(None, "tree", True)
        exact_root = TSResolveAssetFolderFilter(None, "tree", False)
        self.assertIsNone(recursive_root)
        self.assertEqual(exact_root, "")
        self.assertCountEqual(folders({"folder": recursive_root, "recurse": True}), ["", "renders", "renders/final"])
        self.assertEqual(folders({"folder": exact_root, "recurse": False}), [""])
        # Flat requests omit folder entirely. recurse=False must not narrow them.
        flat_folder = TSResolveAssetFolderFilter(None, "flat", False)
        self.assertIsNone(flat_folder)
        self.assertCountEqual(folders({"folder": flat_folder, "recurse": False}), ["", "renders", "renders/final"])

    def test_mtime_keyset_pages_survive_javascript_precision_and_ties(self):
        with tempfile.TemporaryDirectory() as directory:
            database = TSDatabase(Path(directory) / "mtime.db")
            base = 1_700_000_000_000_000_000
            mtimes = [base, base + 1, base + 1, base + 2, base + 3]
            for index, mtime in enumerate(mtimes):
                database._TSDoUpsertAsset(TSAssetPayload(
                    ts_path=f"/output/{index}.png", ts_type="image", ts_filename=f"{index}.png",
                    ts_extension=".png", ts_root_id="output", ts_scope="output", ts_mtime_ns=mtime,
                ))
            connection = database.TSGetConnection()
            all_paths = {
                direction: [row[0] for row in connection.execute(
                    f"SELECT path FROM assets_view ORDER BY mtime_ns {direction.upper()}, id {direction.upper()}"
                )]
                for direction in ("asc", "desc")
            }
            for direction in ("asc", "desc"):
                cursor = None
                observed = []
                while True:
                    rows, has_more, cursor = database.TSQueryAssetsPage(
                        ts_filters={"sort_key": "mtime", "sort_direction": direction},
                        ts_cursor_after=cursor,
                        ts_limit=2,
                    )
                    observed.extend(row["path"] for row in rows)
                    if not has_more:
                        break
                    self.assertIsInstance(cursor["sort_value"], str)
                    # JS parses JSON numbers as IEEE-754 doubles. The mtime
                    # cursor remains a decimal string through that same wire round trip.
                    original_sort_value = cursor["sort_value"]
                    cursor = json.loads(json.dumps(cursor), parse_int=float)
                    self.assertEqual(cursor["sort_value"], original_sort_value)
                self.assertEqual(observed, all_paths[direction])
                self.assertEqual(len(observed), len(set(observed)))


if __name__ == "__main__":
    unittest.main()
