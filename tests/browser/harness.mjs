import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const fixtureVideo = new URL("./fixtures/preview.webm", import.meta.url);
function normalizeSettings(ui) {
    const result = spawnSync(process.env.PYTHON || "python3", ["-c", "import json,sys; from tsab.ts_ui_settings import TSNormalizeUISettings; print(json.dumps(TSNormalizeUISettings(json.load(sys.stdin))))"], {
        cwd: root, input: JSON.stringify(ui), encoding: "utf8",
    });
    if (result.status !== 0) throw new Error(result.stderr || "Python settings normalizer failed");
    return JSON.parse(result.stdout);
}
const roots = [
    { root_id: "output", label: "Output", scope: "output", allow_delete: true },
    { root_id: "input", label: "Input", scope: "input", allow_delete: true },
];

export function createFixtureAssets(count = 1800) {
    return Array.from({ length: count }, (_, index) => {
        const id = index + 1;
        const type = index % 6 === 1 || index % 6 === 3 ? "video" : index % 17 === 16 ? "audio" : "image";
        const [width, height] = type === "video" ? [320, 180] : [[1448, 1086], [800, 1200], [1200, 800], [1024, 1024], [2464, 1056]][index % 5];
        const extension = type === "video" ? ".webm" : type === "audio" ? ".wav" : ".png";
        const root_id = id > 1500 ? "input" : "output";
        const folder_path = id <= 12 ? "" : id % 3 === 0 ? "sessions/portraits" : id % 3 === 1 ? "sessions" : "landscapes";
        return {
            id, type, filename: `${type === "video" ? "Motion" : type === "audio" ? "Audio" : "Generation"}_${String(id).padStart(5, "0")}${extension}`,
            extension, width, height, root_id, folder_path, scope: root_id,
            path: `/fixture/${root_id}/${folder_path}/${id}${extension}`, size_bytes: 102400 + id * 731,
            preview_url: `/fixture/preview/${id}.svg?w=${width}&h=${height}`,
            file_url: type === "video" ? "/fixture/preview.webm" : `/fixture/preview/${id}.svg?w=${width}&h=${height}`,
            display_url: type === "video" ? "/fixture/preview.webm" : `/fixture/preview/${id}.svg?w=${width}&h=${height}`,
            display_mode: "native", duration: type === "image" ? null : 2, fps: type === "video" ? 12 : null,
            generation_time_seconds: id % 7 ? 137 + id : null,
            generation_time_source: "comfy_history", generation_prompt_id: `fixture-${id}`,
            allow_delete: true, is_indexed: true, has_preview: true, has_metadata: true,
            has_workflow: true, has_prompt: true, is_favorite: id % 9 === 0,
            preview_is_placeholder: false, status: "ready", detail_loaded: false,
        };
    });
}

