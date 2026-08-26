import Peer, { type DataConnection } from 'peerjs';
import type { ActionMsg, JoinResult, Profile, RemotePlayerInfo, ServerInfo, StateMsg } from '../types';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function makeRoomCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]!;
  return code;
}

export function roomPeerId(code: string): string {
  return `uts-${String(code).toUpperCase().trim()}`;
}

type Wire =
  | { type: 'join'; profile: Profile }
  | { type: 'welcome'; code: string; name: string; hostName: string; players: RemotePlayerInfo[] }
  | { type: 'peek' }
  | { type: 'info'; code: string; name: string; host: string; players: number }
  | { type: 'player_joined'; id: string; profile: Profile }
  | { type: 'player_left'; id: string }
  | { type: 'player_state'; payload: StateMsg & { id: string } }
  | { type: 'action'; payload: ActionMsg };

export class P2PRelay {
  peer: Peer | null = null;
  role: 'host' | 'guest' | null = null;
  code = '';
  roomName = '';
  hostName = '';
  private conns = new Map<string, DataConnection>();
  private profiles = new Map<string, Profile>();

  onPlayerJoined: ((p: RemotePlayerInfo) => void) | null = null;
  onPlayerLeft: ((id: string) => void) | null = null;
  onPlayerState: ((s: StateMsg & { id: string }) => void) | null = null;
  onAction: ((a: ActionMsg) => void) | null = null;

  get id(): string {
    return this.peer?.id ?? '';
  }

  dispose(): void {
    for (const c of this.conns.values()) {
      try { c.close(); } catch { /* ignore */ }
    }
    this.conns.clear();
    this.profiles.clear();
    this.hostProfile = null;
    this.role = null;
    const p = this.peer;
    this.peer = null;
    try { p?.destroy(); } catch { /* ignore */ }
  }

  hostProfile: Profile | null = null;

  host(serverName: string, profile: Profile): Promise<JoinResult> {
    this.dispose();
    const name = String(serverName || 'Fun Server').slice(0, 30);
    const hostName = String(profile?.name || 'Player').slice(0, 20);
    this.hostProfile = profile;
    return this.hostWithRetry(name, hostName, profile, 0);
  }

  private hostWithRetry(
    name: string, hostName: string, profile: Profile, attempt: number
  ): Promise<JoinResult> {
    if (attempt >= 6) return Promise.resolve({ ok: false, error: 'Could not open a room. Try again.' });
    const code = makeRoomCode();
    return new Promise((resolve) => {
      const peer = new Peer(roomPeerId(code));
      const timer = window.setTimeout(() => {
        peer.destroy();
        resolve(this.hostWithRetry(name, hostName, profile, attempt + 1));
      }, 10000);
      peer.on('error', (err) => {
        window.clearTimeout(timer);
        peer.destroy();
        const taken = String((err as { type?: string }).type ?? err.message ?? '').includes('unavailable-id')
          || /taken|unavailable/i.test(String(err.message ?? err));
        if (taken) resolve(this.hostWithRetry(name, hostName, profile, attempt + 1));
        else resolve({ ok: false, error: 'Could not create the server. Check your connection and try again.' });
      });
      peer.on('open', () => {
        window.clearTimeout(timer);
        this.peer = peer;
        this.role = 'host';
        this.code = code;
        this.roomName = name;
        this.hostName = hostName;
        peer.on('connection', (conn) => this.attachHostConn(conn));
        resolve({ ok: true, code, name, players: [] });
      });
    });
  }

  join(code: string, profile: Profile): Promise<JoinResult> {
    this.dispose();
    const c = String(code || '').toUpperCase().trim();
    if (c.length < 4) return Promise.resolve({ ok: false, error: 'Enter a 6-letter server code.' });
    return new Promise((resolve) => {
      const peer = new Peer();
      const timer = window.setTimeout(() => {
        peer.destroy();
        resolve({ ok: false, error: 'Connection timed out. Ask your friend to keep their game open.' });
      }, 14000);
      const fail = (error: string) => {
        window.clearTimeout(timer);
        peer.destroy();
        resolve({ ok: false, error });
      };
      peer.on('error', () => fail('Server not found. Check the code, and keep the host tab open.'));
      peer.on('open', () => {
        const conn = peer.connect(roomPeerId(c), { reliable: true });
        conn.on('error', () => fail('Server not found. Check the code!'));
        conn.on('open', () => {
          this.peer = peer;
          this.role = 'guest';
          this.code = c;
          this.conns.set(conn.peer, conn);
          this.bindGuestConn(conn, resolve, timer);
          conn.send({ type: 'join', profile } satisfies Wire);
        });
      });
    });
  }

