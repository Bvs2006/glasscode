import WebSocket, { WebSocketServer } from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import assert from 'assert';
import http from 'http';
import express from 'express';
import cors from 'cors';
import { signToken } from '../dist/auth.js';
import { setupConnection } from '../dist/y-websocket-server.js';
import { DEFAULT_SAMPLES } from '../dist/samples.js';

console.log('=== Starting Test: Bug 1 Concurrent Bootstrap Race Reproduction ===\n');

// 1. Setup Sync Server
const syncApp = express();
syncApp.use(cors());
const syncHttp = http.createServer(syncApp);
const wss = new WebSocketServer({ noServer: true });

syncHttp.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url || '', `http://${request.headers.host || 'localhost'}`);
  const docName = url.pathname.slice(1) || 'default-room';
  wss.handleUpgrade(request, socket, head, (ws) => {
    setupConnection(ws, request, docName);
  });
});

await new Promise((r) => syncHttp.listen(0, r));
const syncPort = syncHttp.address().port;
console.log(`[Sync Server] Running on ws://localhost:${syncPort}`);

// Helper to simulate a client joining the room
async function createClient(userId, role, roomName) {
  const token = signToken({ userId, role, name: userId });
  const doc = new Y.Doc();
  const ws = new WebSocket(`ws://localhost:${syncPort}/${roomName}?token=${token}`);
  ws.binaryType = 'arraybuffer';

  let syncCompleteResolve;
  const syncCompletePromise = new Promise((resolve) => {
    syncCompleteResolve = resolve;
  });

  ws.on('open', () => {
    // Send SyncStep1
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 0); // messageSync
    syncProtocol.writeSyncStep1(encoder, doc);
    ws.send(encoding.toUint8Array(encoder));
  });

  ws.on('message', (data) => {
    const uint8 = new Uint8Array(data);
    const decoder = decoding.createDecoder(uint8);
    const encoder = encoding.createEncoder();
    const messageType = decoding.readVarUint(decoder);

    if (messageType === 0) {
      encoding.writeVarUint(encoder, 0);
      syncProtocol.readSyncMessage(decoder, encoder, doc, ws);
      if (encoding.length(encoder) > 1) {
        ws.send(encoding.toUint8Array(encoder));
      }
      // If doc now has text, initial sync is complete
      if (doc.getText('monaco').length > 0) {
        syncCompleteResolve();
      }
    }
  });

  return { userId, role, doc, ws, syncCompletePromise };
}

// -------------------------------------------------------------
// Test 1: 3 Near-Simultaneous Connections to Fresh Room
// (Human Driver, Navigator Agent, Reviewer)
// -------------------------------------------------------------
const testRoom = `demo-race-room-${Date.now()}`;
console.log(`[TEST 1] Connecting 3 clients simultaneously to fresh room "${testRoom}"...`);

// Launch all 3 connections concurrently in the exact same event loop tick
const [client1, client2, client3] = await Promise.all([
  createClient('human-driver', 'editor', testRoom),
  createClient('navigator-agent', 'navigator', testRoom),
  createClient('human-reviewer', 'viewer', testRoom),
]);

// Wait for all 3 to receive their initial synced document
await Promise.all([
  client1.syncCompletePromise,
  client2.syncCompletePromise,
  client3.syncCompletePromise,
]);

// Allow brief tick for any pending WebSocket frames
await new Promise((r) => setTimeout(r, 200));

const text1 = client1.doc.getText('monaco').toString();
const text2 = client2.doc.getText('monaco').toString();
const text3 = client3.doc.getText('monaco').toString();

console.log(`Client 1 doc length: ${text1.length} chars`);
console.log(`Client 2 doc length: ${text2.length} chars`);
console.log(`Client 3 doc length: ${text3.length} chars`);

// Assert all 3 see the exact same content
assert.strictEqual(text1, text2, 'Client 1 and Client 2 document content differs!');
assert.strictEqual(text2, text3, 'Client 2 and Client 3 document content differs!');

// Assert content matches DEFAULT_SAMPLES.javascript EXACTLY ONCE
const expectedSample = DEFAULT_SAMPLES.javascript;
assert.strictEqual(text1, expectedSample, 'Content in room does not match expected sample!');

// Check for header repetition
const headerMatches = (text1.match(/GlassCode - JavaScript Collaborative Sample/g) || []).length;
assert.strictEqual(headerMatches, 1, `Header appeared ${headerMatches} times instead of exactly 1!`);

// Check for function repetition
const fibMatches = (text1.match(/function fibonacci/g) || []).length;
assert.strictEqual(fibMatches, 1, `function fibonacci appeared ${fibMatches} times instead of exactly 1!`);

console.log('✓ TEST 1 PASSED: 3 simultaneous connections received content exactly once with 0 duplication!');

// -------------------------------------------------------------
// Test 2: 4th Late-Joining Connection
// -------------------------------------------------------------
console.log('\n[TEST 2] Connecting 4th late-joining client...');
const client4 = await createClient('late-joiner', 'editor', testRoom);
await client4.syncCompletePromise;
await new Promise((r) => setTimeout(r, 100));

const text4 = client4.doc.getText('monaco').toString();
assert.strictEqual(text4, expectedSample, 'Late joining client received duplicate or corrupted content!');
console.log('✓ TEST 2 PASSED: Late joiner received content exactly once!');

// Cleanup
client1.ws.close();
client2.ws.close();
client3.ws.close();
client4.ws.close();
syncHttp.close();

console.log('\n=== ALL CONCURRENT BOOTSTRAP RACE TESTS PASSED! ===\n');
process.exit(0);
