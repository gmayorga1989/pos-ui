import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { PosSsoHandoffService } from './core/auth/pos-sso-handoff.service';
import { PosLayoutPreferencesService } from './core/layout/pos-layout-preferences.service';
import { PosSsoBridgeComponent } from './shared/pos-sso-bridge.component';
import { PosToastStackComponent } from './shared/ui/pos-toast-stack.component';

@Component({
  selector: 'pos-root',
  standalone: true,
  imports: [RouterOutlet, PosSsoBridgeComponent, PosToastStackComponent],
  template: `
    @if (handoff.active()) {
      <pos-sso-bridge [overlay]="true" message="Abriendo punto de venta…" />
    }
    <router-outlet />
    <pos-toast-stack />
  `,
})
export class AppComponent {
  /** Inicializa tema/densidad desde localStorage lo antes posible. */
  private readonly _layoutPrefs = inject(PosLayoutPreferencesService);
  readonly handoff = inject(PosSsoHandoffService);

  constructor() {
    const path = globalThis.location?.pathname ?? '';
    const search = globalThis.location?.search ?? '';
    if (path.includes('/auth/callback') && /[?&]at=/.test(search)) {
      this.handoff.begin();
    }
  }
}
