import WebSocket from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import jwt from 'jsonwebtoken';
import { SandboxVerifier, type VerificationResult } from './verifier.js';

// ─────────────────────────────────────────────────────
//  Code Analyzer — detects common issues by pattern matching
// ─────────────────────────────────────────────────────

export interface CodeIssue {
  line: number;
  lineContent: string;
  message: string;
  suggestedFix: string; // the fixed line content
}

/**
 * Simple pattern-based code analyzer.
 * Detects common anti-patterns in Python and JavaScript and proposes line-level fixes.
 */
export function analyzeCode(code: string, language: string): CodeIssue[] {
  const lines = code.split('\n');
  const issues: CodeIssue[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    if (language === 'python') {
      // Bare except clause
      if (/^\s*except\s*:\s*$/.test(line)) {
        issues.push({
          line: lineNum,
          lineContent: line,
          message: 'Bare `except:` catches all exceptions including SystemExit and KeyboardInterrupt. Use `except Exception:` instead.',
          suggestedFix: line.replace(/except\s*:/, 'except Exception:'),
        });
      }
      // == None → is None
      if (/==\s*None/.test(line) && !/is\s+None/.test(line)) {
        issues.push({
          line: lineNum,
          lineContent: line,
          message: 'Use `is None` instead of `== None` for identity comparison (PEP 8).',
          suggestedFix: line.replace(/==\s*None/g, 'is None'),
        });
      }
      // != None → is not None
      if (/!=\s*None/.test(line) && !/is\s+not\s+None/.test(line)) {
        issues.push({
          line: lineNum,
          lineContent: line,
          message: 'Use `is not None` instead of `!= None` for identity comparison (PEP 8).',
          suggestedFix: line.replace(/!=\s*None/g, 'is not None'),
        });
      }
    }

    if (language === 'javascript') {
      // var → let
      if (/\bvar\s+/.test(line)) {
        issues.push({
          line: lineNum,
          lineContent: line,
          message: 'Use `let` or `const` instead of `var` for block-scoped variable declarations.',
          suggestedFix: line.replace(/\bvar\s+/, 'let '),
        });
      }
      // == but not === (loose equality)
      if (/[^!=!]==[^=]/.test(line) && !/===/.test(line)) {
        issues.push({
          line: lineNum,
          lineContent: line,
          message: 'Use strict equality `===` instead of loose equality `==` to avoid type coercion.',
          suggestedFix: line.replace(/([^!=!])={2}([^=])/g, '$1===$2'),
        });
      }
    }
  }

  return issues;
}

// ─────────────────────────────────────────────────────
//  Navigator Agent — reactive pair-programming partner
// ─────────────────────────────────────────────────────

export interface NavigatorConfig {
  syncServerUrl: string;       // e.g. 'ws://localhost:1234'
  roomName: string;
  language: 'python' | 'javascript';
  agentId?: string;
  agentName?: string;
  jwtSecret?: string;
  sandboxUrl?: string;
  debounceMs?: number;         // silence window in ms (default 2500)
}

export class NavigatorAgent {
  config: NavigatorConfig;
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  ws: WebSocket | null = null;
  verifier: SandboxVerifier;
  connected: boolean = false;
  token: string;

  // Debounce state
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private debounceMs: number;

  // Analysis state
  private analysisInProgress = false;
  private lastAnalyzedCode = '';
  private suggestedIssueKeys = new Set<string>(); // track already-suggested issues

  // Observable counters (for testing)
  analysisCount = 0;
  suggestionsPosted = 0;
  suggestionsRejected = 0;

  // Event callbacks (for testing)
  onAnalysisStart?: () => void;
  onAnalysisComplete?: (result: { issues: CodeIssue[]; posted: number; rejected: number }) => void;

