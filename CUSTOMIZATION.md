# Finder interface and customization

This fork uses natural-proportion thumbnails and a compact icon toolbar by
default. Open the gear beside **?** to customize the panel. Preferences are
saved with the browser's existing settings, and the **Classic** preset restores
the traditional card presentation.

- **Finder** keeps thumbnails uncropped inside equally sized, transparent
  cells. Change icon size with the size slider; unused horizontal space is
  distributed between columns as the sidebar resizes.
- **Toolbar** controls can be shown or hidden independently of the media
  filters. The ellipsis contains controls that do not fit. Icons have tooltips;
  text labels are also available.
- **Captions** can include filenames and a different selection of metadata for
  each media type. Choose plain text, badges, hover details, or hidden metadata.
  Corner radius, background, borders, and layout animation are configurable.
- **Inline video** starts with the play button on a thumbnail. Only one preview
  plays at a time. Muting and looping are configurable; playback is released
  when the preview leaves the view or the panel closes. Unsupported formats use
  the existing on-demand display conversion and require FFmpeg.
- **Selection actions** appear when assets are selected. Original downloads,
  ZIP download, compare, and system-trash deletion continue to use the existing
  backend behavior.
- **Navigation** includes folder breadcrumbs, back/forward/up, per-root view
  preferences, current-folder-only browsing, and Modified date sorting.
- **Quick Look** opens the selected asset with Space and closes with Space
  again. Normal video playback retains its Space play/pause shortcut.
- **Viewer** information can be collapsed using its Info button or **I**. Video
  size modes are Fit, 1:1, and Centered. Video comparison supports the existing
  split layout and a wipe layout with draggable, keyboard-adjustable dividers.

## Generation time

`Gen 02:17` is elapsed successful **workflow execution time**, excluding queue
wait. It includes model loading and saving; it is not per-image inference time.
New output files from the same batch share the workflow duration. `Dur` is the
media's playback length and remains a separate field.

A server-side collector checks recent ComfyUI execution history approximately
every 15 seconds, even while the sidebar is closed. It filters cached output
nodes and validates output paths and file timestamps before recording timing.
Records are matched to file size and modification time and survive cache
rebuilds. Replacing a file invalidates its old timing.

Files whose execution history is unavailable have no generation-time badge.
Rescanning cannot recover timing from ordinary image/video timestamps. Retained
successful history can backfill matching files; cached files are not reassigned
the duration of a later cached run. Originals are never rewritten to add tags.

## Development and isolated verification

Use Python 3.10 or newer, as required by the extension. No running ComfyUI
installation is required for these checks:

```sh
npm ci
npx playwright install chromium
npm test
npm run test:browser
python3 -m unittest discover -s tests -p 'backend_*.py' -v
python3 -m compileall -q tsab __init__.py
```

`npm run harness` serves an isolated interactive preview at
`http://127.0.0.1:8877`. It loads the actual frontend modules, a small animated
WebM fixture, and a generated library of mixed-proportion fixture assets. The
ComfyUI APIs are stubbed; settings round-trip through the real Python settings
normalizer. It neither starts ComfyUI nor reads the user's media. Set `PORT` to
change its port, or `PYTHON` to choose its Python executable.

The browser regression runner saves screenshots under `tests/artifacts/`
(ignored by Git). If Playwright is already bundled elsewhere, set
`PLAYWRIGHT_MODULE` to its installed module directory. Runtime packaging excludes
tests and Node dependencies through `.comfyignore`.

The harness exercises UI behavior and fixture API boundaries. Native ComfyUI
canvas loaders, the installed 3D viewer, and actual GPU generation still need a
smoke check in a real installation before a release.
