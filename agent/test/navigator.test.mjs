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
import { signToken, verifyToken } from '../../server/dist/auth.js';
import { setupConnection } from '../../server/dist/y-websocket-server.js';
import { NavigatorAgent, analyzeCode } from '../dist/navigator.js';

console.log('=== Starting Test Suite: Human + Navigator Agent Pairing ===\n');

// Capture server console logs for audit trail inspection
const serverLogs = [];
const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;
console.log = (...args) => {
  serverLogs.push({ type: 'log', message: args.join(' ') });
  originalConsoleLog(...args);
};
console.warn = (...args) => {
  serverLogs.push({ type: 'warn', message: args.join(' ') });
  originalConsoleWarn(...args);
};

// ─────────────────────────────────────────────────────────────
// 1. Setup Sandbox Mock HTTP Server
// ─────────────────────────────────────────────────────────────
let sandboxShouldFail = false;
const sandboxApp = express();
sandboxApp.use(cors());
sandboxApp.use(express.json());

sandboxApp.post('/execute-code', async (req, res) => {
  const { code, language = 'python' } = req.body;
  if (sandboxShouldFail) {
    return res.json({
      stdout: '',
      stderr: 'SyntaxError: invalid syntax in draft suggestion',
      exitCode: 1,
      timedOut: false,
      durationMs: 42,
    });
  }
  // Mock successful sandbox check
  res.json({
    stdout: 'Pass: code executed without errors',
    stderr: '',
    exitCode: 0,
    timedOut: false,
    durationMs: 50,
  });
});

const sandboxHttp = http.createServer(sandboxApp);
await new Promise((r) => sandboxHttp.listen(0, r));
const sandboxPort = sandboxHttp.address().port;
console.log(`[Test Sandbox] Running on http://localhost:${sandboxPort}`);

// ─────────────────────────────────────────────────────────────
// 2. Setup Sync Server
// ─────────────────────────────────────────────────────────────
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
console.log(`[Test Sync Server] Running on ws://localhost:${syncPort}`);

// Helper to connect a test client
async function connectClient(userId, role, roomName) {
  const token = signToken({ userId, role, name: `${userId} (${role})` });
  const doc = new Y.Doc();
  const ws = new WebSocket(`ws://localhost:${syncPort}/${roomName}?token=${token}`);
  ws.binaryType = 'arraybuffer';

  await new Promise((resolve, reject) => {
    ws.on('open', () => {
      // Send initial sync step 1
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, 0);
      syncProtocol.writeSyncStep1(encoder, doc);
      ws.send(encoding.toUint8Array(encoder));
      resolve();
    });
    ws.on('error', reject);
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
    }
  });

  function sendUpdate(updateBytes) {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, 0); // messageSync
    syncProtocol.writeUpdate(enc, updateBytes);
    ws.send(encoding.toUint8Array(enc));
  }

  return { doc, ws, token, sendUpdate };
}

// ─────────────────────────────────────────────────────────────
// PHASE 1 ACCEPTANCE TEST: Navigator role & write enforcement
// ─────────────────────────────────────────────────────────────
console.log('\n--- [PHASE 1] Testing Navigator Role & Server-Side Write Enforcement ---');

const roomPhase1 = 'room-phase-1';
const humanClient1 = await connectClient('human-alice', 'editor', roomPhase1);
const navigatorClient1 = await connectClient('nav-agent-bob', 'navigator', roomPhase1);

// Human inserts initial text
humanClient1.doc.transact(() => {
  humanClient1.doc.getText('monaco').insert(0, 'let x = 1;\n');
});
humanClient1.sendUpdate(Y.encodeStateAsUpdate(humanClient1.doc));
await new Promise((r) => setTimeout(r, 100));

assert.strictEqual(
  navigatorClient1.doc.getText('monaco').toString(),
  'let x = 1;\n',
  'Navigator client should have synced initial text from human'
);

