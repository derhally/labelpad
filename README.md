# Niimbot Studio

A modern desktop app for designing and printing labels on the **Niimbot D11** Bluetooth label printer. Runs on Windows, macOS and Linux.

Built with Electron, React and TypeScript, on top of [niimbluelib](https://github.com/MultiMote/niimbluelib) for the printer protocol.

## Getting started

Requires Node.js 22 or newer.

```bash
npm install
npm run dev
```

Turn on the D11, click **Connect printer**, and pick it from the list. You don't need to pair it in your system's Bluetooth settings first.

### Linux

Bluetooth needs BlueZ, and your user must be allowed to use it (usually by being in the `bluetooth` group).

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the app with hot reload |
| `npm run build` | Build the app into `out/` |
| `npm run typecheck` | Type-check the whole project |

## Roadmap

1. Connect over Bluetooth and print a test label
2. Label editor: text, images, barcodes, QR codes and icons
3. Save and open labels, settings, light and dark themes
4. Installers and CI for Windows, macOS and Linux
