import { WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { verifyToken, type UserRole, type TokenPayload } from './auth.js';
import { DEFAULT_SAMPLES } from './samples.js';

export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;

export interface AuthenticatedWebSocket extends WebSocket {
  userId: string;
  userRole: UserRole;
  userName?: string;
  userColor?: string;
  isAlive: boolean;
}

export class LiveShareDoc extends Y.Doc {
  name: string;
  conns: Map<AuthenticatedWebSocket, Set<number>>;
  awareness: awarenessProtocol.Awareness;

  constructor(name: string) {
    super({ gc: true });
    this.name = name;
    this.conns = new Map();
    this.awareness = new awarenessProtocol.Awareness(this);
    this.awareness.setLocalState(null);

    // Broadcast awareness updates
    this.awareness.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, originConn: any) => {
      const changedClients = added.concat(updated, removed);
      if (originConn && originConn !== null) {
        const connControlledIDs = this.conns.get(originConn);
        if (connControlledIDs) {
          added.forEach((clientID) => connControlledIDs.add(clientID));
          removed.forEach((clientID) => connControlledIDs.delete(clientID));
        }
      }
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(this.awareness, changedClients)
      );
      const buff = encoding.toUint8Array(encoder);
      this.conns.forEach((_, c) => {
        send(this, c, buff);
      });
    });

    // Broadcast document updates to all connected clients
    this.on('update', (update: Uint8Array, origin: any) => {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      const message = encoding.toUint8Array(encoder);
      this.conns.forEach((_, conn) => {
        // Send to all clients
        send(this, conn, message);
      });
    });
  }
}

export const docs = new Map<string, LiveShareDoc>();

/**
 * Diagnostic guard: inspects room content to detect whether boilerplate/sample
 * content has been duplicated (e.g. from an earlier client bootstrapping race).
 * Logs for observability only; does NOT auto-mutate live document text.
 */
export function checkDuplicateContentDiagnostic(docName: string, text: string): void {
  if (!text || text.length < 50) return;

  // Check 1: Boilerplate header occurrence
  const jsHeaderMatches = (text.match(/GlassCode - JavaScript Collaborative Sample/g) || []).length;
  const pyHeaderMatches = (text.match(/GlassCode - Python Collaborative Sample/g) || []).length;

  // Check 2: Repeated function definitions
  const fibMatches = (text.match(/function fibonacci/g) || []).length;
  const qsMatches = (text.match(/def quicksort/g) || []).length;

  // Check 3: Identical half repetition
  const halfLen = Math.floor(text.length / 2);
  const firstHalf = text.slice(0, halfLen).trim();
  const secondHalf = text.slice(halfLen).trim();
  const isExactDouble = firstHalf.length > 50 && firstHalf === secondHalf;

  if (jsHeaderMatches > 1 || pyHeaderMatches > 1 || fibMatches > 1 || qsMatches > 1 || isExactDouble) {
    console.warn(
      `[DIAGNOSTIC GUARD] Duplicate content detected in room "${docName}" (${text.length} chars, ` +
      `jsHeader: ${jsHeaderMatches}, pyHeader: ${pyHeaderMatches}, fibonacci: ${fibMatches}, quicksort: ${qsMatches}). ` +
      `Logging for observability; not auto-mutating document.`
    );
  }
}

export function getOrCreateDoc(
  docName: string,
  shouldSeed: boolean = (docName.startsWith('demo-') || docName === 'default-room')
): LiveShareDoc {
  let doc = docs.get(docName);
  if (!doc) {
    doc = new LiveShareDoc(docName);
    docs.set(docName, doc);

    // Seed initial content once upon room creation on the server
    const yText = doc.getText('monaco');
    if (shouldSeed && yText.length === 0) {
      const isPython = docName.endsWith('-python') || docName.includes('python');
      const seedContent = isPython ? DEFAULT_SAMPLES.python : DEFAULT_SAMPLES.javascript;
      doc.transact(() => {
        yText.insert(0, seedContent);
      });
      console.log(`[GlassCode] Seeded initial content for new room "${docName}" (${seedContent.length} chars)`);
    }
  }
  return doc;
}

