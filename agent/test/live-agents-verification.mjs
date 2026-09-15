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
import { LiveShareAgent } from '../dist/agent.js';
import { NavigatorAgent } from '../dist/navigator.js';

console.log('=== GlassCode: Live Agents & Harness Integration Verification ===\n');

// Capture server security logs
const capturedLogs = [];
const origLog = console.log;
const origWarn = console.warn;
console.log = (...args) => {
  capturedLogs.push({ type: 'log', text: args.join(' ') });
  origLog(...args);
};
console.warn = (...args) => {
  capturedLogs.push({ type: 'warn', text: args.join(' ') });
  origWarn(...args);
};

// 1. Start Sandbox Mock Server (simulating the running Docker sandbox service)
const sandboxApp = express();
sandboxApp.use(cors());
sandboxApp.use(express.json());

sandboxApp.post('/execute-code', (req, res) => {
  const { code, language = 'javascript' } = req.body;
  if (code.includes('SYNTAX_ERROR_BROKEN') || code.includes('syntax error here')) {
    return res.json({
      stdout: '',
      stderr: 'SyntaxError: Unexpected token',
      exitCode: 1,
      timedOut: false,
      durationMs: 40,
    });
  }
  res.json({
    stdout: 'Execution verified successfully',
    stderr: '',
    exitCode: 0,
    timedOut: false,
    durationMs: 35,
  });
});

const sandboxHttp = http.createServer(sandboxApp);
await new Promise((r) => sandboxHttp.listen(0, r));
const sandboxPort = sandboxHttp.address().port;
console.log(`[Test Sandbox] Running on http://localhost:${sandboxPort}`);

// 2. Start Sync Server
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
console.log(`[Test Sync Server] Running on ws://localhost:${syncPort}`);

// -------------------------------------------------------------
// STEP 1: Connect Harness, Editor-Agent, and Navigator-Agent
// -------------------------------------------------------------
console.log('\n--- STEP 1: Connect Both Agents to the Room & Verify Online Participants ---');
const roomName = `demo-live-room-${Date.now()}`;

// Connect Harness (representing human test driver)
const harnessToken = signToken({ userId: 'harness-human', role: 'editor', name: 'Human Test Driver' });
const harnessDoc = new Y.Doc();
const harnessAwareness = new awarenessProtocol.Awareness(harnessDoc);
const harnessWs = new WebSocket(`ws://localhost:${syncPort}/${roomName}?token=${harnessToken}`);
harnessWs.binaryType = 'arraybuffer';

const harnessPeers = new Map();
harnessAwareness.on('change', () => {
  harnessAwareness.getStates().forEach((state, clientId) => {
    if (state.user) {
      harnessPeers.set(state.user.userId, state.user);
    }
  });
});

await new Promise((resolve) => {
  harnessWs.on('open', () => {
    // Send SyncStep1
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, 0);
    syncProtocol.writeSyncStep1(enc, harnessDoc);
    harnessWs.send(encoding.toUint8Array(enc));

    // Announce harness presence
    harnessAwareness.setLocalStateField('user', {
      userId: 'harness-human',
      name: 'Human Test Driver',
      role: 'editor',
      color: '#38bdf8',
    });

    const aEnc = encoding.createEncoder();
    encoding.writeVarUint(aEnc, 1);
    encoding.writeVarUint8Array(
      aEnc,
      awarenessProtocol.encodeAwarenessUpdate(harnessAwareness, [harnessDoc.clientID])
    );
    harnessWs.send(encoding.toUint8Array(aEnc));
    resolve();
  });
});

harnessWs.on('message', (data) => {
  const uint8 = new Uint8Array(data);
  const decoder = decoding.createDecoder(uint8);
  const encoder = encoding.createEncoder();
  const messageType = decoding.readVarUint(decoder);

  if (messageType === 0) {
    encoding.writeVarUint(encoder, 0);
    syncProtocol.readSyncMessage(decoder, encoder, harnessDoc, harnessWs);
    if (encoding.length(encoder) > 1) {
      harnessWs.send(encoding.toUint8Array(encoder));
    }
  } else if (messageType === 1) {
    awarenessProtocol.applyAwarenessUpdate(
      harnessAwareness,
      decoding.readVarUint8Array(decoder),
      harnessWs
    );
  }
});

