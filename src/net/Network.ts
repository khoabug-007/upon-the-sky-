import { io, Socket } from 'socket.io-client';
import type {
  ActionMsg, JoinResult, Profile, RemotePlayerInfo, ServerInfo, StateMsg
} from '../types';
import { P2PRelay } from './p2p';

/** Local Vite → local Node. Vercel static cannot host Socket.IO, so we skip it. */
function socketUrl(): string | null {
  const fromEnv = import.meta.env.VITE_SOCKET_URL;
  if (typeof fromEnv === 'string' && fromEnv.trim()) return fromEnv.trim();
  if (location.port === '5173' || location.port === '4173') return 'http://localhost:3000';
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    return `http://${location.hostname}:3000`;
  }
  if (/\.vercel\.app$/i.test(location.hostname) || /\.github\.io$/i.test(location.hostname)) {
    return null;
  }
  return location.origin;
}

export class Network {
  socket: Socket | null = null;
  connected = false;
  /** Browser rooms work on Vercel even without a Node host. */
  p2pReady = true;
  private p2p = new P2PRelay();
  private usingP2p = false;

  onPlayerJoined: ((p: RemotePlayerInfo) => void) | null = null;
  onPlayerLeft: ((id: string) => void) | null = null;
  onPlayerState: ((s: StateMsg & { id: string }) => void) | null = null;
  onAction: ((a: ActionMsg) => void) | null = null;
  onConnectionChange: ((connected: boolean) => void) | null = null;

  constructor() {
    this.p2p.onPlayerJoined = (p) => this.onPlayerJoined?.(p);
    this.p2p.onPlayerLeft = (id) => this.onPlayerLeft?.(id);
    this.p2p.onPlayerState = (s) => this.onPlayerState?.(s);
    this.p2p.onAction = (a) => this.onAction?.(a);

    const url = socketUrl();
    if (!url) {
      this.p2pReady = true;
      queueMicrotask(() => this.onConnectionChange?.(true));
      return;
    }
    this.socket = io(url, { transports: ['websocket', 'polling'] });
    this.socket.on('connect', () => { this.connected = true; this.onConnectionChange?.(true); });
    this.socket.on('disconnect', () => {
      this.connected = false;
      if (!this.usingP2p) this.onConnectionChange?.(false);
    });
    this.socket.on('player_joined', (p: RemotePlayerInfo) => this.onPlayerJoined?.(p));
    this.socket.on('player_left', (d: { id: string }) => this.onPlayerLeft?.(d.id));
    this.socket.on('player_state', (s: StateMsg & { id: string }) => this.onPlayerState?.(s));
    this.socket.on('action', (a: ActionMsg) => this.onAction?.(a));
  }

  get id(): string {
    if (this.usingP2p) return this.p2p.id;
    return this.socket?.id ?? '';
  }

  get online(): boolean {
    return this.connected || this.p2pReady;
  }

  private waitForSocket(ms: number): Promise<boolean> {
    if (!this.socket || this.connected) return Promise.resolve(this.connected);
    return new Promise((resolve) => {
      const t = window.setTimeout(() => resolve(this.connected), ms);
      this.socket?.once('connect', () => {
        window.clearTimeout(t);
        resolve(true);
      });
    });
  }

  async createServer(serverName: string, profile: Profile): Promise<JoinResult> {
    await this.waitForSocket(1800);
    if (this.connected && this.socket) {
      const res = await new Promise<JoinResult>((resolve) => {
        this.socket!.timeout(6000).emit('create_server', { serverName, profile },
          (err: unknown, result: JoinResult) => resolve(err ? { ok: false, error: 'Connection timed out' } : result));
      });
      if (res.ok) {
        this.usingP2p = false;
        return res;
      }
    }
    this.usingP2p = true;
    const res = await this.p2p.host(serverName, profile);
    if (res.ok) this.onConnectionChange?.(true);
    return res;
  }

  async joinServer(code: string, profile: Profile): Promise<JoinResult> {
    await this.waitForSocket(1800);
    if (this.connected && this.socket) {
      const res = await new Promise<JoinResult>((resolve) => {
        this.socket!.timeout(6000).emit('join_server', { code, profile },
          (err: unknown, result: JoinResult) => resolve(err ? { ok: false, error: 'Connection timed out' } : result));
      });
      if (res.ok) {
        this.usingP2p = false;
        return res;
      }
    }
    this.usingP2p = true;
    const res = await this.p2p.join(code, profile);
    if (res.ok) this.onConnectionChange?.(true);
    return res;
  }

  async listServers(): Promise<ServerInfo[]> {
    await this.waitForSocket(1800);
    if (!this.connected || !this.socket) return [];
    return new Promise((resolve) => {
      this.socket!.timeout(6000).emit('list_servers',
        (err: unknown, res: ServerInfo[]) => resolve(err ? [] : res));
    });
  }

  async findServer(code: string): Promise<ServerInfo | null> {
    await this.waitForSocket(1800);
    if (this.connected && this.socket) {
      const found = await new Promise<ServerInfo | null>((resolve) => {
        this.socket!.timeout(6000).emit('find_server', code,
          (err: unknown, res: ServerInfo | null) => resolve(err ? null : res));
      });
      if (found) return found;
    }
    return this.p2p.peek(code);
  }

  sendState(state: StateMsg): void {
    if (this.usingP2p) this.p2p.sendState(state);
    else this.socket?.emit('state', state);
  }

  sendAction(action: ActionMsg): void {
    if (this.usingP2p) this.p2p.sendAction(action);
    else this.socket?.emit('action', action);
  }

  leaveServer(): void {
    if (this.usingP2p) this.p2p.dispose();
    else this.socket?.emit('leave_server');
    this.usingP2p = false;
  }
}
