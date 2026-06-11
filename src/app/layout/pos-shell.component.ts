import { CommonModule } from '@angular/common';
import { afterNextRender, Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, interval } from 'rxjs';
import { environment } from '../../environments/environment';
import { PosAuthService } from '../core/auth/pos-auth.service';
import { PosSsoHandoffService } from '../core/auth/pos-sso-handoff.service';
import { PosConfigService } from '../core/config/pos-config.service';
import type { PosCajaCierreDenomination } from '../core/api/pos-backend.types';
import { PosDeskSessionService } from '../core/desk/pos-desk-session.service';
import { readPosSessionDisplay } from '../core/layout/pos-jwt-hint.util';
import { PosLayoutPreferencesService } from '../core/layout/pos-layout-preferences.service';
import { PosOfflineSyncService } from '../core/offline/pos-offline-sync.service';

type CashPanelMode = 'open' | 'close' | 'history';

@Component({
  selector: 'pos-shell',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div class="shell">
      <aside class="rail" aria-label="Navegación principal">
        <nav class="rail__nav">
          @for (item of nav; track item.path) {
            <a
              class="rail__btn pos-focus-ring"
              [routerLink]="item.path"
              routerLinkActive="rail__btn--active"
              [routerLinkActiveOptions]="{ exact: item.exact ?? false }"
              [attr.aria-label]="item.label">
              <span class="rail__ico" [innerHTML]="item.iconHtml"></span>
              @if (item.path === '/sincronizacion' && offline.pendingCount() > 0) {
                <span class="rail__badge">{{ offline.pendingCount() }}</span>
              }
              <span class="rail__pop" aria-hidden="true">
                <strong class="rail__pop-title">{{ item.label }}</strong>
                <span class="rail__pop-desc">{{ item.desc }}</span>
              </span>
            </a>
          }
        </nav>

        <button type="button" class="rail__logout pos-focus-ring" (click)="logout()" aria-label="Cerrar sesión">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M10 17l-1-1 3-3H3v-2h9l-3-3 1-1 5 5-5 5zM20 4v16"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round" />
          </svg>
        </button>
      </aside>

      <div class="main">
        <header class="topbar">
          <span class="topbar__brand-line" aria-hidden="true"></span>
          <div class="topbar__left">
            <button type="button" class="caja-chip pos-focus-ring" (click)="openCajaPanel()">
              <span class="caja-chip__line1">Caja · {{ desk.cajaDisplayId() }}</span>
              <span class="caja-chip__line2">
                <span class="caja-chip__state" [class.caja-chip__state--on]="desk.cajaOpen()">{{
                  desk.cajaOpen() ? 'Abierta' : 'Cerrada'
                }}</span>
                <span class="caja-chip__sep">·</span>
                <span>Hoy {{ desk.todaySalesTotal() | currency: 'USD' : 'symbol-narrow' : '1.2-2' }}</span>
                <span class="caja-chip__sep">·</span>
                <span>{{ desk.todayTickets() }} tks</span>
              </span>
            </button>
          </div>
          <div class="topbar__mid">
            <div class="topbar__session">
              <span class="topbar__co" [title]="companyTopline()">{{ companyTopline() }}</span>
              <span class="topbar__cash" [title]="cashierSubline()">{{ cashierSubline() }}</span>
            </div>
          </div>
          <div class="topbar__right">
            <div class="chips" role="list" aria-label="Estado de integraciones">
              <span class="chip" [class.chip--ok]="online()" [class.chip--warn]="!online()" role="listitem">
                <span class="chip__dot"></span>
                {{ online() ? 'Online' : 'Offline' }}
              </span>
              <span class="chip chip--pos" role="listitem">
                <span class="chip__dot"></span>
                API
              </span>
              @if (deploymentMode()) {
                <span class="chip chip--pos" role="listitem" [attr.title]="deploymentMode()">
                  <span class="chip__dot"></span>
                  {{ deploymentModeShort() }}
                </span>
              }
              @if (showEfacturaChip()) {
                <span class="chip chip--ok" role="listitem">
                  <span class="chip__dot"></span>
                  eF
                </span>
              }
              @if (showCarteraChip()) {
                <span class="chip chip--ok" role="listitem">
                  <span class="chip__dot"></span>
                  Car
                </span>
              }
            </div>
            <button
              type="button"
              class="theme-btn pos-focus-ring"
              (click)="prefs.toggleTheme()"
              [attr.aria-label]="prefs.theme() === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo nocturno'"
              [attr.title]="prefs.theme() === 'dark' ? 'Modo claro' : 'Modo nocturno'">
              @if (prefs.theme() === 'dark') {
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.6" />
                  <path
                    d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
                    stroke="currentColor"
                    stroke-width="1.6"
                    stroke-linecap="round" />
                </svg>
              } @else {
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M21 14.5A8.5 8.5 0 0 1 9.5 3 7 7 0 1 0 21 14.5z"
                    stroke="currentColor"
                    stroke-width="1.6"
                    stroke-linejoin="round" />
                </svg>
              }
            </button>
            <div class="clock" aria-live="polite">
              <span class="clock__time">{{ time() }}</span>
              <span class="clock__date">{{ date() }}</span>
            </div>
          </div>
        </header>

        <main class="content">
          <router-outlet />
        </main>

        @if (cajaPanelOpen()) {
          <div class="shell-dim" role="presentation" (click)="closeCajaPanel()"></div>
          <div class="shell-modal" role="dialog" aria-modal="true" aria-labelledby="caja-panel-title">
            <div class="shell-modal__header">
              <div class="shell-modal__hero">
              <div>
                <span class="shell-modal__eyebrow">Turno de caja</span>
                <h2 id="caja-panel-title" class="shell-modal__title">Caja y venta del día</h2>
              </div>
              <span class="shell-modal__state" [class.shell-modal__state--open]="desk.cajaOpen()">{{
                desk.cajaOpen() ? 'Abierta' : 'Cerrada'
              }}</span>
              </div>
            </div>
            <div class="shell-modal__body">
              <div class="cash-tabs" role="tablist" aria-label="Caja">
              <button type="button" class="cash-tab pos-focus-ring" [class.cash-tab--on]="cashPanelMode() === 'open'" [disabled]="desk.cajaOpen()" (click)="setCashPanelMode('open')">Apertura</button>
              <button type="button" class="cash-tab pos-focus-ring" [class.cash-tab--on]="cashPanelMode() === 'close'" [disabled]="!desk.cajaOpen()" (click)="setCashPanelMode('close')">Cierre</button>
              <button type="button" class="cash-tab pos-focus-ring" [class.cash-tab--on]="cashPanelMode() === 'history'" (click)="setCashPanelMode('history')">Historial</button>
              </div>
              @if (cashActionError()) {
                <p class="shell-diff shell-diff--bad">{{ cashActionError() }}</p>
              }
              @if (cashPanelMode() === 'open') {
              <p class="shell-modal__p">La caja está <strong>cerrada</strong>. Indique el fondo inicial para apertura.</p>
              <label class="shell-field">
                <span>Fondo de apertura (USD)</span>
                <input
                  type="text"
                  inputmode="decimal"
                  class="shell-input pos-focus-ring"
                  [value]="aperturaMonto()"
                  (input)="onAperturaInput($event)" />
              </label>
              <div class="shell-denoms" aria-label="Denominaciones para fondo de apertura">
                <div class="shell-denoms__head">
                  <span>Denominacion directa</span>
                  <button type="button" class="shell-denoms__clear pos-focus-ring" (click)="setAperturaMonto(0)">Limpiar</button>
                </div>
                <div class="shell-denoms__grid">
                  @for (amount of openingDenominations; track amount) {
                    <button type="button" class="shell-denom pos-focus-ring" (click)="setAperturaMonto(amount)">
                      {{ amount | currency: 'USD' : 'symbol-narrow' : '1.0-0' }}
                    </button>
                  }
                </div>
                <div class="shell-denoms__grid shell-denoms__grid--compact">
                  @for (amount of openingCombos; track amount) {
                    <button type="button" class="shell-chip pos-focus-ring" (click)="setAperturaMonto(amount)">
                      {{ amount | currency: 'USD' : 'symbol-narrow' : '1.0-0' }}
                    </button>
                  }
                </div>
              </div>
              <div class="shell-modal__actions">
                <button type="button" class="shell-btn shell-btn--ghost pos-focus-ring" (click)="closeCajaPanel()">
                  Cancelar
                </button>
                <button type="button" class="shell-btn pos-focus-ring" [disabled]="desk.opening() || desk.cajaOpen()" (click)="confirmarApertura()">
                  {{ desk.opening() ? 'Abriendo...' : 'Abrir caja' }}
                </button>
              </div>
            } @else if (cashPanelMode() === 'close') {
              <p class="shell-modal__p">
                Caja <strong>abierta</strong>. Fondo: {{ desk.openingFloat() | currency: 'USD' : 'symbol-narrow' : '1.2-2' }} ·
                Ventas acumuladas: {{ desk.todaySalesTotal() | currency: 'USD' : 'symbol-narrow' : '1.2-2' }}
              </p>
              <div class="cash-user-card" aria-label="Datos del responsable de caja">
                <span class="cash-user-card__label">Responsable del cierre</span>
                <div class="cash-user-card__grid">
                  <span>{{ companyTopline() }}</span>
                  <span>{{ cashierSubline() }}</span>
                  <span>Caja: {{ desk.cajaDisplayId() }}</span>
                  <span>Turno: {{ desk.sessionId() || 'Sin turno remoto' }}</span>
                </div>
              </div>
              <div class="shell-breakdown">
                <div class="shell-row">
                  <span>Efectivo (cobros)</span>
                  <strong>{{ desk.todayCash() | currency: 'USD' : 'symbol-narrow' : '1.2-2' }}</strong>
                </div>
                <div class="shell-row">
                  <span>Tarjeta</span>
                  <strong>{{ desk.todayCard() | currency: 'USD' : 'symbol-narrow' : '1.2-2' }}</strong>
                </div>
                <div class="shell-row">
                  <span>Transferencia</span>
                  <strong>{{ desk.todayTransfer() | currency: 'USD' : 'symbol-narrow' : '1.2-2' }}</strong>
                </div>
                <div class="shell-row shell-row--accent">
                  <span>Efectivo esperado en cajón</span>
                  <strong>{{ desk.expectedCashInDrawer() | currency: 'USD' : 'symbol-narrow' : '1.2-2' }}</strong>
                </div>
              </div>
              <label class="shell-field">
                <span>Efectivo contado al cierre (cuadre)</span>
                <input
                  type="text"
                  inputmode="decimal"
                  class="shell-input pos-focus-ring"
                  [value]="cierreContado()"
                  (input)="onCierreContado($event)" />
              </label>
              <div class="cash-count-grid">
                <label class="shell-field">
                  <span>Tarjeta contado</span>
                  <input
                    type="text"
                    inputmode="decimal"
                    class="shell-input pos-focus-ring"
                    [value]="cierreTarjeta()"
                    (input)="onCierreTarjeta($event)" />
                </label>
                <label class="shell-field">
                  <span>Transferencia contado</span>
                  <input
                    type="text"
                    inputmode="decimal"
                    class="shell-input pos-focus-ring"
                    [value]="cierreTransferencia()"
                    (input)="onCierreTransferencia($event)" />
                </label>
              </div>
              <div class="cash-denom">
                <div class="cash-denom__head">
                  <span>Denominaciones</span>
                  <strong>{{ countedCashFromDenoms() | currency: 'USD' : 'symbol-narrow' : '1.2-2' }}</strong>
                </div>
                <div class="cash-denom__grid">
                  @for (denom of closeDenominations; track denom) {
                    <label class="cash-denom__row">
                      <span>{{ denom | currency: 'USD' : 'symbol-narrow' : '1.2-2' }}</span>
                      <input type="number" min="0" step="1" inputmode="numeric" class="pos-focus-ring" [value]="denomQty(denom)" (input)="onDenomQty(denom, $event)" />
                      <strong>{{ denomSubtotal(denom) | currency: 'USD' : 'symbol-narrow' : '1.2-2' }}</strong>
                    </label>
                  }
                </div>
              </div>
              <label class="shell-field">
                <span>Notas</span>
                <textarea class="shell-input shell-input--area pos-focus-ring" [value]="cierreNotas()" (input)="onCierreNotas($event)" placeholder="Observaciones del cierre"></textarea>
              </label>
              @if (cierreDiferencia() !== null) {
                <p class="shell-diff" [class.shell-diff--bad]="(cierreDiferencia() ?? 0) !== 0">
                  Diferencia vs esperado:
                  <strong>{{ cierreDiferencia() | currency: 'USD' : 'symbol-narrow' : '1.2-2' }}</strong>
                  <span class="shell-diff__sep">Total:</span>
                  <strong>{{ cierreTotalDiferencia() | currency: 'USD' : 'symbol-narrow' : '1.2-2' }}</strong>
                </p>
              }
              <p class="shell-modal__hint">
                Al cerrar se sincroniza el turno con pos-app si la API está disponible; si no, el estado queda solo en este navegador.
              </p>
              <div class="shell-modal__actions">
                <button type="button" class="shell-btn shell-btn--ghost pos-focus-ring" (click)="closeCajaPanel()">
                  Volver
                </button>
                <button type="button" class="shell-btn shell-btn--danger pos-focus-ring" [disabled]="desk.closing() || !desk.cajaOpen()" (click)="confirmarCierre()">
                  {{ desk.closing() ? 'Cerrando...' : 'Cerrar caja' }}
                </button>
              </div>
            } @else {
              <div class="cash-history">
                @if (desk.historyLoading()) {
                  <p class="shell-modal__p">Cargando historial...</p>
                } @else if (desk.historyError()) {
                  <p class="shell-diff shell-diff--bad">{{ desk.historyError() }}</p>
                } @else if (desk.history().length === 0) {
                  <p class="shell-modal__p">No hay cierres registrados para mostrar.</p>
                } @else {
                  @for (item of desk.history(); track item.id) {
                    <details class="cash-history__item">
                      <summary>
                        <span>
                          <strong>{{ item.openedAt | date: 'short' }}</strong>
                          <small>{{ item.status }} Â· {{ item.closedAt ? (item.closedAt | date: 'short') : 'Sin cierre' }}</small>
                        </span>
                        <span>{{ item.totalVentas | currency: 'USD' : 'symbol-narrow' : '1.2-2' }}</span>
                        <span [class.cash-diff__bad]="(item.cashDifference ?? 0) !== 0">{{ (item.cashDifference ?? 0) | currency: 'USD' : 'symbol-narrow' : '1.2-2' }}</span>
                      </summary>
                      <div class="cash-history__body">
                        <span>Fondo {{ item.openingFloat | currency: 'USD' : 'symbol-narrow' : '1.2-2' }}</span>
                        <span>Efectivo esperado {{ (item.expectedCash ?? 0) | currency: 'USD' : 'symbol-narrow' : '1.2-2' }}</span>
                        <span>Contado {{ (item.countedCash ?? 0) | currency: 'USD' : 'symbol-narrow' : '1.2-2' }}</span>
                        <span>Tarjeta {{ (item.countedCard ?? item.tarjetaCobros) | currency: 'USD' : 'symbol-narrow' : '1.2-2' }}</span>
                        <span>Transferencia {{ (item.countedTransfer ?? item.transferCobros) | currency: 'USD' : 'symbol-narrow' : '1.2-2' }}</span>
                        @if (item.openedBy || item.closedBy) {
                          <span>Usuario {{ item.openedBy || '-' }} / {{ item.closedBy || '-' }}</span>
                        }
                        @if (item.notes) {
                          <p>{{ item.notes }}</p>
                        }
                        @if (item.denominations?.length) {
                          <div class="cash-history__denoms">
                            @for (row of item.denominations; track row.denomination) {
                              <span>{{ row.denomination | currency: 'USD' : 'symbol-narrow' : '1.2-2' }} x {{ row.quantity }}</span>
                            }
                          </div>
                        }
                      </div>
                    </details>
                  }
                }
              </div>
            }
            </div>
            <div class="shell-modal__footer">
              @if (cashPanelMode() === 'open') {
                <button type="button" class="shell-btn shell-btn--ghost pos-focus-ring" (click)="closeCajaPanel()">
                  Cancelar
                </button>
                <button type="button" class="shell-btn pos-focus-ring" [disabled]="desk.opening() || desk.cajaOpen()" (click)="confirmarApertura()">
                  {{ desk.opening() ? 'Abriendo...' : 'Abrir caja' }}
                </button>
              } @else if (cashPanelMode() === 'close') {
                <button type="button" class="shell-btn shell-btn--ghost pos-focus-ring" (click)="closeCajaPanel()">
                  Volver
                </button>
                <button type="button" class="shell-btn shell-btn--danger pos-focus-ring" [disabled]="desk.closing() || !desk.cajaOpen()" (click)="confirmarCierre()">
                  {{ desk.closing() ? 'Cerrando...' : 'Cerrar caja' }}
                </button>
              } @else {
                <button type="button" class="shell-btn shell-btn--ghost pos-focus-ring" (click)="closeCajaPanel()">
                  Cerrar
                </button>
              }
            </div>
          </div>
        }
      </div>
    </div>
  `,
  styles: `
    .shell {
      display: flex;
      height: 100vh;
      max-height: 100dvh;
      min-height: 0;
      color: var(--pos-text);
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      border: 0;
    }
    .rail {
      width: var(--pos-nav-rail-w);
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 0.55rem 0 0.5rem;
      background: var(--pos-rail-bg);
      border-right: 1px solid var(--pos-rail-border);
      box-shadow: inset -1px 0 0 rgba(255, 255, 255, 0.04);
    }
    .rail__nav {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.2rem;
      width: 100%;
      padding: 0.2rem 0;
    }
    .rail__btn {
      position: relative;
      width: calc(var(--pos-nav-rail-w) - 0.45rem);
      height: calc(var(--pos-nav-rail-w) - 0.28rem);
      min-height: 2.35rem;
      border-radius: var(--pos-radius-sm);
      display: grid;
      place-items: center;
      color: var(--pos-rail-fg);
      text-decoration: none;
      border: 1px solid transparent;
      transition:
        background var(--pos-transition),
        color var(--pos-transition),
        border-color var(--pos-transition);
    }
    .rail__btn:hover,
    .rail__btn:focus-visible {
      background: var(--pos-rail-well);
      color: var(--pos-rail-fg-hover);
    }
    .rail__btn--active {
      background: var(--pos-rail-active-bg);
      color: var(--pos-rail-active-fg);
      border-color: transparent;
    }
    .rail__btn--active::before {
      content: '';
      position: absolute;
      left: 0;
      top: 18%;
      bottom: 18%;
      width: 3px;
      border-radius: 0 3px 3px 0;
      background: var(--pos-accent);
      box-shadow: 0 0 14px var(--pos-accent-glow);
    }
    .rail__ico {
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .rail__pop {
      position: absolute;
      left: calc(100% + 8px);
      top: 50%;
      transform: translateY(-50%) translateX(-6px);
      padding: 0.45rem 0.65rem 0.5rem;
      min-width: 7.5rem;
      max-width: 12rem;
      border-radius: var(--pos-radius-sm);
      background: var(--pos-flyout-bg);
      border: 1px solid var(--pos-border);
      box-shadow: var(--pos-flyout-shadow);
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
      transition:
        opacity 0.14s ease,
        transform 0.14s ease,
        visibility 0.14s;
      z-index: 80;
    }
    .rail__btn:hover .rail__pop,
    .rail__btn:focus-visible .rail__pop {
      opacity: 1;
      visibility: visible;
      transform: translateY(-50%) translateX(0);
      pointer-events: none;
    }
    .rail__pop-title {
      display: block;
      font-size: 0.78rem;
      font-weight: 700;
      color: var(--pos-text);
      letter-spacing: -0.01em;
    }
    .rail__pop-desc {
      display: block;
      margin-top: 0.15rem;
      font-size: 0.65rem;
      line-height: 1.35;
      color: var(--pos-muted);
      white-space: normal;
    }
    .rail__badge {
      position: absolute;
      top: 0.18rem;
      right: 0.18rem;
      min-width: 1rem;
      height: 1rem;
      display: grid;
      place-items: center;
      padding: 0 0.24rem;
      border-radius: 999px;
      background: #ef4444;
      color: #fff;
      font-size: 0.58rem;
      font-weight: 900;
      line-height: 1;
      box-shadow: 0 0 0 2px var(--pos-rail-bg);
    }
    .rail__logout {
      margin-top: auto;
      width: calc(var(--pos-nav-rail-w) - 0.45rem);
      height: calc(var(--pos-nav-rail-w) - 0.28rem);
      min-height: 2.35rem;
      display: grid;
      place-items: center;
      border-radius: var(--pos-radius-sm);
      color: var(--pos-rail-fg);
      border: 1px solid rgba(255, 255, 255, 0.1);
      background: rgba(255, 255, 255, 0.03);
      cursor: pointer;
      padding: 0;
      transition:
        background var(--pos-transition),
        color var(--pos-transition),
        border-color var(--pos-transition);
    }
    .rail__logout:hover {
      color: var(--pos-rail-fg-hover);
      background: var(--pos-rail-well);
      border-color: rgba(255, 255, 255, 0.16);
    }
    .main {
      flex: 1;
      min-width: 0;
      min-height: 0;
      display: flex;
      flex-direction: column;
    }
    .topbar {
      position: relative;
      height: var(--pos-topbar-h);
      min-height: var(--pos-topbar-h);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      padding: 0 var(--pos-content-pad-x);
      border-bottom: 1px solid var(--pos-border);
      background: var(--pos-topbar-bg);
      backdrop-filter: blur(14px) saturate(1.35);
      -webkit-backdrop-filter: blur(14px) saturate(1.35);
    }

    .topbar__brand-line {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      height: 2px;
      background: var(--pos-topbar-accent-line, var(--lux-gradient));
      opacity: 0.85;
      pointer-events: none;
    }
    .topbar__left {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-shrink: 1;
      min-width: 0;
      max-width: min(42vw, 15.5rem);
    }
    .caja-chip {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 0.1rem;
      padding: 0.38rem 0.55rem;
      border-radius: var(--pos-radius-sm);
      border: 1px solid var(--pos-border);
      background: color-mix(in srgb, var(--pos-surface-2) 92%, var(--pos-elevated));
      cursor: pointer;
      text-align: left;
      max-width: 100%;
      font: inherit;
      color: inherit;
      box-shadow: 0 1px 0 rgba(255, 255, 255, 0.55) inset;
      transition:
        border-color var(--pos-transition),
        background var(--pos-transition),
        box-shadow 0.15s ease;
    }
    html[data-theme='dark'] .caja-chip {
      box-shadow: none;
    }
    .caja-chip:hover {
      border-color: color-mix(in srgb, var(--pos-accent) 28%, var(--pos-border-strong));
      background: var(--pos-elevated);
      box-shadow: 0 0 0 1px color-mix(in srgb, var(--pos-accent) 12%, transparent);
    }
    .caja-chip__line1 {
      font-size: 0.69rem;
      font-weight: 800;
      letter-spacing: -0.02em;
      color: var(--pos-text);
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .caja-chip__line2 {
      font-size: 0.58rem;
      font-weight: 600;
      color: var(--pos-muted);
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .caja-chip__state {
      color: var(--pos-status-warn);
      font-weight: 800;
    }
    .caja-chip__state--on {
      color: var(--pos-status-ok);
    }
    .caja-chip__sep {
      opacity: 0.45;
    }
    .shell-dim {
      position: fixed;
      inset: 0;
      z-index: 180;
      background: rgba(15, 23, 42, 0.38);
      backdrop-filter: blur(4px);
    }
    html[data-theme='dark'] .shell-dim {
      background: rgba(0, 0, 0, 0.55);
    }
    .shell-modal {
      position: fixed;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      z-index: 190;
      width: min(720px, calc(100vw - 1.5rem));
      max-height: min(88vh, 48rem);
      overflow: hidden;
      border-radius: var(--pos-radius);
      border: 1px solid var(--pos-border-strong);
      background: var(--pos-elevated);
      box-shadow: var(--pos-flyout-shadow);
      padding: 0;
      display: flex;
      flex-direction: column;
    }
    .shell-modal__header {
      flex-shrink: 0;
      padding: 1rem 1.1rem 0.75rem;
      border-bottom: 1px solid var(--pos-border);
      background: var(--pos-elevated);
    }
    .shell-modal__body {
      flex: 1 1 auto;
      min-height: 0;
      overflow: auto;
      padding: 0.85rem 1.1rem 1rem;
    }
    .shell-modal__hero {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 1rem;
      padding: 0.85rem 0.9rem;
      border-radius: var(--pos-radius-sm);
      border: 1px solid var(--pos-border);
      background: var(--pos-surface-2);
    }
    .shell-modal__eyebrow {
      display: block;
      margin-bottom: 0.18rem;
      color: var(--pos-faint);
      font-size: 0.62rem;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .shell-modal__state {
      flex-shrink: 0;
      border-radius: 999px;
      border: 1px solid rgba(217, 119, 6, 0.34);
      background: rgba(251, 191, 36, 0.12);
      color: #92400e;
      padding: 0.22rem 0.55rem;
      font-size: 0.66rem;
      font-weight: 850;
    }
    .shell-modal__state--open {
      border-color: rgba(20, 184, 166, 0.32);
      background: rgba(20, 184, 166, 0.12);
      color: var(--pos-accent-hover);
    }
    .shell-modal__title {
      margin: 0;
      font-size: 1rem;
      font-weight: 800;
      color: var(--pos-text);
    }
    .shell-modal__p {
      margin: 0 0 0.75rem;
      font-size: 0.82rem;
      line-height: 1.45;
      color: var(--pos-muted);
    }
    .shell-modal__hint {
      margin: 0.5rem 0 0;
      font-size: 0.68rem;
      color: var(--pos-faint);
    }
    .shell-modal__actions {
      display: none;
      justify-content: flex-end;
      gap: 0.45rem;
      margin-top: 0.85rem;
    }
    .shell-modal__footer {
      flex-shrink: 0;
      display: flex;
      justify-content: flex-end;
      gap: 0.45rem;
      padding: 0.75rem 1.1rem;
      border-top: 1px solid var(--pos-border);
      background: var(--pos-elevated);
    }
    .cash-tabs {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 0.35rem;
      margin: 0 0 0.75rem;
      padding: 0.25rem;
      border: 1px solid var(--pos-border);
      border-radius: var(--pos-radius-sm);
      background: var(--pos-surface-2);
    }
    .cash-tab {
      min-height: 2rem;
      border: 1px solid transparent;
      border-radius: 8px;
      background: transparent;
      color: var(--pos-muted);
      font-size: 0.75rem;
      font-weight: 850;
      cursor: pointer;
    }
    .cash-tab--on {
      border-color: rgba(20, 184, 166, 0.28);
      background: var(--pos-elevated);
      color: var(--pos-text);
      box-shadow: 0 8px 18px rgba(15, 23, 42, 0.08);
    }
    .cash-tab:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }
    .shell-field {
      display: flex;
      flex-direction: column;
      gap: 0.3rem;
      margin-bottom: 0.65rem;
      font-size: 0.72rem;
      font-weight: 600;
      color: var(--pos-muted);
    }
    .shell-input {
      border-radius: var(--pos-radius-sm);
      border: 1px solid var(--pos-border-strong);
      background: var(--pos-bg);
      color: var(--pos-text);
      padding: 0.48rem 0.55rem;
      font-size: 0.88rem;
    }
    .shell-input--area {
      min-height: 4.2rem;
      resize: vertical;
    }
    .shell-denoms {
      padding: 0.65rem;
      border-radius: var(--pos-radius-sm);
      border: 1px solid var(--pos-border);
      background: var(--pos-surface-2);
      margin-bottom: 0.75rem;
    }
    .shell-denoms__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.65rem;
      margin-bottom: 0.5rem;
      color: var(--pos-muted);
      font-size: 0.68rem;
      font-weight: 800;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .shell-denoms__clear {
      border: none;
      background: transparent;
      color: var(--pos-accent-hover);
      font-size: 0.68rem;
      font-weight: 800;
      cursor: pointer;
      text-transform: none;
      letter-spacing: 0;
    }
    .shell-denoms__grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 0.42rem;
    }
    .shell-denoms__grid--compact {
      grid-template-columns: repeat(4, minmax(0, 1fr));
      margin-top: 0.45rem;
    }
    .shell-denom,
    .shell-chip {
      min-height: 2.35rem;
      border-radius: var(--pos-radius-sm);
      border: 1px solid var(--pos-border-strong);
      background: var(--pos-elevated);
      color: var(--pos-text);
      font-weight: 850;
      cursor: pointer;
      font-variant-numeric: tabular-nums;
    }
    .shell-denom:hover,
    .shell-chip:hover {
      border-color: var(--pos-accent);
      background: var(--pos-accent-muted);
      color: var(--pos-accent-hover);
    }
    .shell-breakdown {
      margin: 0 0 0.75rem;
      padding: 0.55rem 0.6rem;
      border-radius: var(--pos-radius-sm);
      border: 1px solid var(--pos-border);
      background: var(--pos-surface-2);
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
    }
    .cash-user-card {
      margin: -0.2rem 0 0.75rem;
      padding: 0.6rem;
      border-radius: var(--pos-radius-sm);
      border: 1px solid var(--pos-border);
      background: color-mix(in srgb, var(--pos-accent-muted) 34%, var(--pos-surface-2));
    }
    .cash-user-card__label {
      display: block;
      margin-bottom: 0.4rem;
      color: var(--pos-faint);
      font-size: 0.62rem;
      font-weight: 850;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .cash-user-card__grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.32rem 0.75rem;
      color: var(--pos-text);
      font-size: 0.73rem;
      font-weight: 650;
    }
    .cash-user-card__grid span {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .shell-row {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 0.75rem;
      font-size: 0.75rem;
      color: var(--pos-muted);
    }
    .shell-row strong {
      font-variant-numeric: tabular-nums;
      color: var(--pos-text);
    }
    .shell-row--accent {
      padding-top: 0.35rem;
      margin-top: 0.15rem;
      border-top: 1px dashed var(--pos-border);
      font-weight: 700;
      color: var(--pos-text);
    }
    .cash-count-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.55rem;
    }
    .cash-denom {
      margin: 0.25rem 0 0.7rem;
      padding: 0.6rem;
      border: 1px solid var(--pos-border);
      border-radius: var(--pos-radius-sm);
      background: var(--pos-surface-2);
    }
    .cash-denom__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 0.5rem;
      color: var(--pos-muted);
      font-size: 0.72rem;
      font-weight: 850;
    }
    .cash-denom__grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.35rem 0.55rem;
    }
    .cash-denom__row {
      display: grid;
      grid-template-columns: 4.4rem minmax(3rem, 1fr) 5.2rem;
      align-items: center;
      gap: 0.35rem;
      font-size: 0.72rem;
      color: var(--pos-muted);
    }
    .cash-denom__row input {
      width: 100%;
      min-height: 1.9rem;
      border-radius: 8px;
      border: 1px solid var(--pos-border-strong);
      background: var(--pos-bg);
      color: var(--pos-text);
      padding: 0.25rem 0.4rem;
    }
    .cash-denom__row strong {
      color: var(--pos-text);
      font-variant-numeric: tabular-nums;
      text-align: right;
    }
    .cash-history {
      display: grid;
      gap: 0.45rem;
      max-height: 58vh;
      overflow: auto;
      padding-right: 0.2rem;
    }
    .cash-history__item {
      border: 1px solid var(--pos-border);
      border-radius: var(--pos-radius-sm);
      background: var(--pos-surface-2);
      overflow: hidden;
    }
    .cash-history__item summary {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 7rem 5.5rem;
      gap: 0.65rem;
      align-items: center;
      padding: 0.65rem;
      cursor: pointer;
      list-style: none;
      font-size: 0.78rem;
    }
    .cash-history__item summary::-webkit-details-marker {
      display: none;
    }
    .cash-history__item small {
      display: block;
      margin-top: 0.12rem;
      color: var(--pos-faint);
      font-size: 0.67rem;
    }
    .cash-history__body {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.35rem 0.75rem;
      border-top: 1px solid var(--pos-border);
      padding: 0.65rem;
      color: var(--pos-muted);
      font-size: 0.72rem;
    }
    .cash-history__body p,
    .cash-history__denoms {
      grid-column: 1 / -1;
    }
    .cash-history__body p {
      margin: 0.15rem 0 0;
      color: var(--pos-text);
    }
    .cash-history__denoms {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem;
    }
    .cash-history__denoms span {
      padding: 0.2rem 0.45rem;
      border-radius: 999px;
      border: 1px solid var(--pos-border);
      background: var(--pos-elevated);
    }
    .shell-diff {
      font-size: 0.78rem;
      color: var(--pos-muted);
      margin: 0 0 0.5rem;
    }
    .shell-diff strong {
      font-variant-numeric: tabular-nums;
    }
    .shell-diff--bad {
      color: #b45309;
    }
    .shell-diff__sep {
      margin-left: 0.85rem;
    }
    .cash-diff__bad {
      color: #b45309 !important;
    }
    html[data-theme='dark'] .shell-diff--bad {
      color: #fbbf24;
    }
    .shell-btn {
      border: none;
      border-radius: var(--pos-radius-sm);
      padding: 0.45rem 0.85rem;
      font-weight: 700;
      font-size: 0.8rem;
      cursor: pointer;
      background: var(--pos-accent);
      color: #fff;
    }
    .shell-btn--ghost {
      background: transparent;
      color: var(--pos-text);
      border: 1px solid var(--pos-border-strong);
    }
    .shell-btn--danger {
      background: #b91c1c;
      color: #fff;
    }
    .topbar__mid {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: center;
      gap: 0.5rem 0.85rem;
      flex: 1;
      min-width: 0;
    }
    .topbar__session {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.08rem;
      min-width: 0;
      text-align: center;
    }
    .topbar__co {
      font-size: 0.76rem;
      font-weight: 700;
      letter-spacing: -0.03em;
      color: var(--pos-text);
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .topbar__cash {
      font-size: 0.66rem;
      font-weight: 600;
      color: var(--pos-muted);
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .pill {
      font-size: 0.65rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      padding: 0.22rem 0.5rem;
      border-radius: 999px;
      border: 1px solid var(--pos-border);
      color: var(--pos-muted);
      white-space: nowrap;
    }
    .pill--caja {
      border-color: color-mix(in srgb, var(--pos-accent) 32%, var(--pos-border));
      color: var(--pos-accent-hover);
    }
    html[data-theme='dark'] .pill--caja {
      color: #a5b4fc;
    }
    .topbar__right {
      display: flex;
      align-items: center;
      gap: 0.55rem;
      flex-shrink: 0;
    }
    .theme-btn {
      width: 2.28rem;
      height: 2.28rem;
      border-radius: var(--pos-radius-sm);
      border: 1px solid var(--pos-border);
      background: color-mix(in srgb, var(--pos-surface-2) 88%, transparent);
      color: var(--pos-muted);
      display: grid;
      place-items: center;
      cursor: pointer;
      padding: 0;
      transition:
        border-color var(--pos-transition),
        color var(--pos-transition),
        background var(--pos-transition);
    }
    .theme-btn:hover {
      color: var(--pos-text);
      border-color: var(--pos-border-strong);
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem;
    }
    .chip {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      padding: 0.18rem 0.4rem;
      border-radius: 999px;
      font-size: 0.58rem;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      border: 1px solid var(--pos-border);
      color: var(--pos-muted);
    }
    .chip--pos {
      border-color: color-mix(in srgb, var(--pos-accent) 35%, var(--pos-border));
      color: var(--pos-accent-hover);
    }
    .chip--ok {
      border-color: var(--pos-status-ok-border);
      color: var(--pos-status-ok);
    }
    .chip--warn {
      border-color: rgba(248, 113, 113, 0.35);
      color: #b91c1c;
    }
    html[data-theme='dark'] .chip--warn {
      color: #fca5a5;
    }
    .chip__dot {
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: var(--pos-accent);
    }
    .chip--ok .chip__dot {
      background: var(--pos-status-ok);
    }
    .chip--warn .chip__dot {
      background: #ef4444;
    }
    .clock {
      text-align: right;
      line-height: 1.1;
      min-width: 4.5rem;
    }
    .clock__time {
      display: block;
      font-family: var(--pos-mono);
      font-size: 0.82rem;
      font-weight: 600;
    }
    .clock__date {
      font-size: 0.62rem;
      color: var(--pos-faint);
    }
    .content {
      flex: 1;
      min-height: 0;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      padding: var(--pos-content-pad-y) var(--pos-content-pad-x);
    }
    .content > router-outlet + * {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
    }
    @media (max-width: 720px) {
      .shell {
        flex-direction: column;
      }
      .rail {
        width: 100%;
        flex-direction: row;
        flex-wrap: wrap;
        justify-content: center;
        border-right: none;
        border-bottom: 1px solid var(--pos-rail-border);
        padding: 0.45rem 0.35rem;
      }
      .rail__nav {
        flex-direction: row;
        flex: 1 1 auto;
        justify-content: center;
      }
      .rail__pop {
        display: none;
      }
      .rail__logout {
        margin-top: 0;
        margin-left: auto;
      }
      .cash-count-grid,
      .cash-user-card__grid,
      .cash-denom__grid,
      .cash-history__body {
        grid-template-columns: 1fr;
      }
      .cash-history__item summary {
        grid-template-columns: 1fr;
      }
      .cash-denom__row {
        grid-template-columns: 4rem minmax(3rem, 1fr) 4.7rem;
      }
    }
  `,
})
export class PosShellComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly router = inject(Router);
  readonly prefs = inject(PosLayoutPreferencesService);
  private readonly auth = inject(PosAuthService);
  private readonly ssoHandoff = inject(PosSsoHandoffService);
  private readonly runtimeConfig = inject(PosConfigService);
  readonly desk = inject(PosDeskSessionService);
  readonly offline = inject(PosOfflineSyncService);

  readonly deploymentMode = signal('');
  readonly invoicingEnabled = signal(false);
  readonly carteraEnabled = signal(false);

  readonly cajaPanelOpen = signal(false);
  readonly cashPanelMode = signal<CashPanelMode>('open');
  readonly cashActionError = signal<string | null>(null);
  readonly aperturaMonto = signal('0');
  readonly cierreContado = signal('');
  readonly cierreTarjeta = signal('0');
  readonly cierreTransferencia = signal('0');
  readonly cierreNotas = signal('');
  readonly denomQtyMap = signal<Record<string, string>>({});
  readonly cierreConfirmDifference = signal(false);
  readonly openingDenominations = [1, 5, 10, 20, 50, 100] as const;
  readonly openingCombos = [25, 40, 60, 80] as const;
  readonly closeDenominations = [100, 50, 20, 10, 5, 1, 0.5, 0.25, 0.1, 0.05, 0.01] as const;

  readonly countedCashFromDenoms = computed(() =>
    this.closeDenominations.reduce((total, denom) => total + denom * this.denomQtyNumber(denom), 0),
  );

  readonly cierreDiferencia = computed(() => {
    const raw = this.cierreContado().trim();
    if (raw === '') {
      return null;
    }
    const contado = this.parseUsd(raw);
    const esp = this.desk.expectedCashInDrawer();
    return Math.round((contado - esp) * 100) / 100;
  });

  readonly cierreTotalDiferencia = computed(() => {
    const counted = this.parseUsd(this.cierreContado()) + this.parseUsd(this.cierreTarjeta()) + this.parseUsd(this.cierreTransferencia());
    const expected = this.desk.expectedCashInDrawer() + this.desk.todayCard() + this.desk.todayTransfer();
    return Math.round((counted - expected) * 100) / 100;
  });

  readonly efactura = environment.efacturaUiOrigin;
  readonly cartera = environment.carteraUiOrigin;

  readonly time = signal('');
  readonly date = signal('');
  readonly online = signal(navigator.onLine);

  readonly showEfacturaChip = computed(
    () => this.invoicingEnabled() && this.deploymentMode() !== 'STANDALONE',
  );
  readonly showCarteraChip = computed(() => this.carteraEnabled());
  readonly deploymentModeShort = computed(() => {
    const m = this.deploymentMode();
    if (m === 'STANDALONE') {
      return 'Local';
    }
    if (m === 'LUXORA') {
      return 'Luxora';
    }
    if (m === 'INTEGRATED') {
      return 'Integr.';
    }
    return m.slice(0, 5);
  });

  private readonly sessionUi = computed(() => {
    void this.prefs.layoutTick();
    return readPosSessionDisplay(this.auth.accessToken());
  });

  readonly companyTopline = computed(() => {
    const context = this.auth.sessionContext();
    if (context.companyName) {
      return `Empresa · ${context.companyName}`;
    }
    const s = this.sessionUi();
    if (s.companyName) {
      return `Empresa · ${s.companyName}`;
    }
    if (s.companySlug) {
      return `Empresa · ${s.companySlug}`;
    }
    if (s.companyId) {
      return `Empresa · ${s.companyId}`;
    }
    return 'Suite POS';
  });

  readonly cashierSubline = computed(() => {
    const context = this.auth.sessionContext();
    if (context.cashierName) {
      return `Cajero · ${context.cashierName}`;
    }
    if (context.cashierEmail) {
      return `Cajero · ${this.emailLabel(context.cashierEmail)}`;
    }
    const s = this.sessionUi();
    if (s.cashierName) {
      return `Cajero · ${s.cashierName}`;
    }
    if (s.cashierEmail) {
      return s.cashierLabel !== '—' ? `Cajero · ${s.cashierLabel}` : `Cajero · ${s.cashierEmail}`;
    }
    return 'Sin sesión de cajero';
  });

  readonly nav: { path: string; label: string; desc: string; exact?: boolean; iconHtml: SafeHtml }[];

  constructor() {
    afterNextRender(() => this.ssoHandoff.complete());

    const raw: { path: string; label: string; desc: string; exact?: boolean; icon: string }[] = [
      {
        path: '/venta',
        label: 'Venta',
        desc: 'Ticket, cobro y líneas del turno actual.',
        exact: true,
        icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 7h16M6 7v12a2 2 0 002 2h8a2 2 0 002-2V7" stroke="currentColor" stroke-width="1.5"/><path d="M9 11h6M9 15h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
      },
      {
        path: '/catalogo',
        label: 'Catálogo',
        desc: 'Productos, variantes y precios (sync eFactura).',
        icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="4" y="4" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.5"/><rect x="14" y="4" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.5"/><rect x="4" y="14" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.5"/><rect x="14" y="14" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.5"/></svg>`,
      },
      {
        path: '/categorias',
        label: 'Categorías',
        desc: 'Jerarquía de categorías del catálogo.',
        icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 6h16M4 12h10M4 18h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M17 11v6M14 14h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
      },
      {
        path: '/clientes',
        label: 'Clientes',
        desc: 'Maestro de clientes para ventas y facturación.',
        icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="9" cy="8" r="3" stroke="currentColor" stroke-width="1.5"/><path d="M3 19c0-3 2.5-5 6-5s6 2 6 5" stroke="currentColor" stroke-width="1.5"/><circle cx="17" cy="9" r="2.5" stroke="currentColor" stroke-width="1.5"/><path d="M14 19c.3-2 1.8-3.5 4-3.5" stroke="currentColor" stroke-width="1.5"/></svg>`,
      },
      {
        path: '/migracion',
        label: 'Migración',
        desc: 'Importar productos y clientes desde Excel/CSV.',
        icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 3v10M12 13l-3.5-3.5M12 13l3.5-3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 17h16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M7 17v2M12 17v2M17 17v2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
      },
      {
        path: '/reportes',
        label: 'Reportes',
        desc: 'Ventas por día y top productos.',
        icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M5 19V9M10 19V5M15 19v-7M20 19V11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
      },
      {
        path: '/historial',
        label: 'Historial',
        desc: 'Tickets cerrados y conciliación Cartera.',
        icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.5"/><path d="M12 8v4l3 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
      },
      {
        path: '/sincronizacion',
        label: 'Sincronizacion',
        desc: 'Cola offline, errores y reintentos.',
        icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M6 8a6 6 0 0110.2-3.8L18 6M18 16a6 6 0 01-10.2 3.8L6 18" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M18 3v3h-3M6 21v-3h3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 12h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
      },
      {
        path: '/conexiones',
        label: 'Conexiones',
        desc: 'eFactura, Cartera y Suite Shell.',
        icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M8 12h8M12 8v8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="12" r="2" stroke="currentColor" stroke-width="1.5"/><circle cx="16" cy="12" r="2" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="8" r="2" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="16" r="2" stroke="currentColor" stroke-width="1.5"/></svg>`,
      },
      {
        path: '/ajustes',
        label: 'Ajustes',
        desc: 'Caja, densidad, tema nocturno y preferencias.',
        icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 7h10M18 7h2M4 17h2M10 17h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="16" cy="7" r="2" stroke="currentColor" stroke-width="1.6"/><circle cx="8" cy="17" r="2" stroke="currentColor" stroke-width="1.6"/></svg>`,
      },
    ];
    this.nav = raw.map((r) => ({
      path: r.path,
      label: r.label,
      desc: r.desc,
      exact: r.exact,
      iconHtml: this.sanitizer.bypassSecurityTrustHtml(r.icon),
    }));

    const fmt = () => {
      const d = new Date();
      this.time.set(d.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      this.date.set(
        d.toLocaleDateString('es-EC', {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        }),
      );
    };
    fmt();
    interval(1000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => fmt());

    window.addEventListener('online', this.updateOnline);
    window.addEventListener('offline', this.updateOnline);
  }

  ngOnInit(): void {
    this.prefs.applyDocumentAttributes();
    void this.offline.refreshPendingCount();
    void this.runtimeConfig.ensureLoaded().then((cfg) => {
      this.deploymentMode.set(cfg.deploymentMode);
      this.invoicingEnabled.set(cfg.invoicingEnabled);
      this.carteraEnabled.set(cfg.carteraEnabled);
    });
    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        this.prefs.bumpDocumentDensity();
      });
  }

  hasUrl(s: string): boolean {
    return !!(s && s.trim());
  }

  private readonly updateOnline = (): void => {
    this.online.set(navigator.onLine);
  };

  openCajaPanel(): void {
    this.cashActionError.set(null);
    this.cashPanelMode.set(this.desk.cajaOpen() ? 'close' : 'open');
    this.aperturaMonto.set('0');
    this.cierreContado.set(this.desk.cajaOpen() ? this.formatUsd(this.desk.expectedCashInDrawer()) : '');
    this.cierreTarjeta.set(this.formatUsd(this.desk.todayCard()));
    this.cierreTransferencia.set(this.formatUsd(this.desk.todayTransfer()));
    this.cierreNotas.set('');
    this.denomQtyMap.set({});
    this.cierreConfirmDifference.set(false);
    this.cajaPanelOpen.set(true);
  }

  closeCajaPanel(): void {
    this.cajaPanelOpen.set(false);
  }

  onAperturaInput(ev: Event): void {
    this.aperturaMonto.set((ev.target as HTMLInputElement).value);
  }

  setAperturaMonto(amount: number): void {
    this.aperturaMonto.set(this.formatUsd(amount));
  }

  onCierreContado(ev: Event): void {
    this.cierreContado.set((ev.target as HTMLInputElement).value);
    this.cierreConfirmDifference.set(false);
  }

  onCierreTarjeta(ev: Event): void {
    this.cierreTarjeta.set((ev.target as HTMLInputElement).value);
    this.cierreConfirmDifference.set(false);
  }

  onCierreTransferencia(ev: Event): void {
    this.cierreTransferencia.set((ev.target as HTMLInputElement).value);
    this.cierreConfirmDifference.set(false);
  }

  onCierreNotas(ev: Event): void {
    this.cierreNotas.set((ev.target as HTMLTextAreaElement).value);
  }

  setCashPanelMode(mode: CashPanelMode): void {
    this.cashActionError.set(null);
    this.cashPanelMode.set(mode);
    if (mode === 'history') {
      this.desk.loadHistory();
    }
  }

  denomKey(denom: number): string {
    return denom.toFixed(2);
  }

  denomQty(denom: number): string {
    return this.denomQtyMap()[this.denomKey(denom)] ?? '';
  }

  denomQtyNumber(denom: number): number {
    const n = Number.parseInt(this.denomQty(denom), 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  onDenomQty(denom: number, ev: Event): void {
    const raw = (ev.target as HTMLInputElement).value;
    const clean = raw === '' ? '' : String(Math.max(0, Math.floor(Number(raw) || 0)));
    const key = this.denomKey(denom);
    this.denomQtyMap.update((m) => ({ ...m, [key]: clean }));
    const cash = Math.round(this.countedCashFromDenoms() * 100) / 100;
    if (cash > 0) {
      this.cierreContado.set(this.formatUsd(cash));
    }
    this.cierreConfirmDifference.set(false);
  }

  denomSubtotal(denom: number): number {
    return Math.round(denom * this.denomQtyNumber(denom) * 100) / 100;
  }

  confirmarApertura(): void {
    const amount = this.parseUsd(this.aperturaMonto());
    if (amount < 0) {
      this.cashActionError.set('El fondo inicial no puede ser negativo.');
      return;
    }
    this.cashActionError.set(null);
    this.desk.openCaja(amount).subscribe({
      next: () => this.closeCajaPanel(),
      error: (err: unknown) => this.cashActionError.set(this.errMsg(err, 'No se pudo abrir la caja.')),
    });
  }

  confirmarCierre(): void {
    const countedCash = this.parseUsd(this.cierreContado());
    const countedCard = this.parseUsd(this.cierreTarjeta());
    const countedTransfer = this.parseUsd(this.cierreTransferencia());
    if (countedCash < 0 || countedCard < 0 || countedTransfer < 0) {
      this.cashActionError.set('Los valores contados no pueden ser negativos.');
      return;
    }
    const cashDiff = this.cierreDiferencia() ?? 0;
    if (Math.abs(cashDiff) > 0.0001 && !this.cierreConfirmDifference()) {
      this.cierreConfirmDifference.set(true);
      this.cashActionError.set('Hay diferencia en efectivo. Revise el cuadre o presione Cerrar caja otra vez para confirmar.');
      return;
    }
    this.cashActionError.set(null);
    this.desk.closeCaja({
      countedCash,
      countedCard,
      countedTransfer,
      notes: this.cierreNotas().trim() || null,
      denominations: this.buildDenominations(),
    }).subscribe({
      next: () => {
        this.closeCajaPanel();
        this.desk.loadHistory();
      },
      error: (err: unknown) => this.cashActionError.set(this.errMsg(err, 'No se pudo cerrar la caja.')),
    });
  }

  private buildDenominations(): PosCajaCierreDenomination[] {
    return this.closeDenominations
      .map((denomination) => ({ denomination, quantity: this.denomQtyNumber(denomination) }))
      .filter((row) => row.quantity > 0);
  }

  logout(): void {
    this.auth.clear();
    const native = sessionStorage.getItem('pos_auth_mode') === 'NATIVE';
    if (native) {
      window.location.href = '/login';
      return;
    }
    window.location.href = `${environment.suiteShellOrigin.replace(/\/+$/, '')}/login`;
  }

  private parseUsd(raw: string): number {
    const t = raw.trim().replace(',', '.');
    if (t === '' || t === '.') {
      return 0;
    }
    const n = Number.parseFloat(t);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
  }

  private formatUsd(value: number): string {
    return String(Math.round(value * 100) / 100);
  }

  private errMsg(err: unknown, fallback: string): string {
    if (err && typeof err === 'object') {
      const maybe = err as { error?: unknown; message?: unknown };
      if (maybe.error && typeof maybe.error === 'object' && 'message' in maybe.error) {
        const msg = (maybe.error as { message?: unknown }).message;
        if (typeof msg === 'string' && msg.trim()) {
          return msg;
        }
      }
      if (typeof maybe.error === 'string' && maybe.error.trim()) {
        return maybe.error;
      }
      if (typeof maybe.message === 'string' && maybe.message.trim()) {
        return maybe.message;
      }
    }
    return fallback;
  }

  private emailLabel(email: string): string {
    const at = email.indexOf('@');
    return at > 0 ? email.slice(0, at) : email;
  }
}
