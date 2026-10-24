# Niimbot Studio

A modern desktop app for designing and printing labels on the **Niimbot D11** Bluetooth label printer. Runs on Windows, macOS and Linux.

Built with [Tauri 2](https://tauri.app): a React + TypeScript label editor in the system webview, and a Rust backend that talks to the printer over Bluetooth LE ([btleplug](https://github.com/deviceplug/btleplug)). The Niimbot protocol in `src-tauri/niimbot` is a Rust port of [niimbluelib](https://github.com/MultiMote/niimbluelib), tested byte for byte against it.

## Getting started

Requires Node.js 22+, [Rust](https://rustup.rs) (stable), and the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your OS. On Windows that's the MSVC build tools and WebView2, which Windows 10/11 already include.

```bash
npm install
npm run dev
```

Turn on the D11, click **Connect printer**, and pick it from the list. You don't need to pair it in your system's Bluetooth settings first.

## How it's built

| Path | What it is |
| --- | --- |
| `src/renderer` | React UI: the label editor and its 1-bit renderer |
| `src-tauri/src` | Tauri app: commands the UI calls (`scan_start`, `printer_connect`, `printer_print`, …) |
| `src-tauri/niimbot` | Printer protocol: packets, image encoding, print jobs and the Bluetooth transport |
| `scripts/gen-niimbot.cjs` | Regenerates the printer model table and the reference test fixtures from niimbluelib |

## Designing labels

Add text, dates, images, barcodes, QR codes, icons and shapes from the left toolbar, then drag, resize and rotate them on the label. Everything snaps to the label edges, its centre and other elements. The preview is the exact 1-bit image that's sent to the printer.

- **Text** can use any font installed on your computer, aligned left, centre or right and top, middle or bottom. "Browse" shows every font with your label's text, filtered by style (sans serif, serif, monospace, handwriting, display).
- **Date** prints the date and/or time when the label is printed: date + time, date only, or time only. Dates use a format you pick (or your own pattern such as `DD/MM/YYYY`), and times are 12- or 24-hour. "Add days" makes use-by labels.
- **Files**: labels save as `.niimbot` files (JSON). The label you were working on reopens when the app starts; turn that off in Settings.
- **Templates**: New (Ctrl+N) offers a blank label, built-in templates, and any label you saved with "Save as template". Templates live in the app's data folder.
- **Settings** (gear icon): light, dark or system theme. Darkness, copies, label size and the last printer are remembered.

| Shortcut | Action |
| --- | --- |
| Ctrl+N | New label from a template |
| Ctrl+O | Open a label |
| Ctrl+S / Ctrl+Shift+S | Save / save as |
| Ctrl+Z / Ctrl+Shift+Z | Undo / redo |
| Ctrl+D | Duplicate |
| Delete | Remove |
| Arrow keys | Nudge 1 dot (Shift: 1 mm) |
| Ctrl+P | Print |
| Esc | Deselect |

### Linux

Bluetooth needs BlueZ, and your user must be allowed to use it (usually by being in the `bluetooth` group). Building needs `libwebkit2gtk-4.1-dev` and `libdbus-1-dev`.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the app with hot reload |
| `npm run build` | Build an installer for this OS |
| `npm test` | Run the Rust protocol tests |
| `npm run typecheck` | Type-check the UI |

## Roadmap

1. Connect over Bluetooth and print a test label
2. Label editor: text, images, barcodes, QR codes and icons
3. Save and open labels, templates, date/time, settings, light and dark themes
4. Installers and CI for Windows, macOS and Linux
