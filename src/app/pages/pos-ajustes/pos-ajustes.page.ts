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
        <div class="settings-hero">
          <div>
            <span class="eyebrow">Panel de control</span>
            <h1>{{ activeTabMeta().label }}</h1>
            <p>{{ activeTabMeta().longDesc }}</p>
          </div>
          <div class="settings-hero__badge">
            <span>{{ activeTabMeta().badge }}</span>
          </div>
        </div>

        @switch (activeTab()) {
          @case ('business') {
            <div class="section-head">
              <span class="eyebrow">Administración</span>
              <h1>Reglas generales del POS</h1>
              <p>
                Reglas compartidas para todas las cajas. En producción deben persistir en backend y solo un perfil
                administrador debería modificarlas.
              </p>
            </div>

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

            @if (invoicingProvider() !== 'NONE') {
              <p class="hint">Pendientes fiscales offline: {{ invoicingPending() }}
                <button type="button" class="linkish" (click)="retryInvoicingPending()">Reintentar ahora</button>
              </p>
            }

            <div class="card-grid">
              <label class="field">
                <span>Documento por defecto</span>
                <select
                  class="input pos-focus-ring"
                  [disabled]="!canManageBusinessRules()"
                  [ngModel]="prefs.defaultDocumentType()"
                  (ngModelChange)="prefs.setDefaultDocumentType($event)">
                  <option value="nota-venta">Nota de venta</option>
                  <option value="factura">Factura</option>
                  <option value="preguntar">Preguntar al cobrar</option>
                </select>
              </label>

              <label class="field">
                <span>Formato de comprobante</span>
                <select
                  class="input pos-focus-ring"
                  [disabled]="!canManageBusinessRules()"
                  [ngModel]="prefs.receiptTemplate()"
                  (ngModelChange)="prefs.setReceiptTemplate($event)">
                  <option value="ticket-58">Ticket 58 mm</option>
                  <option value="ticket-80">Ticket 80 mm</option>
                  <option value="a4">A4 factura completa</option>
                </select>
              </label>

              <label class="field">
                <span>Límite máximo de descuento (%)</span>
                <input
                  class="input pos-focus-ring"
                  type="number"
                  min="0"
                  max="100"
                  [disabled]="!canManageBusinessRules()"
                  [ngModel]="prefs.maxDiscountPercent()"
                  (ngModelChange)="prefs.setMaxDiscountPercent($event)" />
              </label>

              <label class="field">
                <span>Factura obligatoria desde</span>
                <input
                  class="input pos-focus-ring"
                  type="number"
                  min="0"
                  inputmode="decimal"
                  [disabled]="!canManageBusinessRules()"
                  [ngModel]="prefs.minInvoiceAmount()"
                  (ngModelChange)="prefs.setMinInvoiceAmount($event)" />
              </label>

              <label class="field">
                <span>Cliente requerido sobre</span>
                <input
                  class="input pos-focus-ring"
                  type="number"
                  min="0"
                  inputmode="decimal"
                  [disabled]="!canManageBusinessRules()"
                  [ngModel]="prefs.requireCustomerOver()"
                  (ngModelChange)="prefs.setRequireCustomerOver($event)" />
              </label>
            </div>
          }

          @case ('station') {
            <div class="section-head">
              <span class="eyebrow">Estación</span>
              <h1>Caja y preferencias locales</h1>
              <p>Configuración por navegador/equipo: útil cuando cada caja tiene hardware o hábitos distintos.</p>
            </div>

            <div class="card-grid">
              <label class="field">
                <span>Identificador de caja</span>
                <input
                  type="text"
                  class="input pos-focus-ring"
                  placeholder="Ej. CAJA-01"
                  [ngModel]="prefs.cajaId()"
                  (ngModelChange)="onCaja($event)" />
              </label>

              @if (puntosError()) {
                <p class="warn">{{ puntosError() }}</p>
              }
              @if (puntos().length > 0) {
                <label class="field field--wide">
                  <span>Punto de emisión (eFactura)</span>
                  <select
                    class="input pos-focus-ring"
                    [ngModel]="prefs.puntoEmisionId()"
                    (ngModelChange)="onPuntoEmision($event)">
                    <option value="">Seleccione</option>
                    @for (pe of puntos(); track pe.id) {
                      <option [value]="pe.id">{{ pe.establecimientoCodigo }}-{{ pe.codigo }} · {{ pe.nombre }}</option>
                    }
                  </select>
                </label>
              } @else {
                <p class="hint field--wide">No hay puntos de eFactura cargados. Configure una sucursal/emision local para permitir operacion POS.</p>
                <label class="field">
                  <span>Sucursal local</span>
                  <input type="text" class="input pos-focus-ring" maxlength="3" placeholder="001" [ngModel]="prefs.localBranchCode()" (ngModelChange)="onLocalBranch($event)" />
                </label>
                <label class="field">
                  <span>Emision local</span>
                  <input type="text" class="input pos-focus-ring" maxlength="3" placeholder="001" [ngModel]="prefs.localEmissionCode()" (ngModelChange)="onLocalEmission($event)" />
                </label>
              }

              <label class="toggle">
                <span>
                  <strong>Sonido al añadir/quitar ítems</strong>
                  <small>Feedback rápido para operación táctil.</small>
                </span>
                <input
                  type="checkbox"
                  [checked]="prefs.soundOn()"
                  (change)="prefs.setSound(!prefs.soundOn())" />
              </label>

              <label class="toggle">
                <span>
                  <strong>Separar productos repetidos en nuevas lineas</strong>
                  <small>Si esta desactivado, el mismo producto aumenta la cantidad de la linea existente.</small>
                </span>
                <input
                  type="checkbox"
                  [checked]="prefs.separateSameProductLines()"
                  (change)="prefs.setSeparateSameProductLines(!prefs.separateSameProductLines())" />
              </label>

              <label class="toggle">
                <span>
                  <strong>Agregar al escanear código exacto</strong>
                  <small>Evita presionar Enter cuando el lector envía el código.</small>
                </span>
                <input
                  type="checkbox"
                  [checked]="prefs.scanAutoAdd()"
                  (change)="prefs.setScanAutoAdd(!prefs.scanAutoAdd())" />
              </label>

              <label class="toggle">
                <span>
                  <strong>Sugerencias de upsell</strong>
                  <small>Reservado para combos o productos relacionados.</small>
                </span>
                <input
                  type="checkbox"
                  [checked]="prefs.upsellOn()"
                  (change)="prefs.setUpsell(!prefs.upsellOn())" />
              </label>

              <label class="toggle">
                <span>
                  <strong>Cambio manual de lista de precio</strong>
                  <small>
                    Si está desactivado, en venta se usa la lista asignada al cliente y el cajero no puede cambiarla.
                  </small>
                </span>
                <input
                  type="checkbox"
                  [checked]="prefs.allowManualPriceListSelection()"
                  (change)="prefs.setAllowManualPriceListSelection(!prefs.allowManualPriceListSelection())" />
              </label>
            </div>
          }

          @case ('printing') {
            <div class="section-head">
              <span class="eyebrow">Hardware</span>
              <h1>Impresión y etiquetas</h1>
              <p>Impresoras por estación para recibos, cajón de dinero y etiquetas de producto.</p>
            </div>

            <div class="card-grid">
              <label class="field">
                <span>Impresora de recibos</span>
                <select
                  class="input pos-focus-ring"
                  [ngModel]="prefs.receiptPrinter()"
                  (ngModelChange)="prefs.setReceiptPrinter($event)">
                  <option value="">Sin asignar</option>
                  <option value="epson-tm-t20">Epson TM-T20 / compatible ESC/POS</option>
                  <option value="star-tsp100">Star TSP100</option>
                  <option value="browser-default">Impresora del navegador</option>
                </select>
              </label>

              <label class="field">
                <span>Impresora de etiquetas</span>
                <select
                  class="input pos-focus-ring"
                  [ngModel]="prefs.labelPrinter()"
                  (ngModelChange)="prefs.setLabelPrinter($event)">
                  <option value="">Sin asignar</option>
                  <option value="zebra-zd">Zebra ZD / ZPL</option>
                  <option value="dymo">DYMO LabelWriter</option>
                  <option value="browser-default">Impresora del navegador</option>
                </select>
              </label>

              <label class="field">
                <span>Formato de etiqueta</span>
                <select
                  class="input pos-focus-ring"
                  [ngModel]="prefs.labelFormat()"
                  (ngModelChange)="prefs.setLabelFormat($event)">
                  <option value="58x40">58 x 40 mm precio + barcode</option>
                  <option value="50x30">50 x 30 mm compacto</option>
                  <option value="38x25">38 x 25 mm góndola</option>
                  <option value="custom">Plantilla personalizada</option>
                </select>
              </label>

              <label class="toggle">
                <span>
                  <strong>Imprimir recibo automáticamente</strong>
                  <small>Tras registrar el pago.</small>
                </span>
                <input
                  type="checkbox"
                  [checked]="prefs.autoReceipt()"
                  (change)="prefs.setAutoReceipt(!prefs.autoReceipt())" />
              </label>

              <label class="toggle">
                <span>
                  <strong>Abrir cajón al pago en efectivo</strong>
                  <small>Requiere impresora/cajón compatible.</small>
                </span>
                <input
                  type="checkbox"
                  [checked]="prefs.openDrawerAfterCash()"
                  (change)="prefs.setOpenDrawerAfterCash(!prefs.openDrawerAfterCash())" />
              </label>
            </div>
          }

          @case ('payments') {
            <div class="section-head">
              <span class="eyebrow">Cobros</span>
              <h1>Tarjetas, QR y terminales</h1>
              <p>Proveedor y terminal por caja. El POS queda preparado para terminal integrado, link/QR y registro manual.</p>
            </div>

            <div class="integration-catalog" aria-label="Cat&aacute;logo de integraciones de pago">
              @for (item of paymentIntegrationCards(); track item.id) {
                <button
                  type="button"
                  class="integration-card pos-focus-ring"
                  [class.integration-card--on]="selectedPaymentIntegration() === item.id"
                  (click)="openPaymentIntegration(item.id)">
                  <span class="integration-card__icon" aria-hidden="true">{{ item.shortName }}</span>
                  <span class="integration-card__body">
                    <span class="integration-card__top">
                      <strong>{{ item.name }}</strong>
                      <em [class.integration-card__state--ok]="item.state === 'Activo'" [class.integration-card__state--bad]="item.state === 'Error'">{{ item.state }}</em>
                    </span>
                    <small>{{ item.description }}</small>
                    <span class="integration-card__chips">
                      @for (capability of item.capabilities; track capability) {
                        <span>{{ capability }}</span>
                      }
                    </span>
                    <span class="integration-card__action">Configurar</span>
                  </span>
                </button>
              }
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
            <div class="section-head">
              <span class="eyebrow">Experiencia</span>
              <h1>Interfaz del cajero</h1>
              <p>Tema, densidad y comportamiento visual del catálogo.</p>
            </div>

            <div class="card-grid">
              <div class="field field--wide">
                <span>Tema</span>
                <div class="segmented">
                  <button
                    type="button"
                    class="seg pos-focus-ring"
                    [class.seg--on]="prefs.theme() === 'dark'"
                    (click)="setTheme('dark')">
                    Nocturno
                  </button>
                  <button
                    type="button"
                    class="seg pos-focus-ring"
                    [class.seg--on]="prefs.theme() === 'light'"
                    (click)="setTheme('light')">
                    Claro
                  </button>
                </div>
              </div>

              <div class="field field--wide">
                <span>Ergonomía táctil</span>
                <div class="segmented segmented--with-copy">
                  <button
                    type="button"
                    class="seg pos-focus-ring"
                    [class.seg--on]="prefs.handedness() === 'right'"
                    (click)="onHandedness('right')">
                    Diestro
                  </button>
                  <button
                    type="button"
                    class="seg pos-focus-ring"
                    [class.seg--on]="prefs.handedness() === 'left'"
                    (click)="onHandedness('left')">
                    Zurdo
                  </button>
                </div>
                <small class="field-hint">
                  En monitor táctil, mueve el ticket y las acciones de cobro al lado dominante del cajero.
                </small>
              </div>

              <label class="field">
                <span>Densidad de interfaz</span>
                <select
                  class="input pos-focus-ring"
                  [ngModel]="prefs.densitySource()"
                  (ngModelChange)="onDensitySrc($event)">
                  <option value="auto">Automática</option>
                  <option value="manual">Manual</option>
                </select>
              </label>

              @if (prefs.densitySource() === 'manual') {
                <label class="field">
                  <span>Densidad manual</span>
                  <select
                    class="input pos-focus-ring"
                    [ngModel]="prefs.densityManual()"
                    (ngModelChange)="onDensityManual($event)">
                    <option value="touch">Táctil</option>
                    <option value="comfortable">Cómoda</option>
                    <option value="compact">Compacta</option>
                  </select>
                </label>
              } @else {
                <label class="field">
                  <span>Perfil automático</span>
                  <select
                    class="input pos-focus-ring"
                    [ngModel]="prefs.roleProfile()"
                    (ngModelChange)="onRole($event)">
                    <option value="auto">Auto desde JWT</option>
                    <option value="cajero">Cajero táctil</option>
                    <option value="mostrador">Mostrador estándar</option>
                    <option value="supervisor">Supervisor compacto</option>
                  </select>
                </label>
              }

              <label class="toggle">
                <span>
                  <strong>Miniatura en productos</strong>
                  <small>Útil para pantallas táctiles y catálogos visuales.</small>
                </span>
                <input
                  type="checkbox"
                  [checked]="prefs.showProductImages()"
                  (change)="prefs.setShowProductImages(!prefs.showProductImages())" />
              </label>
            </div>
          }

          @case ('about') {
            <div class="section-head">
              <span class="eyebrow">Sistema</span>
              <h1>Información del POS</h1>
              <p>Estado de integración, versión y contexto operativo de la terminal.</p>
            </div>

            <div class="info-grid">
              <div class="info-card">
                <span>Versión POS UI</span>
                <strong>{{ appVersion }}</strong>
              </div>
              <div class="info-card">
                <span>API POS</span>
                <strong>{{ auth.apiBaseUrl || 'No configurada' }}</strong>
              </div>
              <div class="info-card">
                <span>eFactura UI</span>
                <strong>{{ efacturaUi || 'No configurada' }}</strong>
              </div>
              <div class="info-card">
                <span>Modelo recomendado</span>
                <strong>Reglas globales en backend, estación en navegador</strong>
              </div>
            </div>

            <div class="learned">
              <h2>Ventajas tomadas como referencia</h2>
              <ul>
                <li>Permisos por rol para descuentos, configuración e impresión.</li>
                <li>Impresoras por estación: recibo, etiquetas y cajón de dinero.</li>
                <li>Recibos automáticos u opcionales después del pago.</li>
                <li>Plantillas de etiquetas y formatos de ticket configurables.</li>
                <li>Densidad táctil/compacta según operación y perfil.</li>
              </ul>
            </div>
          }
        }
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
      .settings-hero {
        flex-direction: column;
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
      .info-grid,
      .stripe-grid,
      .kushki-plan,
      .kushki-hosted-grid {
        grid-template-columns: 1fr;
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
  readonly appVersion = '0.1.0';
  readonly efacturaUi = 'http://localhost:4200';
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
  }

  onPuntoEmision(v: string): void {
    this.prefs.setPuntoEmisionId(v);
  }

  onLocalBranch(v: string): void {
    this.prefs.setLocalBranchCode(this.cleanThreeDigitCode(v));
  }

  onLocalEmission(v: string): void {
    this.prefs.setLocalEmissionCode(this.cleanThreeDigitCode(v));
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
