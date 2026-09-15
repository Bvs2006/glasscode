import WebSocket from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import jwt from 'jsonwebtoken';
import { SandboxVerifier, type VerificationResult } from './verifier.js';

export interface AgentConfig {
  syncServerUrl: string; // e.g. 'ws://localhost:1234'
  roomName: string;
  agentId?: string;
  agentName?: string;
  jwtSecret?: string;
  sandboxUrl?: string;
}

export interface TaskRequest {
  id: string;
  instruction: string;
  proposedCode: string;
  language: 'python' | 'javascript';
}

export class LiveShareAgent {
  config: AgentConfig;
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  ws: WebSocket | null = null;
  verifier: SandboxVerifier;
  connected: boolean = false;
  token: string;

  constructor(config: AgentConfig) {
    this.config = config;
    this.doc = new Y.Doc();
    this.awareness = new awarenessProtocol.Awareness(this.doc);
    this.verifier = new SandboxVerifier(config.sandboxUrl || 'http://localhost:4000');

    const agentId = config.agentId || 'ai-agent-headless';
    const agentName = config.agentName || 'AI Agent (Autonomous)';
    const secret = config.jwtSecret || 'glasscode-secure-secret-key-live-share';

    this.token = jwt.sign(
      {
        userId: agentId,
        role: 'editor',
        name: agentName,
        color: '#a855f7',
      },
      secret,
      { expiresIn: '7d' }
    );
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `${this.config.syncServerUrl}/${this.config.roomName}?token=${this.token}`;
      console.log(`[Headless Agent] Connecting to ${url}...`);

      this.ws = new WebSocket(url);
      this.ws.binaryType = 'arraybuffer';

      // Transmit local doc updates via WebSocket
      this.doc.on('update', (update, origin) => {
        if (origin !== this && this.connected && this.ws?.readyState === WebSocket.OPEN) {
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, 0);
          syncProtocol.writeUpdate(encoder, update);
          this.ws.send(encoding.toUint8Array(encoder));
        }
      });

      // Transmit local awareness updates
      this.awareness.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: any) => {
        if (origin === 'local' && this.connected && this.ws?.readyState === WebSocket.OPEN) {
          const changed = added.concat(updated, removed);
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, 1);
          encoding.writeVarUint8Array(
            encoder,
            awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed)
          );
          this.ws.send(encoding.toUint8Array(encoder));
        }
      });

      this.ws.on('open', () => {
        this.connected = true;
        console.log(`[Headless Agent] Connected as headless peer to room "${this.config.roomName}"`);

        // Send SyncStep1
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, 0); // messageSync
        syncProtocol.writeSyncStep1(encoder, this.doc);
        this.ws?.send(encoding.toUint8Array(encoder));

        // Announce presence in awareness
        this.awareness.setLocalStateField('user', {
          userId: this.config.agentId || 'ai-agent-headless',
          name: this.config.agentName || 'AI Agent (Autonomous)',
          role: 'editor',
          color: '#a855f7',
        });

        // Broadcast initial awareness
        const awarenessEncoder = encoding.createEncoder();
        encoding.writeVarUint(awarenessEncoder, 1);
        encoding.writeVarUint8Array(
          awarenessEncoder,
          awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.doc.clientID])
        );
        this.ws?.send(encoding.toUint8Array(awarenessEncoder));

        resolve();
      });

      this.ws.on('message', (data: ArrayBuffer | Buffer) => {
        const uint8 = new Uint8Array(data as ArrayBuffer);
        const decoder = decoding.createDecoder(uint8);
        const encoder = encoding.createEncoder();
        const messageType = decoding.readVarUint(decoder);

        if (messageType === 0) {
          // messageSync
          encoding.writeVarUint(encoder, 0);
          syncProtocol.readSyncMessage(decoder, encoder, this.doc, this);
          if (encoding.length(encoder) > 1 && this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(encoding.toUint8Array(encoder));
          }
        } else if (messageType === 1) {
          // messageAwareness
          awarenessProtocol.applyAwarenessUpdate(
            this.awareness,
            decoding.readVarUint8Array(decoder),
            this
          );
        }
      });

      this.ws.on('error', (err) => {
        console.error('[Headless Agent] WebSocket error:', err);
        reject(err);
      });

      this.ws.on('close', () => {
        this.connected = false;
        console.log('[Headless Agent] Disconnected from room');
      });
    });
  }

  getCurrentCode(textName = 'monaco'): string {
    return this.doc.getText(textName).toString();
  }

  /**
   * Process a code edit task:
   * 1. Read document
   * 2. Verify proposed change inside Docker/gVisor sandbox
   * 3. Apply via doc.transact() ONLY IF verification succeeds!
   */
  async processTask(task: TaskRequest): Promise<{ applied: boolean; verification: VerificationResult }> {
    console.log(`\n[Headless Agent] Processing task "${task.instruction}" (ID: ${task.id})...`);
    console.log(`[Headless Agent] Current code length: ${this.getCurrentCode().length} chars`);

    // Verify inside sandbox service
    const verification = await this.verifier.verifyCode(task.proposedCode, task.language);

    if (!verification.success) {
      console.warn(`[Headless Agent] ABORTING: Sandbox verification failed (exit ${verification.exitCode}). Code will NOT be written to shared doc.`);
      return { applied: false, verification };
    }

    console.log(`[Headless Agent] Verification SUCCEEDED. Committing changes via Y.Doc.transact()...`);
    const yText = this.doc.getText('monaco');

    // Atomic transaction updating shared CRDT document
    this.doc.transact(() => {
      yText.delete(0, yText.length);
      yText.insert(0, task.proposedCode);
    });

    console.log(`[Headless Agent] Transacted ${task.proposedCode.length} characters to shared document. Live update dispatched to peers.`);
    return { applied: true, verification };
  }

  close(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
