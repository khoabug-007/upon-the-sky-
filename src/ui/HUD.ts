const FALL_MESSAGES = [
  'The floor called. It misses you!',
  'Gravity: 1 - You: 0',
  'That was a bold strategy!',
  'The ground says hi. Back to the checkpoint!',
  'You discovered a shortcut... downward.',
  'Astronauts fall too. Probably.',
  'Physics has been notified of your complaint.'
];

const ALTITUDE_TIERS: Array<[number, string]> = [
  [0, 'Sea level - smells like grass'],
  [15, 'Roof height - neighbors are watching'],
  [40, 'Bird zone - flap harder'],
  [95, 'Cloud nine (literally)'],
  [128, 'Planes wave at you'],
  [160, 'Basically an astronaut'],
  [225, 'Beyond the sky. LEGEND.']
];

export class HUD {
  private root: HTMLElement;
  private toastEl: HTMLElement;
  private altEl: HTMLElement;
  private serverEl: HTMLElement;
  private endingEl: HTMLElement;
  private standEl: HTMLElement;
  private standNameEl: HTMLElement;
  private struggleEl: HTMLElement;
  private struggleFill: SVGCircleElement;
  private struggleCountEl: HTMLElement;
  private toastTimer: number | null = null;
  private level = 0;
  private totalLevels = 100;
  private chatInput: HTMLInputElement | null = null;
  private gearBtn!: HTMLButtonElement;
  private gearMenu!: HTMLElement;
  private howtoOverlay!: HTMLElement;
  private shiftLockEl!: HTMLElement;
  private fallOutEl!: HTMLElement;
  private fallOutCountEl!: HTMLElement;

  onPlayAgain: (() => void) | null = null;
  onCommand: ((command: string) => void) | null = null;
  onPauseChange: ((paused: boolean) => void) | null = null;