  constructor(config: NavigatorConfig) {
    this.config = config;
    this.debounceMs = config.debounceMs ?? 2500;
    this.doc = new Y.Doc();
    this.awareness = new awarenessProtocol.Awareness(this.doc);
    this.verifier = new SandboxVerifier(config.sandboxUrl || 'http://localhost:4000');

    const agentId = config.agentId || 'navigator-agent';
    const agentName = config.agentName || 'Navigator Agent';
    const secret = config.jwtSecret || 'glasscode-secure-secret-key-live-share';

    // Navigator JWT — NOT editor; this agent must never write text
    this.token = jwt.sign(
      {
        userId: agentId,
        role: 'navigator',   // <── critical: navigator role
        name: agentName,
        color: '#f59e0b',
      },
      secret,
      { expiresIn: '7d' }
    );
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `${this.config.syncServerUrl}/${this.config.roomName}?token=${this.token}`;
      console.log(`[Navigator] Connecting to ${url}...`);

      this.ws = new WebSocket(url);
      this.ws.binaryType = 'arraybuffer';

      // Transmit local doc updates via WebSocket (for comments map writes)
      this.doc.on('update', (update: Uint8Array, origin: unknown) => {
        if (origin !== this && this.connected && this.ws?.readyState === WebSocket.OPEN) {
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, 0);
          syncProtocol.writeUpdate(encoder, update);
          this.ws.send(encoding.toUint8Array(encoder));
        }
      });

      // Transmit local awareness updates
      this.awareness.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
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
        console.log(`[Navigator] Connected to room "${this.config.roomName}" as navigator peer`);