// 1.A: Navigator attempts direct code write (altering Y.Text('monaco'))
console.log('[Test 1.A] Attempting direct text write from navigator connection...');
const rogueDoc = new Y.Doc();
rogueDoc.getText('monaco').insert(0, 'let x = 1;\nMALICIOUS_NAVIGATOR_WRITE;\n');
const textUpdate = Y.encodeStateAsUpdate(rogueDoc, Y.encodeStateVector(humanClient1.doc));
navigatorClient1.sendUpdate(textUpdate);

await new Promise((r) => setTimeout(r, 150));

// Confirm server dropped text write: humanClient1 MUST NOT receive MALICIOUS_NAVIGATOR_WRITE
assert.strictEqual(
  humanClient1.doc.getText('monaco').toString(),
  'let x = 1;\n',
  'CRITICAL SECURITY: Server must drop text-modifying write from navigator!'
);
console.log('✓ Verified: Server dropped text-modifying write from navigator connection');

// 1.B: Navigator writes to comments Y.Map
console.log('[Test 1.B] Attempting comment write from navigator connection...');
const commentUpdateDoc = new Y.Doc();
commentUpdateDoc.getMap('comments').set('comment-1', {
  id: 'comment-1',
  text: 'Navigator note: consider using const',
  author: 'Navigator',
});
const commentUpdate = Y.encodeStateAsUpdate(commentUpdateDoc);
navigatorClient1.sendUpdate(commentUpdate);

await new Promise((r) => setTimeout(r, 150));

const humanComments = humanClient1.doc.getMap('comments');
assert(humanComments.has('comment-1'), 'Human should have received comment from navigator');
console.log('✓ Verified: Navigator CAN write to comments Y.Map and it is broadcast to peers');

navigatorClient1.ws.close();
humanClient1.ws.close();

// ─────────────────────────────────────────────────────────────
// PHASE 2 ACCEPTANCE TEST: Reactive agent with debounce
// ─────────────────────────────────────────────────────────────
console.log('\n--- [PHASE 2] Testing Reactive Agent with Debounce ---');

const roomPhase2 = 'room-phase-2';
const humanClient2 = await connectClient('human-driver', 'editor', roomPhase2);

// Start navigator agent with 400ms debounce
const navigatorAgent2 = new NavigatorAgent({
  syncServerUrl: `ws://localhost:${syncPort}`,
  roomName: roomPhase2,
  language: 'javascript',
  sandboxUrl: `http://localhost:${sandboxPort}`,
  debounceMs: 400,
});

await navigatorAgent2.connect();
await new Promise((r) => setTimeout(r, 150));

console.log('[Test 2.A] Simulating continuous typing by human driver (5 rapid edits)...');
const yText2 = humanClient2.doc.getText('monaco');

// Type 5 keystrokes rapidly (every 70ms < 400ms debounce window)
for (let i = 1; i <= 5; i++) {
  humanClient2.doc.transact(() => {
    yText2.insert(yText2.length, `// stroke ${i}\n`);
  });
  humanClient2.sendUpdate(Y.encodeStateAsUpdate(humanClient2.doc));
  await new Promise((r) => setTimeout(r, 70));
  // While typing, analysisCount MUST remain 0!
  assert.strictEqual(
    navigatorAgent2.analysisCount,
    0,
    `Navigator must NOT run analysis while human is actively typing (stroke ${i})`
  );
}

console.log('✓ Verified: 0 analysis passes during continuous typing');

// Now pause typing and wait for debounce (400ms + margin)
console.log('[Test 2.B] Human pauses typing. Waiting for debounce silence window...');
await new Promise((r) => setTimeout(r, 650));

assert.strictEqual(
  navigatorAgent2.analysisCount,
  1,
  `Exactly ONE analysis pass should run after pause, got ${navigatorAgent2.analysisCount}`
);
console.log('✓ Verified: Exactly 1 analysis pass triggered after silence window elapses');

navigatorAgent2.close();
humanClient2.ws.close();

