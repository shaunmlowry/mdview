# mdview

A focused Tauri desktop app for reading, editing, and exporting Markdown. Mermaid code fences render as diagrams in the live preview and as inline SVG in standalone HTML exports.

## Features

- Open Markdown from the command line, native **File -> Open** menu, toolbar, or drag and drop.
- Render tables, task lists, syntax-highlighted code, raw HTML, local images, and Mermaid diagrams.
- Keep the editor hidden by default or toggle a side-by-side CodeMirror editor with Vim bindings.
- Save source changes with `Cmd/Ctrl+S`.
- Export self-contained rendered HTML with Mermaid diagrams already converted to SVG.
- Export PDF through the platform print dialog and its **Save as PDF** destination.
- Install a `mdview` terminal command with the macOS package installer.

## Development

Prerequisites are the [Tauri 2 system dependencies](https://v2.tauri.app/start/prerequisites/), Node.js, npm, and Rust.

```sh
npm install
npm run tauri dev
```

Open a file from the command line in development:

```sh
npm run tauri -- dev -- -- examples/showcase.md
```

Run the web surface alone at `http://localhost:1420`:

```sh
npm run dev
```

## macOS package

Build an installer that places the app in `/Applications` and the `mdview` command in `/usr/local/bin`:

```sh
npm run package:macos
open src-tauri/target/release/bundle/pkg/mdview_0.1.0_arm64.pkg
```

After installation, open Markdown from any shell without waiting for the desktop app to exit:

```sh
mdview README.md
```

The DMG remains available for drag-and-drop app installation, but only the PKG installs the command-line launcher.

## Verification

```sh
npm test
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
npm run tauri build
npm run package:macos
```

## Shortcuts

| Action | Shortcut |
| --- | --- |
| Open | `Cmd/Ctrl+O` |
| Save Markdown | `Cmd/Ctrl+S` |
| Toggle editor | `Cmd/Ctrl+E` |

In the editor, press `i` to enter Vim insert mode and `Esc` to return to normal mode.