// Connect Editor Agent
console.log('[Step 1] Connecting Editor-Agent (Autonomous)...');
const editorAgent = new LiveShareAgent({
  syncServerUrl: `ws://localhost:${syncPort}`,
  roomName,
  sandboxUrl: `http://localhost:${sandboxPort}`,
  agentId: 'editor-agent-01',
  agentName: 'Editor Agent (Autonomous)',
});
await editorAgent.connect();

// Connect Navigator Agent
console.log('[Step 1] Connecting Navigator-Agent (Reactive)...');
const navigatorAgent = new NavigatorAgent({
  syncServerUrl: `ws://localhost:${syncPort}`,
  roomName,
  sandboxUrl: `http://localhost:${sandboxPort}`,
  language: 'javascript',
  agentId: 'navigator-agent-01',
  agentName: 'Navigator Agent (Reactive)',
  debounceMs: 250,
});
await navigatorAgent.connect();

// Wait for awareness synchronization across peers
await new Promise((r) => setTimeout(r, 400));

console.log('[Harness Online Participants]:');
harnessPeers.forEach((user, id) => {
  console.log(` - ${user.name} [Role: ${user.role}] (${id})`);
});

assert(harnessPeers.has('harness-human'), 'Harness human must be in participants list');
assert(harnessPeers.has('editor-agent-01'), 'Editor Agent must be in participants list');
assert(harnessPeers.has('navigator-agent-01'), 'Navigator Agent must be in participants list');
assert.strictEqual(harnessPeers.get('editor-agent-01').role, 'editor');
assert.strictEqual(harnessPeers.get('navigator-agent-01').role, 'navigator');
console.log('✓ STEP 1 PASSED: All 3 participants (Human Editor, Editor Agent, Navigator Agent) present in room!');

// -------------------------------------------------------------
// STEP 2: Trigger Editor-Agent with Successful Task
// -------------------------------------------------------------
console.log('\n--- STEP 2: Trigger Editor-Agent with Successful Task ---');
const initialHarnessText = harnessDoc.getText('monaco').toString();
console.log(`Initial Harness Doc: ${initialHarnessText.length} chars, ${initialHarnessText.split('\n').length} lines`);

const validTask = {
  id: 'task-valid-01',
  instruction: 'Implement verified sum helper',
  proposedCode: `// Verified by Editor Agent
function add(a, b) {
  return a + b;
}
console.log("add(2, 3) =", add(2, 3));
`,
  language: 'javascript',
};

const taskResult1 = await editorAgent.processTask(validTask);
assert.strictEqual(taskResult1.applied, true, 'Task should be applied on sandbox pass');
assert.strictEqual(taskResult1.verification.success, true, 'Verification must succeed');

// Wait for Yjs delta to sync to harness
await new Promise((r) => setTimeout(r, 200));

const updatedHarnessText = harnessDoc.getText('monaco').toString();
console.log(`Updated Harness Doc: ${updatedHarnessText.length} chars, ${updatedHarnessText.split('\n').length} lines`);
assert.strictEqual(updatedHarnessText, validTask.proposedCode, 'Harness must reflect the verified editor-agent code change');
console.log('✓ STEP 2 PASSED: Editor agent verified in sandbox and applied edit live to shared room!');

// -------------------------------------------------------------
// STEP 3: Trigger Editor-Agent with Failing Task
// -------------------------------------------------------------
console.log('\n--- STEP 3: Trigger Editor-Agent with Failing Task ---');
const charsBeforeFailingTask = harnessDoc.getText('monaco').length;

const brokenTask = {
  id: 'task-broken-01',
  instruction: 'Attempt to insert invalid syntax',
  proposedCode: 'function broken() { SYNTAX_ERROR_BROKEN !!! }',
  language: 'javascript',
};

const taskResult2 = await editorAgent.processTask(brokenTask);
assert.strictEqual(taskResult2.applied, false, 'Editor agent must NOT apply broken code');
assert.strictEqual(taskResult2.verification.success, false, 'Verification must fail');

await new Promise((r) => setTimeout(r, 200));

const charsAfterFailingTask = harnessDoc.getText('monaco').length;
assert.strictEqual(charsAfterFailingTask, charsBeforeFailingTask, 'Harness document text must remain unaltered');
console.log('✓ STEP 3 PASSED: Editor agent rejected broken code; shared document remained completely untouched!');

