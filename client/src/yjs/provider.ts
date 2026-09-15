import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

export interface UserPresence {
  userId: string;
  name: string;
  color: string;
  role: 'editor' | 'viewer' | 'commenter' | 'navigator';
}

export interface ProviderManagerOptions {
  serverUrl: string;
  roomName: string;
  doc: Y.Doc;
  token?: string;
  user: UserPresence;
  onStatusChange?: (status: 'connecting' | 'connected' | 'disconnected') => void;
  onSyncedChange?: (synced: boolean) => void;
  onAwarenessChange?: (states: Array<{ clientId: number; user: UserPresence }>) => void;
}

export class LiveShareProviderManager {
  provider: WebsocketProvider | null = null;
  doc: Y.Doc;
  options: ProviderManagerOptions;
  isSynced: boolean = false;

  constructor(options: ProviderManagerOptions) {
    this.options = options;
    this.doc = options.doc;
    this.connect();
  }

  /**
   * Get all active users in the room from a single source: awareness.getStates().
   * This includes the local client once setLocalStateField is called.
   */
  getAwarenessUsers(): Array<{ clientId: number; user: UserPresence }> {
    if (!this.provider) return [];
    const states: Array<{ clientId: number; user: UserPresence }> = [];
    this.provider.awareness.getStates().forEach((state, clientId) => {
      if (state && (state as any).user) {
        states.push({
          clientId,
          user: (state as any).user,
        });
      }
    });
    return states;
  }

  private syncAwareness = (): void => {
    if (!this.provider || !this.options.onAwarenessChange) return;
    const states = this.getAwarenessUsers();
    this.options.onAwarenessChange(states);
  };

  connect(): void {
    if (this.provider) {
      this.destroy();
    }

    const { serverUrl, roomName, doc, token, user } = this.options;

    // y-websocket provider with query params
    this.provider = new WebsocketProvider(
      serverUrl,
      roomName,
      doc,
      {
        params: token ? { token } : {},
      }
    );

    // 1. Attach awareness listener FIRST so any local or remote change is caught
    this.provider.awareness.on('change', this.syncAwareness);

    // 2. Set local awareness state with user id and role immediately on connecting
    this.provider.awareness.setLocalStateField('user', user);

    // 3. Immediately emit awareness so the local client counts itself right away
    this.syncAwareness();

    // Monitor connection status
    this.provider.on('status', (event: { status: 'connecting' | 'connected' | 'disconnected' }) => {
      if (this.options.onStatusChange) {
        this.options.onStatusChange(event.status);
      }
      this.syncAwareness();
    });

    // Monitor sync-complete event ('sync' in y-websocket)
    this.provider.on('sync', (isSynced: boolean) => {
      this.isSynced = isSynced;
      if (this.options.onSyncedChange) {
        this.options.onSyncedChange(isSynced);
      }
      this.syncAwareness();
    });
  }

  updateUser(user: Partial<UserPresence>): void {
    if (this.provider) {
      const current = (this.provider.awareness.getLocalState() as any)?.user || this.options.user;
      const updated = { ...current, ...user };
      this.options.user = updated;
      this.provider.awareness.setLocalStateField('user', updated);
      this.syncAwareness();
    }
  }

  destroy(): void {
    if (this.provider) {
      this.provider.awareness.off('change', this.syncAwareness);
      this.provider.disconnect();
      this.provider.destroy();
      this.provider = null;
    }
  }
}
