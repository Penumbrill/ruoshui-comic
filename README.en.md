# Ruoshui Comic · 若水漫画

[简体中文](README.md) · [Downloads / Releases](https://github.com/Penumbrill/ruoshui-comic/releases)

A local AI comic creation studio for Windows, combining image generation, masked inpainting, panel layouts, dialogue, typography, stickers and cutouts extending beyond panel borders.

## Installation

Download **`ruoshui-comic.exe`** from Releases. The small online installer downloads application and independent runtime packages from this repository's GitHub Release, verifies SHA-256 checksums, then extracts them into your chosen folder. It tries environment proxies, Windows networking and direct connections, with GitHub's download URL and asset API as alternative sources. It does not change system proxy settings. Run it again to resume interrupted downloads. Online installation requires internet access.

The directory page lets you choose another drive, such as D: or E:. Installation adds the application folder to the current user's PATH. Open a new terminal to run `若水漫画.exe` directly. Uninstall removes only the PATH entry added by this installer and preserves existing entries.

The desktop application also checks and repairs PATH automatically at launch, including portable launches. Settings → Environment shows its status and offers a check-and-repair button. Bundled tools are automatically added to the application's own process environment.

**Offline portable installation:** download `ruoshui-comic-update-win-x64.zip` and **all** `ruoshui-runtime-win-x64-*.zip` files from the same Release. Extract every ZIP into the **same empty folder**, preserving relative paths, then launch `若水漫画.exe`. Each is an ordinary, independently extractable ZIP, not a split archive. The program ZIP alone does not contain the AI runtime. `ruoshui-setup-guide.zip` contains bilingual instructions, a package manifest and verification tools. To verify original ZIPs, place them beside the extracted guide files and run `校验整合包.cmd`.

**No model weights, personal artwork or settings are bundled.** The complete runtime still requires roughly 3 GB of downloads and approximately 5 GB after extraction, plus temporary installation space. Models require additional storage. Choose a writable, dedicated folder; do not install into another application or a source checkout.

## Getting started

1. Check your GPU, drivers and runtime under Settings.
2. Download or import image models in the model manager. Downloads are stored beneath the **current application folder** in `runtime/ComfyUI/models`, grouped by category. Assistant models use its `llm` subfolder. Moving the portable folder changes the destination of subsequent downloads.
3. Standalone generation and inpainting save their own results without adding them to a comic. Only generation or inpainting explicitly opened for a particular panel fills that panel automatically.
   Use **Upload image** or **Choose from gallery** in the preview header, or drop PNG/JPG/WebP files directly onto the preview. Switching to a new source clears its old mask.
4. Add panels, images, dialogue and stickers in the comic editor. Panels support 3–32 sides; subject cutouts support edge refinement, border overflow and alignment to their original image.
5. Export PNG pages into `works/exports/Project name`, then use the adjacent button to open that folder. Editable project exports embed images and imported fonts.

## Editing controls

- Image previews: wheel to zoom, double-click to fit. The main comic canvas uses **Ctrl + wheel**. Refinement brushes have circular cursors.
- Numeric fields, coordinates, dimensions and font sizes: wheel to adjust; Shift increases the step. Individual reset controls and reset-all in Settings restore defaults.
- Typography: horizontal or vertical writing, bold, italic, underline and alignment. Includes 24 Chinese and English fonts, system font selection, and TTF/OTF/WOFF/WOFF2 import into `works/fonts`.
- Layers: click empty space to deselect. Compact context menus provide deletion, movement within groups and across layer types. Multiple dialogue bubbles can be linked or unlinked.
- Dialog headings scroll with their contents; only the close button stays visible. Clicking outside saves valid edits and closes dialogs, except downloads. Clicking outside a destructive confirmation cancels it.
- Panel previews retain the full image with an optional translucent panel reference overlay and adjustable opacity.
- Fuzzy search is supported for dictionaries and assets. The initial editable tag dictionary contains 11 categories, 133 groups and 3,957 entries, with favorites and JSON/SQL import and export.

The prompt assistant supports local language models and optional online APIs. Image input requires a matching visual projection model. Consult the model manager for model identifiers, downloads and terms. Online APIs require your own key.

## Data and maintenance

Personal artwork, settings, chats, dictionaries, autosaves, logs and caches live in **`works`** beside the application. Independent runtimes and models live in **`runtime`**. Move the whole folder when relocating the application; back up `works` and any models you wish to keep.

Gallery deletion also moves associated parameters, masks and dedicated drafts into recovery storage. Restore them together. Images already embedded in comic projects remain available.

Settings provides update checks, cache cleanup and uninstall controls. Program updates preserve data and models. Runtime upgrades require the matching Release runtime ZIPs or rerunning the installer. Uninstall asks whether to retain artwork and models.

## Development

```powershell
npm ci
npm run dev
npm test
npm run build
```

The source repository excludes runtimes and weights. Extract Release runtime ZIPs at the repository root or prepare the independent runtime in Settings for generation. Current artifacts target Windows x64.

After explicit packaging authorization, run `node scripts/online-release.mjs --approved` on Windows with the project's `runtime` already prepared. This builds assets without publishing. Output goes to sibling folders `manhua-发布/纯净整合包` and `manhua-发布/安装版`; staging files and test data remain under `works`.

## Licensing

Original project code uses the [MIT license](LICENSE). Third-party code, fonts, tag data and runtime components retain their respective licenses. Models have separate terms. Required notices and provenance are preserved in [Third-party notices](THIRD_PARTY_NOTICES.md) and component directories. Check the terms of imported fonts, models and images.
