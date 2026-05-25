# gphotos-storage-recovery

Reclaim Google Photos storage quota by identifying quota-consuming items, downloading them, trashing from cloud, and re-uploading via a Pixel 1's grandfathered unlimited-original-quality backup.

## How it works

Google Photos counts Original quality uploads (any date) and Storage Saver uploads (after June 1, 2021) toward your 15 GB quota. Pixel 1 (2016) has a permanent exemption: anything it uploads at Original quality costs zero quota.

This pipeline exploits that by:

1. **Scanning** the full library via undocumented `batchexecute` RPCs to find quota-consuming items
2. **Downloading** those items locally (preserving EXIF metadata)
3. **Trashing** them from Google Photos (removes quota charge)
4. **Pushing** the files to a Pixel 1 via ADB
5. **Letting Google Photos on the Pixel back them up** as "new" uploads (zero quota cost)

The result: identical photos/videos in your library, same metadata, but marked "doesn't take up space."

## Prerequisites

- **Pixel 1** (sailfish) with Google Photos configured for Original quality backup
  - Grandfathered unlimited uploads must still be active (check in Photos → Settings → Backup → Quality)
  - USB debugging enabled, ADB authorized
- **Chrome** running with `--remote-debugging-port=9222`, signed into Google Photos
- **Node.js 18+**
- **ADB** installed and in PATH

## Setup

```bash
git clone https://github.com/nbarari/gphotos-storage-recovery.git
cd gphotos-storage-recovery
npm install
```

Start Chrome with CDP enabled:

```bash
google-chrome --remote-debugging-port=9222 \
  --user-data-dir="$(pwd)/.browser-profile"
```

Navigate to https://photos.google.com and sign in.

## Pipeline

Run scripts in order. Each is idempotent and safe to re-run.

### 1. Scan for quota-consuming items

```bash
npm run scan
```

Enumerates the full library via `lcxiM` RPC (500 items/page), then batch-checks quota status via `EWgK9e` (5000 items/call). Outputs `manifest.json` with all quota-consuming items.

### 2. Download all quota items

```bash
npm run download
```

Fetches signed download URLs via `pLFTfd` RPC and downloads with session cookies. Saves to `./downloads/` with collision-safe filenames. Skips already-downloaded items.

### 3. Enrich manifest with dedupKeys

```bash
npm run enrich
```

The trash RPC (`XwAOJf`) requires `dedupKey`, not `mediaKey`. This script enumerates the library to map mediaKey to dedupKey.

**Note:** `lcxiM` last parameter controls mode: `1` = library, `2` = archive. If items remain unmatched, they may be in the archive. Edit the script to change the mode parameter.

### 4. Trash + push to Pixel

```bash
npm run trash-reupload
```

Safety gates:
- Refuses to run unless ALL items are downloaded locally
- Verifies local files still exist on disk

Processes in batches of 10: trash via `XwAOJf`, ADB push to `/sdcard/DCIM/Camera/`, MediaStore content insert, then restarts Google Photos to trigger backup.

### 5. Verify quota recovery

```bash
npm run verify
```

After the Pixel finishes backing up (1-4 hours), this scans the library and confirms re-uploaded items show `takesUpSpace=false` and `isOriginalQuality=true`.

### 6. Clean up Pixel storage

After verification, remove files from the Pixel:

```bash
adb shell rm /sdcard/DCIM/Camera/*
```

## Utilities

```bash
# Check quota status of a single item
node check-quota-status.mjs <mediaKey>

# Download a single item (for testing)
node download-test.mjs <mediaKey> <outputFilename>
```

## One-time Pixel setup

Google Photos caches which files it has previously backed up. If the device ever saw these files before, clear the app data:

```bash
adb shell pm clear com.google.android.apps.photos
```

Then sign back into Google Photos on the Pixel and configure:
- Backup: On
- Quality: Original quality
- Folders to back up: DCIM/Camera

## Critical constraints

- **Delete-first required.** Google Photos uses perceptual hash deduplication. Re-uploading without deleting first does NOT reclaim quota — the upload is silently deduplicated and inherits the old quota status.
- **`XwAOJf` uses dedupKey, not mediaKey.** The trash RPC takes a different identifier than what `EWgK9e` returns. Run the enrichment step first.
- **Archive items need mode 2.** Items in the Google Photos archive won't appear in library enumeration (mode 1). Use `lcxiM` with mode parameter `2` to find them.
- **In-page fetch is CORS-blocked.** Download URLs from `pLFTfd` must be fetched from Node.js with session cookies, not from within the page context.

## RPCs used

| RPC | Purpose | Request format |
|-----|---------|----------------|
| `lcxiM` | Library/archive enumeration (500/page) | `[pageToken, null, pageSize, null, 1, mode]` (mode: 1=library, 2=archive) |
| `EWgK9e` | Batch quota check (5000/call) | `[[[mappedKeys], [fieldMask]]]` |
| `pLFTfd` | Download URL (signed, short-lived) | `[["mediaKey"], [1]]` |
| `XwAOJf` | Move to trash | `[null, 1, ["dedupKey"], 3]` |

All RPCs use the `batchexecute` endpoint at `/_/PhotosUi/data/batchexecute`. Authentication uses XSRF tokens and session ID from `window.WIZ_global_data` (runs inside an authenticated browser session via CDP).

## Acknowledgments

RPC discovery informed by [xob0t/Google-Photos-Toolkit](https://github.com/xob0t/Google-Photos-Toolkit) (Tampermonkey userscript) and [xob0t/google_photos_web_client](https://github.com/xob0t/google_photos_web_client) (Python library).

## License

MIT
