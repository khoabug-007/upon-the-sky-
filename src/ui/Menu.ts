import * as THREE from 'three';
import { Character } from '../game/Character';
import type { Network } from '../net/Network';
import type { Customization, JoinResult, Profile, ServerInfo } from '../types';
import { DEFAULT_CUSTOM } from '../types';

const PROFILE_KEY = 'uts_profile';

const FUNNY_NAMES = [
  'Sir Wobbles', 'Captain Noodle', 'Moon Potato', 'Wiggly Steve',
  'Cloud Snacker', 'Gravity Denier', 'Sky Biscuit', 'Astro Pickle'
];

export class Menu {
  onEnterGame: ((join: JoinResult, profile: Profile) => void) | null = null;

  private root: HTMLElement;
  private profile: Profile;
  private previewRenderer!: THREE.WebGLRenderer;
  private previewScene!: THREE.Scene;
  private previewCam!: THREE.PerspectiveCamera;
  private previewChar!: Character;
  private previewRunning = false;
  private busy = false;

  constructor(private network: Network) {
    this.root = document.getElementById('menu-root')!;
    const saved = localStorage.getItem(PROFILE_KEY);
    this.profile = saved ? JSON.parse(saved) : {
      name: FUNNY_NAMES[Math.floor(Math.random() * FUNNY_NAMES.length)],
      custom: { ...DEFAULT_CUSTOM }
    };
    this.render();
    this.setupPreview();
    network.onConnectionChange = (ok) => this.setConnStatus(ok);
    this.setConnStatus(network.connected);
  }

  getProfile(): Profile { return this.profile; }

  show(): void {
    this.root.classList.remove('hidden');
    this.previewRunning = true;
  }

  hide(): void {
    this.root.classList.add('hidden');
    this.previewRunning = false;
  }

