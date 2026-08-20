export class Input {
  private keys = new Set<string>();
  private pressed = new Set<string>();
  mouseLeft = false;

  constructor() {
    window.addEventListener('keydown', (e) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (e.code === 'Space') e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('mousedown', (e) => { if (e.button === 0) this.mouseLeft = true; });
    window.addEventListener('mouseup', (e) => { if (e.button === 0) this.mouseLeft = false; });
    window.addEventListener('blur', () => { this.keys.clear(); this.mouseLeft = false; });
  }

  down(code: string): boolean { return this.keys.has(code); }

  /** Edge-triggered press. Returns true once per physical key press. */
  consume(code: string): boolean {
    if (this.pressed.has(code)) { this.pressed.delete(code); return true; }
    return false;
  }

  /** Call at the end of each frame to drop unconsumed presses. */
  endFrame(): void { this.pressed.clear(); }
}
