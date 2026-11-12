#!/usr/bin/env node
// Trash-only Google Photos script.
// Does NOT upload, re-upload, or use ADB.
// Default mode: dry-run.
// Execute with: node batch-trash-only.mjs --execute

import {
  readFileSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';

const CDP_URL = 'http://127.0.0.1:9222';
const MANIFEST_FILE = fileURLToPath(
  new URL('./manifest.json', import.meta.url)
);

const DELAY_MS = 800;
const MANUAL_TRASH_FILENAME = 'IMG_4310.MOV';
const EXECUTE = process.argv.includes('--execute');

function saveManifest(manifest) {
  writeFileSync(
    MANIFEST_FILE,
    JSON.stringify(manifest, null, 2),
    'utf8'
  );
}

async function getCdpWebSocketUrl() {
  const response = await fetch(`${CDP_URL}/json`);

  if (!response.ok) {
    throw new Error(`CDP HTTP ${response.status}`);
  }

  const tabs = await response.json();
  const tab = tabs.find(
    t => t.url?.includes('photos.google.com')
  );

  if (!tab) {
    throw new Error(
      'Google Photos tab not found. Open Google Photos in Chrome.'
    );
  }

  return tab.webSocketDebuggerUrl;
}

class CdpSession {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();

    ws.on('message', data => {
      const msg = JSON.parse(data.toString());

      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);

        if (msg.error) {
          reject(new Error(msg.error.message));
        } else {
          resolve(msg.result);
        }
      }
    });

    ws.on('close', () => {
      for (const { reject } of this.pending.values()) {
        reject(new Error('CDP connection closed'));
      }
      this.pending.clear();
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;

      this.pending.set(id, { resolve, reject });

      this.ws.send(
        JSON.stringify({ id, method, params }),
        error => {
          if (error) {
            this.pending.delete(id);
            reject(error);
          }
        }
      );
    });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });

    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.text || 'CDP evaluation failed'
      );
    }

    return result.result?.value;
  }
}

async function connectCdp(wsUrl) {
  const { default: WebSocket } = await import('ws');

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, {
      perMessageDeflate: false,
    });

    ws.on('open', () => resolve(new CdpSession(ws)));
    ws.on('error', reject);
  });
}

async function getAuthTokens(cdp) {
  const tokens = await cdp.evaluate(`
    (() => {
      const g = window.WIZ_global_data;

      if (!g) {
        return { error: 'WIZ_global_data not found' };
      }

      return {
        at: g.SNlM0e,
        fsid: g.FdrFJe,
        bl: g.cfb2h,
        path: g.eptZe
      };
    })()
  `);

  if (
    tokens?.error ||
    !tokens?.at ||
    !tokens?.fsid ||
    !tokens?.bl ||
    !tokens?.path
  ) {
    throw new Error(
      tokens?.error || 'Incomplete Google Photos authentication tokens'
    );
  }

  return tokens;
}

async function trashItem(cdp, tokens, dedupKey) {
  const expression = `
    (async () => {
      const rpcid = 'XwAOJf';

      const requestData = [
        null,
        1,
        [${JSON.stringify(dedupKey)}],
        3
      ];

      const wrappedData = [
        [[rpcid, JSON.stringify(requestData), null, 'generic']]
      ];

      const body =
        'f.req=' +
        encodeURIComponent(JSON.stringify(wrappedData)) +
        '&at=' +
        encodeURIComponent(${JSON.stringify(tokens.at)}) +
        '&';

      const params = new URLSearchParams({
        rpcids: rpcid,
        'source-path': window.location.pathname,
        'f.sid': ${JSON.stringify(tokens.fsid)},
        bl: ${JSON.stringify(tokens.bl)},
        pageId: 'none',
        rt: 'c'
      });

      const url =
        'https://photos.google.com' +
        ${JSON.stringify(tokens.path)} +
        'data/batchexecute?' +
        params.toString();

      const response = await fetch(url, {
        headers: {
          'content-type':
            'application/x-www-form-urlencoded;charset=UTF-8'
        },
        body,
        method: 'POST',
        credentials: 'include'
      });

      const text = await response.text();

      return {
        status: response.status,
        hasEnvelope: text.includes('wrb.fr'),
        hasError: text.includes('"er"'),
        response: text.slice(0, 300)
      };
    })()
  `;

  return cdp.evaluate(expression);
}

