import React, { useState, useEffect, useMemo, useCallback } from 'react';
import * as Y from 'yjs';
import { LiveShareProviderManager, type UserPresence } from './yjs/provider';

const SYNC_SERVER_URL = 'ws://localhost:1234';
const AUTH_SERVER_URL = 'http://localhost:1234';

export const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<'landing' | 'session'>('landing');
  const [roomName, setRoomName] = useState<string>(() => {
    const hash = window.location.hash.replace('#', '');
    return hash || 'demo-live-room';
  });
  const [role, setRole] = useState<'editor' | 'viewer' | 'commenter' | 'navigator'>('editor');
  const [userId] = useState(() => `user-${Math.random().toString(36).substring(2, 7)}`);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [isSynced, setIsSynced] = useState(false);
  const [activeUsers, setActiveUsers] = useState<Array<{ clientId: number; user: UserPresence }>>([]);
  const [docText, setDocText] = useState('');
  const [updateLogs, setUpdateLogs] = useState<string[]>([]);
  const [injectInput, setInjectInput] = useState('');
  const [comments, setComments] = useState<any[]>([]);
  const [jwtToken, setJwtToken] = useState('');

  // Fetch JWT token for selected role
  useEffect(() => {
    let cancelled = false;
    fetch(
      `${AUTH_SERVER_URL}/auth/token?role=${role}&userId=${userId}&name=${encodeURIComponent(userId)}`
    )
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && data.token) setJwtToken(data.token);
      })
      .catch((err) => console.warn('[GlassCode] Auth fetch error:', err));
    return () => {
      cancelled = true;
    };
  }, [role, userId]);

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

    const manager = new LiveShareProviderManager({
      serverUrl: SYNC_SERVER_URL,
      roomName,
      doc,
      token: jwtToken,
      user: { userId, name: userId, color: '#38bdf8', role },
      onStatusChange: setConnectionStatus,
      onSyncedChange: (synced) => {
        setIsSynced(synced);
        refreshState();
      },
      onAwarenessChange: setActiveUsers,
    });

    return () => {
      yText.unobserve(handleTextUpdate);
      commentsMap.unobserve(handleCommentsUpdate);
      manager.destroy();
    };
  }, [roomName, doc, jwtToken, role, userId, refreshState]);

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
      {/* Top Glass Navigation Header */}
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 50,
          background: 'rgba(9, 10, 15, 0.75)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          padding: '12px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          {/* Glowing Prism Icon */}
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '8px',
              background: 'linear-gradient(135deg, #38bdf8 0%, #a855f7 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 0 16px rgba(56, 189, 248, 0.4)',
            }}
          >
            <span style={{ fontSize: '18px', fontWeight: 'bold', color: '#fff' }}>◇</span>
          </div>
          <div>
            <span style={{ fontSize: '18px', fontWeight: 800, letterSpacing: '-0.5px' }}>
              Glass<span style={{ color: '#38bdf8' }}>Code</span>
            </span>
            <span
              style={{
                marginLeft: '8px',
                fontSize: '10px',
                padding: '2px 6px',
                borderRadius: '12px',
                background: 'rgba(56, 189, 248, 0.12)',
                color: '#38bdf8',
                fontWeight: 600,
                border: '1px solid rgba(56, 189, 248, 0.25)',
              }}
            >
              CRDT + AI ENGINE
            </span>
          </div>
        </div>

        {/* View Switcher & Room CTA */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            onClick={() => setCurrentView('landing')}
            className={`glass-btn ${currentView === 'landing' ? 'glass-btn-primary' : ''}`}
            style={{ padding: '6px 14px' }}
          >
            Overview
          </button>
          <button
            onClick={() => setCurrentView('session')}
            className={`glass-btn ${currentView === 'session' ? 'glass-btn-primary' : ''}`}
            style={{ padding: '6px 14px' }}
          >
            Live Session
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#94a3b8' }}>
            <span
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: connectionStatus === 'connected' ? '#10b981' : '#f59e0b',
                boxShadow: connectionStatus === 'connected' ? '0 0 8px #10b981' : 'none',
              }}
            />
            <span>{connectionStatus}</span>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main style={{ flex: 1, padding: '24px', maxWidth: '1200px', margin: '0 auto', width: '100%' }}>
        {currentView === 'landing' ? (
          /* =========================================================
             LANDING PAGE VIEW (Glass Aesthetic)
             ========================================================= */
          <div style={{ display: 'flex', flexDirection: 'column', gap: '40px' }}>
            {/* Hero Section */}
            <section
              className="glass-panel-glow"
              style={{
                padding: '48px 36px',
                textAlign: 'center',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              <div style={{ marginBottom: '16px' }}>
                <span className="glass-pill" style={{ color: '#38bdf8', borderColor: 'rgba(56, 189, 248, 0.3)' }}>
                  ✦ Self-Hosted Real-Time Collaborative Engine
                </span>
              </div>
              <h1
                style={{
                  fontSize: '44px',
                  fontWeight: 800,
                  lineHeight: 1.15,
                  marginBottom: '18px',
                  letterSpacing: '-1px',
                  background: 'linear-gradient(180deg, #ffffff 0%, #cbd5e1 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                Human + AI Live-Share Pairing
              </h1>
              <p
                style={{
                  fontSize: '16px',
                  color: '#94a3b8',
                  maxWidth: '720px',
                  margin: '0 auto 32px',
                  lineHeight: 1.6,
                }}
              >
                A high-performance CRDT synchronization substrate where human engineers drive and autonomous AI agents
                navigate. Every proposed change is verified in an isolated Docker / gVisor sandbox before surfacing.
              </p>

              {/* Quick Launch Control */}
              <div
                style={{
                  display: 'inline-flex',
                  gap: '12px',
                  background: 'rgba(15, 23, 42, 0.65)',
                  padding: '8px',
                  borderRadius: '12px',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  boxShadow: '0 12px 32px rgba(0, 0, 0, 0.4)',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  justifyContent: 'center',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '13px', color: '#94a3b8', fontWeight: 600 }}>Room:</span>
                  <input
                    type="text"
                    value={roomName}
                    onChange={(e) => {
                      setRoomName(e.target.value);
                      window.location.hash = e.target.value;
                    }}
                    className="glass-input"
                    style={{ width: '160px' }}
                  />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '13px', color: '#94a3b8', fontWeight: 600 }}>Role:</span>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value as any)}
                    className="glass-input"
                    style={{ cursor: 'pointer' }}
                  >
                    <option value="editor">Editor (Read/Write)</option>
                    <option value="navigator">Navigator (AI Suggestions)</option>
                    <option value="viewer">Viewer (Read-Only)</option>
                    <option value="commenter">Commenter</option>
                  </select>
                </div>

                <button
                  onClick={() => setCurrentView('session')}
                  className="glass-btn glass-btn-primary"
                  style={{ padding: '8px 22px' }}
                >
                  Enter Room →
                </button>
              </div>
            </section>

            {/* Architecture Highlights Grid */}
            <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '20px' }}>
              <div className="glass-panel" style={{ padding: '24px' }}>
                <div style={{ fontSize: '24px', marginBottom: '12px' }}>⚡</div>
                <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '8px', color: '#38bdf8' }}>
                  Yjs CRDT Synchronization
                </h3>
                <p style={{ fontSize: '13px', color: '#94a3b8', lineHeight: 1.5 }}>
                  Sub-50ms peer synchronization over custom WebSocket protocol with awareness propagation, relative
                  positioning, and deterministic merge logic.
                </p>
              </div>

              <div className="glass-panel" style={{ padding: '24px' }}>
                <div style={{ fontSize: '24px', marginBottom: '12px' }}>🛡️</div>
                <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '8px', color: '#10b981' }}>
                  Docker / gVisor Sandbox
                </h3>
                <p style={{ fontSize: '13px', color: '#94a3b8', lineHeight: 1.5 }}>
                  Isolated verification with <code>--network=none</code>, <code>--read-only</code> root mounts, memory caps,
                  and hard timeout kills. Zero container leakage.
                </p>
              </div>

              <div className="glass-panel" style={{ padding: '24px' }}>
                <div style={{ fontSize: '24px', marginBottom: '12px' }}>🧭</div>
                <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '8px', color: '#fbbf24' }}>
                  Reactive AI Navigator
                </h3>
                <p style={{ fontSize: '13px', color: '#94a3b8', lineHeight: 1.5 }}>
                  Watches document updates reactively with configurable silence debounce. Pre-verifies patches in the sandbox
                  and surfaces anchored suggestions with 0 direct code writes.
                </p>
              </div>

              <div className="glass-panel" style={{ padding: '24px' }}>
                <div style={{ fontSize: '24px', marginBottom: '12px' }}>🔒</div>
                <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '8px', color: '#c084fc' }}>
                  Server-Side Dual Enforcement
                </h3>
                <p style={{ fontSize: '13px', color: '#94a3b8', lineHeight: 1.5 }}>
                  Cryptographic JWT role verification. Server drops unauthorized text-modifying updates from Viewers,
                  Commenters, and Navigators at the binary protocol layer.
                </p>
              </div>
            </section>

            {/* Core Invariant Walkthrough */}
            <section className="glass-panel" style={{ padding: '28px' }}>
              <h2 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '16px' }}>
                The GlassCode Pairing Invariant
              </h2>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                  gap: '16px',
                  fontSize: '13px',
                }}
              >
                <div style={{ padding: '14px', borderRadius: '8px', background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
                  <strong style={{ color: '#38bdf8' }}>1. Human Drives</strong>
                  <p style={{ color: '#94a3b8', marginTop: '6px' }}>
                    The human writes code as normal. Changes stream live to all connected peers over Yjs.
                  </p>
                </div>
                <div style={{ padding: '14px', borderRadius: '8px', background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
                  <strong style={{ color: '#fbbf24' }}>2. Agent Navigates</strong>
                  <p style={{ color: '#94a3b8', marginTop: '6px' }}>
                    Navigator buffers updates with silence debounce, tests fixes in sandbox, and surfaces suggestions.
                  </p>
                </div>
                <div style={{ padding: '14px', borderRadius: '8px', background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
                  <strong style={{ color: '#10b981' }}>3. Human Owns Write</strong>
                  <p style={{ color: '#94a3b8', marginTop: '6px' }}>
                    When the human clicks Accept, the human's own client executes <code>doc.transact()</code>. The navigator never writes text.
                  </p>
                </div>
              </div>
            </section>
          </div>
        ) : (
          /* =========================================================
             LIVE SESSION VIEW (Glass Test Harness)
             ========================================================= */
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* Session Toolbar / Room Status */}
            <div
              className="glass-panel"
              style={{
                padding: '16px 20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '12px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
                <div>
                  <span style={{ fontSize: '11px', color: '#94a3b8', display: 'block', marginBottom: '2px' }}>ROOM</span>
                  <input
                    type="text"
                    value={roomName}
                    onChange={(e) => {
                      setRoomName(e.target.value);
                      window.location.hash = e.target.value;
                    }}
                    className="glass-input"
                    style={{ width: '180px', fontWeight: 600 }}
                  />
                </div>

                <div>
                  <span style={{ fontSize: '11px', color: '#94a3b8', display: 'block', marginBottom: '2px' }}>YOUR ROLE</span>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value as any)}
                    className="glass-input"
                    style={{ fontWeight: 600 }}
                  >
                    <option value="editor">Editor (Read/Write)</option>
                    <option value="navigator">Navigator (AI Suggestions)</option>
                    <option value="viewer">Viewer (Read-Only)</option>
                    <option value="commenter">Commenter</option>
                  </select>
                </div>

                <div>
                  <span style={{ fontSize: '11px', color: '#94a3b8', display: 'block', marginBottom: '2px' }}>CONNECTION</span>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      fontSize: '13px',
                      fontWeight: 600,
                      color: connectionStatus === 'connected' ? '#34d399' : '#f59e0b',
                    }}
                  >
                    ● {connectionStatus} {isSynced ? '(synced)' : '(syncing...)'}
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span className="glass-pill" style={{ color: '#94a3b8' }}>
                  Client: {userId}
                </span>
                <button
                  onClick={() => setCurrentView('landing')}
                  className="glass-btn"
                  style={{ padding: '6px 12px', fontSize: '12px' }}
                >
                  ← Overview
                </button>
              </div>
            </div>

            {/* Active Peers Presence */}
            <div className="glass-panel" style={{ padding: '14px 20px' }}>
              <div style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 600, marginBottom: '8px' }}>
                ONLINE PARTICIPANTS ({activeUsers.length})
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {activeUsers.map(({ clientId, user }) => {
                  const badge = getRoleBadgeStyle(user.role);
                  return (
                    <div
                      key={clientId}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '4px 10px',
                        borderRadius: '20px',
                        fontSize: '12px',
                        fontWeight: 600,
                        backgroundColor: badge.bg,
                        color: badge.color,
                        border: `1px solid ${badge.border}`,
                      }}
                    >
                      <span>{user.name || `User-${clientId}`}</span>
                      <span style={{ opacity: 0.7, fontSize: '10px', textTransform: 'uppercase' }}>({user.role})</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Document Viewer (Glass Code View) */}
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
        )}
      </main>
    </div>
  );
};

export default App;
