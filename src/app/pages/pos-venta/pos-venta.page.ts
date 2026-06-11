import { CommonModule } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import {
  afterNextRender,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { finalize } from 'rxjs';
import { PosBackendApiService } from '../../core/api/pos-backend-api.service';
import type {
  PosCheckoutPago,
  PosCheckoutRequestBody,
  PosCustomerResponse,
  PosOfflineComprobanteSyncRequest,
  PosPaymentCollectionResponse,
} from '../../core/api/pos-backend.types';
import {
  applyTipoIdentificacionDefaults,
  buildCustomerRequest,
  CONSUMIDOR_FINAL_ID,
  direccionRequired,
  emptyCustomerForm,
  hasCustomerFormErrors,
  identificacionInputMode,
  identificacionLabel,
  identificacionMaxLength,
  isConsumidorFinalTipo,
  isPersonaNaturalTipo,
  isRucTipo,
  type PosCustomerFormErrors,
  type PosCustomerFormState,
  validateCustomerForm,
} from '../../shared/customer/pos-customer-form.util';
import { applyCedulaConsultaToForm, applyRucConsultaToForm } from '../../shared/customer/pos-catastro.util';
import {
  customerResponseToSale,
  SALE_CONSUMIDOR_FINAL,
  saleCustomerTipoLabel,
  type SaleCustomer,
} from '../../shared/customer/pos-sale-customer.util';
import { PosDeskSessionService } from '../../core/desk/pos-desk-session.service';
import { PosAuthService } from '../../core/auth/pos-auth.service';
import { PosConfigService } from '../../core/config/pos-config.service';
import { PosLayoutPreferencesService } from '../../core/layout/pos-layout-preferences.service';
import { PosOfflineSyncService } from '../../core/offline/pos-offline-sync.service';
import { PosToastService } from '../../core/ui/pos-toast.service';

interface DemoProduct {
  id: string;
  name: string;
  sku: string;
  /** Código de barras; si falta, en búsqueda se usa el SKU. */
  barcode?: string;
  price: number;
  tag: string;
}

interface CartLine {
  lineId: string;
  product: DemoProduct;
  qty: number;
  /** Descuento fijo en USD sobre el ítem (no por unidad). */
  discountAmount: number;
}

interface SaleTab {
  id: string;
  label: string;
  cart: CartLine[];
  customer: SaleCustomer | null;
}

type CardPaymentChannel = 'terminal' | 'link' | 'manual';
type CardPaymentStatus = 'idle' | 'pending' | 'approved' | 'rejected';
type PosPaymentMethodCode = 'cash' | 'card' | 'transfer' | 'stripe' | 'kushki' | 'payphone' | 'other';
type PosExternalPaymentStatus = 'idle' | 'pending' | 'confirmed' | 'rejected';

interface PosPaymentMethodOption {
  code: PosPaymentMethodCode;
  label: string;
  icon: string;
  formaPago: string;
  canal: string;
  proveedor: string | null;
}

interface PosPaymentLineDraft {
  id: string;
  method: PosPaymentMethodCode;
  formaPago: string;
  canal: string;
  proveedor: string | null;
  total: number;
  recibido: number | null;
  vuelto: number;
  transaccionProveedorId: string | null;
  codigoAutorizacion: string | null;
  referencia: string | null;
  status: PosExternalPaymentStatus;
}

const POS_SALE_TABS_STORAGE_KEY = 'pos_ui_pending_sale_tabs_v1';

type ModalState =
  | { kind: 'stock'; product: DemoProduct }
  | { kind: 'promo'; product: DemoProduct }
  | { kind: 'newCustomer' }
  | { kind: 'lineDiscount'; lineId: string }
  | { kind: 'cobro' };

@Component({
  selector: 'pos-venta-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="venta">
      <div class="venta__grid" [class.venta__grid--left]="prefs.handedness() === 'left'">
        <section class="panel panel--wide" aria-label="Catálogo de venta">
          <div class="catalog-toolbar">
            <label class="catalog-search">
              <span class="sr-only">Buscar por nombre, SKU o código de barras</span>
              <svg class="catalog-search__ico" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="1.6" />
                <path d="M16 16l5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
              </svg>
              <input
                #catalogSearch
                id="pos-catalog-search"
                type="search"
                autocomplete="off"
                class="catalog-search__input pos-focus-ring"
                placeholder="Nombre, SKU o código de barras…"
                [value]="catalogQuery()"
                (input)="onCatalogQuery($event)"
                (keydown.enter)="onCatalogEnter($event)" />
            </label>
            <div class="catalog-toolbar__tools">
              <div class="cats" role="tablist" aria-label="Filtro por categoría">
                @for (c of categories(); track c) {
                  <button
                    type="button"
                    class="cat pos-focus-ring"
                    [class.cat--on]="c === activeCat()"
                    (click)="activeCat.set(c)">
                    {{ c }}
                  </button>
                }
              </div>
            </div>
          </div>
          <div class="products-scroll">
            <div class="products">
              @for (p of pagedProducts(); track p.id) {
                <article class="card">
                  <button type="button" class="card__main pos-focus-ring" [class.card__main--locked]="!desk.cajaOpen()" (click)="addLine(p)">
                    <div class="card__body">
                      <span class="card__tag">{{ p.tag }}</span>
                      <span class="card__name">{{ p.name }}</span>
                      <span class="card__sku">{{ p.sku }}</span>
                      <span class="card__price">{{ p.price | currency: 'USD' : 'symbol-narrow' : '1.2-2' }}</span>
                    </div>
                  </button>
                  <div class="card__actions">
                    <button
                      type="button"
                      class="mini pos-focus-ring"
                      title="Stock en otras bodegas"
                      [class.mini--locked]="!desk.cajaOpen()"
                      (click)="openModal('stock', p)">
                      Stock
                    </button>
                    <button
                      type="button"
                      class="mini pos-focus-ring"
                      title="Promociones"
                      [class.mini--locked]="!desk.cajaOpen()"
                      (click)="openModal('promo', p)">
                      Promo
                    </button>
                  </div>
                </article>
              }
            </div>
          </div>
          <div class="catalog-pager" role="navigation" aria-label="Paginación del catálogo">
            <button
              type="button"
              class="pager-btn pos-focus-ring"
              [disabled]="catalogPageClamped() <= 1"
              (click)="catalogPrev()">
              Anterior
            </button>
            <span class="catalog-pager__meta"
              >Página {{ catalogPageClamped() }} de {{ catalogTotalPages() }} · {{ filteredCatalog().length }}
              ítems</span
            >
            <button
              type="button"
              class="pager-btn pos-focus-ring"
              [disabled]="catalogPageClamped() >= catalogTotalPages()"
              (click)="catalogNext()">
              Siguiente
            </button>
          </div>
        </section>

        <aside class="panel panel--cart" aria-label="Detalle de venta">
          <div class="cart-head">
            <div class="cart-tabs-scroll">
              <div class="cart-tabs" role="tablist" aria-label="Ventas abiertas">
                @for (t of tabs(); track t.id) {
                  <button
                    type="button"
                    class="sale-tab pos-focus-ring"
                    role="tab"
                    [attr.aria-selected]="t.id === activeTabId()"
                    [class.sale-tab--on]="t.id === activeTabId()"
                    (click)="selectTab(t.id)">
                    <span class="sale-tab__label">{{ t.label }}</span>
                    @if (t.customer) {
                      <span class="sale-tab__cust">{{ t.customer.name }}</span>
                    }
                    @if (tabs().length > 1) {
                      <span
                        class="sale-tab__close"
                        role="button"
                        tabindex="0"
                        (click)="closeTab($event, t.id)"
                        (keydown.enter)="closeTabKb($event, t.id)"
                        (keydown.space)="closeTabKb($event, t.id)"
                        title="Cerrar pestaña">×</span>
                    }
                  </button>
                }
                <button type="button" class="sale-tab sale-tab--plus pos-focus-ring" [class.sale-tab--locked]="!desk.cajaOpen()" (click)="newSale()" aria-label="Nueva venta">
                  +
                </button>
              </div>
            </div>
            <span class="badge">{{ lineCount() }} ítems</span>
          </div>

          <div class="customer-panel">
            <div class="customer-panel__head">
              <span class="customer-panel__lbl">Cliente</span>
              @if (activeCustomer(); as ac) {
                <span class="customer-panel__badge" [class.customer-panel__badge--cf]="ac.isConsumidorFinal">
                  {{ saleCustomerTipoLabel(ac.tipoIdentificacion) }}
                </span>
              }
            </div>
            @if (activeCustomer(); as ac) {
              <div class="customer-panel__active">
                <div class="customer-panel__active-text">
                  <strong>{{ ac.name }}</strong>
                  <span>{{ ac.doc }}</span>
                </div>
                @if (!ac.isConsumidorFinal) {
                  <button type="button" class="customer-panel__reset pos-focus-ring" (click)="applyConsumidorFinal()">
                    Usar CF
                  </button>
                }
              </div>
            }
            <div class="customer-panel__search">
              <input
                type="search"
                class="customer-panel__input pos-focus-ring"
                placeholder="RUC, cédula, nombre o correo…"
                [value]="custQuery()"
                (input)="onCustQuery($event)"
                (keydown.enter)="searchCustomer()" />
              <button type="button" class="customer-panel__btn pos-focus-ring" [disabled]="custSearchLoading()" (click)="searchCustomer()">
                {{ custSearchLoading() ? '…' : 'Buscar' }}
              </button>
            </div>
            <div class="customer-panel__quick">
              <button
                type="button"
                class="customer-panel__chip pos-focus-ring"
                [class.customer-panel__chip--active]="activeCustomer()?.isConsumidorFinal"
                (click)="applyConsumidorFinal()">
                Consumidor final
              </button>
              <button type="button" class="customer-panel__chip customer-panel__chip--ghost pos-focus-ring" (click)="openNewCustomer()">
                + Nuevo cliente
              </button>
            </div>
            @if (custResultsOpen() && custResults().length > 0) {
              <ul class="customer-panel__results" role="listbox">
                @for (row of custResults(); track row.id) {
                  <li>
                    <button type="button" class="customer-panel__result pos-focus-ring" (click)="selectCustomer(row)">
                      <span class="customer-panel__result-name">{{ row.nombreComercial || row.razonSocial }}</span>
                      <span class="customer-panel__result-meta">
                        {{ saleCustomerTipoLabel(row.tipoIdentificacion) }} · {{ row.identificacion }}
                      </span>
                    </button>
                  </li>
                }
              </ul>
            }
            @if (custSearchMsg()) {
              <p class="customer-panel__msg">{{ custSearchMsg() }}</p>
            }
          </div>

          <div class="cart__state">
            @if (ping(); as pong) {
              <div class="api-ok" role="status">
                <span class="api-ok__dot"></span>
                API · {{ pong.companyId }}
              </div>
            } @else if (error()) {
              <div class="api-err" role="alert">{{ error() }}</div>
            }
            @if (invoicingEnabled() && posApiConfigured() && !prefs.puntoEmisionId().trim()) {
              <div class="api-warn" role="status">Se usara sucursal/emision local si no hay punto eFactura seleccionado.</div>
            }
            @if (lastTicketId()) {
              <button type="button" class="api-ok api-ok--link pos-focus-ring" (click)="openLastTicket()">
                Imprimir último ticket
              </button>
            }
            @if (!desk.cajaOpen()) {
              <div class="api-warn" role="status">Debe aperturar caja para proceder con la venta.</div>
            }
            @if (saleActionMessage()) {
              <div class="api-warn" role="status">{{ saleActionMessage() }}</div>
            }
          </div>

          <div class="lines">
            @for (line of cart(); track line.lineId) {
              <div class="line">
                <div class="line__info">
                  <span class="line__name">{{ line.product.name }}</span>
                  <span class="line__sku">{{ line.product.sku }}</span>
                  <span class="line__unit">
                    Unit. {{ line.product.price | currency: 'USD' : 'symbol-narrow' : '1.2-2' }}
                  </span>
                  @if (line.discountAmount > 0) {
                    <span class="line__disc">−{{ line.discountAmount | currency: 'USD' : 'symbol-narrow' : '1.2-2' }}</span>
                  }
                </div>
                <button type="button" class="line-dcto pos-focus-ring" [class.line-dcto--locked]="!desk.cajaOpen()" (click)="openLineDiscount(line)">Dcto.</button>
                <div class="line__ctrl">
                  <button type="button" class="qty pos-focus-ring" [class.qty--locked]="!desk.cajaOpen()" (click)="dec(line)" aria-label="Menos">−</button>
                  <input
                    class="line__qty-input pos-focus-ring"
                    type="number"
                    min="1"
                    step="1"
                    inputmode="numeric"
                    aria-label="Cantidad"
                    [value]="line.qty"
                    [readonly]="!desk.cajaOpen()"
                    (change)="onLineQtyInput(line, $event)"
                    (keydown.enter)="onLineQtyInput(line, $event)" />
                  <button type="button" class="qty pos-focus-ring" [class.qty--locked]="!desk.cajaOpen()" (click)="inc(line)" aria-label="Más">+</button>
                </div>
                <div class="line__quick" aria-label="Acciones de linea">
                  <button type="button" class="line-remove pos-focus-ring" [class.line-remove--locked]="!desk.cajaOpen()" (click)="removeLine(line)">
                    Eliminar
                  </button>
                </div>
                <div class="line__sum">{{ lineNet(line) | currency: 'USD' : 'symbol-narrow' : '1.2-2' }}</div>
              </div>
            } @empty {
              <p class="empty">{{ desk.cajaOpen() ? 'Pulse un producto para agregarlo al ticket.' : 'Debe aperturar caja para agregar productos.' }}</p>
            }
          </div>

          <div class="totals">
            @if (discountSum() > 0) {
              <div class="totals__row totals__row--muted">
                <span>Descuentos</span>
                <span>−{{ discountSum() | currency: 'USD' : 'symbol-narrow' : '1.2-2' }}</span>
              </div>
            }
            <div class="totals__row">
              <span>Subtotal</span>
              <span>{{ subtotal() | currency: 'USD' : 'symbol-narrow' : '1.2-2' }}</span>
            </div>
            <div class="totals__row totals__row--muted">
              <span>IVA (15 %)</span>
              <span>{{ iva() | currency: 'USD' : 'symbol-narrow' : '1.2-2' }}</span>
            </div>
            <div class="totals__row totals__row--total">
              <span>Total</span>
              <span>{{ total() | currency: 'USD' : 'symbol-narrow' : '1.2-2' }}</span>
            </div>
            <button type="button" class="btn-pay pos-focus-ring" [class.btn-pay--locked]="lineCount() === 0 || !desk.cajaOpen()" (click)="openCobro()">
              {{ desk.cajaOpen() ? 'Cobrar' : 'Abrir caja para cobrar' }}
            </button>
            <p class="hint">
              @if (posApiConfigured()) {
                Medios de pago con códigos SRI (01 efectivo, 19 tarjeta, 20 transferencia) se envían al registrar el cobro.
              } @else {
                Sin URL de API del POS, el acumulado del día queda en este equipo.
              }
            </p>
          </div>
        </aside>
      </div>
    </div>

    @if (modal(); as m) {
      @if (m.kind === 'newCustomer') {
      <div class="ts-modal-backdrop" (click)="closeModal()"></div>
      <section class="ts-form-modal" role="dialog" aria-modal="true" aria-labelledby="mdl-newc">
        <header class="ts-form-modal__header">
          <div class="ts-form-modal__icon" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <circle cx="9" cy="8" r="3" stroke="currentColor" stroke-width="1.5" />
              <path d="M3 19c0-3 2.5-5 6-5s6 2 6 5" stroke="currentColor" stroke-width="1.5" />
            </svg>
          </div>
          <div class="ts-form-modal__head-text">
            <p class="ts-form-modal__eyebrow">Venta</p>
            <h3 id="mdl-newc">Nuevo cliente</h3>
            <p class="ts-form-modal__subtitle">Datos según tipo de identificación para facturación electrónica.</p>
          </div>
          <button type="button" class="ts-form-modal__close" aria-label="Cerrar" (click)="closeModal()">×</button>
        </header>
        <div class="ts-form-modal__body">
          <div class="pos-form-grid">
            <label class="pos-form-field" [class.pos-form-field--invalid]="newCustFormErrors().tipoIdentificacion">
              <span>Tipo identificación</span>
              <select
                class="pos-focus-ring"
                [(ngModel)]="newCustDraft.tipoIdentificacion"
                name="newCustTipoIdentificacion"
                (ngModelChange)="newCustOnTipoChange()">
                <option value="04">04 — RUC</option>
                <option value="05">05 — Cédula</option>
                <option value="06">06 — Pasaporte</option>
                <option value="07">07 — Consumidor final</option>
              </select>
              @if (newCustFormErrors().tipoIdentificacion) {
                <small class="pos-form-field__error">{{ newCustFormErrors().tipoIdentificacion }}</small>
              }
            </label>

            <label class="pos-form-field" [class.pos-form-field--invalid]="newCustFormErrors().identificacion">
              <span>{{ newCustIdLabel() }}</span>
              <div class="pos-form-field__inline">
                <input
                  class="pos-focus-ring"
                  [(ngModel)]="newCustDraft.identificacion"
                  name="newCustIdentificacion"
                  [readonly]="newCustIsConsumidorFinal()"
                  [attr.inputmode]="newCustIdInputMode()"
                  [maxlength]="newCustIdMaxLength()"
                  (input)="newCustOnIdentificacionInput()"
                  [placeholder]="newCustIdPlaceholder()" />
                @if (newCustCanConsultarCatastro()) {
                  <button
                    type="button"
                    class="pos-btn pos-btn--soft pos-form-field__action"
                    [disabled]="newCustCatastroLoading()"
                    (click)="consultarNewCustCatastro()">
                    {{ newCustCatastroLoading() ? '…' : 'Consultar' }}
                  </button>
                }
              </div>
              @if (newCustFormErrors().identificacion) {
                <small class="pos-form-field__error">{{ newCustFormErrors().identificacion }}</small>
              }
            </label>

            @if (newCustIsRuc()) {
              <label class="pos-form-field pos-form-field--span2" [class.pos-form-field--invalid]="newCustFormErrors().razonSocial">
                <span>Razón social</span>
                <input class="pos-focus-ring" [(ngModel)]="newCustDraft.razonSocial" name="newCustRazonSocial" maxlength="300" placeholder="Razón social registrada" />
                @if (newCustFormErrors().razonSocial) {
                  <small class="pos-form-field__error">{{ newCustFormErrors().razonSocial }}</small>
                }
              </label>
              <label class="pos-form-field pos-form-field--span2" [class.pos-form-field--invalid]="newCustFormErrors().nombreComercial">
                <span>Nombre comercial</span>
                <input class="pos-focus-ring" [(ngModel)]="newCustDraft.nombreComercial" name="newCustNombreComercial" maxlength="300" placeholder="Nombre comercial o marca" />
                @if (newCustFormErrors().nombreComercial) {
                  <small class="pos-form-field__error">{{ newCustFormErrors().nombreComercial }}</small>
                }
              </label>
            } @else if (newCustIsPersona()) {
              <label class="pos-form-field" [class.pos-form-field--invalid]="newCustFormErrors().nombres">
                <span>Nombres</span>
                <input class="pos-focus-ring" [(ngModel)]="newCustDraft.nombres" name="newCustNombres" maxlength="150" placeholder="Nombres" />
                @if (newCustFormErrors().nombres) {
                  <small class="pos-form-field__error">{{ newCustFormErrors().nombres }}</small>
                }
              </label>
              <label class="pos-form-field" [class.pos-form-field--invalid]="newCustFormErrors().apellidos">
                <span>Apellidos</span>
                <input class="pos-focus-ring" [(ngModel)]="newCustDraft.apellidos" name="newCustApellidos" maxlength="150" placeholder="Apellidos" />
                @if (newCustFormErrors().apellidos) {
                  <small class="pos-form-field__error">{{ newCustFormErrors().apellidos }}</small>
                }
              </label>
              <label class="pos-form-field pos-form-field--span2" [class.pos-form-field--invalid]="newCustFormErrors().nombreComercial">
                <span>Nombre comercial</span>
                <input class="pos-focus-ring" [(ngModel)]="newCustDraft.nombreComercial" name="newCustNombreComercialAlias" maxlength="300" placeholder="Alias o nombre comercial (opcional)" />
                @if (newCustFormErrors().nombreComercial) {
                  <small class="pos-form-field__error">{{ newCustFormErrors().nombreComercial }}</small>
                }
              </label>
            } @else {
              <label class="pos-form-field pos-form-field--span2" [class.pos-form-field--invalid]="newCustFormErrors().razonSocial">
                <span>Nombre</span>
                <input class="pos-focus-ring" [(ngModel)]="newCustDraft.razonSocial" name="newCustRazonSocialCf" maxlength="300" placeholder="Nombre del consumidor final" />
                @if (newCustFormErrors().razonSocial) {
                  <small class="pos-form-field__error">{{ newCustFormErrors().razonSocial }}</small>
                }
              </label>
            }

            <label class="pos-form-field pos-form-field--span2" [class.pos-form-field--invalid]="newCustFormErrors().direccion">
              <span>Dirección{{ newCustDireccionObligatoria() ? '' : ' (opcional)' }}</span>
              <input class="pos-focus-ring" [(ngModel)]="newCustDraft.direccion" name="newCustDireccion" maxlength="500" placeholder="Calle principal, número, ciudad" />
              @if (newCustFormErrors().direccion) {
                <small class="pos-form-field__error">{{ newCustFormErrors().direccion }}</small>
              }
            </label>

            <label class="pos-form-field" [class.pos-form-field--invalid]="newCustFormErrors().phone">
              <span>Teléfono</span>
              <input class="pos-focus-ring" [(ngModel)]="newCustDraft.phone" name="newCustPhone" maxlength="20" placeholder="Ej. 0991234567" inputmode="tel" />
              @if (newCustFormErrors().phone) {
                <small class="pos-form-field__error">{{ newCustFormErrors().phone }}</small>
              }
            </label>

            <label class="pos-form-field" [class.pos-form-field--invalid]="newCustFormErrors().email">
              <span>Correo</span>
              <input class="pos-focus-ring" type="email" [(ngModel)]="newCustDraft.email" name="newCustEmail" maxlength="200" placeholder="correo@ejemplo.com" autocomplete="email" />
              @if (newCustFormErrors().email) {
                <small class="pos-form-field__error">{{ newCustFormErrors().email }}</small>
              }
            </label>
          </div>
        </div>
        <footer class="ts-form-modal__footer">
          <button type="button" class="pos-btn pos-btn--ghost" (click)="closeModal()">Cancelar</button>
          <button type="button" class="pos-btn pos-btn--primary" [disabled]="newCustSaving()" (click)="saveNewCustomer()">
            {{ newCustSaving() ? 'Guardando…' : 'Guardar y usar' }}
          </button>
        </footer>
      </section>
      } @else {
      <div class="modal-back" role="presentation" (click)="closeModal()"></div>
      <div
        class="modal"
        [class.modal--pay]="m.kind === 'cobro'"
        role="dialog"
        aria-modal="true"
        [attr.aria-labelledby]="'mdl-' + m.kind">
        @switch (m.kind) {
          @case ('stock') {
            <h3 class="modal__title" [id]="'mdl-stock'">Stock · {{ m.product.name }}</h3>
            <p class="modal__sub">{{ m.product.sku }}</p>
            <table class="stock-t">
              <thead>
                <tr>
                  <th>Bodega</th>
                  <th>Cantidad</th>
                </tr>
              </thead>
              <tbody>
                @for (row of stockRows(m.product); track row.warehouse) {
                  <tr>
                    <td>{{ row.warehouse }}</td>
                    <td class="stock-t__n">{{ row.qty }}</td>
                  </tr>
                }
              </tbody>
            </table>
            <button type="button" class="btn-modal pos-focus-ring" (click)="closeModal()">Cerrar</button>
          }
          @case ('promo') {
            <h3 class="modal__title" [id]="'mdl-promo'">Promociones - {{ m.product.name }}</h3>
            <p class="modal__p">2x1 fines de semana - combo con bebida incluida (contenido demo).</p>
            <button type="button" class="btn-modal pos-focus-ring" (click)="closeModal()">Cerrar</button>
          }
          @case ('lineDiscount') {
            @if (lineById(m.lineId); as dl) {
              <h3 class="modal__title" id="mdl-lineDiscount">Descuento - linea</h3>
              <p class="modal__sub">{{ dl.product.name }} - {{ dl.product.sku }}</p>
              <p class="calc-meta">
                Bruto {{ lineGross(dl) | currency: 'USD' : 'symbol-narrow' : '1.2-2' }} - max.
                {{ lineDiscountMax(dl) | currency: 'USD' : 'symbol-narrow' : '1.2-2' }}
              </p>
              <div class="calc-display" aria-live="polite">{{ calcBuffer() }}</div>
              <div class="calc-grid">
                @for (k of calcKeys; track k) {
                  <button type="button" class="calc-key pos-focus-ring" (click)="calcTap(k)">{{ k }}</button>
                }
              </div>
              <div class="modal-actions">
                <button type="button" class="btn-modal btn-modal--ghost pos-focus-ring" (click)="calcClearAll()">C</button>
                <button type="button" class="btn-modal btn-modal--ghost pos-focus-ring" (click)="applyLineDiscount(0)">Quitar dto.</button>
                <button type="button" class="btn-modal pos-focus-ring" (click)="applyLineDiscountFromCalc()">Aplicar</button>
              </div>
            }
          }
          @case ('cobro') {
            <div class="pos-pay-modal">
              <div class="pos-pay-modal__head">
                <div>
                  <span class="modal__eyebrow">Registro de cobro</span>
                  <h3 class="modal__title" id="mdl-cobro">Cobrar ticket</h3>
                </div>
                <div class="pos-pay-head__meta">
                  <span>Cliente: <strong>{{ activeCustomer()?.name || 'Consumidor final' }}</strong></span>
                  <span>Caja: <strong>{{ desk.cajaDisplayId() }}</strong></span>
                </div>
                <strong class="modal__amount">{{ total() | currency: 'USD' : 'symbol-narrow' : '1.2-2' }}</strong>
              </div>
              @if (!desk.cajaOpen()) {
                <p class="modal__p modal__p--warn">La caja esta cerrada. Abrala desde el resumen de caja en la barra superior.</p>
                <button type="button" class="btn-modal pos-focus-ring" (click)="closeModal()">Entendido</button>
              } @else {
                @if (checkoutError()) {
                  <p class="modal__p modal__p--warn">{{ checkoutError() }}</p>
                }
                <div class="pos-pay-layout">
                  <section class="pos-pay-entry" aria-label="Captura de pagos">
                    <div class="payment-method-strip" role="list" aria-label="Formas de pago">
                      @for (method of paymentMethods; track method.code) {
                        <button
                          type="button"
                          class="payment-method-chip pos-focus-ring"
                          [class.payment-method-chip--on]="selectedPaymentMethod() === method.code"
                          [class.payment-method-chip--ready]="hasPaymentFor(method.code)"
                          (click)="selectPaymentMethod(method.code)">
                          <span class="payment-method-chip__icon">{{ method.icon }}</span>
                          <span>{{ method.label }}</span>
                        </button>
                      }
                    </div>

                    <div class="pos-pay-form">
                      <label class="modal-field">
                        <span>Monto</span>
                        <input class="modal-input pos-focus-ring" type="text" inputmode="decimal" [value]="draftAmount()" (input)="onDraftAmount($event)" />
                      </label>
                      @if (selectedPaymentMethod() === 'cash') {
                        <label class="modal-field">
                          <span>Recibido</span>
                          <input class="modal-input pos-focus-ring" type="text" inputmode="decimal" [value]="draftReceived()" (input)="onDraftReceived($event)" />
                        </label>
                        <div class="pos-pay-form__metric">
                          <span>Vuelto</span>
                          <strong>{{ draftChange() | currency: 'USD' : 'symbol-narrow' : '1.2-2' }}</strong>
                        </div>
                      }
                      @if (selectedPaymentMethod() === 'card') {
                        <label class="modal-field">
                          <span>Codigo autorizacion</span>
                          <input class="modal-input pos-focus-ring" type="text" [value]="draftAuthCode()" (input)="onDraftAuthCode($event)" />
                        </label>
                      }
                      @if (selectedPaymentMethod() === 'stripe' || selectedPaymentMethod() === 'kushki' || selectedPaymentMethod() === 'payphone') {
                        <label class="modal-field">
                          <span>Estado transaccion</span>
                          <select class="modal-input pos-focus-ring" [value]="draftExternalStatus()" (change)="onDraftExternalStatus($event)">
                            <option value="idle">Sin iniciar</option>
                            <option value="pending">Pendiente</option>
                            <option value="confirmed">Confirmada</option>
                            <option value="rejected">Rechazada</option>
                          </select>
                        </label>
                        <label class="modal-field">
                          <span>ID proveedor</span>
                          <input class="modal-input pos-focus-ring" type="text" [value]="draftProviderTransactionId()" (input)="onDraftProviderTransactionId($event)" />
                        </label>
                      }
                      @if (selectedPaymentMethod() !== 'cash') {
                        <label class="modal-field">
                          <span>Referencia</span>
                          <input class="modal-input pos-focus-ring" type="text" [value]="draftReference()" (input)="onDraftReference($event)" />
                        </label>
                      }
                      @if (selectedPaymentMethod() === 'stripe' || selectedPaymentMethod() === 'kushki' || selectedPaymentMethod() === 'payphone') {
                        <button type="button" class="btn-modal btn-modal--ghost pos-focus-ring" (click)="prepareExternalPayment()">
                          Iniciar / confirmar proveedor
                        </button>
                      }
                      <div class="pos-pay-form__actions">
                        <button type="button" class="btn-modal btn-modal--ghost pos-focus-ring" (click)="fillDraftPending()">Saldo pendiente</button>
                        <button type="button" class="btn-modal pos-focus-ring" [class.btn-modal--disabled]="!canAddPaymentLine()" (click)="tryAddPaymentLine()">Agregar pago</button>
                      </div>
                    </div>

                    @if (selectedPaymentMethod() === 'cash') {
                      <div class="cash-denoms" aria-label="Denominaciones de efectivo">
                        <div class="cash-denoms__head">
                          <span>Denominaciones rapidas</span>
                          <button type="button" class="cash-denoms__clear pos-focus-ring" (click)="clearDraftCash()">Limpiar</button>
                        </div>
                        <div class="cash-denoms__grid">
                          <button type="button" class="cash-denom cash-denom--exact pos-focus-ring" (click)="setDraftCashExact()">
                            Exacto
                            <strong>{{ saldoPendiente() || total() | currency: 'USD' : 'symbol-narrow' : '1.2-2' }}</strong>
                          </button>
                          @for (d of tenderDenominations; track d) {
                            <button type="button" class="cash-denom pos-focus-ring" (click)="setDraftCashTender(d)">
                              {{ d | currency: 'USD' : 'symbol-narrow' : '1.0-0' }}
                            </button>
                          }
                        </div>
                        @if (suggestedTenderAmounts().length) {
                          <div class="cash-denoms__suggested">
                            @for (amount of suggestedTenderAmounts(); track amount) {
                              <button type="button" class="cash-chip pos-focus-ring" (click)="setDraftCashTender(amount)">
                                {{ amount | currency: 'USD' : 'symbol-narrow' : '1.2-2' }}
                              </button>
                            }
                          </div>
                        }
                      </div>
                    }

                    <div class="pos-pay-lines">
                      <div class="pos-pay-lines__head">
                        <span>Pagos registrados</span>
                        <button type="button" class="cash-denoms__clear pos-focus-ring" (click)="clearPayments()">Limpiar</button>
                      </div>
                      <div class="pos-pay-table" role="table" aria-label="Lineas de pago">
                        <div class="pos-pay-table__row pos-pay-table__row--head" role="row">
                          <span>Metodo</span>
                          <span>Canal</span>
                          <span>Monto</span>
                          <span>Recibido</span>
                          <span>Vuelto</span>
                          <span>Referencia</span>
                          <span></span>
                        </div>
                        @for (line of paymentLines(); track line.id) {
                          <div class="pos-pay-table__row" role="row">
                            <span>{{ paymentMethodLabel(line.method) }}</span>
                            <span>{{ line.canal }}</span>
                            <strong>{{ line.total | currency: 'USD' : 'symbol-narrow' : '1.2-2' }}</strong>
                            <span>{{ (line.recibido ?? line.total) | currency: 'USD' : 'symbol-narrow' : '1.2-2' }}</span>
                            <span>{{ line.vuelto | currency: 'USD' : 'symbol-narrow' : '1.2-2' }}</span>
                            <span>{{ line.referencia || line.codigoAutorizacion || line.transaccionProveedorId || '-' }}</span>
                            <button type="button" class="pos-pay-remove pos-focus-ring" (click)="removePaymentLine(line.id)" aria-label="Eliminar pago">x</button>
                          </div>
                        } @empty {
                          <div class="pos-pay-table__empty">Agregue un pago para registrar el cobro.</div>
                        }
                      </div>
                    </div>
                  </section>

                  <aside class="pos-pay-summary" aria-label="Resumen del cobro">
                    <div class="pos-pay-summary__row">
                      <span>Total a pagar</span>
                      <strong>{{ total() | currency: 'USD' : 'symbol-narrow' : '1.2-2' }}</strong>
                    </div>
                    <div class="pos-pay-summary__row">
                      <span>Total pagado</span>
                      <strong>{{ totalPagado() | currency: 'USD' : 'symbol-narrow' : '1.2-2' }}</strong>
                    </div>
                    <div class="pos-pay-summary__row" [class.pos-pay-summary__row--warn]="saldoPendiente() > 0">
                      <span>Saldo pendiente</span>
                      <strong>{{ saldoPendiente() | currency: 'USD' : 'symbol-narrow' : '1.2-2' }}</strong>
                    </div>
                    <div class="pos-pay-summary__row" [class.pos-pay-summary__row--ok]="vueltoTotal() > 0">
                      <span>Vuelto total</span>
                      <strong>{{ vueltoTotal() | currency: 'USD' : 'symbol-narrow' : '1.2-2' }}</strong>
                    </div>
                    @if (paymentCollection(); as collection) {
                      <div class="pos-pay-receipt">
                        <span class="pay-method__title">Cobro {{ collection.status || collection.estado || 'registrado' }}</span>
                        <small>ID {{ collection.id }}</small>
                        @for (line of collectionLines(); track $index) {
                          <div class="pos-pay-receipt__line">
                            <span>{{ line.canal || line.formaPago }}</span>
                            <strong>{{ (line.total ?? 0) | currency: 'USD' : 'symbol-narrow' : '1.2-2' }}</strong>
                            <small>{{ line.referencia || line.codigoAutorizacion || line.transaccionProveedorId || '' }}</small>
                          </div>
                        }
                      </div>
                    }
                  </aside>
                </div>

                <div class="pos-pay-footer">
                  <div>
                    <span>Total</span>
                    <strong>{{ total() | currency: 'USD' : 'symbol-narrow' : '1.2-2' }}</strong>
                  </div>
                  <div>
                    <span>Pagado</span>
                    <strong>{{ totalPagado() | currency: 'USD' : 'symbol-narrow' : '1.2-2' }}</strong>
                  </div>
                  <div>
                    <span>Pendiente</span>
                    <strong>{{ saldoPendiente() | currency: 'USD' : 'symbol-narrow' : '1.2-2' }}</strong>
                  </div>
                  <div>
                    <span>Vuelto</span>
                    <strong>{{ vueltoTotal() | currency: 'USD' : 'symbol-narrow' : '1.2-2' }}</strong>
                  </div>
                  <button type="button" class="btn-modal btn-modal--ghost pos-focus-ring" (click)="closeModal()">Cancelar</button>
                  <button type="button" class="btn-modal pos-focus-ring" [class.btn-modal--disabled]="!canConfirmCobro() || checkoutLoading()" (click)="tryConfirmarCobro()">
                    {{ checkoutLoading() ? 'Registrando...' : 'Cobrar' }}
                  </button>
                </div>
              }
            </div>
          }
        }
      </div>
      }
    }
  `,
  styles: `
    :host {
      display: flex;
      flex: 1;
      min-height: 0;
      flex-direction: column;
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }
    .venta {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
      width: 100%;
      max-width: none;
      margin: 0;
      gap: 0.55rem;
    }
    .venta__head {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 1rem;
      margin-bottom: 0.15rem;
      flex-shrink: 0;
    }
    .venta__title {
      margin: 0;
      font-size: clamp(1.12rem, 1.5vw, 1.38rem);
      font-weight: 800;
      letter-spacing: -0.035em;
      line-height: 1.2;
    }
    .venta__sub {
      margin: 0.32rem 0 0;
      font-size: 0.78rem;
      font-weight: 500;
      color: var(--pos-muted);
      max-width: 40rem;
      line-height: 1.45;
    }
    .btn-ghost {
      border-radius: var(--pos-radius-sm);
      border: 1px solid var(--pos-border-strong);
      background: transparent;
      color: var(--pos-muted);
      padding: 0.4rem 0.75rem;
      font-size: 0.78rem;
      font-weight: 600;
      cursor: pointer;
      transition: border-color var(--pos-transition), color var(--pos-transition);
    }
    .btn-ghost:hover {
      color: var(--pos-text);
      border-color: var(--pos-muted);
    }
    .cart-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      padding: 0.6rem 0.7rem;
      border-bottom: 1px solid var(--pos-border);
      background: var(--pos-elevated);
      flex-shrink: 0;
    }
    .cart-tabs-scroll {
      flex: 1;
      min-width: 0;
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
    }
    .cart-tabs {
      display: inline-flex;
      align-items: center;
      gap: 0.28rem;
      flex-wrap: nowrap;
      padding-bottom: 0.05rem;
    }
    .sale-tab {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      border-radius: var(--pos-radius-sm);
      border: 1px solid var(--pos-border);
      background: var(--pos-surface-2);
      color: var(--pos-muted);
      font-size: 0.69rem;
      font-weight: 600;
      padding: 0.36rem 0.62rem;
      cursor: pointer;
      max-width: 9.5rem;
      flex-shrink: 0;
      transition:
        border-color var(--pos-transition),
        background var(--pos-transition),
        color var(--pos-transition);
    }
    .sale-tab--on {
      border-color: color-mix(in srgb, var(--pos-accent) 38%, var(--pos-border-strong));
      color: var(--pos-text);
      background: color-mix(in srgb, var(--pos-accent-muted) 55%, var(--pos-elevated));
      box-shadow: 0 0 0 1px color-mix(in srgb, var(--pos-accent) 14%, transparent);
    }
    .sale-tab__label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .sale-tab__cust {
      font-size: 0.62rem;
      font-weight: 600;
      color: var(--pos-faint);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 6rem;
    }
    .sale-tab__close {
      margin-left: 0.15rem;
      padding: 0 0.2rem;
      font-size: 1rem;
      line-height: 1;
      color: var(--pos-faint);
      cursor: pointer;
    }
    .sale-tab__close:hover {
      color: var(--pos-danger);
    }
    .sale-tab--plus {
      min-width: 2.1rem;
      justify-content: center;
      padding-left: 0.48rem;
      padding-right: 0.48rem;
      font-size: 1.05rem;
      line-height: 1;
      font-weight: 700;
      border-style: dashed;
      border-color: color-mix(in srgb, var(--pos-accent) 35%, var(--pos-border-strong));
      color: var(--pos-accent-hover);
      background: transparent;
    }
    .customer-panel {
      position: relative;
      padding: 0.62rem 0.65rem 0.58rem;
      border-bottom: 1px solid var(--pos-border);
      background: var(--pos-elevated);
      flex-shrink: 0;
    }
    .customer-panel__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.45rem;
      margin-bottom: 0.38rem;
    }
    .customer-panel__lbl {
      font-size: 0.58rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--pos-faint);
    }
    .customer-panel__badge {
      padding: 0.12rem 0.45rem;
      border-radius: 999px;
      border: 1px solid var(--pos-border-strong);
      background: var(--pos-surface-2);
      color: var(--pos-muted);
      font-size: 0.62rem;
      font-weight: 700;
    }
    .customer-panel__badge--cf {
      color: var(--pos-status-ok);
      border-color: var(--pos-status-ok-border);
      background: var(--pos-status-ok-bg);
    }
    .customer-panel__active {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.45rem;
      margin-bottom: 0.42rem;
      padding: 0.42rem 0.5rem;
      border-radius: 8px;
      border: 1px solid var(--pos-border);
      background: var(--pos-surface-2);
    }
    .customer-panel__active-text {
      display: grid;
      gap: 0.1rem;
      min-width: 0;
    }
    .customer-panel__active-text strong {
      font-size: 0.78rem;
      line-height: 1.2;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .customer-panel__active-text span {
      font-family: var(--pos-mono);
      font-size: 0.64rem;
      color: var(--pos-muted);
    }
    .customer-panel__reset {
      border: 1px solid var(--pos-border-strong);
      border-radius: 6px;
      background: var(--pos-surface);
      color: var(--pos-muted);
      font-size: 0.64rem;
      font-weight: 700;
      padding: 0.24rem 0.45rem;
      cursor: pointer;
      flex-shrink: 0;
    }
    .customer-panel__search {
      display: flex;
      gap: 0.35rem;
      align-items: center;
    }
    .customer-panel__input {
      flex: 1;
      min-width: 0;
      border-radius: 8px;
      border: 1px solid var(--pos-border-strong);
      background: var(--pos-bg);
      color: var(--pos-text);
      padding: 0.38rem 0.5rem;
      font-size: 0.76rem;
    }
    .customer-panel__btn {
      border-radius: 8px;
      border: 1px solid color-mix(in srgb, var(--lux-indigo) 28%, var(--pos-border-strong));
      background: color-mix(in srgb, var(--lux-indigo) 10%, var(--pos-surface));
      color: var(--lux-primary-strong);
      font-size: 0.7rem;
      font-weight: 700;
      padding: 0.36rem 0.55rem;
      cursor: pointer;
      flex-shrink: 0;
    }
    .customer-panel__btn:disabled {
      opacity: 0.6;
      cursor: wait;
    }
    .customer-panel__quick {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem;
      margin-top: 0.42rem;
    }
    .customer-panel__chip {
      border-radius: 999px;
      border: 1px solid color-mix(in srgb, var(--lux-indigo) 24%, var(--pos-border-strong));
      background: var(--pos-surface);
      color: var(--pos-text);
      font-size: 0.68rem;
      font-weight: 650;
      padding: 0.28rem 0.58rem;
      cursor: pointer;
    }
    .customer-panel__chip--active {
      border-color: color-mix(in srgb, var(--lux-indigo) 42%, var(--pos-border-strong));
      background: color-mix(in srgb, var(--lux-indigo) 12%, var(--pos-surface));
      color: var(--lux-primary-strong);
    }
    .customer-panel__chip--ghost {
      background: transparent;
      color: var(--pos-muted);
    }
    .customer-panel__results {
      list-style: none;
      margin: 0.42rem 0 0;
      padding: 0;
      max-height: 9.5rem;
      overflow: auto;
      border: 1px solid var(--pos-border);
      border-radius: 10px;
      background: var(--pos-surface);
      box-shadow: var(--pos-shadow-soft);
    }
    .customer-panel__result {
      display: grid;
      gap: 0.12rem;
      width: 100%;
      padding: 0.48rem 0.55rem;
      border: none;
      border-bottom: 1px solid var(--pos-border);
      background: transparent;
      text-align: left;
      cursor: pointer;
    }
    .customer-panel__result:last-child {
      border-bottom: none;
    }
    .customer-panel__result:hover {
      background: var(--pos-surface-2);
    }
    .customer-panel__result-name {
      font-size: 0.76rem;
      font-weight: 700;
      color: var(--pos-text);
    }
    .customer-panel__result-meta {
      font-size: 0.64rem;
      color: var(--pos-muted);
      font-family: var(--pos-mono);
    }
    .customer-panel__msg {
      margin: 0.35rem 0 0;
      font-size: 0.66rem;
      color: var(--pos-muted);
    }
    .customer-panel__msg--warn {
      color: var(--pos-warn);
    }
    .btn-xs {
      border-radius: 6px;
      border: 1px solid var(--pos-border-strong);
      background: var(--pos-surface);
      color: var(--pos-text);
      font-size: 0.68rem;
      font-weight: 600;
      padding: 0.3rem 0.45rem;
      cursor: pointer;
      flex-shrink: 0;
    }
    .venta__grid {
      flex: 1;
      min-height: 0;
      display: grid;
      grid-template-columns: minmax(0, 3fr) minmax(18rem, 2fr);
      grid-template-rows: minmax(0, 1fr);
      gap: 0.75rem;
      align-items: stretch;
    }
    .venta__grid--left {
      grid-template-columns: minmax(18rem, 2fr) minmax(0, 3fr);
    }
    .venta__grid--left .panel--wide {
      order: 2;
    }
    .venta__grid--left .panel--cart {
      order: 1;
    }
    @media (max-width: 900px) {
      .venta__grid {
        grid-template-columns: 1fr;
        grid-template-rows: minmax(12rem, 55vh) minmax(14rem, 1fr);
      }
      .venta__grid--left .panel--wide,
      .venta__grid--left .panel--cart {
        order: initial;
      }
    }
    .panel {
      border-radius: var(--pos-radius);
      border: 1px solid var(--pos-border);
      background: var(--pos-elevated);
      box-shadow: var(--pos-panel-shadow);
      overflow: hidden;
      min-height: 0;
    }
    .panel--wide {
      display: flex;
      flex-direction: column;
    }
    .panel--cart {
      display: flex;
      flex-direction: column;
      min-height: 0;
    }
    .catalog-toolbar {
      flex-shrink: 0;
      padding: 0.7rem 0.75rem 0.6rem;
      border-bottom: 1px solid var(--pos-border);
      background: var(--pos-surface-2);
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .catalog-search {
      display: flex;
      align-items: center;
      gap: 0.45rem;
      padding: 0.42rem 0.6rem 0.42rem 0.52rem;
      border-radius: var(--pos-radius-sm);
      border: 1px solid var(--pos-border-strong);
      background: var(--pos-elevated);
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
    }
    .catalog-search:focus-within {
      border-color: color-mix(in srgb, var(--pos-accent) 42%, var(--pos-border-strong));
      box-shadow:
        0 0 0 1px color-mix(in srgb, var(--pos-accent) 18%, transparent),
        0 4px 14px -6px color-mix(in srgb, var(--pos-accent) 25%, transparent);
    }
    .catalog-search__ico {
      color: var(--pos-faint);
      flex-shrink: 0;
    }
    .catalog-search__input {
      flex: 1;
      min-width: 0;
      border: none;
      background: transparent;
      color: var(--pos-text);
      font-size: 0.84rem;
      padding: 0.2rem 0.15rem;
      outline: none;
    }
    .catalog-search__input::placeholder {
      color: var(--pos-faint);
    }
    .catalog-toolbar__tools {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 0.4rem 0.55rem;
    }
    .catalog-pager {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.45rem;
      padding: 0.4rem 0.55rem;
      border-top: 1px solid var(--pos-border);
      background: var(--pos-surface-2);
      font-size: 0.72rem;
      color: var(--pos-muted);
    }
    .catalog-pager__meta {
      text-align: center;
      flex: 1;
      min-width: 0;
      font-variant-numeric: tabular-nums;
    }
    .pager-btn {
      border-radius: 6px;
      border: 1px solid var(--pos-border-strong);
      background: var(--pos-elevated);
      color: var(--pos-text);
      font-size: 0.7rem;
      font-weight: 600;
      padding: 0.32rem 0.55rem;
      cursor: pointer;
      flex-shrink: 0;
    }
    .pager-btn:hover:not(:disabled) {
      border-color: var(--pos-text);
    }
    .pager-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    .cats {
      display: flex;
      flex-wrap: wrap;
      gap: 0.28rem;
    }
    .cat {
      border: 1px solid var(--pos-border);
      background: var(--pos-elevated);
      color: var(--pos-muted);
      font-size: 0.65rem;
      font-weight: 600;
      padding: 0.24rem 0.52rem;
      border-radius: var(--pos-radius-xs);
      cursor: pointer;
      transition: border-color var(--pos-transition), color var(--pos-transition), background var(--pos-transition);
    }
    .cat--on {
      border-color: color-mix(in srgb, var(--pos-accent) 32%, var(--pos-border-strong));
      color: var(--pos-text);
      background: color-mix(in srgb, var(--pos-accent-muted) 40%, var(--pos-elevated));
    }
    .products-scroll {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      overflow-x: hidden;
      -webkit-overflow-scrolling: touch;
    }
    .products {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(var(--pos-product-minw), 1fr));
      gap: var(--pos-product-gap);
      padding: 0.65rem 0.7rem 0.75rem;
      align-content: start;
    }
    .card {
      display: flex;
      flex-direction: column;
      position: relative;
      border: 1px solid var(--pos-border);
      border-radius: var(--pos-radius-sm);
      background: var(--pos-elevated);
      overflow: hidden;
      min-height: 0;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
      transition:
        border-color var(--pos-transition),
        box-shadow var(--pos-transition);
    }
    .card::before {
      content: '';
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 3px;
      background: linear-gradient(180deg, var(--pos-accent), color-mix(in srgb, var(--pos-accent) 40%, #6366f1));
      border-radius: var(--pos-radius-xs) 0 0 var(--pos-radius-xs);
      opacity: 0.95;
    }
    html[data-theme='dark'] .card {
      background: var(--pos-surface);
      border-color: var(--pos-border-strong);
    }
    .card:hover {
      border-color: color-mix(in srgb, var(--pos-accent) 28%, var(--pos-border-strong));
      box-shadow:
        0 1px 2px rgba(15, 23, 42, 0.04),
        0 14px 36px -22px color-mix(in srgb, var(--pos-accent) 22%, rgba(15, 23, 42, 0.35));
    }
    html[data-theme='dark'] .card:hover {
      box-shadow:
        0 1px 0 rgba(255, 255, 255, 0.04),
        0 16px 40px -20px rgba(0, 0, 0, 0.5);
    }
    .card__main {
      flex: 1;
      text-align: left;
      border: none;
      background: transparent;
      padding: 0;
      cursor: pointer;
      color: inherit;
      font: inherit;
    }
    .card__main--locked,
    .mini--locked,
    .line-dcto--locked,
    .qty--locked,
    .line-chip--locked,
    .line-remove--locked,
    .sale-tab--locked,
    .btn-pay--locked {
      opacity: 0.55;
      cursor: not-allowed;
    }
    .card__body {
      padding: 0.6rem 0.65rem 0.52rem;
      display: flex;
      flex-direction: column;
      gap: 0.1rem;
    }
    .card__tag {
      font-size: 0.56rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      color: var(--pos-muted);
    }
    .card__name {
      font-size: 0.78rem;
      font-weight: 600;
      color: var(--pos-text);
      line-height: 1.25;
    }
    .card__sku {
      font-size: 0.62rem;
      color: var(--pos-faint);
      font-family: var(--pos-mono);
    }
    .card__price {
      margin-top: 0.22rem;
      font-size: 0.92rem;
      font-weight: 850;
      color: var(--pos-text);
    }
    .card__actions {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1px;
      border-top: 1px solid var(--pos-border);
      background: var(--pos-border);
      flex-shrink: 0;
    }
    .mini {
      border: none;
      background: var(--pos-surface-2);
      color: var(--pos-muted);
      font-size: 0.62rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      padding: 0.38rem 0.2rem;
      cursor: pointer;
      border-radius: 4px;
    }
    .mini:hover {
      color: var(--pos-accent-hover);
      background: var(--pos-accent-muted);
    }
    .badge {
      font-size: 0.63rem;
      font-weight: 700;
      padding: 0.2rem 0.48rem;
      border-radius: var(--pos-radius-xs);
      border: 1px solid var(--pos-border);
      color: var(--pos-muted);
      background: var(--pos-surface-2);
      font-variant-numeric: tabular-nums;
    }
    .cart__state {
      flex-shrink: 0;
      padding: 0.45rem 0.65rem 0;
    }
    .api-ok,
    .api-err {
      padding: 0.38rem 0.55rem;
      border-radius: var(--pos-radius-sm);
      font-size: 0.68rem;
      display: flex;
      align-items: center;
      gap: 0.4rem;
    }
    .api-ok {
      background: var(--pos-status-ok-bg);
      border: 1px solid var(--pos-status-ok-border);
      color: var(--pos-status-ok);
    }
    .api-ok--link {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      margin-top: 0.35rem;
      padding: 0.3rem 0.55rem;
      border-radius: 6px;
      font-size: 0.72rem;
      font-weight: 700;
      cursor: pointer;
    }
    .api-ok__dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--pos-status-ok);
    }
    .api-err {
      background: rgba(251, 113, 133, 0.1);
      border: 1px solid rgba(251, 113, 133, 0.28);
      color: #e11d48;
    }
    html[data-theme='dark'] .api-err {
      color: #fda4af;
    }
    .api-warn {
      margin-top: 0.35rem;
      padding: 0.38rem 0.55rem;
      border-radius: var(--pos-radius-sm);
      font-size: 0.68rem;
      border: 1px solid rgba(217, 119, 6, 0.35);
      background: rgba(251, 191, 36, 0.12);
      color: #92400e;
    }
    html[data-theme='dark'] .api-warn {
      color: #fcd34d;
      border-color: rgba(251, 191, 36, 0.35);
    }
    .lines {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      padding: 0.45rem 0.65rem 0.35rem;
    }
    .line {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto auto auto auto;
      gap: 0.35rem 0.3rem;
      align-items: center;
      padding: 0.52rem 0.4rem;
      border: 1px solid transparent;
      border-bottom-color: var(--pos-border);
      border-radius: var(--pos-radius-sm);
      font-size: 0.74rem;
    }
    .line:hover {
      background: var(--pos-surface-2);
      border-color: var(--pos-border);
    }
    .line__info {
      min-width: 0;
    }
    .line__disc {
      display: block;
      margin-top: 0.12rem;
      font-size: 0.62rem;
      font-weight: 700;
      color: var(--pos-warn);
      font-family: var(--pos-mono);
    }
    .line-dcto {
      border-radius: 6px;
      border: 1px solid var(--pos-border-strong);
      background: var(--pos-surface-2);
      color: var(--pos-muted);
      font-size: 0.62rem;
      font-weight: 700;
      padding: 0.28rem 0.38rem;
      cursor: pointer;
      flex-shrink: 0;
    }
    .line-dcto:hover {
      color: var(--pos-text);
      border-color: var(--pos-text);
    }
    .line__name {
      display: block;
      font-weight: 600;
    }
    .line__sku {
      font-size: 0.64rem;
      color: var(--pos-faint);
      font-family: var(--pos-mono);
    }
    .line__unit {
      display: inline-flex;
      margin-top: 0.14rem;
      padding: 0.08rem 0.34rem;
      border-radius: 999px;
      border: 1px solid var(--pos-border);
      background: var(--pos-surface-2);
      color: var(--pos-muted);
      font-family: var(--pos-mono);
      font-size: 0.62rem;
      font-weight: 750;
      font-variant-numeric: tabular-nums;
    }
    .line__ctrl {
      display: flex;
      align-items: center;
      gap: 0.2rem;
    }
    .qty {
      width: var(--pos-qty-size);
      height: var(--pos-qty-size);
      border-radius: 8px;
      border: 1px solid var(--pos-border-strong);
      background: var(--pos-surface-2);
      color: var(--pos-text);
      font-size: 1rem;
      line-height: 1;
      cursor: pointer;
      display: grid;
      place-items: center;
      padding: 0;
    }
    .qty:hover {
      border-color: var(--pos-accent);
    }
    .line__qty-input {
      width: 3rem;
      height: var(--pos-qty-size);
      text-align: center;
      font-weight: 700;
      font-family: var(--pos-mono);
      font-size: 0.78rem;
      border-radius: 8px;
      border: 1px solid var(--pos-border-strong);
      background: var(--pos-elevated);
      color: var(--pos-text);
      padding: 0 0.2rem;
      font-variant-numeric: tabular-nums;
    }
    .line__qty-input::-webkit-outer-spin-button,
    .line__qty-input::-webkit-inner-spin-button {
      margin: 0;
    }
    .line__quick {
      display: flex;
      align-items: center;
      gap: 0.18rem;
    }
    .line-chip {
      min-width: 1.8rem;
      height: var(--pos-qty-size);
      border-radius: 8px;
      border: 1px solid var(--pos-border);
      background: var(--pos-surface-2);
      color: var(--pos-muted);
      font-size: 0.62rem;
      font-weight: 800;
      cursor: pointer;
      padding: 0 0.28rem;
    }
    .line-chip:hover {
      border-color: var(--pos-accent);
      color: var(--pos-accent-hover);
      background: var(--pos-accent-muted);
    }
    .line-remove {
      height: var(--pos-qty-size);
      border-radius: 8px;
      border: 1px solid rgba(185, 28, 28, 0.28);
      background: rgba(248, 113, 113, 0.1);
      color: #b91c1c;
      padding: 0 0.55rem;
      font-size: 0.68rem;
      font-weight: 800;
      cursor: pointer;
    }
    .line-remove:hover {
      border-color: #b91c1c;
      background: rgba(248, 113, 113, 0.16);
    }
    html[data-theme='dark'] .line-remove {
      color: #fca5a5;
    }
    .line__sum {
      font-weight: 700;
      font-family: var(--pos-mono);
      font-size: 0.8rem;
    }
    .empty {
      margin: 1rem 0.4rem;
      text-align: center;
      color: var(--pos-muted);
      font-size: 0.8rem;
    }
    .totals {
      flex-shrink: 0;
      margin-top: auto;
      padding: 0.8rem 0.85rem 0.9rem;
      border-top: 1px solid var(--pos-border);
      background: var(--pos-surface-2);
    }
    html[data-theme='dark'] .totals {
      background: var(--pos-surface);
    }
    .totals__row {
      display: flex;
      justify-content: space-between;
      font-size: 0.78rem;
      margin-bottom: 0.28rem;
    }
    .totals__row--muted {
      color: var(--pos-muted);
    }
    .totals__row--total {
      margin-top: 0.4rem;
      padding-top: 0.45rem;
      border-top: 1px dashed var(--pos-border);
      font-size: 1rem;
      font-weight: 800;
    }
    .btn-pay {
      width: 100%;
      margin-top: 0.65rem;
      padding: 0.78rem 0.95rem;
      border: none;
      border-radius: var(--pos-radius-sm);
      font-size: 0.9rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      text-transform: none;
      cursor: pointer;
      color: #fff;
      background: linear-gradient(135deg, var(--pos-accent) 0%, color-mix(in srgb, var(--pos-accent-hover) 88%, #0f172a) 100%);
      box-shadow: 0 10px 28px -8px var(--pos-accent-glow);
      transition:
        filter 0.16s ease,
        transform 0.14s ease,
        box-shadow 0.16s ease;
    }
    html[data-theme='dark'] .btn-pay {
      color: #fff;
      background: var(--lux-gradient-diagonal);
      box-shadow: 0 12px 32px -10px rgba(var(--lux-primary-rgb), 0.42);
    }
    .btn-pay:hover:not(:disabled) {
      filter: brightness(1.04);
      transform: translateY(-1px);
      box-shadow: 0 14px 34px -10px var(--pos-accent-glow);
    }
    .btn-pay--locked:hover {
      filter: none;
      transform: none;
      box-shadow: none;
    }
    .btn-pay:disabled {
      opacity: 0.45;
      cursor: not-allowed;
      box-shadow: none;
    }
    .hint {
      margin: 0.5rem 0 0;
      font-size: 0.64rem;
      line-height: 1.35;
      color: var(--pos-faint);
      text-align: center;
    }
    .calc-meta {
      margin: 0 0 0.5rem;
      font-size: 0.7rem;
      color: var(--pos-muted);
    }
    .calc-display {
      font-family: var(--pos-mono);
      font-size: 1.35rem;
      font-weight: 700;
      text-align: right;
      padding: 0.5rem 0.55rem;
      border-radius: var(--pos-radius-sm);
      border: 1px solid var(--pos-border-strong);
      background: var(--pos-bg);
      color: var(--pos-text);
      margin-bottom: 0.55rem;
      letter-spacing: 0.02em;
    }
    .calc-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 0.35rem;
      margin-bottom: 0.65rem;
    }
    .calc-key {
      padding: 0.55rem 0.25rem;
      border-radius: var(--pos-radius-sm);
      border: 1px solid var(--pos-border);
      background: var(--pos-surface);
      color: var(--pos-text);
      font-size: 1rem;
      font-weight: 700;
      cursor: pointer;
    }
    .calc-key:hover {
      background: var(--pos-surface-2);
    }
    .modal-back {
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.48);
      backdrop-filter: blur(4px);
      z-index: 80;
    }
    html[data-theme='dark'] .modal-back {
      background: rgba(0, 0, 0, 0.55);
    }
    .modal {
      position: fixed;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      z-index: 90;
      width: min(94vw, 32rem);
      max-height: min(86vh, 42rem);
      overflow: auto;
      border-radius: var(--pos-radius);
      border: 1px solid var(--pos-border-strong);
      background: var(--pos-elevated);
      box-shadow: var(--pos-flyout-shadow);
      padding: 1.1rem 1.15rem;
    }
    .modal--pay {
      width: min(96vw, 64rem);
      max-height: min(88vh, 44rem);
      padding: 0;
      overflow: hidden;
    }
    .pos-pay-modal {
      max-height: min(88vh, 44rem);
      display: flex;
      flex-direction: column;
      min-height: 0;
    }
    .pos-pay-modal__head {
      flex-shrink: 0;
      display: grid;
      grid-template-columns: minmax(10rem, 1fr) minmax(14rem, 1.2fr) auto;
      align-items: center;
      gap: 0.75rem;
      padding: 0.85rem;
      border-bottom: 1px solid var(--pos-border);
      background: var(--pos-elevated);
    }
    .pos-pay-head__meta {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem 0.75rem;
      color: var(--pos-muted);
      font-size: 0.72rem;
      font-weight: 650;
    }
    .pos-pay-layout {
      flex: 1 1 auto;
      min-height: 0;
      overflow: auto;
      display: grid;
      grid-template-columns: minmax(0, 1.45fr) minmax(16rem, 0.55fr);
      gap: 0.7rem;
      padding: 0.8rem 0.85rem;
    }
    .pos-pay-entry,
    .pos-pay-summary {
      min-width: 0;
    }
    .pos-pay-form {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 0.45rem;
      align-items: end;
      padding: 0.55rem;
      border: 1px solid var(--pos-border);
      border-radius: var(--pos-radius-sm);
      background: var(--pos-surface-2);
      margin-bottom: 0.55rem;
    }
    .pos-pay-form .modal-field {
      margin-bottom: 0;
    }
    .pos-pay-form__metric {
      min-height: 2.45rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.45rem;
      padding: 0.45rem 0.55rem;
      border-radius: 8px;
      border: 1px solid var(--pos-border);
      background: var(--pos-elevated);
      font-size: 0.72rem;
      color: var(--pos-muted);
    }
    .pos-pay-form__metric strong {
      color: var(--pos-accent-hover);
      font-family: var(--pos-mono);
    }
    .pos-pay-form__actions {
      grid-column: 1 / -1;
      display: flex;
      justify-content: flex-end;
      gap: 0.45rem;
    }
    .pos-pay-lines {
      border: 1px solid var(--pos-border);
      border-radius: var(--pos-radius-sm);
      overflow: hidden;
      background: var(--pos-surface-2);
    }
    .pos-pay-lines__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      padding: 0.5rem 0.6rem;
      border-bottom: 1px solid var(--pos-border);
      color: var(--pos-muted);
      font-size: 0.68rem;
      font-weight: 850;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .pos-pay-table {
      overflow-x: auto;
    }
    .pos-pay-table__row {
      min-width: 46rem;
      display: grid;
      grid-template-columns: 6.5rem 6rem 5.8rem 5.8rem 5.5rem minmax(7rem, 1fr) 2rem;
      gap: 0.45rem;
      align-items: center;
      padding: 0.42rem 0.55rem;
      border-bottom: 1px solid var(--pos-border);
      color: var(--pos-muted);
      font-size: 0.7rem;
    }
    .pos-pay-table__row strong {
      color: var(--pos-text);
      font-family: var(--pos-mono);
    }
    .pos-pay-table__row--head {
      color: var(--pos-faint);
      font-weight: 850;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      background: var(--pos-elevated);
    }
    .pos-pay-table__empty {
      padding: 0.8rem;
      color: var(--pos-faint);
      font-size: 0.78rem;
    }
    .pos-pay-remove {
      width: 1.75rem;
      height: 1.75rem;
      border-radius: 8px;
      border: 1px solid var(--pos-border);
      background: var(--pos-elevated);
      color: #b91c1c;
      cursor: pointer;
      font-weight: 850;
    }
    .pos-pay-summary {
      display: flex;
      flex-direction: column;
      gap: 0.45rem;
    }
    .pos-pay-summary__row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.65rem;
      padding: 0.55rem 0.6rem;
      border: 1px solid var(--pos-border);
      border-radius: var(--pos-radius-sm);
      background: var(--pos-surface-2);
      color: var(--pos-muted);
      font-size: 0.72rem;
    }
    .pos-pay-summary__row strong,
    .pos-pay-footer strong {
      color: var(--pos-text);
      font-family: var(--pos-mono);
      font-variant-numeric: tabular-nums;
    }
    .pos-pay-summary__row--warn strong {
      color: #b45309;
    }
    .pos-pay-summary__row--ok strong {
      color: var(--pos-accent-hover);
    }
    .pos-pay-receipt {
      display: grid;
      gap: 0.35rem;
      padding: 0.6rem;
      border: 1px solid var(--pos-border);
      border-radius: var(--pos-radius-sm);
      background: var(--pos-surface-2);
    }
    .pos-pay-receipt small {
      color: var(--pos-faint);
      font-size: 0.66rem;
    }
    .pos-pay-receipt__line {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 0.2rem 0.45rem;
      padding-top: 0.35rem;
      border-top: 1px dashed var(--pos-border);
      font-size: 0.72rem;
    }
    .pos-pay-receipt__line small {
      grid-column: 1 / -1;
    }
    .pos-pay-footer {
      flex-shrink: 0;
      display: grid;
      grid-template-columns: repeat(4, minmax(5.6rem, auto)) auto auto;
      gap: 0.45rem;
      align-items: center;
      padding: 0.65rem 0.85rem;
      border-top: 1px solid var(--pos-border);
      background: var(--pos-elevated);
    }
    .pos-pay-footer div {
      display: flex;
      flex-direction: column;
      gap: 0.08rem;
      color: var(--pos-faint);
      font-size: 0.62rem;
      font-weight: 850;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .modal--pay .modal-actions {
      position: sticky;
      bottom: -0.85rem;
      z-index: 2;
      align-items: center;
      padding: 0.65rem 0 0;
      background: linear-gradient(180deg, transparent, var(--pos-elevated) 26%);
    }
    .modal__hero {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      padding: 0.58rem 0.72rem;
      border-radius: var(--pos-radius-sm);
      border: 1px solid var(--pos-border);
      background: var(--pos-surface-2);
      margin-bottom: 0.55rem;
    }
    .modal__eyebrow {
      display: block;
      margin-bottom: 0.2rem;
      color: var(--pos-faint);
      font-size: 0.62rem;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .modal__amount {
      flex-shrink: 0;
      font-family: var(--pos-mono);
      font-size: 1.05rem;
      line-height: 1.1;
      font-variant-numeric: tabular-nums;
      color: var(--pos-accent-hover);
    }
    .modal__title {
      margin: 0 0 0.25rem;
      font-size: 0.95rem;
      font-weight: 800;
      color: var(--pos-text);
    }
    .modal__sub {
      margin: 0 0 0.65rem;
      font-size: 0.72rem;
      color: var(--pos-muted);
      font-family: var(--pos-mono);
    }
    .modal__p {
      margin: 0 0 0.85rem;
      font-size: 0.8rem;
      line-height: 1.45;
      color: var(--pos-muted);
    }
    .modal__p--warn {
      padding: 0.55rem 0.6rem;
      border-radius: var(--pos-radius-sm);
      border: 1px solid rgba(217, 119, 6, 0.35);
      background: rgba(251, 191, 36, 0.12);
      color: #92400e;
    }
    html[data-theme='dark'] .modal__p--warn {
      border-color: rgba(251, 191, 36, 0.35);
      background: rgba(251, 191, 36, 0.08);
      color: #fcd34d;
    }
    .pay-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.45rem;
      margin-bottom: 0.45rem;
    }
    .payment-method-strip {
      display: grid;
      grid-template-columns: repeat(7, minmax(0, 1fr));
      gap: 0.35rem;
      margin-bottom: 0.45rem;
      padding: 0.25rem;
      border: 1px solid var(--pos-border);
      border-radius: var(--pos-radius-sm);
      background: var(--pos-surface-2);
    }
    .payment-method-chip {
      min-height: 2rem;
      border: 1px solid transparent;
      border-radius: 8px;
      background: transparent;
      color: var(--pos-muted);
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.25rem;
      font-size: 0.68rem;
      font-weight: 850;
      cursor: pointer;
    }
    .payment-method-chip__icon {
      width: 1.15rem;
      height: 1.15rem;
      display: inline-grid;
      place-items: center;
      border-radius: 999px;
      background: var(--pos-elevated);
      border: 1px solid var(--pos-border);
      font-size: 0.62rem;
      line-height: 1;
    }
    .payment-method-chip--on {
      border-color: rgba(20, 184, 166, 0.28);
      background: var(--pos-elevated);
      color: var(--pos-text);
    }
    .payment-method-chip--muted,
    .payment-method-chip:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .payment-method-chip--ready {
      border-color: var(--pos-status-ok-border);
      color: var(--pos-status-ok);
    }
    .pay-status {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 0.38rem;
      margin-bottom: 0.45rem;
    }
    .pay-status div {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.45rem;
      padding: 0.42rem 0.5rem;
      border-radius: var(--pos-radius-sm);
      border: 1px solid var(--pos-border);
      background: color-mix(in srgb, var(--pos-surface) 84%, var(--pos-surface-2));
      min-width: 0;
    }
    .pay-status span {
      display: block;
      font-size: 0.6rem;
      font-weight: 800;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--pos-faint);
    }
    .pay-status strong {
      display: block;
      font-family: var(--pos-mono);
      font-size: 0.82rem;
      font-variant-numeric: tabular-nums;
      color: var(--pos-text);
      overflow-wrap: anywhere;
    }
    .pay-status__change--ok strong {
      font-variant-numeric: tabular-nums;
      color: var(--pos-accent-hover);
    }
    .pay-method {
      margin: 0;
      padding: 0.48rem;
      border: 1px solid var(--pos-border);
      border-radius: var(--pos-radius-sm);
      background: var(--pos-surface-2);
    }
    .pay-method--cash {
      border-color: color-mix(in srgb, var(--pos-accent) 32%, var(--pos-border));
      background: color-mix(in srgb, var(--pos-accent-muted) 52%, var(--pos-surface-2));
    }
    .pay-method__title {
      color: var(--pos-text);
      font-size: 0.78rem;
      font-weight: 850;
    }
    .pay-method__sub {
      margin-top: -0.16rem;
      color: var(--pos-faint);
      font-size: 0.63rem;
      font-weight: 600;
    }
    .card-pay {
      display: grid;
      grid-template-columns: minmax(8rem, 0.8fr) minmax(14rem, 1.2fr) minmax(12rem, 1fr);
      gap: 0.5rem;
      align-items: end;
      padding: 0.55rem;
      border-radius: var(--pos-radius-sm);
      border: 1px solid color-mix(in srgb, var(--pos-accent) 28%, var(--pos-border));
      background: color-mix(in srgb, var(--pos-accent-muted) 34%, var(--pos-surface-2));
      margin-bottom: 0.45rem;
    }
    .card-pay__head,
    .card-pay__actions,
    .card-pay__provider {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.55rem;
    }
    .card-pay__head {
      margin-bottom: 0;
      align-self: stretch;
      flex-direction: column;
      align-items: flex-start;
      justify-content: center;
    }
    .card-pay__head strong {
      padding: 0.22rem 0.45rem;
      border-radius: 999px;
      background: var(--pos-elevated);
      border: 1px solid var(--pos-border);
      color: var(--pos-muted);
      font-size: 0.62rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .card-pay__state--ok {
      color: var(--pos-status-ok) !important;
      border-color: rgba(4, 120, 87, 0.26) !important;
      background: rgba(16, 185, 129, 0.12) !important;
    }
    .card-pay__state--bad {
      color: #b91c1c !important;
      border-color: rgba(185, 28, 28, 0.24) !important;
      background: rgba(248, 113, 113, 0.12) !important;
    }
    .card-pay__amount,
    .card-pay__manual {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 6.4rem 4.6rem;
      gap: 0.35rem;
      align-items: end;
      margin-bottom: 0;
    }
    .card-pay__manual {
      grid-column: 1 / -1;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      align-items: start;
      margin-top: 0;
    }
    .card-pay__channels {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 0.35rem;
    }
    .card-channel {
      height: 2.35rem;
      min-height: 2.35rem;
      border-radius: var(--pos-radius-sm);
      border: 1px solid var(--pos-border);
      background: var(--pos-elevated);
      color: var(--pos-muted);
      font-size: 0.74rem;
      font-weight: 850;
      line-height: 1.05;
      cursor: pointer;
    }
    .card-channel--on {
      border-color: var(--pos-accent);
      background: var(--pos-accent-muted);
      color: var(--pos-accent-hover);
    }
    .card-pay__provider {
      grid-column: 1 / -1;
      margin-top: 0;
      padding: 0.38rem 0.5rem;
      border: 1px solid var(--pos-border);
      border-radius: var(--pos-radius-sm);
      background: var(--pos-elevated);
      color: var(--pos-text);
      font-size: 0.72rem;
      font-weight: 800;
    }
    .card-pay__provider small,
    .card-pay__msg {
      color: var(--pos-faint);
      font-size: 0.68rem;
      font-weight: 700;
    }
    .card-pay__actions {
      grid-column: 1 / -1;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(8.5rem, 1fr));
      margin-top: 0;
    }
    .card-pay__msg {
      grid-column: 1 / -1;
      margin: 0.48rem 0 0;
      line-height: 1.35;
    }
    .cash-denoms {
      padding: 0.5rem;
      border-radius: var(--pos-radius-sm);
      border: 1px solid var(--pos-border);
      background: var(--pos-surface-2);
      margin-bottom: 0.45rem;
    }
    .cash-denoms__head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 0.6rem;
      margin-bottom: 0.38rem;
      color: var(--pos-muted);
      font-size: 0.68rem;
      font-weight: 800;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .cash-denoms__clear {
      border: none;
      background: transparent;
      color: var(--pos-accent-hover);
      font-size: 0.68rem;
      font-weight: 800;
      cursor: pointer;
      text-transform: none;
      letter-spacing: 0;
    }
    .cash-denoms__grid,
    .cash-denoms__suggested {
      display: grid;
      grid-template-columns: 1.25fr repeat(6, minmax(0, 0.75fr));
      gap: 0.32rem;
    }
    .cash-denoms__suggested {
      display: flex;
      flex-wrap: wrap;
      margin-top: 0.35rem;
    }
    .cash-denom,
    .cash-chip {
      min-height: 2rem;
      height: 2rem;
      border-radius: var(--pos-radius-sm);
      border: 1px solid var(--pos-border-strong);
      background: var(--pos-elevated);
      color: var(--pos-text);
      padding: 0 0.55rem;
      font-size: 0.82rem;
      font-weight: 850;
      cursor: pointer;
      font-variant-numeric: tabular-nums;
    }
    .cash-denom:hover,
    .cash-chip:hover {
      border-color: var(--pos-accent);
      background: var(--pos-accent-muted);
      color: var(--pos-accent-hover);
    }
    .cash-denom--exact {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      padding: 0 0.65rem;
      color: var(--pos-accent-hover);
    }
    .cash-denom--exact strong {
      font-family: var(--pos-mono);
      font-size: 0.78rem;
    }
    .pay-quick {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem;
      margin-bottom: 0.2rem;
    }
    .modal--pay .modal-field {
      margin-bottom: 0;
    }
    .modal--pay .modal-input {
      padding: 0.36rem 0.48rem;
      height: 2.35rem;
    }
    .modal--pay .btn-modal {
      padding: 0.36rem 0.65rem;
      font-size: 0.74rem;
    }
    .card-pay .cash-chip,
    .card-pay .btn-modal {
      width: 100%;
      height: 2.35rem;
      min-height: 2.35rem;
      display: grid;
      place-items: center;
      padding: 0 0.58rem;
      font-size: 0.72rem;
      line-height: 1.08;
      text-align: center;
      white-space: normal;
    }
    .cash-denoms__suggested .cash-chip {
      width: auto;
      min-width: 4.6rem;
      height: 1.85rem;
      min-height: 1.85rem;
      font-size: 0.74rem;
    }
    @media (max-width: 760px) {
      .modal--pay {
        width: min(96vw, 34rem);
      }
      .pay-status,
      .pay-grid,
      .payment-method-strip,
      .pos-pay-modal__head,
      .pos-pay-layout,
      .pos-pay-form,
      .pos-pay-footer,
      .card-pay,
      .card-pay__amount,
      .card-pay__manual,
      .card-pay__channels,
      .card-pay__actions,
      .cash-denoms__grid {
        grid-template-columns: 1fr;
      }
      .pos-pay-layout {
        padding: 0.65rem;
      }
      .pos-pay-footer {
        align-items: stretch;
      }
      .payment-method-chip {
        justify-content: flex-start;
      }
      .pay-status div {
        align-items: flex-start;
        flex-direction: column;
      }
    }
    .stock-t {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.78rem;
      margin-bottom: 0.75rem;
    }
    .stock-t th,
    .stock-t td {
      padding: 0.35rem 0.4rem;
      border-bottom: 1px solid var(--pos-border);
      text-align: left;
    }
    .stock-t__n {
      font-family: var(--pos-mono);
      font-weight: 700;
    }
    .modal-list {
      margin: 0 0 0.85rem;
      padding-left: 1.1rem;
      color: var(--pos-muted);
      font-size: 0.8rem;
      line-height: 1.5;
    }
    .modal-field {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      margin-bottom: 0.55rem;
      font-size: 0.72rem;
      font-weight: 600;
      color: var(--pos-muted);
    }
    .modal-input {
      border-radius: 8px;
      border: 1px solid var(--pos-border-strong);
      background: var(--pos-bg);
      color: var(--pos-text);
      padding: 0.45rem 0.55rem;
      font-size: 0.85rem;
    }
    .modal-actions {
      display: flex;
      justify-content: flex-end;
      gap: 0.45rem;
      margin-top: 0.35rem;
    }
    .btn-modal {
      border: none;
      border-radius: var(--pos-radius-sm);
      padding: 0.45rem 0.85rem;
      font-weight: 700;
      font-size: 0.8rem;
      cursor: pointer;
      background: var(--pos-accent);
      color: #fff;
    }
    html[data-theme='dark'] .btn-modal {
      color: #042f2e;
    }
    .btn-modal--ghost {
      background: transparent;
      color: var(--pos-muted);
      border: 1px solid var(--pos-border-strong);
    }
    .btn-modal--disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }
  `,
})
export class PosVentaPage {
  private readonly http = inject(HttpClient);
  private readonly backend = inject(PosBackendApiService);
  private audioCtx?: AudioContext;
  readonly desk = inject(PosDeskSessionService);
  readonly auth = inject(PosAuthService);
  readonly runtimeConfig = inject(PosConfigService);
  readonly prefs = inject(PosLayoutPreferencesService);
  readonly offline = inject(PosOfflineSyncService);
  private readonly toast = inject(PosToastService);

  readonly invoicingEnabled = signal(false);

  /** URL de pos-app configurada en environment (no null). */
  posApiConfigured(): boolean {
    return this.auth.apiBaseUrl.trim().length > 0;
  }

  readonly catalog = signal<DemoProduct[]>([]);
  readonly catalogLoading = signal(false);
  readonly activeCat = signal<string>('Todos');

  readonly categories = computed(() => {
    const tags = new Set(this.catalog().map((p) => p.tag));
    return ['Todos', ...Array.from(tags).sort()];
  });

  readonly catalogPageSize = 8;
  readonly catalogQuery = signal('');
  readonly catalogPage = signal(1);

  private readonly catalogSearchRef = viewChild<ElementRef<HTMLInputElement>>('catalogSearch');

  private tabSeq = 1;
  readonly saleCustomerTipoLabel = saleCustomerTipoLabel;
  readonly tabs = signal<SaleTab[]>([{ id: 't-1', label: 'Venta 1', cart: [], customer: SALE_CONSUMIDOR_FINAL }]);
  readonly activeTabId = signal('t-1');
  readonly custQuery = signal('');
  readonly custResults = signal<PosCustomerResponse[]>([]);
  readonly custResultsOpen = signal(false);
  readonly custSearchLoading = signal(false);
  readonly custSearchMsg = signal<string | null>(null);
  private custSearchTimer: ReturnType<typeof setTimeout> | null = null;
  readonly modal = signal<ModalState | null>(null);
  readonly newCustFormErrors = signal<PosCustomerFormErrors>({});
  readonly newCustCatastroLoading = signal(false);
  readonly newCustSaving = signal(false);
  newCustDraft: PosCustomerFormState = emptyCustomerForm('05');
  readonly calcBuffer = signal('0');
  readonly calcKeys = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '.', '0', '⌫'] as const;
  readonly tenderDenominations = [1, 5, 10, 20, 50, 100] as const;
  readonly paymentMethods: PosPaymentMethodOption[] = [
    { code: 'cash', label: 'Efectivo', icon: '$', formaPago: '01', canal: 'CASH', proveedor: null },
    { code: 'card', label: 'Tarjeta', icon: '#', formaPago: '19', canal: 'CARD', proveedor: null },
    { code: 'transfer', label: 'Transfer.', icon: '>', formaPago: '20', canal: 'TRANSFER', proveedor: null },
    { code: 'stripe', label: 'Stripe', icon: 'S', formaPago: '19', canal: 'STRIPE', proveedor: 'STRIPE' },
    { code: 'kushki', label: 'Kushki', icon: 'K', formaPago: '19', canal: 'KUSHKI', proveedor: 'KUSHKI' },
    { code: 'payphone', label: 'PayPhone', icon: 'P', formaPago: '19', canal: 'PAYPHONE', proveedor: 'PAYPHONE' },
    { code: 'other', label: 'Otro', icon: '+', formaPago: '20', canal: 'OTHER', proveedor: null },
  ];
  readonly payCash = signal('0');
  readonly payCard = signal('0');
  readonly payTransfer = signal('0');
  readonly selectedPaymentMethod = signal<PosPaymentMethodCode>('cash');
  readonly draftAmount = signal('0');
  readonly draftReceived = signal('0');
  readonly draftReference = signal('');
  readonly draftAuthCode = signal('');
  readonly draftProviderTransactionId = signal('');
  readonly draftExternalStatus = signal<PosExternalPaymentStatus>('idle');
  readonly paymentLines = signal<PosPaymentLineDraft[]>([]);
  readonly paymentCollection = signal<PosPaymentCollectionResponse | null>(null);
  readonly cardChannel = signal<CardPaymentChannel>('terminal');
  readonly cardStatus = signal<CardPaymentStatus>('idle');
  readonly cardAuthCode = signal('');
  readonly cardReference = signal('');
  readonly cardLast4 = signal('');
  readonly cardOperationMessage = signal('');

  readonly checkoutError = signal<string | null>(null);
  readonly checkoutLoading = signal(false);
  readonly saleActionMessage = signal<string | null>(null);
  readonly lastTicketId = signal<string | null>(null);

  readonly ping = signal<{ status: string; companyId: string } | null>(null);
  readonly error = signal<string | null>(null);

  readonly activeTab = computed(() => {
    const id = this.activeTabId();
    return this.tabs().find((t) => t.id === id) ?? this.tabs()[0];
  });

  readonly activeCustomer = computed(() => this.activeTab().customer);

  readonly cart = computed(() => this.activeTab().cart);

  readonly filteredCatalog = computed(() => {
    const c = this.activeCat();
    const q = this.catalogQuery().trim().toLowerCase();
    const items = this.catalog();
    const base = c === 'Todos' ? items : items.filter((p) => p.tag === c);
    if (!q) {
      return base;
    }
    return base.filter((p) => {
      const bc = (p.barcode ?? p.sku).toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        bc.includes(q)
      );
    });
  });

  readonly catalogTotalPages = computed(() =>
    Math.max(1, Math.ceil(this.filteredCatalog().length / this.catalogPageSize)),
  );

  readonly catalogPageClamped = computed(() =>
    Math.min(Math.max(1, this.catalogPage()), this.catalogTotalPages()),
  );

  readonly pagedProducts = computed(() => {
    const list = this.filteredCatalog();
    const page = this.catalogPageClamped();
    const start = (page - 1) * this.catalogPageSize;
    return list.slice(start, start + this.catalogPageSize);
  });

  readonly lineCount = computed(() => this.cart().reduce((n, l) => n + l.qty, 0));

  readonly discountSum = computed(() =>
    this.cart().reduce((s, l) => s + Math.max(0, this.lineGross(l) - this.lineNet(l)), 0),
  );

  readonly subtotal = computed(() => this.cart().reduce((s, l) => s + this.lineNet(l), 0));

  readonly iva = computed(() => Math.round(this.subtotal() * 0.15 * 100) / 100);
  readonly total = computed(() => Math.round((this.subtotal() + this.iva()) * 100) / 100);

  readonly totalPagado = computed(() => this.round2(this.paymentLines().reduce((sum, line) => sum + line.total, 0)));
  readonly vueltoTotal = computed(() => this.round2(this.paymentLines().reduce((sum, line) => sum + line.vuelto, 0)));
  readonly saldoPendiente = computed(() => this.round2(Math.max(0, this.total() - this.totalPagado())));
  readonly externalPaymentPending = computed(() =>
    this.paymentLines().some((line) => ['stripe', 'kushki', 'payphone'].includes(line.method) && line.status === 'pending'),
  );
  readonly draftChange = computed(() => {
    if (this.selectedPaymentMethod() !== 'cash') {
      return 0;
    }
    return this.round2(Math.max(0, this.parseUsd(this.draftReceived()) - this.parseUsd(this.draftAmount())));
  });
  readonly collectionLines = computed(() => this.paymentCollection()?.lines ?? this.paymentCollection()?.lineas ?? []);

  readonly paySum = computed(() => this.totalPagado());

  readonly payChange = computed(() => {
    return this.vueltoTotal();
  });

  readonly payPending = computed(() => {
    return this.saldoPendiente();
  });

  readonly suggestedTenderAmounts = computed(() => {
    const total = this.saldoPendiente() || this.total();
    if (total <= 0) {
      return [];
    }
    const fixed = new Set<number>(this.tenderDenominations.map((amount) => Number(amount)));
    const candidates = [
      Math.ceil(total * 2) / 2,
      Math.ceil(total),
      Math.ceil(total / 2) * 2,
      Math.ceil(total / 5) * 5,
    ]
      .map((amount) => Math.round(amount * 100) / 100)
      .filter((amount) => amount > total && !fixed.has(amount));
    return Array.from(new Set(candidates)).slice(0, 3);
  });

  readonly cardProviderLabel = computed(() => {
    switch (this.prefs.cardProvider()) {
      case 'kushki':
        return 'Kushki';
      case 'nuvei':
        return 'Nuvei / Paymentez';
      case 'placetopay':
        return 'PlacetoPay';
      case 'payphone':
        return 'PayPhone';
      case 'manual':
        return 'Manual';
      default:
        return 'Datafast';
    }
  });

  readonly cardChannelLabel = computed(() => {
    switch (this.cardChannel()) {
      case 'link':
        return 'link/QR';
      case 'manual':
        return 'registro manual';
      default:
        return 'terminal';
    }
  });

  readonly cardStatusLabel = computed(() => {
    switch (this.cardStatus()) {
      case 'pending':
        return 'Pendiente';
      case 'approved':
        return 'Aprobado';
      case 'rejected':
        return 'Rechazado';
      default:
        return 'Sin iniciar';
    }
  });

  constructor() {
    this.restorePendingSaleTabs();

    effect(() => {
      this.activeCat();
      this.catalogQuery();
      untracked(() => this.catalogPage.set(1));
    });

    effect(() => {
      const tabs = this.tabs();
      const activeTabId = this.activeTabId();
      untracked(() => this.persistPendingSaleTabs(tabs, activeTabId));
    });

    afterNextRender(() => {
      this.focusCatalogSearch();
      void this.offline.refreshPendingCount();
      if (this.posApiConfigured() && navigator.onLine) {
        void this.offline.syncPending();
      }
    });

    window.addEventListener('online', () => {
      if (this.posApiConfigured()) {
        void this.offline.syncPending();
      }
    });

    const base = this.auth.apiBaseUrl.replace(/\/+$/, '');
    if (!base) {
      return;
    }
    this.http.get<{ status: string; companyId: string }>(`${base}/api/v1/pos/ping`).subscribe({
      next: (r) => this.ping.set(r),
      error: (err: unknown) => this.error.set(this.connectionErrMessage(err)),
    });
    this.loadCatalog();
    void this.runtimeConfig.ensureLoaded().then((cfg) => this.invoicingEnabled.set(cfg.invoicingEnabled));
  }

  openLastTicket(): void {
    const id = this.lastTicketId();
    const token = this.auth.accessToken();
    const base = this.auth.apiBaseUrl.replace(/\/+$/, '');
    if (!id || !token || !base) {
      return;
    }
    fetch(`${base}/api/v1/pos/comprobantes/${encodeURIComponent(id)}/ticket`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error('No se pudo cargar el ticket'))))
      .then((html) => {
        const w = window.open('', '_blank', 'noopener,noreferrer');
        if (w) {
          w.document.write(html);
          w.document.close();
          w.focus();
          w.print();
        }
      })
      .catch(() => this.saleActionMessage.set('No se pudo abrir el ticket para impresión.'));
  }

  private loadCatalog(): void {
    if (!this.posApiConfigured()) {
      return;
    }
    this.catalogLoading.set(true);
    this.backend.getProducts().subscribe({
      next: (rows) => {
        this.catalog.set(
          rows.map((p) => ({
            id: p.id,
            name: p.name,
            sku: p.sku,
            barcode: p.barcode ?? undefined,
            price: Number(p.price),
            tag: p.tag || 'Retail',
          })),
        );
        this.catalogLoading.set(false);
      },
      error: () => {
        this.catalogLoading.set(false);
      },
    });
  }

  stockRows(p: DemoProduct): { warehouse: string; qty: number }[] {
    const base = 12 + (Number(p.id) || 0) * 3;
    return [
      { warehouse: 'Bodega matriz', qty: base },
      { warehouse: 'Sucursal norte', qty: Math.max(0, base - 7) },
      { warehouse: 'Outlet', qty: Math.max(0, base - 15) },
    ];
  }

  onCustQuery(ev: Event): void {
    const v = (ev.target as HTMLInputElement).value;
    this.custQuery.set(v);
    if (this.custSearchTimer) {
      clearTimeout(this.custSearchTimer);
    }
    const trimmed = v.trim();
    if (trimmed.length < 2) {
      this.custResults.set([]);
      this.custResultsOpen.set(false);
      this.custSearchMsg.set(null);
      return;
    }
    this.custSearchTimer = setTimeout(() => this.runCustomerSearch(trimmed), 300);
  }

  private focusCatalogSearch(): void {
    queueMicrotask(() => {
      const el = this.catalogSearchRef()?.nativeElement;
      if (el) {
        el.focus({ preventScroll: true });
      }
    });
  }

  onCatalogQuery(ev: Event): void {
    this.catalogQuery.set((ev.target as HTMLInputElement).value);
  }

  onCatalogEnter(ev: Event): void {
    ev.preventDefault();
    if (!this.requireOpenCaja()) {
      return;
    }
    const raw = this.catalogQuery().trim();
    if (!raw) {
      return;
    }
    const lower = raw.toLowerCase();
    const list = this.filteredCatalog();
    const exact = list.find(
      (p) =>
        p.sku.trim().toLowerCase() === lower ||
        (p.barcode && p.barcode.trim().toLowerCase() === lower) ||
        p.id === raw,
    );
    if (exact) {
      this.addLine(exact);
      this.catalogQuery.set('');
      return;
    }
    if (list.length === 1) {
      this.addLine(list[0]!);
      this.catalogQuery.set('');
    }
  }

  catalogPrev(): void {
    this.catalogPage.update((p) => Math.max(1, p - 1));
  }

  catalogNext(): void {
    const max = this.catalogTotalPages();
    this.catalogPage.update((p) => Math.min(max, p + 1));
  }

  private patchTabs(updater: (tabs: SaleTab[]) => SaleTab[]): void {
    this.tabs.update(updater);
  }

  private patchActiveTab(map: (t: SaleTab) => SaleTab): void {
    const id = this.activeTabId();
    this.patchTabs((ts) => ts.map((t) => (t.id === id ? map(t) : t)));
  }

  private requireOpenCaja(): boolean {
    if (this.desk.cajaOpen()) {
      this.saleActionMessage.set(null);
      return true;
    }
    this.saleActionMessage.set('Debe aperturar caja para proceder. Abra caja desde la barra superior o cierre esta accion.');
    return false;
  }

  private restorePendingSaleTabs(): void {
    try {
      const raw = localStorage.getItem(POS_SALE_TABS_STORAGE_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as { tabs?: SaleTab[]; activeTabId?: string };
      const tabs = Array.isArray(parsed.tabs) ? parsed.tabs.filter((tab) => Array.isArray(tab.cart)) : [];
      if (!tabs.length) {
        return;
      }
      this.tabs.set(tabs);
      const active = tabs.some((tab) => tab.id === parsed.activeTabId) ? parsed.activeTabId! : tabs[0]!.id;
      this.activeTabId.set(active);
      const maxSeq = tabs.reduce((max, tab) => {
        const n = Number.parseInt(tab.id.replace(/^t-/, ''), 10);
        return Number.isFinite(n) ? Math.max(max, n) : max;
      }, 1);
      this.tabSeq = maxSeq;
    } catch {
      localStorage.removeItem(POS_SALE_TABS_STORAGE_KEY);
    }
  }

  private persistPendingSaleTabs(tabs: SaleTab[], activeTabId: string): void {
    try {
      localStorage.setItem(POS_SALE_TABS_STORAGE_KEY, JSON.stringify({ tabs, activeTabId }));
    } catch {
      // Sin espacio o localStorage bloqueado: la venta sigue operando en memoria.
    }
  }

  private parseUsd(raw: string): number {
    const t = raw.trim().replace(',', '.');
    if (t === '' || t === '.') {
      return 0;
    }
    const n = Number.parseFloat(t);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
  }

  formatUsd(value: number): string {
    return String(Math.round(value * 100) / 100);
  }

  canConfirmCobro(): boolean {
    return this.confirmCobroError() === null;
  }

  private confirmCobroError(): string | null {
    const api = this.auth.apiBaseUrl.trim().length > 0;
    const puntoOk = !api || this.effectivePuntoEmisionId().length > 0;
    if (!this.desk.cajaOpen()) {
      return 'Abra caja para registrar ventas.';
    }
    if (this.lineCount() === 0) {
      return 'Agregue productos antes de cobrar.';
    }
    if (!puntoOk) {
      return 'Elija un punto de emision en Ajustes.';
    }
    if (this.externalPaymentPending()) {
      return 'Hay una transaccion externa pendiente por confirmar.';
    }
    if (this.totalPagado() + 0.0001 < this.total()) {
      return `Falta cubrir ${this.formatUsd(this.saldoPendiente())}. Agregue una linea de pago.`;
    }
    return null;
  }

  openCobro(): void {
    this.checkoutError.set(null);
    this.checkoutLoading.set(false);
    if (this.lineCount() === 0) {
      this.saleActionMessage.set('Agregue productos antes de cobrar.');
      return;
    }
    if (!this.desk.cajaOpen()) {
      this.requireOpenCaja();
      this.desk.refresh();
      return;
    }
    this.clearPayments();
    this.paymentCollection.set(null);
    this.selectPaymentMethod('cash');
    this.fillDraftPending();
    this.modal.set({ kind: 'cobro' });
  }

  selectPaymentMethod(method: PosPaymentMethodCode): void {
    this.selectedPaymentMethod.set(method);
    this.draftReference.set(method === 'cash' ? 'Efectivo' : '');
    this.draftAuthCode.set('');
    this.draftProviderTransactionId.set('');
    this.draftExternalStatus.set('idle');
    this.fillDraftPending();
  }

  onDraftAmount(ev: Event): void {
    this.draftAmount.set((ev.target as HTMLInputElement).value);
    if (this.selectedPaymentMethod() === 'cash' && this.parseUsd(this.draftReceived()) < this.parseUsd(this.draftAmount())) {
      this.draftReceived.set((ev.target as HTMLInputElement).value);
    }
  }

  onDraftReceived(ev: Event): void {
    this.draftReceived.set((ev.target as HTMLInputElement).value);
  }

  onDraftReference(ev: Event): void {
    this.draftReference.set((ev.target as HTMLInputElement).value.trim());
  }

  onDraftAuthCode(ev: Event): void {
    this.draftAuthCode.set((ev.target as HTMLInputElement).value.trim());
  }

  onDraftProviderTransactionId(ev: Event): void {
    this.draftProviderTransactionId.set((ev.target as HTMLInputElement).value.trim());
  }

  onDraftExternalStatus(ev: Event): void {
    this.draftExternalStatus.set((ev.target as HTMLSelectElement).value as PosExternalPaymentStatus);
  }

  fillDraftPending(): void {
    const amount = this.formatUsd(this.saldoPendiente() || this.total());
    this.draftAmount.set(amount);
    this.draftReceived.set(amount);
  }

  prepareExternalPayment(): void {
    this.draftExternalStatus.set('confirmed');
    if (!this.draftProviderTransactionId().trim()) {
      this.draftProviderTransactionId.set(`POS-${Date.now()}`);
    }
    this.checkoutError.set(null);
  }

  clearDraftCash(): void {
    this.draftAmount.set('0');
    this.draftReceived.set('0');
    this.checkoutError.set(null);
  }

  setDraftCashExact(): void {
    const amount = this.formatUsd(this.saldoPendiente() || this.total());
    this.draftAmount.set(amount);
    this.draftReceived.set(amount);
    this.checkoutError.set(null);
  }

  setDraftCashTender(amount: number): void {
    const payable = this.round2(this.saldoPendiente() || this.total());
    const received = this.round2(amount);
    this.draftAmount.set(this.formatUsd(Math.min(payable, received)));
    this.draftReceived.set(this.formatUsd(received));
    this.checkoutError.set(null);
  }

  canAddPaymentLine(): boolean {
    return this.addPaymentLineError() === null;
  }

  private addPaymentLineError(): string | null {
    const method = this.selectedPaymentMethod();
    const amount = this.parseUsd(this.draftAmount());
    const received = method === 'cash' ? this.parseUsd(this.draftReceived()) : amount;
    if (amount <= 0 || received + 0.0001 < amount) {
      return method === 'cash'
        ? 'Ingrese un monto y un recibido mayor o igual al monto a cobrar.'
        : 'Ingrese un monto mayor a cero para agregar el pago.';
    }
    if (method === 'card' && !this.draftAuthCode().trim()) {
      return 'Ingrese el codigo de autorizacion de la tarjeta.';
    }
    if (['stripe', 'kushki', 'payphone'].includes(method) && this.draftExternalStatus() !== 'confirmed') {
      return 'Confirme la transaccion del proveedor antes de agregar el pago.';
    }
    return null;
  }

  tryAddPaymentLine(): void {
    const reason = this.addPaymentLineError();
    if (reason) {
      this.checkoutError.set(reason);
      return;
    }
    this.addPaymentLine();
  }

  addPaymentLine(): void {
    if (!this.canAddPaymentLine()) {
      return;
    }
    const method = this.paymentMethod(this.selectedPaymentMethod());
    const total = this.round2(this.parseUsd(this.draftAmount()));
    const recibido = this.selectedPaymentMethod() === 'cash' ? this.round2(this.parseUsd(this.draftReceived())) : total;
    const line: PosPaymentLineDraft = {
      id: `pay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      method: method.code,
      formaPago: method.formaPago,
      canal: method.canal,
      proveedor: method.proveedor,
      total,
      recibido,
      vuelto: this.round2(Math.max(0, recibido - total)),
      transaccionProveedorId: this.draftProviderTransactionId().trim() || null,
      codigoAutorizacion: this.draftAuthCode().trim() || null,
      referencia: this.draftReference().trim() || method.label,
      status: ['stripe', 'kushki', 'payphone'].includes(method.code) ? this.draftExternalStatus() : 'confirmed',
    };
    this.paymentLines.update((lines) => [...lines, line]);
    this.paymentCollection.set(null);
    this.checkoutError.set(null);
    this.fillDraftPending();
  }

  removePaymentLine(id: string): void {
    this.paymentLines.update((lines) => lines.filter((line) => line.id !== id));
    this.paymentCollection.set(null);
  }

  hasPaymentFor(method: PosPaymentMethodCode): boolean {
    return this.paymentLines().some((line) => line.method === method);
  }

  paymentMethodLabel(method: PosPaymentMethodCode): string {
    return this.paymentMethod(method).label;
  }

  private paymentMethod(method: PosPaymentMethodCode): PosPaymentMethodOption {
    return this.paymentMethods.find((item) => item.code === method) ?? this.paymentMethods[0]!;
  }

  onPayCash(ev: Event): void {
    this.payCash.set((ev.target as HTMLInputElement).value);
  }

  onPayCard(ev: Event): void {
    this.payCard.set((ev.target as HTMLInputElement).value);
    this.cardStatus.set('idle');
    this.cardOperationMessage.set('');
  }

  onPayTransfer(ev: Event): void {
    this.payTransfer.set((ev.target as HTMLInputElement).value);
  }

  clearPayments(): void {
    this.payCash.set('0');
    this.payCard.set('0');
    this.payTransfer.set('0');
    this.paymentLines.set([]);
    this.paymentCollection.set(null);
    this.draftAmount.set('0');
    this.draftReceived.set('0');
    this.draftReference.set('');
    this.draftAuthCode.set('');
    this.draftProviderTransactionId.set('');
    this.draftExternalStatus.set('idle');
    this.resetCardOperation();
  }

  payExactCash(): void {
    this.payCash.set(this.formatUsd(this.total()));
    this.payCard.set('0');
    this.payTransfer.set('0');
    this.resetCardOperation();
  }

  payCashDenomination(amount: number): void {
    this.payCash.set(this.formatUsd(amount));
  }

  payCashAmount(amount: number): void {
    this.payCash.set(this.formatUsd(amount));
  }

  payAllCash(): void {
    this.payCash.set(this.formatUsd(this.total()));
    this.payCard.set('0');
    this.payTransfer.set('0');
    this.resetCardOperation();
  }

  paySplitHalf(): void {
    const t = this.total();
    const a = Math.round((t / 2) * 100) / 100;
    const b = Math.round((t - a) * 100) / 100;
    this.payCash.set(this.formatUsd(a));
    this.payCard.set(this.formatUsd(b));
    this.payTransfer.set('0');
    this.resetCardOperation();
  }

  payPendingCard(): void {
    const pendingWithoutCard = Math.max(
      0,
      this.total() - this.parseUsd(this.payCash()) - this.parseUsd(this.payTransfer()),
    );
    this.payCard.set(this.formatUsd(pendingWithoutCard));
    this.cardStatus.set('idle');
    this.cardOperationMessage.set('');
  }

  payAllCard(): void {
    this.payCash.set('0');
    this.payCard.set(this.formatUsd(this.total()));
    this.payTransfer.set('0');
    this.cardStatus.set('idle');
    this.cardOperationMessage.set('');
  }

  setCardChannel(channel: CardPaymentChannel): void {
    this.cardChannel.set(channel);
    this.cardStatus.set('idle');
    this.cardOperationMessage.set('');
  }

  onCardAuthCode(ev: Event): void {
    this.cardAuthCode.set((ev.target as HTMLInputElement).value.trim());
    this.cardStatus.set('idle');
  }

  onCardReference(ev: Event): void {
    this.cardReference.set((ev.target as HTMLInputElement).value.trim());
  }

  onCardLast4(ev: Event): void {
    const value = (ev.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 4);
    this.cardLast4.set(value);
    (ev.target as HTMLInputElement).value = value;
  }

  startCardTerminal(): void {
    if (this.parseUsd(this.payCard()) <= 0) {
      this.payPendingCard();
    }
    this.cardStatus.set('pending');
    this.cardOperationMessage.set(
      `Solicitud preparada para ${this.cardProviderLabel()}${this.prefs.cardTerminalId() ? ` · ${this.prefs.cardTerminalId()}` : ''}.`,
    );
  }

  startCardLink(): void {
    if (this.parseUsd(this.payCard()) <= 0) {
      this.payPendingCard();
    }
    this.cardStatus.set('pending');
    this.cardOperationMessage.set(
      `Link/QR pendiente de backend para ${this.cardProviderLabel()} por ${this.payCard() || '0'}.`,
    );
  }

  markCardApproved(): void {
    if (this.parseUsd(this.payCard()) <= 0) {
      this.payPendingCard();
    }
    if (this.cardChannel() === 'manual' && !this.cardAuthCode().trim()) {
      this.cardOperationMessage.set('Ingrese el codigo de autorizacion para registrar una tarjeta manual.');
      return;
    }
    this.cardStatus.set('approved');
    this.cardOperationMessage.set('Pago de tarjeta aprobado para cerrar el ticket.');
  }

  markCardRejected(): void {
    this.cardStatus.set('rejected');
    this.cardOperationMessage.set('Pago de tarjeta rechazado. Cambie el medio de pago o intente otra vez.');
  }

  private resetCardOperation(): void {
    this.cardStatus.set('idle');
    this.cardAuthCode.set('');
    this.cardReference.set('');
    this.cardLast4.set('');
    this.cardOperationMessage.set('');
  }

  private isCardPaymentReady(): boolean {
    const card = this.parseUsd(this.payCard());
    if (card <= 0) {
      return true;
    }
    if (this.cardChannel() === 'manual') {
      return this.cardAuthCode().trim().length > 0 && this.cardStatus() === 'approved';
    }
    return this.cardStatus() === 'approved';
  }

  async confirmarCobro(): Promise<void> {
    if (!this.canConfirmCobro()) {
      return;
    }
    const apiBase = this.auth.apiBaseUrl.replace(/\/+$/, '');
    const amounts = this.paymentAmounts();
    const t = this.total();
    if (!apiBase) {
      if (this.effectivePuntoEmisionId()) {
        await this.saveOfflineAndClose(this.buildCheckoutBody(this.effectivePuntoEmisionId()), {
          cash: amounts.cash,
          card: amounts.card,
          transfer: amounts.transfer,
        });
        return;
      }
      this.desk.recordSaleFromLocalUI(t, amounts);
      this.clearActiveCart();
      this.closeModal();
      return;
    }
    const pid = this.effectivePuntoEmisionId();
    if (!pid) {
      this.checkoutError.set('Elija un punto de emisión en Ajustes.');
      return;
    }
    this.checkoutError.set(null);
    this.checkoutLoading.set(true);
    const body = this.buildCheckoutBody(pid);
    const idem =
      typeof globalThis.crypto !== 'undefined' && 'randomUUID' in globalThis.crypto
        ? globalThis.crypto.randomUUID()
        : `idem-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    this.backend
      .postCheckout(body, idem)
      .pipe(finalize(() => this.checkoutLoading.set(false)))
      .subscribe({
        next: (response) => {
          if (response.estadoSri?.trim()) {
            this.saleActionMessage.set(`Estado SRI: ${response.estadoSri}`);
          } else if (response.invoiceStatus === 'SKIPPED') {
            this.saleActionMessage.set('Venta registrada (ticket local).');
          }
          const cid = response.comprobanteLocalId?.trim();
          if (cid) {
            this.lastTicketId.set(cid);
          }
          this.desk.refreshAfterRemoteSale();
          if (response.paymentCollectionId) {
            this.loadPaymentCollection(response.paymentCollectionId);
            this.clearActiveCart();
            return;
          }
          this.clearActiveCart();
          this.closeModal();
        },
        error: (err: unknown) => {
          if (this.offline.isConnectionError(err)) {
            void this.saveOfflineAndClose(body, amounts);
            return;
          }
          const msg = this.httpErrMessage(err);
          if (this.isCajaClosedError(msg)) {
            this.desk.refresh();
          }
          this.checkoutError.set(msg);
        },
      });
  }

  tryConfirmarCobro(): void {
    const reason = this.confirmCobroError();
    if (reason) {
      this.checkoutError.set(reason);
      return;
    }
    void this.confirmarCobro();
  }

  private loadPaymentCollection(collectionId: string): void {
    this.backend.getCobro(collectionId).subscribe({
      next: (collection) => this.paymentCollection.set(collection),
      error: (err: unknown) => this.checkoutError.set(this.httpErrMessage(err)),
    });
  }

  private effectivePuntoEmisionId(): string {
    return this.prefs.puntoEmisionId().trim() || this.prefs.localPuntoEmisionId();
  }

  private paymentAmounts(): { cash: number; card: number; transfer: number } {
    return this.paymentLines().reduce(
      (acc, line) => {
        if (line.canal === 'CASH') {
          acc.cash = this.round2(acc.cash + line.total);
        } else if (line.canal === 'TRANSFER') {
          acc.transfer = this.round2(acc.transfer + line.total);
        } else {
          acc.card = this.round2(acc.card + line.total);
        }
        return acc;
      },
      { cash: 0, card: 0, transfer: 0 },
    );
  }

  private buildCheckoutBody(puntoEmisionId: string): PosCheckoutRequestBody {
    const cust = this.activeCustomer() ?? SALE_CONSUMIDOR_FINAL;
    const docDigits = cust.doc.replace(/\D/g, '');
    const identificacion = docDigits.length >= 10 ? docDigits.slice(0, 13) : SALE_CONSUMIDOR_FINAL.doc;
    const tipoIdentificacion = cust.tipoIdentificacion || this.inferTipoIdentificacion(identificacion);
    const razonSocial = cust.name.trim() || SALE_CONSUMIDOR_FINAL.name;
    const emailRaw = (cust?.email ?? '').trim();
    const pagos = this.buildFiscalPayments(this.total());
    return {
      puntoEmisionId,
      comprobanteTipo: this.resolveComprobanteTipo(),
      fechaEmision: null,
      cliente: {
        tipoIdentificacion,
        identificacion,
        razonSocial,
        email: emailRaw || null,
      },
      items: this.cart().map((line) => ({
        codigoPrincipal: line.product.sku,
        codigoAuxiliar: line.product.barcode ?? null,
        descripcion: line.product.name,
        cantidad: line.qty,
        precioUnitario: line.product.price,
        descuento: line.discountAmount > 0 ? line.discountAmount : null,
        ivaPorcentaje: 15,
        ivaCodigoPorcentaje: null,
      })),
      pagos,
    };
  }

  private buildFiscalPayments(total: number): PosCheckoutPago[] {
    const pagos = this.paymentLines().map((line) => ({
      formaPago: line.formaPago,
      total: this.round2(line.total),
      recibido: line.recibido == null ? null : this.round2(line.recibido),
      canal: line.canal,
      proveedor: line.proveedor,
      transaccionProveedorId: line.transaccionProveedorId,
      codigoAutorizacion: line.codigoAutorizacion,
      referencia: line.referencia,
      plazo: null,
      unidadTiempo: null,
    }));
    if (!pagos.length && total > 0) {
      return [
        {
          formaPago: '01',
          total: this.round2(total),
          recibido: this.round2(total),
          canal: 'CASH',
          proveedor: null,
          transaccionProveedorId: null,
          codigoAutorizacion: null,
          referencia: 'Efectivo',
          plazo: null,
          unidadTiempo: null,
        },
      ];
    }
    return pagos;
  }

  private async saveOfflineAndClose(
    body: PosCheckoutRequestBody,
    amounts: { cash: number; card: number; transfer: number },
  ): Promise<void> {
    this.checkoutError.set(null);
    this.checkoutLoading.set(true);
    try {
      await this.offline.enqueue(this.buildOfflineSyncRequest(body));
      this.desk.recordSaleFromLocalUI(this.total(), amounts);
      this.clearActiveCart();
      this.closeModal();
      if (this.posApiConfigured() && navigator.onLine) {
        void this.offline.syncPending();
      }
    } catch (err) {
      this.checkoutError.set(err instanceof Error ? err.message : 'No se pudo guardar el comprobante offline');
    } finally {
      this.checkoutLoading.set(false);
    }
  }

  private buildOfflineSyncRequest(body: PosCheckoutRequestBody): PosOfflineComprobanteSyncRequest {
    const offlineDeviceId = this.offline.deviceId();
    const offlineSequence = this.offline.nextSequence();
    const today = new Date().toISOString().slice(0, 10);
    const pagos = body.pagos && body.pagos.length ? body.pagos : this.defaultOfflinePayment();
    const payload: PosOfflineComprobanteSyncRequest = {
      offlineDeviceId,
      offlineSequence,
      offlineCreatedAt: new Date().toISOString(),
      tipo: this.resolveComprobanteTipo(),
      puntoEmisionId: body.puntoEmisionId,
      fechaEmision: body.fechaEmision || today,
      cliente: body.cliente,
      items: body.items,
      pagos,
      totales: {
        subtotalSinImpuestos: this.round2(this.subtotal()),
        totalDescuento: this.round2(this.discountSum()),
        totalImpuestos: this.round2(this.iva()),
        importeTotal: this.round2(this.total()),
        currency: 'USD',
      },
      sourcePayloadJson: null,
    };
    return { ...payload, sourcePayloadJson: JSON.stringify(payload) };
  }

  private defaultOfflinePayment(): PosCheckoutPago[] {
    return [
      {
        formaPago: '01',
        total: this.round2(this.total()),
        recibido: this.round2(this.total()),
        canal: 'CASH',
        proveedor: null,
        transaccionProveedorId: null,
        codigoAutorizacion: null,
        referencia: 'Efectivo',
        plazo: null,
        unidadTiempo: null,
      },
    ];
  }

  private isCajaClosedError(message: string): boolean {
    const normalized = message.toLowerCase();
    return normalized.includes('caja') && (normalized.includes('cerr') || normalized.includes('abierta') || normalized.includes('no abierta'));
  }

  private resolveComprobanteTipo(): 'FACTURA' | 'NOTA_VENTA' | 'TICKET' {
    const value = this.prefs.defaultDocumentType().trim().toLowerCase();
    if (value === 'factura') {
      return 'FACTURA';
    }
    if (value === 'ticket') {
      return 'TICKET';
    }
    return 'NOTA_VENTA';
  }

  private round2(value: number): number {
    return Math.round(value * 100) / 100;
  }

  private inferTipoIdentificacion(identificacion: string): string {
    const d = identificacion.replace(/\D/g, '');
    if (d === '9999999999999') {
      return '07';
    }
    if (d.length === 13) {
      return '04';
    }
    if (d.length === 10) {
      return '05';
    }
    return '07';
  }

  private httpErrMessage(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      const b = err.error;
      if (typeof b === 'string' && b.trim()) {
        return b.length > 280 ? `${b.slice(0, 280)}…` : b;
      }
      if (b && typeof b === 'object' && 'message' in b) {
        const m = (b as { message: unknown }).message;
        if (typeof m === 'string') {
          return m;
        }
      }
      return err.message || `Error HTTP ${err.status}`;
    }
    if (err instanceof Error) {
      return err.message;
    }
    return 'Error al registrar el cobro';
  }

  private connectionErrMessage(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      if (err.status === 401 || err.status === 403) {
        return 'Sesion no autorizada para pos-app. Intente abrir el POS nuevamente desde Suite.';
      }
      if (err.status === 0) {
        return 'Sin respuesta de pos-app (8094). Verifique que el servicio este activo.';
      }
      return `pos-app respondio con error HTTP ${err.status}.`;
    }
    return 'No se pudo verificar la conexion con pos-app.';
  }

  private clearActiveCart(): void {
    this.patchActiveTab((tab) => ({ ...tab, cart: [] }));
  }

  selectTab(id: string): void {
    if (this.tabs().some((t) => t.id === id)) {
      this.activeTabId.set(id);
      this.resetCustomerSearchUi();
      this.focusCatalogSearch();
    }
  }

  newSale(): void {
    if (!this.requireOpenCaja()) {
      return;
    }
    this.tabSeq += 1;
    const id = `t-${this.tabSeq}`;
    const n = this.tabs().length + 1;
    this.patchTabs((ts) => [...ts, { id, label: `Venta ${n}`, cart: [], customer: SALE_CONSUMIDOR_FINAL }]);
    this.activeTabId.set(id);
    this.resetCustomerSearchUi();
    this.focusCatalogSearch();
  }

  closeTab(ev: Event, id: string): void {
    ev.stopPropagation();
    const ts = this.tabs();
    if (ts.length <= 1) {
      return;
    }
    const next = ts.filter((t) => t.id !== id);
    this.tabs.set(next);
    if (this.activeTabId() === id) {
      this.activeTabId.set(next[0]?.id ?? 't-1');
    }
    this.resetCustomerSearchUi();
  }

  closeTabKb(ev: Event, id: string): void {
    ev.preventDefault();
    this.closeTab(ev, id);
  }

  newCustIsRuc(): boolean {
    return isRucTipo(this.newCustDraft.tipoIdentificacion);
  }

  newCustIsPersona(): boolean {
    return isPersonaNaturalTipo(this.newCustDraft.tipoIdentificacion);
  }

  newCustIsConsumidorFinal(): boolean {
    return isConsumidorFinalTipo(this.newCustDraft.tipoIdentificacion);
  }

  newCustIdLabel(): string {
    return identificacionLabel(this.newCustDraft.tipoIdentificacion);
  }

  newCustIdMaxLength(): number {
    return identificacionMaxLength(this.newCustDraft.tipoIdentificacion);
  }

  newCustIdInputMode(): string {
    return identificacionInputMode(this.newCustDraft.tipoIdentificacion);
  }

  newCustIdPlaceholder(): string {
    if (this.newCustIsRuc()) return '13 dígitos';
    if (this.newCustDraft.tipoIdentificacion === '05') return '10 dígitos';
    if (this.newCustIsConsumidorFinal()) return CONSUMIDOR_FINAL_ID;
    return 'Número de pasaporte';
  }

  newCustDireccionObligatoria(): boolean {
    return direccionRequired(this.newCustDraft.tipoIdentificacion);
  }

  newCustOnTipoChange(): void {
    applyTipoIdentificacionDefaults(this.newCustDraft);
    this.newCustFormErrors.set({});
  }

  newCustOnIdentificacionInput(): void {
    if (this.newCustIsRuc() || this.newCustDraft.tipoIdentificacion === '05') {
      this.newCustDraft.identificacion = this.newCustDraft.identificacion
        .replace(/\D/g, '')
        .slice(0, this.newCustIdMaxLength());
    }
  }

  newCustCanConsultarCatastro(): boolean {
    return this.newCustIsRuc() || this.newCustDraft.tipoIdentificacion === '05';
  }

  consultarNewCustCatastro(): void {
    const id = this.newCustDraft.identificacion.trim();
    if (this.newCustIsRuc()) {
      if (!/^\d{13}$/.test(id)) {
        this.toast.warning('Ingrese un RUC de 13 dígitos');
        return;
      }
      this.newCustCatastroLoading.set(true);
      this.backend.consultarRuc(id).subscribe({
        next: (res) => {
          this.newCustCatastroLoading.set(false);
          if (!res.encontrado) {
            this.toast.error('RUC no encontrado en el SRI');
            return;
          }
          applyRucConsultaToForm(this.newCustDraft, res);
          const stale = res.obsoleto ? ' (datos en caché)' : '';
          this.toast.success(`Datos del SRI cargados${stale}`);
        },
        error: () => {
          this.newCustCatastroLoading.set(false);
          this.toast.error('No se pudo consultar el RUC. Verifique la conexión con api-sri.');
        },
      });
      return;
    }
    if (this.newCustDraft.tipoIdentificacion === '05') {
      if (!/^\d{10}$/.test(id)) {
        this.toast.warning('Ingrese una cédula de 10 dígitos');
        return;
      }
      this.newCustCatastroLoading.set(true);
      this.backend.consultarCedula(id).subscribe({
        next: (res) => {
          this.newCustCatastroLoading.set(false);
          if (!res.encontrado || !res.nombres?.trim()) {
            this.toast.error('Cédula no encontrada');
            return;
          }
          applyCedulaConsultaToForm(this.newCustDraft, res);
          const stale = res.obsoleto ? ' (datos en caché)' : '';
          this.toast.success(`Datos de cédula cargados${stale}`);
        },
        error: () => {
          this.newCustCatastroLoading.set(false);
          this.toast.error('No se pudo consultar la cédula. Verifique la conexión con api-sri.');
        },
      });
    }
  }

  searchCustomer(): void {
    const raw = this.custQuery().trim();
    if (!raw) {
      this.applyConsumidorFinal();
      return;
    }
    const q = raw.toLowerCase();
    if (q.includes('consum') || q === 'cf' || q === '999') {
      this.applyConsumidorFinal();
      return;
    }
    this.runCustomerSearch(raw);
  }

  selectCustomer(row: PosCustomerResponse): void {
    this.applyCustomer(customerResponseToSale(row));
  }

  applyConsumidorFinal(): void {
    this.applyCustomer(SALE_CONSUMIDOR_FINAL);
  }

  private runCustomerSearch(raw: string): void {
    const q = raw.trim();
    if (!q) {
      return;
    }
    if (!this.posApiConfigured()) {
      this.custResults.set([]);
      this.custResultsOpen.set(false);
      this.custSearchMsg.set('Configure la API del POS para buscar en el maestro de clientes.');
      return;
    }
    this.custSearchLoading.set(true);
    this.custSearchMsg.set(null);
    this.backend.getCustomers(q).subscribe({
      next: (rows) => {
        this.custSearchLoading.set(false);
        const digits = q.replace(/\D/g, '');
        const exact =
          rows.find((c) => c.identificacion === q) ??
          (digits ? rows.find((c) => c.identificacion === digits) : undefined) ??
          (rows.length === 1 ? rows[0] : null);
        if (exact) {
          this.applyCustomer(customerResponseToSale(exact));
          return;
        }
        this.custResults.set(rows);
        this.custResultsOpen.set(rows.length > 0);
        this.custSearchMsg.set(
          rows.length > 1
            ? 'Seleccione un cliente de la lista.'
            : rows.length === 0
              ? 'Sin coincidencias. Use Consumidor final o cree un cliente nuevo.'
              : null,
        );
      },
      error: () => {
        this.custSearchLoading.set(false);
        this.custResults.set([]);
        this.custResultsOpen.set(false);
        this.custSearchMsg.set('No se pudo consultar clientes. Verifique la conexión con pos-app.');
      },
    });
  }

  private applyCustomer(customer: SaleCustomer): void {
    this.patchActiveTab((t) => ({ ...t, customer }));
    this.resetCustomerSearchUi();
    this.saleActionMessage.set(null);
    this.focusCatalogSearch();
  }

  private resetCustomerSearchUi(): void {
    this.custQuery.set('');
    this.custResults.set([]);
    this.custResultsOpen.set(false);
    this.custSearchMsg.set(null);
    this.custSearchLoading.set(false);
  }

  openNewCustomer(): void {
    this.newCustDraft = emptyCustomerForm('05');
    this.newCustFormErrors.set({});
    this.newCustCatastroLoading.set(false);
    this.newCustSaving.set(false);
    this.modal.set({ kind: 'newCustomer' });
  }

  saveNewCustomer(): void {
    const errors = validateCustomerForm(this.newCustDraft);
    this.newCustFormErrors.set(errors);
    if (hasCustomerFormErrors(errors)) {
      this.toast.warning('Revise los campos marcados en el formulario.');
      return;
    }

    const assignLocal = (warnFallback = false) => {
      const body = buildCustomerRequest(this.newCustDraft);
      this.applyCustomer({
        name: body.nombreComercial?.trim() || body.razonSocial,
        doc: body.identificacion,
        tipoIdentificacion: body.tipoIdentificacion,
        email: body.email ?? null,
        isConsumidorFinal: body.tipoIdentificacion === '07',
      });
      if (warnFallback) {
        this.toast.warning('No se pudo guardar en el maestro; se usará solo en esta venta.');
      } else {
        this.toast.success('Cliente asignado al ticket');
      }
      this.closeModal();
    };

    if (!this.posApiConfigured()) {
      assignLocal();
      return;
    }

    this.newCustSaving.set(true);
    const body = buildCustomerRequest(this.newCustDraft);
    this.backend
      .postCustomer(body)
      .pipe(finalize(() => this.newCustSaving.set(false)))
      .subscribe({
        next: (res) => {
          this.applyCustomer(customerResponseToSale(res));
          this.toast.success('Cliente guardado y asignado al ticket');
          this.closeModal();
        },
        error: () => assignLocal(true),
      });
  }

  openModal(kind: 'stock' | 'promo', product: DemoProduct): void {
    if (!this.requireOpenCaja()) {
      return;
    }
    if (kind === 'stock') {
      this.modal.set({ kind: 'stock', product });
    } else {
      this.modal.set({ kind: 'promo', product });
    }
  }

  closeModal(): void {
    this.calcBuffer.set('0');
    this.payCash.set('0');
    this.payCard.set('0');
    this.payTransfer.set('0');
    this.checkoutError.set(null);
    this.checkoutLoading.set(false);
    this.modal.set(null);
    this.focusCatalogSearch();
  }

  lineById(lineId: string): CartLine | undefined {
    return this.cart().find((l) => l.lineId === lineId);
  }

  lineGross(line: CartLine): number {
    return line.qty * line.product.price;
  }

  lineDiscountMax(line: CartLine): number {
    return this.lineGross(line);
  }

  lineNet(line: CartLine): number {
    return Math.max(0, this.lineGross(line) - (line.discountAmount ?? 0));
  }

  openLineDiscount(line: CartLine): void {
    if (!this.requireOpenCaja()) {
      return;
    }
    const d = line.discountAmount ?? 0;
    this.calcBuffer.set(d > 0 ? String(Math.round(d * 100) / 100) : '0');
    this.modal.set({ kind: 'lineDiscount', lineId: line.lineId });
  }

  calcTap(key: string): void {
    let b = this.calcBuffer();
    if (key === '⌫') {
      b = b.length <= 1 ? '0' : b.slice(0, -1);
      if (b === '' || b === '-') {
        b = '0';
      }
      this.calcBuffer.set(b);
      return;
    }
    if (key === '.') {
      if (b.includes('.')) {
        return;
      }
      this.calcBuffer.set(b === '0' ? '0.' : `${b}.`);
      return;
    }
    if (b === '0') {
      this.calcBuffer.set(key);
    } else {
      this.calcBuffer.set(b + key);
    }
  }

  calcClearAll(): void {
    this.calcBuffer.set('0');
  }

  applyLineDiscountFromCalc(): void {
    const raw = this.calcBuffer().trim();
    const v = raw === '' || raw === '.' ? 0 : Number.parseFloat(raw);
    if (Number.isNaN(v) || v < 0) {
      return;
    }
    this.applyLineDiscount(v);
  }

  applyLineDiscount(amount: number): void {
    if (!this.requireOpenCaja()) {
      this.closeModal();
      return;
    }
    const m = this.modal();
    if (!m || m.kind !== 'lineDiscount') {
      return;
    }
    const lineId = m.lineId;
    this.patchActiveTab((t) => ({
      ...t,
      cart: t.cart.map((row) => {
        if (row.lineId !== lineId) {
          return row;
        }
        const maxD = this.lineGross(row);
        const next = Math.min(Math.max(0, amount), maxD);
        return { ...row, discountAmount: next };
      }),
    }));
    this.closeModal();
  }

  private newLineId(): string {
    const c = globalThis.crypto;
    if (c && 'randomUUID' in c && typeof c.randomUUID === 'function') {
      return c.randomUUID();
    }
    return `L-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  addLine(p: DemoProduct): void {
    if (!this.requireOpenCaja()) {
      return;
    }
    this.playUiSound('add');
    this.patchActiveTab((t) => {
      const rows = t.cart;
      const i = rows.findIndex((r) => r.product.id === p.id);
      if (i >= 0 && !this.prefs.separateSameProductLines()) {
        const next = [...rows];
        const row = next[i];
        const qty = row.qty + 1;
        const gross = qty * row.product.price;
        const disc = Math.min(row.discountAmount ?? 0, gross);
        next[i] = { ...row, qty, discountAmount: disc };
        return { ...t, cart: next };
      }
      return {
        ...t,
        cart: [...rows, { lineId: this.newLineId(), product: p, qty: 1, discountAmount: 0 }],
      };
    });
    this.focusCatalogSearch();
  }

  onLineQtyInput(line: CartLine, ev: Event): void {
    if (!this.requireOpenCaja()) {
      (ev.target as HTMLInputElement).value = String(line.qty);
      return;
    }
    const input = ev.target as HTMLInputElement;
    const qty = Math.max(1, Math.floor(Number(input.value)));
    if (!Number.isFinite(qty)) {
      input.value = String(line.qty);
      return;
    }
    this.setLineQty(line, qty);
  }

  setLineQty(line: CartLine, qty: number): void {
    if (!this.requireOpenCaja()) {
      return;
    }
    const nextQty = Math.max(1, Math.floor(qty));
    if (!Number.isFinite(nextQty)) {
      return;
    }
    this.patchActiveTab((t) => ({
      ...t,
      cart: t.cart.map((r) => {
        if (r.lineId !== line.lineId) {
          return r;
        }
        const gross = nextQty * r.product.price;
        const disc = Math.min(r.discountAmount ?? 0, gross);
        return { ...r, qty: nextQty, discountAmount: disc };
      }),
    }));
  }

  inc(line: CartLine): void {
    if (!this.requireOpenCaja()) {
      return;
    }
    this.patchActiveTab((t) => ({
      ...t,
      cart: t.cart.map((r) => {
        if (r.lineId !== line.lineId) {
          return r;
        }
        const qty = r.qty + 1;
        const gross = qty * r.product.price;
        const disc = Math.min(r.discountAmount ?? 0, gross);
        return { ...r, qty, discountAmount: disc };
      }),
    }));
  }

  dec(line: CartLine): void {
    if (!this.requireOpenCaja()) {
      return;
    }
    this.patchActiveTab((t) => ({
      ...t,
      cart: t.cart
        .map((r) => {
          if (r.lineId !== line.lineId) {
            return r;
          }
          const qty = r.qty - 1;
          if (qty <= 0) {
            return { ...r, qty: 0 };
          }
          const gross = qty * r.product.price;
          const disc = Math.min(r.discountAmount ?? 0, gross);
          return { ...r, qty, discountAmount: disc };
        })
        .filter((r) => r.qty > 0),
    }));
    this.playUiSound('remove');
  }

  private playUiSound(kind: 'add' | 'remove'): void {
    if (!this.prefs.soundOn()) {
      return;
    }
    try {
      const win = window as unknown as { webkitAudioContext?: typeof AudioContext };
      const AudioContextCtor = window.AudioContext || win.webkitAudioContext;
      if (!AudioContextCtor) {
        return;
      }
      const ctx = this.audioCtx ?? new AudioContextCtor();
      this.audioCtx = ctx;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = kind === 'add' ? 880 : 360;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.045, ctx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.09);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.1);
    } catch {
      // Algunos navegadores bloquean audio si no hay permiso; la operación continúa.
    }
  }

  removeLine(line: CartLine): void {
    if (!this.requireOpenCaja()) {
      return;
    }
    this.patchActiveTab((t) => ({
      ...t,
      cart: t.cart.filter((r) => r.lineId !== line.lineId),
    }));
    this.playUiSound('remove');
  }
}





