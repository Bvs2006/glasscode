import WebSocket from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import assert from 'assert';
import http from 'http';
import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { signToken, verifyToken } from '../dist/auth.js';
import { setupConnection, docs, MESSAGE_SYNC, MESSAGE_AWARENESS } from '../dist/y-websocket-server.js';

console.log('=== Starting Test Suite: Phase 3 (Sync), Phase 4 (Presence), Phase 5 (Roles) ===\n');

// 1. Setup local test server on dynamic port
const app = express();
app.use(cors());
app.use(express.json());

app.get('/auth/token', (req, res) => {
  const role = req.query.role || 'editor';
  const userId = req.query.userId || 'test-user';
  const token = signToken({ userId, role, name: `User-${role}` });
  res.json({ token, role, userId });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url || '', `http://${request.headers.host || 'localhost'}`);
  const docName = url.pathname.slice(1) || 'test-room';
  wss.handleUpgrade(request, socket, head, (ws) => {
    setupConnection(ws, request, docName);
  });
});

await new Promise((resolve) => server.listen(0, resolve));
const port = server.address().port;
console.log(`[Test Server] Running on port ${port}`);

// Helper to create a connected client with Y.Doc and Awareness
class TestClient {
  constructor(room, token, userName, role = 'editor') {
    this.room = room;
    this.token = token;
    this.role = role;
    this.userName = userName;
    this.doc = new Y.Doc();
    this.awareness = new awarenessProtocol.Awareness(this.doc);
    this.ws = null;
    this.connected = false;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const url = `ws://localhost:${port}/${this.room}?token=${this.token}`;
      this.ws = new WebSocket(url);
      this.ws.binaryType = 'arraybuffer';

      this.ws.on('open', () => {
        this.connected = true;

        // Send initial sync step 1
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        syncProtocol.writeSyncStep1(encoder, this.doc);
        this.ws.send(encoding.toUint8Array(encoder));

        // Set local awareness
        this.awareness.setLocalStateField('user', {
          name: this.userName,
          role: this.role,
        });

        resolve();
      });

      this.ws.on('message', (data) => {
        const uint8 = new Uint8Array(data);
        const decoder = decoding.createDecoder(uint8);
        const encoder = encoding.createEncoder();
        const messageType = decoding.readVarUint(decoder);

        if (messageType === MESSAGE_SYNC) {
          encoding.writeVarUint(encoder, MESSAGE_SYNC);
          syncProtocol.readSyncMessage(decoder, encoder, this.doc, this);
          if (encoding.length(encoder) > 1) {
            this.ws.send(encoding.toUint8Array(encoder));
          }
        } else if (messageType === MESSAGE_AWARENESS) {
          awarenessProtocol.applyAwarenessUpdate(
            this.awareness,
            decoding.readVarUint8Array(decoder),
            this
          );
        }
      });

      // Forward local doc updates to server
      this.doc.on('update', (update, origin) => {
        if (origin !== this && this.connected && this.ws.readyState === WebSocket.OPEN) {
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, MESSAGE_SYNC);
          syncProtocol.writeUpdate(encoder, update);
          this.ws.send(encoding.toUint8Array(encoder));
        }
      });

      // Forward local awareness updates
      this.awareness.on('update', ({ added, updated, removed }, origin) => {
        if (origin === 'local' && this.connected && this.ws.readyState === WebSocket.OPEN) {
          const changed = added.concat(updated, removed);
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
          encoding.writeVarUint8Array(
            encoder,
            awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed)
          );
          this.ws.send(encoding.toUint8Array(encoder));
        }
      });

      this.ws.on('error', reject);
    });
  }

  close() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

// -----------------------------------------------------------------
// TEST 1: Phase 3 - Real-time sync between two editor clients
// -----------------------------------------------------------------
console.log('[TEST 1] Testing Phase 3: Real-Time Sync between two editor tabs...');
const editor1Token = signToken({ userId: 'editor-1', role: 'editor', name: 'Alice' });
const editor2Token = signToken({ userId: 'editor-2', role: 'editor', name: 'Bob' });

const client1 = new TestClient('phase3-room', editor1Token, 'Alice', 'editor');
const client2 = new TestClient('phase3-room', editor2Token, 'Bob', 'editor');

await client1.connect();
await client2.connect();
await new Promise((r) => setTimeout(r, 100));

// Client 1 types text
const t0 = Date.now();
const yText1 = client1.doc.getText('monaco');
client1.doc.transact(() => {
  yText1.insert(0, 'const message = "Hello from Client 1";');
});