// -------------------------------------------------------------
// STEP 4: Inject Human Edit & Verify Navigator Suggestion
// -------------------------------------------------------------
console.log('\n--- STEP 4: Inject Human Edit & Verify Reactive Navigator Suggestion ---');
const commentsMap = harnessDoc.getMap('comments');
console.log(`Initial suggestions count: ${commentsMap.size}`);
assert.strictEqual(commentsMap.size, 0, 'Suggestions feed must be initially empty');

// Hook into analysis completion
const analysisPromise = new Promise((resolve) => {
  navigatorAgent.onAnalysisComplete = resolve;
});

// Human injects code with anti-pattern 'var counter = 0;'
console.log('[Harness Injector] Appending: "var counter = 0;"');
harnessDoc.transact(() => {
  harnessDoc.getText('monaco').insert(harnessDoc.getText('monaco').length, 'var counter = 0;\n');
});
// Send update to sync server
const updateEnc = encoding.createEncoder();
encoding.writeVarUint(updateEnc, 0);
syncProtocol.writeUpdate(updateEnc, Y.encodeStateAsUpdate(harnessDoc));
harnessWs.send(encoding.toUint8Array(updateEnc));

// Wait for debounce + sandbox check + suggestion post
console.log('[Navigator] Waiting for debounce silence window and sandbox check...');
await analysisPromise;
await new Promise((r) => setTimeout(r, 200));

console.log(`Updated suggestions count in harness: ${commentsMap.size}`);
assert.strictEqual(commentsMap.size, 1, 'Navigator suggestions count must become 1');

let postedSuggestion = null;
commentsMap.forEach((thread) => {
  if (thread && thread.type === 'suggestion') {
    postedSuggestion = thread;
  }
});

assert(postedSuggestion !== null, 'Suggestion thread must exist in comments map');
assert.strictEqual(
  postedSuggestion.proposedReplacement,
  'let counter = 0;',
  'Proposed replacement must be "let counter = 0;"'
);
assert.strictEqual(
  postedSuggestion.snippet,
  'var counter = 0;',
  'Snippet must match injected code'
);
console.log(`✓ Suggestion surfaced: "${postedSuggestion.comments[0]?.text}"`);
console.log(`✓ Proposed replacement: "${postedSuggestion.proposedReplacement}"`);
console.log('✓ STEP 4 PASSED: Navigator debounced, verified in sandbox, and surfaced anchored suggestion!');

// -------------------------------------------------------------
// STEP 5: Navigator Connection Direct Write Rejection Test
// -------------------------------------------------------------
console.log('\n--- STEP 5: Attempt Direct Write from Navigator Connection (Security Misuse Test) ---');
const docTextBeforeMisuse = harnessDoc.getText('monaco').toString();
const docLenBeforeMisuse = docTextBeforeMisuse.length;

// Create malicious text update attempting to overwrite Y.Text('monaco') from navigator client
const rogueDoc = new Y.Doc();
rogueDoc.getText('monaco').insert(0, '// MALICIOUS TEXT WRITE FROM NAVIGATOR\n');
const rogueUpdate = Y.encodeStateAsUpdate(rogueDoc, Y.encodeStateVector(navigatorAgent.doc));

// Send raw write update from navigator WebSocket
const rogueEnc = encoding.createEncoder();
encoding.writeVarUint(rogueEnc, 0);
syncProtocol.writeUpdate(rogueEnc, rogueUpdate);
navigatorAgent.ws.send(encoding.toUint8Array(rogueEnc));

await new Promise((r) => setTimeout(r, 300));

const docTextAfterMisuse = harnessDoc.getText('monaco').toString();
assert.strictEqual(docTextAfterMisuse, docTextBeforeMisuse, 'Server MUST drop direct text write from navigator!');
assert.strictEqual(docTextAfterMisuse.length, docLenBeforeMisuse, 'Document length must not change');

const securityDrops = capturedLogs.filter((l) =>
  l.text.includes('Dropped text-modifying write from navigator')
);
assert(securityDrops.length >= 1, 'Server must log security drop for navigator text write');
console.log(`✓ Server security log confirmed: "${securityDrops[securityDrops.length - 1].text}"`);
console.log('✓ STEP 5 PASSED: Server dropped direct text write from navigator connection!');

// Cleanup
editorAgent.close();
navigatorAgent.close();
harnessWs.close();
syncHttp.close();
sandboxHttp.close();

console.log('\n=== ALL 5 VERIFICATION STEPS PASSED SUCCESSFULLY! ===\n');
process.exit(0);