function send(doc: LiveShareDoc, conn: AuthenticatedWebSocket, message: Uint8Array): void {
  if (conn.readyState !== WebSocket.CONNECTING && conn.readyState !== WebSocket.OPEN) {
    closeConn(doc, conn);
    return;
  }
  try {
    conn.send(message, (err) => {
      if (err) {
        closeConn(doc, conn);
      }
    });
  } catch (e) {
    closeConn(doc, conn);
  }
}

function closeConn(doc: LiveShareDoc, conn: AuthenticatedWebSocket): void {
  if (doc.conns.has(conn)) {
    const controlledIds = doc.conns.get(conn);
    doc.conns.delete(conn);
    if (controlledIds && controlledIds.size > 0) {
      awarenessProtocol.removeAwarenessStates(doc.awareness, Array.from(controlledIds), null);
    }
  }
  try {
    conn.close();
  } catch (e) {}
}

/**
 * Check whether a Yjs update would modify the Y.Text('monaco') content.
 * Creates a temporary Y.Doc clone, applies the update, and compares text.
 * Used to enforce selective write permissions for navigator/commenter roles.
 */
function isTextModifyingUpdate(doc: LiveShareDoc, updateBytes: Uint8Array): boolean {
  const currentText = doc.getText('monaco').toString();

  const tempDoc = new Y.Doc();
  try {
    Y.applyUpdate(tempDoc, Y.encodeStateAsUpdate(doc));
    Y.applyUpdate(tempDoc, updateBytes);
    const proposedText = tempDoc.getText('monaco').toString();
    return currentText !== proposedText;
  } catch {
    // If we can't determine, reject as a safety measure
    return true;
  } finally {
    tempDoc.destroy();
  }
}

/**
 * Custom message listener with server-side write permission enforcement.
 *
 * Write policy:
 *  - `editor`     → full write access (text + comments)
 *  - `navigator`  → comments Y.Map only; text Y.Text writes are dropped
 *  - `commenter`  → comments Y.Map only; text Y.Text writes are dropped
 *  - `viewer`     → all writes dropped
 */
function handleIncomingMessage(
  conn: AuthenticatedWebSocket,
  doc: LiveShareDoc,
  message: Uint8Array
): void {
  try {
    const encoder = encoding.createEncoder();
    const decoder = decoding.createDecoder(message);
    const messageType = decoding.readVarUint(decoder);

    switch (messageType) {
      case MESSAGE_SYNC: {
        encoding.writeVarUint(encoder, MESSAGE_SYNC);

        // Peek at sync sub-message type
        const syncMessageType = decoding.readVarUint(decoder);

        if (syncMessageType === syncProtocol.messageYjsSyncStep1) {
          // Read request (sending state vector to get updates) - ALL roles allowed
          syncProtocol.readSyncStep1(decoder, encoder, doc);
        } else if (
          syncMessageType === syncProtocol.messageYjsSyncStep2 ||
          syncMessageType === syncProtocol.messageYjsUpdate
        ) {
          // Write request (sending updates to be applied to doc)

          if (conn.userRole === 'viewer') {
            // Viewers: drop ALL writes unconditionally
            console.warn(
              `[SECURITY] Dropped write from viewer (${conn.userId}) in room "${doc.name}"`
            );
            return;
          }

          if (conn.userRole === 'navigator' || conn.userRole === 'commenter') {
            // Navigator/Commenter: allow comments-only writes, block text writes
            const updateBytes = decoding.readVarUint8Array(decoder);

            if (isTextModifyingUpdate(doc, updateBytes)) {
              console.warn(
                `[SECURITY] Dropped text-modifying write from ${conn.userRole} (${conn.userId}) in room "${doc.name}"`
              );
              return;
            }

            // Comments-only update — apply it
            console.log(
              `[LiveShare] Comments-only update applied from ${conn.userRole} ${conn.userId} in room "${doc.name}"`
            );
            Y.applyUpdate(doc, updateBytes, conn);
            return;
          }

          // Editor: full write access
          console.log(
            `[LiveShare] Text update applied from editor ${conn.userId} in room "${doc.name}"`
          );
          syncProtocol.readSyncStep2(decoder, doc, conn);
        }

        if (encoding.length(encoder) > 1) {
          send(doc, conn, encoding.toUint8Array(encoder));
        }
        break;
      }
      case MESSAGE_AWARENESS: {
        // Awareness updates (cursor, selection, user info) — all roles
        awarenessProtocol.applyAwarenessUpdate(
          doc.awareness,
          decoding.readVarUint8Array(decoder),
          conn
        );
        break;
      }
      default:
        console.warn(`[LiveShare] Unknown message type received: ${messageType}`);
    }
  } catch (err) {
    console.error(`[LiveShare] Error processing message:`, err);
  }
}