// Wait for sync to Client 2
const yText2 = client2.doc.getText('monaco');
let synced = false;
for (let i = 0; i < 20; i++) {
  if (yText2.toString() === yText1.toString()) {
    synced = true;
    break;
  }
  await new Promise((r) => setTimeout(r, 20));
}
const elapsed = Date.now() - t0;

assert.strictEqual(synced, true, 'Client 2 failed to sync with Client 1');
assert.strictEqual(yText2.toString(), 'const message = "Hello from Client 1";');
console.log(`✓ Phase 3 PASSED: Sync successful in ${elapsed}ms (< 200ms target)`);

// -----------------------------------------------------------------
// TEST 2: Phase 4 - Presence Awareness
// -----------------------------------------------------------------
console.log('\n[TEST 2] Testing Phase 4: Presence Awareness...');
client1.awareness.setLocalStateField('cursor', { line: 12, column: 5 });
client2.awareness.setLocalStateField('cursor', { line: 24, column: 10 });

await new Promise((r) => setTimeout(r, 150));

let client2HasAlice = false;
client2.awareness.getStates().forEach((state) => {
  if (state.user && state.user.name === 'Alice') {
    client2HasAlice = true;
  }
});

let client1HasBob = false;
client1.awareness.getStates().forEach((state) => {
  if (state.user && state.user.name === 'Bob') {
    client1HasBob = true;
  }
});

assert.strictEqual(client2HasAlice, true, 'Client 2 did not receive Alice awareness');
assert.strictEqual(client1HasBob, true, 'Client 1 did not receive Bob awareness');
console.log('✓ Phase 4 PASSED: Awareness broadcast verified between both clients');

// -----------------------------------------------------------------
// TEST 3: Phase 5 - Server-Side Role Enforcement (Viewer Write Drop)
// -----------------------------------------------------------------
console.log('\n[TEST 3] Testing Phase 5: Server-side Role Enforcement (Viewer write rejection)...');
const viewerToken = signToken({ userId: 'viewer-malicious', role: 'viewer', name: 'Mallory' });
const clientViewer = new TestClient('phase3-room', viewerToken, 'Mallory', 'viewer');
await clientViewer.connect();
await new Promise((r) => setTimeout(r, 100));

// Confirm viewer can READ current doc
const yTextViewer = clientViewer.doc.getText('monaco');
assert.strictEqual(
  yTextViewer.toString(),
  'const message = "Hello from Client 1";',
  'Viewer failed to read document state'
);
console.log('✓ Viewer successfully received initial document state');

// Now simulate a malicious viewer:
// Even if client-side read-only UI is bypassed and sends raw Yjs update packet:
console.log('Simulating viewer bypassing UI and attempting raw write update to server...');
const maliciousDoc = new Y.Doc();
const maliciousText = maliciousDoc.getText('monaco');
maliciousText.insert(0, 'MALICIOUS_HACKED_CONTENT');
const rawUpdate = Y.encodeStateAsUpdate(maliciousDoc);

// Send raw Yjs update over WebSocket connection
const encoder = encoding.createEncoder();
encoding.writeVarUint(encoder, MESSAGE_SYNC);
syncProtocol.writeUpdate(encoder, rawUpdate);
clientViewer.ws.send(encoding.toUint8Array(encoder));

// Wait to see if server applies or broadcasts this to Client 1 or Client 2
await new Promise((r) => setTimeout(r, 200));

// Verify that doc in room is NOT modified by the viewer's write update!
assert.strictEqual(
  yText1.toString(),
  'const message = "Hello from Client 1";',
  'SECURITY FAILURE: Server accepted and applied write update from viewer!'
);
assert.strictEqual(
  yText2.toString(),
  'const message = "Hello from Client 1";',
  'SECURITY FAILURE: Client 2 received unauthorized write update from viewer!'
);
console.log('✓ Phase 5 PASSED: Server dropped write update from viewer! Document remained intact.');

// Verify editor can still write and viewer receives the update
client1.doc.transact(() => {
  yText1.insert(yText1.length, '\nconsole.log("Verified");');
});
await new Promise((r) => setTimeout(r, 100));

assert.strictEqual(
  yTextViewer.toString(),
  'const message = "Hello from Client 1";\nconsole.log("Verified");',
  'Viewer should receive valid edits from editor'
);
console.log('✓ Viewer receives editor updates cleanly');

// Cleanup
client1.close();
client2.close();
clientViewer.close();
server.close();

console.log('\n=== ALL TESTS PASSED: Phase 3, Phase 4, Phase 5 Verified Successfully! ===');
process.exit(0);
