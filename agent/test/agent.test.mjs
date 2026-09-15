import WebSocket, { WebSocketServer } from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import assert from 'assert';
import http from 'http';
import express from 'express';
import cors from 'cors';
import { signToken } from '../../server/dist/auth.js';
import { setupConnection } from '../../server/dist/y-websocket-server.js';
import { runSandbox } from '../../sandbox/dist/executor.js';
import { LiveShareAgent } from '../dist/agent.js';

console.log('=== Starting Test Suite: Phase 7 (Agent as Headless Yjs Peer) ===\n');

// 1. Setup Sandbox Mock/Service HTTP Server
const sandboxApp = express();
sandboxApp.use(cors());
sandboxApp.use(express.json());

sandboxApp.post('/execute-code', async (req, res) => {
  const { code, language = 'python', timeoutMs = 5000 } = req.body;
  const fs = await import('fs');
  const path = await import('path');
  const os = await import('os');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbx-agent-test-'));
  const fileName = language === 'python' ? 'script.py' : 'script.js';
  fs.writeFileSync(path.join(tempDir, fileName), code, 'utf8');

  try {
    const result = await runSandbox({
      workingDir: tempDir,
      command: language === 'python' ? 'python3 script.py' : 'node script.js',
      image: language === 'python' ? 'python:3.11-alpine' : 'node:20-alpine',
      timeoutMs,
      allowNetwork: false,
    });
    res.json(result);
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (e) {}
  }
});

const sandboxHttp = http.createServer(sandboxApp);
await new Promise((r) => sandboxHttp.listen(0, r));
const sandboxPort = sandboxHttp.address().port;
console.log(`[Sandbox Service] Running on http://localhost:${sandboxPort}`);

// 2. Setup Sync Server
const syncApp = express();
syncApp.use(cors());
const syncHttp = http.createServer(syncApp);
const wss = new WebSocketServer({ noServer: true });

syncHttp.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url || '', `http://${request.headers.host || 'localhost'}`);
  const docName = url.pathname.slice(1) || 'test-room';
  wss.handleUpgrade(request, socket, head, (ws) => {
    setupConnection(ws, request, docName);
  });
});

await new Promise((r) => syncHttp.listen(0, r));
const syncPort = syncHttp.address().port;
console.log(`[Sync Server] Running on ws://localhost:${syncPort}`);

// 3. Connect Human Client (Alice)
console.log('\n[TEST] Connecting human client (Alice) to room "collab-room"...');
const humanToken = signToken({ userId: 'human-alice', role: 'editor', name: 'Alice (Human)' });
const humanDoc = new Y.Doc();
const humanWs = new WebSocket(`ws://localhost:${syncPort}/collab-room?token=${humanToken}`);
humanWs.binaryType = 'arraybuffer';

await new Promise((resolve) => {
  humanWs.on('open', () => {
    // Initial sync
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 0);
    syncProtocol.writeSyncStep1(encoder, humanDoc);
    humanWs.send(encoding.toUint8Array(encoder));
    resolve();
  });
});

humanWs.on('message', (data) => {
  const uint8 = new Uint8Array(data);
  const decoder = decoding.createDecoder(uint8);
  const encoder = encoding.createEncoder();
  const messageType = decoding.readVarUint(decoder);

  if (messageType === 0) {
    encoding.writeVarUint(encoder, 0);
    syncProtocol.readSyncMessage(decoder, encoder, humanDoc, humanWs);
    if (encoding.length(encoder) > 1) {
      humanWs.send(encoding.toUint8Array(encoder));
    }
  }
});

// Human types initial code
const humanText = humanDoc.getText('monaco');
humanDoc.transact(() => {
  humanText.insert(0, 'def multiply(a, b):\n    return a * b\n');
});

// Send update to server
const enc = encoding.createEncoder();
encoding.writeVarUint(enc, 0);
syncProtocol.writeUpdate(enc, Y.encodeStateAsUpdate(humanDoc));
humanWs.send(encoding.toUint8Array(enc));

await new Promise((r) => setTimeout(r, 100));
console.log(`[Human Client] Initial code in editor:\n${humanText.toString()}`);

// 4. Connect Headless AI Agent
console.log('\n[TEST] Connecting Headless AI Agent to "collab-room"...');
const agent = new LiveShareAgent({
  syncServerUrl: `ws://localhost:${syncPort}`,
  roomName: 'collab-room',
  sandboxUrl: `http://localhost:${sandboxPort}`,
  agentId: 'ai-agent-007',
  agentName: 'Claude Agent (Headless)',
});

await agent.connect();
await new Promise((r) => setTimeout(r, 150));

// Confirm agent reads the human's current code
const agentCurrentCode = agent.getCurrentCode();
assert.strictEqual(
  agentCurrentCode,
  'def multiply(a, b):\n    return a * b\n',
  'Agent failed to read human code from shared CRDT doc'
);
console.log('✓ Agent successfully read human document state from shared Y.Doc');

// 5. Test Case 1: Proposed code with failing tests/syntax error
console.log('\n[TEST 1] Testing Agent rejects broken code that fails sandbox verification...');
const brokenTask = {
  id: 'task-1-broken',
  instruction: 'Add broken logic with syntax error',
  proposedCode: 'def broken():\n    syntax error here!!!',
  language: 'python',
};

const result1 = await agent.processTask(brokenTask);
assert.strictEqual(result1.applied, false, 'Agent should NOT apply broken code!');
assert.strictEqual(result1.verification.success, false, 'Verification should fail');
assert.strictEqual(
  humanText.toString(),
  'def multiply(a, b):\n    return a * b\n',
  'Human editor should remain unaltered when verification fails!'
);
console.log('✓ TEST 1 PASSED: Agent blocked broken code. Document remained unchanged.');

// 6. Test Case 2: Proposed code that passes verification
console.log('\n[TEST 2] Testing Agent verifies and applies valid code live into shared room...');
const validTask = {
  id: 'task-2-valid',
  instruction: 'Add unit tests for multiply function',
  proposedCode: `def multiply(a, b):
    return a * b

# Verified unit tests
assert multiply(3, 4) == 12
assert multiply(-2, 5) == -10
print("All multiply tests verified in sandbox!")
`,
  language: 'python',
};

const result2 = await agent.processTask(validTask);
assert.strictEqual(result2.applied, true, 'Agent should have applied verified code');
assert.strictEqual(result2.verification.success, true, 'Verification should succeed');

// Wait for update to sync to Human's editor
await new Promise((r) => setTimeout(r, 150));

console.log('\n[Human Client Editor Content After Agent Edit]:');
console.log(humanText.toString());

assert.strictEqual(
  humanText.toString(),
  validTask.proposedCode,
  'Human editor did not receive live update from agent!'
);
console.log('✓ TEST 2 PASSED: Human editor received live verified edit from headless agent in real-time!');

// Cleanup
agent.close();
humanWs.close();
syncHttp.close();
sandboxHttp.close();

console.log('\n=== ALL PHASE 7 AGENT ACCEPTANCE TESTS PASSED! ===');
process.exit(0);