// ─────────────────────────────────────────────────────────────
// PHASE 3 ACCEPTANCE TEST: Sandbox-verified suggestions
// ─────────────────────────────────────────────────────────────
console.log('\n--- [PHASE 3] Testing Sandbox Verification Before Surfacing ---');

const roomPhase3 = 'room-phase-3';
const humanClient3 = await connectClient('human-driver', 'editor', roomPhase3);

// Case 3.A: Force sandbox failure
console.log('[Test 3.A] Forcing sandbox verification failure...');
sandboxShouldFail = true;

const navigatorAgent3 = new NavigatorAgent({
  syncServerUrl: `ws://localhost:${syncPort}`,
  roomName: roomPhase3,
  language: 'javascript',
  sandboxUrl: `http://localhost:${sandboxPort}`,
  debounceMs: 200,
});

await navigatorAgent3.connect();
await new Promise((r) => setTimeout(r, 150));

// Human types code with 'var count = 0;' (pattern analyzer detects 'var' -> proposes 'let count = 0;')
humanClient3.doc.transact(() => {
  humanClient3.doc.getText('monaco').insert(0, 'var count = 0;\n');
});
humanClient3.sendUpdate(Y.encodeStateAsUpdate(humanClient3.doc));

// Wait for debounce + analysis using onAnalysisComplete hook
await new Promise((resolve) => {
  navigatorAgent3.onAnalysisComplete = resolve;
});

assert.strictEqual(
  navigatorAgent3.suggestionsRejected,
  1,
  'Agent should have rejected suggestion when sandbox verification fails'
);
assert.strictEqual(
  navigatorAgent3.suggestionsPosted,
  0,
  'No suggestion comment should be posted if sandbox fails'
);
assert.strictEqual(
  humanClient3.doc.getMap('comments').size,
  0,
  'Shared comments map must be empty when sandbox fails'
);
console.log('✓ Verified: Failing sandbox check discards suggestion silently and posts NO comment');

// Case 3.B: Sandbox passes
console.log('[Test 3.B] Sandbox verification passes...');
sandboxShouldFail = false;
navigatorAgent3.resetState();

const analysis3bPromise = new Promise((resolve) => {
  navigatorAgent3.onAnalysisComplete = resolve;
});

// Trigger change with new code containing loose equality
humanClient3.doc.transact(() => {
  humanClient3.doc.getText('monaco').insert(humanClient3.doc.getText('monaco').length, 'if (x == 5) {}\n');
});
humanClient3.sendUpdate(Y.encodeStateAsUpdate(humanClient3.doc));

await analysis3bPromise;

assert(
  navigatorAgent3.suggestionsPosted >= 1,
  'Agent should post suggestion when sandbox succeeds'
);
console.log(`✓ Verified: Verified suggestion posted to comments map (${navigatorAgent3.suggestionsPosted} posted)`);

navigatorAgent3.close();
humanClient3.ws.close();

// ─────────────────────────────────────────────────────────────
// PHASE 4 ACCEPTANCE TEST: Surfacing and accepting suggestions
// ─────────────────────────────────────────────────────────────
console.log('\n--- [PHASE 4] Testing Suggestion Anchoring, Human Transact, and Attribution ---');

const roomPhase4 = 'room-phase-4';
const humanClient4 = await connectClient('human-driver-editor', 'editor', roomPhase4);

const navigatorAgent4 = new NavigatorAgent({
  syncServerUrl: `ws://localhost:${syncPort}`,
  roomName: roomPhase4,
  language: 'python',
  sandboxUrl: `http://localhost:${sandboxPort}`,
  debounceMs: 200,
});

await navigatorAgent4.connect();
await new Promise((r) => setTimeout(r, 150));

const analysis4Promise = new Promise((resolve) => {
  navigatorAgent4.onAnalysisComplete = resolve;
});

// Human writes Python code with bare except
const initialPyCode = 'try:\n    val = int("abc")\nexcept:\n    val = 0\n';
humanClient4.doc.transact(() => {
  humanClient4.doc.getText('monaco').insert(0, initialPyCode);
});
humanClient4.sendUpdate(Y.encodeStateAsUpdate(humanClient4.doc));

