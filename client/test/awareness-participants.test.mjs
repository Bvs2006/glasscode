import WebSocket from '../../server/node_modules/ws/index.js';
const { WebSocketServer } = WebSocket;
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import assert from 'assert';
import http from 'http';
import { setupConnection } from '../../server/dist/y-websocket-server.js';

console.log('=== Starting Test Suite: Client Awareness & Online Participants ===\n');

// 1. Setup ephemeral WebSocket server on dynamic port
const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('OK');
});
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url || '', `http://${request.headers.host || 'localhost'}`);
  const docName = url.pathname.slice(1) || 'test-room';
  wss.handleUpgrade(request, socket, head, (ws) => {
    setupConnection(ws, request, docName);
  });
});

await new Promise((resolve) => server.listen(0, resolve));
const PORT = server.address().port;
const SERVER_URL = `ws://localhost:${PORT}`;
console.log(`[Test Server] Ephemeral sync server running on port ${PORT}`);

const testRoom = 'test-awareness-' + Date.now();

// Test 1: Single client sets local state and immediately reflects (1) participant with role
console.log('[Test 1] Single client connects with role "navigator"');
const doc1 = new Y.Doc();
const provider1 = new WebsocketProvider(SERVER_URL, testRoom, doc1, { WebSocketPolyfill: WebSocket });

let latestStates1 = [];
const syncStates1 = () => {
  const states = [];
  provider1.awareness.getStates().forEach((state, clientId) => {
    if (state && state.user) {
      states.push({ clientId, user: state.user });
    }
  });
  latestStates1 = states;
};

provider1.awareness.on('change', syncStates1);
provider1.awareness.setLocalStateField('user', {
  userId: 'user-linc2',
  name: 'user-linc2',
  color: '#38bdf8',
  role: 'navigator',
});
syncStates1();

// Local state should be immediately available (count = 1)
assert.strictEqual(latestStates1.length, 1, 'Client must immediately count itself as online participant');
assert.strictEqual(latestStates1[0].user.userId, 'user-linc2');
assert.strictEqual(latestStates1[0].user.role, 'navigator');
console.log('✓ Initial local participant count: 1 (self with role: navigator)');

// Wait for connection to open
await new Promise((resolve) => {
  if (provider1.wsconnected) return resolve();
  provider1.on('status', ({ status }) => {
    if (status === 'connected') resolve();
  });
});
console.log('✓ Client 1 connected to sync server');

// Test 2: Second client connects with role "editor" and verify both clients see 2 participants
console.log('\n[Test 2] Second client connects with role "editor"');
const doc2 = new Y.Doc();
const provider2 = new WebsocketProvider(SERVER_URL, testRoom, doc2, { WebSocketPolyfill: WebSocket });

let latestStates2 = [];
const syncStates2 = () => {
  const states = [];
  provider2.awareness.getStates().forEach((state, clientId) => {
    if (state && state.user) {
      states.push({ clientId, user: state.user });
    }
  });
  latestStates2 = states;
};

provider2.awareness.on('change', syncStates2);
provider2.awareness.setLocalStateField('user', {
  userId: 'user-editor1',
  name: 'user-editor1',
  color: '#34d399',
  role: 'editor',
});
syncStates2();

// Wait for awareness propagation between client 1 and client 2
await new Promise((resolve) => {
  const interval = setInterval(() => {
    syncStates1();
    syncStates2();
    if (latestStates1.length === 2 && latestStates2.length === 2) {
      clearInterval(interval);
      resolve();
    }
  }, 50);
});

console.log('✓ Client 1 observes participants:', latestStates1.map(s => s.user.userId + ' (' + s.user.role + ')'));
console.log('✓ Client 2 observes participants:', latestStates2.map(s => s.user.userId + ' (' + s.user.role + ')'));

assert.strictEqual(latestStates1.length, 2, 'Client 1 should see both participants');
assert.strictEqual(latestStates2.length, 2, 'Client 2 should see both participants');

// Test 3: Local update reactivity - Client 1 updates role to commenter
console.log('\n[Test 3] Local client updates its own presence/role');
provider1.awareness.setLocalStateField('user', {
  userId: 'user-linc2',
  name: 'user-linc2',
  color: '#c084fc',
  role: 'commenter',
});

// Immediate local reactivity
syncStates1();
const updatedSelf = latestStates1.find(s => s.user.userId === 'user-linc2');
assert.strictEqual(updatedSelf.user.role, 'commenter', 'Local awareness update must immediately reflect');
console.log('✓ Client 1 immediately reflects its updated role locally: commenter');

// Cleanup
provider1.destroy();
provider2.destroy();
doc1.destroy();
doc2.destroy();
await new Promise((resolve) => server.close(resolve));

console.log('\n=== All Awareness Participant Tests PASSED! ===');
process.exit(0);
