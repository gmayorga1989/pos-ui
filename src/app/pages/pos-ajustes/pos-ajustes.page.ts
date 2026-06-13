import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs';
import { PosBackendApiService } from '../../core/api/pos-backend-api.service';
import type {
  KushkiSubscriptionPlan,
  KushkiTenantConfigResponse,
  PayPhoneSaleResponse,
  PayPhoneSaleStatusResponse,
  PayPhoneTenantConfigResponse,
  PosPuntoEmisionOption,
  StripeTenantConfigResponse,
} from '../../core/api/pos-backend.types';
import { PosAuthService } from '../../core/auth/pos-auth.service';
import { PosConfigService } from '../../core/config/pos-config.service';
import { environment } from '../../../environments/environment';
import type { PosInvoicingConfigRequest } from '../../core/api/pos-backend.types';
import { decodeJwtPayload } from '../../core/layout/pos-jwt-hint.util';
import {
  PosLayoutPreferencesService,
  type PosDensity,
  type PosDensitySource,
  type PosCardProvider,
  type PosHandedness,
  type PosRoleProfile,
  type PosTheme,
} from '../../core/layout/pos-layout-preferences.service';

type SettingsTab = 'business' | 'station' | 'payments' | 'printing' | 'interface' | 'about';
type KushkiPlanField = keyof KushkiSubscriptionPlan;
type PaymentIntegrationId = 'terminal' | 'stripe' | 'kushki' | 'payphone' | 'manual';

declare global {
  interface Window {
    Kushki?: any;
    KushkiCard?: any;
    initCardToken?: any;
  }
}