        // Send SyncStep1
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, 0); // messageSync
        syncProtocol.writeSyncStep1(encoder, this.doc);
        this.ws?.send(encoding.toUint8Array(encoder));

        // Announce presence
        this.awareness.setLocalStateField('user', {
          userId: this.config.agentId || 'navigator-agent',
          name: this.config.agentName || 'Navigator Agent',
          role: 'navigator',
          color: '#f59e0b',
        });

        // Broadcast initial awareness state
        const awarenessEncoder = encoding.createEncoder();
        encoding.writeVarUint(awarenessEncoder, 1);
        encoding.writeVarUint8Array(
          awarenessEncoder,
          awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.doc.clientID])
        );
        this.ws?.send(encoding.toUint8Array(awarenessEncoder));

        // Start watching for text changes (reactive, not polled)
        this.startWatching();
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
        console.error('[Navigator] WebSocket error:', err);
        reject(err);
      });

      this.ws.on('close', () => {
        this.connected = false;
        console.log('[Navigator] Disconnected from room');
      });
    });
  }

  /**
   * Subscribe to Y.Text changes (not Y.Doc updates, to avoid reacting to
   * our own comment writes). Debounce before triggering analysis.
   */
  private startWatching(): void {
    const yText = this.doc.getText('monaco');
    yText.observe(() => {
      this.scheduleAnalysis();
    });
    console.log('[Navigator] Watching Y.Text("monaco") for changes...');
  }

  private scheduleAnalysis(): void {
    // Reset debounce timer on every text change
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.runAnalysis().catch((err) => {
        console.error('[Navigator] Analysis error:', err);
      });
    }, this.debounceMs);
  }

  getCurrentCode(): string {
    return this.doc.getText('monaco').toString();
  }

  /**
   * Core analysis loop:
   * 1. Read current code
   * 2. Detect issues via pattern matching
   * 3. For each issue: build proposed fix → verify in sandbox → post or discard
   */
  private async runAnalysis(): Promise<void> {
    const code = this.getCurrentCode();

    // Skip if code hasn't changed since last analysis
    if (code === this.lastAnalyzedCode) return;
    // Skip if analysis is already in progress
    if (this.analysisInProgress) return;

    this.analysisInProgress = true;
    this.lastAnalyzedCode = code;
    this.analysisCount++;

    console.log(`[Navigator] Analysis #${this.analysisCount} triggered (${code.length} chars)`);
    this.onAnalysisStart?.();

    let posted = 0;
    let rejected = 0;

    try {
      const issues = analyzeCode(code, this.config.language);
      console.log(`[Navigator] Found ${issues.length} potential issue(s)`);

      for (const issue of issues) {
        // Skip already-suggested issues (same line + same fix)
        const issueKey = `${issue.line}:${issue.suggestedFix}`;
        if (this.suggestedIssueKeys.has(issueKey)) continue;

        // Check if code has changed during analysis (user typed more)
        if (this.getCurrentCode() !== code) {
          console.log('[Navigator] Code changed during analysis, aborting');
          break;
        }

        // Build the full proposed code with the fix applied
        const lines = code.split('\n');
        lines[issue.line - 1] = issue.suggestedFix;
        const proposedCode = lines.join('\n');

        // Verify the fixed code passes sandbox execution
        let verification: VerificationResult;
        try {
          verification = await this.verifier.verifyCode(proposedCode, this.config.language);
        } catch (err) {
          console.warn(`[Navigator] Sandbox verification error, skipping:`, err);
          rejected++;
          this.suggestionsRejected++;
          continue;
        }

        if (!verification.success) {
          console.log(
            `[Navigator] Suggestion REJECTED (sandbox exit ${verification.exitCode}): ${issue.message}`
          );
          rejected++;
          this.suggestionsRejected++;
          continue;
        }

        // Code hasn't changed + sandbox passed → post the suggestion
        if (this.getCurrentCode() !== code) {
          console.log('[Navigator] Code changed during verification, discarding');
          break;
        }

        this.postSuggestion(issue);
        this.suggestedIssueKeys.add(issueKey);
        posted++;
        this.suggestionsPosted++;
      }

      this.onAnalysisComplete?.({ issues, posted, rejected });
    } finally {
      this.analysisInProgress = false;
    }
  }

  /**
   * Post a verified suggestion to the comments Y.Map.
   * The agent writes ONLY to the comments map — never to Y.Text.
   */
  private postSuggestion(issue: CodeIssue): void {
    const yText = this.doc.getText('monaco');
    const commentsMap = this.doc.getMap('comments');
    const code = yText.toString();
    const lines = code.split('\n');

    // Compute byte offset for the issue's line
    let startOffset = 0;
    for (let i = 0; i < Math.min(issue.line - 1, lines.length); i++) {
      startOffset += lines[i].length + 1; // +1 for newline
    }
    const endOffset = startOffset + (lines[issue.line - 1]?.length ?? 0);

    // Create RelativePositions for the replacement range
    const relPos = Y.createRelativePositionFromTypeIndex(yText, startOffset);
    const relPosStart = Y.createRelativePositionFromTypeIndex(yText, startOffset);
    const relPosEnd = Y.createRelativePositionFromTypeIndex(yText, endOffset);

    const threadId = `nav-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

    const suggestionThread = {
      id: threadId,
      relPos,
      relPosStart,
      relPosEnd,
      initialLine: issue.line,
      snippet: issue.lineContent.trim(),
      resolved: false,
      type: 'suggestion',
      proposedReplacement: issue.suggestedFix,
      comments: [
        {
          id: `nc-${Date.now()}`,
          author: this.config.agentName || 'Navigator Agent',
          role: 'navigator',
          color: '#f59e0b',
          text: `💡 ${issue.message}`,
          createdAt: new Date().toLocaleTimeString(),
        },
      ],
    };

    console.log(`[Navigator] Posting suggestion at line ${issue.line}: "${issue.message}"`);

    // Write to comments map ONLY — no Y.Text transact()
    this.doc.transact(() => {
      commentsMap.set(threadId, suggestionThread);
    });
  }

  /**
   * Reset tracked state (for testing — allows re-analysis of same code)
   */
  resetState(): void {
    this.lastAnalyzedCode = '';
    this.suggestedIssueKeys.clear();
    this.analysisCount = 0;
    this.suggestionsPosted = 0;
    this.suggestionsRejected = 0;
  }

  close(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
