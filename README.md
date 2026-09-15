# GlassCode — Human + AI Real-Time Collaborative Code Engine

GlassCode is a self-hosted, real-time collaborative code engine where human developers and autonomous AI agents collaborate in a shared live session. Changes are synchronized at sub-50ms latency using Yjs CRDTs over WebSockets, with every proposed code modification verified in an isolated Docker / gVisor sandbox before surfacing or committing.

---

## Key Capabilities

1. **Conflict-Free Real-Time Synchronization (Yjs CRDTs)**:
   - State-vector based delta replication over `y-websocket`.
   - Ephemeral presence awareness (cursors, selections, online peers).
   - Server-side seeded rooms ensuring zero bootstrapping duplication races.

2. **Autonomous Headless Editor Agent (Editor Role)**:
   - Connects as a headless Yjs client with cryptographic JWT auth.
   - Takes task instructions, applies proposed diffs to an isolated scratch copy, and executes them in the Docker / gVisor sandbox.
   - Only on sandbox success (`exitCode === 0`), commits the verified patch to the shared document via `Y.Doc.transact()`.

3. **Reactive AI Navigator Pairing Mode (Navigator Role)**:
   - Reactively watches live `Y.Text` document deltas with configurable silence debouncing (~2.5s).
   - Automatically detects common anti-patterns or bugs, tests candidate fixes in the sandbox, and surfaces anchored suggestions into the shared comments `Y.Map`.
   - **Strict Invariant**: The Navigator Agent never writes code directly to the document. Suggestions are accepted solely by the human driver via their own client connection's `doc.transact()`.

4. **Dual-Layer Role & Write Security**:
   - Roles: `editor`, `viewer`, `commenter`, `navigator`.
   - The sync server enforces permission boundaries at the binary protocol level: direct text-modifying writes from non-editor connections are dropped and logged with `[SECURITY]` warnings.

5. **Hardened Sandbox Execution**:
   - Ephemeral Docker / gVisor (`runsc`) container execution.
   - Root filesystem mounted read-only (`--read-only`), outbound network disabled (`--network=none`), memory and CPU limits, and hard timeout enforcement.

---

## Repository Structure

- `server/` — Node.js & TypeScript Yjs WebSocket sync server with JWT auth and selective write enforcement.
- `sandbox/` — Docker / gVisor execution microservice (`POST /execute`, `POST /execute-code`).
- `agent/` — Headless AI agents:
  - `agent.ts` — Autonomous Editor Agent
  - `navigator.ts` — Reactive AI Navigator Agent
- `client/` — GlassCode Web App & Scoped Test Harness with glassmorphic UI, real-time telemetry feed, text injection driver, and suggestion review actions.

---

## Permission Matrix

| Role | Sync Server (Code Text) | Comments / Suggestions `Y.Map` | Presence Awareness |
| :--- | :--- | :--- | :--- |
| **editor** | Full Read & Write | Full Read & Write | Broadcast & Listen |
| **navigator** | Read-Only (Writes Dropped) | Can post/reply suggestions | Broadcast & Listen |
| **commenter** | Read-Only (Writes Dropped) | Can post/reply comments | Broadcast & Listen |
| **viewer** | Read-Only (Writes Dropped) | Read-Only (Writes Dropped) | Broadcast & Listen |

---

## Quick Start

### 1. Install & Build All Services
```bash
npm run build
```

### 2. Run Test Suites
```bash
# Run all verification suites
npm run test:all

# Individual suites:
npm run test:sync        # Phase 3 (Sync), Phase 4 (Presence), Phase 5 (Roles)
npm run test:sandbox     # Phase 6 (Docker/gVisor sandbox isolation & timeouts)
npm run test:agent       # Phase 7 (Autonomous Editor Agent)
npm run test:navigator   # Navigator Agent 4-phase acceptance suite & write audit
npm run test:live        # Live multi-agent harness integration verification
npm run test:comments    # Phase 8 (RelativePosition CRDT comment anchoring)
```

### 3. Start Development Services
```bash
# Terminal 1: Sync Server (Port 1234)
npm run dev:server

# Terminal 2: Sandbox Execution Service (Port 4000)
npm run dev:sandbox

# Terminal 3: Client App / Test Harness (Port 5173)
npm run dev:client

# Terminal 4: Headless AI Agent (Navigator or Editor mode)
npm run dev:agent
```

Open [http://localhost:5173/](http://localhost:5173/) in your browser to view the GlassCode Overview or join a Live Session room.