  peek(code: string): Promise<ServerInfo | null> {
    const c = String(code || '').toUpperCase().trim();
    if (!c) return Promise.resolve(null);
    return new Promise((resolve) => {
      const peer = new Peer();
      const done = (info: ServerInfo | null) => {
        window.clearTimeout(timer);
        try { peer.destroy(); } catch { /* ignore */ }
        resolve(info);
      };
      const timer = window.setTimeout(() => done(null), 8000);
      peer.on('error', () => done(null));
      peer.on('open', () => {
        const conn = peer.connect(roomPeerId(c), { reliable: true });
        conn.on('error', () => done(null));
        conn.on('open', () => {
          conn.on('data', (raw) => {
            const msg = raw as Wire;
            if (msg?.type === 'info') {
              done({ code: msg.code, name: msg.name, host: msg.host, players: msg.players });
            }
          });
          conn.send({ type: 'peek' } satisfies Wire);
        });
      });
    });
  }

  sendState(state: StateMsg): void {
    const payload: StateMsg & { id: string } = { ...state, id: this.id };
    this.broadcast({ type: 'player_state', payload }, this.id);
  }

  sendAction(action: ActionMsg): void {
    this.broadcast({ type: 'action', payload: { ...action, from: this.id } }, this.id);
  }

  private attachHostConn(conn: DataConnection): void {
    conn.on('data', (raw) => this.onHostData(conn, raw as Wire));
    conn.on('close', () => this.drop(conn.peer));
    conn.on('error', () => this.drop(conn.peer));
  }

  private onHostData(conn: DataConnection, msg: Wire): void {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'peek') {
      conn.send({
        type: 'info',
        code: this.code,
        name: this.roomName,
        host: this.hostName,
        players: this.conns.size + 1
      } satisfies Wire);
      return;
    }
    if (msg.type === 'join') {
      if (this.profiles.has(conn.peer)) return;
      this.conns.set(conn.peer, conn);
      this.profiles.set(conn.peer, msg.profile);
      const others: RemotePlayerInfo[] = [];
      if (this.hostProfile) others.push({ id: this.id, profile: this.hostProfile });
      for (const [id, p] of this.profiles) {
        if (id !== conn.peer) others.push({ id, profile: p });
      }
      conn.send({
        type: 'welcome',
        code: this.code,
        name: this.roomName,
        hostName: this.hostName,
        players: others
      } satisfies Wire);
      this.broadcast({ type: 'player_joined', id: conn.peer, profile: msg.profile }, conn.peer);
      this.onPlayerJoined?.({ id: conn.peer, profile: msg.profile });
      return;
    }
    if (msg.type === 'player_state') {
      this.onPlayerState?.(msg.payload);
      this.broadcast(msg, conn.peer);
      return;
    }
    if (msg.type === 'action') {
      this.onAction?.(msg.payload);
      this.broadcast(msg, conn.peer);
    }
  }

  private bindGuestConn(
    conn: DataConnection,
    resolve: (res: JoinResult) => void,
    timer: number
  ): void {
    let settled = false;
    conn.on('close', () => {
      if (!settled) {
        settled = true;
        window.clearTimeout(timer);
        resolve({ ok: false, error: 'Host closed the room.' });
      } else this.onPlayerLeft?.(conn.peer);
    });
    conn.on('data', (raw) => {
      const msg = raw as Wire;
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'welcome' && !settled) {
        settled = true;
        window.clearTimeout(timer);
        this.roomName = msg.name;
        this.hostName = msg.hostName;
        resolve({ ok: true, code: msg.code, name: msg.name, players: msg.players });
        return;
      }
      if (msg.type === 'player_joined') this.onPlayerJoined?.(msg);
      if (msg.type === 'player_left') this.onPlayerLeft?.(msg.id);
      if (msg.type === 'player_state') this.onPlayerState?.(msg.payload);
      if (msg.type === 'action') this.onAction?.(msg.payload);
    });
  }

  private drop(id: string): void {
    if (!this.conns.has(id)) return;
    this.conns.delete(id);
    this.profiles.delete(id);
    this.broadcast({ type: 'player_left', id }, id);
    this.onPlayerLeft?.(id);
  }

  private broadcast(msg: Wire, exceptId?: string): void {
    if (this.role === 'guest') {
      const host = [...this.conns.values()][0];
      host?.open && host.send(msg);
      return;
    }
    for (const [id, conn] of this.conns) {
      if (id === exceptId) continue;
      if (conn.open) conn.send(msg);
    }
  }
}
