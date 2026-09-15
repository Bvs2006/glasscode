import { LiveShareAgent } from './agent.js';
import { NavigatorAgent } from './navigator.js';

const syncServerUrl = process.env.SYNC_SERVER_URL || 'ws://localhost:1234';
const roomName = process.env.ROOM_NAME || 'demo-live-room-javascript';
const sandboxUrl = process.env.SANDBOX_URL || 'http://localhost:4000';
const agentRole = (process.env.AGENT_ROLE || process.env.AGENT_MODE || 'navigator').toLowerCase();
const language = (process.env.ROOM_LANGUAGE || 'javascript') as 'python' | 'javascript';

console.log('[Agent Daemon] Starting Headless AI Agent...');
console.log(`[Agent Daemon] Target Room: ${roomName}`);
console.log(`[Agent Daemon] Sync Server: ${syncServerUrl}`);
console.log(`[Agent Daemon] Sandbox URL: ${sandboxUrl}`);
console.log(`[Agent Daemon] Agent Role: ${agentRole}`);

if (agentRole === 'navigator') {
  const navigator = new NavigatorAgent({
    syncServerUrl,
    roomName,
    language,
    sandboxUrl,
    debounceMs: parseInt(process.env.DEBOUNCE_MS || '2500', 10),
  });

  await navigator.connect();
  console.log('[Agent Daemon] Navigator Agent active. Watching document for reactive pairing suggestions.');
} else {
  const agent = new LiveShareAgent({
    syncServerUrl,
    roomName,
    sandboxUrl,
  });

  await agent.connect();
  console.log('[Agent Daemon] Editor Agent listening for session tasks. Headless peer active.');
}