/**
 * Setup WebSocket connection for a room with auth verification
 */
export function setupConnection(
  conn: WebSocket,
  req: IncomingMessage,
  docName: string
): void {
  const authConn = conn as AuthenticatedWebSocket;
  authConn.binaryType = 'arraybuffer';
  authConn.isAlive = true;

  // Parse token from query parameter e.g. ws://host/roomName?token=xyz
  const urlObj = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
  const token = urlObj.searchParams.get('token');

  let userPayload: TokenPayload | null = null;
  if (token) {
    userPayload = verifyToken(token);
  }

  if (userPayload) {
    authConn.userId = userPayload.userId;
    authConn.userRole = userPayload.role;
    authConn.userName = userPayload.name || `User-${userPayload.userId.slice(0, 4)}`;
    authConn.userColor = userPayload.color;
  } else {
    // Default fallback for development/unauthenticated connection
    const randomId = Math.random().toString(36).substring(2, 8);
    authConn.userId = `guest-${randomId}`;
    authConn.userRole = 'editor';
    authConn.userName = `Guest-${randomId}`;
  }

  console.log(
    `[LiveShare] Connected: ${authConn.userName} (${authConn.userId}) as [${authConn.userRole}] to room "${docName}"`
  );

  const doc = getOrCreateDoc(docName);
  checkDuplicateContentDiagnostic(docName, doc.getText('monaco').toString());
  doc.conns.set(authConn, new Set());

  authConn.on('message', (data: ArrayBuffer | Buffer) => {
    const uint8 = new Uint8Array(data as ArrayBuffer);
    handleIncomingMessage(authConn, doc, uint8);
  });

  authConn.on('pong', () => {
    authConn.isAlive = true;
  });

  authConn.on('close', () => {
    console.log(
      `[LiveShare] Disconnected: ${authConn.userName} (${authConn.userId}) from room "${docName}"`
    );
    closeConn(doc, authConn);
  });

  authConn.on('error', (err) => {
    console.error(`[LiveShare] Socket error for ${authConn.userId}:`, err);
    closeConn(doc, authConn);
  });

  // Initial Sync Step 1: Send our state vector so client syncs with us
  {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, doc);
    send(doc, authConn, encoding.toUint8Array(encoder));

    // Send current awareness states
    const awarenessStates = doc.awareness.getStates();
    if (awarenessStates.size > 0) {
      const awarenessEncoder = encoding.createEncoder();
      encoding.writeVarUint(awarenessEncoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(
        awarenessEncoder,
        awarenessProtocol.encodeAwarenessUpdate(
          doc.awareness,
          Array.from(awarenessStates.keys())
        )
      );
      send(doc, authConn, encoding.toUint8Array(awarenessEncoder));
    }
  }
}
