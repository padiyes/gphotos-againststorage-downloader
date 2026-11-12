Google Photos Storage Recovery

A Node.js toolkit for scanning, downloading, verifying, and managing Google Photos items that consume Google Account storage quota.

The project uses Chrome DevTools Protocol (CDP) to interact with an authenticated Google Photos session.

Project Overview

This repository contains tools for:

Scanning Google Photos for quota-consuming media.
Downloading original media files locally.
Verifying downloaded files against the manifest.
Enriching media entries with Google Photos deduplication keys.
Moving downloaded items to Google Photos Trash without re-uploading.
Tracking progress and checking storage status.

Important: The current recovery workflow uses the trash-only method. It does not require a Pixel 1 device, ADB, or re-uploading files.

Requirements
Node.js 22 or compatible version.
npm.
Google Chrome.
Google Photos account authenticated in Chrome.
Chrome remote debugging enabled on port 9222.
Sufficient local disk space for downloaded media.

Install dependencies:

powershell
npm install


Start Chrome with remote debugging enabled:

powershell
chrome.exe --remote-debugging-port=9222


If Chrome is installed in a different location, use its full executable path.

Open Google Photos:

https://photos.google.com/

Make sure the account is authenticated before running the scripts.

Security: Do not expose Chrome's remote debugging port to public networks. It can provide access to the authenticated browser session.

Project Scripts
Script	Purpose
scan-quota-items.mjs	Scan Google Photos for quota-consuming items
batch-download.mjs	Download media files locally
verify-downloads.mjs	Verify local downloaded files
enrich-dedupkeys.mjs	Add deduplication keys to manifest entries
batch-trash-only.mjs	Move eligible downloaded items to Trash
batch-trash-reupload.mjs	Legacy trash and re-upload workflow
verify-reupload.mjs	Verify legacy re-upload workflow
check-quota-status.mjs	Check Google Photos storage status
Recovery Workflow
1. Scan Google Photos
powershell
node .\scan-quota-items.mjs


This generates:

quota-items-scan.json
manifest.json (when the manifest does not already exist, or updates an existing manifest)

The manifest contains media identifiers, filenames, sizes, timestamps, and quota-related metadata.

2. Download quota-consuming media
powershell
node .\batch-download.mjs


Downloaded files are stored in:

text
downloads/


The script:

Downloads media using the authenticated Chrome session.
Avoids downloading entries already marked as downloaded.
Tracks download status in manifest.json.
Saves progress periodically.
Supports resuming interrupted downloads.
3. Verify downloaded files
powershell
node .\verify-downloads.mjs


The verification process checks:

Downloaded file existence.
File sizes.
File validity.
Missing or incomplete downloads.

Only entries with downloaded files physically present on disk should be eligible for the trash-only workflow.

4. Enrich deduplication keys
powershell
node .\enrich-dedupkeys.mjs


This enumerates the Google Photos library and matches media identifiers with their corresponding deduplication keys.

The deduplication keys are required by the trash operation.

5. Run trash-only dry-run
powershell
node .\batch-trash-only.mjs


The default mode is DRY-RUN.

It does not modify Google Photos.

Before proceeding, inspect:

Total manifest entries.
Already trashed items.
Eligible downloaded items.
Skipped entries.
Unique deduplication keys.

The script excludes entries that:

Were not downloaded.
Have no local file.
Have no deduplication key.
Have already been marked as trashed.
Are explicitly excluded as manually trashed items.
6. Execute trash-only operation
powershell
node .\batch-trash-only.mjs --execute


This operation:

Sends the trash request for each eligible item.
Does not upload or re-upload any files.
Does not use ADB.
Saves progress in manifest.json.
Records successful RPC responses.
Continues past individual errors.

The manifest records:

trashed
trashedAt
trashMethod

Important: An accepted RPC response is not independent confirmation that the media is visible in Trash. Always inspect Google Photos Trash in Chrome after execution.

7. Check storage status
powershell
npm run check


Allow Google Photos storage accounting time to update.

Compare the storage status before and after the operation.

Current Recovery Results

The latest recorded run:

Metric	Result
Total quota-consuming items	1,211
Downloaded files	1,210
Missing downloads	1
Manually trashed	1
Trash RPC accepted	1,209
Errors / unconfirmed	0
Total marked trashed	1,209

The remaining undownloaded item was excluded from the trash operation.

The 1,210 locally downloaded files remain available in the downloads/ directory.

Important Safety Notes
Keep the downloads/ directory until recovery has been fully verified.
Keep a backup of manifest.json.
Do not delete local files immediately after moving items to Trash.
Do not empty Google Photos Trash until you are certain that the local backups are valid and complete.
Check Google Photos Trash manually after execution.
Remember that items in Trash may remain recoverable for a limited retention period.
Do not run the legacy batch-trash-reupload.mjs script when using the trash-only workflow.
Never assume that an HTTP success response guarantees storage quota has already been recovered.
Important Files
text
.
├── downloads/
├── manifest.json
├── quota-items-scan.json
├── scan-quota-items.mjs
├── batch-download.mjs
├── verify-downloads.mjs
├── enrich-dedupkeys.mjs
├── batch-trash-only.mjs
├── batch-trash-reupload.mjs
├── verify-reupload.mjs
├── check-quota-status.mjs
├── package.json
└── README.md


Generated data files and downloaded media should be backed up separately from the source code.

Windows PowerShell Notes

If PowerShell blocks npm.ps1 due to execution policy, use:

powershell
npm.cmd install
npm.cmd run download
npm.cmd run scan
npm.cmd run check


Node scripts can be executed directly:

powershell
node .\scan-quota-items.mjs
node .\batch-download.mjs
node .\enrich-dedupkeys.mjs
node .\batch-trash-only.mjs

License

MIT