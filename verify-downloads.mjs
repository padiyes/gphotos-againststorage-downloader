#!/usr/bin/env node
// Verify downloaded Google Photos files against manifest.json.
// Read-only: does not modify, delete, or upload any files.

import {
  readFileSync,
  existsSync,
  statSync,
} from 'fs';

import path from 'path';
import { fileURLToPath } from 'url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST_FILE = path.join(DIR, 'manifest.json');

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return 'Unknown';
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function run() {
  console.log('=== Google Photos Download Verification ===\n');

  if (!existsSync(MANIFEST_FILE)) {
    console.error('ERROR: manifest.json not found.');
    console.error('Run the scan step first.');
    process.exitCode = 1;
    return;
  }

  let manifest;

  try {
    manifest = JSON.parse(
      readFileSync(MANIFEST_FILE, 'utf8')
    );
  } catch (err) {
    console.error('ERROR reading manifest:', err.message);
    process.exitCode = 1;
    return;
  }

  if (!Array.isArray(manifest)) {
    console.error('ERROR: manifest.json must contain an array.');
    process.exitCode = 1;
    return;
  }

  const items = manifest.filter(
    item => item.mediaKey && item.consumesQuota
  );

  let verified = 0;
  let missing = 0;
  let sizeMismatch = 0;
  let invalid = 0;
  let totalBytes = 0;

  const failures = [];

  console.log(`Manifest entries: ${manifest.length}`);
  console.log(`Quota-consuming items: ${items.length}\n`);

  for (const item of items) {
    const filename = item.filename || item.mediaKey;

    if (!item.downloaded || !item.downloadedAs) {
      missing++;

      failures.push({
        filename,
        reason: 'Not marked as downloaded'
      });

      continue;
    }

    const filePath = path.isAbsolute(item.downloadedAs)
      ? item.downloadedAs
      : path.resolve(DIR, item.downloadedAs);

    if (!existsSync(filePath)) {
      missing++;

      failures.push({
        filename,
        reason: `File missing: ${filePath}`
      });

      continue;
    }

    try {
      const stats = statSync(filePath);

      if (!stats.isFile() || stats.size === 0) {
        invalid++;

        failures.push({
          filename,
          reason: 'Not a valid non-empty file'
        });

        continue;
      }

      totalBytes += stats.size;

      const expected = Number(item.sizeBytes || 0);

      if (
        expected > 0 &&
        Math.abs(stats.size - expected) > 1024
      ) {
        sizeMismatch++;

        failures.push({
          filename,
          reason:
            `Size mismatch: actual ${stats.size}, expected ${expected}`
        });

        continue;
      }

      verified++;

    } catch (err) {
      invalid++;

      failures.push({
        filename,
        reason: err.message
      });
    }
  }

  console.log('=== Verification Results ===');
  console.log(`Verified: ${verified}`);
  console.log(`Missing/not downloaded: ${missing}`);
  console.log(`Size mismatches: ${sizeMismatch}`);
  console.log(`Invalid files: ${invalid}`);
  console.log(`Total local size: ${formatBytes(totalBytes)}`);

  if (failures.length > 0) {
    console.log('\n=== Failed Items ===');

    for (const failure of failures) {
      console.log(`- ${failure.filename}`);
      console.log(`  ${failure.reason}`);
    }
  }

  console.log('\n=== Final Status ===');

  if (
    verified === items.length &&
    missing === 0 &&
    sizeMismatch === 0 &&
    invalid === 0
  ) {
    console.log('SUCCESS: All quota items verified locally.');
  } else {
    console.log('INCOMPLETE: Some items need attention.');
    process.exitCode = 1;
  }
}

run();