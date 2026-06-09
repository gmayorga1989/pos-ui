import { Component, input } from '@angular/core';

@Component({
  selector: 'pos-sso-bridge',
  standalone: true,
  template: `
    <div class="sso-root" [class.sso-root--overlay]="overlay()" aria-live="polite" aria-busy="true">
      <div class="sso-noise" aria-hidden="true"></div>
      <div class="sso-orb sso-orb--a" aria-hidden="true"></div>
      <div class="sso-orb sso-orb--b" aria-hidden="true"></div>

      <main class="sso-card">
        <header class="sso-brand">
          <div class="sso-brand__mark" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path
                d="M6 6h12l-1.2 11H7.2L6 6zM9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round" />
            </svg>
          </div>
          <div class="sso-brand__text">
            <h1 class="sso-brand__title">Luxora POS</h1>
            <p class="sso-brand__sub">Conectando su terminal de venta</p>
          </div>
        </header>

        @if (error()) {
          <div class="sso-panel sso-panel--error" role="alert">
            <p class="sso-err-text">{{ error() }}</p>
          </div>
        } @else {
          <div class="sso-flow" aria-hidden="true">
            <div class="sso-node">
              <span class="sso-node__dot sso-node__dot--suite"></span>
              <span class="sso-node__label">Suite</span>
            </div>
            <div class="sso-bridge">
              <span class="sso-bridge__line"></span>
              <span class="sso-bridge__pulse"></span>
              <svg class="sso-bridge__arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M5 12h12m0 0l-4-4m4 4l-4 4"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round" />
              </svg>
            </div>
            <div class="sso-node">
              <span class="sso-node__dot sso-node__dot--pos"></span>
              <span class="sso-node__label">POS</span>
            </div>
          </div>

          <div class="sso-panel sso-panel--loading">
            <div class="sso-status">
              <span class="sso-spinner" aria-hidden="true"></span>
              <p class="sso-msg">{{ message() }}</p>
            </div>
            <p class="sso-hint">Conexión segura vía Identity Gateway</p>
          </div>
        }
      </main>
    </div>
  `,
})
export class PosSsoBridgeComponent {
  readonly overlay = input(false);
  readonly message = input('Estableciendo sesión segura…');
  readonly error = input('');
}
