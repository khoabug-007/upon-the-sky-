import { io, Socket } from 'socket.io-client';
import type {
  ActionMsg, JoinResult, Profile, RemotePlayerInfo, ServerInfo, StateMsg
} from '../types';

export class Network {
  socket: Socket;
  connected = false;

  onPlayerJoined: ((p: RemotePlayerInfo) => void) | null = null;
  onPlayerLeft: ((id: string) => void) | null = null;
  onPlayerState: ((s: StateMsg & { id: string }) => void) | null = null;
  onAction: ((a: ActionMsg) => void) | null = null;
  onConnectionChange: ((connected: boolean) => void) | null = null;

  constructor() {
    const url = location.port === '5173' ? 'http://localhost:3000' : location.origin;
    this.socket = io(url, { transports: ['websocket', 'polling'] });
    this.socket.on('connect', () => { this.connected = true; this.onConnectionChange?.(true); });
    this.socket.on('disconnect', () => { this.connected = false; this.onConnectionChange?.(false); });
    this.socket.on('player_joined', (p: RemotePlayerInfo) => this.onPlayerJoined?.(p));
    this.socket.on('player_left', (d: { id: string }) => this.onPlayerLeft?.(d.id));
    this.socket.on('player_state', (s: StateMsg & { id: string }) => this.onPlayerState?.(s));
    this.socket.on('action', (a: ActionMsg) => this.onAction?.(a));
  }

  get id(): string { return this.socket.id ?? ''; }

  createServer(serverName: string, profile: Profile): Promise<JoinResult> {
    return new Promise((resolve) => {
      this.socket.timeout(6000).emit('create_server', { serverName, profile },
        (err: unknown, res: JoinResult) => resolve(err ? { ok: false, error: 'Connection timed out' } : res));
    });
  }

  joinServer(code: string, profile: Profile): Promise<JoinResult> {
    return new Promise((resolve) => {
      this.socket.timeout(6000).emit('join_server', { code, profile },
        (err: unknown, res: JoinResult) => resolve(err ? { ok: false, error: 'Connection timed out' } : res));
    });
  }

  listServers(): Promise<ServerInfo[]> {
    return new Promise((resolve) => {
      this.socket.timeout(6000).emit('list_servers',
        (err: unknown, res: ServerInfo[]) => resolve(err ? [] : res));
    });
  }

  findServer(code: string): Promise<ServerInfo | null> {
    return new Promise((resolve) => {
      this.socket.timeout(6000).emit('find_server', code,
        (err: unknown, res: ServerInfo | null) => resolve(err ? null : res));
    });
  }

  sendState(state: StateMsg): void { this.socket.emit('state', state); }
  sendAction(action: ActionMsg): void { this.socket.emit('action', action); }
  leaveServer(): void { this.socket.emit('leave_server'); }
}