// Await completion of debounce, sandbox check, and suggestion post
await analysis4Promise;
// Brief tick for Yjs map update to propagate
await new Promise((r) => setTimeout(r, 100));

// Confirm suggestion was received by human client
const humanCommentsMap4 = humanClient4.doc.getMap('comments');
assert(humanCommentsMap4.size >= 1, 'Human client should receive the suggestion comment');

let suggestionThread = null;
humanCommentsMap4.forEach((val) => {
  if (val && val.type === 'suggestion') {
    suggestionThread = val;
  }
});

assert(suggestionThread !== null, 'Suggestion thread with type="suggestion" must exist in comments');
assert.strictEqual(
  suggestionThread.proposedReplacement,
  'except Exception:',
  'Proposed replacement must be "except Exception:"'
);
console.log('✓ Suggestion received in comments Y.Map with proposed replacement:', suggestionThread.proposedReplacement);

// Human Client accepts suggestion:
// The human's own editor connection resolves positions and performs doc.transact()
console.log('[Test 4.A] Human client accepts suggestion via human doc.transact()...');
const yText4 = humanClient4.doc.getText('monaco');
const startAbs = Y.createAbsolutePositionFromRelativePosition(suggestionThread.relPosStart, humanClient4.doc);
const endAbs = Y.createAbsolutePositionFromRelativePosition(suggestionThread.relPosEnd, humanClient4.doc);

assert(startAbs !== null && endAbs !== null, 'RelativePositions must resolve to absolute indices');

// Human transacts the edit
humanClient4.doc.transact(() => {
  yText4.delete(startAbs.index, endAbs.index - startAbs.index);
  yText4.insert(startAbs.index, suggestionThread.proposedReplacement);
});
// Send human's update to sync server
humanClient4.sendUpdate(Y.encodeStateAsUpdate(humanClient4.doc));

await new Promise((r) => setTimeout(r, 150));

const updatedCode = humanClient4.doc.getText('monaco').toString();
console.log('[Updated Code in Document]:\n' + updatedCode);
assert(
  updatedCode.includes('except Exception:'),
  'Document should now contain the accepted suggestion "except Exception:"'
);
assert(
  !updatedCode.includes('except:\n'),
  'Document should no longer contain the bare except'
);
console.log('✓ Code matches agent\'s verified patch exactly');

// ─────────────────────────────────────────────────────────────
// FINAL CHECK: Inspect server logs for strict write invariant
// ─────────────────────────────────────────────────────────────
console.log('\n--- [FINAL CHECK] Auditing Server Connection Logs for Text Write Attribution ---');

// Check all server log messages
const navigatorTextWritesApplied = serverLogs.filter((l) =>
  l.message.includes('Text update applied from navigator')
);
assert.strictEqual(
  navigatorTextWritesApplied.length,
  0,
  'CRITICAL INVARIANT VIOLATED: Server log shows text update applied from navigator!'
);

const droppedNavigatorWrites = serverLogs.filter((l) =>
  l.message.includes('Dropped text-modifying write from navigator')
);
assert(
  droppedNavigatorWrites.length >= 1,
  'Server should log security drop for attempted navigator text writes'
);

const editorTextWrites = serverLogs.filter((l) =>
  l.message.includes('Text update applied from editor')
);
assert(
  editorTextWrites.length >= 1,
  'Server should log text updates applied from editor'
);

console.log(`✓ Total text updates applied from editor connections: ${editorTextWrites.length}`);
console.log(`✓ Total text write attempts dropped from navigator: ${droppedNavigatorWrites.length}`);
console.log(`✓ Total text writes attributed to navigator: 0 (Strict Invariant Preserved!)`);

// Cleanup
navigatorAgent4.close();
humanClient4.ws.close();
syncHttp.close();
sandboxHttp.close();

console.log('\n=== ALL 4 PHASES + FINAL WRITE INVARIANT AUDIT PASSED! ===\n');
process.exit(0);