async function run() {
  console.log('=== Google Photos TRASH ONLY ===');
  console.log(`Mode: ${EXECUTE ? 'EXECUTE' : 'DRY-RUN'}`);
  console.log('');

  if (!existsSync(MANIFEST_FILE)) {
    throw new Error('manifest.json not found');
  }

  const manifest = JSON.parse(
    readFileSync(MANIFEST_FILE, 'utf8')
  );

  const quotaItems = manifest.filter(
    item => item.mediaKey && item.consumesQuota
  );

  // Identify the file already moved to Trash manually.
  const manualItem = quotaItems.find(
    item => item.filename === MANUAL_TRASH_FILENAME
  );

  const candidates = quotaItems.filter(item => {
    if (item.filename === MANUAL_TRASH_FILENAME) return false;
    if (!item.downloaded || !item.downloadedAs) return false;
    if (!item.dedupKey) return false;
    if (!existsSync(item.downloadedAs)) return false;
    if (item.trashed === true) return false;

    return true;
  });

  const skipped = quotaItems.filter(item => {
    if (item.filename === MANUAL_TRASH_FILENAME) return true;
    if (!item.downloaded || !item.downloadedAs) return true;
    if (!item.dedupKey) return true;
    if (!existsSync(item.downloadedAs)) return true;
    if (item.trashed === true) return true;

    return false;
  });

  const uniqueKeys = new Set(
    candidates.map(item => item.dedupKey)
  );

  console.log(`Manifest items: ${quotaItems.length}`);
  console.log(`Already trashed manually: ${manualItem ? 1 : 0}`);
  console.log(`Ready for trash: ${candidates.length}`);
  console.log(`Skipped: ${skipped.length}`);
  console.log(`Unique dedupKeys: ${uniqueKeys.size}`);
  console.log('');

  if (uniqueKeys.size !== candidates.length) {
    throw new Error(
      'Duplicate dedupKeys detected. Aborting for safety.'
    );
  }

  if (!EXECUTE) {
    console.log('DRY-RUN: No Google Photos items were changed.');
    console.log('');
    console.log(
      'Review the counts above. To execute, run:'
    );
    console.log('node .\\batch-trash-only.mjs --execute');
    return;
  }

  if (candidates.length === 0) {
    console.log('Nothing to process.');
    return;
  }

  console.log('Connecting to Chrome CDP...');

  const wsUrl = await getCdpWebSocketUrl();
  const cdp = await connectCdp(wsUrl);

  try {
    const tokens = await getAuthTokens(cdp);

    console.log('Google Photos authentication ready.');
    console.log('Starting trash operation...');
    console.log('');

    let success = 0;
    let errors = 0;

    for (let i = 0; i < candidates.length; i++) {
      const item = candidates[i];

      const filename =
        item.filename || item.mediaKey;

      process.stdout.write(
        `[${i + 1}/${candidates.length}] ${filename}... `
      );

      try {
        const result = await trashItem(
          cdp,
          tokens,
          item.dedupKey
        );

        if (
          result?.status === 200 &&
          result.hasEnvelope &&
          !result.hasError
        ) {
          item.trashed = true;
          item.trashedAt = new Date().toISOString();
          item.trashMethod = 'XwAOJf';

          success++;

          console.log('RPC accepted');

          // Save every successful operation.
          saveManifest(manifest);
        } else {
          errors++;

          console.log(
            `UNCONFIRMED (HTTP ${result?.status}, ` +
            `envelope=${result?.hasEnvelope}, ` +
            `error=${result?.hasError})`
          );
        }
      } catch (error) {
        errors++;
        console.log(`ERROR: ${error.message}`);
      }

      if (i < candidates.length - 1) {
        await new Promise(resolve =>
          setTimeout(resolve, DELAY_MS)
        );
      }
    }

    saveManifest(manifest);

    console.log('');
    console.log('=== TRASH SUMMARY ===');
    console.log(`RPC accepted: ${success}`);
    console.log(`Errors/unconfirmed: ${errors}`);
    console.log(`Manual trash: ${manualItem ? 1 : 0}`);
    console.log(`Total marked trashed: ${
      quotaItems.filter(item => item.trashed === true).length
    }`);
    console.log('');
    console.log('Manifest saved.');
    console.log(
      'Check Google Photos Trash in Chrome to confirm.'
    );

  } finally {
    cdp.ws.close();
  }
}

run().catch(error => {
  console.error('');
  console.error('FATAL:', error.message);
  process.exitCode = 1;
});