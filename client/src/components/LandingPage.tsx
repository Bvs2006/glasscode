import React, { useState } from 'react';

export interface LandingPageProps {
  initialRoomName: string;
  initialRole: 'editor' | 'viewer' | 'commenter' | 'navigator';
  onEnterRoom: (roomName: string, role: 'editor' | 'viewer' | 'commenter' | 'navigator') => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({
  initialRoomName,
  initialRole,
  onEnterRoom,
}) => {
  const [roomName, setRoomName] = useState(initialRoomName || 'demo-live-room');
  const [role, setRole] = useState<'editor' | 'viewer' | 'commenter' | 'navigator'>(
    initialRole || 'editor'
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomName.trim()) return;
    onEnterRoom(roomName.trim(), role);
  };

  const steps = [
    {
      num: 1,
      title: 'Open the landing page and pick a room',
      desc: 'The person sees what the tool does, enters or creates a room id, and picks a role for this session: editor, navigator, viewer, or commenter.',
      icon: '🚪',
      color: '#38bdf8',
    },
    {
      num: 2,
      title: 'Choose how to participate',
      desc: 'As editor, they drive: type code, and it streams live to everyone else in the room. As navigator, they pair with the AI reviewer instead of writing code themselves.',
      icon: '🎭',
      color: '#a855f7',
    },
    {
      num: 3,
      title: 'Write code as the editor',
      desc: 'Every keystroke syncs live over the CRDT connection. Other humans or agents in the room see the same document update in real time, with no manual save or merge step.',
      icon: '⌨️',
      color: '#34d399',
    },
    {
      num: 4,
      title: 'Get reviewed by the navigator agent',
      desc: 'While someone drives, the navigator agent watches the document, waits for a pause in typing, and — only after verifying its idea in the sandbox — posts a suggestion anchored to the relevant line.',
      icon: '🧭',
      color: '#fbbf24',
    },
    {
      num: 5,
      title: 'Accept or dismiss suggestions',
      desc: "The driver reviews each suggestion and clicks accept or dismiss. Accepting applies the change through the driver's own connection — the agent itself never writes code.",
      icon: '✅',
      color: '#10b981',
    },
    {
      num: 6,
      title: 'Bring an existing coding agent instead',
      desc: "Someone who already uses Claude Code, Cursor, or another agent doesn't switch tools. They run the bridge daemon pointed at the room and their local project folder, and their agent keeps working on local files exactly as before.",
      icon: '🔌',
      color: '#60a5fa',
    },
    {
      num: 7,
      title: 'The bridge keeps everyone in sync',
      desc: "The daemon sandbox-verifies the local agent's edits before pushing them to the room, and writes other peers' verified changes back to the local files — so the external agent's workspace and the shared room never drift apart.",
      icon: '🔄',
      color: '#c084fc',
    },
  ];

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Top Glass Navigation Header (Purely Brand & Navigation) */}
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

        <button
          onClick={() => onEnterRoom(roomName, role)}
          className="glass-btn glass-btn-primary"
          style={{ padding: '6px 16px', fontSize: '12px' }}
        >
          Enter Live Session →
        </button>
      </header>

      {/* Main Landing Content Area */}
      <main style={{ flex: 1, padding: '32px 24px 64px', maxWidth: '1200px', margin: '0 auto', width: '100%' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '48px' }}>
          {/* Hero Section */}
          <section
            className="glass-panel-glow"
            style={{
              padding: '52px 36px',
              textAlign: 'center',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            <div style={{ marginBottom: '18px' }}>
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
                maxWidth: '740px',
                margin: '0 auto 36px',
                lineHeight: 1.6,
              }}
            >
              A high-performance CRDT synchronization substrate where human engineers drive and autonomous AI agents
              navigate. Every proposed change is verified in an isolated Docker / gVisor sandbox before surfacing.
            </p>

            {/* Quick Launch Control */}
            <form
              onSubmit={handleSubmit}
              style={{
                display: 'inline-flex',
                gap: '12px',
                background: 'rgba(15, 23, 42, 0.75)',
                padding: '10px',
                borderRadius: '12px',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                boxShadow: '0 12px 32px rgba(0, 0, 0, 0.45)',
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
                  onChange={(e) => setRoomName(e.target.value)}
                  className="glass-input"
                  style={{ width: '180px' }}
                  placeholder="e.g. demo-live-room"
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
                type="submit"
                className="glass-btn glass-btn-primary"
                style={{ padding: '8px 22px' }}
              >
                Enter Room →
              </button>
            </form>
          </section>

          {/* 7-Step User Journey: How GlassCode Works */}
          <section className="glass-panel" style={{ padding: '36px 32px' }}>
            <div style={{ textAlign: 'center', marginBottom: '32px' }}>
              <span className="glass-pill" style={{ color: '#a855f7', borderColor: 'rgba(168, 85, 247, 0.3)', marginBottom: '8px' }}>
                ✦ End-to-End User Flow
              </span>
              <h2 style={{ fontSize: '24px', fontWeight: 700, marginTop: '8px' }}>
                How GlassCode Works in 7 Steps
              </h2>
              <p style={{ color: '#94a3b8', fontSize: '14px', marginTop: '6px' }}>
                From choosing a role to autonomous agent pair-programming and external bridge synchronization
              </p>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                gap: '20px',
              }}
            >
              {steps.map((s) => (
                <div
                  key={s.num}
                  style={{
                    background: 'rgba(15, 23, 42, 0.45)',
                    border: '1px solid rgba(255, 255, 255, 0.06)',
                    borderRadius: '10px',
                    padding: '20px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                    position: 'relative',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span
                      style={{
                        width: '28px',
                        height: '28px',
                        borderRadius: '50%',
                        background: 'rgba(255, 255, 255, 0.08)',
                        border: `1px solid ${s.color}`,
                        color: s.color,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '12px',
                        fontWeight: 700,
                      }}
                    >
                      {s.num}
                    </span>
                    <span style={{ fontSize: '20px' }}>{s.icon}</span>
                  </div>
                  <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#f8fafc' }}>
                    {s.title}
                  </h3>
                  <p style={{ fontSize: '13px', color: '#94a3b8', lineHeight: 1.55 }}>
                    {s.desc}
                  </p>
                </div>
              ))}
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
              <div style={{ padding: '16px', borderRadius: '8px', background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
                <strong style={{ color: '#38bdf8' }}>1. Human Drives</strong>
                <p style={{ color: '#94a3b8', marginTop: '6px', lineHeight: 1.5 }}>
                  The human writes code as normal. Changes stream live to all connected peers over Yjs.
                </p>
              </div>
              <div style={{ padding: '16px', borderRadius: '8px', background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
                <strong style={{ color: '#fbbf24' }}>2. Agent Navigates</strong>
                <p style={{ color: '#94a3b8', marginTop: '6px', lineHeight: 1.5 }}>
                  Navigator buffers updates with silence debounce, tests fixes in sandbox, and surfaces suggestions.
                </p>
              </div>
              <div style={{ padding: '16px', borderRadius: '8px', background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
                <strong style={{ color: '#10b981' }}>3. Human Owns Write</strong>
                <p style={{ color: '#94a3b8', marginTop: '6px', lineHeight: 1.5 }}>
                  When the human clicks Accept, the human's own client executes <code>doc.transact()</code>. The navigator never writes text directly.
                </p>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
};
