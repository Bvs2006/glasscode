import React, { useState, useEffect } from 'react';
import { LandingPage } from './components/LandingPage';
import { HarnessScreen } from './components/HarnessScreen';

export const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<'landing' | 'harness'>('landing');
  const [roomName, setRoomName] = useState<string>(() => {
    const hash = window.location.hash.replace('#', '');
    return hash || 'demo-live-room';
  });
  const [role, setRole] = useState<'editor' | 'viewer' | 'commenter' | 'navigator'>('editor');

  // Keep roomName in sync with window.location.hash
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.replace('#', '');
      if (hash) {
        setRoomName(hash);
      }
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const handleEnterRoom = (selectedRoom: string, selectedRole: 'editor' | 'viewer' | 'commenter' | 'navigator') => {
    setRoomName(selectedRoom);
    setRole(selectedRole);
    window.location.hash = selectedRoom;
    setCurrentView('harness');
  };

  const handleExitToOverview = () => {
    setCurrentView('landing');
  };

  return (
    <>
      {currentView === 'landing' ? (
        <LandingPage
          initialRoomName={roomName}
          initialRole={role}
          onEnterRoom={handleEnterRoom}
        />
      ) : (
        <HarnessScreen
          roomName={roomName}
          initialRole={role}
          onExit={handleExitToOverview}
        />
      )}
    </>
  );
};

export default App;
