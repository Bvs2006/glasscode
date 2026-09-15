import React, { useState, useEffect, useMemo, useCallback } from 'react';
import * as Y from 'yjs';
import { LiveShareProviderManager, type UserPresence } from '../yjs/provider';

const SYNC_SERVER_URL = 'ws://localhost:1234';
const AUTH_SERVER_URL = 'http://localhost:1234';

export interface HarnessScreenProps {
  roomName: string;
  initialRole: 'editor' | 'viewer' | 'commenter' | 'navigator';
  onExit: () => void;
}

export const HarnessScreen: React.FC<HarnessScreenProps> = ({
  roomName,
  initialRole,
  onExit,
}) => {
  const [role, setRole] = useState<'editor' | 'viewer' | 'commenter' | 'navigator'>(initialRole);
  const [userId] = useState(() => `user-${Math.random().toString(36).substring(2, 7)}`);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [isSynced, setIsSynced] = useState(false);
  const [activeUsers, setActiveUsers] = useState<Array<{ clientId: number; user: UserPresence }>>([]);
  const [docText, setDocText] = useState('');
  const [updateLogs, setUpdateLogs] = useState<string[]>([]);
  const [injectInput, setInjectInput] = useState('');
  const [comments, setComments] = useState<any[]>([]);

  // Create shared Y.Doc for current room
  const doc = useMemo(() => new Y.Doc(), [roomName]);

  const refreshState = useCallback(() => {
    const text = doc.getText('monaco').toString();
    setDocText(text);

    // Read comments Y.Map
    const commentsMap = doc.getMap('comments');
    const list: any[] = [];
    commentsMap.forEach((val: any) => {
      if (val) list.push(val);
    });
    setComments(list);
  }, [doc]);

  // Connect to sync server via LiveShareProviderManager
  useEffect(() => {
    let cancelled = false;
    let manager: LiveShareProviderManager | null = null;
    const yText = doc.getText('monaco');
    const commentsMap = doc.getMap('comments');

    const handleTextUpdate = () => {
      const current = yText.toString();
      setDocText(current);
      setUpdateLogs((prev) => [
        `[${new Date().toLocaleTimeString()}] Y.Text delta received (${current.length} chars, ${current ? current.split('\n').length : 0} lines)`,
        ...prev.slice(0, 49),
      ]);
    };

    const handleCommentsUpdate = () => {
      refreshState();
      setUpdateLogs((prev) => [
        `[${new Date().toLocaleTimeString()}] Y.Map('comments') delta (${commentsMap.size} active threads)`,
        ...prev.slice(0, 49),
      ]);
    };

    yText.observe(handleTextUpdate);
    commentsMap.observe(handleCommentsUpdate);

    const initConnection = async () => {
      let token: string | undefined = undefined;
      try {
        const res = await fetch(
          `${AUTH_SERVER_URL}/auth/token?role=${role}&userId=${userId}&name=${encodeURIComponent(userId)}`
        );
        if (res.ok) {
          const data = await res.json();
          if (data.token) token = data.token;
        }
      } catch (err) {
        console.warn('[GlassCode] Auth fetch warning:', err);
      }

      if (cancelled) return;

      manager = new LiveShareProviderManager({
        serverUrl: SYNC_SERVER_URL,
        roomName,
        doc,
        token,
        user: { userId, name: userId, color: '#38bdf8', role },
        onStatusChange: (status) => {
          if (!cancelled) setConnectionStatus(status);
        },
        onSyncedChange: (synced) => {
          if (!cancelled) {
            setIsSynced(synced);
            refreshState();
          }
        },
        onAwarenessChange: (states) => {
          if (!cancelled) {
            setActiveUsers(states);
          }
        },
      });

      // Synchronize awareness state immediately
      if (!cancelled) {
        setActiveUsers(manager.getAwarenessUsers());
      }
    };

    initConnection();

    return () => {
      cancelled = true;
      yText.unobserve(handleTextUpdate);
      commentsMap.unobserve(handleCommentsUpdate);
      if (manager) {
        manager.destroy();
      }
    };
  }, [roomName, role, userId, doc, refreshState]);

  // Inject text change (testing editor edits)
  const handleInjectText = (e: React.FormEvent) => {
    e.preventDefault();
    if (!injectInput) return;
    const yText = doc.getText('monaco');
    doc.transact(() => {
      yText.insert(yText.length, injectInput.endsWith('\n') ? injectInput : injectInput + '\n');
    });
    setInjectInput('');
  };

  // Clear document text
  const handleClearText = () => {
    const yText = doc.getText('monaco');
    doc.transact(() => {
      yText.delete(0, yText.length);
    });
  };

  // Accept Navigator Suggestion — human's own editor connection applies the edit
  const handleAcceptSuggestion = (thread: any) => {
    if (!thread.relPosStart || !thread.relPosEnd || !thread.proposedReplacement) return;
    const yText = doc.getText('monaco');
    const commentsMap = doc.getMap('comments');

    const startAbs = Y.createAbsolutePositionFromRelativePosition(thread.relPosStart, doc);
    const endAbs = Y.createAbsolutePositionFromRelativePosition(thread.relPosEnd, doc);

    if (startAbs && endAbs) {
      doc.transact(() => {
        yText.delete(startAbs.index, endAbs.index - startAbs.index);
        yText.insert(startAbs.index, thread.proposedReplacement);
      });
      doc.transact(() => {
        commentsMap.set(thread.id, { ...thread, resolved: true });
      });
      setUpdateLogs((prev) => [
        `[${new Date().toLocaleTimeString()}] Accepted suggestion "${thread.id}" via human doc.transact()`,
        ...prev.slice(0, 49),
      ]);
    }
  };

  // Dismiss suggestion
  const handleDismissSuggestion = (thread: any) => {
    const commentsMap = doc.getMap('comments');
    doc.transact(() => {
      commentsMap.set(thread.id, { ...thread, resolved: true });
    });
    setUpdateLogs((prev) => [
      `[${new Date().toLocaleTimeString()}] Dismissed suggestion "${thread.id}"`,
      ...prev.slice(0, 49),
    ]);
  };

  const getRoleBadgeStyle = (r: string) => {
    switch (r) {
      case 'editor':
        return { color: '#34d399', bg: 'rgba(16, 185, 129, 0.15)', border: 'rgba(16, 185, 129, 0.3)' };
      case 'navigator':
        return { color: '#fbbf24', bg: 'rgba(245, 158, 11, 0.15)', border: 'rgba(245, 158, 11, 0.3)' };
      case 'commenter':
        return { color: '#c084fc', bg: 'rgba(168, 85, 247, 0.15)', border: 'rgba(168, 85, 247, 0.3)' };
      default:
        return { color: '#94a3b8', bg: 'rgba(148, 163, 184, 0.15)', border: 'rgba(148, 163, 184, 0.3)' };
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Small, Non-Intrusive Header (Active Session Info & Controls) */}
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 50,
          background: 'rgba(9, 10, 15, 0.85)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          padding: '10px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div
            style={{
              width: '26px',
              height: '26px',
              borderRadius: '6px',
              background: 'linear-gradient(135deg, #38bdf8 0%, #a855f7 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 0 12px rgba(56, 189, 248, 0.35)',
            }}
          >
            <span style={{ fontSize: '14px', fontWeight: 'bold', color: '#fff' }}>◇</span>
          </div>
          <span style={{ fontSize: '15px', fontWeight: 800, letterSpacing: '-0.3px' }}>
            Glass<span style={{ color: '#38bdf8' }}>Code</span>
          </span>
          <span
            style={{
              fontSize: '10px',
              padding: '2px 6px',
              borderRadius: '10px',
              background: 'rgba(56, 189, 248, 0.12)',
              color: '#38bdf8',
              fontWeight: 600,
              border: '1px solid rgba(56, 189, 248, 0.25)',
            }}
          >
            HARNESS
          </span>

          <span style={{ color: 'rgba(255, 255, 255, 0.2)', margin: '0 4px' }}>|</span>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
            <span style={{ color: '#94a3b8' }}>Room:</span>
            <strong style={{ color: '#f8fafc', fontFamily: 'monospace' }}>{roomName}</strong>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
            <span style={{ color: '#94a3b8' }}>Role:</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as any)}
              className="glass-input"
              style={{ padding: '2px 8px', fontSize: '12px', height: '26px' }}
            >
              <option value="editor">Editor</option>
              <option value="navigator">Navigator</option>
              <option value="viewer">Viewer</option>
              <option value="commenter">Commenter</option>
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          {/* Connection Status Pill */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
            <span
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: connectionStatus === 'connected' ? '#10b981' : '#f59e0b',
                boxShadow: connectionStatus === 'connected' ? '0 0 8px #10b981' : 'none',
              }}
            />
            <span style={{ color: connectionStatus === 'connected' ? '#34d399' : '#f59e0b', fontWeight: 600 }}>
              {connectionStatus} {isSynced ? '(synced)' : '(syncing...)'}
            </span>
          </div>

          <span className="glass-pill" style={{ color: '#94a3b8' }}>
            {userId}
          </span>

          <button
            onClick={onExit}
            className="glass-btn"
            style={{ padding: '4px 12px', fontSize: '12px' }}
          >
            ← Exit to Overview
          </button>
        </div>
      </header>

      {/* Main Diagnostic Harness Body */}
      <main style={{ flex: 1, padding: '24px', maxWidth: '1200px', margin: '0 auto', width: '100%' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Active Peers Presence (Driven by awareness.getStates()) */}
          <div className="glass-panel" style={{ padding: '16px 20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <div style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 700, letterSpacing: '0.5px' }}>
                ONLINE PARTICIPANTS ({activeUsers.length})
              </div>
              <span style={{ fontSize: '11px', color: '#64748b' }}>
                Single source of truth: <code>awareness.getStates()</code>
              </span>
            </div>

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {activeUsers.map(({ clientId, user }) => {
                const badge = getRoleBadgeStyle(user.role);
                const isSelf = user.userId === userId;
                return (
                  <div
                    key={clientId}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '5px 12px',
                      borderRadius: '20px',
                      fontSize: '12px',
                      fontWeight: 600,
                      backgroundColor: badge.bg,
                      color: badge.color,
                      border: `1px solid ${badge.border}`,
                      boxShadow: isSelf ? '0 0 10px rgba(56, 189, 248, 0.25)' : 'none',
                    }}
                  >
                    <span>{user.name || `User-${clientId}`}</span>
                    <span style={{ opacity: 0.75, fontSize: '10px', textTransform: 'uppercase' }}>
                      ({user.role})
                    </span>
                    {isSelf && (
                      <span
                        style={{
                          fontSize: '10px',
                          background: 'rgba(56, 189, 248, 0.2)',
                          color: '#38bdf8',
                          padding: '1px 5px',
                          borderRadius: '8px',
                          fontWeight: 700,
                        }}
                      >
                        YOU
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Document Viewer (CRDT Y.Text Raw View) */}
          <div className="glass-panel" style={{ padding: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <span style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '0.5px', color: '#38bdf8' }}>
                SHARED CRDT DOCUMENT (<code>Y.Text('monaco')</code>)
              </span>
              <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                {docText.length} characters • {docText ? docText.split('\n').length : 0} lines
              </span>
            </div>

            <pre
              style={{
                background: 'rgba(10, 14, 23, 0.75)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '8px',
                padding: '16px',
                minHeight: '160px',
                maxHeight: '360px',
                overflowY: 'auto',
                fontFamily: "'JetBrains Mono', Consolas, monospace",
                fontSize: '13px',
                lineHeight: 1.5,
                color: '#e2e8f0',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                boxShadow: 'inset 0 2px 8px rgba(0, 0, 0, 0.4)',
              }}
            >
              {docText || <span style={{ color: '#64748b' }}>(Empty document — type or inject text below)</span>}
            </pre>
          </div>

          {/* Driver Injection Controls */}
          <div className="glass-panel" style={{ padding: '20px' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '0.5px', color: '#10b981', marginBottom: '10px' }}>
              INJECT TEXT CHANGE (TEST DRIVER)
            </div>
            <form onSubmit={handleInjectText} style={{ display: 'flex', gap: '10px' }}>
              <input
                type="text"
                value={injectInput}
                onChange={(e) => setInjectInput(e.target.value)}
                placeholder="Type code or statement to append to shared document..."
                className="glass-input"
                style={{ flex: 1 }}
                disabled={role !== 'editor'}
              />
              <button
                type="submit"
                disabled={!injectInput.trim() || role !== 'editor'}
                className="glass-btn glass-btn-primary"
                style={{ padding: '8px 18px' }}
              >
                Append Text
              </button>
              <button
                type="button"
                onClick={handleClearText}
                disabled={role !== 'editor'}
                className="glass-btn"
                style={{ padding: '8px 14px' }}
              >
                Clear
              </button>
            </form>
            {role !== 'editor' && (
              <div style={{ fontSize: '11px', color: '#f59e0b', marginTop: '8px' }}>
                Current role is <strong>{role}</strong> (write restricted). Switch to <strong>editor</strong> to inject text.
              </div>
            )}
          </div>

          {/* Navigator Suggestions Feed */}
          <div className="glass-panel" style={{ padding: '20px' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '0.5px', color: '#fbbf24', marginBottom: '12px' }}>
              NAVIGATOR SUGGESTIONS & COMMENTS ({comments.length})
            </div>

            {comments.length === 0 ? (
              <div style={{ fontSize: '13px', color: '#64748b', fontStyle: 'italic', padding: '12px 0' }}>
                No active suggestions. When code issues are detected, the Navigator Agent will verify them in the sandbox and post suggestions here.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {comments.map((thread: any) => (
                  <div
                    key={thread.id}
                    style={{
                      background: 'rgba(24, 28, 42, 0.65)',
                      border: thread.type === 'suggestion' ? '1px solid rgba(245, 158, 11, 0.35)' : '1px solid rgba(255, 255, 255, 0.1)',
                      borderRadius: '8px',
                      padding: '14px',
                      boxShadow: '0 4px 16px rgba(0, 0, 0, 0.25)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span
                          className="glass-pill"
                          style={{
                            color: thread.type === 'suggestion' ? '#fbbf24' : '#c084fc',
                            borderColor: thread.type === 'suggestion' ? 'rgba(245, 158, 11, 0.3)' : 'rgba(168, 85, 247, 0.3)',
                          }}
                        >
                          {thread.type === 'suggestion' ? '💡 SUGGESTION' : '💬 COMMENT'}
                        </span>
                        <span style={{ fontSize: '12px', fontWeight: 600 }}>Line {thread.initialLine}</span>
                        {thread.snippet && (
                          <code style={{ fontSize: '11px', color: '#94a3b8', background: 'rgba(0,0,0,0.3)', padding: '2px 6px', borderRadius: '4px' }}>
                            {thread.snippet}
                          </code>
                        )}
                      </div>
                      {thread.resolved && (
                        <span style={{ fontSize: '11px', color: '#10b981', fontWeight: 600 }}>✓ Resolved</span>
                      )}
                    </div>

                    {thread.comments?.map((c: any) => (
                      <div key={c.id} style={{ fontSize: '13px', margin: '6px 0 6px 12px', color: '#e2e8f0' }}>
                        <strong>{c.author}: </strong>
                        <span>{c.text}</span>
                      </div>
                    ))}

                    {thread.type === 'suggestion' && thread.proposedReplacement && (
                      <div style={{ marginTop: '10px', marginLeft: '12px' }}>
                        <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 600, marginBottom: '4px' }}>
                          PROPOSED FIX:
                        </div>
                        <pre
                          style={{
                            background: 'rgba(5, 46, 22, 0.5)',
                            border: '1px solid rgba(16, 185, 129, 0.3)',
                            color: '#34d399',
                            padding: '8px 12px',
                            borderRadius: '6px',
                            fontSize: '12px',
                            fontFamily: "'JetBrains Mono', Consolas, monospace",
                            marginBottom: '10px',
                          }}
                        >
                          {thread.proposedReplacement}
                        </pre>

                        {!thread.resolved && role === 'editor' && (
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button
                              onClick={() => handleAcceptSuggestion(thread)}
                              className="glass-btn"
                              style={{ background: 'rgba(16, 185, 129, 0.2)', borderColor: '#10b981', color: '#34d399' }}
                            >
                              ✓ Accept (Human Transact)
                            </button>
                            <button
                              onClick={() => handleDismissSuggestion(thread)}
                              className="glass-btn"
                              style={{ color: '#94a3b8' }}
                            >
                              ✕ Dismiss
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Live Telemetry / Update Stream */}
          <div className="glass-panel" style={{ padding: '20px' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '0.5px', color: '#94a3b8', marginBottom: '10px' }}>
              LIVE EVENT STREAM (CRDT TELEMETRY)
            </div>
            <div
              style={{
                background: 'rgba(9, 10, 15, 0.85)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '8px',
                padding: '12px',
                height: '140px',
                overflowY: 'auto',
                fontFamily: "'JetBrains Mono', Consolas, monospace",
                fontSize: '12px',
                color: '#38bdf8',
              }}
            >
              {updateLogs.length === 0 ? (
                <span style={{ color: '#64748b' }}>Waiting for CRDT update events...</span>
              ) : (
                updateLogs.map((log, idx) => (
                  <div key={idx} style={{ marginBottom: '3px' }}>
                    {log}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};