export async function startHarness({ port = 0, count = 1800 } = {}) {
    const state = {
        assets: createFixtureAssets(count), requests: [],
        settings: { ui: { autoscan: false, browser_section: "assets", asset_view_mode: "flat", selected_root_id: "output", asset_preview_size: 160 } },
    };
    state.settings.ui = normalizeSettings(state.settings.ui);
    const server = http.createServer(async (request, response) => {
        try {
            const url = new URL(request.url, "http://localhost");
            const send = (data, type = "application/json", status = 200) => {
                response.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
                response.end(type === "application/json" ? JSON.stringify(data) : data);
            };
            const body = async () => {
                let text = "";
                for await (const chunk of request) text += chunk;
                return text ? JSON.parse(text) : {};
            };
            if (url.pathname.startsWith("/asset_browser/")) state.requests.push({ method: request.method, url: url.pathname + url.search });
            if (url.pathname === "/") return send(`<!doctype html><html><head><meta charset="utf-8"><title>Artius Browser — isolated harness</title><style>
                :root { color-scheme:dark; font-family:system-ui,sans-serif; background:#181818; color:#eee; --comfy-menu-bg:#222; --comfy-input-bg:#333; --content-bg:#3a3a3a; --input-text:#eee; --fg-color:#eee; --border-color:#555; --descrip-text:#bbb; --p-button-primary-background:#a596db; --p-button-primary-color:#181818; }
                * { box-sizing:border-box; } body { margin:0; } #mount { width:760px; max-width:100vw; height:900px; max-height:100vh; background:#242424; }
                ts-artius-browser-panel { width:100%; height:100%; } #graph-canvas { display:none; }
                </style></head><body><div id="mount"></div><canvas id="graph-canvas"></canvas><script type="module">
                import { tsGetPanelSingleton } from '/js/ts-artius-browser-panel.js';
                window.panel = tsGetPanelSingleton(); document.getElementById('mount').append(window.panel);
                </script></body></html>`, "text/html");
            if (url.pathname === "/scripts/api.js") return send(`export const api = new EventTarget(); api.apiURL = p => p; api.fetchApi = (p,o) => fetch(p,o); window.fixtureApi = api;`, "text/javascript");
            if (url.pathname === "/scripts/app.js") return send(`const canvas=document.getElementById('graph-canvas'); export const app={extensionManager:{setting:{get:()=> 'en'},toast:{add:()=>{}}},canvas:{canvas,graph:{_nodes:[]}},graph:{_nodes:[]},loadGraphData:async data=>{window.loadedGraph=data}}; window.fixtureApp=app;`, "text/javascript");
            if (url.pathname === "/asset_browser/settings") {
                if (request.method === "POST") { const data = await body(); state.settings.ui = normalizeSettings({ ...state.settings.ui, ...data.ui }); }
                return send(state.settings);
            }
            if (url.pathname === "/asset_browser/version") return send({ local: "1.20.1", update_available: false });
            if (url.pathname === "/asset_browser/search" || url.pathname === "/asset_browser/assets") {
                const p = url.searchParams;
                let assets = state.assets.filter(a => !p.get("root_id") || a.root_id === p.get("root_id"));
                const q = p.get("q")?.toLowerCase();
                if (q) assets = assets.filter(a => a.filename.toLowerCase().includes(q));
                if (p.get("types")) assets = assets.filter(a => p.get("types").split(",").includes(a.type));
                if (p.get("favorites")) assets = assets.filter(a => a.is_favorite);
                if (p.get("view") === "tree") {
                    const folder = p.get("folder") || "";
                    if (p.get("recurse") === "0") assets = assets.filter(a => a.folder_path === folder);
                    else if (folder) assets = assets.filter(a => a.folder_path === folder || a.folder_path.startsWith(folder + "/"));
                }
                const byId = Number(p.get("after_id") || 0);
                const start = byId ? assets.findIndex(a => a.id === byId) + 1 : 0;
                const limit = Math.min(500, Number(p.get("limit") || 60));
                const items = assets.slice(start, start + limit);
                const folderMap = new Map();
                for (const a of state.assets) {
                    const key = `${a.root_id}:${a.folder_path}`;
                    const entry = folderMap.get(key) || { root_id: a.root_id, folder_path: a.folder_path, asset_count: 0 };
                    entry.asset_count++; folderMap.set(key, entry);
                }
                return send({ items, has_more: start + items.length < assets.length, next_cursor: items.length ? { id: items.at(-1).id, sort_value: items.at(-1).id } : null,
                    roots, folders: [...folderMap.values()], health: [], scan_status: null });
            }
            if (/^\/asset_browser\/asset\/\d+$/.test(url.pathname)) {
                const asset = state.assets.find(a => a.id === Number(url.pathname.split("/").at(-1)));
                return send({ ...asset, detail_loaded: true, prompt_text: "A deterministic test scene", workflow_text: "{\"nodes\":[]}", models: ["fixture-model"], seed: "42", technical_info: { width: asset?.width, height: asset?.height, duration: asset?.duration, fps: asset?.fps } });
            }
            if (/^\/asset_browser\/favorite\/\d+$/.test(url.pathname)) {
                const data = await body(); const asset = state.assets.find(a => a.id === Number(url.pathname.split("/").at(-1)));
                asset.is_favorite = Boolean(data.favorite); return send({ asset });
            }
            if (url.pathname === "/asset_browser/delete") {
                const data = await body(); state.assets = state.assets.filter(a => !data.ids.includes(a.id)); return send({ deleted: data.ids, missing: [] });
            }
            if (url.pathname === "/asset_browser/3d/viewer") return send({});
            if (url.pathname.startsWith("/asset_browser/")) return send({ ok: true });
            if (url.pathname === "/v2/userdata") return send([{ path: "workflows/example.json", modified: "2026-10-22T00:00:00Z", size: 25 }]);
            if (url.pathname.startsWith("/userdata/")) return send({ nodes: [] });
            if (url.pathname === "/fixture/preview.webm") {
                const buffer = await readFile(fixtureVideo); const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range || "");
                const start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(buffer.length - 1, Number(range[2])) : buffer.length - 1;
                response.writeHead(range ? 206 : 200, { "Content-Type": "video/webm", "Accept-Ranges": "bytes", "Content-Length": end - start + 1, ...(range ? { "Content-Range": `bytes ${start}-${end}/${buffer.length}` } : {}) });
                return response.end(buffer.subarray(start, end + 1));
            }
            if (url.pathname.startsWith("/fixture/preview/")) {
                const w = Number(url.searchParams.get("w") || 320), h = Number(url.searchParams.get("h") || 180);
                const id = Number(url.pathname.match(/\d+/)?.[0] || 1), hue = (id * 37) % 360;
                return send(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 600 400" preserveAspectRatio="none"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="hsl(${hue} 55% 38%)"/><stop offset="1" stop-color="hsl(${(hue + 70) % 360} 60% 12%)"/></linearGradient></defs><path fill="url(#g)" d="M0 0h600v400H0z"/><circle cx="430" cy="90" r="45" fill="hsl(${hue} 60% 80%)"/><path d="M0 340 150 130 290 310 430 175 600 360V400H0z" fill="hsl(${hue} 25% 18%)"/><text x="24" y="365" fill="white" font-family="sans-serif" font-size="28">${String(id).padStart(4, "0")}</text></svg>`, "image/svg+xml");
            }
            const filePath = path.resolve(root, "." + decodeURIComponent(url.pathname));
            if (!filePath.startsWith(root + path.sep) || !url.pathname.startsWith("/js/")) return send({ error: "Not found" }, "application/json", 404);
            const contents = await readFile(filePath);
            return send(contents, filePath.endsWith(".json") ? "application/json" : "text/javascript");
        } catch (error) {
            response.writeHead(500); response.end(String(error.stack || error));
        }
    });
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
    return { state, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const harness = await startHarness({ port: Number(process.env.PORT || 8877) });
    console.log(`Isolated Artius harness: ${harness.url}`);
}
