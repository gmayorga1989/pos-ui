import { Injectable, signal } from '@angular/core';

const SPLASH_ID = 'pos-sso-splash';

/** Mantiene visible el puente SSO entre el callback y la carga del shell. */
@Injectable({ providedIn: 'root' })
export class PosSsoHandoffService {
  readonly active = signal(false);

  begin(): void {
    this.active.set(true);
    this.removeInlineSplash();
  }

  complete(): void {
    this.active.set(false);
    this.removeInlineSplash();
  }

  removeInlineSplash(): void {
    if (typeof document === 'undefined') {
      return;
    }
    document.getElementById(SPLASH_ID)?.remove();
  }
}