  private saveProfile(): void {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(this.profile));
  }

  private render(): void {
    this.root.innerHTML = `
      <div class="menu-sky">
        <div class="menu-cloud c1"></div><div class="menu-cloud c2"></div>
        <div class="menu-cloud c3"></div><div class="menu-cloud c4"></div>
        <div class="menu-star s1"></div><div class="menu-star s2"></div><div class="menu-star s3"></div>
      </div>
      <div class="menu-content">
        <h1 class="menu-title">UPON <span>THE</span> SKY</h1>
        <p class="menu-subtitle">A very serious parkour journey from the dirt to outer space.
          Bring friends. Push friends. Carry friends. (In that order.)</p>
        <div class="menu-columns">
          <div class="panel editor-panel">
            <h2>YOUR HERO</h2>
            <canvas id="preview-canvas" width="280" height="300"></canvas>
            <input id="name-input" class="text-input" maxlength="16" placeholder="Your name" value="${this.profile.name.replace(/"/g, '&quot;')}" />
            ${this.sliderHtml('head', 'HEAD', this.profile.custom.head)}
            ${this.sliderHtml('body', 'BODY', this.profile.custom.body)}
            ${this.sliderHtml('legs', 'LEGS', this.profile.custom.legs)}
            <div class="editor-hint">Drag the bars: 1 = tiny, 100 = absolute unit</div>
          </div>
          <div class="panel play-panel">
            <h2>PLAY WITH THE WORLD</h2>
            <div class="conn-status" id="conn-status">connecting...</div>
            <button class="btn btn-big btn-green" id="btn-join">JOIN SERVER</button>
            <button class="btn btn-big btn-blue" id="btn-find">FIND SERVER</button>
            <button class="btn btn-big btn-gold" id="btn-create">CREATE SERVER</button>
            <div id="menu-dynamic"></div>
          </div>
        </div>
      </div>
    `;

    const nameInput = document.getElementById('name-input') as HTMLInputElement;
    nameInput.addEventListener('input', () => {
      this.profile.name = nameInput.value.trim() || 'Player';
      this.saveProfile();
    });

    for (const part of ['head', 'body', 'legs'] as const) {
      const slider = document.getElementById(`slider-${part}`) as HTMLInputElement;
      const valEl = document.getElementById(`slider-${part}-val`)!;
      slider.addEventListener('input', () => {
        const v = parseInt(slider.value, 10);
        this.profile.custom[part] = v;
        valEl.textContent = String(v);
        this.previewChar?.applyCustomization(this.profile.custom);
        this.saveProfile();
      });
    }

    document.getElementById('btn-join')!.addEventListener('click', () => this.showServerBoard());
    document.getElementById('btn-find')!.addEventListener('click', () => this.showFindServer());
    document.getElementById('btn-create')!.addEventListener('click', () => this.showCreateServer());
  }

  private sliderHtml(id: string, label: string, value: number): string {
    return `
      <div class="slider-row">
        <label>${label}</label>
        <input type="range" min="1" max="100" value="${value}" id="slider-${id}" />
        <span class="slider-val" id="slider-${id}-val">${value}</span>
      </div>`;
  }

  private setConnStatus(ok: boolean): void {
    const el = document.getElementById('conn-status');
    if (!el) return;
    el.textContent = ok ? 'ONLINE - servers around the world await' : 'OFFLINE - start the game server (npm start)';
    el.classList.toggle('online', ok);
  }

  // ---------- character preview ----------

  private setupPreview(): void {
    const canvas = document.getElementById('preview-canvas') as HTMLCanvasElement;
    this.previewRenderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.previewRenderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.previewScene = new THREE.Scene();
    this.previewCam = new THREE.PerspectiveCamera(38, 280 / 300, 0.1, 50);
    this.previewCam.position.set(0, 1.5, 4.4);
    this.previewCam.lookAt(0, 1.05, 0);
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(2, 4, 3);
    this.previewScene.add(key, new THREE.AmbientLight(0xbfd4ff, 1.1));
    const podium = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1.15, 0.3, 32),
      new THREE.MeshStandardMaterial({ color: 0x74b9ff, roughness: 0.4 }));
    podium.position.y = -0.15;
    this.previewScene.add(podium);
    this.previewChar = new Character(this.profile.custom, this.profile.name);
    this.previewChar.setAnim('idle');
    this.previewScene.add(this.previewChar.group);
    this.previewRunning = true;

    let last = performance.now();
    const loop = (now: number) => {
      requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!this.previewRunning) return;
      this.previewChar.group.rotation.y += dt * 0.9;
      this.previewChar.update(dt);
      this.previewRenderer.render(this.previewScene, this.previewCam);
    };
    requestAnimationFrame(loop);
  }

  // ---------- server flows ----------

  private dyn(): HTMLElement { return document.getElementById('menu-dynamic')!; }

  private serverCardHtml(s: ServerInfo): string {
    return `
      <div class="server-card">
        <div class="server-card-top">
          <div class="server-card-name">${escapeHtml(s.name)}</div>
          <div class="server-card-code">${s.code}</div>
        </div>
        <div class="server-card-info">host: ${escapeHtml(s.host)} &middot; ${s.players} player${s.players === 1 ? '' : 's'} inside</div>
        <div class="server-card-bottom">
          <button class="btn btn-join-in" data-code="${s.code}">JOIN IN</button>
        </div>
      </div>`;
  }

  private bindJoinButtons(container: HTMLElement): void {
    container.querySelectorAll<HTMLButtonElement>('.btn-join-in').forEach((btn) => {
      btn.addEventListener('click', () => this.joinByCode(btn.dataset.code!));
    });
  }

  private async showServerBoard(): Promise<void> {
    this.dyn().innerHTML = `<div class="board"><div class="board-title">LIVE SERVERS</div><div class="board-body">Searching the whole planet...</div></div>`;
    const servers = await this.network.listServers();
    const body = servers.length
      ? servers.map((s) => this.serverCardHtml(s)).join('')
      : `<div class="board-empty">No servers yet. Be the hero: create the first one!</div>`;
    this.dyn().innerHTML = `
      <div class="board">
        <div class="board-title">LIVE SERVERS <button class="btn btn-small" id="btn-refresh">refresh</button></div>
        <div class="board-body server-list">${body}</div>
      </div>`;
    this.bindJoinButtons(this.dyn());
    document.getElementById('btn-refresh')!.addEventListener('click', () => this.showServerBoard());
  }

  private showFindServer(): void {
    this.dyn().innerHTML = `
      <div class="board">
        <div class="board-title">FIND YOUR FRIEND'S SERVER</div>
        <div class="find-row">
          <input class="text-input code-input" id="find-input" maxlength="6" placeholder="SERVER CODE (e.g. AB3XZ7)" />
          <button class="btn btn-blue" id="btn-do-find">FIND</button>
        </div>
        <div class="board-body" id="find-result"></div>
      </div>`;
    const input = document.getElementById('find-input') as HTMLInputElement;
    input.focus();
    const doFind = async () => {
      const result = document.getElementById('find-result')!;
      result.innerHTML = 'Scanning the skies...';
      const s = await this.network.findServer(input.value);
      if (s) {
        result.innerHTML = this.serverCardHtml(s);
        this.bindJoinButtons(result);
      } else {
        result.innerHTML = `<div class="board-empty">No server with that code. Typo? Or did your friend rage-quit?</div>`;
      }
    };
    document.getElementById('btn-do-find')!.addEventListener('click', doFind);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doFind(); });
  }

  private showCreateServer(): void {
    this.dyn().innerHTML = `
      <div class="board">
        <div class="board-title">CREATE YOUR SERVER</div>
        <div class="find-row">
          <input class="text-input" id="create-input" maxlength="30" placeholder="Server name (e.g. Sky Legends)" value="${escapeHtml(this.profile.name)}'s sky party" />
          <button class="btn btn-gold" id="btn-do-create">CREATE &amp; PLAY</button>
        </div>
        <div class="board-body" id="create-result">You will get a 6-letter code to share with friends anywhere in the world.</div>
      </div>`;
    document.getElementById('btn-do-create')!.addEventListener('click', async () => {
      if (this.busy) return;
      this.busy = true;
      const name = (document.getElementById('create-input') as HTMLInputElement).value.trim() || 'Fun Server';
      const res = await this.network.createServer(name, this.profile);
      this.busy = false;
      if (res.ok) this.onEnterGame?.(res, this.profile);
      else document.getElementById('create-result')!.textContent = res.error ?? 'Could not create the server.';
    });
  }

  private async joinByCode(code: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const res = await this.network.joinServer(code, this.profile);
    this.busy = false;
    if (res.ok) this.onEnterGame?.(res, this.profile);
    else this.dyn().insertAdjacentHTML('beforeend', `<div class="board-empty">${escapeHtml(res.error ?? 'Join failed')}</div>`);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
