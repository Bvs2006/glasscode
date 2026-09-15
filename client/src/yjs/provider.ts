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

    // Set local awareness state
    this.provider.awareness.setLocalStateField('user', user);

    // Monitor connection status
    this.provider.on('status', (event: { status: 'connecting' | 'connected' | 'disconnected' }) => {
      if (this.options.onStatusChange) {
        this.options.onStatusChange(event.status);
      }
    });

    // Monitor sync-complete event ('sync' in y-websocket)
    this.provider.on('sync', (isSynced: boolean) => {
      this.isSynced = isSynced;
      if (this.options.onSyncedChange) {
        this.options.onSyncedChange(isSynced);
      }
    });

    // Monitor awareness changes
    this.provider.awareness.on('change', () => {
      if (this.options.onAwarenessChange && this.provider) {
        const states: Array<{ clientId: number; user: UserPresence }> = [];
        this.provider.awareness.getStates().forEach((state, clientId) => {
          if (state.user) {
            states.push({
              clientId,
              user: state.user,
            });
          }
        });
        this.options.onAwarenessChange(states);
      }
    });
  }

  updateUser(user: Partial<UserPresence>): void {
    if (this.provider) {
      const current = (this.provider.awareness.getLocalState() as any)?.user || this.options.user;
      const updated = { ...current, ...user };
      this.provider.awareness.setLocalStateField('user', updated);
    }
  }

  destroy(): void {
    if (this.provider) {
      this.provider.disconnect();
      this.provider.destroy();
      this.provider = null;
    }
  }
}