  constructor() {
    this.root = document.getElementById('hud-root')!;
    this.root.innerHTML = `
      <div class="gear-wrap">
        <button type="button" class="gear-btn" id="hud-gear" aria-label="Settings" title="Settings">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path fill="currentColor" d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.03 7.03 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 13.9 2h-3.8a.5.5 0 0 0-.5.42l-.36 2.54c-.59.24-1.13.55-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.8 8.48a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94L2.92 14.16a.5.5 0 0 0-.12.64l1.92 3.32c.13.23.4.32.64.22l2.39-.96c.5.39 1.04.7 1.63.94l.36 2.54c.05.24.26.42.5.42h3.8c.24 0 .45-.18.5-.42l.36-2.54c.59-.24 1.13-.55 1.63-.94l2.39.96c.24.1.51 0 .64-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z"/>
          </svg>
        </button>
        <div class="gear-menu hidden" id="hud-gear-menu" role="menu">
          <button type="button" class="gear-item" id="hud-howto-link" role="menuitem">how to play</button>
        </div>
      </div>
      <div class="howto-overlay hidden" id="hud-howto-overlay">
        <div class="howto-board howto-board-panel">
          <div class="howto-title">HOW TO PLAY</div>
          <div class="howto-grid">
            <span>Move</span><b>W A S D</b>
            <span>Run</span><b>hold SHIFT</b>
            <span>Crawl</span><b>press R</b>
            <span>Jump</span><b>SPACE</b>
            <span>Punch</span><b>E</b>
            <span>Vehicle</span><b>E enter / exit</b>
            <span>Pick up</span><b>Q</b>
            <span>Throw</span><b>B (onto pads)</b>
            <span>Struggle</span><b>click x8</b>
            <span>Slopes</span><b>run slows</b>
          </div>
          <div class="howto-goal">Climb from earth to outer space. Flags thin out after level 20.<br>Some gates only open if you throw a crate onto the high pad.</div>
          <button type="button" class="btn btn-gold howto-back" id="hud-howto-back">Back</button>
        </div>
      </div>
      <div class="shift-lock hidden" id="hud-shift-lock" aria-hidden="true"></div>
      <div class="hud-right">
        <div class="hud-right-top">
          <div class="fall-out hidden" id="hud-fall-out">
            <div class="fall-out-kicker">Fell off</div>
            <div class="fall-out-count" id="hud-fall-out-count">10</div>
          </div>
          <form class="admin-chat" id="hud-chat-form" autocomplete="off">
            <input id="hud-chat" class="admin-chat-input" type="text" maxlength="48"
              placeholder="Command…" spellcheck="false" />
            <button type="submit" class="admin-chat-go" id="hud-chat-go">GO</button>
          </form>
        </div>
        <div class="server-panel">
          <div class="server-name" id="hud-server-name"></div>
          <div class="server-code" id="hud-server-code" title="Click to copy the code"></div>
          <div class="server-players" id="hud-server-players"></div>
        </div>
      </div>
      <div class="altitude-panel" id="hud-altitude"></div>
      <div class="stand-panel" id="hud-stand">
        <div class="stand-kicker">STANDING ON</div>
        <div class="stand-name" id="hud-stand-name">—</div>
      </div>
      <div class="struggle-ring hidden" id="hud-struggle">
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <circle class="struggle-track" cx="50" cy="50" r="40" />
          <circle class="struggle-fill" id="hud-struggle-fill" cx="50" cy="50" r="40" />
        </svg>
        <div class="struggle-count" id="hud-struggle-count">0/8</div>
        <div class="struggle-hint">CLICK</div>
      </div>
      <div class="toast hidden" id="hud-toast"></div>
      <div class="ending-overlay hidden" id="hud-ending"></div>
    `;
    this.toastEl = document.getElementById('hud-toast')!;
    this.altEl = document.getElementById('hud-altitude')!;
    this.serverEl = document.getElementById('hud-server-players')!;
    this.endingEl = document.getElementById('hud-ending')!;
    this.standEl = document.getElementById('hud-stand')!;
    this.standNameEl = document.getElementById('hud-stand-name')!;
    this.struggleEl = document.getElementById('hud-struggle')!;
    this.struggleFill = document.getElementById('hud-struggle-fill') as unknown as SVGCircleElement;
    this.struggleCountEl = document.getElementById('hud-struggle-count')!;
    this.gearBtn = document.getElementById('hud-gear') as HTMLButtonElement;
    this.gearMenu = document.getElementById('hud-gear-menu')!;
    this.howtoOverlay = document.getElementById('hud-howto-overlay')!;
    this.shiftLockEl = document.getElementById('hud-shift-lock')!;
    this.fallOutEl = document.getElementById('hud-fall-out')!;
    this.fallOutCountEl = document.getElementById('hud-fall-out-count')!;

    this.gearBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!this.howtoOverlay.classList.contains('hidden')) return;
      this.toggleGearMenu();
    });
    this.gearMenu.addEventListener('click', (e) => e.stopPropagation());
    document.getElementById('hud-howto-link')!.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeGearMenu();
      this.openHowTo();
    });
    document.getElementById('hud-howto-back')!.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeHowTo();
    });
    this.howtoOverlay.addEventListener('click', (e) => {
      if (e.target === this.howtoOverlay) this.closeHowTo();
    });
    window.addEventListener('click', () => this.closeGearMenu());
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Escape') return;
      if (!this.howtoOverlay.classList.contains('hidden')) {
        e.preventDefault();
        this.closeHowTo();
        return;
      }
      if (!this.gearMenu.classList.contains('hidden')) {
        e.preventDefault();
        this.closeGearMenu();
      }
    });

    const codeEl = document.getElementById('hud-server-code')!;
    codeEl.addEventListener('click', () => {
      navigator.clipboard?.writeText(codeEl.dataset.code ?? '');
      this.toast('Server code copied! Send it to your friends.');
    });

    const form = document.getElementById('hud-chat-form') as HTMLFormElement;
    this.chatInput = document.getElementById('hud-chat') as HTMLInputElement;
    const sendChat = () => {
      const command = (this.chatInput?.value ?? '').trim();
      if (this.chatInput) this.chatInput.value = '';
      this.chatInput?.blur();
      if (command) this.onCommand?.(command);
    };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      sendChat();
    });
    this.chatInput.addEventListener('keydown', (e) => {
      if (e.code !== 'Enter' && e.code !== 'NumpadEnter') return;
      e.preventDefault();
      e.stopPropagation();
      sendChat();
    });
    this.chatInput.addEventListener('mousedown', () => {
      if (document.pointerLockElement) document.exitPointerLock();
    });
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Enter' && e.code !== 'NumpadEnter') return;
      const active = document.activeElement;
      if (active === this.chatInput) return;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
      e.preventDefault();
      if (document.pointerLockElement) document.exitPointerLock();
      this.chatInput?.focus();
    });
  }

  show(): void { this.root.classList.remove('hidden'); }
  hide(): void { this.root.classList.add('hidden'); }

  setServer(name: string, code: string): void {
    document.getElementById('hud-server-name')!.textContent = name;
    const codeEl = document.getElementById('hud-server-code')!;
    codeEl.textContent = `CODE: ${code}`;
    codeEl.dataset.code = code;
  }

  setPlayerCount(n: number): void {
    this.serverEl.textContent = n === 1
      ? '1 player online (invite your friends!)'
      : `${n} players online`;
  }

  setProgress(level: number, total: number): void {
    this.level = Math.max(0, level);
    this.totalLevels = Math.max(1, total);
  }

  setAltitude(y: number): void {
    let tier = ALTITUDE_TIERS[0][1];
    for (const [minY, label] of ALTITUDE_TIERS) if (y >= minY) tier = label;
    this.altEl.innerHTML =
      `Level: <b>${this.level} / ${this.totalLevels}</b><br>` +
      `Altitude: <b>${Math.max(0, Math.round(y))} m</b><br><span>${tier}</span>`;
  }

  setStandingOn(name: string | null): void {
    this.standNameEl.textContent = name ?? 'Airborne';
    this.standEl.classList.toggle('airborne', !name);
  }

  setStruggle(clicks: number, max: number): void {
    this.struggleEl.classList.remove('hidden');
    const r = 40;
    const circ = 2 * Math.PI * r;
    const t = Math.min(1, Math.max(0, clicks / max));
    this.struggleFill.style.strokeDasharray = `${circ}`;
    this.struggleFill.style.strokeDashoffset = `${circ * (1 - t)}`;
    this.struggleCountEl.textContent = `${clicks}/${max}`;
  }

  hideStruggle(): void {
    this.struggleEl.classList.add('hidden');
    this.struggleCountEl.textContent = '0/8';
    this.struggleFill.style.strokeDashoffset = `${2 * Math.PI * 40}`;
  }

  setShiftLock(on: boolean): void {
    this.shiftLockEl.classList.toggle('hidden', !on);
  }

  setFallOut(secondsLeft: number | null): void {
    if (secondsLeft === null) {
      this.fallOutEl.classList.add('hidden');
      return;
    }
    this.fallOutCountEl.textContent = `${Math.max(1, Math.ceil(secondsLeft))}`;
    this.fallOutEl.classList.remove('hidden');
  }

  private toggleGearMenu(): void {
    const open = this.gearMenu.classList.contains('hidden');
    this.gearMenu.classList.toggle('hidden', !open);
    this.gearBtn.classList.toggle('open', open);
    if (open && document.pointerLockElement) document.exitPointerLock();
  }

  private closeGearMenu(): void {
    this.gearMenu.classList.add('hidden');
    this.gearBtn.classList.remove('open');
  }

  private openHowTo(): void {
    this.howtoOverlay.classList.remove('hidden');
    if (document.pointerLockElement) document.exitPointerLock();
    this.onPauseChange?.(true);
  }

  private closeHowTo(): void {
    this.howtoOverlay.classList.add('hidden');
    this.closeGearMenu();
    this.onPauseChange?.(false);
  }

  toast(msg: string, ms = 3200): void {
    this.toastEl.textContent = msg;
    this.toastEl.classList.remove('hidden');
    this.toastEl.classList.remove('pop');
    void this.toastEl.offsetWidth; // restart animation
    this.toastEl.classList.add('pop');
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.add('hidden'), ms);
  }

  checkpointToast(label: string, index: number, total: number): void {
    this.toast(`CHECKPOINT ${index + 1}/${total} - "${label}" - progress saved!`, 4200);
  }

  fallToast(): void {
    this.toast(FALL_MESSAGES[Math.floor(Math.random() * FALL_MESSAGES.length)]);
  }

  showEnding(): void {
    const lines = [
      { text: 'UPON THE SKY', cls: 'ending-title' },
      { text: 'This game was created for one simple reason:', cls: '' },
      { text: 'to connect players from every country on Earth.', cls: '' },
      { text: 'To prove that teamwork - and a little friendly trolling -', cls: '' },
      { text: 'can carry us from the ground, all the way beyond the sky.', cls: '' },
      { text: 'THANK YOU for playing.', cls: 'ending-thanks' },
      { text: 'You reached outer space. You ARE the sky now.', cls: 'ending-thanks' }
    ];
    this.endingEl.innerHTML = lines.map((l, i) =>
      `<div class="ending-line ${l.cls}" style="animation-delay:${0.8 + i * 1.15}s">${l.text}</div>`
    ).join('') + `
      <button class="btn btn-gold ending-btn" id="hud-play-again"
        style="animation-delay:${0.8 + lines.length * 1.15}s">PLAY AGAIN FROM EARTH</button>`;
    this.endingEl.classList.remove('hidden');
    document.getElementById('hud-play-again')!.addEventListener('click', () => {
      this.endingEl.classList.add('hidden');
      this.onPlayAgain?.();
    });
  }
}