@Component({
  selector: 'pos-ajustes-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="settings">
      <aside class="settings-nav" aria-label="Secciones de ajustes">
        <div class="settings-nav__head">
          <span class="settings-nav__mark" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M4 7h10M18 7h2M4 17h2M10 17h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
              <circle cx="16" cy="7" r="2" stroke="currentColor" stroke-width="1.6" />
              <circle cx="8" cy="17" r="2" stroke="currentColor" stroke-width="1.6" />
            </svg>
          </span>
          <div>
            <strong>Configuración</strong>
            <small>POS y estación</small>
          </div>
        </div>
        @for (tab of tabs; track tab.id) {
          <button
            type="button"
            class="settings-nav__item pos-focus-ring"
            [class.settings-nav__item--on]="activeTab() === tab.id"
            (click)="activeTab.set(tab.id)">
            <span class="settings-nav__ico" aria-hidden="true">
              @switch (tab.id) {
                @case ('business') {
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <path d="M6 3h9l3 3v15H6z" stroke="currentColor" stroke-width="1.5" />
                    <path d="M9 10h6M9 14h6M9 18h3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                  </svg>
                }
                @case ('station') {
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <rect x="4" y="6" width="16" height="12" rx="2" stroke="currentColor" stroke-width="1.5" />
                    <path d="M8 10h8M8 14h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                  </svg>
                }
                @case ('printing') {
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <path d="M7 8V4h10v4M7 17H5a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-2" stroke="currentColor" stroke-width="1.5" />
                    <path d="M7 14h10v6H7z" stroke="currentColor" stroke-width="1.5" />
                  </svg>
                }
                @case ('payments') {
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <rect x="3.5" y="6" width="17" height="12" rx="2" stroke="currentColor" stroke-width="1.5" />
                    <path d="M4 10h16M7 15h4M15 15h2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                  </svg>
                }
                @case ('interface') {
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <path d="M4 7h10M18 7h2M4 17h2M10 17h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                    <circle cx="16" cy="7" r="2" stroke="currentColor" stroke-width="1.5" />
                    <circle cx="8" cy="17" r="2" stroke="currentColor" stroke-width="1.5" />
                  </svg>
                }
                @case ('about') {
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.5" />
                    <path d="M12 11v5M12 8h.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
                  </svg>
                }
              }
            </span>
            <span>
              <strong>{{ tab.label }}</strong>
              <small>{{ tab.desc }}</small>
            </span>
          </button>
        }
      </aside>

      <section class="settings-panel">
        @if (activeTab() === 'business') {
          <div class="rules-hero">
            <div class="rules-hero__copy">
              <span class="eyebrow">Panel de control</span>
              <h1>Reglas</h1>
              <p>Configure políticas globales que afectan a todas las cajas: documentos, límites y reglas de venta.</p>
              <div class="rules-hero__stats">
                <span class="rules-stat">
                  <span class="rules-stat__icon rules-stat__icon--purple" aria-hidden="true">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                      <path d="M8 4h11a1 1 0 011 1v14a1 1 0 01-1 1H8a1 1 0 01-1-1V5a1 1 0 011-1z" stroke="currentColor" stroke-width="1.6" />
                      <path d="M8 8h8M8 11h8M8 14h5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
                    </svg>
                  </span>
                  <span class="rules-stat__body">
                    <span class="rules-stat__value">{{ rulesDocumentStatValue() }}</span>
                    <span class="rules-stat__label">Documento · {{ rulesDocumentStatHint() }}</span>
                  </span>
                </span>
                <span class="rules-stat">
                  <span class="rules-stat__icon rules-stat__icon--blue" aria-hidden="true">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.6" />
                      <path d="M9.5 9.5L14.5 14.5M14.5 9.5L9.5 14.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
                    </svg>
                  </span>
                  <span class="rules-stat__body">
                    <span class="rules-stat__value">{{ rulesDiscountStatValue() }}</span>
                    <span class="rules-stat__label">Descuento máx. · {{ rulesDiscountStatHint() }}</span>
                  </span>
                </span>
                <span class="rules-stat">
                  <span class="rules-stat__icon rules-stat__icon--green" aria-hidden="true">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                      <circle cx="9" cy="8" r="3" stroke="currentColor" stroke-width="1.5" />
                      <path d="M3 19c0-3 2.5-5 6-5s6 2 6 5" stroke="currentColor" stroke-width="1.5" />
                    </svg>
                  </span>
                  <span class="rules-stat__body">
                    <span class="rules-stat__value">{{ rulesCustomerStatValue() }}</span>
                    <span class="rules-stat__label">Cliente obligatorio · {{ rulesCustomerStatHint() }}</span>
                  </span>
                </span>
              </div>
            </div>
            <span class="rules-hero__badge">Global Policy</span>
            <div class="rules-hero__art">
              <img
                class="rules-hero__img"
                src="assets/iconos/seguridad_pos_config.png"
                alt=""
                loading="lazy"
                decoding="async" />
            </div>
          </div>
        } @else if (activeTab() === 'station') {
          <div class="station-hero">
            <div class="station-hero__copy">
              <span class="eyebrow">Panel de control</span>
              <h1>Caja y preferencias locales</h1>
              <p>Configuración específica para este navegador/equipo.</p>
              <div class="station-hero__status">
                <span class="station-pill" [class.station-pill--ok]="stationIsConfigured()" [class.station-pill--warn]="!stationIsConfigured()">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    @if (stationIsConfigured()) {
                      <path d="M8 12.5l2.5 2.5L16 9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                      <circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.5" />
                    } @else {
                      <circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.5" />
                      <path d="M12 8v5M12 16h.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
                    }
                  </svg>
                  Estado: {{ stationStatusLabel() }}
                </span>
                <span class="station-pill station-pill--muted">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <rect x="4" y="5" width="16" height="15" rx="2" stroke="currentColor" stroke-width="1.5" />
                    <path d="M8 3v4M16 3v4M4 10h16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                  </svg>
                  Última actualización: {{ stationLastUpdateLabel() }}
                </span>
              </div>
            </div>
            <div class="station-hero__art">
              <img
                class="station-hero__img"
                src="assets/iconos/configuracion02.png"
                alt=""
                loading="lazy"
                decoding="async" />
            </div>
          </div>
        } @else if (activeTab() === 'payments') {
          <div class="payments-hero">
            <div class="payments-hero__copy">
              <span class="eyebrow">Panel de control</span>
              <h1>Cobros</h1>
              <p>Configure terminales, QR y proveedores de pago para operar de forma segura y centralizada.</p>
              <div class="payments-hero__stats">
                <span class="payments-stat">
                  <span class="payments-stat__icon payments-stat__icon--purple" aria-hidden="true">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="8" r="3.5" stroke="currentColor" stroke-width="1.6" />
                      <path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6" stroke="currentColor" stroke-width="1.6" />
                    </svg>
                  </span>
                  <span class="payments-stat__body">
                    <span class="payments-stat__value">{{ paymentActiveProvidersCount() }}</span>
                    <span class="payments-stat__label">Proveedor activo</span>
                  </span>
                </span>
                <span class="payments-stat">
                  <span class="payments-stat__icon payments-stat__icon--blue" aria-hidden="true">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                      <rect x="6" y="3" width="12" height="18" rx="2" stroke="currentColor" stroke-width="1.6" />
                      <path d="M9 7h6M9 10h4M9 14h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
                    </svg>
                  </span>
                  <span class="payments-stat__body">
                    <span class="payments-stat__value">{{ paymentTerminalsCount() }}</span>
                    <span class="payments-stat__label">Terminales asociadas</span>
                  </span>
                </span>
                <span class="payments-stat">
                  <span class="payments-stat__icon payments-stat__icon--teal" aria-hidden="true">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                      <rect x="3" y="6" width="18" height="12" rx="2" stroke="currentColor" stroke-width="1.6" />
                      <path d="M3 10h18" stroke="currentColor" stroke-width="1.6" />
                    </svg>
                  </span>
                  <span class="payments-stat__body">
                    <span class="payments-stat__value">{{ paymentMethodsCount() }}</span>
                    <span class="payments-stat__label">Métodos disponibles</span>
                  </span>
                </span>
              </div>
            </div>
            <span class="payments-hero__badge">Fintech Ready</span>
            <div class="payments-hero__art">
              <img
                class="payments-hero__img"
                src="assets/iconos/configuracion03.png"
                alt=""
                loading="lazy"
                decoding="async" />
            </div>
          </div>
        } @else if (activeTab() === 'printing') {
          <div class="printing-hero">
            <div class="printing-hero__copy">
              <span class="eyebrow">Panel de control</span>
              <h1>Impresión</h1>
              <p>Asigna impresoras, recibos automáticos, etiquetas y cajón de dinero por terminal.</p>
              <div class="printing-hero__stats">
                <span class="printing-stat">
                  <span class="printing-stat__icon printing-stat__icon--purple" aria-hidden="true">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                      <path d="M7 8V4h10v4M7 17H5a2 2 0 01-2-2v-3a2 2 0 012-2h14a2 2 0 012 2v3a2 2 0 01-2 2h-2" stroke="currentColor" stroke-width="1.6" />
                      <path d="M7 14h10v6H7z" stroke="currentColor" stroke-width="1.6" />
                    </svg>
                  </span>
                  <span class="printing-stat__body">
                    <span class="printing-stat__value">{{ printingPrintersStatValue() }}</span>
                    <span class="printing-stat__label">Impresoras · {{ printingPrintersStatHint() }}</span>
                  </span>
                </span>
                <span class="printing-stat">
                  <span class="printing-stat__icon printing-stat__icon--blue" aria-hidden="true">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                      <path d="M8 4h11a1 1 0 011 1v14a1 1 0 01-1 1H8a1 1 0 01-1-1V5a1 1 0 011-1z" stroke="currentColor" stroke-width="1.6" />
                      <path d="M8 8h8M8 11h8M8 14h5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
                    </svg>
                  </span>
                  <span class="printing-stat__body">
                    <span class="printing-stat__value">{{ printingLabelFormatStatValue() }}</span>
                    <span class="printing-stat__label">Formato de etiqueta · {{ printingLabelFormatStatHint() }}</span>
                  </span>
                </span>
                <span class="printing-stat">
                  <span class="printing-stat__icon printing-stat__icon--teal" aria-hidden="true">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                      <rect x="4" y="7" width="16" height="11" rx="1.5" stroke="currentColor" stroke-width="1.6" />
                      <path d="M8 7V5a1 1 0 011-1h6a1 1 0 011 1v2" stroke="currentColor" stroke-width="1.6" />
                      <circle cx="12" cy="13" r="1.5" fill="currentColor" />
                    </svg>
                  </span>
                  <span class="printing-stat__body">
                    <span class="printing-stat__value">{{ printingCashDrawerStatValue() }}</span>
                    <span class="printing-stat__label">Cajón de dinero · {{ printingCashDrawerStatHint() }}</span>
                  </span>
                </span>
              </div>
            </div>
            <span class="printing-hero__badge">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <rect x="5" y="5" width="14" height="14" rx="2" stroke="currentColor" stroke-width="1.5" />
                <path d="M9 9h6M9 12h4M9 15h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
              </svg>
              Hardware
            </span>
            <div class="printing-hero__art">
              <img
                class="printing-hero__img"
                src="assets/iconos/configuracion04.png"
                alt=""
                loading="lazy"
                decoding="async" />
            </div>
          </div>
        } @else if (activeTab() === 'interface') {
          <div class="interface-hero">
            <div class="interface-hero__copy">
              <span class="eyebrow">Panel de control</span>
              <h1>Interfaz</h1>
              <p>Ajustes de visualización para operación táctil o compacta, tema claro/nocturno y catálogo.</p>
              <div class="interface-hero__stats">
                <span class="interface-stat">
                  <span class="interface-stat__icon interface-stat__icon--purple" aria-hidden="true">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                      <circle cx="8" cy="9" r="2.2" stroke="currentColor" stroke-width="1.5" />
                      <circle cx="14" cy="7.5" r="2.2" stroke="currentColor" stroke-width="1.5" />
                      <circle cx="17" cy="13" r="2.2" stroke="currentColor" stroke-width="1.5" />
                      <path d="M8 11.5c1.2 2.2 3.2 3.5 6 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                    </svg>
                  </span>
                  <span class="interface-stat__body">
                    <span class="interface-stat__value">{{ interfaceThemeStatValue() }}</span>
                    <span class="interface-stat__label">Tema actual · {{ interfaceThemeStatHint() }}</span>
                  </span>
                </span>
                <span class="interface-stat">
                  <span class="interface-stat__icon interface-stat__icon--blue" aria-hidden="true">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                      <path d="M8 6l2.5 2.5M8 6l-2.5 2.5M8 6v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                      <path d="M4 14c0-2.5 2-4.5 4.5-4.5H12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                      <circle cx="16.5" cy="14.5" r="2.5" stroke="currentColor" stroke-width="1.5" />
                    </svg>
                  </span>
                  <span class="interface-stat__body">
                    <span class="interface-stat__value">{{ interfaceHandednessStatValue() }}</span>
                    <span class="interface-stat__label">Ergonomía · {{ interfaceHandednessStatHint() }}</span>
                  </span>
                </span>
                <span class="interface-stat">
                  <span class="interface-stat__icon interface-stat__icon--teal" aria-hidden="true">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                      <rect x="5" y="5" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.5" />
                      <rect x="13" y="5" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.5" />
                      <rect x="5" y="13" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.5" />
                      <rect x="13" y="13" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.5" />
                    </svg>
                  </span>
                  <span class="interface-stat__body">
                    <span class="interface-stat__value">{{ interfaceDensityStatValue() }}</span>
                    <span class="interface-stat__label">Densidad · {{ interfaceDensityStatHint() }}</span>
                  </span>
                </span>
              </div>
            </div>
            <span class="interface-hero__badge">UX</span>
            <div class="interface-hero__art">
              <img
                class="interface-hero__img"
                src="assets/iconos/configuracion05.png"
                alt=""
                loading="lazy"
                decoding="async" />
            </div>
          </div>
        } @else if (activeTab() === 'about') {
          <div class="about-hero">
            <div class="about-hero__copy">
              <span class="eyebrow">Panel de control</span>
              <h1>Información</h1>
              <p>Información de versión, estado de integración y criterios usados para estructurar el POS.</p>
            </div>
            <span class="about-hero__badge">Sistema</span>
            <div class="about-hero__art">
              <img
                class="about-hero__img"
                src="assets/iconos/configuracion06.png"
                alt=""
                loading="lazy"
                decoding="async" />
            </div>
          </div>
        }

        @switch (activeTab()) {
          @case ('business') {
            @if (!canManageBusinessRules()) {
              <div class="lock-note">
                Estos controles están en modo lectura para tu perfil. Requieren rol <strong>ADMIN</strong>,
                <strong>SUITE_ADMIN</strong> o <strong>POS_ADMIN</strong>.
              </div>
            }

            @if (invoicingProvider() === 'CUSTOM') {
              <div class="card-grid" style="margin-bottom: 1rem">
                <label class="field">
                  <span>URL emisión terceros</span>
                  <input class="input pos-focus-ring" [ngModel]="invoicingCustomUrl()" (ngModelChange)="invoicingCustomUrl.set($event)" />
                </label>
                <label class="field">
                  <span>Auth</span>
                  <select class="input pos-focus-ring" [ngModel]="invoicingCustomAuth()" (ngModelChange)="invoicingCustomAuth.set($event)">
                    <option value="API_KEY">API Key</option>
                    <option value="BEARER">Bearer</option>
                  </select>
                </label>
                <label class="field">
                  <span>API Key / Token</span>
                  <input class="input pos-focus-ring" type="password" [ngModel]="invoicingCustomApiKey()" (ngModelChange)="invoicingCustomApiKey.set($event)" />
                </label>
                <div class="field">
                  <span>&nbsp;</span>
                  <button type="button" class="btn-primary pos-focus-ring" (click)="saveInvoicingConfig()">Guardar integración</button>
                </div>
              </div>
              @if (invoicingStatus()) {
                <p class="hint">{{ invoicingStatus() }}</p>
              }
            }

            <div class="rules-board">
              <section class="rules-config-panel">
                <header class="rules-config-panel__head">
                  <h2>Configuración de reglas</h2>
                  <p>Defina las políticas que se aplicarán en todas las cajas del sistema.</p>
                </header>

                @if (invoicingProvider() !== 'NONE') {
                  <div class="fiscal-alert">
                    <span class="fiscal-alert__icon" aria-hidden="true">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.6" />
                        <path d="M8 12.5l2.5 2.5L16 9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
                      </svg>
                    </span>
                    <span class="fiscal-alert__text">
                      Pendientes fiscales offline: <strong>{{ invoicingPending() }}</strong>
                    </span>
                    <button type="button" class="fiscal-alert__btn pos-focus-ring" (click)="retryInvoicingPending()">
                      Reintentar ahora
                    </button>
                  </div>
                }

                <div class="rules-field-grid">
                  <label class="rule-field-card">
                    <span class="rule-field-card__icon" aria-hidden="true">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                        <path d="M8 4h11a1 1 0 011 1v14a1 1 0 01-1 1H8a1 1 0 01-1-1V5a1 1 0 011-1z" stroke="currentColor" stroke-width="1.6" />
                        <path d="M8 8h8M8 11h8M8 14h5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
                      </svg>
                    </span>
                    <span class="rule-field-card__body">
                      <span class="rule-field-card__label">Documento por defecto</span>
                      <select
                        class="rule-field-card__input pos-focus-ring"
                        [disabled]="!canManageBusinessRules()"
                        [ngModel]="prefs.defaultDocumentType()"
                        (ngModelChange)="prefs.setDefaultDocumentType($event)">
                        <option value="nota-venta">Nota de venta</option>
                        <option value="factura">Factura</option>
                        <option value="preguntar">Preguntar al cobrar</option>
                      </select>
                      <small class="rule-field-card__hint">Documento emitido por defecto en cada venta.</small>
                    </span>
                  </label>

                  <label class="rule-field-card">
                    <span class="rule-field-card__icon" aria-hidden="true">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                        <path d="M8 4h11a1 1 0 011 1v14a1 1 0 01-1 1H8a1 1 0 01-1-1V5a1 1 0 011-1z" stroke="currentColor" stroke-width="1.6" />
                        <path d="M8 8h8M8 11h8M8 14h5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
                      </svg>
                    </span>
                    <span class="rule-field-card__body">
                      <span class="rule-field-card__label">Formato de comprobante</span>
                      <select
                        class="rule-field-card__input pos-focus-ring"
                        [disabled]="!canManageBusinessRules()"
                        [ngModel]="prefs.receiptTemplate()"
                        (ngModelChange)="prefs.setReceiptTemplate($event)">
                        <option value="ticket-58">Ticket 58 mm</option>
                        <option value="ticket-80">Ticket 80 mm</option>
                        <option value="a4">A4 factura completa</option>
                      </select>
                      <small class="rule-field-card__hint">Formato del ticket o factura impresa.</small>
                    </span>
                  </label>

                  <label class="rule-field-card">
                    <span class="rule-field-card__icon rule-field-card__icon--glyph" aria-hidden="true">%</span>
                    <span class="rule-field-card__body">
                      <span class="rule-field-card__label">Límite máximo de descuento (%)</span>
                      <input
                        class="rule-field-card__input pos-focus-ring"
                        type="number"
                        min="0"
                        max="100"
                        [disabled]="!canManageBusinessRules()"
                        [ngModel]="prefs.maxDiscountPercent()"
                        (ngModelChange)="prefs.setMaxDiscountPercent($event)" />
                      <small class="rule-field-card__hint">Porcentaje máximo permitido por el cajero.</small>
                    </span>
                  </label>

                  <label class="rule-field-card">
                    <span class="rule-field-card__icon" aria-hidden="true">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                        <path d="M6 4h11l3 3v13a1 1 0 01-1 1H6a1 1 0 01-1-1V5a1 1 0 011-1z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
                        <path d="M17 4v3h3" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
                      </svg>
                    </span>
                    <span class="rule-field-card__body">
                      <span class="rule-field-card__label">Factura obligatoria desde</span>
                      <input
                        class="rule-field-card__input pos-focus-ring"
                        type="number"
                        min="0"
                        inputmode="decimal"
                        [disabled]="!canManageBusinessRules()"
                        [ngModel]="prefs.minInvoiceAmount()"
                        (ngModelChange)="prefs.setMinInvoiceAmount($event)" />
                      <small class="rule-field-card__hint">Monto mínimo para exigir factura electrónica.</small>
                    </span>
                  </label>

                  <label class="rule-field-card">
                    <span class="rule-field-card__icon" aria-hidden="true">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                        <circle cx="9" cy="8" r="3" stroke="currentColor" stroke-width="1.5" />
                        <path d="M3 19c0-3 2.5-5 6-5s6 2 6 5" stroke="currentColor" stroke-width="1.5" />
                      </svg>
                    </span>
                    <span class="rule-field-card__body">
                      <span class="rule-field-card__label">Cliente requerido sobre</span>
                      <input
                        class="rule-field-card__input pos-focus-ring"
                        type="number"
                        min="0"
                        inputmode="decimal"
                        [disabled]="!canManageBusinessRules()"
                        [ngModel]="prefs.requireCustomerOver()"
                        (ngModelChange)="prefs.setRequireCustomerOver($event)" />
                      <small class="rule-field-card__hint">Monto a partir del cual se exige cliente.</small>
                    </span>
                  </label>
                </div>
              </section>

              <aside class="rules-smart-panel" aria-label="Reglas inteligentes">
                <h3 class="rules-smart-panel__title">
                  <span class="rules-smart-panel__sparkle" aria-hidden="true">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                      <path d="M12 3l1.4 4.3H18l-3.6 2.6 1.4 4.3L12 11.6 8.2 14.2l1.4-4.3L6 7.3h4.6L12 3z" fill="currentColor" />
                    </svg>
                  </span>
                  Reglas inteligentes
                </h3>
                <p class="rules-smart-panel__text">
                  Activa controles y validaciones que garantizan el correcto funcionamiento de tu punto de venta.
                </p>
                <ul class="rules-smart-panel__list">
                  <li>
                    <span class="rules-smart-panel__check" aria-hidden="true">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                        <path d="M8 12.5l2.5 2.5L16 9" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
                      </svg>
                    </span>
                    Facturación habilitada
                  </li>
                  <li>
                    <span class="rules-smart-panel__check" aria-hidden="true">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                        <path d="M8 12.5l2.5 2.5L16 9" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
                      </svg>
                    </span>
                    Control de descuentos
                  </li>
                  <li>
                    <span class="rules-smart-panel__check" aria-hidden="true">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                        <path d="M8 12.5l2.5 2.5L16 9" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
                      </svg>
                    </span>
                    Validación de cliente
                  </li>
                  <li>
                    <span class="rules-smart-panel__check" aria-hidden="true">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                        <path d="M8 12.5l2.5 2.5L16 9" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
                      </svg>
                    </span>
                    Aplicación global
                  </li>
                  <li>
                    <span class="rules-smart-panel__check" aria-hidden="true">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                        <path d="M8 12.5l2.5 2.5L16 9" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
                      </svg>
                    </span>
                    Persistencia en backend
                  </li>
                </ul>
                <div class="rules-smart-panel__status">
                  <span class="rules-smart-panel__status-icon" aria-hidden="true">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                      <path d="M12 3.5l7 3.2v5.1c0 4.1-2.9 7.9-7 9.2-4.1-1.3-7-5.1-7-9.2V6.7l7-3.2z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
                      <path d="M8 12.5l2.5 2.5L16 9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
                    </svg>
                  </span>
                  <span>Estado: <strong>Activo</strong></span>
                </div>
              </aside>
            </div>
          }

          @case ('station') {
            <div class="station-board">
              <article class="station-card station-card--ident">
                <header class="station-card__head">
                  <span class="station-card__icon station-card__icon--purple" aria-hidden="true">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                      <rect x="3" y="5" width="18" height="12" rx="2" stroke="currentColor" stroke-width="1.6" />
                      <path d="M8 19h8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
                    </svg>
                  </span>
                  <span class="station-card__titles">
                    <strong>Identificación de estación</strong>
                    <small>Datos únicos para esta caja</small>
                  </span>
                </header>
                <div class="station-card__body">
                  <label class="station-field">
                    <span class="station-field__label">Identificador de caja</span>
                    <input
                      type="text"
                      class="station-field__input pos-focus-ring"
                      placeholder="CAJA-01"
                      [ngModel]="prefs.cajaId()"
                      (ngModelChange)="onCaja($event)" />
                  </label>
                  @if (puntosError()) {
                    <p class="station-note station-note--warn">{{ puntosError() }}</p>
                  }
                  @if (puntos().length > 0) {
                    <label class="station-field">
                      <span class="station-field__label">Punto de emisión (eFactura)</span>
                      <select
                        class="station-field__input pos-focus-ring"
                        [ngModel]="prefs.puntoEmisionId()"
                        (ngModelChange)="onPuntoEmision($event)">
                        <option value="">Seleccione</option>
                        @for (pe of puntos(); track pe.id) {
                          <option [value]="pe.id">{{ pe.establecimientoCodigo }}-{{ pe.codigo }} · {{ pe.nombre }}</option>
                        }
                      </select>
                    </label>
                  } @else {
                    <div class="station-field-row">
                      <label class="station-field">
                        <span class="station-field__label">Sucursal local</span>
                        <input
                          type="text"
                          class="station-field__input pos-focus-ring"
                          maxlength="3"
                          placeholder="001"
                          [ngModel]="prefs.localBranchCode()"
                          (ngModelChange)="onLocalBranch($event)" />
                      </label>
                      <label class="station-field">
                        <span class="station-field__label">Emisión local</span>
                        <input
                          type="text"
                          class="station-field__input pos-focus-ring"
                          maxlength="3"
                          placeholder="001"
                          [ngModel]="prefs.localEmissionCode()"
                          (ngModelChange)="onLocalEmission($event)" />
                      </label>
                    </div>
                  }
                </div>
              </article>

              <article
                class="station-card station-card--efactura"
                [class.station-card--efactura-pending]="!efacturaIntegrationReady()">
                <header class="station-card__head station-card__head--efactura">
                  <span class="station-card__head-main">
                    <span class="station-card__icon station-card__icon--amber" aria-hidden="true">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                        <path d="M12 4.5L19.5 18H4.5L12 4.5z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
                        <path d="M12 9.5v4M12 16h.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
                      </svg>
                    </span>
                    <strong class="station-card__title-plain">Integración eFactura</strong>
                  </span>
                  <span class="station-card__badge" [class.station-card__badge--ok]="efacturaIntegrationReady()">
                    {{ efacturaIntegrationReady() ? 'Lista' : 'Pendiente' }}
                  </span>
                </header>
                <div class="station-card__body station-card__body--center">
                  @if (efacturaIntegrationReady()) {
                    <p class="station-card__copy">Punto de emisión disponible para operación fiscal en esta estación.</p>
                  } @else {
                    <p class="station-card__copy">
                      No se encontraron puntos de emisión configurados para esta estación.
                    </p>
                    <button type="button" class="station-card__cta pos-focus-ring" (click)="openBusinessTab()">
                      Configurar ahora
                    </button>
                  }
                </div>
              </article>

              <article class="station-card station-card--experience">
                <header class="station-card__head">
                  <span class="station-card__icon station-card__icon--purple" aria-hidden="true">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                      <path d="M13 3L5 14h6l-1 7 8-11h-6l1-7z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
                    </svg>
                  </span>
                  <span class="station-card__titles">
                    <strong>Experiencia de venta</strong>
                  </span>
                </header>
                <div class="station-card__body station-card__body--experience">
                  <div class="station-toggle-row">
                    <span class="station-toggle-row__copy">
                      <strong>Sonido al agregar productos</strong>
                      <small>Feedback al añadir/quitar ítems.</small>
                    </span>
                    <label class="station-switch">
                      <input
                        type="checkbox"
                        [checked]="prefs.soundOn()"
                        (change)="onStationSoundToggle()" />
                      <span class="station-switch__ui" aria-hidden="true"></span>
                    </label>
                  </div>
                  <div class="station-toggle-row">
                    <span class="station-toggle-row__copy">
                      <strong>Escaneo automático</strong>
                      <small>Agregar al escanear código exacto.</small>
                    </span>
                    <label class="station-switch">
                      <input
                        type="checkbox"
                        [checked]="prefs.scanAutoAdd()"
                        (change)="onStationScanToggle()" />
                      <span class="station-switch__ui" aria-hidden="true"></span>
                    </label>
                  </div>
                  <div class="station-toggle-row">
                    <span class="station-toggle-row__copy">
                      <strong>Separar productos repetidos</strong>
                      <small>En nuevas líneas durante la venta.</small>
                    </span>
                    <label class="station-switch">
                      <input
                        type="checkbox"
                        [checked]="prefs.separateSameProductLines()"
                        (change)="onStationSeparateLinesToggle()" />
                      <span class="station-switch__ui" aria-hidden="true"></span>
                    </label>
                  </div>
                </div>
              </article>

              <article class="station-card station-card--upsell">
                <header class="station-card__head station-card__head--split">
                  <span class="station-card__head-main">
                    <span class="station-card__icon station-card__icon--purple" aria-hidden="true">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.6" />
                        <circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.6" />
                        <circle cx="12" cy="12" r="1.2" fill="currentColor" />
                      </svg>
                    </span>
                    <span class="station-card__titles">
                      <strong>Ventas inteligentes</strong>
                    </span>
                  </span>
                  <label class="station-switch">
                    <input
                      type="checkbox"
                      [checked]="prefs.upsellOn()"
                      (change)="onStationUpsellToggle()" />
                    <span class="station-switch__ui" aria-hidden="true"></span>
                  </label>
                </header>
                <div class="station-card__body">
                  <p class="station-card__copy">Sugerencias de productos relacionados durante la venta.</p>
                  @if (prefs.upsellOn()) {
                    <span class="station-chip">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path d="M12 3l1.4 4.3H18l-3.6 2.6 1.4 4.3L12 11.6 8.2 14.2l1.4-4.3L6 7.3h4.6L12 3z" fill="currentColor" />
                      </svg>
                      Sugerencias de upsell activas
                    </span>
                  }
                </div>
              </article>

              <article class="station-card station-card--pricing">
                <header class="station-card__head">
                  <span class="station-card__icon station-card__icon--green" aria-hidden="true">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.6" />
                      <path d="M12 7.5v8M9.5 10.5c0-1.2 1.1-2 2.5-2s2.5.8 2.5 2c0 1.6-2.5 1.8-2.5 3.2M12 16.8h.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                    </svg>
                  </span>
                  <span class="station-card__titles">
                    <strong>Política de precios</strong>
                    <small>Control de listas en venta</small>
                  </span>
                </header>
                <div class="station-card__body">
                  <p class="station-card__copy">Define si el cajero puede cambiar la lista de precios durante la venta.</p>
                  <div class="station-toggle-row">
                    <span class="station-toggle-row__copy">
                      <strong>Permitir cambiar lista de precios</strong>
                      <small>Si está desactivado, se usa la lista asignada al cliente.</small>
                    </span>
                    <label class="station-switch">
                      <input
                        type="checkbox"
                        [checked]="prefs.allowManualPriceListSelection()"
                        (change)="onStationPriceListToggle()" />
                      <span class="station-switch__ui" aria-hidden="true"></span>
                    </label>
                  </div>
                </div>
              </article>
            </div>
          }

          @case ('printing') {
            <div class="printing-board">
              <section class="printing-config-panel">
                <header class="printing-config-panel__head">
                  <h2>Impresión y etiquetas</h2>
                  <p>Configure impresoras, formatos y comportamiento automático para esta estación.</p>
                </header>

                <div class="printing-field-grid">
                  <label class="rule-field-card">
                    <span class="rule-field-card__icon" aria-hidden="true">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                        <path d="M7 8V4h10v4M7 17H5a2 2 0 01-2-2v-3a2 2 0 012-2h14a2 2 0 012 2v3a2 2 0 01-2 2h-2" stroke="currentColor" stroke-width="1.6" />
                        <path d="M7 14h10v6H7z" stroke="currentColor" stroke-width="1.6" />
                      </svg>
                    </span>
                    <span class="rule-field-card__body">
                      <span class="rule-field-card__label">Impresora de recibos</span>
                      <select
                        class="rule-field-card__input pos-focus-ring"
                        [ngModel]="prefs.receiptPrinter()"
                        (ngModelChange)="prefs.setReceiptPrinter($event)">
                        <option value="">Sin asignar</option>
                        <option value="epson-tm-t20">Epson TM-T20 / compatible ESC/POS</option>
                        <option value="star-tsp100">Star TSP100</option>
                        <option value="browser-default">Impresora del navegador</option>
                      </select>
                      <small class="rule-field-card__hint">Selecciona la impresora para recibos de venta.</small>
                    </span>
                  </label>

                  <label class="rule-field-card">
                    <span class="rule-field-card__icon" aria-hidden="true">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                        <rect x="5" y="4" width="14" height="16" rx="1.5" stroke="currentColor" stroke-width="1.6" />
                        <path d="M8 8h8M8 11h6M8 14h4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
                        <path d="M16 4v3h3" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
                      </svg>
                    </span>
                    <span class="rule-field-card__body">
                      <span class="rule-field-card__label">Impresora de etiquetas</span>
                      <select
                        class="rule-field-card__input pos-focus-ring"
                        [ngModel]="prefs.labelPrinter()"
                        (ngModelChange)="prefs.setLabelPrinter($event)">
                        <option value="">Sin asignar</option>
                        <option value="zebra-zd">Zebra ZD / ZPL</option>
                        <option value="dymo">DYMO LabelWriter</option>
                        <option value="browser-default">Impresora del navegador</option>
                      </select>
                      <small class="rule-field-card__hint">Selecciona la impresora para etiquetas de producto.</small>
                    </span>
                  </label>

                  <label class="rule-field-card">
                    <span class="rule-field-card__icon" aria-hidden="true">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                        <path d="M6 6l12 0 0 12-12 0z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
                        <path d="M9 10h6M9 13h4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
                      </svg>
                    </span>
                    <span class="rule-field-card__body">
                      <span class="rule-field-card__label">Formato de etiqueta</span>
                      <select
                        class="rule-field-card__input pos-focus-ring"
                        [ngModel]="prefs.labelFormat()"
                        (ngModelChange)="prefs.setLabelFormat($event)">
                        <option value="58x40">58 x 40 mm precio + barcode</option>
                        <option value="50x30">50 x 30 mm compacto</option>
                        <option value="38x25">38 x 25 mm góndola</option>
                        <option value="custom">Plantilla personalizada</option>
                      </select>
                      <small class="rule-field-card__hint">Define el formato y contenido de tus etiquetas.</small>
                    </span>
                  </label>

                  <div class="rule-field-card rule-field-card--toggle">
                    <span class="rule-field-card__icon" aria-hidden="true">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                        <path d="M8 4h11a1 1 0 011 1v14a1 1 0 01-1 1H8a1 1 0 01-1-1V5a1 1 0 011-1z" stroke="currentColor" stroke-width="1.6" />
                        <path d="M8 8h8M8 11h8M8 14h5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
                      </svg>
                    </span>
                    <span class="rule-field-card__body">
                      <span class="rule-field-card__label-row">
                        <span class="rule-field-card__label">Imprimir recibo automáticamente</span>
                        <label class="station-switch">
                          <input
                            type="checkbox"
                            [checked]="prefs.autoReceipt()"
                            (change)="prefs.setAutoReceipt(!prefs.autoReceipt())" />
                          <span class="station-switch__ui" aria-hidden="true"></span>
                        </label>
                      </span>
                      <small class="rule-field-card__hint">El recibo se imprimirá automáticamente tras registrar el pago.</small>
                    </span>
                  </div>

                  <div class="rule-field-card rule-field-card--toggle">
                    <span class="rule-field-card__icon" aria-hidden="true">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                        <rect x="4" y="7" width="16" height="11" rx="1.5" stroke="currentColor" stroke-width="1.6" />
                        <path d="M8 7V5a1 1 0 011-1h6a1 1 0 011 1v2" stroke="currentColor" stroke-width="1.6" />
                        <circle cx="12" cy="13" r="1.5" fill="currentColor" />
                      </svg>
                    </span>
                    <span class="rule-field-card__body">
                      <span class="rule-field-card__label-row">
                        <span class="rule-field-card__label">Abrir cajón al pago en efectivo</span>
                        <label class="station-switch">
                          <input
                            type="checkbox"
                            [checked]="prefs.openDrawerAfterCash()"
                            (change)="prefs.setOpenDrawerAfterCash(!prefs.openDrawerAfterCash())" />
                          <span class="station-switch__ui" aria-hidden="true"></span>
                        </label>
                      </span>
                      <small class="rule-field-card__hint">Requiere impresora/cajón compatible.</small>
                    </span>
                  </div>

                  <div class="printing-smart-card">
                    <div class="printing-smart-card__copy">
                      <span class="printing-smart-card__icon" aria-hidden="true">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                          <path d="M12 3.5l7 3.2v5.1c0 4.1-2.9 7.9-7 9.2-4.1-1.3-7-5.1-7-9.2V6.7l7-3.2z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
                          <path d="M8 12.5l2.5 2.5L16 9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
                        </svg>
                      </span>
                      <span class="printing-smart-card__texts">
                        <strong>Impresión inteligente</strong>
                        <small>Optimiza la experiencia de impresión asignando los dispositivos correctos para cada tipo de documento.</small>
                      </span>
                    </div>
                    <div class="printing-smart-card__orb" aria-hidden="true">
                      <span class="printing-smart-card__orb-glow"></span>
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                        <path d="M12 3.5l7 3.2v5.1c0 4.1-2.9 7.9-7 9.2-4.1-1.3-7-5.1-7-9.2V6.7l7-3.2z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" />
                        <path d="M8 12.5l2.5 2.5L16 9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
                      </svg>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          }

          @case ('payments') {
            <div class="payments-board">
              <header class="payments-board__head">
                <h2>Proveedores de pago</h2>
                <p>Administra tus proveedores y métodos de cobro disponibles para esta caja.</p>
              </header>

              <div class="payments-catalog" aria-label="Catálogo de integraciones de pago">
                @for (item of paymentIntegrationCards(); track item.id) {
                  <button
                    type="button"
                    class="payment-provider-card pos-focus-ring"
                    [class.payment-provider-card--on]="selectedPaymentIntegration() === item.id"
                    [class.payment-provider-card--disabled]="paymentProviderIsDisabled(item)"
                    (click)="openPaymentIntegration(item.id)">
                    <span class="payment-provider-card__top">
                      <span class="payment-provider-card__icon" aria-hidden="true">{{ item.shortName }}</span>
                      <span
                        class="payment-provider-card__badge"
                        [class.payment-provider-card__badge--base]="item.id === 'terminal'"
                        [class.payment-provider-card__badge--disabled]="paymentProviderIsDisabled(item)"
                        [class.payment-provider-card__badge--available]="item.id === 'manual'">
                        {{ paymentProviderBadge(item) }}
                      </span>
                    </span>
                    <strong class="payment-provider-card__title">{{ item.name }}</strong>
                    <small class="payment-provider-card__desc">{{ item.description }}</small>
                    <span class="payment-provider-card__chips">
                      @for (capability of item.capabilities; track capability) {
                        <span>{{ capability }}</span>
                      }
                    </span>
                    <span class="payment-provider-card__foot">
                      <span
                        class="payment-provider-card__status"
                        [class.payment-provider-card__status--ok]="paymentProviderStatusTone(item) === 'ok'"
                        [class.payment-provider-card__status--muted]="paymentProviderStatusTone(item) === 'muted'"
                        [class.payment-provider-card__status--info]="paymentProviderStatusTone(item) === 'info'">
                        <span class="payment-provider-card__dot" aria-hidden="true"></span>
                        Estado: {{ paymentProviderStatusLabel(item) }}
                      </span>
                      <span class="payment-provider-card__action">
                        Configurar
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <path d="M10 7l5 5-5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
                        </svg>
                      </span>
                    </span>
                  </button>
                }
              </div>

              <div class="payments-config-bar">
                <div class="payments-config-bar__lead">
                  <span class="payments-config-bar__icon" aria-hidden="true">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="3.2" stroke="currentColor" stroke-width="1.6" />
                      <path
                        d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.55 1.55M17.85 17.85l1.55 1.55M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.55-1.55M17.85 6.15l1.55-1.55"
                        stroke="currentColor"
                        stroke-width="1.6"
                        stroke-linecap="round" />
                    </svg>
                  </span>
                  <span class="payments-config-bar__copy">
                    <strong>Terminales y configuración general</strong>
                    <small>Asocia terminales, define reglas de cobro y configura el comportamiento de pagos en esta estación.</small>
                  </span>
                </div>
                <div class="payments-config-bar__checks">
                  <span class="payments-config-bar__check">
                    <span class="payments-config-bar__check-icon" aria-hidden="true">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                        <path d="M8 12.5l2.5 2.5L16 9" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
                      </svg>
                    </span>
                    <span class="payments-config-bar__check-copy">
                      <strong>QR habilitado</strong>
                      <small>Escaneo y generación de códigos QR</small>
                    </span>
                  </span>
                  <span class="payments-config-bar__check">
                    <span class="payments-config-bar__check-icon" aria-hidden="true">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                        <path d="M8 12.5l2.5 2.5L16 9" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
                      </svg>
                    </span>
                    <span class="payments-config-bar__check-copy">
                      <strong>Terminal asociada</strong>
                      <small>{{ paymentTerminalLinkedLabel() }}</small>
                    </span>
                  </span>
                  <span class="payments-config-bar__check">
                    <span class="payments-config-bar__check-icon" aria-hidden="true">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                        <path d="M8 12.5l2.5 2.5L16 9" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
                      </svg>
                    </span>
                    <span class="payments-config-bar__check-copy">
                      <strong>Registro manual</strong>
                      <small>Autorizaciones manuales activas</small>
                    </span>
                  </span>
                </div>
                <button type="button" class="payments-config-bar__btn pos-focus-ring" (click)="openPaymentIntegration('terminal')">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.5" />
                    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                  </svg>
                  Configurar
                </button>
              </div>
            </div>

            @if (paymentIntegrationModalOpen()) {
              <div class="integration-modal-dim" role="presentation" (click)="closePaymentIntegrationModal()"></div>
              <section class="integration-modal" role="dialog" aria-modal="true" aria-labelledby="payment-integration-title">
                <div class="integration-modal__head">
                  <div>
                    <span class="eyebrow">Integraci&oacute;n de pago</span>
                    <h2 id="payment-integration-title">{{ selectedPaymentIntegrationCard().name }}</h2>
                    <p>{{ selectedPaymentIntegrationCard().description }}</p>
                  </div>
                  <button type="button" class="mini-btn pos-focus-ring" (click)="closePaymentIntegrationModal()">Cerrar</button>
                </div>

                <div class="card-grid integration-modal__body">
              <label class="field" [class.integration-panel--hidden]="selectedPaymentIntegration() !== 'terminal'">
                <span>Proveedor principal de tarjeta</span>
                <select
                  class="input pos-focus-ring"
                  [ngModel]="prefs.cardProvider()"
                  (ngModelChange)="onCardProvider($event)">
                  <option value="datafast">Datafast / adquirente local</option>
                  <option value="kushki">Kushki</option>
                  <option value="nuvei">Nuvei / Paymentez</option>
                  <option value="placetopay">PlacetoPay</option>
                  <option value="payphone">PayPhone</option>
                  <option value="manual">Registro manual</option>
                </select>
              </label>

              <label class="field" [class.integration-panel--hidden]="selectedPaymentIntegration() !== 'terminal'">
                <span>Terminal o caja asociada</span>
                <input
                  type="text"
                  class="input pos-focus-ring"
                  placeholder="Ej. POS-CAJA-01 / MID-TID"
                  [ngModel]="prefs.cardTerminalId()"
                  (ngModelChange)="prefs.setCardTerminalId($event)" />
              </label>

              <label class="field" [class.integration-panel--hidden]="selectedPaymentIntegration() !== 'terminal'">
                <span>Link / QR por defecto</span>
                <select
                  class="input pos-focus-ring"
                  [ngModel]="prefs.cardLinkMode()"
                  (ngModelChange)="prefs.setCardLinkMode($event)">
                  <option value="qr-link">QR + link corto</option>
                  <option value="sms">Enviar por SMS</option>
                  <option value="email">Enviar por email</option>
                  <option value="none">No usar link</option>
                </select>
              </label>

              <div class="info-card field--wide" [class.integration-panel--hidden]="selectedPaymentIntegration() !== 'terminal'">
                <strong>Datos que debe devolver backend</strong>
                <p>Aprobado/rechazado, autorizaci&oacute;n, referencia, proveedor, &uacute;ltimos 4 d&iacute;gitos, marca, lote y estado de conciliaci&oacute;n.</p>
              </div>

              <div class="info-card field--wide" [class.integration-panel--hidden]="selectedPaymentIntegration() !== 'manual'">
                <strong>Registro manual / voucher externo</strong>
                <p>Use esta integraci&oacute;n como contingencia para pagos aprobados fuera del POS. El cierre debe exigir autorizaci&oacute;n, referencia, proveedor y usuario responsable.</p>
              </div>

              <div class="field field--wide stripe-box" [class.integration-panel--hidden]="selectedPaymentIntegration() !== 'stripe'">
                <div class="stripe-box__head">
                  <div>
                    <span>Stripe por empresa</span>
                    <small>{{ stripeConfigLabel() }}</small>
                  </div>
                  <button
                    type="button"
                    class="mini-btn pos-focus-ring"
                    [disabled]="stripeLoading()"
                    (click)="loadStripeConfig()">
                    Recargar
                  </button>
                </div>

                @if (stripeStatus()) {
                  <p class="stripe-status" [class.stripe-status--ok]="stripeConfigured()" [class.stripe-status--warn]="!stripeConfigured()">
                    {{ stripeStatus() }}
                  </p>
                }

                <div class="stripe-grid">
                  <label class="toggle">
                    <span>
                      <strong>Habilitar Stripe</strong>
                      <small>Usa la configuraci&oacute;n de esta empresa para cobros digitales.</small>
                    </span>
                    <input type="checkbox" [checked]="stripeEnabled()" (change)="stripeEnabled.set(!stripeEnabled())" />
                  </label>

                  <label class="toggle">
                    <span>
                      <strong>Automatic tax</strong>
                      <small>Deja que Stripe calcule impuestos si la cuenta lo soporta.</small>
                    </span>
                    <input type="checkbox" [checked]="stripeAutomaticTax()" (change)="stripeAutomaticTax.set(!stripeAutomaticTax())" />
                  </label>

                  <label class="toggle">
                    <span>
                      <strong>Promotion codes</strong>
                      <small>Permite cupones/c&oacute;digos promocionales en Checkout.</small>
                    </span>
                    <input type="checkbox" [checked]="stripePromotionCodes()" (change)="stripePromotionCodes.set(!stripePromotionCodes())" />
                  </label>

                  <label class="field">
                    <span>Stripe Secret Key</span>
                    <input
                      type="password"
                      class="input pos-focus-ring"
                      autocomplete="new-password"
                      [placeholder]="stripeSecretConfigured() ? 'Guardada; ingrese una nueva para reemplazar' : 'sk_test_...'"
                      [ngModel]="stripeSecretKey()"
                      (ngModelChange)="stripeSecretKey.set($event)" />
                  </label>

                  <label class="field">
                    <span>Publishable Key</span>
                    <input
                      type="text"
                      class="input pos-focus-ring"
                      placeholder="pk_test_..."
                      [ngModel]="stripePublishableKey()"
                      (ngModelChange)="stripePublishableKey.set($event)" />
                  </label>

                  <label class="field">
                    <span>Price ID starter</span>
                    <input
                      type="text"
                      class="input pos-focus-ring"
                      placeholder="price_..."
                      [ngModel]="stripeStarterPriceId()"
                      (ngModelChange)="stripeStarterPriceId.set($event)" />
                  </label>

                  <label class="field">
                    <span>Success URL</span>
                    <input
                      type="url"
                      class="input pos-focus-ring"
                      placeholder="http://localhost:4220/venta?stripe=success"
                      [ngModel]="stripeSuccessUrl()"
                      (ngModelChange)="stripeSuccessUrl.set($event)" />
                  </label>

                  <label class="field">
                    <span>Cancel URL</span>
                    <input
                      type="url"
                      class="input pos-focus-ring"
                      placeholder="http://localhost:4220/venta?stripe=cancel"
                      [ngModel]="stripeCancelUrl()"
                      (ngModelChange)="stripeCancelUrl.set($event)" />
                  </label>

                  <label class="field field--wide">
                    <span>Price IDs adicionales</span>
                    <textarea
                      class="input input--area pos-focus-ring"
                      rows="3"
                      placeholder="pro=price_...&#10;business=price_..."
                      [ngModel]="stripeExtraPrices()"
                      (ngModelChange)="stripeExtraPrices.set($event)"></textarea>
                  </label>
                </div>

                <div class="stripe-actions">
                  <button
                    type="button"
                    class="primary-btn pos-focus-ring"
                    [disabled]="stripeSaving()"
                    (click)="saveStripeConfig()">
                    {{ stripeSaving() ? 'Guardando...' : 'Guardar Stripe' }}
                  </button>
                  <label class="field stripe-plan integration-panel--hidden">
                    <span>Plan a suscribir</span>
                    <input
                      type="text"
                      class="input pos-focus-ring"
                      [ngModel]="stripePlanCode()"
                      (ngModelChange)="stripePlanCode.set($event)" />
                  </label>
                  <button
                    type="button"
                    class="primary-btn primary-btn--soft pos-focus-ring integration-panel--hidden"
                    [disabled]="stripeCreating() || !stripeConfigured()"
                    (click)="createStripeSubscription()">
                    {{ stripeCreating() ? 'Creando...' : 'Crear suscripci&oacute;n' }}
                  </button>
                </div>
              </div>

              <div class="field field--wide stripe-box" [class.integration-panel--hidden]="selectedPaymentIntegration() !== 'kushki'">
                <div class="stripe-box__head">
                  <div>
                    <span>Kushki por empresa</span>
                    <small>{{ kushkiConfigLabel() }}</small>
                  </div>
                  <button
                    type="button"
                    class="mini-btn pos-focus-ring"
                    [disabled]="kushkiLoading()"
                    (click)="loadKushkiConfig()">
                    Recargar
                  </button>
                </div>

                @if (kushkiStatus()) {
                  <p class="stripe-status" [class.stripe-status--ok]="kushkiConfigured()" [class.stripe-status--warn]="!kushkiConfigured()">
                    {{ kushkiStatus() }}
                  </p>
                }

                <div class="stripe-grid">
                  <label class="toggle">
                    <span>
                      <strong>Habilitar Kushki</strong>
                      <small>Usa credenciales y planes de esta empresa.</small>
                    </span>
                    <input type="checkbox" [checked]="kushkiEnabled()" (change)="kushkiEnabled.set(!kushkiEnabled())" />
                  </label>

                  <label class="toggle">
                    <span>
                      <strong>Ambiente de pruebas</strong>
                      <small>Usa credenciales UAT/sandbox de Kushki.</small>
                    </span>
                    <input type="checkbox" [checked]="kushkiTestEnvironment()" (change)="kushkiTestEnvironment.set(!kushkiTestEnvironment())" />
                  </label>

                  <label class="field">
                    <span>Public Merchant ID</span>
                    <input
                      type="text"
                      class="input pos-focus-ring"
                      placeholder="Public Merchant ID"
                      [ngModel]="kushkiPublicMerchantId()"
                      (ngModelChange)="kushkiPublicMerchantId.set($event)" />
                  </label>

                  <label class="field">
                    <span>Private Merchant ID</span>
                    <input
                      type="password"
                      class="input pos-focus-ring"
                      autocomplete="new-password"
                      [placeholder]="kushkiPrivateConfigured() ? 'Guardado; ingrese uno nuevo para reemplazar' : 'Private Merchant ID'"
                      [ngModel]="kushkiPrivateMerchantId()"
                      (ngModelChange)="kushkiPrivateMerchantId.set($event)" />
                  </label>

                  <label class="field field--wide">
                    <span>Base URL</span>
                    <input
                      type="url"
                      class="input pos-focus-ring"
                      placeholder="https://api-uat.kushkipagos.com"
                      [ngModel]="kushkiBaseUrl()"
                      (ngModelChange)="kushkiBaseUrl.set($event)" />
                  </label>
                </div>

                <div class="plans-head integration-panel--hidden">
                  <strong>Planes avanzados</strong>
                  <button type="button" class="mini-btn pos-focus-ring" (click)="addKushkiPlan()">Agregar plan</button>
                </div>

                <div class="kushki-plans integration-panel--hidden">
                  @for (plan of kushkiPlans(); track plan.planCode; let i = $index) {
                    <div class="kushki-plan">
                      <label class="field">
                        <span>Código</span>
                        <input class="input pos-focus-ring" type="text" [ngModel]="plan.planCode" (ngModelChange)="updateKushkiPlan(i, 'planCode', $event)" />
                      </label>
                      <label class="field">
                        <span>Nombre</span>
                        <input class="input pos-focus-ring" type="text" [ngModel]="plan.planName" (ngModelChange)="updateKushkiPlan(i, 'planName', $event)" />
                      </label>
                      <label class="field">
                        <span>Periodicidad</span>
                        <select class="input pos-focus-ring" [ngModel]="plan.periodicity" (ngModelChange)="updateKushkiPlan(i, 'periodicity', $event)">
                          <option value="monthly">Mensual</option>
                          <option value="quarterly">Trimestral</option>
                          <option value="semiannual">Semestral</option>
                          <option value="annual">Anual</option>
                        </select>
                      </label>
                      <label class="field">
                        <span>Subtotal IVA</span>
                        <input class="input pos-focus-ring" type="number" min="0" step="0.01" [ngModel]="plan.subtotalIva" (ngModelChange)="updateKushkiPlan(i, 'subtotalIva', $event)" />
                      </label>
                      <label class="field">
                        <span>Subtotal IVA 0</span>
                        <input class="input pos-focus-ring" type="number" min="0" step="0.01" [ngModel]="plan.subtotalIva0" (ngModelChange)="updateKushkiPlan(i, 'subtotalIva0', $event)" />
                      </label>
                      <label class="field">
                        <span>ICE</span>
                        <input class="input pos-focus-ring" type="number" min="0" step="0.01" [ngModel]="plan.ice" (ngModelChange)="updateKushkiPlan(i, 'ice', $event)" />
                      </label>
                      <label class="field">
                        <span>IVA</span>
                        <input class="input pos-focus-ring" type="number" min="0" step="0.01" [ngModel]="plan.iva" (ngModelChange)="updateKushkiPlan(i, 'iva', $event)" />
                      </label>
                      <label class="field">
                        <span>Moneda</span>
                        <input class="input pos-focus-ring" type="text" maxlength="3" [ngModel]="plan.currency" (ngModelChange)="updateKushkiPlan(i, 'currency', $event)" />
                      </label>
                      <button type="button" class="mini-btn mini-btn--danger pos-focus-ring" (click)="removeKushkiPlan(i)">Quitar</button>
                    </div>
                  }
                </div>

                <div class="stripe-actions">
                  <button
                    type="button"
                    class="primary-btn pos-focus-ring"
                    [disabled]="kushkiSaving()"
                    (click)="saveKushkiConfig()">
                    {{ kushkiSaving() ? 'Guardando...' : 'Guardar Kushki' }}
                  </button>
                </div>
              </div>

              <div class="field field--wide stripe-box integration-panel--hidden">
                <div class="stripe-box__head">
                  <div>
                    <span>Suscripción Kushki</span>
                    <small>Tokenización segura con Hosted Fields; el POS no guarda PAN ni CVV.</small>
                  </div>
                  <button
                    type="button"
                    class="mini-btn pos-focus-ring"
                    [disabled]="kushkiTokenizing() || kushkiCreatingSubscription()"
                    (click)="initKushkiHostedFields()">
                    Inicializar tarjeta
                  </button>
                </div>

                <div class="kushki-hosted-grid">
                  <label class="field">
                    <span>Nombre en tarjeta</span>
                    <div id="kushki-cardholder-name" class="hosted-field"></div>
                  </label>
                  <label class="field">
                    <span>Número de tarjeta</span>
                    <div id="kushki-card-number" class="hosted-field"></div>
                  </label>
                  <label class="field">
                    <span>Expiración</span>
                    <div id="kushki-expiration-date" class="hosted-field"></div>
                  </label>
                  <label class="field">
                    <span>CVV</span>
                    <div id="kushki-cvv" class="hosted-field"></div>
                  </label>
                </div>

                <div class="stripe-grid">
                  <label class="field">
                    <span>Plan</span>
                    <select class="input pos-focus-ring" [ngModel]="kushkiSubscriptionPlanCode()" (ngModelChange)="kushkiSubscriptionPlanCode.set($event)">
                      @for (plan of kushkiPlans(); track plan.planCode) {
                        <option [value]="plan.planCode">{{ plan.planName || plan.planCode }}</option>
                      }
                    </select>
                  </label>
                  <label class="field">
                    <span>Inicio</span>
                    <input class="input pos-focus-ring" type="date" [ngModel]="kushkiStartDate()" (ngModelChange)="kushkiStartDate.set($event)" />
                  </label>
                  <label class="field">
                    <span>Documento</span>
                    <select class="input pos-focus-ring" [ngModel]="kushkiDocumentType()" (ngModelChange)="kushkiDocumentType.set($event)">
                      <option value="CI">CI</option>
                      <option value="RUC">RUC</option>
                      <option value="PASSPORT">Pasaporte</option>
                    </select>
                  </label>
                  <label class="field">
                    <span>Número documento</span>
                    <input class="input pos-focus-ring" type="text" [ngModel]="kushkiDocumentNumber()" (ngModelChange)="kushkiDocumentNumber.set($event)" />
                  </label>
                  <label class="field">
                    <span>Nombres</span>
                    <input class="input pos-focus-ring" type="text" [ngModel]="kushkiFirstName()" (ngModelChange)="kushkiFirstName.set($event)" />
                  </label>
                  <label class="field">
                    <span>Apellidos</span>
                    <input class="input pos-focus-ring" type="text" [ngModel]="kushkiLastName()" (ngModelChange)="kushkiLastName.set($event)" />
                  </label>
                  <label class="field">
                    <span>Email</span>
                    <input class="input pos-focus-ring" type="email" [ngModel]="kushkiEmail()" (ngModelChange)="kushkiEmail.set($event)" />
                  </label>
                  <label class="field">
                    <span>Teléfono</span>
                    <input class="input pos-focus-ring" type="tel" [ngModel]="kushkiPhone()" (ngModelChange)="kushkiPhone.set($event)" />
                  </label>
                </div>

                <div class="stripe-actions">
                  <button
                    type="button"
                    class="primary-btn primary-btn--soft pos-focus-ring"
                    [disabled]="!canCreateKushkiSubscription()"
                    (click)="createKushkiSubscription()">
                    @if (kushkiTokenizing()) {
                      Tokenizando...
                    } @else if (kushkiCreatingSubscription()) {
                      Creando suscripción...
                    } @else {
                      Crear suscripción Kushki
                    }
                  </button>
                </div>
              </div>
              <div class="field field--wide stripe-box" [class.integration-panel--hidden]="selectedPaymentIntegration() !== 'payphone'">
                <div class="stripe-box__head">
                  <div>
                    <span>PayPhone por empresa</span>
                    <small>{{ payPhoneConfigLabel() }}</small>
                  </div>
                  <button type="button" class="mini-btn pos-focus-ring" [disabled]="payPhoneLoading()" (click)="loadPayPhoneConfig()">Recargar</button>
                </div>
                @if (payPhoneStatus()) {
                  <p class="stripe-status" [class.stripe-status--ok]="payPhoneConfigured()" [class.stripe-status--warn]="!payPhoneConfigured()">{{ payPhoneStatus() }}</p>
                }
                <div class="stripe-grid">
                  <label class="toggle">
                    <span>
                      <strong>Habilitar PayPhone</strong>
                      <small>Usa token y tienda de esta empresa.</small>
                    </span>
                    <input type="checkbox" [checked]="payPhoneEnabled()" (change)="payPhoneEnabled.set(!payPhoneEnabled())" />
                  </label>
                  <label class="field">
                    <span>Token PayPhone</span>
                    <input type="password" class="input pos-focus-ring" autocomplete="new-password" [placeholder]="payPhoneTokenConfigured() ? 'Guardado; ingrese uno nuevo para reemplazar' : 'Token PayPhone'" [ngModel]="payPhoneToken()" (ngModelChange)="payPhoneToken.set($event)" />
                  </label>
                  <label class="field">
                    <span>Store ID</span>
                    <input class="input pos-focus-ring" type="text" [ngModel]="payPhoneStoreId()" (ngModelChange)="payPhoneStoreId.set($event)" />
                  </label>
                  <label class="field">
                    <span>Base URL</span>
                    <input class="input pos-focus-ring" type="url" placeholder="https://pay.payphonetodoesposible.com" [ngModel]="payPhoneBaseUrl()" (ngModelChange)="payPhoneBaseUrl.set($event)" />
                  </label>
                  <label class="field">
                    <span>Moneda</span>
                    <input class="input pos-focus-ring" type="text" maxlength="3" [ngModel]="payPhoneCurrency()" (ngModelChange)="payPhoneCurrency.set($event)" />
                  </label>
                  <label class="field">
                    <span>Zona horaria</span>
                    <input class="input pos-focus-ring" type="text" placeholder="America/Guayaquil" [ngModel]="payPhoneTimeZone()" (ngModelChange)="payPhoneTimeZone.set($event)" />
                  </label>
                  <label class="field field--wide">
                    <span>Response URL</span>
                    <input class="input pos-focus-ring" type="url" [ngModel]="payPhoneResponseUrl()" (ngModelChange)="payPhoneResponseUrl.set($event)" />
                  </label>
                </div>
                <div class="stripe-actions">
                  <button type="button" class="primary-btn pos-focus-ring" [disabled]="payPhoneSaving()" (click)="savePayPhoneConfig()">{{ payPhoneSaving() ? 'Guardando...' : 'Guardar PayPhone' }}</button>
                </div>
              </div>

              <div class="field field--wide stripe-box integration-panel--hidden">
                <div class="stripe-box__head">
                  <div>
                    <span>Cobro PayPhone</span>
                    <small>Sale API con consulta manual de estado para respetar limites.</small>
                  </div>
                  <strong class="amount-pill">{{ payPhoneAmountView() | currency: 'USD' : 'symbol-narrow' : '1.2-2' }}</strong>
                </div>
                <div class="stripe-grid">
                  <label class="field"><span>Telefono</span><input class="input pos-focus-ring" type="tel" [ngModel]="payPhonePhoneNumber()" (ngModelChange)="payPhonePhoneNumber.set($event)" /></label>
                  <label class="field"><span>Codigo pais</span><input class="input pos-focus-ring" type="text" [ngModel]="payPhoneCountryCode()" (ngModelChange)="payPhoneCountryCode.set($event)" /></label>
                  <label class="field"><span>Sin impuestos</span><input class="input pos-focus-ring" type="number" min="0" step="0.01" [ngModel]="payPhoneAmountWithoutTax()" (ngModelChange)="payPhoneAmountWithoutTax.set($event)" /></label>
                  <label class="field"><span>Con impuestos</span><input class="input pos-focus-ring" type="number" min="0" step="0.01" [ngModel]="payPhoneAmountWithTax()" (ngModelChange)="payPhoneAmountWithTax.set($event)" /></label>
                  <label class="field"><span>Tax</span><input class="input pos-focus-ring" type="number" min="0" step="0.01" [ngModel]="payPhoneTax()" (ngModelChange)="payPhoneTax.set($event)" /></label>
                  <label class="field"><span>Servicio</span><input class="input pos-focus-ring" type="number" min="0" step="0.01" [ngModel]="payPhoneService()" (ngModelChange)="payPhoneService.set($event)" /></label>
                  <label class="field"><span>Propina</span><input class="input pos-focus-ring" type="number" min="0" step="0.01" [ngModel]="payPhoneTip()" (ngModelChange)="payPhoneTip.set($event)" /></label>
                  <label class="field"><span>Referencia</span><input class="input pos-focus-ring" type="text" [ngModel]="payPhoneReference()" (ngModelChange)="payPhoneReference.set($event)" /></label>
                  <label class="field"><span>Client Transaction ID</span><input class="input pos-focus-ring" type="text" [ngModel]="payPhoneClientTransactionId()" (ngModelChange)="payPhoneClientTransactionId.set($event)" /></label>
                  <label class="field"><span>Client User ID</span><input class="input pos-focus-ring" type="text" [ngModel]="payPhoneClientUserId()" (ngModelChange)="payPhoneClientUserId.set($event)" /></label>
                  <label class="field"><span>Opcional 1</span><input class="input pos-focus-ring" type="text" [ngModel]="payPhoneOptional1()" (ngModelChange)="payPhoneOptional1.set($event)" /></label>
                  <label class="field"><span>Opcional 2</span><input class="input pos-focus-ring" type="text" [ngModel]="payPhoneOptional2()" (ngModelChange)="payPhoneOptional2.set($event)" /></label>
                  <label class="field"><span>Opcional 3</span><input class="input pos-focus-ring" type="text" [ngModel]="payPhoneOptional3()" (ngModelChange)="payPhoneOptional3.set($event)" /></label>
                </div>
                <div class="stripe-actions">
                  <button type="button" class="primary-btn primary-btn--soft pos-focus-ring" [disabled]="!canCreatePayPhoneSale()" (click)="createPayPhoneSale()">{{ payPhoneCreatingSale() ? 'Creando cobro...' : 'Crear cobro PayPhone' }}</button>
                  <button type="button" class="mini-btn pos-focus-ring" [disabled]="!canCheckPayPhoneStatus()" (click)="checkPayPhoneStatus()">{{ payPhoneCheckingStatus() ? 'Consultando...' : 'Consultar estado' }}</button>
                </div>
              </div>
                </div>
              </section>
            }
          }

          @case ('interface') {
            <div class="interface-board">
              <section class="interface-config-panel">
                <header class="interface-config-panel__head">
                  <span class="interface-config-panel__eyebrow">Experiencia del cajero</span>
                  <p>Personaliza la interfaz para mejorar la eficiencia y comodidad en el punto de venta.</p>
                </header>

                <div class="interface-field-grid">
                  <div class="rule-field-card rule-field-card--segmented">
                    <span class="rule-field-card__icon" aria-hidden="true">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                        <path d="M12 4a6 6 0 100 12 6 6 0 000-12z" stroke="currentColor" stroke-width="1.6" />
                        <path d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                      </svg>
                    </span>
                    <span class="rule-field-card__body">
                      <span class="rule-field-card__label">Tema de visualización</span>
                      <div class="interface-segmented">
                        <button
                          type="button"
                          class="interface-seg pos-focus-ring"
                          [class.interface-seg--on]="prefs.theme() === 'dark'"
                          (click)="setTheme('dark')">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                            <path d="M12 4a6 6 0 100 12 6 6 0 000-12z" stroke="currentColor" stroke-width="1.6" />
                          </svg>
                          Nocturno
                        </button>
                        <button
                          type="button"
                          class="interface-seg pos-focus-ring"
                          [class.interface-seg--on]="prefs.theme() === 'light'"
                          (click)="setTheme('light')">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                            <circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.6" />
                            <path d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                          </svg>
                          Claro
                        </button>
                      </div>
                      <small class="rule-field-card__hint">Alterna entre modo claro y nocturno para la operación.</small>
                    </span>
                  </div>

                  <div class="rule-field-card rule-field-card--segmented">
                    <span class="rule-field-card__icon" aria-hidden="true">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                        <path d="M8 6l2.5 2.5M8 6l-2.5 2.5M8 6v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                        <path d="M4 14c0-2.5 2-4.5 4.5-4.5H12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                        <circle cx="16.5" cy="14.5" r="2.5" stroke="currentColor" stroke-width="1.5" />
                      </svg>
                    </span>
                    <span class="rule-field-card__body">
                      <span class="rule-field-card__label">Ergonomía táctil</span>
                      <div class="interface-segmented">
                        <button
                          type="button"
                          class="interface-seg pos-focus-ring"
                          [class.interface-seg--on]="prefs.handedness() === 'right'"
                          (click)="onHandedness('right')">
                          Diestro
                        </button>
                        <button
                          type="button"
                          class="interface-seg pos-focus-ring"
                          [class.interface-seg--on]="prefs.handedness() === 'left'"
                          (click)="onHandedness('left')">
                          Zurdo
                        </button>
                      </div>
                      <small class="rule-field-card__hint">El ticket y las acciones principales se muestran al lado dominante del cajero.</small>
                    </span>
                  </div>

                  <label class="rule-field-card">
                    <span class="rule-field-card__icon" aria-hidden="true">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                        <rect x="5" y="5" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.5" />
                        <rect x="13" y="5" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.5" />
                        <rect x="5" y="13" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.5" />
                        <rect x="13" y="13" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.5" />
                      </svg>
                    </span>
                    <span class="rule-field-card__body">
                      <span class="rule-field-card__label">Densidad de interfaz</span>
                      <select
                        class="rule-field-card__input pos-focus-ring"
                        [ngModel]="prefs.densitySource()"
                        (ngModelChange)="onDensitySrc($event)">
                        <option value="auto">Automática</option>
                        <option value="manual">Manual</option>
                      </select>
                      <small class="rule-field-card__hint">Cantidad de elementos visuales en pantalla.</small>
                    </span>
                  </label>

                  @if (prefs.densitySource() === 'manual') {
                    <label class="rule-field-card">
                      <span class="rule-field-card__icon" aria-hidden="true">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                          <rect x="5" y="5" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.5" />
                          <rect x="13" y="5" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.5" />
                          <rect x="5" y="13" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.5" />
                          <rect x="13" y="13" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.5" />
                        </svg>
                      </span>
                      <span class="rule-field-card__body">
                        <span class="rule-field-card__label">Densidad manual</span>
                        <select
                          class="rule-field-card__input pos-focus-ring"
                          [ngModel]="prefs.densityManual()"
                          (ngModelChange)="onDensityManual($event)">
                          <option value="touch">Táctil</option>
                          <option value="comfortable">Cómoda</option>
                          <option value="compact">Compacta</option>
                        </select>
                        <small class="rule-field-card__hint">Espaciado entre elementos y componentes.</small>
                      </span>
                    </label>
                  } @else {
                    <label class="rule-field-card">
                      <span class="rule-field-card__icon" aria-hidden="true">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                          <circle cx="12" cy="8" r="3.5" stroke="currentColor" stroke-width="1.6" />
                          <path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6" stroke="currentColor" stroke-width="1.6" />
                        </svg>
                      </span>
                      <span class="rule-field-card__body">
                        <span class="rule-field-card__label">Perfil automático</span>
                        <select
                          class="rule-field-card__input pos-focus-ring"
                          [ngModel]="prefs.roleProfile()"
                          (ngModelChange)="onRole($event)">
                          <option value="auto">Auto desde JWT</option>
                          <option value="cajero">Cajero táctil</option>
                          <option value="mostrador">Mostrador estándar</option>
                          <option value="supervisor">Supervisor compacto</option>
                        </select>
                        <small class="rule-field-card__hint">Perfil sugerido según el rol del usuario.</small>
                      </span>
                    </label>
                  }

                  <div class="rule-field-card rule-field-card--toggle">
                    <span class="rule-field-card__icon" aria-hidden="true">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                        <rect x="4" y="6" width="16" height="12" rx="2" stroke="currentColor" stroke-width="1.6" />
                        <circle cx="9" cy="11" r="1.8" stroke="currentColor" stroke-width="1.4" />
                        <path d="M4 15l4-3 3 2 5-4 4 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
                      </svg>
                    </span>
                    <span class="rule-field-card__body">
                      <span class="rule-field-card__label-row">
                        <span class="rule-field-card__label">Miniatura en productos</span>
                        <label class="station-switch">
                          <input
                            type="checkbox"
                            [checked]="prefs.showProductImages()"
                            (change)="prefs.setShowProductImages(!prefs.showProductImages())" />
                          <span class="station-switch__ui" aria-hidden="true"></span>
                        </label>
                      </span>
                      <small class="rule-field-card__hint">Muestra miniaturas en pantallas táctiles y catálogos visuales.</small>
                    </span>
                  </div>
                </div>
              </section>
            </div>
          }

          @case ('about') {
            <div class="about-board">
              <div class="info-grid info-grid--stats">
                <div class="info-stat">
                  <span class="info-stat__icon info-stat__icon--purple" aria-hidden="true">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                      <rect x="3" y="5" width="18" height="12" rx="2" stroke="currentColor" stroke-width="1.6" />
                      <path d="M8 19h8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
                    </svg>
                  </span>
                  <div class="info-stat__body">
                    <span class="info-stat__label">Versión POS UI</span>
                    <div class="info-stat__row">
                      <strong>{{ appVersion }}</strong>
                      <span class="info-stat__badge info-stat__badge--info">Actual</span>
                    </div>
                    <small>Interfaz de usuario</small>
                  </div>
                </div>
                <div class="info-stat">
                  <span class="info-stat__icon info-stat__icon--blue" aria-hidden="true">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                      <path d="M7 8a5 5 0 0110 0v2h1a2 2 0 012 2v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5a2 2 0 012-2h1V8z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
                    </svg>
                  </span>
                  <div class="info-stat__body">
                    <span class="info-stat__label">API POS</span>
                    <div class="info-stat__row">
                      <strong>{{ apiVersionLabel() }}</strong>
                      <span class="info-stat__badge info-stat__badge--ok">{{ apiConnectedLabel() }}</span>
                    </div>
                    <small>{{ auth.apiBaseUrl || 'No configurada' }}</small>
                  </div>
                </div>
                <div class="info-stat">
                  <span class="info-stat__icon info-stat__icon--teal" aria-hidden="true">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                      <ellipse cx="12" cy="6" rx="7" ry="3" stroke="currentColor" stroke-width="1.6" />
                      <path d="M5 6v5c0 1.7 3.1 3 7 3s7-1.3 7-3V6" stroke="currentColor" stroke-width="1.6" />
                      <path d="M5 11v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5" stroke="currentColor" stroke-width="1.6" />
                    </svg>
                  </span>
                  <div class="info-stat__body">
                    <span class="info-stat__label">Modelo recomendado</span>
                    <div class="info-stat__row">
                      <strong>Reglas globales</strong>
                    </div>
                    <small>Backend y estación en navegador</small>
                  </div>
                </div>
                <div class="info-stat">
                  <span class="info-stat__icon info-stat__icon--green" aria-hidden="true">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                      <path d="M12 3l7 3v6c0 4.2-2.8 7.4-7 9-4.2-1.6-7-4.8-7-9V6l7-3z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
                      <path d="M9.5 12.5l2 2 4-4.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
                    </svg>
                  </span>
                  <div class="info-stat__body">
                    <span class="info-stat__label">Estado del sistema</span>
                    <div class="info-stat__row">
                      <strong class="info-stat__ok">{{ systemHealthLabel() }}</strong>
                    </div>
                    <small>Todos los servicios operativos</small>
                  </div>
                </div>
              </div>

              <div class="system-details">
                <h2 class="system-details__title">Detalles del sistema</h2>
                <div class="system-details__grid">
                  <div class="system-details__item">
                    <span class="system-details__ico" aria-hidden="true">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M10 14H6M14 10V6M14 18.5V14M18.5 14H14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="1.6"/></svg>
                    </span>
                    <div>
                      <span class="system-details__label">eFactura UI</span>
                      <strong>{{ efacturaUiOrigin }}</strong>
                    </div>
                  </div>
                  <div class="system-details__item">
                    <span class="system-details__ico" aria-hidden="true">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.6"/><path d="M12 8v4l2.5 2.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
                    </span>
                    <div>
                      <span class="system-details__label">Último reinicio</span>
                      <strong>{{ lastRestartLabel() }}</strong>
                    </div>
                  </div>
                  <div class="system-details__item">
                    <span class="system-details__ico" aria-hidden="true">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><ellipse cx="12" cy="6" rx="7" ry="3" stroke="currentColor" stroke-width="1.6"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6" stroke="currentColor" stroke-width="1.6"/></svg>
                    </span>
                    <div>
                      <span class="system-details__label">Base de datos</span>
                      <strong>PostgreSQL 15</strong>
                    </div>
                  </div>
                  <div class="system-details__item">
                    <span class="system-details__ico" aria-hidden="true">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="4" y="5" width="16" height="14" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M4 9h16M8 13h3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
                    </span>
                    <div>
                      <span class="system-details__label">Servidor</span>
                      <strong>POS-SERVER-01</strong>
                    </div>
                  </div>
                  <div class="system-details__item">
                    <span class="system-details__ico" aria-hidden="true">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M8 6h8M8 10h8M8 14h5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><rect x="4" y="4" width="16" height="16" rx="2" stroke="currentColor" stroke-width="1.6"/></svg>
                    </span>
                    <div>
                      <span class="system-details__label">Entorno</span>
                      <strong>{{ deploymentEnvLabel() }}</strong>
                    </div>
                  </div>
                  <div class="system-details__item">
                    <span class="system-details__ico" aria-hidden="true">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.6"/><path d="M2 12h20M12 4a12 12 0 010 16M12 4a12 12 0 000 16" stroke="currentColor" stroke-width="1.6"/></svg>
                    </span>
                    <div>
                      <span class="system-details__label">Zona horaria</span>
                      <strong>America/Guayaquil (UTC-5)</strong>
                    </div>
                  </div>
                </div>
              </div>

              <div class="learned-panel">
                <div class="learned-panel__content">
                  <h2 class="learned-panel__title">
                    <span class="learned-panel__title-ico" aria-hidden="true">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.6" />
                        <path d="M12 11v5M12 8h.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
                      </svg>
                    </span>
                    Ventajas tomadas como referencia
                  </h2>
                  <ul class="learned-panel__list">
                    <li>
                      <span class="learned-panel__check" aria-hidden="true">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                          <path d="M8 12.5l2.5 2.5L16 9" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
                        </svg>
                      </span>
                      <span>Permisos por rol para descuentos, configuración e impresión.</span>
                    </li>
                    <li>
                      <span class="learned-panel__check" aria-hidden="true">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                          <path d="M8 12.5l2.5 2.5L16 9" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
                        </svg>
                      </span>
                      <span>Impresoras por estación: recibo, etiquetas y cajón de dinero.</span>
                    </li>
                    <li>
                      <span class="learned-panel__check" aria-hidden="true">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                          <path d="M8 12.5l2.5 2.5L16 9" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
                        </svg>
                      </span>
                      <span>Recibos automáticos u opcionales después del pago.</span>
                    </li>
                    <li>
                      <span class="learned-panel__check" aria-hidden="true">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                          <path d="M8 12.5l2.5 2.5L16 9" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
                        </svg>
                      </span>
                      <span>Plantillas de etiquetas y formatos de ticket configurables.</span>
                    </li>
                    <li>
                      <span class="learned-panel__check" aria-hidden="true">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                          <path d="M8 12.5l2.5 2.5L16 9" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
                        </svg>
                      </span>
                      <span>Densidad táctil/compacta según operación y perfil.</span>
                    </li>
                  </ul>
                </div>
                <div class="learned-panel__art">
                  <img
                    class="learned-panel__img"
                    src="assets/iconos/configuracion01.png"
                    alt=""
                    loading="lazy"
                    decoding="async" />
                </div>
              </div>
            </div>
          }
        }

        <footer
          class="settings-footer"
          [class.settings-footer--station]="activeTab() === 'station'"
          [class.settings-footer--payments]="activeTab() === 'payments'"
          [class.settings-footer--rules]="activeTab() === 'business'"
          [class.settings-footer--printing]="activeTab() === 'printing'"
          [class.settings-footer--interface]="activeTab() === 'interface'"
          [class.settings-footer--about]="activeTab() === 'about'">
          @if (settingsSaveMsg()) {
            <p class="settings-footer__msg" role="status">{{ settingsSaveMsg() }}</p>
          }
          <button type="button" class="settings-footer__reset pos-focus-ring" (click)="restablecerConfiguracion()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M4 12a8 8 0 0113.8-5.6M20 4v5h-5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
              <path d="M20 12a8 8 0 01-13.8 5.6M4 20v-5h5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            <span>
              <strong>Restablecer configuración</strong>
              @if (activeTab() === 'station' || activeTab() === 'payments' || activeTab() === 'business' || activeTab() === 'printing' || activeTab() === 'interface' || activeTab() === 'about') {
                <small>Se perderán los cambios no guardados</small>
              }
            </span>
          </button>
          @if (activeTab() === 'station' && stationDirty()) {
            <p class="settings-footer__pending" role="status">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M4 12a8 8 0 0113.8-5.6M20 4v5h-5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
                <path d="M20 12a8 8 0 01-13.8 5.6M4 20v-5h5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
              <span>
                <strong>Tienes cambios sin guardar</strong>
                <small>Recuerda guardar para aplicar tu configuración.</small>
              </span>
            </p>
          }
          <button
            type="button"
            class="settings-footer__save pos-focus-ring"
            [class.settings-footer__save--rich]="activeTab() === 'station' || activeTab() === 'payments' || activeTab() === 'business' || activeTab() === 'printing' || activeTab() === 'interface' || activeTab() === 'about'"
            (click)="guardarCambios()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M5 20h14a1 1 0 001-1V8l-4-4H5a1 1 0 00-1 1v14a1 1 0 001 1z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
              <path d="M9 4v5h6V4M9 14h6v6H9v-6z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
            </svg>
            @if (activeTab() === 'station' || activeTab() === 'payments' || activeTab() === 'business' || activeTab() === 'printing' || activeTab() === 'interface' || activeTab() === 'about') {
              <span class="settings-footer__save-copy">
                <strong>Guardar cambios</strong>
                <small>Aplicar configuración actual</small>
              </span>
            } @else {
              Guardar cambios
            }
          </button>
        </footer>
      </section>
    </div>
  `,
  styles: `
    :host {
      flex: 1;
      min-height: 0;
      height: 100%;
      display: flex;
      overflow: hidden;
    }
    .settings {
      width: 100%;
      flex: 1;
      min-height: 0;
      height: 100%;
      overflow: hidden;
      display: grid;
      grid-template-columns: minmax(14.5rem, 17.5rem) minmax(0, 1fr);
      grid-template-rows: minmax(0, 1fr);
      align-items: stretch;
      gap: 1rem;
    }
    .settings-nav {
      display: flex;
      flex-direction: column;
      gap: 0.45rem;
      padding: 0.7rem;
      border: 1px solid var(--pos-border);
      border-radius: var(--pos-radius);
      background: linear-gradient(180deg, var(--pos-elevated), var(--pos-surface));
      box-shadow: var(--pos-shadow-soft);
      min-height: 0;
      height: 100%;
      max-height: 100%;
      overflow: hidden;
    }
    .settings-nav__head {
      display: grid;
      grid-template-columns: 2rem minmax(0, 1fr);
      gap: 0.55rem;
      align-items: center;
      padding: 0.35rem 0.4rem 0.65rem;
      margin-bottom: 0.25rem;
      border-bottom: 1px solid var(--pos-border);
    }
    .settings-nav__mark {
      display: grid;
      place-items: center;
      width: 2rem;
      height: 2rem;
      border-radius: var(--pos-radius-sm);
      color: var(--pos-accent-hover);
      background: var(--pos-accent-muted);
      border: 1px solid color-mix(in srgb, var(--pos-accent) 32%, var(--pos-border));
    }
    .settings-nav__head strong {
      display: block;
      font-size: 0.82rem;
      font-weight: 850;
      color: var(--pos-text);
    }
    .settings-nav__head small {
      display: block;
      font-size: 0.66rem;
      color: var(--pos-faint);
    }
    .settings-nav__item {
      display: grid;
      grid-template-columns: 2rem minmax(0, 1fr);
      gap: 0.55rem;
      align-items: center;
      width: 100%;
      padding: 0.64rem 0.65rem;
      border-radius: var(--pos-radius-sm);
      border: 1px solid transparent;
      background: transparent;
      color: var(--pos-muted);
      text-align: left;
      cursor: pointer;
      transition:
        background var(--pos-transition),
        border-color var(--pos-transition),
        transform 0.12s ease;
    }
    .settings-nav__item:hover {
      transform: translateX(1px);
      border-color: var(--pos-border);
      background: var(--pos-surface-2);
    }
    .settings-nav__item--on {
      color: var(--pos-accent-hover);
      border-color: color-mix(in srgb, var(--pos-accent) 32%, var(--pos-border));
      background: var(--pos-accent-muted);
      box-shadow: inset 3px 0 0 var(--pos-accent);
    }
    .settings-nav__ico {
      display: grid;
      place-items: center;
      width: 2rem;
      height: 2rem;
      border-radius: var(--pos-radius-sm);
      color: var(--pos-muted);
      background: var(--pos-surface-2);
      border: 1px solid var(--pos-border);
    }
    .settings-nav__item--on .settings-nav__ico {
      color: var(--pos-accent-hover);
      background: var(--pos-elevated);
      border-color: color-mix(in srgb, var(--pos-accent) 32%, var(--pos-border));
    }
    .settings-nav strong {
      display: block;
      color: var(--pos-text);
      font-size: 0.78rem;
    }
    .settings-nav small {
      display: block;
      margin-top: 0.08rem;
      font-size: 0.64rem;
      line-height: 1.25;
      color: var(--pos-faint);
    }
    .settings-panel {
      min-width: 0;
      min-height: 0;
      height: 100%;
      max-height: 100%;
      overflow-y: auto;
      overflow-x: hidden;
      padding: 0.05rem 0.1rem 1.1rem;
      overscroll-behavior: contain;
      scrollbar-gutter: stable;
    }
    .settings-hero {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 1rem;
      margin-bottom: 0.9rem;
      padding: 1rem 1.1rem;
      border: 1px solid var(--pos-border);
      border-radius: var(--pos-radius);
      background: linear-gradient(135deg, var(--pos-elevated), var(--pos-surface-2));
      box-shadow: var(--pos-shadow-soft);
    }
    .settings-hero h1 {
      margin: 0;
      font-size: 1.24rem;
      font-weight: 900;
      line-height: 1.15;
    }
    .settings-hero p {
      margin: 0.35rem 0 0;
      max-width: 52rem;
      color: var(--pos-muted);
      font-size: 0.82rem;
      line-height: 1.45;
    }
    .settings-hero__badge {
      flex-shrink: 0;
      padding: 0.28rem 0.55rem;
      border-radius: 999px;
      border: 1px solid color-mix(in srgb, var(--pos-accent) 34%, var(--pos-border));
      background: var(--pos-accent-muted);
      color: var(--pos-accent-hover);
      font-size: 0.66rem;
      font-weight: 850;
      white-space: nowrap;
    }
    .station-hero {
      position: relative;
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 1.25rem;
      margin-bottom: 0.9rem;
      padding: 1.2rem 1.15rem 0.65rem;
      border: 1px solid var(--pos-border);
      border-radius: 5px;
      background: linear-gradient(135deg, var(--pos-elevated), var(--pos-surface-2));
      box-shadow: var(--pos-shadow-soft);
      overflow: hidden;
      min-height: 9.25rem;
    }
    .station-hero__copy {
      flex: 1;
      min-width: 0;
      align-self: flex-start;
      padding-bottom: 0.55rem;
    }
    .station-hero .eyebrow {
      margin-bottom: 0.35rem;
    }
    .station-hero h1 {
      margin: 0.2rem 0 0;
      font-size: 1.38rem;
      font-weight: 900;
      line-height: 1.28;
      letter-spacing: -0.015em;
    }
    .station-hero p {
      margin: 0.55rem 0 0;
      max-width: 34rem;
      color: var(--pos-muted);
      font-size: 0.84rem;
      line-height: 1.55;
    }
    .station-hero__status {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin-top: 0.95rem;
    }
    .station-pill {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.28rem 0.55rem;
      border-radius: 999px;
      border: 1px solid var(--pos-border);
      background: var(--pos-elevated);
      color: var(--pos-muted);
      font-size: 0.68rem;
      font-weight: 750;
      white-space: nowrap;
    }
    .station-pill--ok {
      border-color: color-mix(in srgb, #22c55e 35%, var(--pos-border));
      background: color-mix(in srgb, #22c55e 10%, var(--pos-elevated));
      color: #15803d;
    }
    .station-pill--warn {
      border-color: color-mix(in srgb, #f59e0b 35%, var(--pos-border));
      background: color-mix(in srgb, #f59e0b 10%, var(--pos-elevated));
      color: #b45309;
    }
    .station-pill--muted {
      color: var(--pos-muted);
    }
    .station-hero__art {
      flex: 0 0 min(46%, 20rem);
      display: flex;
      align-items: flex-end;
      justify-content: flex-end;
      margin-right: -0.35rem;
      margin-bottom: -1.65rem;
      pointer-events: none;
    }
    .station-hero__img {
      display: block;
      width: 118%;
      max-width: 21rem;
      height: auto;
      object-fit: contain;
      object-position: right bottom;
    }
    .payments-hero {
      position: relative;
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 1.25rem;
      margin-bottom: 0.9rem;
      padding: 1.2rem 1.15rem 0.65rem;
      border: 1px solid var(--pos-border);
      border-radius: 5px;
      background: linear-gradient(135deg, var(--pos-elevated), var(--pos-surface-2));
      box-shadow: var(--pos-shadow-soft);
      overflow: hidden;
      min-height: 9.25rem;
    }
    .payments-hero__copy {
      flex: 1;
      min-width: 0;
      align-self: flex-start;
      padding-bottom: 0.55rem;
    }
    .payments-hero .eyebrow {
      margin-bottom: 0.35rem;
    }
    .payments-hero h1 {
      margin: 0.2rem 0 0;
      font-size: 1.38rem;
      font-weight: 900;
      line-height: 1.28;
      letter-spacing: -0.015em;
    }
    .payments-hero p {
      margin: 0.55rem 0 0;
      max-width: 34rem;
      color: var(--pos-muted);
      font-size: 0.84rem;
      line-height: 1.55;
    }
    .payments-hero__stats {
      display: flex;
      flex-wrap: wrap;
      gap: 0.65rem;
      margin-top: 0.9rem;
    }
    .payments-stat {
      display: inline-flex;
      align-items: center;
      gap: 0.7rem;
      min-width: 11.5rem;
      padding: 0.58rem 0.82rem;
      border: 1px solid color-mix(in srgb, var(--pos-border) 88%, transparent);
      border-radius: 5px;
      background: var(--pos-elevated);
      box-shadow: 0 10px 24px -20px rgba(17, 24, 39, 0.24);
    }
    .payments-stat__icon {
      display: grid;
      place-items: center;
      flex: 0 0 2.45rem;
      width: 2.45rem;
      height: 2.45rem;
      border-radius: 5px;
      box-shadow: 0 8px 18px -14px rgba(17, 24, 39, 0.35);
    }
    .payments-stat__icon--purple {
      color: #fff;
      background: linear-gradient(145deg, #8b5cf6, #6366f1);
    }
    .payments-stat__icon--blue {
      color: #fff;
      background: linear-gradient(145deg, #60a5fa, #2563eb);
    }
    .payments-stat__icon--teal {
      color: #fff;
      background: linear-gradient(145deg, #2dd4bf, #0d9488);
    }
    .payments-stat__body {
      display: grid;
      gap: 0.08rem;
      min-width: 0;
    }
    .payments-stat__value {
      font-size: 1.28rem;
      font-weight: 900;
      color: var(--pos-text);
      line-height: 1;
      letter-spacing: -0.02em;
    }
    .payments-stat__label {
      font-size: 0.7rem;
      font-weight: 650;
      color: var(--pos-muted);
      line-height: 1.2;
      white-space: nowrap;
    }
    .payments-hero__badge {
      position: absolute;
      top: 0.75rem;
      right: 0.75rem;
      z-index: 1;
      padding: 0.24rem 0.55rem;
      border-radius: 999px;
      border: 1px solid color-mix(in srgb, #22c55e 34%, var(--pos-border));
      background: color-mix(in srgb, #22c55e 10%, var(--pos-elevated));
      color: #15803d;
      font-size: 0.64rem;
      font-weight: 850;
    }
    .payments-hero__art {
      flex: 0 0 min(46%, 20rem);
      display: flex;
      align-items: flex-end;
      justify-content: flex-end;
      margin-right: -0.35rem;
      margin-bottom: -1.65rem;
      pointer-events: none;
    }
    .payments-hero__img {
      display: block;
      width: 118%;
      max-width: 21rem;
      height: auto;
      object-fit: contain;
      object-position: right bottom;
    }
    .printing-hero {
      position: relative;
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 1.25rem;
      margin-bottom: 0.9rem;
      padding: 1.2rem 1.15rem 0.65rem;
      border: 1px solid var(--pos-border);
      border-radius: 5px;
      background: linear-gradient(135deg, var(--pos-elevated), var(--pos-surface-2));
      box-shadow: var(--pos-shadow-soft);
      overflow: hidden;
      min-height: 9.25rem;
    }
    .printing-hero__copy {
      flex: 1;
      min-width: 0;
      align-self: flex-start;
      padding-bottom: 0.55rem;
    }
    .printing-hero .eyebrow {
      margin-bottom: 0.35rem;
    }
    .printing-hero h1 {
      margin: 0.2rem 0 0;
      font-size: 1.38rem;
      font-weight: 900;
      line-height: 1.28;
      letter-spacing: -0.015em;
    }
    .printing-hero p {
      margin: 0.55rem 0 0;
      max-width: 34rem;
      color: var(--pos-muted);
      font-size: 0.84rem;
      line-height: 1.55;
    }
    .printing-hero__stats {
      display: flex;
      flex-wrap: wrap;
      gap: 0.65rem;
      margin-top: 0.9rem;
    }
    .printing-stat {
      display: inline-flex;
      align-items: center;
      gap: 0.7rem;
      min-width: 11.5rem;
      padding: 0.58rem 0.82rem;
      border: 1px solid color-mix(in srgb, var(--pos-border) 88%, transparent);
      border-radius: 5px;
      background: var(--pos-elevated);
      box-shadow: 0 10px 24px -20px rgba(17, 24, 39, 0.24);
    }
    .printing-stat__icon {
      display: grid;
      place-items: center;
      flex: 0 0 2.45rem;
      width: 2.45rem;
      height: 2.45rem;
      border-radius: 5px;
      box-shadow: 0 8px 18px -14px rgba(17, 24, 39, 0.35);
    }
    .printing-stat__icon--purple {
      color: #fff;
      background: linear-gradient(145deg, #8b5cf6, #6366f1);
    }
    .printing-stat__icon--blue {
      color: #fff;
      background: linear-gradient(145deg, #60a5fa, #2563eb);
    }
    .printing-stat__icon--teal {
      color: #fff;
      background: linear-gradient(145deg, #2dd4bf, #0891b2);
    }
    .printing-stat__body {
      display: grid;
      gap: 0.08rem;
      min-width: 0;
    }
    .printing-stat__value {
      font-size: 1.05rem;
      font-weight: 900;
      color: var(--pos-text);
      line-height: 1.1;
      letter-spacing: -0.02em;
    }
    .printing-stat__label {
      font-size: 0.66rem;
      font-weight: 650;
      color: var(--pos-muted);
      line-height: 1.2;
      white-space: nowrap;
    }
    .printing-hero__badge {
      position: absolute;
      top: 0.75rem;
      right: 0.75rem;
      z-index: 1;
      display: inline-flex;
      align-items: center;
      gap: 0.32rem;
      padding: 0.24rem 0.55rem;
      border-radius: 999px;
      border: 1px solid color-mix(in srgb, var(--pos-accent) 34%, var(--pos-border));
      background: var(--pos-elevated);
      color: var(--pos-accent-hover);
      font-size: 0.64rem;
      font-weight: 850;
    }
    .printing-hero__art {
      flex: 0 0 min(46%, 20rem);
      display: flex;
      align-items: flex-end;
      justify-content: flex-end;
      margin-right: -0.35rem;
      margin-bottom: -1.65rem;
      pointer-events: none;
    }
    .printing-hero__img {
      display: block;
      width: 118%;
      max-width: 21rem;
      height: auto;
      object-fit: contain;
      object-position: right bottom;
    }
    .printing-config-panel {
      padding: 0.95rem 1rem 1rem;
      border: 1px solid var(--pos-border);
      border-radius: 5px;
      background: var(--pos-elevated);
      box-shadow: 0 10px 28px -24px rgba(17, 24, 39, 0.24);
    }
    .printing-config-panel__head {
      margin-bottom: 0.85rem;
    }
    .printing-config-panel__head h2 {
      margin: 0;
      font-size: 0.95rem;
      font-weight: 900;
      color: var(--pos-text);
    }
    .printing-config-panel__head p {
      margin: 0.28rem 0 0;
      color: var(--pos-muted);
      font-size: 0.76rem;
      line-height: 1.4;
    }
    .printing-field-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.65rem;
      align-content: start;
    }
    .rule-field-card--toggle {
      cursor: default;
    }
    .rule-field-card__label-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.65rem;
      min-width: 0;
    }
    .rule-field-card__label-row .rule-field-card__label {
      flex: 1;
      min-width: 0;
    }
    .printing-smart-card {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      min-height: 100%;
      padding: 0.72rem 0.78rem;
      border: 1px solid color-mix(in srgb, var(--pos-accent) 18%, var(--pos-border));
      border-radius: 5px;
      background: linear-gradient(
        135deg,
        color-mix(in srgb, var(--pos-accent) 8%, var(--pos-elevated)) 0%,
        var(--pos-elevated) 72%
      );
      box-shadow: 0 8px 22px -20px rgba(17, 24, 39, 0.22);
    }
    .printing-smart-card__copy {
      display: flex;
      align-items: flex-start;
      gap: 0.6rem;
      min-width: 0;
      flex: 1;
    }
    .printing-smart-card__icon {
      display: grid;
      place-items: center;
      flex: 0 0 2.35rem;
      width: 2.35rem;
      height: 2.35rem;
      border-radius: 5px;
      color: var(--pos-accent-hover);
      background: color-mix(in srgb, var(--pos-accent) 11%, var(--pos-surface));
      border: 1px solid color-mix(in srgb, var(--pos-accent) 16%, var(--pos-border));
    }
    .printing-smart-card__texts {
      display: grid;
      gap: 0.2rem;
      min-width: 0;
    }
    .printing-smart-card__texts strong {
      font-size: 0.74rem;
      font-weight: 850;
      color: var(--pos-text);
      line-height: 1.25;
    }
    .printing-smart-card__texts small {
      color: var(--pos-muted);
      font-size: 0.64rem;
      line-height: 1.38;
    }
    .printing-smart-card__orb {
      position: relative;
      display: grid;
      place-items: center;
      flex: 0 0 3.6rem;
      width: 3.6rem;
      height: 3.6rem;
      color: var(--pos-accent-hover);
    }
    .printing-smart-card__orb-glow {
      position: absolute;
      inset: 0;
      border-radius: 50%;
      background: radial-gradient(
        circle,
        color-mix(in srgb, var(--pos-accent) 28%, transparent) 0%,
        transparent 72%
      );
    }
    .printing-smart-card__orb svg {
      position: relative;
      z-index: 1;
    }
    .interface-hero {
      position: relative;
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 1.25rem;
      margin-bottom: 0.9rem;
      padding: 1.2rem 1.15rem 0.65rem;
      border: 1px solid var(--pos-border);
      border-radius: 5px;
      background: linear-gradient(135deg, var(--pos-elevated), var(--pos-surface-2));
      box-shadow: var(--pos-shadow-soft);
      overflow: hidden;
      min-height: 9.25rem;
    }
    .interface-hero__copy {
      flex: 1;
      min-width: 0;
      align-self: flex-start;
      padding-bottom: 0.55rem;
    }
    .interface-hero .eyebrow {
      margin-bottom: 0.35rem;
    }
    .interface-hero h1 {
      margin: 0.2rem 0 0;
      font-size: 1.38rem;
      font-weight: 900;
      line-height: 1.28;
      letter-spacing: -0.015em;
    }
    .interface-hero p {
      margin: 0.55rem 0 0;
      max-width: 34rem;
      color: var(--pos-muted);
      font-size: 0.84rem;
      line-height: 1.55;
    }
    .interface-hero__stats {
      display: flex;
      flex-wrap: wrap;
      gap: 0.65rem;
      margin-top: 0.9rem;
    }
    .interface-stat {
      display: inline-flex;
      align-items: center;
      gap: 0.7rem;
      min-width: 11.5rem;
      padding: 0.58rem 0.82rem;
      border: 1px solid color-mix(in srgb, var(--pos-border) 88%, transparent);
      border-radius: 5px;
      background: var(--pos-elevated);
      box-shadow: 0 10px 24px -20px rgba(17, 24, 39, 0.24);
    }
    .interface-stat__icon {
      display: grid;
      place-items: center;
      flex: 0 0 2.45rem;
      width: 2.45rem;
      height: 2.45rem;
      border-radius: 5px;
      box-shadow: 0 8px 18px -14px rgba(17, 24, 39, 0.35);
    }
    .interface-stat__icon--purple {
      color: #fff;
      background: linear-gradient(145deg, #8b5cf6, #6366f1);
    }
    .interface-stat__icon--blue {
      color: #fff;
      background: linear-gradient(145deg, #60a5fa, #2563eb);
    }
    .interface-stat__icon--teal {
      color: #fff;
      background: linear-gradient(145deg, #2dd4bf, #0891b2);
    }
    .interface-stat__body {
      display: grid;
      gap: 0.08rem;
      min-width: 0;
    }
    .interface-stat__value {
      font-size: 1.05rem;
      font-weight: 900;
      color: var(--pos-text);
      line-height: 1.1;
      letter-spacing: -0.02em;
    }
    .interface-stat__label {
      font-size: 0.66rem;
      font-weight: 650;
      color: var(--pos-muted);
      line-height: 1.2;
      white-space: nowrap;
    }
    .interface-hero__badge {
      position: absolute;
      top: 0.75rem;
      right: 0.75rem;
      z-index: 1;
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      padding: 0.24rem 0.55rem;
      border-radius: 999px;
      border: 1px solid color-mix(in srgb, var(--pos-accent) 34%, var(--pos-border));
      background: var(--pos-elevated);
      color: var(--pos-accent-hover);
      font-size: 0.64rem;
      font-weight: 850;
    }
    .interface-hero__art {
      flex: 0 0 min(46%, 20rem);
      display: flex;
      align-items: flex-end;
      justify-content: flex-end;
      margin-right: -0.35rem;
      margin-bottom: -1.65rem;
      pointer-events: none;
    }
    .interface-hero__img {
      display: block;
      width: 118%;
      max-width: 21rem;
      height: auto;
      object-fit: contain;
      object-position: right bottom;
    }
    .interface-config-panel {
      padding: 0.95rem 1rem 1rem;
      border: 1px solid var(--pos-border);
      border-radius: 5px;
      background: var(--pos-elevated);
      box-shadow: 0 10px 28px -24px rgba(17, 24, 39, 0.24);
    }
    .interface-config-panel__head {
      margin-bottom: 0.85rem;
    }
    .interface-config-panel__eyebrow {
      display: block;
      margin: 0;
      color: var(--pos-accent-hover);
      font-size: 0.68rem;
      font-weight: 900;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      line-height: 1.2;
    }
    .interface-config-panel__head p {
      margin: 0.28rem 0 0;
      color: var(--pos-muted);
      font-size: 0.76rem;
      line-height: 1.4;
    }
    .interface-field-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.65rem;
      align-content: start;
    }
    .rule-field-card--segmented {
      cursor: default;
    }
    .interface-segmented {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.4rem;
    }
    .interface-seg {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.35rem;
      min-height: 2.15rem;
      padding: 0.42rem 0.55rem;
      border: 1px solid color-mix(in srgb, var(--pos-accent) 12%, var(--pos-border));
      border-radius: 5px;
      background: color-mix(in srgb, var(--pos-accent) 6%, var(--pos-bg));
      color: var(--pos-muted);
      font-size: 0.76rem;
      font-weight: 750;
      cursor: pointer;
      transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
    }
    .interface-seg--on {
      border-color: color-mix(in srgb, var(--pos-accent) 45%, var(--pos-border));
      color: var(--pos-accent-hover);
      background: color-mix(in srgb, var(--pos-accent) 14%, var(--pos-elevated));
      box-shadow: 0 0 0 1px color-mix(in srgb, var(--pos-accent) 10%, transparent);
    }
    .about-hero {
      position: relative;
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 1.25rem;
      margin-bottom: 0.9rem;
      padding: 1.2rem 1.15rem 0.65rem;
      border: 1px solid var(--pos-border);
      border-radius: 5px;
      background: linear-gradient(135deg, var(--pos-elevated), var(--pos-surface-2));
      box-shadow: var(--pos-shadow-soft);
      overflow: hidden;
      min-height: 8.5rem;
    }
    .about-hero__copy {
      flex: 1;
      min-width: 0;
      align-self: flex-start;
      padding-bottom: 0.55rem;
    }
    .about-hero .eyebrow {
      margin-bottom: 0.35rem;
    }
    .about-hero h1 {
      margin: 0.2rem 0 0;
      font-size: 1.38rem;
      font-weight: 900;
      line-height: 1.28;
      letter-spacing: -0.015em;
    }
    .about-hero p {
      margin: 0.55rem 0 0;
      max-width: 34rem;
      color: var(--pos-muted);
      font-size: 0.84rem;
      line-height: 1.55;
    }
    .about-hero__badge {
      position: absolute;
      top: 0.75rem;
      right: 0.75rem;
      z-index: 1;
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      padding: 0.24rem 0.55rem;
      border-radius: 999px;
      border: 1px solid color-mix(in srgb, var(--pos-accent) 34%, var(--pos-border));
      background: var(--pos-elevated);
      color: var(--pos-accent-hover);
      font-size: 0.64rem;
      font-weight: 850;
    }
    .about-hero__art {
      flex: 0 0 min(46%, 20rem);
      display: flex;
      align-items: flex-end;
      justify-content: flex-end;
      margin-right: -0.35rem;
      margin-bottom: -1.65rem;
      pointer-events: none;
    }
    .about-hero__img {
      display: block;
      width: 118%;
      max-width: 21rem;
      height: auto;
      object-fit: contain;
      object-position: right bottom;
    }
    .about-board {
      display: grid;
      gap: 0.85rem;
    }
    .payments-board__head {
      margin-bottom: 0.75rem;
    }
    .payments-board__head h2 {
      margin: 0;
      font-size: 0.95rem;
      font-weight: 900;
      color: var(--pos-text);
    }
    .payments-board__head p {
      margin: 0.28rem 0 0;
      color: var(--pos-muted);
      font-size: 0.76rem;
      line-height: 1.4;
    }
    .payments-catalog {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 0.65rem;
      margin-bottom: 0.75rem;
    }
    .payment-provider-card {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
      min-height: 11.5rem;
      padding: 0.72rem 0.75rem 0.68rem;
      border: 1px solid var(--pos-border);
      border-radius: 5px;
      background: var(--pos-elevated);
      color: var(--pos-text);
      text-align: left;
      cursor: pointer;
      box-shadow: 0 8px 22px -20px rgba(17, 24, 39, 0.22);
      transition:
        border-color var(--pos-transition),
        box-shadow var(--pos-transition),
        transform 0.12s ease;
    }
    .payment-provider-card:hover {
      transform: translateY(-1px);
      border-color: var(--pos-border-strong);
    }
    .payment-provider-card--on {
      border-color: color-mix(in srgb, var(--pos-accent) 44%, var(--pos-border));
      background: linear-gradient(180deg, color-mix(in srgb, var(--pos-accent) 8%, var(--pos-elevated)), var(--pos-elevated));
      box-shadow:
        inset 0 3px 0 var(--pos-accent),
        0 12px 28px -22px rgba(17, 24, 39, 0.28);
    }
    .payment-provider-card--disabled {
      opacity: 0.72;
    }
    .payment-provider-card__top {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 0.35rem;
    }
    .payment-provider-card__icon {
      display: grid;
      place-items: center;
      width: 2rem;
      height: 2rem;
      border-radius: 5px;
      border: 1px solid var(--pos-border);
      background: var(--pos-surface-2);
      color: var(--pos-accent-hover);
      font-size: 0.68rem;
      font-weight: 900;
    }
    .payment-provider-card__badge {
      padding: 0.14rem 0.4rem;
      border-radius: 999px;
      border: 1px solid var(--pos-border);
      background: var(--pos-surface-2);
      color: var(--pos-muted);
      font-size: 0.56rem;
      font-weight: 850;
      text-transform: uppercase;
      white-space: nowrap;
    }
    .payment-provider-card__badge--base {
      border-color: color-mix(in srgb, var(--pos-accent) 28%, var(--pos-border));
      background: color-mix(in srgb, var(--pos-accent) 10%, var(--pos-elevated));
      color: var(--pos-accent-hover);
    }
    .payment-provider-card__badge--disabled {
      border-color: color-mix(in srgb, var(--pos-muted) 24%, var(--pos-border));
      background: color-mix(in srgb, var(--pos-muted) 8%, var(--pos-elevated));
      color: var(--pos-muted);
    }
    .payment-provider-card__badge--available {
      border-color: color-mix(in srgb, #3b82f6 28%, var(--pos-border));
      background: color-mix(in srgb, #3b82f6 10%, var(--pos-elevated));
      color: #2563eb;
    }
    .payment-provider-card__title {
      font-size: 0.78rem;
      font-weight: 850;
      line-height: 1.25;
    }
    .payment-provider-card__desc {
      display: block;
      color: var(--pos-muted);
      font-size: 0.66rem;
      line-height: 1.32;
    }
    .payment-provider-card__chips {
      display: flex;
      flex-wrap: wrap;
      gap: 0.22rem;
      margin-top: 0.1rem;
    }
    .payment-provider-card__chips span {
      padding: 0.12rem 0.34rem;
      border-radius: 999px;
      border: 1px solid var(--pos-border);
      color: var(--pos-muted);
      font-size: 0.56rem;
      font-weight: 750;
    }
    .payment-provider-card__foot {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.45rem;
      margin-top: auto;
      padding-top: 0.35rem;
    }
    .payment-provider-card__status {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      color: var(--pos-muted);
      font-size: 0.62rem;
      font-weight: 750;
      white-space: nowrap;
    }
    .payment-provider-card__dot {
      width: 0.42rem;
      height: 0.42rem;
      border-radius: 50%;
      background: var(--pos-muted);
    }
    .payment-provider-card__status--ok {
      color: #15803d;
    }
    .payment-provider-card__status--ok .payment-provider-card__dot {
      background: #22c55e;
    }
    .payment-provider-card__status--info {
      color: #2563eb;
    }
    .payment-provider-card__status--info .payment-provider-card__dot {
      background: #3b82f6;
    }
    .payment-provider-card__action {
      display: inline-flex;
      align-items: center;
      gap: 0.15rem;
      color: var(--pos-accent-hover);
      font-size: 0.6rem;
      font-weight: 850;
      text-transform: uppercase;
      white-space: nowrap;
    }
    .payments-config-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem 1.25rem;
      padding: 0.9rem 1rem;
      border: 1px solid var(--pos-border);
      border-radius: 5px;
      background: color-mix(in srgb, var(--pos-accent) 4%, var(--pos-bg));
      box-shadow: 0 8px 22px -20px rgba(17, 24, 39, 0.18);
    }
    .payments-config-bar__lead {
      display: flex;
      align-items: flex-start;
      gap: 0.7rem;
      flex: 0 1 24rem;
      min-width: 0;
    }
    .payments-config-bar__icon {
      display: grid;
      place-items: center;
      flex: 0 0 2.55rem;
      width: 2.55rem;
      height: 2.55rem;
      border-radius: 5px;
      color: var(--pos-accent-hover);
      background: color-mix(in srgb, var(--pos-accent) 12%, var(--pos-elevated));
      border: 1px solid color-mix(in srgb, var(--pos-accent) 18%, var(--pos-border));
    }
    .payments-config-bar__copy {
      display: grid;
      gap: 0.18rem;
      min-width: 0;
    }
    .payments-config-bar__copy strong {
      font-size: 0.82rem;
      font-weight: 850;
      color: var(--pos-text);
      line-height: 1.25;
    }
    .payments-config-bar__copy small {
      color: var(--pos-muted);
      font-size: 0.68rem;
      line-height: 1.4;
    }
    .payments-config-bar__checks {
      display: flex;
      flex: 1;
      flex-wrap: wrap;
      justify-content: center;
      gap: 0.85rem 1.35rem;
      min-width: 0;
    }
    .payments-config-bar__check {
      display: inline-flex;
      align-items: flex-start;
      gap: 0.45rem;
      min-width: 9.5rem;
      max-width: 12.5rem;
    }
    .payments-config-bar__check-icon {
      display: grid;
      place-items: center;
      flex: 0 0 1.35rem;
      width: 1.35rem;
      height: 1.35rem;
      margin-top: 0.08rem;
      border-radius: 50%;
      color: var(--pos-accent-hover);
      background: color-mix(in srgb, var(--pos-accent) 12%, var(--pos-elevated));
      border: 1px solid color-mix(in srgb, var(--pos-accent) 20%, var(--pos-border));
    }
    .payments-config-bar__check-copy {
      display: grid;
      gap: 0.06rem;
      min-width: 0;
    }
    .payments-config-bar__check-copy strong {
      font-size: 0.74rem;
      font-weight: 800;
      color: var(--pos-text);
      line-height: 1.2;
    }
    .payments-config-bar__check-copy small {
      color: var(--pos-muted);
      font-size: 0.64rem;
      line-height: 1.32;
    }
    .payments-config-bar__btn {
      display: inline-flex;
      align-items: center;
      gap: 0.38rem;
      flex-shrink: 0;
      padding: 0.48rem 0.9rem;
      border: 1px solid color-mix(in srgb, var(--pos-accent) 42%, var(--pos-border));
      border-radius: 5px;
      background: var(--pos-elevated);
      color: var(--pos-accent-hover);
      font-size: 0.76rem;
      font-weight: 850;
      cursor: pointer;
      white-space: nowrap;
      box-shadow: 0 1px 0 color-mix(in srgb, var(--pos-accent) 10%, transparent);
    }
    .station-board {
      display: grid;
      grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.95fr) minmax(0, 1fr);
      grid-template-rows: auto auto;
      gap: 0.75rem;
      align-items: stretch;
    }
    .station-card {
      display: flex;
      flex-direction: column;
      gap: 0.65rem;
      padding: 0.85rem 0.9rem;
      border: 1px solid var(--pos-border);
      border-radius: 5px;
      background: var(--pos-elevated);
      box-shadow: 0 8px 22px -20px rgba(17, 24, 39, 0.22);
    }
    .station-card--ident {
      grid-column: 1;
      grid-row: 1;
    }
    .station-card--efactura {
      grid-column: 2;
      grid-row: 1;
    }
    .station-card--efactura-pending {
      background: linear-gradient(180deg, #fffbeb 0%, #fef8ee 100%);
      border-color: color-mix(in srgb, #fbbf24 28%, var(--pos-border));
    }
    .station-card--experience {
      grid-column: 3;
      grid-row: 1 / span 2;
      gap: 0;
      padding: 0.72rem 0.82rem 0.62rem;
    }
    .station-card--experience .station-card__head {
      padding-bottom: 0.42rem;
      margin-bottom: 0.1rem;
      border-bottom: 1px solid color-mix(in srgb, var(--pos-border) 72%, transparent);
    }
    .station-card--experience .station-toggle-row {
      flex: 0 0 auto;
      padding-top: 15px;
      padding-bottom: 15px;
      border-top: none;
      border-bottom: 1px solid color-mix(in srgb, var(--pos-border) 72%, transparent);
    }
    .station-card--experience .station-toggle-row:last-child {
      border-bottom: none;
    }
    .station-card--experience .station-toggle-row__copy {
      gap: 0.02rem;
    }
    .station-card--experience .station-toggle-row__copy strong {
      font-size: 0.76rem;
      line-height: 1.2;
    }
    .station-card--experience .station-toggle-row__copy small {
      font-size: 0.65rem;
      line-height: 1.22;
    }
    .station-card--upsell {
      grid-column: 1;
      grid-row: 2;
    }
    .station-card--pricing {
      grid-column: 2;
      grid-row: 2;
    }
    .station-card__head {
      display: flex;
      align-items: center;
      gap: 0.6rem;
    }
    .station-card__head--split,
    .station-card__head--efactura {
      justify-content: space-between;
    }
    .station-card__title-plain {
      font-size: 0.84rem;
      font-weight: 850;
      color: var(--pos-text);
      line-height: 1.2;
    }
    .station-card__head-main {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      min-width: 0;
    }
    .station-card__icon {
      display: grid;
      place-items: center;
      flex: 0 0 2.35rem;
      width: 2.35rem;
      height: 2.35rem;
      border-radius: 5px;
    }
    .station-card__icon--purple {
      color: var(--pos-accent-hover);
      background: color-mix(in srgb, var(--pos-accent) 11%, var(--pos-surface));
      border: 1px solid color-mix(in srgb, var(--pos-accent) 16%, var(--pos-border));
    }
    .station-card__icon--amber {
      color: #d97706;
      background: color-mix(in srgb, #f59e0b 12%, var(--pos-surface));
      border: 1px solid color-mix(in srgb, #f59e0b 24%, var(--pos-border));
    }
    .station-card__icon--green {
      color: #15803d;
      background: color-mix(in srgb, #22c55e 11%, var(--pos-surface));
      border: 1px solid color-mix(in srgb, #22c55e 20%, var(--pos-border));
    }
    .station-card__titles {
      display: grid;
      gap: 0.1rem;
      min-width: 0;
    }
    .station-card__titles--inline {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 0.4rem;
    }
    .station-card__titles strong {
      font-size: 0.84rem;
      font-weight: 850;
      color: var(--pos-text);
      line-height: 1.2;
    }
    .station-card__titles small {
      color: var(--pos-muted);
      font-size: 0.68rem;
      line-height: 1.3;
    }
    .station-card__badge {
      flex-shrink: 0;
      padding: 0.18rem 0.48rem;
      border-radius: 999px;
      border: 1px solid color-mix(in srgb, #f59e0b 34%, var(--pos-border));
      background: color-mix(in srgb, #f59e0b 16%, #fff);
      color: #c2410c;
      font-size: 0.64rem;
      font-weight: 850;
    }
    .station-card__badge--ok {
      border-color: color-mix(in srgb, #22c55e 30%, var(--pos-border));
      background: color-mix(in srgb, #22c55e 12%, var(--pos-elevated));
      color: #15803d;
    }
    .station-card__body {
      display: grid;
      gap: 0.55rem;
      flex: 1;
    }
    .station-card--experience .station-card__body {
      display: flex;
      flex-direction: column;
      gap: 0;
      justify-content: flex-start;
      align-content: flex-start;
    }
    .station-card__body--center {
      place-content: center;
      text-align: center;
      min-height: 6.5rem;
    }
    .station-card__copy {
      margin: 0;
      color: var(--pos-muted);
      font-size: 0.74rem;
      line-height: 1.45;
    }
    .station-card__cta {
      width: 100%;
      margin-top: 0.35rem;
      padding: 0.5rem 0.85rem;
      border: 1px solid color-mix(in srgb, #f59e0b 55%, #fcd34d);
      border-radius: 5px;
      background: #fff;
      color: #ea580c;
      font-size: 0.76rem;
      font-weight: 800;
      cursor: pointer;
      box-shadow: 0 1px 0 color-mix(in srgb, #f59e0b 12%, transparent);
    }
    .station-card--efactura-pending .station-card__cta:hover {
      background: #fffdf8;
      border-color: #f59e0b;
    }
    .station-field {
      display: grid;
      gap: 0.28rem;
    }
    .station-field-row {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.55rem;
    }
    .station-field__label {
      font-size: 0.7rem;
      font-weight: 800;
      color: color-mix(in srgb, var(--pos-accent-hover) 70%, var(--pos-text));
    }
    .station-field__input {
      width: 100%;
      min-height: 2.15rem;
      padding: 0.42rem 0.55rem;
      border: 1px solid color-mix(in srgb, var(--pos-accent) 12%, var(--pos-border));
      border-radius: 5px;
      background: color-mix(in srgb, var(--pos-accent) 5%, var(--pos-bg));
      color: var(--pos-text);
      font-size: 0.8rem;
    }
    .station-note {
      margin: 0;
      font-size: 0.72rem;
      line-height: 1.35;
    }
    .station-note--warn {
      color: #b45309;
    }
    .station-toggle-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.65rem;
      padding: 0.42rem 0;
      border-top: 1px solid color-mix(in srgb, var(--pos-border) 70%, transparent);
    }
    .station-card__body > .station-toggle-row:first-child {
      border-top: none;
      /*padding-top: 0;*/
    }
    .station-toggle-row__copy {
      display: grid;
      gap: 0.12rem;
      min-width: 0;
    }
    .station-toggle-row__copy strong {
      font-size: 0.78rem;
      font-weight: 800;
      color: var(--pos-text);
    }
    .station-toggle-row__copy small {
      color: var(--pos-muted);
      font-size: 0.68rem;
      line-height: 1.35;
    }
    .station-switch {
      position: relative;
      display: inline-flex;
      flex-shrink: 0;
      width: 2.45rem;
      height: 1.35rem;
    }
    .station-switch input {
      position: absolute;
      inset: 0;
      margin: 0;
      opacity: 0;
      cursor: pointer;
      z-index: 1;
    }
    .station-switch__ui {
      position: relative;
      display: block;
      width: 100%;
      height: 100%;
      border-radius: 999px;
      background: color-mix(in srgb, var(--pos-muted) 28%, var(--pos-border));
      transition: background 0.15s ease;
    }
    .station-switch__ui::after {
      content: '';
      position: absolute;
      top: 0.16rem;
      left: 0.16rem;
      width: 1.02rem;
      height: 1.02rem;
      border-radius: 50%;
      background: #fff;
      box-shadow: 0 1px 3px rgba(15, 23, 42, 0.18);
      transition: transform 0.15s ease;
    }
    .station-switch input:checked + .station-switch__ui {
      background: var(--pos-accent);
    }
    .station-switch input:checked + .station-switch__ui::after {
      transform: translateX(1.1rem);
    }
    .station-chip {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.38rem;
      width: 100%;
      margin-top: 0.2rem;
      padding: 0.42rem 0.65rem;
      border-radius: 5px;
      border: 1px solid color-mix(in srgb, var(--pos-accent) 28%, var(--pos-border));
      background: color-mix(in srgb, var(--pos-accent) 12%, var(--pos-elevated));
      color: var(--pos-accent-hover);
      font-size: 0.7rem;
      font-weight: 850;
    }
    .station-card--upsell .station-card__body {
      gap: 0.42rem;
    }
    .section-head {
      margin-bottom: 0.75rem;
    }
    .eyebrow {
      display: block;
      margin-bottom: 0.18rem;
      color: var(--pos-accent-hover);
      font-size: 0.62rem;
      font-weight: 850;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    h1 {
      margin: 0;
      font-size: 1rem;
      line-height: 1.2;
      font-weight: 850;
    }
    .section-head p {
      margin: 0.35rem 0 0;
      max-width: 48rem;
      color: var(--pos-muted);
      font-size: 0.82rem;
      line-height: 1.45;
    }
    .integration-catalog {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 0.65rem;
      margin-bottom: 0.85rem;
    }
    .integration-card {
      display: grid;
      grid-template-columns: 2.25rem minmax(0, 1fr);
      gap: 0.6rem;
      align-items: start;
      min-height: 9.3rem;
      padding: 0.75rem;
      border: 1px solid var(--pos-border);
      border-radius: var(--pos-radius-sm);
      background:
        linear-gradient(180deg, color-mix(in srgb, var(--pos-elevated) 92%, #ffffff), var(--pos-surface)),
        var(--pos-surface);
      color: var(--pos-text);
      text-align: left;
      cursor: pointer;
      box-shadow: 0 16px 38px -32px rgba(17, 24, 39, 0.4);
      transition:
        border-color var(--pos-transition),
        background var(--pos-transition),
        transform 0.12s ease;
    }
    .integration-card:hover {
      transform: translateY(-1px);
      border-color: var(--pos-border-strong);
    }
    .integration-card--on {
      border-color: color-mix(in srgb, var(--pos-accent) 44%, var(--pos-border));
      background:
        linear-gradient(180deg, color-mix(in srgb, var(--pos-accent-muted) 62%, var(--pos-elevated)), var(--pos-elevated)),
        var(--pos-elevated);
      box-shadow:
        inset 0 3px 0 var(--pos-accent),
        0 18px 44px -34px rgba(17, 24, 39, 0.48);
    }
    .integration-card__icon {
      display: grid;
      place-items: center;
      width: 2.25rem;
      height: 2.25rem;
      border-radius: var(--pos-radius-sm);
      border: 1px solid var(--pos-border);
      background: var(--pos-surface-2);
      color: var(--pos-accent-hover);
      font-size: 0.72rem;
      font-weight: 900;
    }
    .integration-card__body,
    .integration-card__top,
    .integration-card__chips {
      min-width: 0;
    }
    .integration-card__top {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 0.45rem;
    }
    .integration-card__top strong {
      font-size: 0.78rem;
      line-height: 1.2;
    }
    .integration-card__top em {
      flex-shrink: 0;
      padding: 0.12rem 0.35rem;
      border-radius: 999px;
      background: var(--pos-surface-2);
      color: var(--pos-muted);
      font-size: 0.56rem;
      font-style: normal;
      font-weight: 850;
      text-transform: uppercase;
    }
    .integration-card__state--ok {
      background: rgba(16, 185, 129, 0.12) !important;
      color: var(--pos-status-ok) !important;
    }
    .integration-card__state--bad {
      background: rgba(248, 113, 113, 0.14) !important;
      color: #b91c1c !important;
    }
    .integration-card small {
      display: block;
      margin-top: 0.3rem;
      color: var(--pos-faint);
      font-size: 0.67rem;
      line-height: 1.32;
    }
    .integration-card__chips {
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem;
      margin-top: 0.48rem;
    }
    .integration-card__chips span {
      padding: 0.12rem 0.34rem;
      border-radius: 999px;
      border: 1px solid var(--pos-border);
      color: var(--pos-muted);
      font-size: 0.58rem;
      font-weight: 750;
    }
    .integration-card__action {
      display: inline-flex;
      align-items: center;
      width: fit-content;
      margin-top: 0.62rem;
      color: var(--pos-accent-hover);
      font-size: 0.64rem;
      font-weight: 850;
      text-transform: uppercase;
    }
    .integration-modal-dim {
      position: fixed;
      inset: 0;
      z-index: 180;
      background: rgba(15, 23, 42, 0.42);
      backdrop-filter: blur(6px);
    }
    .integration-modal {
      position: fixed;
      top: 50%;
      left: 50%;
      z-index: 190;
      width: min(58rem, calc(100vw - 2rem));
      max-height: min(88vh, 52rem);
      overflow: auto;
      transform: translate(-50%, -50%);
      border: 1px solid var(--pos-border-strong);
      border-radius: var(--pos-radius);
      background: var(--pos-elevated);
      box-shadow: 0 30px 80px -42px rgba(15, 23, 42, 0.62);
      padding: 0.9rem;
    }
    .integration-modal__head {
      position: sticky;
      top: 0;
      z-index: 1;
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 1rem;
      margin: -0.9rem -0.9rem 0;
      padding: 0.9rem;
      border-bottom: 1px solid var(--pos-border);
      background: color-mix(in srgb, var(--pos-elevated) 94%, var(--pos-surface));
    }
    .integration-modal__head h2 {
      margin: 0.1rem 0 0;
      font-size: 1rem;
      line-height: 1.2;
    }
    .integration-modal__head p {
      margin: 0.3rem 0 0;
      color: var(--pos-muted);
      font-size: 0.78rem;
      line-height: 1.4;
    }
    .integration-modal__body {
      margin-top: 0.85rem;
    }
    .integration-panel--hidden {
      display: none !important;
    }
    .card-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.65rem;
      align-content: start;
    }
    .field,
    .toggle,
    .info-card {
      border: 1px solid var(--pos-border);
      border-radius: var(--pos-radius-sm);
      background: color-mix(in srgb, var(--pos-surface) 92%, var(--pos-elevated));
      padding: 0.78rem;
      box-shadow: 0 10px 28px -26px rgba(17, 24, 39, 0.32);
      transition:
        border-color var(--pos-transition),
        box-shadow var(--pos-transition),
        transform 0.12s ease;
    }
    .field:hover,
    .toggle:hover,
    .info-card:hover {
      transform: translateY(-1px);
      border-color: var(--pos-border-strong);
      box-shadow: 0 16px 34px -28px rgba(17, 24, 39, 0.42);
    }
    .field {
      display: flex;
      flex-direction: column;
      gap: 0.38rem;
    }
    .field--wide {
      grid-column: 1 / -1;
    }
    .field span,
    .info-card span {
      font-size: 0.72rem;
      font-weight: 800;
      color: var(--pos-muted);
    }
    .field-hint {
      margin-top: 0.05rem;
      color: var(--pos-faint);
      font-size: 0.68rem;
      line-height: 1.35;
    }
    .input {
      width: 100%;
      border-radius: var(--pos-radius-sm);
      border: 1px solid var(--pos-border-strong);
      background: var(--pos-bg);
      color: var(--pos-text);
      padding: 0.46rem 0.55rem;
      font-size: 0.8rem;
      min-height: 2.25rem;
    }
    .input:disabled {
      opacity: 0.58;
      cursor: not-allowed;
    }
    .input--area {
      resize: vertical;
      min-height: 5rem;
      line-height: 1.35;
      font-family: var(--pos-mono);
    }
    .toggle {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.85rem;
    }
    .toggle strong {
      display: block;
      font-size: 0.8rem;
    }
    .toggle small {
      display: block;
      margin-top: 0.12rem;
      color: var(--pos-faint);
      font-size: 0.68rem;
      line-height: 1.3;
    }
    .toggle input {
      width: 1.1rem;
      height: 1.1rem;
      accent-color: var(--pos-accent);
      flex-shrink: 0;
    }
    .segmented {
      display: flex;
      gap: 0.4rem;
    }
    .segmented--with-copy {
      max-width: 24rem;
    }
    .seg {
      flex: 1;
      padding: 0.5rem 0.6rem;
      border-radius: var(--pos-radius-sm);
      border: 1px solid var(--pos-border);
      background: transparent;
      color: var(--pos-muted);
      font-size: 0.78rem;
      font-weight: 750;
      cursor: pointer;
    }
    .seg--on {
      border-color: color-mix(in srgb, var(--pos-accent) 45%, var(--pos-border));
      color: var(--pos-accent-hover);
      background: var(--pos-accent-muted);
    }
    .lock-note,
    .warn,
    .hint,
    .learned {
      margin: 0 0 0.65rem;
      padding: 0.65rem 0.75rem;
      border-radius: var(--pos-radius-sm);
      border: 1px solid var(--pos-border);
      background: var(--pos-surface-2);
      color: var(--pos-muted);
      font-size: 0.76rem;
      line-height: 1.42;
    }
    .warn {
      border-color: rgba(251, 113, 133, 0.35);
      background: rgba(251, 113, 133, 0.08);
      color: #e11d48;
    }
    .info-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.65rem;
    }
    .info-card strong {
      display: block;
      margin-top: 0.22rem;
      font-size: 0.86rem;
      overflow-wrap: anywhere;
    }
    .stripe-box {
      gap: 0.7rem;
    }
    .stripe-box__head,
    .stripe-actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.65rem;
      flex-wrap: wrap;
    }
    .stripe-box__head small {
      display: block;
      margin-top: 0.14rem;
      color: var(--pos-faint);
      font-size: 0.68rem;
      font-weight: 700;
    }
    .stripe-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 0.65rem;
    }
    .stripe-status {
      margin: 0;
      padding: 0.5rem 0.58rem;
      border-radius: var(--pos-radius-sm);
      font-size: 0.74rem;
      font-weight: 750;
      border: 1px solid var(--pos-border);
      background: var(--pos-surface-2);
      color: var(--pos-muted);
    }
    .stripe-status--ok {
      border-color: rgba(16, 185, 129, 0.34);
      background: rgba(16, 185, 129, 0.1);
      color: var(--pos-status-ok);
    }
    .stripe-status--warn {
      border-color: rgba(217, 119, 6, 0.32);
      background: rgba(251, 191, 36, 0.12);
      color: #92400e;
    }
    .mini-btn,
    .primary-btn {
      border-radius: var(--pos-radius-sm);
      border: 1px solid var(--pos-border-strong);
      background: var(--pos-elevated);
      color: var(--pos-muted);
      min-height: 2.15rem;
      padding: 0.42rem 0.7rem;
      font-size: 0.74rem;
      font-weight: 850;
      cursor: pointer;
    }
    .primary-btn {
      border-color: var(--pos-accent);
      background: var(--pos-accent);
      color: #fff;
    }
    .primary-btn--soft {
      background: var(--pos-accent-muted);
      color: var(--pos-accent-hover);
    }
    .mini-btn:disabled,
    .primary-btn:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }
    .mini-btn--danger {
      color: #b91c1c;
      border-color: rgba(185, 28, 28, 0.24);
      background: rgba(248, 113, 113, 0.08);
      align-self: end;
    }
    .stripe-plan {
      min-width: 11rem;
      padding: 0;
      border: none;
      background: transparent;
      box-shadow: none;
    }
    .amount-pill {
      padding: 0.32rem 0.58rem;
      border-radius: 999px;
      border: 1px solid color-mix(in srgb, var(--pos-accent) 34%, var(--pos-border));
      background: var(--pos-accent-muted);
      color: var(--pos-accent-hover);
      font-family: var(--pos-mono);
      font-size: 0.78rem;
      white-space: nowrap;
    }
    .plans-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 0.7rem;
      margin-top: 0.2rem;
      color: var(--pos-text);
      font-size: 0.8rem;
    }
    .kushki-plans {
      display: grid;
      gap: 0.65rem;
    }
    .kushki-plan {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr)) auto;
      gap: 0.55rem;
      padding: 0.65rem;
      border: 1px solid var(--pos-border);
      border-radius: var(--pos-radius-sm);
      background: var(--pos-surface-2);
    }
    .kushki-hosted-grid {
      display: grid;
      grid-template-columns: 1.3fr 1.7fr 1fr 0.8fr;
      gap: 0.65rem;
    }
    .hosted-field {
      min-height: 2.35rem;
      border-radius: var(--pos-radius-sm);
      border: 1px solid var(--pos-border-strong);
      background: var(--pos-bg);
      color: var(--pos-text);
      padding: 0.46rem 0.55rem;
    }
    .learned {
      margin-top: 0.75rem;
    }
    .learned h2 {
      margin: 0 0 0.45rem;
      font-size: 0.86rem;
    }
    .learned ul {
      margin: 0;
      padding-left: 1.05rem;
    }
    .section-head--compact p {
      margin-top: 0.15rem;
    }
    .rules-hero {
      position: relative;
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 1.25rem;
      margin-bottom: 0.9rem;
      padding: 1.2rem 1.15rem 0.65rem;
      border: 1px solid var(--pos-border);
      border-radius: 5px;
      background: linear-gradient(135deg, var(--pos-elevated), var(--pos-surface-2));
      box-shadow: var(--pos-shadow-soft);
      overflow: hidden;
      min-height: 9.25rem;
    }
    .rules-hero__copy {
      flex: 1;
      min-width: 0;
      align-self: flex-start;
      padding-bottom: 0.55rem;
    }
    .rules-hero .eyebrow {
      margin-bottom: 0.35rem;
    }
    .rules-hero h1 {
      margin: 0.2rem 0 0;
      font-size: 1.38rem;
      font-weight: 900;
      line-height: 1.28;
      letter-spacing: -0.015em;
    }
    .rules-hero p {
      margin: 0.55rem 0 0;
      max-width: 34rem;
      color: var(--pos-muted);
      font-size: 0.84rem;
      line-height: 1.55;
    }
    .rules-hero__stats {
      display: flex;
      flex-wrap: wrap;
      gap: 0.65rem;
      margin-top: 0.9rem;
    }
    .rules-stat {
      display: inline-flex;
      align-items: center;
      gap: 0.7rem;
      min-width: 11.5rem;
      padding: 0.58rem 0.82rem;
      border: 1px solid color-mix(in srgb, var(--pos-border) 88%, transparent);
      border-radius: 5px;
      background: var(--pos-elevated);
      box-shadow: 0 10px 24px -20px rgba(17, 24, 39, 0.24);
    }
    .rules-stat__icon {
      display: grid;
      place-items: center;
      flex: 0 0 2.45rem;
      width: 2.45rem;
      height: 2.45rem;
      border-radius: 5px;
      box-shadow: 0 8px 18px -14px rgba(17, 24, 39, 0.35);
    }
    .rules-stat__icon--purple {
      color: #fff;
      background: linear-gradient(145deg, #8b5cf6, #6366f1);
    }
    .rules-stat__icon--blue {
      color: #fff;
      background: linear-gradient(145deg, #60a5fa, #2563eb);
    }
    .rules-stat__icon--green {
      color: #fff;
      background: linear-gradient(145deg, #4ade80, #16a34a);
    }
    .rules-stat__body {
      display: grid;
      gap: 0.08rem;
      min-width: 0;
    }
    .rules-stat__value {
      font-size: 1.05rem;
      font-weight: 900;
      color: var(--pos-text);
      line-height: 1.1;
      letter-spacing: -0.02em;
    }
    .rules-stat__label {
      font-size: 0.66rem;
      font-weight: 650;
      color: var(--pos-muted);
      line-height: 1.2;
      white-space: nowrap;
    }
    .rules-hero__badge {
      position: absolute;
      top: 0.75rem;
      right: 0.75rem;
      z-index: 1;
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      padding: 0.24rem 0.55rem;
      border-radius: 999px;
      border: 1px solid color-mix(in srgb, var(--pos-accent) 34%, var(--pos-border));
      background: var(--pos-elevated);
      color: var(--pos-accent-hover);
      font-size: 0.64rem;
      font-weight: 850;
    }
    .rules-hero__badge::before {
      content: '';
      width: 0.42rem;
      height: 0.42rem;
      border-radius: 50%;
      background: var(--pos-accent);
    }
    .rules-hero__art {
      flex: 0 0 min(46%, 20rem);
      display: flex;
      align-items: flex-end;
      justify-content: flex-end;
      margin-right: -0.35rem;
      margin-bottom: -1.65rem;
      pointer-events: none;
    }
    .rules-hero__img {
      display: block;
      width: 118%;
      max-width: 21rem;
      height: auto;
      object-fit: contain;
      object-position: right bottom;
    }
    .rules-board {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(15.5rem, 19.5rem);
      gap: 1.15rem;
      align-items: start;
    }
    .rules-config-panel {
      padding: 0.95rem 1rem 1rem;
      border: 1px solid var(--pos-border);
      border-radius: 5px;
      background: var(--pos-elevated);
      box-shadow: 0 10px 28px -24px rgba(17, 24, 39, 0.24);
    }
    .rules-config-panel__head {
      margin-bottom: 0.85rem;
    }
    .rules-config-panel__head h2 {
      margin: 0;
      font-size: 0.95rem;
      font-weight: 900;
      color: var(--pos-text);
    }
    .rules-config-panel__head p {
      margin: 0.28rem 0 0;
      color: var(--pos-muted);
      font-size: 0.76rem;
      line-height: 1.4;
    }
    .rules-smart-panel {
      display: flex;
      flex-direction: column;
      gap: 0.55rem;
      padding: 0.9rem 0.95rem;
      border: 1px solid var(--pos-border);
      border-radius: 5px;
      background: var(--pos-elevated);
      box-shadow: 0 10px 28px -24px rgba(17, 24, 39, 0.24);
    }
    .rules-smart-panel__title {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      margin: 0;
      font-size: 0.9rem;
      font-weight: 850;
      color: var(--pos-text);
    }
    .rules-smart-panel__sparkle {
      display: grid;
      place-items: center;
      color: var(--pos-accent-hover);
    }
    .rules-smart-panel__text {
      margin: 0;
      color: var(--pos-muted);
      font-size: 0.74rem;
      line-height: 1.45;
    }
    .rules-smart-panel__list {
      margin: 0.15rem 0 0;
      padding: 0;
      list-style: none;
      display: grid;
      gap: 0.42rem;
    }
    .rules-smart-panel__list li {
      display: grid;
      grid-template-columns: 1.2rem minmax(0, 1fr);
      gap: 0.45rem;
      align-items: center;
      font-size: 0.74rem;
      font-weight: 700;
      color: var(--pos-text);
    }
    .rules-smart-panel__check {
      display: grid;
      place-items: center;
      width: 1.2rem;
      height: 1.2rem;
      border-radius: 50%;
      color: var(--pos-accent-hover);
      background: color-mix(in srgb, var(--pos-accent) 12%, var(--pos-elevated));
      border: 1px solid color-mix(in srgb, var(--pos-accent) 20%, var(--pos-border));
    }
    .rules-smart-panel__status {
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
      margin-top: 0.35rem;
      padding: 0.5rem 0.65rem;
      border: 1px solid color-mix(in srgb, #22c55e 30%, var(--pos-border));
      border-radius: 5px;
      background: color-mix(in srgb, #22c55e 10%, var(--pos-elevated));
      color: #15803d;
      font-size: 0.74rem;
      font-weight: 700;
    }
    .rules-smart-panel__status strong {
      font-weight: 900;
    }
    .rules-smart-panel__status-icon {
      display: grid;
      place-items: center;
      color: #16a34a;
    }
    .settings-body--split {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(15.5rem, 19.5rem);
      gap: 1.15rem;
      align-items: stretch;
    }
    .settings-body__main {
      min-width: 0;
    }
    .fiscal-alert {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.55rem 0.75rem;
      margin-bottom: 0.85rem;
      padding: 0.7rem 0.85rem;
      border: 1px solid color-mix(in srgb, #38bdf8 35%, var(--pos-border));
      border-radius: var(--pos-radius-sm);
      background: color-mix(in srgb, #38bdf8 10%, var(--pos-surface));
    }
    .fiscal-alert__icon {
      display: grid;
      place-items: center;
      color: #0284c7;
    }
    .fiscal-alert__text {
      flex: 1;
      min-width: 10rem;
      color: var(--pos-text);
      font-size: 0.8rem;
    }
    .fiscal-alert__btn {
      border: 1px solid color-mix(in srgb, #0284c7 30%, var(--pos-border));
      border-radius: var(--pos-radius-sm);
      background: var(--pos-elevated);
      color: #0369a1;
      min-height: 2rem;
      padding: 0.35rem 0.7rem;
      font-size: 0.74rem;
      font-weight: 750;
      cursor: pointer;
      white-space: nowrap;
    }
    .rules-field-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.65rem;
      align-content: start;
    }
    .rule-field-card {
      display: flex;
      align-items: flex-start;
      gap: 0.65rem;
      margin: 0;
      padding: 0.72rem 0.78rem;
      border: 1px solid var(--pos-border);
      border-radius: 5px;
      background: var(--pos-elevated);
      box-shadow: 0 8px 22px -20px rgba(17, 24, 39, 0.22);
      cursor: default;
    }
    .rule-field-card__icon {
      display: grid;
      place-items: center;
      flex: 0 0 2.35rem;
      width: 2.35rem;
      height: 2.35rem;
      border-radius: 5px;
      color: var(--pos-accent-hover);
      background: color-mix(in srgb, var(--pos-accent) 11%, var(--pos-surface));
      border: 1px solid color-mix(in srgb, var(--pos-accent) 16%, var(--pos-border));
    }
    .rule-field-card__icon--glyph {
      font-size: 0.95rem;
      font-weight: 850;
      line-height: 1;
    }
    .rule-field-card__body {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: 0.28rem;
      min-width: 0;
    }
    .rule-field-card__hint {
      color: var(--pos-faint);
      font-size: 0.64rem;
      line-height: 1.32;
    }
    .rule-field-card__label {
      font-size: 0.72rem;
      font-weight: 800;
      line-height: 1.2;
      color: color-mix(in srgb, var(--pos-accent-hover) 72%, var(--pos-text));
    }
    .rule-field-card__input {
      width: 100%;
      min-height: 2.15rem;
      padding: 0.42rem 0.55rem;
      border: 1px solid color-mix(in srgb, var(--pos-accent) 12%, var(--pos-border));
      border-radius: 5px;
      background: color-mix(in srgb, var(--pos-accent) 6%, var(--pos-bg));
      color: var(--pos-text);
      font-size: 0.8rem;
      line-height: 1.2;
    }
    select.rule-field-card__input {
      appearance: none;
      padding-right: 1.65rem;
      background-color: color-mix(in srgb, var(--pos-accent) 6%, var(--pos-bg));
      background-image:
        linear-gradient(45deg, transparent 50%, color-mix(in srgb, var(--pos-accent-hover) 70%, var(--pos-muted)) 50%),
        linear-gradient(135deg, color-mix(in srgb, var(--pos-accent-hover) 70%, var(--pos-muted)) 50%, transparent 50%);
      background-position:
        calc(100% - 0.95rem) calc(50% - 0.12rem),
        calc(100% - 0.7rem) calc(50% - 0.12rem);
      background-size: 0.32rem 0.32rem, 0.32rem 0.32rem;
      background-repeat: no-repeat;
    }
    .rule-field-card__input:disabled {
      opacity: 0.58;
      cursor: not-allowed;
    }
    .rule-field-card__input:focus {
      outline: none;
      border-color: color-mix(in srgb, var(--pos-accent) 38%, var(--pos-border));
      box-shadow: 0 0 0 2px color-mix(in srgb, var(--pos-accent) 12%, transparent);
    }
    .settings-promo {
      position: relative;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      min-height: 100%;
      padding: 0;
      border: 1px solid var(--pos-border);
      border-radius: 5px;
      background: linear-gradient(
        180deg,
        color-mix(in srgb, var(--pos-accent) 11%, var(--pos-elevated)) 0%,
        color-mix(in srgb, var(--pos-accent) 5%, var(--pos-surface)) 62%,
        var(--pos-elevated) 100%
      );
      box-shadow: var(--pos-shadow-soft);
    }
    .settings-promo__badge {
      position: absolute;
      top: 0.65rem;
      right: 0.65rem;
      z-index: 1;
      padding: 0.22rem 0.5rem;
      border-radius: 999px;
      border: 1px solid color-mix(in srgb, var(--pos-accent) 34%, var(--pos-border));
      background: var(--pos-elevated);
      color: var(--pos-accent-hover);
      font-size: 0.64rem;
      font-weight: 850;
    }
    .settings-promo__art {
      display: flex;
      flex: 1;
      align-items: center;
      justify-content: center;
      padding: 1.1rem 0.55rem 0.35rem;
      min-height: 11.5rem;
    }
    .settings-promo__img {
      display: block;
      width: 100%;
      max-width: 100%;
      height: auto;
      object-fit: contain;
    }
    .settings-promo__footer {
      margin: 0 0.7rem 0.7rem;
      padding: 0.82rem 0.85rem;
      border: 1px solid var(--pos-border);
      border-radius: 5px;
      background: var(--pos-elevated);
      text-align: left;
    }
    .settings-promo__title {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      margin: 0 0 0.35rem;
      font-size: 0.9rem;
      font-weight: 850;
      color: var(--pos-text);
    }
    .settings-promo__sparkle {
      display: grid;
      place-items: center;
      color: var(--pos-accent-hover);
    }
    .settings-promo__text {
      margin: 0;
      color: var(--pos-muted);
      font-size: 0.76rem;
      line-height: 1.45;
    }
    .info-grid--stats {
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 0.65rem;
      margin-bottom: 0;
    }
    .info-stat {
      display: grid;
      grid-template-columns: 2.45rem minmax(0, 1fr);
      gap: 0.65rem;
      align-items: start;
      padding: 0.78rem 0.85rem;
      border: 1px solid var(--pos-border);
      border-radius: 5px;
      background: var(--pos-elevated);
      box-shadow: 0 10px 28px -26px rgba(17, 24, 39, 0.32);
    }
    .info-stat__icon {
      display: grid;
      place-items: center;
      width: 2.45rem;
      height: 2.45rem;
      border-radius: 5px;
      color: #fff;
      box-shadow: 0 8px 18px -14px rgba(17, 24, 39, 0.35);
    }
    .info-stat__icon--purple {
      background: linear-gradient(145deg, #8b5cf6, #6366f1);
    }
    .info-stat__icon--blue {
      background: linear-gradient(145deg, #60a5fa, #2563eb);
    }
    .info-stat__icon--teal {
      background: linear-gradient(145deg, #2dd4bf, #0891b2);
    }
    .info-stat__icon--green {
      background: linear-gradient(145deg, #4ade80, #16a34a);
    }
    .info-stat__body {
      display: grid;
      gap: 0.12rem;
      min-width: 0;
    }
    .info-stat__label {
      color: var(--pos-muted);
      font-size: 0.68rem;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
    .info-stat__row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.35rem;
    }
    .info-stat__row strong {
      font-size: 0.92rem;
      line-height: 1.2;
    }
    .info-stat__ok {
      color: var(--pos-status-ok);
    }
    .info-stat__body small {
      color: var(--pos-faint);
      font-size: 0.68rem;
      line-height: 1.35;
      overflow-wrap: anywhere;
    }
    .info-stat__badge {
      padding: 0.14rem 0.42rem;
      border-radius: 999px;
      font-size: 0.62rem;
      font-weight: 850;
      white-space: nowrap;
    }
    .info-stat__badge--info {
      color: #1d4ed8;
      background: color-mix(in srgb, #3b82f6 14%, transparent);
      border: 1px solid color-mix(in srgb, #3b82f6 28%, transparent);
    }
    .info-stat__badge--ok {
      color: var(--pos-status-ok);
      background: var(--pos-status-ok-bg);
      border: 1px solid var(--pos-status-ok-border);
    }
    .system-details {
      padding: 0.95rem 1rem;
      border: 1px solid var(--pos-border);
      border-radius: 5px;
      background: var(--pos-elevated);
      box-shadow: 0 10px 28px -24px rgba(17, 24, 39, 0.24);
    }
    .system-details__title {
      margin: 0 0 0.75rem;
      font-size: 0.68rem;
      font-weight: 900;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--pos-accent-hover);
    }
    .system-details__grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.65rem 1rem;
    }
    .system-details__item {
      display: grid;
      grid-template-columns: 1.6rem minmax(0, 1fr);
      gap: 0.5rem;
      align-items: start;
    }
    .system-details__ico {
      display: grid;
      place-items: center;
      color: var(--pos-accent-hover);
    }
    .system-details__label {
      display: block;
      color: var(--pos-faint);
      font-size: 0.66rem;
      font-weight: 750;
    }
    .system-details__item strong {
      display: block;
      margin-top: 0.08rem;
      font-size: 0.8rem;
      line-height: 1.3;
      overflow-wrap: anywhere;
    }
    .learned-panel {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1.5rem;
      padding: 0.95rem 1rem 0.95rem 1.05rem;
      border: 1px solid color-mix(in srgb, var(--pos-accent) 18%, var(--pos-border));
      border-radius: 5px;
      background: linear-gradient(
        135deg,
        color-mix(in srgb, var(--pos-accent) 6%, var(--pos-elevated)) 0%,
        var(--pos-elevated) 72%
      );
      box-shadow: 0 10px 28px -24px rgba(17, 24, 39, 0.24);
      color: var(--pos-text);
    }
    .learned-panel__content {
      flex: 1 1 58%;
      min-width: 0;
    }
    .learned-panel__title {
      display: flex;
      align-items: center;
      gap: 0.45rem;
      margin: 0 0 0.65rem;
      font-size: 0.88rem;
      font-weight: 800;
      line-height: 1.3;
      color: var(--pos-text);
    }
    .learned-panel__title-ico {
      display: grid;
      place-items: center;
      flex-shrink: 0;
      color: var(--pos-accent-hover);
    }
    .learned-panel__list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 0.42rem;
    }
    .learned-panel__list li {
      display: grid;
      grid-template-columns: 1.15rem minmax(0, 1fr);
      gap: 0.5rem;
      align-items: start;
      font-size: 0.8rem;
      line-height: 1.45;
      color: var(--pos-muted);
    }
    .learned-panel__check {
      display: grid;
      place-items: center;
      width: 1.15rem;
      height: 1.15rem;
      margin-top: 0.12rem;
      border-radius: 50%;
      color: var(--pos-accent-hover);
      background: color-mix(in srgb, var(--pos-accent) 12%, var(--pos-elevated));
      border: 1px solid color-mix(in srgb, var(--pos-accent) 20%, var(--pos-border));
    }
    .learned-panel__art {
      flex: 0 0 auto;
      display: flex;
      align-items: center;
      justify-content: center;
      width: min(38%, 13.5rem);
      min-width: 9.5rem;
    }
    .learned-panel__img {
      display: block;
      width: 100%;
      max-width: 13.5rem;
      height: auto;
      object-fit: contain;
    }
    .settings-footer {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 0.65rem;
      margin-top: 1.15rem;
      padding-top: 1rem;
      border-top: 1px solid var(--pos-border);
    }
    .settings-footer__msg {
      flex: 1 1 100%;
      margin: 0 0 0.15rem;
      color: var(--pos-status-ok);
      font-size: 0.78rem;
      font-weight: 700;
    }
    .settings-footer__reset,
    .settings-footer__save {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      min-height: 2.45rem;
      padding: 0.5rem 1rem;
      border-radius: var(--pos-radius-sm);
      font-size: 0.8rem;
      font-weight: 800;
      cursor: pointer;
    }
    .settings-footer__reset {
      border: 1px solid color-mix(in srgb, #ef4444 35%, var(--pos-border));
      background: var(--pos-elevated);
      color: #b91c1c;
    }
    .settings-footer__save {
      border: 1px solid var(--pos-accent);
      background: var(--pos-accent);
      color: #fff;
      margin-left: auto;
    }
    .settings-footer--station,
    .settings-footer--payments,
    .settings-footer--rules,
    .settings-footer--printing,
    .settings-footer--interface,
    .settings-footer--about {
      display: grid;
      grid-template-columns: auto 1fr auto;
      align-items: center;
      gap: 0.75rem 1rem;
    }
    .settings-footer--station .settings-footer__msg,
    .settings-footer--payments .settings-footer__msg,
    .settings-footer--rules .settings-footer__msg,
    .settings-footer--printing .settings-footer__msg,
    .settings-footer--interface .settings-footer__msg,
    .settings-footer--about .settings-footer__msg {
      grid-column: 1 / -1;
    }
    .settings-footer__reset span,
    .settings-footer__save-copy {
      display: grid;
      gap: 0.05rem;
      text-align: left;
    }
    .settings-footer__reset small,
    .settings-footer__save-copy small {
      font-size: 0.66rem;
      font-weight: 650;
      opacity: 0.82;
    }
    .settings-footer__pending {
      display: inline-flex;
      align-items: center;
      justify-content: flex-start;
      gap: 0.5rem;
      margin: 0;
      padding: 0.55rem 0.8rem;
      border: 1px solid var(--pos-border);
      border-radius: 5px;
      background: color-mix(in srgb, var(--pos-accent) 5%, var(--pos-bg));
      color: var(--pos-muted);
      font-size: 0.76rem;
      font-weight: 700;
    }
    .settings-footer__pending span {
      display: grid;
      gap: 0.06rem;
      text-align: left;
    }
    .settings-footer__pending strong {
      color: var(--pos-text);
      font-size: 0.78rem;
      font-weight: 800;
    }
    .settings-footer__pending small {
      font-size: 0.66rem;
      font-weight: 650;
      color: var(--pos-muted);
    }
    .settings-footer__save--rich {
      min-height: 2.95rem;
      padding: 0.5rem 1.1rem;
      border-radius: 5px;
      box-shadow: 0 10px 24px -16px color-mix(in srgb, var(--pos-accent) 55%, transparent);
    }
    @media (max-width: 840px) {
      .settings {
        grid-template-columns: 1fr;
        grid-template-rows: auto minmax(0, 1fr);
        overflow: auto;
      }
      .settings-nav {
        flex-direction: row;
        overflow-x: auto;
        overflow-y: hidden;
        max-height: none;
      }
      .settings-nav__head {
        display: none;
      }
      .settings-nav__item {
        min-width: 12rem;
      }
      .settings-hero,
      .station-hero,
      .payments-hero,
      .rules-hero,
      .printing-hero,
      .interface-hero,
      .about-hero {
        flex-direction: column;
      }
      .station-hero__art,
      .payments-hero__art,
      .rules-hero__art,
      .printing-hero__art,
      .interface-hero__art,
      .about-hero__art {
        flex-basis: auto;
        width: 100%;
        margin-bottom: -0.75rem;
        justify-content: center;
      }
      .station-hero__img,
      .payments-hero__img,
      .rules-hero__img,
      .printing-hero__img,
      .interface-hero__img,
      .about-hero__img {
        width: 100%;
        max-width: 16rem;
      }
      .payments-hero__badge,
      .rules-hero__badge,
      .printing-hero__badge,
      .interface-hero__badge,
      .about-hero__badge {
        position: static;
        align-self: flex-start;
        margin-top: 0.35rem;
      }
      .payments-catalog {
        grid-template-columns: 1fr;
      }
      .payments-config-bar {
        flex-direction: column;
        align-items: stretch;
      }
      .payments-config-bar__lead {
        flex-basis: auto;
      }
      .payments-config-bar__checks {
        justify-content: flex-start;
      }
      .payments-config-bar__check {
        min-width: 0;
        max-width: none;
        width: 100%;
      }
      .payments-config-bar__btn {
        align-self: flex-start;
      }
      .settings-footer--station,
      .settings-footer--payments,
      .settings-footer--rules,
      .settings-footer--printing,
      .settings-footer--interface,
      .settings-footer--about {
        grid-template-columns: 1fr;
      }
      .settings-footer--station .settings-footer__save,
      .settings-footer--payments .settings-footer__save,
      .settings-footer--rules .settings-footer__save,
      .settings-footer--printing .settings-footer__save,
      .settings-footer--interface .settings-footer__save,
      .settings-footer--about .settings-footer__save {
        order: 3;
        width: 100%;
        justify-content: center;
      }
      .settings-footer--station .settings-footer__pending {
        order: 2;
      }
      .station-board {
        grid-template-columns: 1fr;
        grid-template-rows: auto;
      }
      .station-card--ident,
      .station-card--efactura,
      .station-card--experience,
      .station-card--upsell,
      .station-card--pricing {
        grid-column: auto;
        grid-row: auto;
      }
      .integration-catalog {
        grid-template-columns: 1fr;
      }
      .integration-modal {
        width: calc(100vw - 1rem);
        max-height: calc(100vh - 1rem);
        padding: 0.7rem;
      }
      .integration-modal__head {
        flex-direction: column;
        margin: -0.7rem -0.7rem 0;
        padding: 0.7rem;
      }
      .card-grid,
      .info-grid {
        grid-template-columns: 1fr;
      }
      .info-grid--stats {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .stripe-grid,
      .kushki-plan,
      .kushki-hosted-grid,
      .system-details__grid,
      .learned-panel {
        flex-direction: column;
        align-items: stretch;
      }
      .settings-body--split,
      .rules-board {
        grid-template-columns: 1fr;
      }
      .rules-field-grid,
      .printing-field-grid,
      .interface-field-grid {
        grid-template-columns: 1fr;
      }
      .learned-panel__art {
        width: 100%;
        min-width: 0;
        justify-content: center;
      }
      .learned-panel__img {
        max-width: 11rem;
      }
      .settings-promo {
        order: -1;
      }
      .settings-footer__save {
        width: 100%;
        margin-left: 0;
        justify-content: center;
      }
      .settings-footer__reset {
        width: 100%;
        justify-content: center;
      }
    }
  `,
})
export class PosAjustesPage implements OnInit {
  readonly prefs = inject(PosLayoutPreferencesService);
  private readonly api = inject(PosBackendApiService);
  readonly auth = inject(PosAuthService);
  private readonly runtimeConfig = inject(PosConfigService);

  readonly invoicingProvider = signal('NONE');
  readonly invoicingPending = signal(0);
  readonly invoicingCustomUrl = signal('');
  readonly invoicingCustomAuth = signal('API_KEY');
  readonly invoicingCustomApiKey = signal('');
  readonly invoicingStatus = signal('');

  readonly activeTab = signal<SettingsTab>('business');
  readonly selectedPaymentIntegration = signal<PaymentIntegrationId>('terminal');
  readonly paymentIntegrationModalOpen = signal(false);
  readonly puntos = signal<PosPuntoEmisionOption[]>([]);
  readonly puntosError = signal<string | null>(null);
  readonly appVersion = '1.0.0';
  readonly efacturaUiOrigin = environment.efacturaUiOrigin;
  readonly settingsSaveMsg = signal('');
  readonly stationDirty = signal(false);
  readonly stationLastSavedAt = signal<number | null>(null);
  private readonly sessionStartedAt = Date.now();
  readonly stripeLoading = signal(false);
  readonly stripeSaving = signal(false);
  readonly stripeCreating = signal(false);
  readonly stripeStatus = signal('');
  readonly stripeEnabled = signal(false);
  readonly stripeSecretKey = signal('');
  readonly stripeSecretConfigured = signal(false);
  readonly stripePublishableKey = signal('');
  readonly stripeStarterPriceId = signal('');
  readonly stripeExtraPrices = signal('');
  readonly stripeSuccessUrl = signal('');
  readonly stripeCancelUrl = signal('');
  readonly stripeAutomaticTax = signal(false);
  readonly stripePromotionCodes = signal(false);
  readonly stripeConfigured = signal(false);
  readonly stripePlanCode = signal('starter');
  readonly kushkiLoading = signal(false);
  readonly kushkiSaving = signal(false);
  readonly kushkiTokenizing = signal(false);
  readonly kushkiCreatingSubscription = signal(false);
  readonly kushkiStatus = signal('');
  readonly kushkiEnabled = signal(false);
  readonly kushkiPublicMerchantId = signal('');
  readonly kushkiPrivateMerchantId = signal('');
  readonly kushkiPrivateConfigured = signal(false);
  readonly kushkiBaseUrl = signal('');
  readonly kushkiTestEnvironment = signal(true);
  readonly kushkiConfigured = signal(false);
  readonly kushkiPlans = signal<KushkiSubscriptionPlan[]>([this.blankKushkiPlan()]);
  readonly kushkiSubscriptionPlanCode = signal('starter');
  readonly kushkiStartDate = signal(this.todayIsoDate());
  readonly kushkiDocumentType = signal('CI');
  readonly kushkiDocumentNumber = signal('');
  readonly kushkiFirstName = signal('');
  readonly kushkiLastName = signal('');
  readonly kushkiEmail = signal('');
  readonly kushkiPhone = signal('');
  private kushkiHostedCard: any = null;
  private kushkiSubscriptionSubmitted = false;
  readonly payPhoneLoading = signal(false);
  readonly payPhoneSaving = signal(false);
  readonly payPhoneCreatingSale = signal(false);
  readonly payPhoneCheckingStatus = signal(false);
  readonly payPhoneStatus = signal('');
  readonly payPhoneEnabled = signal(false);
  readonly payPhoneToken = signal('');
  readonly payPhoneTokenConfigured = signal(false);
  readonly payPhoneStoreId = signal('');
  readonly payPhoneBaseUrl = signal('');
  readonly payPhoneCurrency = signal('USD');
  readonly payPhoneTimeZone = signal('America/Guayaquil');
  readonly payPhoneResponseUrl = signal('');
  readonly payPhoneConfigured = signal(false);
  readonly payPhonePhoneNumber = signal('');
  readonly payPhoneCountryCode = signal('593');
  readonly payPhoneAmountWithoutTax = signal('0');
  readonly payPhoneAmountWithTax = signal('0');
  readonly payPhoneTax = signal('0');
  readonly payPhoneService = signal('0');
  readonly payPhoneTip = signal('0');
  readonly payPhoneReference = signal('Pago POS');
  readonly payPhoneClientTransactionId = signal('');
  readonly payPhoneClientUserId = signal('');
  readonly payPhoneOptional1 = signal('');
  readonly payPhoneOptional2 = signal('');
  readonly payPhoneOptional3 = signal('');
  readonly payPhoneTransactionId = signal('');
  private payPhoneLastStatusCheckAt = 0;

  readonly stripeConfigLabel = computed(() => {
    if (this.stripeLoading()) {
      return 'Cargando configuracion...';
    }
    if (!this.stripeEnabled()) {
      return 'Stripe deshabilitado';
    }
    return this.stripeConfigured() ? 'Configurado' : 'No configurado';
  });

  readonly kushkiConfigLabel = computed(() => {
    if (this.kushkiLoading()) {
      return 'Cargando configuracion...';
    }
    if (!this.kushkiEnabled()) {
      return 'Kushki deshabilitado';
    }
    return this.kushkiConfigured() ? 'Configurado' : 'No configurado';
  });

  readonly payPhoneConfigLabel = computed(() => {
    if (this.payPhoneLoading()) {
      return 'Cargando configuracion...';
    }
    if (!this.payPhoneEnabled()) {
      return 'PayPhone deshabilitado';
    }
    return this.payPhoneConfigured() ? 'Configurado' : 'No configurado';
  });

  readonly payPhoneAmountView = computed(() => this.centsToUsd(this.payPhoneAmountCents()));
  readonly selectedPaymentIntegrationCard = computed(() => {
    const cards = this.paymentIntegrationCards();
    return cards.find((item) => item.id === this.selectedPaymentIntegration()) ?? cards[0];
  });

  readonly paymentIntegrationCards = computed(() => [
    {
      id: 'terminal' as const,
      name: 'Terminal y reglas de cobro',
      shortName: 'POS',
      description: 'Canal principal, terminal asociado y datos esperados para conciliacion.',
      state: 'Base',
      capabilities: ['Terminal', 'QR', 'Manual'],
    },
    {
      id: 'stripe' as const,
      name: 'Stripe',
      shortName: 'ST',
      description: 'Checkout y credenciales por empresa para cobros digitales.',
      state: this.integrationState(this.stripeEnabled(), this.stripeConfigured(), this.stripeStatus()),
      capabilities: ['Tarjeta', 'Checkout', 'Link'],
    },
    {
      id: 'kushki' as const,
      name: 'Kushki',
      shortName: 'KU',
      description: 'Hosted Fields y tokenizacion de tarjetas por tenant.',
      state: this.integrationState(this.kushkiEnabled(), this.kushkiConfigured(), this.kushkiStatus()),
      capabilities: ['Tarjeta', 'Hosted', 'Token'],
    },
    {
      id: 'payphone' as const,
      name: 'PayPhone',
      shortName: 'PF',
      description: 'API Sale, cobro por telefono y consulta de estado.',
      state: this.integrationState(this.payPhoneEnabled(), this.payPhoneConfigured(), this.payPhoneStatus()),
      capabilities: ['Sale API', 'Movil', 'Estado'],
    },
    {
      id: 'manual' as const,
      name: 'Registro manual',
      shortName: 'MN',
      description: 'Voucher externo o autorizacion manual para contingencias.',
      state: 'Disponible',
      capabilities: ['Voucher', 'Fallback'],
    },
  ]);

  paymentActiveProvidersCount(): number {
    return this.paymentIntegrationCards().filter((item) => this.paymentProviderStatusLabel(item) === 'Activo').length;
  }

  paymentTerminalsCount(): number {
    const terminalLinked = this.prefs.cardTerminalId().trim() ? 1 : 0;
    const stationLinked = this.prefs.cajaId().trim() ? 1 : 0;
    return Math.max(1, terminalLinked + stationLinked);
  }

  paymentTerminalLinkedLabel(): string {
    const count = this.paymentTerminalsCount();
    if (count === 1) {
      return '1 terminal vinculada a esta caja';
    }
    return `${count} terminales vinculadas a esta caja`;
  }

  rulesDocumentStatValue(): string {
    const doc = this.prefs.defaultDocumentType().trim().toLowerCase();
    if (doc === 'factura') return 'Factura';
    if (doc === 'preguntar') return 'Preguntar';
    return 'Nota de venta';
  }

  rulesDocumentStatHint(): string {
    const doc = this.prefs.defaultDocumentType().trim().toLowerCase();
    if (doc === 'preguntar') return 'Al cobrar';
    return 'Predeterminado';
  }

  rulesDiscountStatValue(): string {
    const raw = this.prefs.maxDiscountPercent().trim();
    const value = Number(raw);
    if (!raw || Number.isNaN(value)) return '—';
    return `${value}%`;
  }

  rulesDiscountStatHint(): string {
    const raw = this.prefs.maxDiscountPercent().trim();
    const value = Number(raw);
    if (!raw || Number.isNaN(value) || value <= 0) return 'Sin límite';
    return 'Permitido';
  }

  rulesCustomerStatValue(): string {
    const raw = this.prefs.requireCustomerOver().trim();
    const value = Number(raw);
    if (!raw || Number.isNaN(value) || value <= 0) return 'No aplica';
    return `>$${value}`;
  }

  rulesCustomerStatHint(): string {
    const raw = this.prefs.requireCustomerOver().trim();
    const value = Number(raw);
    if (!raw || Number.isNaN(value) || value <= 0) return 'Sin umbral';
    return 'Umbral establecido';
  }

  printingAssignedPrintersCount(): number {
    let count = 0;
    if (this.prefs.receiptPrinter().trim()) count++;
    if (this.prefs.labelPrinter().trim()) count++;
    return count;
  }

  printingPrintersStatValue(): string {
    return String(this.printingAssignedPrintersCount());
  }

  printingPrintersStatHint(): string {
    const count = this.printingAssignedPrintersCount();
    if (count === 0) return 'Sin asignar';
    if (count === 1) return 'Asignada';
    return 'Asignadas';
  }

  printingLabelFormatStatValue(): string {
    return '1';
  }

  printingLabelFormatStatHint(): string {
    return this.prefs.labelFormat().trim() ? 'Activo' : 'Sin formato';
  }

  printingCashDrawerAssigned(): boolean {
    return this.prefs.openDrawerAfterCash() && !!this.prefs.receiptPrinter().trim();
  }

  printingCashDrawerStatValue(): string {
    return this.printingCashDrawerAssigned() ? '1' : '0';
  }

  printingCashDrawerStatHint(): string {
    return this.printingCashDrawerAssigned() ? 'Asignado' : 'Sin asignar';
  }

  interfaceThemeStatValue(): string {
    return this.prefs.theme() === 'dark' ? 'Nocturno' : 'Claro';
  }

  interfaceThemeStatHint(): string {
    return this.prefs.theme() === 'dark' ? 'Visual oscuro' : 'Visual claro';
  }

  interfaceHandednessStatValue(): string {
    return this.prefs.handedness() === 'left' ? 'Zurdo' : 'Diestro';
  }

  interfaceHandednessStatHint(): string {
    return 'Orientación activa';
  }

  interfaceDensityStatValue(): string {
    const density = this.prefs.resolveEffectiveDensity();
    if (density === 'touch') return 'Táctil';
    if (density === 'compact') return 'Compacta';
    return 'Cómoda';
  }

  interfaceDensityStatHint(): string {
    return 'Espaciado óptimo';
  }

  paymentMethodsCount(): number {
    return this.paymentIntegrationCards().length;
  }

  paymentProviderIsDisabled(item: { state: string }): boolean {
    return item.state === 'Deshabilitado';
  }

  paymentProviderBadge(item: { id: PaymentIntegrationId; state: string }): string {
    if (item.id === 'terminal') {
      return 'Base';
    }
    if (item.state === 'Deshabilitado') {
      return 'Deshabilitado';
    }
    if (item.id === 'manual') {
      return 'Disponible';
    }
    if (item.state === 'Activo') {
      return 'Activo';
    }
    return item.state;
  }

  paymentProviderStatusLabel(item: { id: PaymentIntegrationId; state: string }): string {
    if (item.id === 'terminal') {
      return 'Activo';
    }
    if (item.state === 'Deshabilitado') {
      return 'Deshabilitado';
    }
    if (item.id === 'manual' || item.state === 'Disponible' || item.state === 'No configurado') {
      return 'Disponible';
    }
    if (item.state === 'Activo') {
      return 'Activo';
    }
    return item.state;
  }

  paymentProviderStatusTone(item: { id: PaymentIntegrationId; state: string }): 'ok' | 'muted' | 'info' {
    const label = this.paymentProviderStatusLabel(item);
    if (label === 'Activo') {
      return 'ok';
    }
    if (label === 'Deshabilitado') {
      return 'muted';
    }
    return 'info';
  }

  readonly canManageBusinessRules = computed(() => {
    const payload = decodeJwtPayload(this.auth.accessToken() ?? '');
    const rolesRaw = typeof payload?.['roles'] === 'string' ? payload['roles'] : '';
    const roles = rolesRaw
      .split(',')
      .map((r) => r.trim().toUpperCase())
      .filter(Boolean);
    return roles.some((r) => ['ADMIN', 'SUITE_ADMIN', 'POS_ADMIN'].includes(r));
  });

  readonly activeTabMeta = computed(() => this.tabs.find((tab) => tab.id === this.activeTab()) ?? this.tabs[0]);

  readonly tabs: { id: SettingsTab; label: string; desc: string; longDesc: string; badge: string }[] = [
    {
      id: 'business',
      label: 'Reglas',
      desc: 'Políticas globales',
      longDesc: 'Controles de administración que afectan a todas las cajas: documentos, límites y reglas de venta.',
      badge: 'Global',
    },
    {
      id: 'station',
      label: 'Caja',
      desc: 'Preferencias locales',
      longDesc: 'Preferencias de este equipo: caja, punto de emisión, sonidos y comportamiento del escáner.',
      badge: 'Por estación',
    },
    {
      id: 'payments',
      label: 'Cobros',
      desc: 'Tarjeta y QR',
      longDesc: 'Proveedor de tarjeta, terminal asociado y comportamiento de link/QR para esta caja.',
      badge: 'Pagos',
    },
    {
      id: 'printing',
      label: 'Impresión',
      desc: 'Recibos y etiquetas',
      longDesc: 'Asignación de impresoras, recibos automáticos, etiquetas y cajón de dinero por terminal.',
      badge: 'Hardware',
    },
    {
      id: 'interface',
      label: 'Interfaz',
      desc: 'Tema y densidad',
      longDesc: 'Ajustes de visualización para operación táctil o compacta, tema claro/nocturno y catálogo.',
      badge: 'UX',
    },
    {
      id: 'about',
      label: 'Información',
      desc: 'Versión y estado',
      longDesc: 'Información de versión, estado de integración y criterios usados para estructurar el POS.',
      badge: 'Sistema',
    },
  ];

  apiVersionLabel(): string {
    return 'v2.3.1';
  }

  apiConnectedLabel(): string {
    return this.auth.apiBaseUrl?.trim() ? 'Conectado' : 'Sin API';
  }

  systemHealthLabel(): string {
    return this.auth.apiBaseUrl?.trim() ? 'Óptimo' : 'Revisar';
  }

  deploymentEnvLabel(): string {
    return environment.production ? 'Producción' : 'Desarrollo';
  }

  lastRestartLabel(): string {
    return new Intl.DateTimeFormat('es-EC', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(this.sessionStartedAt));
  }

  guardarCambios(): void {
    this.prefs.bumpDocumentDensity();
    this.stationDirty.set(false);
    this.stationLastSavedAt.set(Date.now());
    this.settingsSaveMsg.set('Cambios guardados correctamente en esta estación.');
  }

  stationIsConfigured(): boolean {
    const caja = this.prefs.cajaId().trim();
    if (!caja) return false;
    if (this.puntos().length > 0) {
      return !!this.prefs.puntoEmisionId().trim();
    }
    return !!this.prefs.localBranchCode().trim() && !!this.prefs.localEmissionCode().trim();
  }

  stationStatusLabel(): string {
    return this.stationIsConfigured() ? 'Configurada' : 'Pendiente';
  }

  stationLastUpdateLabel(): string {
    const savedAt = this.stationLastSavedAt();
    if (!savedAt) return 'sin guardar aún';
    const minutes = Math.floor((Date.now() - savedAt) / 60_000);
    if (minutes < 1) return 'hace unos momentos';
    if (minutes < 60) return `hace ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `hace ${hours} h`;
    const days = Math.floor(hours / 24);
    return `hace ${days} día${days === 1 ? '' : 's'}`;
  }

  efacturaIntegrationReady(): boolean {
    if (this.puntos().length > 0) {
      return !!this.prefs.puntoEmisionId().trim();
    }
    return !!this.prefs.localBranchCode().trim() && !!this.prefs.localEmissionCode().trim();
  }

  openBusinessTab(): void {
    this.activeTab.set('business');
  }

  private markStationDirty(): void {
    this.stationDirty.set(true);
    this.settingsSaveMsg.set('');
  }

  onStationSoundToggle(): void {
    this.prefs.setSound(!this.prefs.soundOn());
    this.markStationDirty();
  }

  onStationScanToggle(): void {
    this.prefs.setScanAutoAdd(!this.prefs.scanAutoAdd());
    this.markStationDirty();
  }

  onStationSeparateLinesToggle(): void {
    this.prefs.setSeparateSameProductLines(!this.prefs.separateSameProductLines());
    this.markStationDirty();
  }

  onStationUpsellToggle(): void {
    this.prefs.setUpsell(!this.prefs.upsellOn());
    this.markStationDirty();
  }

  onStationPriceListToggle(): void {
    this.prefs.setAllowManualPriceListSelection(!this.prefs.allowManualPriceListSelection());
    this.markStationDirty();
  }

  restablecerConfiguracion(): void {
    const keys = Object.keys(localStorage).filter(
      (key) => key.startsWith('pos_ui_') || key === 'lux_ui_theme' || key === 'pos_ui_theme',
    );
    keys.forEach((key) => localStorage.removeItem(key));
    this.prefs.hydrateFromStorage();
    this.prefs.applyDocumentAttributes();
    this.prefs.bumpDocumentDensity();
    this.stationDirty.set(false);
    this.stationLastSavedAt.set(null);
    this.settingsSaveMsg.set('Configuración restablecida a valores por defecto.');
  }

  saveInvoicingConfig(): void {
    const body: PosInvoicingConfigRequest = {
      customBaseUrl: this.invoicingCustomUrl().trim() || null,
      customAuthType: this.invoicingCustomAuth(),
      customApiKey: this.invoicingCustomApiKey().trim() || null,
    };
    this.api.putInvoicingConfig(body).subscribe({
      next: () => this.invoicingStatus.set('Integración guardada'),
      error: () => this.invoicingStatus.set('No se pudo guardar la integración'),
    });
  }

  retryInvoicingPending(): void {
    this.api.retryInvoicingPending().subscribe({
      next: (r) => {
        this.invoicingPending.set(r.pendingExternal ?? 0);
        this.invoicingStatus.set('Reintento de emisión solicitado');
      },
      error: () => this.invoicingStatus.set('No se pudo reintentar la emisión'),
    });
  }

  ngOnInit(): void {
    if (!this.auth.apiBaseUrl.trim()) {
      return;
    }
    void this.runtimeConfig.ensureLoaded().then((cfg) => {
      this.invoicingProvider.set(cfg.invoicingProvider);
      if (cfg.invoicingEnabled) {
        this.api.getInvoicingPending().subscribe({
          next: (r) => this.invoicingPending.set(r.pendingExternal ?? 0),
        });
        if (cfg.invoicingProvider === 'CUSTOM') {
          this.api.getInvoicingConfig().subscribe({
            next: (c) => {
              this.invoicingCustomUrl.set(c.customBaseUrl ?? '');
              this.invoicingCustomAuth.set(c.customAuthType ?? 'API_KEY');
            },
          });
        }
      }
      if (cfg.invoicingEnabled) {
        this.api.getPuntosEmision().subscribe({
          next: (list) => {
            this.puntos.set(list ?? []);
            this.puntosError.set(null);
          },
          error: () => {
            this.puntos.set([]);
            this.puntosError.set('No se pudieron cargar los puntos de eFactura. Puede operar con sucursal/emision local.');
          },
        });
      }
    });
    this.loadStripeConfig();
    this.loadKushkiConfig();
    this.loadPayPhoneConfig();
  }

  saveStripeConfig(): void {
    this.stripeSaving.set(true);
    const prices = this.parseExtraPrices(this.stripeExtraPrices());
    const starter = this.stripeStarterPriceId().trim();
    if (starter) {
      prices['starter'] = starter;
    }
    this.api
      .putStripeConfig({
        enabled: this.stripeEnabled(),
        secretKey: this.stripeSecretKey().trim() || null,
        publishableKey: this.stripePublishableKey().trim() || null,
        starterPriceId: starter || null,
        subscriptionPrices: prices,
        successUrl: this.stripeSuccessUrl().trim() || null,
        cancelUrl: this.stripeCancelUrl().trim() || null,
        automaticTaxEnabled: this.stripeAutomaticTax(),
        allowPromotionCodes: this.stripePromotionCodes(),
      })
      .pipe(finalize(() => this.stripeSaving.set(false)))
      .subscribe({
        next: (cfg) => {
          this.stripeSecretKey.set('');
          this.applyStripeConfig(cfg);
          this.stripeStatus.set(
            cfg.configured
              ? 'Stripe configurado correctamente.'
              : 'Configuracion guardada, pero faltan datos para operar.',
          );
        },
        error: (err: unknown) => this.stripeStatus.set(this.errorMessage(err)),
      });
  }

  createStripeSubscription(): void {
    const planCode = this.stripePlanCode().trim() || 'starter';
    this.stripeCreating.set(true);
    this.api
      .postStripeSubscriptionCheckout({ planCode }, this.idempotencyKey())
      .pipe(finalize(() => this.stripeCreating.set(false)))
      .subscribe({
        next: (r) => {
          this.stripeStatus.set('Sesion creada correctamente. Redirigiendo a Stripe...');
          window.location.href = r.url;
        },
        error: (err: unknown) => this.stripeStatus.set(this.errorMessage(err)),
      });
  }

  loadStripeConfig(): void {
    if (!this.auth.apiBaseUrl.trim()) {
      this.stripeStatus.set('API POS no configurada.');
      return;
    }
    this.stripeLoading.set(true);
    this.api
      .getStripeConfig()
      .pipe(finalize(() => this.stripeLoading.set(false)))
      .subscribe({
        next: (cfg) => {
          this.applyStripeConfig(cfg);
          this.stripeStatus.set(
            cfg.configured ? 'Configuracion Stripe cargada.' : 'Stripe no configurado para esta empresa.',
          );
        },
        error: (err: unknown) => this.stripeStatus.set(this.errorMessage(err)),
      });
  }

  loadKushkiConfig(): void {
    if (!this.auth.apiBaseUrl.trim()) {
      this.kushkiStatus.set('API POS no configurada.');
      return;
    }
    this.kushkiLoading.set(true);
    this.api
      .getKushkiConfig()
      .pipe(finalize(() => this.kushkiLoading.set(false)))
      .subscribe({
        next: (cfg) => {
          this.applyKushkiConfig(cfg);
          this.kushkiStatus.set(cfg.configured ? 'Configuracion Kushki cargada.' : 'Kushki no configurado para esta empresa.');
        },
        error: (err: unknown) => this.kushkiStatus.set(this.errorMessage(err, 'Kushki')),
      });
  }

  saveKushkiConfig(): void {
    this.kushkiSaving.set(true);
    this.api
      .putKushkiConfig({
        enabled: this.kushkiEnabled(),
        publicMerchantId: this.kushkiPublicMerchantId().trim() || null,
        privateMerchantId: this.kushkiPrivateMerchantId().trim() || null,
        baseUrl: this.kushkiBaseUrl().trim() || null,
        testEnvironment: this.kushkiTestEnvironment(),
        subscriptionPlans: this.normalizedKushkiPlans(),
      })
      .pipe(finalize(() => this.kushkiSaving.set(false)))
      .subscribe({
        next: (cfg) => {
          this.kushkiPrivateMerchantId.set('');
          this.applyKushkiConfig(cfg);
          this.kushkiStatus.set(
            cfg.configured
              ? 'Kushki configurado correctamente.'
              : 'Configuracion guardada, pero faltan datos para operar.',
          );
        },
        error: (err: unknown) => this.kushkiStatus.set(this.errorMessage(err, 'Kushki')),
      });
  }

  addKushkiPlan(): void {
    this.kushkiPlans.update((plans) => [...plans, this.blankKushkiPlan(`plan-${plans.length + 1}`)]);
  }

  removeKushkiPlan(index: number): void {
    this.kushkiPlans.update((plans) => {
      const next = plans.filter((_, i) => i !== index);
      return next.length ? next : [this.blankKushkiPlan()];
    });
  }

  updateKushkiPlan(index: number, field: KushkiPlanField, value: string | number): void {
    this.kushkiPlans.update((plans) =>
      plans.map((plan, i) => {
        if (i !== index) {
          return plan;
        }
        if (['subtotalIva', 'subtotalIva0', 'ice', 'iva'].includes(field)) {
          return { ...plan, [field]: this.numberValue(value) };
        }
        if (field === 'currency') {
          return { ...plan, currency: String(value).trim().toUpperCase().slice(0, 3) || 'USD' };
        }
        return { ...plan, [field]: String(value) };
      }),
    );
  }

  canCreateKushkiSubscription(): boolean {
    return (
      this.kushkiConfigured() &&
      !this.kushkiTokenizing() &&
      !this.kushkiCreatingSubscription() &&
      !this.kushkiSubscriptionSubmitted &&
      !!this.kushkiSubscriptionPlanCode().trim() &&
      !!this.kushkiStartDate().trim() &&
      !!this.kushkiDocumentNumber().trim() &&
      !!this.kushkiFirstName().trim() &&
      !!this.kushkiLastName().trim() &&
      !!this.kushkiEmail().trim() &&
      !!this.kushkiPhone().trim()
    );
  }

  async initKushkiHostedFields(): Promise<void> {
    try {
      if (!this.kushkiConfigured()) {
        this.kushkiStatus.set('Kushki no configurado o deshabilitado.');
        return;
      }
      this.kushkiStatus.set('Inicializando campos seguros de Kushki...');
      await this.loadKushkiScripts();
      const plan = this.selectedKushkiPlan();
      this.kushkiHostedCard = await this.createKushkiHostedCard(plan);
      this.kushkiStatus.set('Campos seguros listos para tokenizar.');
    } catch (err: unknown) {
      this.kushkiHostedCard = null;
      this.kushkiStatus.set(this.errorMessage(err, 'Kushki'));
    }
  }

  async createKushkiSubscription(): Promise<void> {
    if (!this.canCreateKushkiSubscription()) {
      return;
    }
    this.kushkiSubscriptionSubmitted = true;
    this.kushkiTokenizing.set(true);
    try {
      if (!this.kushkiHostedCard) {
        await this.initKushkiHostedFields();
      }
      const token = await this.requestKushkiToken();
      this.kushkiTokenizing.set(false);
      this.kushkiCreatingSubscription.set(true);
      this.api
        .postKushkiSubscription(
          {
            token,
            planCode: this.kushkiSubscriptionPlanCode().trim(),
            startDate: this.kushkiStartDate(),
            contactDetails: {
              documentType: this.kushkiDocumentType(),
              documentNumber: this.kushkiDocumentNumber().trim(),
              firstName: this.kushkiFirstName().trim(),
              lastName: this.kushkiLastName().trim(),
              email: this.kushkiEmail().trim(),
              phoneNumber: this.kushkiPhone().trim(),
            },
            metadata: {},
          },
          this.idempotencyKey(),
        )
        .pipe(
          finalize(() => {
            this.kushkiCreatingSubscription.set(false);
          }),
        )
        .subscribe({
          next: (r) => {
            this.kushkiStatus.set(`Suscripcion creada correctamente${r.status ? `: ${r.status}` : ''}.`);
          },
          error: (err: unknown) => {
            this.kushkiSubscriptionSubmitted = false;
            this.kushkiStatus.set(this.errorMessage(err, 'Kushki'));
          },
        });
    } catch (err: unknown) {
      this.kushkiSubscriptionSubmitted = false;
      this.kushkiTokenizing.set(false);
      this.kushkiCreatingSubscription.set(false);
      this.kushkiStatus.set(this.errorMessage(err, 'Kushki'));
    }
  }

  loadPayPhoneConfig(): void {
    if (!this.auth.apiBaseUrl.trim()) {
      this.payPhoneStatus.set('API POS no configurada.');
      return;
    }
    this.payPhoneLoading.set(true);
    this.api
      .getPayPhoneConfig()
      .pipe(finalize(() => this.payPhoneLoading.set(false)))
      .subscribe({
        next: (cfg) => {
          this.applyPayPhoneConfig(cfg);
          this.payPhoneStatus.set(cfg.configured ? 'Configuracion PayPhone cargada.' : 'PayPhone no configurado para esta empresa.');
        },
        error: (err: unknown) => this.payPhoneStatus.set(this.errorMessage(err, 'PayPhone')),
      });
  }

  savePayPhoneConfig(): void {
    this.payPhoneSaving.set(true);
    this.api
      .putPayPhoneConfig({
        enabled: this.payPhoneEnabled(),
        token: this.payPhoneToken().trim() || null,
        storeId: this.payPhoneStoreId().trim() || null,
        baseUrl: this.payPhoneBaseUrl().trim() || null,
        currency: this.payPhoneCurrency().trim().toUpperCase() || 'USD',
        timeZone: this.payPhoneTimeZone().trim() || 'America/Guayaquil',
        responseUrl: this.payPhoneResponseUrl().trim() || null,
      })
      .pipe(finalize(() => this.payPhoneSaving.set(false)))
      .subscribe({
        next: (cfg) => {
          this.payPhoneToken.set('');
          this.applyPayPhoneConfig(cfg);
          this.payPhoneStatus.set(
            cfg.configured
              ? 'PayPhone configurado correctamente.'
              : 'Configuracion guardada, pero faltan datos para operar.',
          );
        },
        error: (err: unknown) => this.payPhoneStatus.set(this.errorMessage(err, 'PayPhone')),
      });
  }

  canCreatePayPhoneSale(): boolean {
    return (
      this.payPhoneConfigured() &&
      !this.payPhoneCreatingSale() &&
      !!this.payPhonePhoneNumber().trim() &&
      !!this.payPhoneCountryCode().trim() &&
      !!this.payPhoneReference().trim() &&
      this.payPhoneAmountCents() > 0
    );
  }

  createPayPhoneSale(): void {
    if (!this.canCreatePayPhoneSale()) {
      return;
    }
    this.payPhoneCreatingSale.set(true);
    this.payPhoneStatus.set('Creando cobro PayPhone...');
    this.api
      .postPayPhoneSale(
        {
          phoneNumber: this.payPhonePhoneNumber().trim(),
          countryCode: this.payPhoneCountryCode().trim(),
          amount: this.payPhoneAmountCents(),
          amountWithoutTax: this.usdInputToCents(this.payPhoneAmountWithoutTax()),
          amountWithTax: this.usdInputToCents(this.payPhoneAmountWithTax()),
          tax: this.usdInputToCents(this.payPhoneTax()),
          service: this.usdInputToCents(this.payPhoneService()),
          tip: this.usdInputToCents(this.payPhoneTip()),
          reference: this.payPhoneReference().trim(),
          clientTransactionId: this.payPhoneClientTransactionId().trim() || null,
          clientUserId: this.payPhoneClientUserId().trim() || null,
          optionalParameter1: this.payPhoneOptional1().trim() || null,
          optionalParameter2: this.payPhoneOptional2().trim() || null,
          optionalParameter3: this.payPhoneOptional3().trim() || null,
        },
        this.idempotencyKey(),
      )
      .pipe(finalize(() => this.payPhoneCreatingSale.set(false)))
      .subscribe({
        next: (r) => {
          this.applyPayPhoneSaleResponse(r);
          this.payPhoneStatus.set(`Cobro creado${r.status ? `: ${r.status}` : ''}.`);
        },
        error: (err: unknown) => this.payPhoneStatus.set(this.errorMessage(err, 'PayPhone')),
      });
  }

  canCheckPayPhoneStatus(): boolean {
    const hasId = !!this.payPhoneTransactionId().trim() || !!this.payPhoneClientTransactionId().trim();
    return hasId && !this.payPhoneCheckingStatus() && Date.now() - this.payPhoneLastStatusCheckAt >= 10_000;
  }

  checkPayPhoneStatus(): void {
    if (!this.canCheckPayPhoneStatus()) {
      this.payPhoneStatus.set('Espere unos segundos antes de consultar nuevamente.');
      return;
    }
    this.payPhoneLastStatusCheckAt = Date.now();
    this.payPhoneCheckingStatus.set(true);
    const transactionId = this.payPhoneTransactionId().trim();
    const req = transactionId
      ? this.api.getPayPhoneSaleStatus(transactionId)
      : this.api.getPayPhoneSaleStatusByClientTransactionId(this.payPhoneClientTransactionId().trim());
    req.pipe(finalize(() => this.payPhoneCheckingStatus.set(false))).subscribe({
      next: (r) => {
        this.applyPayPhoneStatusResponse(r);
        this.payPhoneStatus.set(`Estado PayPhone${r.status ? `: ${r.status}` : ' recibido'}.`);
      },
      error: (err: unknown) => this.payPhoneStatus.set(this.errorMessage(err, 'PayPhone')),
    });
  }

  setTheme(t: PosTheme): void {
    this.prefs.setTheme(t);
  }

  onCaja(v: string): void {
    this.prefs.setCajaId(v);
    this.markStationDirty();
  }

  onPuntoEmision(v: string): void {
    this.prefs.setPuntoEmisionId(v);
    this.markStationDirty();
  }

  onLocalBranch(v: string): void {
    this.prefs.setLocalBranchCode(this.cleanThreeDigitCode(v));
    this.markStationDirty();
  }

  onLocalEmission(v: string): void {
    this.prefs.setLocalEmissionCode(this.cleanThreeDigitCode(v));
    this.markStationDirty();
  }

  private cleanThreeDigitCode(value: string): string {
    const digits = String(value ?? '').replace(/\D/g, '').slice(0, 3);
    return digits ? digits.padStart(3, '0') : '001';
  }

  onDensitySrc(v: PosDensitySource): void {
    this.prefs.setDensitySource(v);
  }

  onDensityManual(v: PosDensity): void {
    this.prefs.setDensityManual(v);
  }

  onRole(v: PosRoleProfile): void {
    this.prefs.setRoleProfile(v);
  }

  onHandedness(v: PosHandedness): void {
    this.prefs.setHandedness(v);
  }

  onCardProvider(v: PosCardProvider): void {
    this.prefs.setCardProvider(v);
  }

  openPaymentIntegration(id: PaymentIntegrationId): void {
    this.selectedPaymentIntegration.set(id);
    this.paymentIntegrationModalOpen.set(true);
  }

  closePaymentIntegrationModal(): void {
    this.paymentIntegrationModalOpen.set(false);
  }

  private applyStripeConfig(cfg: StripeTenantConfigResponse): void {
    const prices = cfg.subscriptionPrices ?? {};
    this.stripeEnabled.set(cfg.enabled);
    this.stripeSecretConfigured.set(cfg.secretConfigured);
    this.stripePublishableKey.set(cfg.publishableKey ?? '');
    this.stripeStarterPriceId.set(prices['starter'] ?? '');
    this.stripeExtraPrices.set(this.formatExtraPrices(prices));
    this.stripeSuccessUrl.set(cfg.successUrl ?? '');
    this.stripeCancelUrl.set(cfg.cancelUrl ?? '');
    this.stripeAutomaticTax.set(cfg.automaticTaxEnabled);
    this.stripePromotionCodes.set(cfg.allowPromotionCodes);
    this.stripeConfigured.set(cfg.configured);
  }

  private integrationState(enabled: boolean, configured: boolean, status: string): string {
    if (/error|no se pudo|rechaz|fall/i.test(status)) {
      return 'Error';
    }
    if (!enabled) {
      return 'Deshabilitado';
    }
    return configured ? 'Activo' : 'No configurado';
  }

  private applyKushkiConfig(cfg: KushkiTenantConfigResponse): void {
    const plans = cfg.subscriptionPlans?.length ? cfg.subscriptionPlans : [this.blankKushkiPlan()];
    this.kushkiEnabled.set(cfg.enabled);
    this.kushkiPublicMerchantId.set(cfg.publicMerchantId ?? '');
    this.kushkiPrivateMerchantId.set('');
    this.kushkiPrivateConfigured.set(cfg.privateMerchantConfigured);
    this.kushkiBaseUrl.set(cfg.baseUrl ?? '');
    this.kushkiTestEnvironment.set(cfg.testEnvironment);
    this.kushkiPlans.set(plans.map((plan) => this.normalizeKushkiPlan(plan)));
    this.kushkiConfigured.set(cfg.configured);
    const selected = this.kushkiSubscriptionPlanCode().trim();
    if (!selected || !plans.some((p) => p.planCode === selected)) {
      this.kushkiSubscriptionPlanCode.set(plans[0]?.planCode || 'starter');
    }
  }

  private applyPayPhoneConfig(cfg: PayPhoneTenantConfigResponse): void {
    this.payPhoneEnabled.set(cfg.enabled);
    this.payPhoneToken.set('');
    this.payPhoneTokenConfigured.set(cfg.tokenConfigured);
    this.payPhoneStoreId.set(cfg.storeId ?? '');
    this.payPhoneBaseUrl.set(cfg.baseUrl ?? '');
    this.payPhoneCurrency.set((cfg.currency ?? 'USD').trim().toUpperCase() || 'USD');
    this.payPhoneTimeZone.set(cfg.timeZone ?? 'America/Guayaquil');
    this.payPhoneResponseUrl.set(cfg.responseUrl ?? '');
    this.payPhoneConfigured.set(cfg.configured);
  }

  private applyPayPhoneSaleResponse(r: PayPhoneSaleResponse): void {
    const tx = this.stringFromUnknown(r.transactionId ?? r['transactionId'] ?? r['id']);
    const clientTx = this.stringFromUnknown(r.clientTransactionId ?? r['clientTransactionId']);
    if (tx) {
      this.payPhoneTransactionId.set(tx);
    }
    if (clientTx) {
      this.payPhoneClientTransactionId.set(clientTx);
    }
  }

  private applyPayPhoneStatusResponse(r: PayPhoneSaleStatusResponse): void {
    const tx = this.stringFromUnknown(r.transactionId ?? r['transactionId'] ?? r['id']);
    const clientTx = this.stringFromUnknown(r.clientTransactionId ?? r['clientTransactionId']);
    if (tx) {
      this.payPhoneTransactionId.set(tx);
    }
    if (clientTx) {
      this.payPhoneClientTransactionId.set(clientTx);
    }
  }

  private normalizedKushkiPlans(): KushkiSubscriptionPlan[] {
    return this.kushkiPlans()
      .map((plan) => this.normalizeKushkiPlan(plan))
      .filter((plan) => plan.planCode.trim() && plan.planName.trim());
  }

  private normalizeKushkiPlan(plan: Partial<KushkiSubscriptionPlan>): KushkiSubscriptionPlan {
    return {
      planCode: (plan.planCode ?? 'starter').trim(),
      planName: (plan.planName ?? 'Starter').trim(),
      periodicity: (plan.periodicity ?? 'monthly').trim(),
      subtotalIva: this.numberValue(plan.subtotalIva ?? 0),
      subtotalIva0: this.numberValue(plan.subtotalIva0 ?? 0),
      ice: this.numberValue(plan.ice ?? 0),
      iva: this.numberValue(plan.iva ?? 0),
      currency: (plan.currency ?? 'USD').trim().toUpperCase().slice(0, 3) || 'USD',
    };
  }

  private blankKushkiPlan(code = 'starter'): KushkiSubscriptionPlan {
    return {
      planCode: code,
      planName: code === 'starter' ? 'Starter' : '',
      periodicity: 'monthly',
      subtotalIva: 0,
      subtotalIva0: 0,
      ice: 0,
      iva: 0,
      currency: 'USD',
    };
  }

  private selectedKushkiPlan(): KushkiSubscriptionPlan {
    const code = this.kushkiSubscriptionPlanCode().trim();
    return this.kushkiPlans().find((plan) => plan.planCode === code) ?? this.kushkiPlans()[0] ?? this.blankKushkiPlan();
  }

  private async loadKushkiScripts(): Promise<void> {
    await this.loadScriptOnce('https://cdn.kushkipagos.com/js/latest/kushki.min.js', 'kushki-sdk');
    await this.loadScriptOnce('https://cdn.kushkipagos.com/js/latest/card.min.js', 'kushki-card-sdk');
  }

  private loadScriptOnce(src: string, id: string): Promise<void> {
    if (document.getElementById(id)) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.id = id;
      script.src = src;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`No se pudo cargar ${src}`));
      document.head.appendChild(script);
    });
  }

  private async createKushkiHostedCard(plan: KushkiSubscriptionPlan): Promise<any> {
    const merchantId = this.kushkiPublicMerchantId().trim();
    if (!merchantId) {
      throw new Error('Public Merchant ID requerido para tokenizar con Kushki.');
    }
    const options = {
      publicMerchantId: merchantId,
      merchantId,
      inTestEnvironment: this.kushkiTestEnvironment(),
      testEnvironment: this.kushkiTestEnvironment(),
      isSubscription: true,
      currency: plan.currency,
      amount: {
        subtotalIva: plan.subtotalIva,
        subtotalIva0: plan.subtotalIva0,
        ice: plan.ice,
        iva: plan.iva,
      },
      fields: {
        cardholderName: { selector: '#kushki-cardholder-name' },
        cardNumber: { selector: '#kushki-card-number' },
        expiryDate: { selector: '#kushki-expiration-date' },
        cvv: { selector: '#kushki-cvv' },
      },
    };
    const ctor = window.KushkiCard ?? window.Kushki?.Card ?? window.initCardToken;
    if (typeof ctor?.initCardToken === 'function') {
      return ctor.initCardToken(options);
    }
    if (typeof ctor === 'function') {
      return new ctor(options);
    }
    if (typeof window.Kushki === 'function') {
      const kushki = new window.Kushki({ merchantId, inTestEnvironment: this.kushkiTestEnvironment() });
      return { kushki, options };
    }
    throw new Error('Kushki.js no expuso Hosted Fields. Verifique CDN/API del SDK.');
  }

  private async requestKushkiToken(): Promise<string> {
    const card = this.kushkiHostedCard;
    if (!card) {
      throw new Error('Inicialice los campos seguros de Kushki antes de tokenizar.');
    }
    if (typeof card.requestToken === 'function') {
      const result = await card.requestToken();
      return this.extractKushkiToken(result);
    }
    if (typeof card.tokenize === 'function') {
      const result = await card.tokenize();
      return this.extractKushkiToken(result);
    }
    if (card.kushki && typeof card.kushki.requestToken === 'function') {
      return new Promise((resolve, reject) => {
        card.kushki.requestToken(
          { ...card.options, isSubscription: true },
          (response: unknown) => {
            try {
              resolve(this.extractKushkiToken(response));
            } catch (err) {
              reject(err);
            }
          },
        );
      });
    }
    throw new Error('El SDK Kushki cargado no permite solicitar token desde Hosted Fields.');
  }

  private extractKushkiToken(result: unknown): string {
    if (typeof result === 'string' && result.trim()) {
      return result.trim();
    }
    if (result && typeof result === 'object') {
      const obj = result as Record<string, unknown>;
      const token = obj['token'] ?? obj['subscriptionToken'] ?? obj['paymentToken'];
      if (typeof token === 'string' && token.trim()) {
        return token.trim();
      }
      const body = obj['body'];
      if (body && typeof body === 'object' && typeof (body as Record<string, unknown>)['token'] === 'string') {
        return String((body as Record<string, unknown>)['token']).trim();
      }
    }
    throw new Error('Kushki no devolvio un token valido.');
  }

  private parseExtraPrices(raw: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const row of raw.split(/\r?\n/)) {
      const clean = row.trim();
      if (!clean || !clean.includes('=')) {
        continue;
      }
      const [key, ...rest] = clean.split('=');
      const code = key.trim().toLowerCase();
      const price = rest.join('=').trim();
      if (code && price) {
        out[code] = price;
      }
    }
    return out;
  }

  private formatExtraPrices(prices: Record<string, string>): string {
    return Object.entries(prices)
      .filter(([code]) => code !== 'starter')
      .map(([code, price]) => `${code}=${price}`)
      .join('\n');
  }

  private idempotencyKey(): string {
    return typeof globalThis.crypto !== 'undefined' && 'randomUUID' in globalThis.crypto
      ? globalThis.crypto.randomUUID()
      : `idem-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }

  private todayIsoDate(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private numberValue(value: string | number): number {
    const n = typeof value === 'number' ? value : Number.parseFloat(String(value).replace(',', '.'));
    return Number.isFinite(n) ? Math.max(0, Math.round(n * 100) / 100) : 0;
  }

  private payPhoneAmountCents(): number {
    return (
      this.usdInputToCents(this.payPhoneAmountWithoutTax()) +
      this.usdInputToCents(this.payPhoneAmountWithTax()) +
      this.usdInputToCents(this.payPhoneTax()) +
      this.usdInputToCents(this.payPhoneService()) +
      this.usdInputToCents(this.payPhoneTip())
    );
  }

  private usdInputToCents(value: string): number {
    const n = Number.parseFloat(String(value).replace(',', '.'));
    return Number.isFinite(n) ? Math.max(0, Math.round(n * 100)) : 0;
  }

  private centsToUsd(cents: number): number {
    return Math.round(cents) / 100;
  }

  private stringFromUnknown(value: unknown): string {
    if (typeof value === 'string') {
      return value.trim();
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
    return '';
  }

  private errorMessage(err: unknown, provider = 'Stripe'): string {
    if (err && typeof err === 'object' && 'error' in err) {
      const body = (err as { error?: unknown }).error;
      if (body && typeof body === 'object' && 'message' in body) {
        const msg = (body as { message?: unknown }).message;
        if (typeof msg === 'string' && msg.trim()) {
          return msg;
        }
      }
      if (typeof body === 'string' && body.trim()) {
        return body;
      }
    }
    if (err instanceof Error) {
      return err.message;
    }
    return `No se pudo completar la operacion ${provider}.`;
  }
}
