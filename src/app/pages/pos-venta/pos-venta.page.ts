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
import { finalize, forkJoin } from 'rxjs';
import type { ColumnDefinition } from 'tabulator-tables';
import { PosBackendApiService } from '../../core/api/pos-backend-api.service';
import type {
  PosCheckoutPago,
  PosCheckoutRequestBody,
  PosCustomerRequest,
  PosCustomerResponse,
  PayPhoneIntentResponse,
  PosOfflineComprobanteSyncRequest,
  PosPaymentCollectionResponse,
  PosPriceListResponse,
  PosProductCategoryResponse,
  PosProductPriceMatrixEntry,
} from '../../core/api/pos-backend.types';
import { extractApiErrorMessage, formatPayPhoneApiError } from '../../core/http-error.util';
import { resolveProductMediaUrl } from '../../shared/catalog/pos-product-media.util';
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
  customerDisplayInitials,
  saleCustomerTipoLabel,
  type SaleCustomer,
} from '../../shared/customer/pos-sale-customer.util';
import { PosDeskSessionService } from '../../core/desk/pos-desk-session.service';
import { PosAuthService } from '../../core/auth/pos-auth.service';
import { PosConfigService } from '../../core/config/pos-config.service';
import { PosLayoutPreferencesService } from '../../core/layout/pos-layout-preferences.service';
import { PosOfflineSyncService } from '../../core/offline/pos-offline-sync.service';
import { PosToastService } from '../../core/ui/pos-toast.service';
import { PayPhonePaymentWidget } from '../../core/payments/payphone-payment.widget';
import { PAYPHONE_COUNTRY_OPTIONS, normalizePayPhoneLocalPhone } from '../../core/payments/payphone-countries.util';
import { PosPaymentWidgetRegistryService } from '../../core/payments/pos-payment-widget-registry.service';
import type {
  PaymentCollectionSession,
  PosExternalPaymentStatus,
  PosPaymentLineDraft,
  PosPaymentMethodCode,
  PosPaymentMethodOption,
} from '../../core/payments/pos-payment-widget.types';
import { PosTabulatorLocalGridComponent } from '../../shared/grid/pos-tabulator-local-grid.component';
import { escapeHtml, tabulatorCellValue, tabulatorTextareaCell } from '../../shared/grid/tabulator-formatters.util';

interface DemoProduct {
  id: string;
  name: string;
  sku: string;
  /** Código de barras; si falta, en búsqueda se usa el SKU. */
  barcode?: string;
  price: number;
  ivaPercent?: number;
  ivaTaxCode?: string;
  /** Precio por lista (incluye la principal). */
  listPrices: Record<string, number>;
  tag: string;
  imageUrl?: string;
  categoryId?: string | null;
  categoryName?: string | null;
}

interface CartLine {
  lineId: string;
  product: DemoProduct;
  qty: number;
  /** Lista de precio aplicada a esta línea. */
  priceListId: string;
  /** Descuento fijo en USD sobre el ítem (no por unidad). */
  discountAmount: number;
}

interface SaleTab {
  id: string;
  label: string;
  cart: CartLine[];
  customer: SaleCustomer | null;
}

interface LinePriceOption {
  listId: string;
  listName: string;
  price: number;
  primary: boolean;
}

interface CartStatusHint {
  id: string;
  kind: 'warn' | 'err';
  label: string;
  detail: string;
}

type CardPaymentChannel = 'terminal' | 'link' | 'manual';
type CardPaymentStatus = 'idle' | 'pending' | 'approved' | 'rejected';

const POS_SALE_TABS_STORAGE_KEY = 'pos_ui_pending_sale_tabs_v1';
const POS_PAYPHONE_CHECKOUT_INTENT_KEY = 'pos_payphone_checkout_intent_v1';

type ModalState =
  | { kind: 'stock'; product: DemoProduct }
  | { kind: 'promo'; product: DemoProduct }
  | { kind: 'newCustomer' }
  | { kind: 'pickCustomer' }
  | { kind: 'lineDiscount'; lineId: string }
  | { kind: 'linePrice'; lineId: string }
  | { kind: 'cobro' };

@Component({
  selector: 'pos-venta-page',
  standalone: true,
  imports: [CommonModule, FormsModule, PosTabulatorLocalGridComponent],
  template: `
    <div class="venta">
      <div class="venta__grid" [class.venta__grid--catalog-left]="prefs.handedness() === 'right'">
        <section class="panel panel--wide" #catalogPanel aria-label="Catálogo de venta">
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
                placeholder="Buscar productos, SKU o código de barras…"
                [value]="catalogQuery()"
                (input)="onCatalogQuery($event)"
                (keydown.enter)="onCatalogEnter($event)" />
              @if (catalogQuery().trim()) {
                <button
                  type="button"
                  class="catalog-search__clear pos-focus-ring"
                  aria-label="Limpiar búsqueda"
                  title="Limpiar búsqueda"
                  (click)="clearCatalogSearch()">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M8 8l8 8M16 8l-8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                  </svg>
                </button>
              }
              <button
                type="button"
                class="catalog-search__scan pos-focus-ring"
                title="Escanear código de barras"
                aria-label="Escanear código de barras"
                (click)="focusCatalogScan()">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M4 7V5a1 1 0 011-1h2M4 17v2a1 1 0 001 1h2M16 5h2a1 1 0 011 1v2M16 19h2a1 1 0 001-1v-2M7 12h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
                </svg>
              </button>
            </label>
            <div class="catalog-toolbar__row">
              <label class="catalog-filter">
                <span class="sr-only">Categoría</span>
                <select
                  #catalogCategory
                  class="catalog-filter__select pos-focus-ring"
                  [value]="activeCategoryId()"
                  (change)="onCategoryFilter($event)">
                  <option value="">Todas las categorías</option>
                  @for (c of categoryOptions(); track c.id) {
                    <option [value]="c.id">{{ c.pathLabel }}</option>
                  }
                </select>
              </label>
              <div class="cats" role="tablist" aria-label="Filtro por etiqueta">
                @for (c of tagOptions(); track c) {
                  <button
                    type="button"
                    class="cat pos-focus-ring"
                    [class.cat--on]="c === activeTag()"
                    (click)="setCatalogTag(c)">
                    {{ c }}
                  </button>
                }
              </div>
              <div class="catalog-view" role="group" aria-label="Vista del catálogo">
                <button
                  type="button"
                  class="catalog-view__btn pos-focus-ring"
                  [class.catalog-view__btn--on]="catalogView() === 'grid'"
                  title="Vista en cuadrícula"
                  aria-label="Vista en cuadrícula"
                  [attr.aria-pressed]="catalogView() === 'grid'"
                  (click)="catalogView.set('grid')">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <rect x="4" y="4" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.6" />
                    <rect x="14" y="4" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.6" />
                    <rect x="4" y="14" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.6" />
                    <rect x="14" y="14" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.6" />
                  </svg>
                </button>
                <button
                  type="button"
                  class="catalog-view__btn pos-focus-ring"
                  [class.catalog-view__btn--on]="catalogView() === 'list'"
                  title="Vista en lista"
                  aria-label="Vista en lista"
                  [attr.aria-pressed]="catalogView() === 'list'"
                  (click)="catalogView.set('list')">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M5 7h14M5 12h14M5 17h14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
          <div class="products-scroll">
            @if (filteredCatalog().length === 0) {
              <div class="catalog-empty" role="status" aria-live="polite">
                <div class="catalog-empty__hero">
                  <div class="catalog-empty__icon-wrap" aria-hidden="true">
                    <span class="catalog-empty__spark catalog-empty__spark--1">✦</span>
                    <span class="catalog-empty__spark catalog-empty__spark--2">·</span>
                    <span class="catalog-empty__spark catalog-empty__spark--3">✦</span>
                    <svg class="catalog-empty__icon" width="38" height="38" viewBox="0 0 24 24" fill="none">
                      <defs>
                        <linearGradient id="catalog-empty-grad" x1="4" y1="4" x2="20" y2="20" gradientUnits="userSpaceOnUse">
                          <stop stop-color="#00e5ff" />
                          <stop offset="0.5" stop-color="#6366f1" />
                          <stop offset="1" stop-color="#c026d3" />
                        </linearGradient>
                      </defs>
                      <circle cx="11" cy="11" r="6.5" stroke="url(#catalog-empty-grad)" stroke-width="1.8" />
                      <path d="M16 16l4.5 4.5" stroke="url(#catalog-empty-grad)" stroke-width="1.8" stroke-linecap="round" />
                    </svg>
                  </div>
                  <h3 class="catalog-empty__title">No se encontraron productos</h3>
                  <p class="catalog-empty__desc">
                    @if (catalogQuery().trim(); as q) {
                      No hay resultados para <strong class="catalog-empty__term">'{{ q }}'</strong>. Intenta con otro término o revisa la ortografía.
                    } @else if (catalogHasActiveFilters()) {
                      No hay productos que coincidan con los filtros seleccionados. Ajusta la categoría o la etiqueta.
                    } @else {
                      El catálogo no tiene productos disponibles en este momento.
                    }
                  </p>
                </div>
                <div class="catalog-empty__suggestions" aria-hidden="true">
                  <span>Sugerencias</span>
                </div>
                <div class="catalog-empty__actions">
                  <button type="button" class="catalog-empty__action pos-focus-ring" (click)="clearCatalogFilters()">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <rect x="4" y="4" width="6" height="6" stroke="currentColor" stroke-width="1.6" />
                      <rect x="14" y="4" width="6" height="6" stroke="currentColor" stroke-width="1.6" />
                      <rect x="4" y="14" width="6" height="6" stroke="currentColor" stroke-width="1.6" />
                      <rect x="14" y="14" width="6" height="6" stroke="currentColor" stroke-width="1.6" />
                    </svg>
                    Ver todos los productos
                  </button>
                  <button type="button" class="catalog-empty__action pos-focus-ring" (click)="focusCatalogCategories()">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M4 6h16M4 12h10M4 18h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
                    </svg>
                    Explorar categorías
                  </button>
                  <button type="button" class="catalog-empty__action pos-focus-ring" (click)="clearCatalogSearch()">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M4 4v5h5M20 20v-5h-5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
                      <path d="M5.5 18.5A8 8 0 0118.5 5.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
                    </svg>
                    Limpiar búsqueda
                  </button>
                </div>
              </div>
            } @else {
              <div class="products" [class.products--list]="catalogView() === 'list'">
                @for (p of pagedProducts(); track p.id) {
                  <article class="card">
                    <button type="button" class="card__main pos-focus-ring" [class.card__main--locked]="!desk.cajaOpen()" (click)="addLine(p)">
                      @if (prefs.showProductImages()) {
                        <div class="card__thumb">
                          <img
                            [src]="productImageUrl(p)"
                            [alt]="p.name"
                            loading="lazy"
                            decoding="async"
                            (error)="onProductImageError($event)" />
                        </div>
                      }
                      <div class="card__body">
                        @if (p.categoryName) {
                          <span class="card__cat">{{ p.categoryName }}</span>
                        }
                        <span class="card__tag">{{ p.tag }}</span>
                        <span class="card__name">{{ p.name }}</span>
                        <span class="card__sku">{{ p.sku }}</span>
                        <span class="card__price">{{ catalogDisplayPrice(p) | currency: 'USD' : 'symbol-narrow' : '1.2-2' }}</span>
                      </div>
                    </button>
                    <div class="card__foot">
                      <button
                        type="button"
                        class="card__badge card__badge--stock pos-focus-ring"
                        title="Stock en otras bodegas"
                        [class.card__badge--locked]="!desk.cajaOpen()"
                        (click)="openModal('stock', p)">
                        Stock
                      </button>
                      <button
                        type="button"
                        class="card__badge card__badge--promo pos-focus-ring"
                        title="Promociones"
                        [class.card__badge--locked]="!desk.cajaOpen()"
                        (click)="openModal('promo', p)">
                        Promo
                      </button>
                    </div>
                  </article>
                }
              </div>
            }
          </div>
          <div class="catalog-pager" role="navigation" aria-label="Paginación del catálogo">
            <button
              type="button"
              class="pager-nav pos-focus-ring"
              [disabled]="catalogPageClamped() <= 1"
              (click)="catalogPrev()">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M15 6l-6 6 6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
              <span>Anterior</span>
            </button>
            <div class="catalog-pager__center">
              <div class="catalog-pager__pages">
                @for (slot of catalogPagerSlots(); track $index) {
                  @if (slot === 'ellipsis') {
                    <span class="pager-ellipsis" aria-hidden="true">…</span>
                  } @else {
                    <button
                      type="button"
                      class="pager-page pos-focus-ring"
                      [class.pager-page--on]="slot === catalogPageClamped()"
                      [attr.aria-current]="slot === catalogPageClamped() ? 'page' : null"
                      (click)="goCatalogPage(slot)">
                      {{ slot }}
                    </button>
                  }
                }
              </div>
              <span class="catalog-pager__meta"
                >Página {{ catalogPageClamped() }} de {{ catalogTotalPages() }} · {{ filteredCatalog().length }}
                ítems</span
              >
            </div>
            <button
              type="button"
              class="pager-nav pos-focus-ring"
              [disabled]="catalogPageClamped() >= catalogTotalPages()"
              (click)="catalogNext()">
              <span>Siguiente</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
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
            <div class="cart-head__aside">
              @if (cartStatusHints().length) {
                <div class="cart-head__hints" role="status" aria-live="polite">
                  @for (h of cartStatusHints(); track h.id) {
                    <span class="cart-hint cart-hint--{{ h.kind }}" [title]="h.detail">{{ h.label }}</span>
                  }
                </div>
              }
              @if (lastTicketId()) {
                <button type="button" class="cart-hint cart-hint--link pos-focus-ring" (click)="openLastTicket()" title="Imprimir último ticket">
                  Ticket
                </button>
              }
              <span class="badge">{{ lineCount() }} ítems</span>
            </div>
          </div>

          <div class="customer-panel">
            @if (activeCustomer(); as ac) {
              <div class="customer-panel__active customer-panel__active--compact">
                <span class="customer-panel__avatar" aria-hidden="true">{{ customerInitials(ac.name) }}</span>
                <div class="customer-panel__active-text">
                  <strong>{{ ac.name }}</strong>
                  <span class="customer-panel__meta">
                    {{ saleCustomerTipoLabel(ac.tipoIdentificacion) }} · {{ ac.doc }}
                    @if (ac.priceListName && !canChangeLinePrice()) {
                      · {{ ac.priceListName }}
                    }
                  </span>
                </div>
                @if (ac.isConsumidorFinal) {
                  <span class="customer-panel__cf-badge customer-panel__cf-badge--on">CF</span>
                } @else {
                  <button type="button" class="customer-panel__cf-badge pos-focus-ring" (click)="applyConsumidorFinal()" title="Usar consumidor final">
                    CF
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
              <button
                type="button"
                class="customer-panel__chip pos-focus-ring"
                [class.customer-panel__chip--active]="activeCustomer()?.isConsumidorFinal"
                (click)="applyConsumidorFinal()"
                title="Consumidor final">
                CF
              </button>
              <button type="button" class="customer-panel__chip customer-panel__chip--ghost pos-focus-ring" (click)="openNewCustomer()" title="Nuevo cliente">
                + Nuevo
              </button>
            </div>
          </div>

          <div class="lines" #cartLines>
            @for (line of cart(); track line.lineId) {
              <article class="line-card" [attr.data-line-id]="line.lineId">
                @if (prefs.showProductImages()) {
                  <div class="line-card__thumb">
                    <img
                      [src]="productImageUrl(line.product)"
                      [alt]="line.product.name"
                      loading="lazy"
                      decoding="async"
                      (error)="onProductImageError($event)" />
                  </div>
                }
                <div class="line-card__body">
                  <header class="line-card__head">
                    <div class="line-card__identity">
                      <span class="line-card__name">{{ line.product.name }}</span>
                      <span class="line-card__sku">{{ line.product.sku }}</span>
                    </div>
                    <div class="line-card__amount">
                      @if (line.discountAmount > 0) {
                        <span class="line-card__gross">{{ lineGross(line) | currency: 'USD' : 'symbol-narrow' : '1.2-2' }}</span>
                        <span class="line-card__disc">−{{ line.discountAmount | currency: 'USD' : 'symbol-narrow' : '1.2-2' }}</span>
                      }
                      <span class="line-card__sum">{{ lineNet(line) | currency: 'USD' : 'symbol-narrow' : '1.2-2' }}</span>
                    </div>
                  </header>
                  <div class="line-card__actions">
                  <button
                    type="button"
                    class="line-card__price pos-focus-ring"
                    [class.line-card__price--locked]="!canChangeLinePrice()"
                    [disabled]="!canChangeLinePrice()"
                    [title]="canChangeLinePrice() ? 'Cambiar lista de precio' : linePriceListLabel(line) || 'Precio fijado'"
                    (click)="openLinePrice(line)">
                    <span class="line-card__price-val">{{ line.product.price | currency: 'USD' : 'symbol-narrow' : '1.2-2' }}</span>
                    @if (linePriceListLabel(line); as listLbl) {
                      <span class="line-card__price-tag">{{ listLbl }}</span>
                    }
                    @if (canChangeLinePrice()) {
                      <svg class="line-card__price-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path d="M8 10l4 4 4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                      </svg>
                    }
                  </button>
                  <button
                    type="button"
                    class="line-card__dcto pos-focus-ring"
                    [class.line-card__dcto--locked]="!desk.cajaOpen()"
                    (click)="openLineDiscount(line)">
                    Dcto.
                  </button>
                  <div class="line-card__qty" aria-label="Cantidad">
                    <button type="button" class="line-card__qty-btn pos-focus-ring" [class.line-card__qty-btn--locked]="!desk.cajaOpen()" (click)="dec(line)" aria-label="Menos">−</button>
                    <input
                      class="line-card__qty-input pos-focus-ring"
                      type="number"
                      min="1"
                      step="1"
                      inputmode="numeric"
                      aria-label="Cantidad"
                      [value]="line.qty"
                      [readonly]="!desk.cajaOpen()"
                      (change)="onLineQtyInput(line, $event)"
                      (keydown.enter)="onLineQtyInput(line, $event)" />
                    <button type="button" class="line-card__qty-btn pos-focus-ring" [class.line-card__qty-btn--locked]="!desk.cajaOpen()" (click)="inc(line)" aria-label="Más">+</button>
                  </div>
                  <button
                    type="button"
                    class="line-card__remove pos-focus-ring"
                    [class.line-card__remove--locked]="!desk.cajaOpen()"
                    aria-label="Eliminar línea"
                    title="Eliminar"
                    (click)="removeLine(line)">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m2 0v12a2 2 0 01-2 2H8a2 2 0 01-2-2V7h12z" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
                    </svg>
                  </button>
                  </div>
                </div>
              </article>
            } @empty {
              <div class="cart-empty">
                <div class="cart-empty__hero">
                  <div class="cart-empty__icon-wrap" aria-hidden="true">
                    <span class="cart-empty__spark cart-empty__spark--1">✦</span>
                    <span class="cart-empty__spark cart-empty__spark--2">+</span>
                    <span class="cart-empty__spark cart-empty__spark--3">✦</span>
                    <svg class="cart-empty__icon" width="34" height="34" viewBox="0 0 24 24" fill="none">
                      <defs>
                        <linearGradient id="cart-empty-grad" x1="4" y1="4" x2="20" y2="20" gradientUnits="userSpaceOnUse">
                          <stop stop-color="#00e5ff" />
                          <stop offset="0.5" stop-color="#6366f1" />
                          <stop offset="1" stop-color="#c026d3" />
                        </linearGradient>
                      </defs>
                      <path d="M6 8h15l-1.5 9H7.5L6 8z" stroke="url(#cart-empty-grad)" stroke-width="1.6" stroke-linejoin="round" />
                      <path d="M6 8L5 4H2" stroke="url(#cart-empty-grad)" stroke-width="1.6" stroke-linecap="round" />
                      <circle cx="9" cy="20" r="1.2" fill="url(#cart-empty-grad)" />
                      <circle cx="18" cy="20" r="1.2" fill="url(#cart-empty-grad)" />
                    </svg>
                  </div>
                  <h3 class="cart-empty__title">
                    @if (desk.cajaOpen()) {
                      Tu ticket está vacío
                    } @else {
                      Caja cerrada
                    }
                  </h3>
                  <p class="cart-empty__desc">
                    @if (desk.cajaOpen()) {
                      Agrega productos a tu ticket para comenzar la venta.
                    } @else {
                      Debe aperturar caja para agregar productos.
                    }
                  </p>
                </div>
                @if (desk.cajaOpen()) {
                  <div class="cart-empty__actions">
                    <button type="button" class="cart-empty__action pos-focus-ring" (click)="focusCatalogScan()">
                      <span class="cart-empty__action-ico cart-empty__action-ico--scan">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <path d="M4 7V5a1 1 0 011-1h2M4 17v2a1 1 0 001 1h2M16 5h2a1 1 0 011 1v2M16 19h2a1 1 0 001-1v-2M7 12h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
                        </svg>
                      </span>
                      <span class="cart-empty__action-text">
                        <strong>Escanear código</strong>
                        <small>Usa el lector de código de barras</small>
                      </span>
                      <svg class="cart-empty__action-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                      </svg>
                    </button>
                    <button type="button" class="cart-empty__action pos-focus-ring" (click)="focusCatalogSearch()">
                      <span class="cart-empty__action-ico cart-empty__action-ico--search">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <path d="M7 7h10v10H7z" stroke="currentColor" stroke-width="1.6" />
                          <path d="M9 11h6M12 8v6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
                        </svg>
                      </span>
                      <span class="cart-empty__action-text">
                        <strong>Buscar producto</strong>
                        <small>Busca por nombre, SKU o código</small>
                      </span>
                      <svg class="cart-empty__action-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                      </svg>
                    </button>
                    <button type="button" class="cart-empty__action pos-focus-ring" (click)="focusCatalogPanel()">
                      <span class="cart-empty__action-ico cart-empty__action-ico--catalog">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <rect x="4" y="4" width="6" height="6" stroke="currentColor" stroke-width="1.6" />
                          <rect x="14" y="4" width="6" height="6" stroke="currentColor" stroke-width="1.6" />
                          <rect x="4" y="14" width="6" height="6" stroke="currentColor" stroke-width="1.6" />
                          <rect x="14" y="14" width="6" height="6" stroke="currentColor" stroke-width="1.6" />
                        </svg>
                      </span>
                      <span class="cart-empty__action-text">
                        <strong>Ver catálogo</strong>
                        <small>Explora todas las categorías</small>
                      </span>
                      <svg class="cart-empty__action-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                      </svg>
                    </button>
                  </div>
                }
              </div>
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
            <button
              type="button"
              class="btn-pay pos-focus-ring"
              [class.btn-pay--locked]="lineCount() === 0 || !desk.cajaOpen()"
              (click)="openCobro()">
              <span class="btn-pay__content">
                <span class="btn-pay__label">{{ desk.cajaOpen() ? 'Cobrar' : 'Abrir caja' }}</span>
                @if (desk.cajaOpen()) {
                  <span class="btn-pay__amount">{{ total() | currency: 'USD' : 'symbol-narrow' : '1.2-2' }}</span>
                } @else {
                  <span class="btn-pay__hint">para cobrar</span>
                }
              </span>
              <span class="btn-pay__arrow" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </span>
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
          <button type="button" class="ts-form-modal__close" aria-label="Cerrar" (click)="closeModal()">
            <svg class="ts-form-modal__close-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M8 8l8 8M16 8l-8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
            </svg>
          </button>
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
      } @else if (m.kind === 'pickCustomer') {
      <div class="ts-modal-backdrop" (click)="closeModal()"></div>
      <section class="ts-form-modal ts-form-modal--picker" role="dialog" aria-modal="true" aria-labelledby="mdl-pickc">
        <header class="ts-form-modal__header">
          <div class="ts-form-modal__icon" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <circle cx="10" cy="8" r="3" stroke="currentColor" stroke-width="1.5" />
              <path d="M3 19c0-3 2.5-5 6-5s6 2 6 5" stroke="currentColor" stroke-width="1.5" />
              <path d="M15 11h6M18 8v6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
            </svg>
          </div>
          <div class="ts-form-modal__head-text">
            <p class="ts-form-modal__eyebrow">Venta</p>
            <h3 id="mdl-pickc">Buscar cliente</h3>
            <p class="ts-form-modal__subtitle">Seleccione un cliente del maestro para asignarlo al ticket.</p>
          </div>
          <button type="button" class="ts-form-modal__close" aria-label="Cerrar" (click)="closeModal()">
            <svg class="ts-form-modal__close-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M8 8l8 8M16 8l-8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
            </svg>
          </button>
        </header>
        <div class="ts-form-modal__body">
          <div class="ts-modal-searchbar">
            <label class="ts-modal-searchbar__field">
              <svg class="ts-modal-searchbar__icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="1.6" />
                <path d="M16 16l4.5 4.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
              </svg>
              <input
                type="search"
                class="ts-modal-searchbar__input pos-focus-ring"
                placeholder="RUC, cédula, nombre o correo…"
                [value]="custPickerQuery()"
                (input)="onCustPickerQueryInput($event)"
                (keydown.enter)="reloadCustomerPicker()" />
            </label>
            <button
              type="button"
              class="pos-btn pos-btn--primary ts-modal-searchbar__btn"
              [disabled]="custPickerLoading()"
              (click)="reloadCustomerPicker()">
              {{ custPickerLoading() ? '…' : 'Buscar' }}
            </button>
          </div>

          <div class="ts-modal-list-meta">
            <p class="ts-modal-list-meta__count">
              @if (custPickerLoading()) {
                Cargando clientes…
              } @else {
                {{ custPickerRows().length }} resultado{{ custPickerRows().length === 1 ? '' : 's' }}
              }
            </p>
            <button type="button" class="ts-modal-list-meta__link" (click)="openNewCustomerFromPicker()">
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
              </svg>
              Nuevo cliente
            </button>
          </div>

          <div class="ts-modal-grid-wrap">
            <pos-tabulator-local-grid
              [data]="custPickerGridRows()"
              [columns]="custPickerColumns"
              [reloadNonce]="custPickerGridNonce()"
              [pagination]="true"
              [paginationSize]="10"
              height="min(52vh, 26rem)"
              emptyContext="masters"
              emptyTitle="Sin clientes"
              emptyDescription="No hay coincidencias. Pruebe otro criterio o cree un cliente nuevo."
              (rowAction)="onCustPickerRowAction($event)" />
          </div>
        </div>
        <footer class="ts-form-modal__footer">
          <button type="button" class="pos-btn pos-btn--ghost" (click)="closeModal()">Cancelar</button>
          <button type="button" class="pos-btn pos-btn--primary" (click)="openNewCustomerFromPicker()">+ Nuevo cliente</button>
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
          @case ('linePrice') {
            @if (lineById(m.lineId); as dl) {
              <h3 class="modal__title" id="mdl-linePrice">Precio · {{ dl.product.name }}</h3>
              <p class="modal__sub">{{ dl.product.sku }}</p>
              @if (!canChangeLinePrice()) {
                <p class="modal__p">
                  Precio según
                  {{ linePriceListLabel(dl) || 'lista asignada' }}.
                  El cambio manual está desactivado en Ajustes o el cliente tiene lista fija.
                </p>
              } @else if (linePriceOptions(dl.product).length <= 1) {
                <p class="modal__p">Solo hay un precio disponible para este producto.</p>
              } @else {
                <div class="price-pick" role="listbox" aria-label="Listas de precio">
                  @for (opt of linePriceOptions(dl.product); track opt.listId) {
                    <button
                      type="button"
                      class="price-pick__opt pos-focus-ring"
                      [class.price-pick__opt--on]="dl.priceListId === opt.listId"
                      (click)="applyLinePrice(m.lineId, opt.listId)">
                      <span class="price-pick__name">{{ opt.listName }}{{ opt.primary ? ' · principal' : '' }}</span>
                      <strong class="price-pick__val">{{ opt.price | currency: 'USD' : 'symbol-narrow' : '1.2-2' }}</strong>
                    </button>
                  }
                </div>
              }
              <button type="button" class="btn-modal pos-focus-ring" (click)="closeModal()">Cerrar</button>
            }
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
              <header class="pos-pay-top">
                <div class="pos-pay-top__row">
                  <div class="pos-pay-top__main">
                    <span class="pos-pay-top__icon" aria-hidden="true">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                        <path d="M8 4h11a1 1 0 011 1v14a1 1 0 01-1 1H8a1 1 0 01-1-1V5a1 1 0 011-1z" stroke="currentColor" stroke-width="1.6" />
                        <path d="M8 8h8M8 11h8M8 14h5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
                        <path d="M16.5 15.5l2 2L21 13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
                      </svg>
                    </span>
                    <div class="pos-pay-top__copy">
                      <h3 class="pos-pay-top__title" id="mdl-cobro">Cobro de ticket</h3>
                      <p class="pos-pay-top__meta">
                        Cliente: <strong>{{ activeCustomer()?.name || 'Consumidor final' }}</strong>
                        · Caja: <strong>{{ desk.cajaDisplayId() }}</strong>
                      </p>
                    </div>
                  </div>
                  <button type="button" class="pos-pay-top__close pos-focus-ring" aria-label="Cerrar" (click)="closeModal()">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M8 8l8 8M16 8l-8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                    </svg>
                  </button>
                </div>
                @if (checkoutError()) {
                  <div class="pos-pay-feedback pos-pay-top__alert" role="alert" aria-live="polite">
                    <span class="pos-pay-feedback__icon" aria-hidden="true">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                        <path d="M12 8v5M12 16h.01M10.3 4.3l-7.4 12.8A2 2 0 004.6 20h14.8a2 2 0 001.7-2.9l-7.4-12.8a2 2 0 00-3.4 0z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
                      </svg>
                    </span>
                    <div class="pos-pay-feedback__copy">
                      <strong>{{ checkoutErrorTitle() }}</strong>
                      <p>{{ checkoutError() }}</p>
                    </div>
                    <button type="button" class="pos-pay-feedback__dismiss pos-focus-ring" aria-label="Cerrar mensaje" (click)="dismissCheckoutError()">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path d="M8 8l8 8M16 8l-8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                      </svg>
                    </button>
                  </div>
                }
              </header>

              <div class="pos-pay-hero">
                <div class="pos-pay-hero__copy">
                  <span class="pos-pay-hero__label">Total a pagar</span>
                  <strong class="pos-pay-hero__amount">{{ total() | currency: 'USD' : 'symbol-narrow' : '1.2-2' }}</strong>
                </div>
                <div class="pos-pay-hero__art">
                  <img class="pos-pay-hero__img" src="assets/iconos/cobro.png" alt="" loading="lazy" decoding="async" />
                </div>
              </div>

              @if (!desk.cajaOpen()) {
                <div class="pos-pay-body">
                  <p class="modal__p modal__p--warn">La caja está cerrada. Ábrala desde el resumen de caja en la barra superior.</p>
                  <button type="button" class="btn-modal pos-focus-ring" (click)="closeModal()">Entendido</button>
                </div>
              } @else {
                @if (primaryRecoverablePayPhoneIntent(); as intent) {
                  <div class="pos-pay-recovery pos-pay-recovery--compact">
                    <div class="pos-pay-recovery__item">
                      <div>
                        <strong>Último PayPhone {{ intent.status === 'CONFIRMED' ? 'confirmado' : 'pendiente' }}</strong>
                        <p>{{ intent.amountUsd | currency: 'USD' : 'symbol-narrow' : '1.2-2' }} · {{ intent.reference || intent.clientTransactionId }}</p>
                      </div>
                      @if (intent.status === 'CONFIRMED') {
                        <button type="button" class="btn-modal pos-focus-ring" (click)="applyRecoverablePayPhoneIntent(intent)">Aplicar pago</button>
                      } @else {
                        <button type="button" class="btn-modal btn-modal--ghost pos-focus-ring" (click)="resumeRecoverablePayPhoneIntent(intent)">Reanudar</button>
                      }
                    </div>
                    @if (recoverablePayPhoneOlderCount() > 0) {
                      <p class="pos-pay-recovery__hint">
                        +{{ recoverablePayPhoneOlderCount() }} intento(s) más en <strong>Ajustes → PayPhone → Historial</strong>.
                      </p>
                    }
                  </div>
                }
                @if (payPhoneRecoveryMessage()) {
                  <p class="modal__p modal__p--muted">{{ payPhoneRecoveryMessage() }}</p>
                }
                <div class="pos-pay-layout">
                  <section class="pos-pay-flow" aria-label="Captura de pagos">
                    <div class="pos-pay-step">
                      <h4 class="pos-pay-step__title">1. Método de pago</h4>
                      <div class="pos-pay-methods" role="list">
                        @for (method of paymentMethods(); track method.code) {
                          <button
                            type="button"
                            class="payment-method-card pos-focus-ring"
                            role="listitem"
                            [class.payment-method-card--on]="selectedPaymentMethod() === method.code"
                            [class.payment-method-card--ready]="hasPaymentFor(method.code)"
                            [class.payment-method-card--blocked]="hasPaymentFor(method.code)"
                            [disabled]="hasPaymentFor(method.code)"
                            (click)="selectPaymentMethod(method.code)">
                            <span class="payment-method-card__icon" aria-hidden="true">
                              @switch (method.code) {
                                @case ('cash') {
                                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                                    <rect x="3" y="7" width="18" height="10" rx="2" stroke="currentColor" stroke-width="1.6" />
                                    <circle cx="12" cy="12" r="2" stroke="currentColor" stroke-width="1.5" />
                                  </svg>
                                }
                                @case ('card') {
                                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                                    <rect x="3" y="6" width="18" height="12" rx="2" stroke="currentColor" stroke-width="1.6" />
                                    <path d="M3 10h18" stroke="currentColor" stroke-width="1.6" />
                                  </svg>
                                }
                                @case ('transfer') {
                                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                                    <path d="M7 7h10M7 12h6M7 17h8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
                                    <rect x="4" y="4" width="16" height="16" rx="2" stroke="currentColor" stroke-width="1.6" />
                                  </svg>
                                }
                                @default {
                                  <span class="payment-method-card__glyph">{{ method.icon }}</span>
                                }
                              }
                            </span>
                            <span class="payment-method-card__label">{{ method.label }}</span>
                            @if (selectedPaymentMethod() === method.code) {
                              <span class="payment-method-card__check" aria-hidden="true">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                                  <path d="M8 12.5l2.5 2.5L16 9" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
                                </svg>
                              </span>
                            }
                          </button>
                        }
                      </div>
                    </div>

                    <div class="pos-pay-step">
                      <h4 class="pos-pay-step__title">
                        @if (selectedPaymentMethod() === 'cash') {
                          2. Monto recibido
                        } @else {
                          2. Captura de pago
                        }
                      </h4>

                      @if (selectedPaymentMethod() === 'cash') {
                        <div class="pos-pay-cash-row">
                          <label class="pos-pay-amount">
                            <span class="pos-pay-amount__prefix" aria-hidden="true">$</span>
                            <input
                              class="pos-pay-amount__input pos-focus-ring"
                              type="text"
                              inputmode="decimal"
                              [value]="draftReceived()"
                              (input)="onDraftReceived($event)" />
                            <span class="pos-pay-amount__steppers">
                              <button type="button" class="pos-pay-amount__step pos-focus-ring" aria-label="Aumentar monto" (click)="bumpDraftReceived(1)">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                  <path d="M8 14l4-4 4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                                </svg>
                              </button>
                              <button type="button" class="pos-pay-amount__step pos-focus-ring" aria-label="Disminuir monto" (click)="bumpDraftReceived(-1)">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                  <path d="M8 10l4 4 4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                                </svg>
                              </button>
                            </span>
                          </label>
                          <div class="pos-pay-cash-side">
                            <div class="pos-pay-quick">
                              <div class="pos-pay-quick__row">
                                <span>Saldo pendiente</span>
                                <strong>{{ saldoPendiente() | currency: 'USD' : 'symbol-narrow' : '1.2-2' }}</strong>
                              </div>
                              <div class="pos-pay-quick__row">
                                <span>A aplicar</span>
                                <strong>{{ draftAmount() | currency: 'USD' : 'symbol-narrow' : '1.2-2' }}</strong>
                              </div>
                              <div class="pos-pay-quick__row pos-pay-quick__row--ok">
                                <span>Vuelto</span>
                                <strong>{{ draftChange() | currency: 'USD' : 'symbol-narrow' : '1.2-2' }}</strong>
                              </div>
                            </div>
                            <div class="pos-pay-cash-actions">
                              <button type="button" class="btn-modal btn-modal--ghost pos-focus-ring" (click)="fillDraftPending()">Saldo pendiente</button>
                              <button type="button" class="btn-modal pos-focus-ring" [class.btn-modal--disabled]="!canAddPaymentLine()" (click)="tryAddPaymentLine()">Agregar pago</button>
                            </div>
                          </div>
                        </div>
                      } @else if (selectedPaymentMethod() === 'payphone') {
                        <div class="pos-pay-form-grid">
                          <label class="modal-field">
                            <span>Monto</span>
                            <input class="modal-input pos-focus-ring" type="text" inputmode="decimal" [value]="draftAmount()" (input)="onDraftAmount($event)" />
                          </label>
                          <label class="modal-field">
                            <span>Telefono</span>
                            <input class="modal-input pos-focus-ring" type="tel" [value]="payPhonePhoneNumber()" (input)="onPayPhonePhoneNumber($event)" />
                          </label>
                          <label class="modal-field">
                            <span>País</span>
                            <select class="modal-input pos-focus-ring" [value]="payPhoneCountryCode()" (change)="onPayPhoneCountryCode($event)">
                              @for (country of payPhoneCountryOptions; track country.code) {
                                <option [value]="country.code">{{ country.label }}</option>
                              }
                            </select>
                          </label>
                          <label class="modal-field">
                            <span>Referencia</span>
                            <input class="modal-input pos-focus-ring" type="text" [value]="draftReference()" (input)="onDraftReference($event)" />
                          </label>
                        </div>
                        @if (payPhoneWidget.statusMessage()) {
                          <p class="modal__p" [class.modal__p--warn]="payPhoneWidget.session()?.externalStatus === 'rejected'">
                            {{ payPhoneWidget.statusMessage() }}
                          </p>
                        }
                        <p class="modal__p modal__p--muted">{{ payPhoneWidget.availabilityHint() }}</p>
                      } @else {
                        <div class="pos-pay-form-grid">
                          <label class="modal-field">
                            <span>Monto</span>
                            <input class="modal-input pos-focus-ring" type="text" inputmode="decimal" [value]="draftAmount()" (input)="onDraftAmount($event)" />
                          </label>
                          @if (selectedPaymentMethod() === 'card') {
                            <label class="modal-field">
                              <span>Código autorización</span>
                              <input class="modal-input pos-focus-ring" type="text" [value]="draftAuthCode()" (input)="onDraftAuthCode($event)" />
                            </label>
                          }
                          @if (selectedPaymentMethod() === 'stripe' || selectedPaymentMethod() === 'kushki') {
                            <label class="modal-field">
                              <span>Estado transacción</span>
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
                            <p class="modal__p modal__p--muted">{{ externalPaymentHint() }}</p>
                          }
                          @if (selectedPaymentMethod() !== 'cash') {
                            <label class="modal-field">
                              <span>Referencia</span>
                              <input class="modal-input pos-focus-ring" type="text" [value]="draftReference()" (input)="onDraftReference($event)" />
                            </label>
                          }
                        </div>
                      }

                      @if (selectedPaymentMethod() !== 'cash') {
                        <div class="pos-pay-form__actions">
                          <button type="button" class="btn-modal btn-modal--ghost pos-focus-ring" (click)="fillDraftPending()">Saldo pendiente</button>
                          @if (selectedPaymentMethod() === 'payphone') {
                            <button
                              type="button"
                              class="btn-modal pos-focus-ring"
                              [class.btn-modal--disabled]="!canStartPayPhoneCollection()"
                              [disabled]="!canStartPayPhoneCollection()"
                              (click)="startPayPhoneCollection()">
                              {{ payPhoneWidget.busy() ? 'Procesando PayPhone...' : 'Cobrar con PayPhone' }}
                            </button>
                            @if (payPhoneWidget.session()) {
                              <button
                                type="button"
                                class="btn-modal btn-modal--ghost pos-focus-ring"
                                [disabled]="payPhoneWidget.busy()"
                                (click)="refreshPayPhoneStatus()">
                                Consultar estado
                              </button>
                            }
                          }
                          @if (selectedPaymentMethod() === 'stripe' || selectedPaymentMethod() === 'kushki') {
                            <button type="button" class="btn-modal btn-modal--ghost pos-focus-ring" (click)="prepareExternalPayment()">Iniciar / confirmar proveedor</button>
                          }
                          @if (selectedPaymentMethod() !== 'payphone') {
                            <button type="button" class="btn-modal pos-focus-ring" [class.btn-modal--disabled]="!canAddPaymentLine()" (click)="tryAddPaymentLine()">Agregar pago</button>
                          }
                        </div>
                      }
                    </div>

                    @if (selectedPaymentMethod() === 'cash') {
                      <div class="pos-pay-step">
                        <div class="cash-denoms__head">
                          <h4 class="pos-pay-step__title pos-pay-step__title--inline">3. Denominaciones rápidas</h4>
                        </div>
                        <div class="cash-denoms__rows">
                          <div class="cash-denoms__grid cash-denoms__grid--row">
                            <button type="button" class="cash-denom cash-denom--exact pos-focus-ring" (click)="setDraftCashExact()">
                              Exacto
                              <strong>{{ saldoPendiente() | currency: 'USD' : 'symbol-narrow' : '1.2-2' }}</strong>
                            </button>
                            @for (d of tenderDenominationsRow1; track d) {
                              <button type="button" class="cash-denom pos-focus-ring" (click)="setDraftCashTender(d)">
                                {{ d | currency: 'USD' : 'symbol-narrow' : '1.0-0' }}
                              </button>
                            }
                          </div>
                          <div class="cash-denoms__grid cash-denoms__grid--row">
                            @for (d of tenderDenominationsRow2; track d) {
                              <button type="button" class="cash-denom pos-focus-ring" (click)="setDraftCashTender(d)">
                                {{ d | currency: 'USD' : 'symbol-narrow' : '1.0-0' }}
                              </button>
                            }
                            @for (amount of suggestedTenderAmounts(); track amount) {
                              <button type="button" class="cash-denom pos-focus-ring" (click)="setDraftCashTender(amount)">
                                {{ amount | currency: 'USD' : 'symbol-narrow' : '1.2-2' }}
                              </button>
                            }
                            <button type="button" class="cash-denom cash-denom--clear pos-focus-ring" (click)="clearDraftCash()">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                <path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m2 0v12a2 2 0 01-2 2H8a2 2 0 01-2-2V7h12z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                              </svg>
                              Limpiar
                            </button>
                          </div>
                        </div>
                      </div>
                    }

                    <div class="pos-pay-step">
                      <div class="pos-pay-lines__head">
                        <h4 class="pos-pay-step__title pos-pay-step__title--inline">Pagos registrados ({{ paymentLines().length }})</h4>
                        @if (paymentLines().length) {
                          <button type="button" class="cash-denoms__clear pos-focus-ring" (click)="clearPayments()">Limpiar</button>
                        }
                      </div>
                      <div class="pos-pay-table" role="table" aria-label="Líneas de pago">
                        <div class="pos-pay-table__row pos-pay-table__row--head" role="row">
                          <span>Método</span>
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
                            <span>{{ line.referencia || line.codigoAutorizacion || line.transaccionProveedorId || '—' }}</span>
                            <button type="button" class="pos-pay-remove pos-focus-ring" (click)="removePaymentLine(line.id)" aria-label="Eliminar pago">×</button>
                          </div>
                        } @empty {
                          <div class="pos-pay-table__empty">
                            <span class="pos-pay-table__empty-icon" aria-hidden="true">
                              <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                                <path d="M8 4h11a1 1 0 011 1v14a1 1 0 01-1 1H8a1 1 0 01-1-1V5a1 1 0 011-1z" stroke="currentColor" stroke-width="1.5" />
                                <path d="M8 8h8M8 11h8M8 14h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                              </svg>
                            </span>
                            <span>Aún no se han registrado pagos</span>
                          </div>
                        }
                      </div>
                    </div>
                  </section>

                  <aside class="pos-pay-side" aria-label="Resumen del cobro">
                    <h4 class="pos-pay-side__title">Resumen del cobro</h4>
                    <div class="pos-pay-summary__row">
                      <span>Total a pagar</span>
                      <strong>{{ total() | currency: 'USD' : 'symbol-narrow' : '1.2-2' }}</strong>
                    </div>
                    <div class="pos-pay-summary__row">
                      <span>Total pagado</span>
                      <strong>{{ totalPagado() | currency: 'USD' : 'symbol-narrow' : '1.2-2' }}</strong>
                    </div>
                    <div class="pos-pay-summary__row" [class.pos-pay-summary__row--warn]="saldoPendiente() > 0">
                      <span>Pendiente</span>
                      <strong>{{ saldoPendiente() | currency: 'USD' : 'symbol-narrow' : '1.2-2' }}</strong>
                    </div>
                    <div class="pos-pay-summary__row" [class.pos-pay-summary__row--ok]="vueltoTotal() > 0">
                      <span>Vuelto</span>
                      <strong>{{ vueltoTotal() | currency: 'USD' : 'symbol-narrow' : '1.2-2' }}</strong>
                    </div>
                    <div class="pos-pay-safe">
                      <span class="pos-pay-safe__icon" aria-hidden="true">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                          <path d="M12 3.5l7 3.2v5.1c0 4.1-2.9 7.9-7 9.2-4.1-1.3-7-5.1-7-9.2V6.7l7-3.2z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
                          <path d="M8 12.5l2.5 2.5L16 9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
                        </svg>
                      </span>
                      <span class="pos-pay-safe__copy">
                        <strong>Pago seguro</strong>
                        <small>Verifica el monto recibido antes de confirmar el cobro.</small>
                      </span>
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

                <footer class="pos-pay-footer">
                  <div class="pos-pay-footer__bar">
                  <div class="pos-pay-footer__stats">
                    <div class="pos-pay-stat pos-pay-stat--total">
                      <span class="pos-pay-stat__icon" aria-hidden="true">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M8 4h11a1 1 0 011 1v14a1 1 0 01-1 1H8a1 1 0 01-1-1V5a1 1 0 011-1z" stroke="currentColor" stroke-width="1.5" /></svg>
                      </span>
                      <span class="pos-pay-stat__copy">
                        <small>Total</small>
                        <strong>{{ total() | currency: 'USD' : 'symbol-narrow' : '1.2-2' }}</strong>
                      </span>
                    </div>
                    <div class="pos-pay-stat pos-pay-stat--paid">
                      <span class="pos-pay-stat__icon" aria-hidden="true">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 2v20M17 7H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" /></svg>
                      </span>
                      <span class="pos-pay-stat__copy">
                        <small>Pagado</small>
                        <strong>{{ totalPagado() | currency: 'USD' : 'symbol-narrow' : '1.2-2' }}</strong>
                      </span>
                    </div>
                    <div class="pos-pay-stat pos-pay-stat--pending">
                      <span class="pos-pay-stat__icon" aria-hidden="true">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 8v5M12 16h.01M10.3 4.3l-7.4 12.8A2 2 0 004.6 20h14.8a2 2 0 001.7-2.9l-7.4-12.8a2 2 0 00-3.4 0z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" /></svg>
                      </span>
                      <span class="pos-pay-stat__copy">
                        <small>Pendiente</small>
                        <strong>{{ saldoPendiente() | currency: 'USD' : 'symbol-narrow' : '1.2-2' }}</strong>
                      </span>
                    </div>
                    <div class="pos-pay-stat pos-pay-stat--change">
                      <span class="pos-pay-stat__icon" aria-hidden="true">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="8" cy="8" r="3" stroke="currentColor" stroke-width="1.5" /><circle cx="16" cy="16" r="3" stroke="currentColor" stroke-width="1.5" /></svg>
                      </span>
                      <span class="pos-pay-stat__copy">
                        <small>Vuelto</small>
                        <strong>{{ vueltoTotal() | currency: 'USD' : 'symbol-narrow' : '1.2-2' }}</strong>
                      </span>
                    </div>
                  </div>
                  <div class="pos-pay-footer__actions">
                    <button type="button" class="pos-pay-btn pos-pay-btn--ghost pos-focus-ring" (click)="closeModal()">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path d="M8 8l8 8M16 8l-8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                      </svg>
                      <span>
                        <strong>Cancelar</strong>
                        <small>Descartar cobro actual</small>
                      </span>
                    </button>
                    <button
                      type="button"
                      class="pos-pay-btn pos-pay-btn--primary pos-focus-ring"
                      [class.pos-pay-btn--disabled]="!canConfirmCobro() || checkoutLoading()"
                      (click)="tryConfirmarCobro()">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path d="M8 11V8a4 4 0 118 0v3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
                        <rect x="6" y="11" width="12" height="9" rx="2" stroke="currentColor" stroke-width="1.6" />
                      </svg>
                      <span>
                        <strong>{{ checkoutLoading() ? 'Registrando…' : 'Confirmar cobro' }}</strong>
                        <small>Aplicar pagos registrados</small>
                      </span>
                    </button>
                  </div>
                  </div>
                </footer>
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
      --venta-tool-h: 2.125rem;
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
      width: 100%;
      max-width: none;
      margin: 0;
      gap: 0.55rem;
      overflow: hidden;
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
      padding: 0.5rem 0.65rem;
      border-bottom: 1px solid var(--pos-border);
      background: #ffffff;
      flex: 0 0 auto;
    }
    html[data-theme='dark'] .cart-head {
      background: var(--pos-elevated);
    }
    .cart-head__aside {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      flex-shrink: 0;
    }
    .cart-head__hints {
      display: flex;
      align-items: center;
      gap: 0.28rem;
      flex-wrap: wrap;
      justify-content: flex-end;
      max-width: 14rem;
    }
    .cart-hint {
      font-size: 0.58rem;
      font-weight: 700;
      padding: 0.14rem 0.38rem;
      border-radius: 999px;
      border: 1px solid var(--pos-border-strong);
      background: var(--pos-surface-2);
      color: var(--pos-muted);
      white-space: nowrap;
      cursor: default;
    }
    .cart-hint--warn {
      border-color: rgba(217, 119, 6, 0.35);
      background: rgba(251, 191, 36, 0.12);
      color: #92400e;
    }
    html[data-theme='dark'] .cart-hint--warn {
      color: #fcd34d;
    }
    .cart-hint--err {
      border-color: rgba(251, 113, 133, 0.28);
      background: rgba(251, 113, 133, 0.1);
      color: #e11d48;
    }
    .cart-hint--link {
      cursor: pointer;
      border-color: var(--pos-status-ok-border);
      background: var(--pos-status-ok-bg);
      color: var(--pos-status-ok);
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
      padding: 0.45rem 0.6rem 0.5rem;
      border-bottom: 1px solid var(--pos-border);
      background: #ffffff;
      flex: 0 0 auto;
      display: grid;
      gap: 0.38rem;
    }
    html[data-theme='dark'] .customer-panel {
      background: var(--pos-elevated);
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
      gap: 0.5rem;
      padding: 0.5rem 0.55rem;
      border-radius: 5px;
      border: 1px solid #e2e8f0;
      background: #ffffff;
    }
    .customer-panel__avatar {
      width: 2.15rem;
      height: 2.15rem;
      border-radius: 50%;
      display: grid;
      place-items: center;
      flex-shrink: 0;
      font-size: 0.68rem;
      font-weight: 800;
      letter-spacing: 0.02em;
      color: #334155;
      background: #f1f5f9;
      border: 1px solid #e2e8f0;
    }
    .customer-panel__cf-badge {
      border: 1px solid #e2e8f0;
      border-radius: 5px;
      background: #ffffff;
      color: #334155;
      font-size: 0.64rem;
      font-weight: 700;
      padding: 0.28rem 0.42rem;
      cursor: pointer;
      flex-shrink: 0;
      min-width: 2rem;
      text-align: center;
    }
    .customer-panel__cf-badge--on {
      background: #f8fafc;
      color: var(--lux-indigo);
    }
    .customer-panel__active-text {
      display: grid;
      gap: 0.1rem;
      min-width: 0;
      flex: 1;
    }
    .customer-panel__active-text strong {
      font-size: 0.8rem;
      font-weight: 700;
      line-height: 1.2;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .customer-panel__active-text span,
    .customer-panel__meta {
      font-family: var(--pos-mono);
      font-size: 0.64rem;
      color: var(--pos-muted);
    }
    .customer-panel__active--compact {
      margin-bottom: 0;
    }
    .customer-panel__search {
      display: flex;
      flex-wrap: nowrap;
      gap: 0.32rem;
      align-items: center;
    }
    .customer-panel__input,
    .customer-panel__btn,
    .customer-panel__chip {
      height: var(--venta-tool-h);
      min-height: var(--venta-tool-h);
      max-height: var(--venta-tool-h);
      box-sizing: border-box;
      line-height: 1;
    }
    .customer-panel__input {
      flex: 1;
      min-width: 0;
      border-radius: 5px;
      border: 1px solid #e2e8f0;
      background: #f8fafc;
      color: var(--pos-text);
      padding: 0 0.55rem;
      font-size: 0.76rem;
    }
    .customer-panel__btn {
      border-radius: 5px;
      border: 1px solid #e2e8f0;
      background: #ffffff;
      color: var(--lux-indigo);
      font-size: 0.74rem;
      font-weight: 700;
      padding: 0 0.72rem;
      cursor: pointer;
      flex-shrink: 0;
      white-space: nowrap;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .customer-panel__btn:disabled {
      opacity: 0.6;
      cursor: wait;
    }
    .customer-panel__chip {
      border-radius: 5px;
      border: 1px solid #e2e8f0;
      background: #ffffff;
      color: var(--pos-text);
      font-size: 0.72rem;
      font-weight: 600;
      padding: 0 0.62rem;
      cursor: pointer;
      flex-shrink: 0;
      white-space: nowrap;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .customer-panel__chip--active {
      border-color: #e2e8f0;
      background: #f8fafc;
      color: var(--lux-indigo);
      font-weight: 700;
    }
    .customer-panel__chip--ghost {
      background: transparent;
      color: var(--pos-muted);
    }
    .btn-xs {
      border-radius: 5px;
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
      overflow: hidden;
      display: grid;
      grid-template-columns: minmax(18rem, 2fr) minmax(0, 3fr);
      grid-template-rows: minmax(0, 1fr);
      gap: 0.75rem;
      align-items: stretch;
    }
    .panel--cart {
      order: 1;
    }
    .panel--wide {
      order: 2;
    }
    .venta__grid--catalog-left {
      grid-template-columns: minmax(0, 3fr) minmax(18rem, 2fr);
    }
    .venta__grid--catalog-left .panel--wide {
      order: 1;
    }
    .venta__grid--catalog-left .panel--cart {
      order: 2;
    }
    @media (max-width: 900px) {
      .venta__grid,
      .venta__grid--catalog-left {
        grid-template-columns: 1fr;
        grid-template-rows: minmax(12rem, 55vh) minmax(14rem, 1fr);
      }
      .panel--wide,
      .panel--cart {
        order: initial;
      }
    }
    .panel {
      border-radius: var(--pos-radius);
      border: none;
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
      max-height: 100%;
      overflow: hidden;
    }
    .catalog-toolbar {
      flex-shrink: 0;
      padding: 0.65rem 0.75rem 0.6rem;
      border-bottom: 1px solid var(--pos-border);
      background: var(--pos-elevated);
      display: flex;
      flex-direction: column;
      gap: 0.42rem;
    }
    .catalog-search {
      display: flex;
      align-items: center;
      gap: 0.45rem;
      height: var(--venta-tool-h);
      min-height: var(--venta-tool-h);
      max-height: var(--venta-tool-h);
      box-sizing: border-box;
      padding: 0 0.65rem 0 0.55rem;
      border-radius: 5px;
      border: 1px solid #e2e8f0;
      background: #ffffff;
      box-shadow: none;
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
    .catalog-search__clear,
    .catalog-search__scan {
      display: grid;
      place-items: center;
      width: 1.85rem;
      height: 1.85rem;
      border: none;
      border-radius: 5px;
      background: transparent;
      cursor: pointer;
      flex-shrink: 0;
      padding: 0;
      transition: background var(--pos-transition);
    }
    .catalog-search__clear {
      color: var(--pos-muted);
    }
    .catalog-search__clear:hover {
      background: color-mix(in srgb, var(--pos-muted) 10%, #ffffff);
      color: var(--pos-text);
    }
    .catalog-search__scan {
      color: var(--lux-indigo);
    }
    .catalog-search__scan:hover {
      background: color-mix(in srgb, var(--lux-indigo) 8%, #ffffff);
    }
    .catalog-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 1.1rem;
      min-height: min(28rem, 100%);
      padding: 2rem 1.25rem 2.5rem;
      text-align: center;
    }
    .catalog-empty__hero {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.65rem;
      max-width: 22rem;
    }
    .catalog-empty__icon-wrap {
      position: relative;
      display: grid;
      place-items: center;
      width: 5.75rem;
      height: 5.75rem;
      margin-bottom: 0.35rem;
      border-radius: 50%;
      background: color-mix(in srgb, var(--lux-indigo) 8%, #ffffff);
      box-shadow: 0 0 0 1px color-mix(in srgb, var(--lux-indigo) 12%, #e2e8f0);
    }
    html[data-theme='dark'] .catalog-empty__icon-wrap {
      background: color-mix(in srgb, var(--lux-indigo) 12%, var(--pos-elevated));
      box-shadow: 0 0 0 1px color-mix(in srgb, var(--lux-indigo) 20%, var(--pos-border));
    }
    .catalog-empty__spark {
      position: absolute;
      font-size: 0.72rem;
      line-height: 1;
      color: color-mix(in srgb, var(--lux-indigo) 50%, #94a3b8);
      pointer-events: none;
    }
    .catalog-empty__spark--1 {
      top: 0.65rem;
      right: 0.75rem;
    }
    .catalog-empty__spark--2 {
      top: 1.35rem;
      left: 0.55rem;
      font-size: 1rem;
    }
    .catalog-empty__spark--3 {
      bottom: 0.85rem;
      right: 0.55rem;
    }
    .catalog-empty__icon {
      display: block;
    }
    .catalog-empty__title {
      margin: 0;
      font-size: 1.08rem;
      font-weight: 800;
      letter-spacing: -0.02em;
      color: var(--pos-text);
    }
    .catalog-empty__desc {
      margin: 0;
      font-size: 0.8rem;
      line-height: 1.5;
      color: var(--pos-muted);
    }
    .catalog-empty__term {
      color: var(--pos-text);
      font-weight: 700;
    }
    .catalog-empty__suggestions {
      display: flex;
      align-items: center;
      gap: 0.85rem;
      width: min(100%, 28rem);
      color: var(--pos-faint);
      font-size: 0.68rem;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .catalog-empty__suggestions::before,
    .catalog-empty__suggestions::after {
      content: '';
      flex: 1;
      height: 1px;
      background: var(--pos-border);
    }
    .catalog-empty__actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: center;
      gap: 0.45rem;
      width: min(100%, 36rem);
    }
    .catalog-empty__action {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      min-height: 2.15rem;
      padding: 0.42rem 0.72rem;
      border: 1px solid #e2e8f0;
      border-radius: 5px;
      background: #ffffff;
      color: var(--pos-text);
      font-size: 0.74rem;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
      transition:
        border-color var(--pos-transition),
        background var(--pos-transition),
        color var(--pos-transition),
        box-shadow var(--pos-transition);
    }
    html[data-theme='dark'] .catalog-empty__action {
      background: var(--pos-elevated);
      border-color: var(--pos-border);
    }
    .catalog-empty__action:hover {
      border-color: color-mix(in srgb, var(--lux-indigo) 32%, #e2e8f0);
      background: color-mix(in srgb, var(--lux-indigo) 6%, #ffffff);
      color: var(--lux-primary-deep);
      box-shadow: 0 6px 18px -14px color-mix(in srgb, var(--lux-indigo) 35%, transparent);
    }
    .catalog-empty__action svg {
      flex-shrink: 0;
      color: var(--pos-muted);
    }
    .catalog-empty__action:hover svg {
      color: var(--lux-primary-strong);
    }
    @media (max-width: 720px) {
      .catalog-empty__actions {
        flex-direction: column;
        align-items: stretch;
      }
      .catalog-empty__action {
        justify-content: center;
      }
    }
    .catalog-toolbar__row {
      display: flex;
      align-items: center;
      gap: 0.38rem;
      min-width: 0;
    }
    .catalog-filter {
      flex: 0 1 11.5rem;
      min-width: 8.5rem;
    }
    .catalog-filter__select,
    .cat,
    .catalog-view__btn {
      height: var(--venta-tool-h);
      min-height: var(--venta-tool-h);
      max-height: var(--venta-tool-h);
      box-sizing: border-box;
      line-height: 1;
    }
    .catalog-filter__select {
      width: 100%;
      padding: 0 0.55rem;
      border-radius: 5px;
      border: 1px solid #e2e8f0;
      background: #ffffff;
      color: var(--pos-text);
      font-size: 0.74rem;
      font-weight: 600;
    }
    .catalog-view {
      display: inline-flex;
      align-items: center;
      gap: 0.22rem;
      margin-left: auto;
      flex-shrink: 0;
    }
    .catalog-view__btn {
      width: var(--venta-tool-h);
      display: grid;
      place-items: center;
      border-radius: 5px;
      border: 1px solid #e2e8f0;
      background: #ffffff;
      color: var(--pos-muted);
      cursor: pointer;
      padding: 0;
      transition:
        border-color var(--pos-transition),
        background var(--pos-transition),
        color var(--pos-transition);
    }
    .catalog-view__btn:hover {
      border-color: #cbd5e1;
      color: var(--pos-text);
    }
    .catalog-view__btn--on {
      border-color: color-mix(in srgb, var(--lux-indigo) 28%, #e2e8f0);
      background: color-mix(in srgb, var(--lux-indigo) 8%, #ffffff);
      color: var(--lux-indigo);
    }
    .catalog-pager {
      flex-shrink: 0;
      display: grid;
      grid-template-columns: auto 1fr auto;
      align-items: center;
      gap: 0.65rem;
      padding: 0.55rem 0.85rem 0.65rem;
      border-top: 1px solid var(--pos-border);
      background: var(--pos-elevated);
      font-size: 0.72rem;
      color: var(--pos-muted);
    }
    .catalog-pager__center {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.28rem;
      min-width: 0;
    }
    .catalog-pager__pages {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.2rem;
      flex-wrap: wrap;
    }
    .catalog-pager__meta {
      text-align: center;
      min-width: 0;
      font-size: 0.68rem;
      font-variant-numeric: tabular-nums;
      color: var(--pos-faint);
    }
    .pager-nav {
      display: inline-flex;
      align-items: center;
      gap: 0.28rem;
      border: none;
      background: transparent;
      color: var(--pos-muted);
      font-size: 0.72rem;
      font-weight: 600;
      padding: 0.28rem 0.15rem;
      cursor: pointer;
      flex-shrink: 0;
      transition: color var(--pos-transition);
    }
    .pager-nav:hover:not(:disabled) {
      color: var(--pos-text);
    }
    .pager-nav:disabled {
      opacity: 0.35;
      cursor: not-allowed;
    }
    .pager-page {
      min-width: 1.65rem;
      height: 1.65rem;
      padding: 0 0.35rem;
      border: none;
      border-radius: 5px;
      background: transparent;
      color: var(--pos-muted);
      font-size: 0.72rem;
      font-weight: 600;
      cursor: pointer;
      font-variant-numeric: tabular-nums;
      transition:
        background var(--pos-transition),
        color var(--pos-transition);
    }
    .pager-page:hover {
      color: var(--pos-text);
      background: color-mix(in srgb, var(--pos-muted) 10%, transparent);
    }
    .pager-page--on {
      color: var(--lux-indigo);
      background: color-mix(in srgb, var(--lux-indigo) 12%, #ffffff);
      font-weight: 700;
    }
    .pager-ellipsis {
      min-width: 1.2rem;
      text-align: center;
      color: var(--pos-faint);
      font-size: 0.78rem;
      user-select: none;
    }
    .cats {
      display: flex;
      flex-wrap: nowrap;
      gap: 0.28rem;
      min-width: 0;
      overflow-x: auto;
    }
    .cat {
      border: 1px solid #e2e8f0;
      background: #ffffff;
      color: var(--pos-muted);
      font-size: 0.72rem;
      font-weight: 600;
      padding: 0 0.72rem;
      border-radius: 5px;
      cursor: pointer;
      white-space: nowrap;
      display: inline-flex;
      align-items: center;
      justify-content: center;
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
      grid-template-columns: repeat(6, minmax(0, 1fr));
      gap: 0.58rem;
      padding: 0.62rem 0.68rem 0.72rem;
      align-content: start;
    }
    .products--list {
      grid-template-columns: 1fr;
      gap: 0.45rem;
    }
    .products--list .card {
      flex-direction: row;
      align-items: stretch;
    }
    .products--list .card__main {
      flex-direction: row;
      align-items: center;
    }
    .products--list .card__thumb {
      width: 4.25rem;
      aspect-ratio: 1;
      border-bottom: none;
      border-right: 1px solid var(--pos-border);
    }
    .products--list .card__body {
      flex: 1;
      padding: 0.55rem 0.65rem;
    }
    .products--list .card__foot {
      border-top: 1px solid #e2e8f0;
      padding: 0.38rem 0.55rem;
      align-self: stretch;
      min-width: 8.5rem;
    }
    @media (max-width: 1500px) {
      .products {
        grid-template-columns: repeat(5, minmax(0, 1fr));
      }
    }
    @media (max-width: 1280px) {
      .products {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }
    }
    @media (max-width: 1024px) {
      .products {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
    }
    @media (max-width: 900px) {
      .products {
        grid-template-columns: repeat(auto-fill, minmax(9.25rem, 1fr));
      }
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
      display: none;
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
      display: flex;
      flex-direction: column;
      text-align: left;
      border: none;
      background: transparent;
      padding: 0;
      cursor: pointer;
      color: inherit;
      font: inherit;
    }
    .card__thumb {
      width: 100%;
      aspect-ratio: 1;
      background: color-mix(in srgb, var(--pos-surface-2) 88%, var(--pos-border));
      border-bottom: 1px solid var(--pos-border);
      overflow: hidden;
      flex-shrink: 0;
    }
    .card__thumb img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .card__main--locked,
    .card__badge--locked,
    .line-card__dcto--locked,
    .line-card__qty-btn--locked,
    .line-chip--locked,
    .line-card__remove--locked,
    .sale-tab--locked,
    .btn-pay--locked {
      opacity: 0.55;
      cursor: not-allowed;
    }
    .card__body {
      padding: 0.5rem 0.55rem 0.48rem;
      display: flex;
      flex-direction: column;
      gap: 0.08rem;
      flex: 1;
      min-width: 0;
    }
    .card__cat {
      font-size: 0.52rem;
      font-weight: 700;
      color: var(--pos-accent);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      line-height: 1.2;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .card__tag {
      font-size: 0.56rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      color: var(--pos-muted);
    }
    .card__name {
      font-size: 0.76rem;
      font-weight: 600;
      color: var(--pos-text);
      line-height: 1.25;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .card__sku {
      font-size: 0.62rem;
      color: var(--pos-faint);
      font-family: var(--pos-mono);
    }
    .card__price {
      margin-top: 0.2rem;
      font-size: 0.96rem;
      font-weight: 850;
      color: var(--pos-text);
    }
    .card__foot {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.35rem;
      margin-top: 0;
      padding: 0.42rem 0.55rem 0.5rem;
      border-top: 1px solid #e2e8f0;
      flex-shrink: 0;
    }
    .card__badge {
      width: 100%;
      min-height: 1.7rem;
      border-radius: 5px;
      border: 1px solid #e2e8f0;
      background: #ffffff;
      padding: 0.28rem 0.35rem;
      margin: 0;
      font-size: 0.58rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      cursor: pointer;
      line-height: 1;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition:
        border-color var(--pos-transition),
        background var(--pos-transition),
        color var(--pos-transition);
    }
    .card__badge--stock {
      color: #0d9488;
      border-color: color-mix(in srgb, #0d9488 38%, #e2e8f0);
      background: color-mix(in srgb, #0d9488 9%, #ffffff);
    }
    .card__badge--promo {
      color: #334155;
      border-color: #e2e8f0;
      background: #ffffff;
    }
    .card__badge--stock:hover:not(.card__badge--locked) {
      border-color: color-mix(in srgb, #0d9488 55%, #e2e8f0);
      background: color-mix(in srgb, #0d9488 14%, #ffffff);
    }
    .card__badge--promo:hover:not(.card__badge--locked) {
      border-color: #cbd5e1;
      background: #f8fafc;
    }
    .card__badge--locked {
      opacity: 0.55;
      cursor: not-allowed;
    }
    html[data-theme='dark'] .card__badge--stock {
      color: #5eead4;
      border-color: color-mix(in srgb, #5eead4 35%, var(--pos-border));
      background: color-mix(in srgb, #5eead4 10%, var(--pos-elevated));
    }
    html[data-theme='dark'] .card__badge--promo {
      color: var(--pos-text);
      border-color: var(--pos-border);
      background: var(--pos-surface);
    }
    html[data-theme='dark'] .card__foot {
      border-top-color: var(--pos-border);
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
    .lines {
      flex: 1 1 0;
      min-height: 0;
      overflow-y: auto;
      overflow-x: hidden;
      overscroll-behavior: contain;
      padding: 0.45rem 0.55rem 0.4rem;
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: 0.42rem;
    }
    .line-card {
      position: relative;
      display: flex;
      gap: 0.62rem;
      align-items: center;
      flex: 0 0 auto;
      flex-shrink: 0;
      border: 1px solid #e2e8f0;
      border-radius: 5px;
      background: #ffffff;
      padding: 0.62rem 0.65rem 0.62rem 0.85rem;
      box-shadow: none;
      overflow: hidden;
    }
    .line-card__thumb {
      width: 3.35rem;
      height: 3.35rem;
      flex-shrink: 0;
      border-radius: 5px;
      overflow: hidden;
      border: none;
      background: #f8fafc;
    }
    .line-card__thumb img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .line-card__body {
      flex: 1;
      min-width: 0;
    }
    .line-card::before {
      content: '';
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 4px;
      background: linear-gradient(180deg, #c026d3 0%, #6366f1 48%, #00e5ff 100%);
      border-radius: 5px 0 0 5px;
    }
    html[data-theme='dark'] .line-card {
      background: var(--pos-elevated);
      border-color: var(--pos-border);
    }
    html[data-theme='dark'] .customer-panel__active,
    html[data-theme='dark'] .customer-panel__input,
    html[data-theme='dark'] .customer-panel__btn,
    html[data-theme='dark'] .customer-panel__chip,
    html[data-theme='dark'] .catalog-search,
    html[data-theme='dark'] .catalog-filter__select,
    html[data-theme='dark'] .cat,
    html[data-theme='dark'] .catalog-view__btn {
      background: var(--pos-elevated);
      border-color: var(--pos-border);
    }
    html[data-theme='dark'] .customer-panel__input,
    html[data-theme='dark'] .catalog-search {
      background: var(--pos-surface);
    }
    .line-card__head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 0.55rem;
      margin-bottom: 0.42rem;
    }
    .line-card__identity {
      min-width: 0;
      flex: 1;
    }
    .line-card__name {
      display: block;
      font-size: 0.82rem;
      font-weight: 700;
      color: var(--pos-text);
      line-height: 1.25;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .line-card__sku {
      display: inline-block;
      margin-top: 0.14rem;
      font-size: 0.62rem;
      color: var(--pos-faint);
      font-family: var(--pos-mono);
      letter-spacing: 0.02em;
    }
    .line-card__amount {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 0.06rem;
      flex-shrink: 0;
    }
    .line-card__gross {
      font-size: 0.62rem;
      color: var(--pos-faint);
      text-decoration: line-through;
      font-family: var(--pos-mono);
      font-variant-numeric: tabular-nums;
    }
    .line-card__disc {
      font-size: 0.58rem;
      font-weight: 700;
      color: var(--pos-warn);
      font-family: var(--pos-mono);
    }
    .line-card__sum {
      font-size: 0.92rem;
      font-weight: 800;
      color: var(--pos-text);
      font-family: var(--pos-mono);
      font-variant-numeric: tabular-nums;
      line-height: 1.1;
    }
    .line-card__actions {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      flex-wrap: wrap;
    }
    .line-card__price {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      min-width: 0;
      max-width: 9rem;
      height: 1.85rem;
      padding: 0 0.5rem;
      border-radius: 5px;
      border: 1px solid #e2e8f0;
      background: #ffffff;
      color: var(--pos-text);
      cursor: pointer;
      flex-shrink: 0;
    }
    .line-card__price:hover:not(:disabled) {
      border-color: color-mix(in srgb, var(--pos-accent) 38%, var(--pos-border-strong));
      background: color-mix(in srgb, var(--pos-accent-muted) 38%, var(--pos-surface-2));
    }
    .line-card__price--locked,
    .line-card__price:disabled {
      cursor: default;
      opacity: 0.9;
      border-color: var(--pos-border);
      background: var(--pos-surface-2);
    }
    .line-card__price-val {
      font-family: var(--pos-mono);
      font-size: 0.76rem;
      font-weight: 800;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
      color: #0f172a;
    }
    .line-card__price-tag {
      font-size: 0.52rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--lux-indigo);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 4.2rem;
    }
    .line-card__price-chevron {
      flex-shrink: 0;
      color: var(--pos-muted);
      margin-left: auto;
    }
    .line-card__dcto {
      border-radius: 5px;
      border: 1px solid #e2e8f0;
      background: #ffffff;
      color: #334155;
      font-size: 0.68rem;
      font-weight: 600;
      height: 1.85rem;
      padding: 0 0.55rem;
      cursor: pointer;
      flex-shrink: 0;
      white-space: nowrap;
    }
    .line-card__dcto:hover:not(.line-card__dcto--locked) {
      color: var(--pos-text);
      border-color: var(--pos-text);
    }
    .line-card__dcto--locked {
      opacity: 0.55;
      cursor: not-allowed;
    }
    .line-card__qty {
      display: flex;
      align-items: center;
      gap: 0.18rem;
      margin-left: auto;
      flex-shrink: 0;
    }
    .line-card__qty-btn {
      width: 1.85rem;
      height: 1.85rem;
      border-radius: 5px;
      border: 1px solid var(--pos-border-strong);
      background: var(--pos-surface-2);
      color: var(--pos-text);
      font-size: 0.95rem;
      line-height: 1;
      cursor: pointer;
      display: grid;
      place-items: center;
      padding: 0;
    }
    .line-card__qty-btn:hover:not(.line-card__qty-btn--locked) {
      border-color: var(--pos-accent);
      color: var(--pos-accent-hover);
    }
    .line-card__qty-btn--locked {
      opacity: 0.55;
      cursor: not-allowed;
    }
    .line-card__qty-input {
      width: 2.35rem;
      height: 1.85rem;
      text-align: center;
      font-weight: 700;
      font-family: var(--pos-mono);
      font-size: 0.78rem;
      border-radius: 5px;
      border: 1px solid var(--pos-border-strong);
      background: var(--pos-elevated);
      color: var(--pos-text);
      padding: 0;
      font-variant-numeric: tabular-nums;
    }
    .line-card__qty-input::-webkit-outer-spin-button,
    .line-card__qty-input::-webkit-inner-spin-button {
      margin: 0;
    }
    .line-card__remove {
      width: 1.85rem;
      height: 1.85rem;
      border-radius: 5px;
      border: 1px solid rgba(185, 28, 28, 0.22);
      background: rgba(248, 113, 113, 0.08);
      color: #b91c1c;
      cursor: pointer;
      display: grid;
      place-items: center;
      padding: 0;
      flex-shrink: 0;
    }
    .line-card__remove:hover:not(.line-card__remove--locked) {
      border-color: #b91c1c;
      background: rgba(248, 113, 113, 0.14);
    }
    .line-card__remove--locked {
      opacity: 0.55;
      cursor: not-allowed;
    }
    html[data-theme='dark'] .line-card__remove {
      color: #fca5a5;
    }
    .cart-empty {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: stretch;
      justify-content: center;
      gap: 1.15rem;
      padding: 1.25rem 0.85rem 1.5rem;
      min-height: min(28rem, 100%);
    }
    .cart-empty__hero {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      gap: 0.55rem;
    }
    .cart-empty__icon-wrap {
      position: relative;
      display: grid;
      place-items: center;
      width: 5.5rem;
      height: 5.5rem;
      margin-bottom: 0.35rem;
      border: 1.5px dashed color-mix(in srgb, var(--lux-indigo) 28%, #e2e8f0);
      border-radius: 50%;
      background: color-mix(in srgb, var(--lux-indigo) 4%, #ffffff);
    }
    html[data-theme='dark'] .cart-empty__icon-wrap {
      border-color: color-mix(in srgb, var(--lux-indigo) 35%, var(--pos-border));
      background: color-mix(in srgb, var(--lux-indigo) 8%, var(--pos-elevated));
    }
    .cart-empty__spark {
      position: absolute;
      font-size: 0.72rem;
      line-height: 1;
      color: color-mix(in srgb, var(--lux-indigo) 55%, #94a3b8);
      pointer-events: none;
    }
    .cart-empty__spark--1 {
      top: 0.55rem;
      right: 0.85rem;
    }
    .cart-empty__spark--2 {
      top: 1.1rem;
      left: 0.45rem;
      font-size: 0.82rem;
      font-weight: 700;
    }
    .cart-empty__spark--3 {
      bottom: 0.75rem;
      right: 0.55rem;
    }
    .cart-empty__icon {
      display: block;
    }
    .cart-empty__title {
      margin: 0;
      font-size: 1.02rem;
      font-weight: 800;
      letter-spacing: -0.02em;
      color: var(--pos-text);
    }
    .cart-empty__desc {
      margin: 0;
      max-width: 16rem;
      font-size: 0.78rem;
      line-height: 1.45;
      color: var(--pos-muted);
    }
    .cart-empty__actions {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 0.45rem;
      width: 100%;
    }
    @media (max-width: 720px) {
      .cart-empty__actions {
        grid-template-columns: 1fr;
      }
    }
    .cart-empty__action {
      display: flex;
      align-items: center;
      gap: 0.55rem;
      width: 100%;
      min-height: 3.65rem;
      padding: 0.55rem 0.62rem;
      border: 1px solid #e2e8f0;
      border-radius: 5px;
      background: #ffffff;
      color: var(--pos-text);
      text-align: left;
      cursor: pointer;
      transition:
        border-color var(--pos-transition),
        box-shadow var(--pos-transition),
        transform 0.15s ease;
    }
    html[data-theme='dark'] .cart-empty__action {
      background: var(--pos-elevated);
      border-color: var(--pos-border);
    }
    .cart-empty__action:hover {
      border-color: color-mix(in srgb, var(--lux-indigo) 32%, #e2e8f0);
      box-shadow: 0 8px 22px -16px color-mix(in srgb, var(--lux-indigo) 35%, transparent);
      transform: translateY(-1px);
    }
    .cart-empty__action-ico {
      display: grid;
      place-items: center;
      flex-shrink: 0;
      width: 2.15rem;
      height: 2.15rem;
      border-radius: 5px;
    }
    .cart-empty__action-ico--scan {
      color: #0284c7;
      background: color-mix(in srgb, #0ea5e9 12%, #ffffff);
    }
    .cart-empty__action-ico--search {
      color: var(--lux-primary-deep);
      background: color-mix(in srgb, var(--lux-indigo) 10%, #ffffff);
    }
    .cart-empty__action-ico--catalog {
      color: #0891b2;
      background: color-mix(in srgb, #06b6d4 12%, #ffffff);
    }
    html[data-theme='dark'] .cart-empty__action-ico--scan {
      background: color-mix(in srgb, #0ea5e9 16%, var(--pos-elevated));
    }
    html[data-theme='dark'] .cart-empty__action-ico--search {
      background: color-mix(in srgb, var(--lux-indigo) 16%, var(--pos-elevated));
    }
    html[data-theme='dark'] .cart-empty__action-ico--catalog {
      background: color-mix(in srgb, #06b6d4 16%, var(--pos-elevated));
    }
    .cart-empty__action-text {
      display: grid;
      gap: 0.12rem;
      min-width: 0;
      flex: 1;
    }
    .cart-empty__action-text strong {
      font-size: 0.74rem;
      font-weight: 700;
      line-height: 1.2;
      color: var(--pos-text);
    }
    .cart-empty__action-text small {
      font-size: 0.62rem;
      line-height: 1.3;
      color: var(--pos-muted);
    }
    .cart-empty__action-chev {
      flex-shrink: 0;
      color: var(--pos-faint);
    }
    .price-pick {
      display: grid;
      gap: 0.4rem;
      margin: 0.5rem 0 0.65rem;
    }
    .price-pick__opt {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.65rem;
      width: 100%;
      padding: 0.55rem 0.65rem;
      border-radius: 5px;
      border: 1px solid var(--pos-border-strong);
      background: var(--pos-surface-2);
      color: var(--pos-text);
      cursor: pointer;
      text-align: left;
    }
    .price-pick__opt--on {
      border-color: color-mix(in srgb, var(--pos-accent) 42%, var(--pos-border-strong));
      background: color-mix(in srgb, var(--pos-accent-muted) 35%, var(--pos-surface-2));
    }
    .price-pick__name {
      font-size: 0.78rem;
      font-weight: 600;
    }
    .price-pick__val {
      font-size: 0.92rem;
      font-variant-numeric: tabular-nums;
    }
    .line-chip {
      min-width: 1.8rem;
      height: var(--pos-qty-size);
      border-radius: 5px;
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
    .totals {
      flex: 0 0 auto;
      margin-top: 0;
      padding: 0.8rem 0.85rem 0.9rem;
      border-top: 1px solid var(--pos-border);
      background: var(--pos-elevated);
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
      min-height: var(--lux-ds-pay-h, 4rem);
      margin-top: 0.65rem;
      padding: 0.65rem 1rem 0.65rem 1.15rem;
      border: none;
      border-radius: var(--pos-radius);
      font-size: 0.9rem;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      cursor: pointer;
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      background: linear-gradient(90deg, #00e5ff 0%, #6366f1 52%, #c026d3 100%);
      border: none;
      box-shadow: 0 8px 24px -8px rgba(99, 102, 241, 0.45);
      transition:
        filter var(--lux-ds-transition, 0.2s ease),
        transform 0.15s ease,
        box-shadow var(--lux-ds-transition, 0.2s ease);
    }
    .btn-pay__content {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 0.08rem;
      min-width: 0;
      text-transform: none;
      letter-spacing: -0.02em;
    }
    .btn-pay__label {
      font-size: 0.72rem;
      font-weight: 800;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      opacity: 0.92;
    }
    .btn-pay__amount {
      font-size: 1.22rem;
      font-weight: 850;
      font-variant-numeric: tabular-nums;
      letter-spacing: -0.03em;
      line-height: 1.1;
    }
    .btn-pay__hint {
      font-size: 0.78rem;
      font-weight: 600;
      opacity: 0.88;
      text-transform: none;
    }
    .btn-pay__arrow {
      display: grid;
      place-items: center;
      width: 2.35rem;
      height: 2.35rem;
      border-radius: 5px;
      background: rgba(255, 255, 255, 0.14);
      flex-shrink: 0;
    }
    .btn-pay:hover:not(:disabled) {
      filter: brightness(1.05) saturate(1.04);
      transform: translateY(-1px);
      box-shadow:
        0 1px 0 rgba(255, 255, 255, 0.2) inset,
        0 18px 42px -14px rgba(var(--lux-magenta-rgb), 0.38);
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
      width: min(86.4vw, 64.8rem);
      max-height: min(92vh, 52rem);
      padding: 0;
      overflow: hidden;
    }
    .pos-pay-modal {
      max-height: min(92vh, 52rem);
      display: flex;
      flex-direction: column;
      min-height: 0;
      background: var(--pos-elevated);
    }
    .pos-pay-top {
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: 0.55rem;
      padding: 0.85rem 1rem;
      border-bottom: 1px solid var(--pos-border);
      background: var(--pos-elevated);
    }
    .pos-pay-top__row {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 0.75rem;
    }
    .pos-pay-top__alert {
      width: 100%;
    }
    .pos-pay-top__main {
      display: flex;
      align-items: flex-start;
      gap: 0.65rem;
      min-width: 0;
    }
    .pos-pay-top__icon {
      flex-shrink: 0;
      width: 2.35rem;
      height: 2.35rem;
      display: grid;
      place-items: center;
      border-radius: 5px;
      border: 1px solid color-mix(in srgb, var(--pos-accent) 28%, var(--pos-border));
      background: color-mix(in srgb, var(--pos-accent-muted) 55%, var(--pos-elevated));
      color: var(--pos-accent-hover);
    }
    .pos-pay-top__title {
      margin: 0;
      font-size: 0.95rem;
      font-weight: 850;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--pos-text);
    }
    .pos-pay-top__meta {
      margin: 0.2rem 0 0;
      color: var(--pos-muted);
      font-size: 0.72rem;
      font-weight: 650;
    }
    .pos-pay-top__close {
      flex-shrink: 0;
      width: 2rem;
      height: 2rem;
      display: grid;
      place-items: center;
      border-radius: 5px;
      border: 1px solid var(--pos-border);
      background: var(--pos-surface-2);
      color: var(--pos-muted);
      cursor: pointer;
    }
    .pos-pay-hero {
      position: relative;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0.85rem 1rem 0;
      padding: 1.35rem 1rem;
      min-height: 6.5rem;
      border: 1px solid color-mix(in srgb, var(--pos-accent) 18%, var(--pos-border));
      border-radius: 5px;
      background: linear-gradient(
        95deg,
        color-mix(in srgb, var(--pos-accent-muted) 78%, var(--pos-elevated)) 0%,
        color-mix(in srgb, var(--pos-accent-muted) 42%, var(--pos-elevated)) 48%,
        var(--pos-elevated) 100%
      );
      overflow: hidden;
    }
    .pos-pay-hero__copy {
      position: relative;
      z-index: 1;
      text-align: center;
      padding: 0 6.5rem;
    }
    .pos-pay-hero__label {
      display: block;
      margin-bottom: 0.45rem;
      color: color-mix(in srgb, var(--pos-accent-hover) 72%, var(--pos-muted));
      font-size: 0.68rem;
      font-weight: 800;
      letter-spacing: 0.1em;
      text-transform: uppercase;
    }
    .pos-pay-hero__amount {
      display: block;
      font-family: var(--pos-mono);
      font-size: clamp(2.35rem, 4.5vw, 3.15rem);
      line-height: 0.95;
      font-weight: 900;
      font-variant-numeric: tabular-nums;
      color: var(--pos-accent-hover);
      letter-spacing: -0.02em;
    }
    .pos-pay-hero__art {
      position: absolute;
      right: 6.35rem;
      width: 10.25rem;
      height: calc(100% + 5.1rem);
      bottom: -25px;
      display: flex;
      align-items: flex-end;
      justify-content: center;
      pointer-events: none;
    }
    .pos-pay-hero__img {
      width: auto;
      height: 100%;
      max-width: none;
      object-fit: contain;
      object-position: bottom center;
      transform: translateY(12%);
    }
    .pos-pay-feedback {
      display: flex;
      align-items: flex-start;
      gap: 0.65rem;
      padding: 0.65rem 0.75rem;
      border-radius: 5px;
      border: 1px solid color-mix(in srgb, #f59e0b 34%, var(--pos-border));
      background: color-mix(in srgb, #fff7ed 72%, var(--pos-elevated));
      color: #9a3412;
    }
    html[data-theme='dark'] .pos-pay-feedback {
      border-color: color-mix(in srgb, #f59e0b 28%, var(--pos-border));
      background: color-mix(in srgb, #78350f 22%, var(--pos-surface-2));
      color: #fdba74;
    }
    .pos-pay-feedback__icon {
      flex-shrink: 0;
      width: 2rem;
      height: 2rem;
      display: grid;
      place-items: center;
      border-radius: 999px;
      background: color-mix(in srgb, #f59e0b 18%, var(--pos-elevated));
      color: #c2410c;
    }
    html[data-theme='dark'] .pos-pay-feedback__icon {
      background: color-mix(in srgb, #f59e0b 14%, var(--pos-surface-2));
      color: #fdba74;
    }
    .pos-pay-feedback__copy {
      flex: 1 1 auto;
      min-width: 0;
      display: grid;
      gap: 0.15rem;
    }
    .pos-pay-feedback__copy strong {
      font-size: 0.74rem;
      font-weight: 850;
      letter-spacing: 0.02em;
    }
    .pos-pay-feedback__copy p {
      margin: 0;
      font-size: 0.72rem;
      line-height: 1.45;
      color: inherit;
      opacity: 0.92;
      overflow-wrap: anywhere;
    }
    .pos-pay-feedback__dismiss {
      flex-shrink: 0;
      width: 1.75rem;
      height: 1.75rem;
      display: grid;
      place-items: center;
      border-radius: 5px;
      border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
      background: transparent;
      color: inherit;
      cursor: pointer;
      opacity: 0.8;
    }
    .pos-pay-feedback__dismiss:hover {
      opacity: 1;
      background: color-mix(in srgb, currentColor 8%, transparent);
    }
    .pos-pay-body {
      padding: 1rem;
    }
    .pos-pay-recovery {
      display: grid;
      gap: 0.5rem;
      margin: 0.75rem 1rem 0;
      padding: 0.65rem 0.75rem;
      border: 1px solid color-mix(in srgb, var(--pos-accent) 28%, transparent);
      border-radius: 5px;
      background: color-mix(in srgb, var(--pos-accent) 6%, transparent);
    }
    .pos-pay-recovery__item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
    }
    .pos-pay-recovery__item p {
      margin: 0.15rem 0 0;
      color: var(--pos-faint);
      font-size: 0.82rem;
    }
    .pos-pay-recovery--compact {
      margin-bottom: 0.35rem;
    }
    .pos-pay-recovery__hint {
      margin: 0;
      font-size: 0.76rem;
      color: var(--pos-faint);
      line-height: 1.35;
    }
    .pos-pay-layout {
      flex: 1 1 auto;
      min-height: 0;
      overflow: auto;
      display: grid;
      grid-template-columns: minmax(0, 1.55fr) minmax(15rem, 0.45fr);
      gap: 0.75rem;
      padding: 0.85rem 1rem 1rem;
      margin-top: 0.15rem;
    }
    .pos-pay-flow,
    .pos-pay-side {
      min-width: 0;
    }
    .pos-pay-step {
      margin-bottom: 0.7rem;
    }
    .pos-pay-step__title {
      margin: 0 0 0.45rem;
      color: var(--pos-faint);
      font-size: 0.64rem;
      font-weight: 850;
      letter-spacing: 0.07em;
      text-transform: uppercase;
    }
    .pos-pay-step__title--inline {
      margin-bottom: 0;
    }
    .pos-pay-methods {
      display: grid;
      grid-template-columns: repeat(7, minmax(0, 1fr));
      gap: 0.45rem;
      overflow: visible;
      padding-top: 0.2rem;
    }
    .payment-method-card {
      position: relative;
      min-height: 3.35rem;
      border: 1px solid var(--pos-border);
      border-radius: 5px;
      background: var(--pos-surface-2);
      color: var(--pos-muted);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.2rem;
      padding: 0.45rem 0.35rem 0.4rem;
      font-size: 0.66rem;
      font-weight: 800;
      cursor: pointer;
      overflow: visible;
    }
    .payment-method-card__icon {
      width: 1.55rem;
      height: 1.55rem;
      display: grid;
      place-items: center;
      border-radius: 5px;
      background: var(--pos-elevated);
      border: 1px solid var(--pos-border);
      color: var(--pos-muted);
    }
    .payment-method-card__glyph {
      font-size: 0.72rem;
      line-height: 1;
    }
    .payment-method-card__label {
      text-align: center;
      line-height: 1.15;
    }
    .payment-method-card__check {
      position: absolute;
      top: -0.42rem;
      right: -0.42rem;
      width: 1.05rem;
      height: 1.05rem;
      display: grid;
      place-items: center;
      border-radius: 999px;
      border: 2px solid var(--pos-elevated);
      background: var(--pos-accent);
      color: #fff;
      box-shadow: 0 1px 3px rgba(15, 23, 42, 0.14);
      z-index: 2;
      pointer-events: none;
    }
    .payment-method-card--on {
      border-color: color-mix(in srgb, var(--pos-accent) 45%, var(--pos-border));
      background: color-mix(in srgb, var(--pos-accent-muted) 48%, var(--pos-surface-2));
      color: var(--pos-text);
      box-shadow: 0 0 0 1px color-mix(in srgb, var(--pos-accent) 18%, transparent);
    }
    .payment-method-card--on .payment-method-card__icon {
      border-color: color-mix(in srgb, var(--pos-accent) 35%, var(--pos-border));
      color: var(--pos-accent-hover);
    }
    .payment-method-card--ready {
      border-color: var(--pos-status-ok-border);
    }
    .payment-method-card--blocked {
      opacity: 0.62;
      cursor: not-allowed;
    }
    .pos-pay-cash-row {
      display: grid;
      grid-template-columns: minmax(0, 1.4fr) minmax(11rem, 0.6fr);
      gap: 0.65rem;
      align-items: start;
    }
    .pos-pay-cash-side {
      display: flex;
      flex-direction: column;
      gap: 0.45rem;
      min-width: 0;
    }
    .pos-pay-cash-actions {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.4rem;
    }
    .pos-pay-cash-actions .btn-modal {
      width: 100%;
      min-height: 2.15rem;
      padding: 0.38rem 0.55rem;
      font-size: 0.72rem;
      white-space: nowrap;
    }
    .pos-pay-amount {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      align-items: center;
      gap: 0.55rem;
      min-height: 3.85rem;
      padding: 0.5rem 0.6rem;
      border: 1px solid var(--pos-border-strong);
      border-radius: 5px;
      background: var(--pos-bg);
    }
    .pos-pay-amount__prefix {
      flex-shrink: 0;
      width: 2.2rem;
      height: 2.2rem;
      display: grid;
      place-items: center;
      border-radius: 5px;
      background: color-mix(in srgb, var(--pos-border) 62%, var(--pos-surface-2));
      color: color-mix(in srgb, var(--pos-text) 55%, var(--pos-muted));
      font-size: 1.05rem;
      font-weight: 850;
      line-height: 1;
    }
    .pos-pay-amount__input {
      width: 100%;
      border: none;
      background: transparent;
      color: color-mix(in srgb, var(--pos-text) 92%, #000);
      font-family: var(--pos-mono);
      font-size: clamp(1.45rem, 2.4vw, 1.85rem);
      font-weight: 900;
      font-variant-numeric: tabular-nums;
      outline: none;
      letter-spacing: -0.02em;
    }
    .pos-pay-amount__steppers {
      display: flex;
      flex-direction: column;
      align-self: flex-start;
      gap: 0.3rem;
      margin-top: 0.42rem;
      padding-top: 0.05rem;
    }
    .pos-pay-amount__step {
      width: 1.7rem;
      height: 1.35rem;
      display: grid;
      place-items: center;
      border-radius: 5px;
      border: 1px solid color-mix(in srgb, var(--pos-accent) 32%, var(--pos-border));
      background: var(--pos-elevated);
      color: var(--pos-accent-hover);
      cursor: pointer;
    }
    .pos-pay-quick {
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 0;
      padding: 0.5rem 0.6rem;
      border: 1px solid var(--pos-border);
      border-radius: 5px;
      background: color-mix(in srgb, var(--pos-surface-2) 88%, var(--pos-border));
      font-size: 0.7rem;
      color: var(--pos-muted);
    }
    .pos-pay-quick__row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.45rem;
      padding: 0.18rem 0;
    }
    .pos-pay-quick__row + .pos-pay-quick__row {
      margin-top: 0.35rem;
      padding-top: 0.42rem;
      border-top: 1px solid var(--pos-border);
    }
    .pos-pay-quick__row--ok span {
      font-weight: 800;
      color: var(--pos-text);
    }
    .pos-pay-quick__row strong {
      font-family: var(--pos-mono);
      font-variant-numeric: tabular-nums;
      color: var(--pos-text);
    }
    .pos-pay-quick__row--ok strong {
      color: var(--pos-status-ok);
    }
    .pos-pay-form-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.45rem;
      margin-bottom: 0.45rem;
    }
    .pos-pay-form {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 0.45rem;
      align-items: end;
      padding: 0.55rem;
      border: 1px solid var(--pos-border);
      border-radius: 5px;
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
      border-radius: 5px;
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
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.35rem;
      padding: 1.1rem 0.8rem;
      color: var(--pos-faint);
      font-size: 0.78rem;
      text-align: center;
    }
    .pos-pay-table__empty-icon {
      color: var(--pos-border-strong);
    }
    .pos-pay-remove {
      width: 1.75rem;
      height: 1.75rem;
      border-radius: 5px;
      border: 1px solid var(--pos-border);
      background: var(--pos-elevated);
      color: #b91c1c;
      cursor: pointer;
      font-weight: 850;
    }
    .pos-pay-side {
      display: flex;
      flex-direction: column;
      gap: 0.45rem;
      padding: 0.65rem;
      border: 1px solid var(--pos-border);
      border-radius: 5px;
      background: var(--pos-surface-2);
      align-self: start;
      position: sticky;
      top: 0;
    }
    .pos-pay-side__title {
      margin: 0 0 0.15rem;
      color: var(--pos-faint);
      font-size: 0.64rem;
      font-weight: 850;
      letter-spacing: 0.07em;
      text-transform: uppercase;
    }
    .pos-pay-summary__row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.65rem;
      padding: 0.5rem 0.55rem;
      border: 1px solid var(--pos-border);
      border-radius: 5px;
      background: var(--pos-elevated);
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
      color: var(--pos-status-ok);
    }
    .pos-pay-safe {
      display: flex;
      align-items: flex-start;
      gap: 0.55rem;
      margin-top: 0.15rem;
      padding: 0.6rem 0.65rem;
      border-radius: 5px;
      border: 1px solid color-mix(in srgb, #3b82f6 24%, var(--pos-border));
      background: color-mix(in srgb, #dbeafe 55%, var(--pos-surface-2));
      color: #1d4ed8;
      font-size: 0.72rem;
    }
    html[data-theme='dark'] .pos-pay-safe {
      border-color: color-mix(in srgb, #60a5fa 28%, var(--pos-border));
      background: color-mix(in srgb, #1e3a8a 22%, var(--pos-surface-2));
      color: #93c5fd;
    }
    .pos-pay-safe__icon {
      flex-shrink: 0;
      margin-top: 0.05rem;
    }
    .pos-pay-safe__copy {
      display: grid;
      gap: 0.12rem;
    }
    .pos-pay-safe__copy strong {
      font-size: 0.74rem;
      font-weight: 850;
    }
    .pos-pay-safe__copy small {
      color: inherit;
      opacity: 0.85;
      line-height: 1.35;
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
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: 0.65rem;
      padding: 0.75rem 1rem;
      border-top: 1px solid var(--pos-border);
      background: var(--pos-elevated);
    }
    .pos-pay-footer__bar {
      display: flex;
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
    }
    .pos-pay-footer__stats {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 1.1rem 1.35rem;
      flex: 1 1 auto;
      min-width: 0;
    }
    .pos-pay-stat {
      display: flex;
      align-items: center;
      gap: 0.45rem;
      min-width: 0;
      padding: 0;
      border: none;
      border-radius: 0;
      background: transparent;
    }
    .pos-pay-stat__icon {
      flex-shrink: 0;
      width: 1.85rem;
      height: 1.85rem;
      display: grid;
      place-items: center;
      border-radius: 999px;
      color: var(--pos-accent-hover);
      background: color-mix(in srgb, var(--pos-accent-muted) 72%, var(--pos-elevated));
    }
    .pos-pay-stat--paid .pos-pay-stat__icon {
      color: var(--pos-status-ok);
      background: color-mix(in srgb, #10b981 18%, var(--pos-elevated));
    }
    .pos-pay-stat--pending .pos-pay-stat__icon {
      color: #b45309;
      background: color-mix(in srgb, #f59e0b 18%, var(--pos-elevated));
    }
    .pos-pay-stat--change .pos-pay-stat__icon {
      color: #2563eb;
      background: color-mix(in srgb, #3b82f6 16%, var(--pos-elevated));
    }
    .pos-pay-stat__copy {
      display: flex;
      flex-direction: column;
      gap: 0.05rem;
      min-width: 0;
    }
    .pos-pay-stat--total .pos-pay-stat__copy small {
      color: var(--pos-accent-hover);
    }
    .pos-pay-stat--paid .pos-pay-stat__copy small {
      color: var(--pos-status-ok);
    }
    .pos-pay-stat--pending .pos-pay-stat__copy small {
      color: #b45309;
    }
    .pos-pay-stat--change .pos-pay-stat__copy small {
      color: #2563eb;
    }
    .pos-pay-stat__copy small {
      font-size: 0.58rem;
      font-weight: 850;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .pos-pay-stat__copy strong {
      font-family: var(--pos-mono);
      font-size: 0.88rem;
      font-variant-numeric: tabular-nums;
      color: var(--pos-text);
    }
    .pos-pay-footer__actions {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      gap: 0.55rem;
      flex: 0 0 auto;
      flex-wrap: nowrap;
    }
    .pos-pay-btn {
      min-height: 2.85rem;
      border-radius: 5px;
      border: 1px solid transparent;
      display: inline-flex;
      align-items: center;
      gap: 0.55rem;
      padding: 0.45rem 0.85rem;
      cursor: pointer;
      text-align: left;
    }
    .pos-pay-btn span {
      display: grid;
      gap: 0.05rem;
    }
    .pos-pay-btn strong {
      font-size: 0.78rem;
      font-weight: 850;
      line-height: 1.15;
    }
    .pos-pay-btn small {
      font-size: 0.64rem;
      font-weight: 650;
      opacity: 0.82;
      line-height: 1.2;
    }
    .pos-pay-btn--ghost {
      border-color: var(--pos-border-strong);
      background: var(--pos-elevated);
      color: var(--pos-muted);
    }
    .pos-pay-btn--primary {
      border-color: var(--pos-accent);
      background: var(--pos-accent);
      color: #fff;
    }
    .pos-pay-btn--primary small,
    .pos-pay-btn--primary strong {
      color: inherit;
    }
    .pos-pay-btn--disabled {
      opacity: 0.55;
      cursor: not-allowed;
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
      border-radius: 5px;
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
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
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
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 0.35rem;
    }
    .cash-denoms__rows {
      display: grid;
      gap: 0.35rem;
    }
    .cash-denoms__grid--row {
      grid-template-columns: repeat(5, minmax(0, 1fr));
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
    .cash-denom--clear {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.3rem;
      color: var(--pos-accent-hover);
      font-size: 0.74rem;
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
        width: min(86.4vw, 30.6rem);
      }
      .pay-status,
      .pay-grid,
      .payment-method-strip,
      .pos-pay-top,
      .pos-pay-layout,
      .pos-pay-form,
      .pos-pay-form-grid,
      .pos-pay-cash-row,
      .pos-pay-cash-actions {
        grid-template-columns: 1fr;
      }
      .card-pay,
      .card-pay__amount,
      .card-pay__manual,
      .card-pay__channels,
      .card-pay__actions,
      .pos-pay-methods {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
      .pos-pay-footer {
        gap: 0.75rem;
      }
      .pos-pay-footer__bar {
        flex-direction: column;
        align-items: stretch;
        gap: 0.75rem;
      }
      .pos-pay-footer__stats {
        justify-content: space-between;
        gap: 0.65rem 0.85rem;
      }
      .pos-pay-footer__actions {
        align-items: stretch;
        flex-wrap: wrap;
      }
      .cash-denoms__grid,
      .cash-denoms__grid--row {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .pos-pay-layout {
        padding: 0.65rem;
      }
      .pos-pay-hero {
        min-height: 5.75rem;
        padding: 1.1rem 0.75rem;
      }
      .pos-pay-hero__copy {
        padding: 0 4.5rem;
      }
      .pos-pay-hero__art {
        right: 0.65rem;
        width: 6.25rem;
        height: calc(100% + 0.85rem);
      }
      .pos-pay-hero__img {
        transform: translateY(10%);
      }
      .pos-pay-side {
        position: static;
      }
      .pos-pay-btn {
        width: 100%;
        justify-content: center;
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
      border-radius: 5px;
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
  private readonly paymentWidgets = inject(PosPaymentWidgetRegistryService);
  readonly payPhoneWidget = inject(PayPhonePaymentWidget);
  readonly payPhoneCountryOptions = PAYPHONE_COUNTRY_OPTIONS;

  readonly invoicingEnabled = signal(false);
  readonly resolvedPuntoEmisionId = signal<string | null>(null);

  /** URL de pos-app configurada en environment (no null). */
  posApiConfigured(): boolean {
    return this.auth.apiBaseUrl.trim().length > 0;
  }

  readonly catalog = signal<DemoProduct[]>([]);
  readonly catalogLoading = signal(false);
  readonly categoryCatalog = signal<PosProductCategoryResponse[]>([]);
  readonly activeCategoryId = signal('');
  readonly activeTag = signal<string>('Todos');

  readonly categoryOptions = computed(() =>
    [...this.categoryCatalog()].sort((a, b) => a.pathLabel.localeCompare(b.pathLabel)),
  );

  readonly tagOptions = computed(() => {
    const tags = new Set(this.catalog().map((p) => p.tag));
    return ['Todos', ...Array.from(tags).sort()];
  });

  readonly priceListOptions = computed(() => this.priceLists().filter((l) => l.active));

  readonly cartStatusHints = computed((): CartStatusHint[] => {
    const hints: CartStatusHint[] = [];
    if (this.error()) {
      hints.push({ id: 'api-err', kind: 'err', label: 'Sin API', detail: this.error()! });
    }
    if (!this.desk.cajaOpen()) {
      hints.push({
        id: 'caja',
        kind: 'warn',
        label: 'Caja cerrada',
        detail: 'Debe aperturar caja para proceder con la venta.',
      });
    }
    if (this.posApiConfigured() && !this.effectivePuntoEmisionId()) {
      hints.push({
        id: 'pe',
        kind: 'warn',
        label: 'Punto de emisión',
        detail: this.puntoEmisionSetupMessage(),
      });
    }
    if (this.saleActionMessage()) {
      hints.push({ id: 'sale', kind: 'warn', label: 'Aviso', detail: this.saleActionMessage()! });
    }
    return hints;
  });

  readonly catalogPageSize = 15;
  readonly priceLists = signal<PosPriceListResponse[]>([]);
  readonly catalogQuery = signal('');
  readonly catalogPage = signal(1);
  readonly catalogView = signal<'grid' | 'list'>('grid');

  private readonly catalogSearchRef = viewChild<ElementRef<HTMLInputElement>>('catalogSearch');
  private readonly catalogCategoryRef = viewChild<ElementRef<HTMLSelectElement>>('catalogCategory');
  private readonly catalogPanelRef = viewChild<ElementRef<HTMLElement>>('catalogPanel');
  private readonly cartLinesRef = viewChild<ElementRef<HTMLElement>>('cartLines');

  private tabSeq = 1;
  readonly saleCustomerTipoLabel = saleCustomerTipoLabel;
  readonly tabs = signal<SaleTab[]>([{ id: 't-1', label: 'Venta 1', cart: [], customer: SALE_CONSUMIDOR_FINAL }]);
  readonly activeTabId = signal('t-1');
  readonly custQuery = signal('');
  readonly custSearchLoading = signal(false);
  readonly custPickerQuery = signal('');
  readonly custPickerRows = signal<PosCustomerResponse[]>([]);
  readonly custPickerGridNonce = signal(0);
  readonly custPickerLoading = signal(false);
  readonly custPickerGridRows = computed(() =>
    this.custPickerRows().map(
      (c) =>
        ({
          ...c,
          tipoLabel: saleCustomerTipoLabel(c.tipoIdentificacion),
          displayName: c.nombreComercial?.trim() || c.razonSocial,
        }) as Record<string, unknown>,
    ),
  );
  readonly custPickerColumns: ColumnDefinition[] = [
    {
      title: '',
      field: 'displayName',
      width: 128,
      headerSort: false,
      hozAlign: 'left',
      formatter: (cell) => {
        const initials = customerDisplayInitials(String(tabulatorCellValue(cell) ?? ''));
        return `<div class="cust-picker-row__lead">
          <button type="button" class="cust-picker-grid__use" data-ts-action="use">Usar</button>
          <span class="cust-picker-row__avatar" aria-hidden="true">${escapeHtml(initials)}</span>
        </div>`;
      },
    },
    {
      title: 'Nombre / Razón social',
      field: 'displayName',
      minWidth: 220,
      formatter: (cell) =>
        tabulatorTextareaCell(String(tabulatorCellValue(cell) ?? '').toUpperCase()),
    },
    { title: 'Tipo', field: 'tipoLabel', width: 110 },
    {
      title: 'Identificación',
      field: 'identificacion',
      width: 140,
      formatter: (cell) =>
        `<span class="cust-picker-grid__id">${escapeHtml(String(tabulatorCellValue(cell) ?? ''))}</span>`,
    },
    {
      title: 'Correo',
      field: 'email',
      minWidth: 160,
      formatter: (cell) => tabulatorTextareaCell(tabulatorCellValue(cell) ?? '—'),
    },
    {
      title: '',
      field: '_nav',
      width: 40,
      headerSort: false,
      hozAlign: 'right',
      formatter: () =>
        `<span class="cust-picker-row__chev" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`,
    },
  ];
  readonly modal = signal<ModalState | null>(null);
  readonly newCustFormErrors = signal<PosCustomerFormErrors>({});
  readonly newCustCatastroLoading = signal(false);
  readonly newCustSaving = signal(false);
  newCustDraft: PosCustomerFormState = emptyCustomerForm('05');
  readonly calcBuffer = signal('0');
  readonly calcKeys = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '.', '0', '⌫'] as const;
  readonly tenderDenominations = [1, 5, 10, 20, 50, 100] as const;
  readonly tenderDenominationsRow1 = [1, 5, 10, 20] as const;
  readonly tenderDenominationsRow2 = [50, 100] as const;
  readonly paymentMethods = computed(() => this.paymentWidgets.availablePaymentMethods());
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
  readonly payPhonePhoneNumber = signal('');
  readonly payPhoneCountryCode = signal('593');
  readonly recoverablePayPhoneIntents = signal<PayPhoneIntentResponse[]>([]);
  readonly primaryRecoverablePayPhoneIntent = computed(() => {
    const items = this.recoverablePayPhoneIntents();
    return items.length ? items[0] : null;
  });
  readonly recoverablePayPhoneOlderCount = computed(() => Math.max(0, this.recoverablePayPhoneIntents().length - 1));
  readonly payPhoneRecoveryMessage = signal('');
  private payPhonePollTimer: ReturnType<typeof setInterval> | null = null;
  private payPhonePollStartedAt = 0;
  readonly paymentLines = signal<PosPaymentLineDraft[]>([]);
  readonly paymentCollection = signal<PosPaymentCollectionResponse | null>(null);
  readonly cardChannel = signal<CardPaymentChannel>('terminal');
  readonly cardStatus = signal<CardPaymentStatus>('idle');
  readonly cardAuthCode = signal('');
  readonly cardReference = signal('');
  readonly cardLast4 = signal('');
  readonly cardOperationMessage = signal('');

  readonly checkoutError = signal<string | null>(null);
  readonly checkoutErrorTitle = computed(() => {
    const message = this.checkoutError();
    if (!message) {
      return '';
    }
    const lower = message.toLowerCase();
    if (lower.includes('payphone')) {
      return 'Error en cobro PayPhone';
    }
    const serverHints = ['sesión', 'servidor', 'autorizada', 'pos-app', 'conexión', 'código 4', 'código 5'];
    const isServer = serverHints.some((hint) => lower.includes(hint));
    return isServer ? 'No se pudo confirmar el cobro' : 'Revisa el cobro';
  });
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
    const catId = this.activeCategoryId();
    const tag = this.activeTag();
    const q = this.catalogQuery().trim().toLowerCase();
    let items = this.catalog();
    if (catId) {
      const allowed = this.categoryFilterSet(catId);
      items = items.filter((p) => p.categoryId && allowed.has(p.categoryId));
    }
    if (tag !== 'Todos') {
      items = items.filter((p) => p.tag === tag);
    }
    if (!q) {
      return items;
    }
    return items.filter((p) => {
      const bc = (p.barcode ?? p.sku).toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        bc.includes(q) ||
        (p.categoryName ?? '').toLowerCase().includes(q)
      );
    });
  });

  readonly catalogTotalPages = computed(() =>
    Math.max(1, Math.ceil(this.filteredCatalog().length / this.catalogPageSize)),
  );

  readonly catalogPageClamped = computed(() =>
    Math.min(Math.max(1, this.catalogPage()), this.catalogTotalPages()),
  );

  readonly catalogPagerSlots = computed((): (number | 'ellipsis')[] => {
    const total = this.catalogTotalPages();
    const current = this.catalogPageClamped();
    if (total <= 7) {
      return Array.from({ length: total }, (_, i) => i + 1);
    }
    const pages = new Set<number>([1, total, current - 1, current, current + 1]);
    const sorted = Array.from(pages).filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
    const slots: (number | 'ellipsis')[] = [];
    for (let i = 0; i < sorted.length; i++) {
      if (i > 0 && sorted[i]! - sorted[i - 1]! > 1) {
        slots.push('ellipsis');
      }
      slots.push(sorted[i]!);
    }
    return slots;
  });

  readonly pagedProducts = computed(() => {
    const list = this.filteredCatalog();
    const page = this.catalogPageClamped();
    const start = (page - 1) * this.catalogPageSize;
    return list.slice(start, start + this.catalogPageSize);
  });

  readonly catalogHasActiveFilters = computed(
    () => !!this.activeCategoryId() || this.activeTag() !== 'Todos',
  );

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
  readonly externalPaymentHint = computed(() => {
    const widget = this.paymentWidgets.widgetFor(this.selectedPaymentMethod());
    return widget?.availabilityHint() ?? '';
  });
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
    const pending = this.saldoPendiente();
    if (pending <= 0) {
      return [];
    }
    const fixed = new Set<number>(this.tenderDenominations.map((amount) => Number(amount)));
    const candidates = [
      Math.ceil(pending * 2) / 2,
      Math.ceil(pending),
      Math.ceil(pending / 2) * 2,
      Math.ceil(pending / 5) * 5,
    ]
      .map((amount) => Math.round(amount * 100) / 100)
      .filter((amount) => amount > pending && !fixed.has(amount));
    return Array.from(new Set(candidates)).slice(0, 2);
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
      this.activeCategoryId();
      this.activeTag();
      this.catalogQuery();
      untracked(() => this.catalogPage.set(1));
    });

    effect(() => {
      if (this.prefs.allowManualPriceListSelection()) {
        return;
      }
      const cust = this.activeCustomer();
      const listId = cust?.priceListId;
      if (!listId) {
        return;
      }
      untracked(() => {
        this.patchActiveTab((t) => this.repriceAllLinesToList(t, listId));
      });
    });

    effect(() => {
      const tabs = this.tabs();
      const activeTabId = this.activeTabId();
      untracked(() => this.persistPendingSaleTabs(tabs, activeTabId));
    });

    afterNextRender(() => {
      this.focusCatalogSearch();
      void this.offline.refreshPendingCount();
      this.handlePayphoneReturnFromCallback();
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
    void this.runtimeConfig.ensureLoaded().then((cfg) => {
      this.invoicingEnabled.set(cfg.invoicingEnabled);
      this.loadPuntoEmision();
    });
  }

  private loadPuntoEmision(): void {
    if (!this.posApiConfigured()) {
      this.resolvedPuntoEmisionId.set(null);
      return;
    }
    const source$ = this.runtimeConfig.requiresEfacturaPuntoEmision()
      ? this.backend.getPuntosEmision()
      : this.backend.getLocalPuntosEmision();
    source$.subscribe({
      next: (list) => {
        const stored = this.prefs.puntoEmisionId().trim();
        const match = list.find((p) => p.id === stored);
        const id = match?.id ?? list[0]?.id ?? null;
        if (id && !stored) {
          this.prefs.setPuntoEmisionId(id);
        }
        this.resolvedPuntoEmisionId.set(id);
      },
      error: () => this.resolvedPuntoEmisionId.set(this.prefs.puntoEmisionId().trim() || null),
    });
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

  productImageUrl(p: DemoProduct): string {
    return resolveProductMediaUrl(p.imageUrl, this.auth.apiBaseUrl);
  }

  onProductImageError(ev: Event): void {
    const img = ev.target as HTMLImageElement;
    img.src = resolveProductMediaUrl(null, this.auth.apiBaseUrl);
  }

  onCategoryFilter(ev: Event): void {
    this.activeCategoryId.set((ev.target as HTMLSelectElement).value);
    this.catalogPage.set(1);
  }

  setCatalogTag(tag: string): void {
    this.activeTag.set(tag);
    this.catalogPage.set(1);
  }

  private categoryFilterSet(rootId: string): Set<string> {
    const cats = this.categoryCatalog();
    const children = new Map<string, string[]>();
    for (const c of cats) {
      if (c.parentId) {
        const list = children.get(c.parentId) ?? [];
        list.push(c.id);
        children.set(c.parentId, list);
      }
    }
    const out = new Set<string>([rootId]);
    const stack = [rootId];
    while (stack.length) {
      const id = stack.pop()!;
      for (const ch of children.get(id) ?? []) {
        if (!out.has(ch)) {
          out.add(ch);
          stack.push(ch);
        }
      }
    }
    return out;
  }

  private loadCatalog(): void {
    if (!this.posApiConfigured()) {
      return;
    }
    this.catalogLoading.set(true);
    forkJoin({
      products: this.backend.getProducts(),
      categories: this.backend.getProductCategories(),
      priceLists: this.backend.getPriceLists(),
      priceMatrix: this.backend.getProductPriceMatrix(),
    }).subscribe({
      next: ({ products, categories, priceLists, priceMatrix }) => {
        this.priceLists.set(priceLists.filter((l) => l.active));
        this.categoryCatalog.set(categories.filter((c) => c.active));
        const matrixByProduct = this.buildPriceMatrix(priceMatrix);
        const primaryId = this.primaryPriceListIdFromLists(priceLists);
        this.catalog.set(
          products
            .filter((p) => p.active)
            .map((p) => {
              const listPrices: Record<string, number> = { ...(matrixByProduct.get(p.id) ?? {}) };
              const primaryPrice = Number(p.price);
              if (primaryId) {
                listPrices[primaryId] = primaryPrice;
              }
              return {
                id: p.id,
                name: p.name,
                sku: p.sku,
                barcode: p.barcode ?? undefined,
                price: primaryPrice,
                ivaPercent: Number(p.ivaPercent ?? 15),
                ivaTaxCode: p.ivaTaxCode ?? undefined,
                listPrices,
                tag: p.tag || 'Retail',
                imageUrl: p.imageUrl ?? undefined,
                categoryId: p.categoryId ?? null,
                categoryName: p.categoryName ?? null,
              };
            }),
        );
        this.catalogLoading.set(false);
      },
      error: () => {
        this.catalogLoading.set(false);
      },
    });
  }

  private buildPriceMatrix(rows: PosProductPriceMatrixEntry[]): Map<string, Record<string, number>> {
    const out = new Map<string, Record<string, number>>();
    for (const row of rows) {
      let map = out.get(row.productId);
      if (!map) {
        map = {};
        out.set(row.productId, map);
      }
      map[row.priceListId] = Number(row.price);
    }
    return out;
  }

  private primaryPriceListIdFromLists(lists: PosPriceListResponse[]): string {
    return lists.find((l) => l.primary)?.id ?? lists[0]?.id ?? '';
  }

  primaryPriceListId(): string {
    return this.primaryPriceListIdFromLists(this.priceLists());
  }

  defaultPriceListId(customer?: SaleCustomer | null): string {
    const c = customer ?? this.activeCustomer();
    if (c?.priceListId) {
      return c.priceListId;
    }
    return this.primaryPriceListId();
  }

  canChangeLinePrice(): boolean {
    if (!this.prefs.allowManualPriceListSelection()) {
      return false;
    }
    return this.priceListOptions().length > 1;
  }

  catalogDisplayPrice(p: DemoProduct): number {
    return this.resolvePrice(p, this.defaultPriceListId());
  }

  resolvePrice(p: DemoProduct, listId: string): number {
    const fromList = p.listPrices[listId];
    if (fromList != null && fromList > 0) {
      return fromList;
    }
    const primary = this.primaryPriceListId();
    if (primary && p.listPrices[primary] != null && p.listPrices[primary]! > 0) {
      return p.listPrices[primary]!;
    }
    return p.price;
  }

  linePriceListName(listId: string): string {
    return this.priceListOptions().find((l) => l.id === listId)?.name ?? 'Lista';
  }

  linePriceListLabel(line: CartLine): string | null {
    const name = this.linePriceListName(line.priceListId);
    if (!name || this.priceListOptions().length <= 1) {
      return null;
    }
    return name;
  }

  linePriceOptions(product: DemoProduct): LinePriceOption[] {
    const catalogProduct = this.catalog().find((p) => p.id === product.id) ?? product;
    return this.priceListOptions()
      .map((pl) => ({
        listId: pl.id,
        listName: pl.name,
        price: this.resolvePrice(catalogProduct, pl.id),
        primary: pl.primary,
      }))
      .filter((opt) => opt.price > 0);
  }

  openLinePrice(line: CartLine): void {
    if (!this.requireOpenCaja() || !this.canChangeLinePrice()) {
      return;
    }
    this.modal.set({ kind: 'linePrice', lineId: line.lineId });
  }

  applyLinePrice(lineId: string, listId: string): void {
    if (!this.requireOpenCaja() || !this.canChangeLinePrice()) {
      return;
    }
    this.patchActiveTab((t) => ({
      ...t,
      cart: t.cart.map((row) => {
        if (row.lineId !== lineId) {
          return row;
        }
        const catalogProduct = this.catalog().find((p) => p.id === row.product.id) ?? row.product;
        const unit = this.resolvePrice(catalogProduct, listId);
        const gross = row.qty * unit;
        return {
          ...row,
          priceListId: listId,
          product: { ...row.product, listPrices: catalogProduct.listPrices, price: unit },
          discountAmount: Math.min(row.discountAmount ?? 0, gross),
        };
      }),
    }));
    this.closeModal();
  }

  private repriceAllLinesToList(tab: SaleTab, listId: string): SaleTab {
    const cart = tab.cart.map((row) => {
      const catalogProduct = this.catalog().find((p) => p.id === row.product.id) ?? row.product;
      const unit = this.resolvePrice(catalogProduct, listId);
      const gross = row.qty * unit;
      return {
        ...row,
        priceListId: listId,
        product: { ...row.product, listPrices: catalogProduct.listPrices, price: unit },
        discountAmount: Math.min(row.discountAmount ?? 0, gross),
      };
    });
    const unchanged =
      tab.cart.length === cart.length &&
      tab.cart.every(
        (row, i) => row.priceListId === cart[i]!.priceListId && row.product.price === cart[i]!.product.price,
      );
    return unchanged ? tab : { ...tab, cart };
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
    this.custQuery.set((ev.target as HTMLInputElement).value);
  }

  onCustPickerQueryInput(ev: Event): void {
    this.custPickerQuery.set((ev.target as HTMLInputElement).value);
  }

  focusCatalogSearch(): void {
    queueMicrotask(() => {
      const el = this.catalogSearchRef()?.nativeElement;
      if (el) {
        el.focus({ preventScroll: true });
      }
    });
  }

  focusCatalogScan(): void {
    queueMicrotask(() => {
      const el = this.catalogSearchRef()?.nativeElement;
      if (el) {
        el.focus({ preventScroll: true });
        el.select();
      }
    });
  }

  focusCatalogPanel(): void {
    queueMicrotask(() => {
      this.catalogPanelRef()?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      this.focusCatalogScan();
    });
  }

  private scrollCartToLine(lineId: string): void {
    queueMicrotask(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const container = this.cartLinesRef()?.nativeElement;
          if (!container) {
            return;
          }
          const lineEl = container.querySelector<HTMLElement>(`[data-line-id="${lineId}"]`);
          if (!lineEl) {
            container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
            return;
          }
          const cards = container.querySelectorAll<HTMLElement>('.line-card');
          const isLast = cards.length > 0 && cards[cards.length - 1] === lineEl;
          lineEl.scrollIntoView({
            behavior: 'smooth',
            block: isLast ? 'end' : 'nearest',
          });
        });
      });
    });
  }

  customerInitials(name: string): string {
    return customerDisplayInitials(name);
  }

  onCatalogQuery(ev: Event): void {
    this.catalogQuery.set((ev.target as HTMLInputElement).value);
    this.catalogPage.set(1);
  }

  clearCatalogSearch(): void {
    this.catalogQuery.set('');
    this.catalogPage.set(1);
    this.focusCatalogSearch();
  }

  clearCatalogFilters(): void {
    this.catalogQuery.set('');
    this.activeCategoryId.set('');
    this.activeTag.set('Todos');
    this.catalogPage.set(1);
    this.focusCatalogSearch();
  }

  focusCatalogCategories(): void {
    queueMicrotask(() => {
      const el = this.catalogCategoryRef()?.nativeElement;
      if (el) {
        el.focus({ preventScroll: true });
        el.click();
      }
    });
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

  goCatalogPage(page: number): void {
    const max = this.catalogTotalPages();
    this.catalogPage.set(Math.min(Math.max(1, page), max));
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
      const primaryId = this.primaryPriceListId();
      this.tabs.set(
        tabs.map((tab) => ({
          ...tab,
          cart: tab.cart.map((row) => ({
            ...row,
            priceListId: row.priceListId || primaryId,
            product: {
              ...row.product,
              listPrices: row.product.listPrices ?? {},
            },
          })),
        })),
      );
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
      return this.puntoEmisionSetupMessage();
    }
    if (this.externalPaymentPending()) {
      return 'Hay una transaccion externa pendiente por confirmar.';
    }
    if (this.totalPagado() > this.total() + 0.0001) {
      return 'El total pagado supera el valor del ticket. Revise las líneas de pago.';
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
    this.paymentWidgets.loadAllAvailability();
    this.loadRecoverablePayPhoneIntents();
    this.selectPaymentMethod('cash');
    this.fillDraftPending();
    this.modal.set({ kind: 'cobro' });
    const puntoMsg = this.missingPuntoEmisionMessage();
    if (puntoMsg) {
      this.checkoutError.set(puntoMsg);
    }
  }

  selectPaymentMethod(method: PosPaymentMethodCode): void {
    if (this.hasPaymentFor(method)) {
      this.checkoutError.set(
        `Ya registró un pago con ${this.paymentMethodLabel(method)}. Elimínelo para volver a usar esta forma.`,
      );
      return;
    }
    if (this.selectedPaymentMethod() === 'payphone') {
      this.stopPayPhonePolling();
      this.payPhoneWidget.resetSession();
    }
    this.selectedPaymentMethod.set(method);
    this.draftReference.set(method === 'cash' ? 'Efectivo' : method === 'payphone' ? 'Pago POS PayPhone' : '');
    this.draftAuthCode.set('');
    this.draftProviderTransactionId.set('');
    this.draftExternalStatus.set('idle');
    if (method === 'payphone') {
      this.payPhoneWidget.resetSession();
      this.payPhonePhoneNumber.set(this.defaultPayPhonePhoneNumber());
      this.payPhoneCountryCode.set(this.defaultPayPhoneCountryCode());
    }
    this.fillDraftPending();
  }

  onDraftAmount(ev: Event): void {
    this.draftAmount.set((ev.target as HTMLInputElement).value);
    if (this.selectedPaymentMethod() === 'cash' && this.parseUsd(this.draftReceived()) < this.parseUsd(this.draftAmount())) {
      this.draftReceived.set((ev.target as HTMLInputElement).value);
    }
  }

  onDraftReceived(ev: Event): void {
    const raw = (ev.target as HTMLInputElement).value;
    this.draftReceived.set(raw);
    if (this.selectedPaymentMethod() === 'cash') {
      this.syncCashDraftAmountFromReceived();
      if (this.addPaymentLineError() === null) {
        this.checkoutError.set(null);
      }
    }
  }

  /** En efectivo, el monto a aplicar al ticket puede ser parcial (split payment). */
  private syncCashDraftAmountFromReceived(): void {
    const received = this.parseUsd(this.draftReceived());
    const pending = this.payableBalance();
    if (received <= 0 || pending <= 0) {
      this.draftAmount.set('0');
      return;
    }
    const amount = received < pending ? received : pending;
    this.draftAmount.set(this.formatUsd(this.round2(amount)));
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

  private payableBalance(): number {
    return this.saldoPendiente();
  }

  fillDraftPending(): void {
    const amount = this.formatUsd(this.payableBalance());
    this.draftAmount.set(amount);
    this.draftReceived.set(amount);
  }

  prepareExternalPayment(): void {
    const method = this.selectedPaymentMethod();
    const manualWidget = this.paymentWidgets.manualWidgetFor(method);
    if (manualWidget) {
      const session = manualWidget.initiateManualCollection(
        this.draftReference().trim() || manualWidget.methodOption.label,
      );
      this.draftExternalStatus.set(session.externalStatus);
      this.draftProviderTransactionId.set(session.providerTransactionId ?? '');
      if (!this.draftReference().trim()) {
        this.draftReference.set(session.message?.trim() || manualWidget.methodOption.label);
      }
    } else {
      this.draftExternalStatus.set('confirmed');
      if (!this.draftProviderTransactionId().trim()) {
        this.draftProviderTransactionId.set(`POS-${Date.now()}`);
      }
    }
    this.checkoutError.set(null);
  }

  onPayPhonePhoneNumber(ev: Event): void {
    this.payPhonePhoneNumber.set((ev.target as HTMLInputElement).value.trim());
  }

  onPayPhoneCountryCode(ev: Event): void {
    this.payPhoneCountryCode.set((ev.target as HTMLSelectElement).value.trim());
  }

  canStartPayPhoneCollection(): boolean {
    if (!this.payPhoneWidget.isAvailable() || this.payPhoneWidget.busy()) {
      return false;
    }
    if (this.hasPaymentFor('payphone')) {
      return false;
    }
    const amount = this.round2(this.parseUsd(this.draftAmount()));
    const pending = this.payableBalance();
    if (amount <= 0 || amount > pending + 0.0001) {
      return false;
    }
    return !!this.payPhonePhoneNumber().trim() && !!this.payPhoneCountryCode().trim() && !!this.draftReference().trim();
  }

  startPayPhoneCollection(): void {
    if (!this.canStartPayPhoneCollection()) {
      this.checkoutError.set('Complete telefono, codigo de pais y monto valido para PayPhone.');
      return;
    }
    this.checkoutError.set(null);
    const amount = this.round2(Math.min(this.parseUsd(this.draftAmount()), this.payableBalance()));
    const phone = this.payPhonePhoneNumber().trim();
    this.persistCustomerPhoneIfChanged(phone);
    this.payPhoneWidget
      .startCollection(
        {
          paymentUsd: amount,
          subtotalUsd: this.subtotal(),
          taxUsd: this.iva(),
          ticketTotalUsd: this.total(),
        },
        {
          phoneNumber: this.payPhonePhoneNumber(),
          countryCode: this.payPhoneCountryCode(),
          reference: this.draftReference().trim() || 'Pago POS PayPhone',
        },
      )
      .subscribe({
        next: (session) => this.handlePayPhoneSession(session, amount),
        error: (err: unknown) => this.checkoutError.set(this.payPhoneErrorMessage(err)),
      });
  }

  refreshPayPhoneStatus(): void {
    const session = this.payPhoneWidget.session();
    if (!session || this.payPhoneWidget.busy()) {
      return;
    }
    const amount = this.round2(Math.min(this.parseUsd(this.draftAmount()), this.payableBalance()));
    this.payPhoneWidget.refreshIntent(session.clientTransactionId).subscribe({
      next: (next) => this.handlePayPhoneSession(next, amount),
      error: (err: unknown) => this.checkoutError.set(this.payPhoneErrorMessage(err)),
    });
  }

  private handlePayPhoneSession(session: PaymentCollectionSession, amountUsd: number): void {
    this.persistPayPhoneCheckoutIntent(session.clientTransactionId, amountUsd);
    if (session.externalStatus === 'confirmed') {
      this.stopPayPhonePolling();
      this.addPayPhonePaymentLine(session, amountUsd);
      return;
    }
    if (session.externalStatus === 'rejected') {
      this.stopPayPhonePolling();
      this.checkoutError.set(session.message ?? 'PayPhone rechazo el cobro.');
      return;
    }
    this.startPayPhonePolling(amountUsd, session.clientTransactionId);
  }

  private addPayPhonePaymentLine(session: PaymentCollectionSession, amountUsd: number): void {
    if (this.hasPaymentFor('payphone')) {
      return;
    }
    const line = this.payPhoneWidget.toPaymentLineDraft(session, amountUsd);
    this.paymentLines.update((lines) => [...lines, line]);
    this.paymentCollection.set(null);
    this.checkoutError.set(null);
    this.clearPayPhoneCheckoutIntentStorage();
    this.backend.consumePayPhoneIntent(session.clientTransactionId).subscribe({
      error: () => {
        /* consumo best-effort */
      },
    });
    this.payPhoneWidget.resetSession();
    const nextMethod = this.paymentMethods().find((item) => !this.hasPaymentFor(item.code));
    if (nextMethod && this.payableBalance() > 0) {
      this.selectPaymentMethod(nextMethod.code);
    }
    this.fillDraftPending();
  }

  private startPayPhonePolling(amountUsd: number, clientTransactionId: string): void {
    this.stopPayPhonePolling();
    this.payPhonePollStartedAt = Date.now();
    this.payPhonePollTimer = setInterval(() => {
      if (Date.now() - this.payPhonePollStartedAt > 300_000) {
        this.stopPayPhonePolling();
        this.checkoutError.set('Tiempo de espera PayPhone agotado. Puede recuperar el pago al reabrir cobro.');
        return;
      }
      if (this.payPhoneWidget.busy()) {
        return;
      }
      this.payPhoneWidget.refreshIntent(clientTransactionId).subscribe({
        next: (next) => this.handlePayPhoneSession(next, amountUsd),
        error: () => {
          /* polling tolerante */
        },
      });
    }, 4000);
  }

  loadRecoverablePayPhoneIntents(): void {
    if (!this.posApiConfigured()) {
      this.recoverablePayPhoneIntents.set([]);
      return;
    }
    this.backend.getRecoverablePayPhoneIntents().subscribe({
      next: (response) => {
        const items = (response.items ?? []).filter((item) => item.intentContext === 'CHECKOUT' && !item.recovered);
        this.recoverablePayPhoneIntents.set(items);
        const stored = this.readPayPhoneCheckoutIntentStorage();
        if (stored && !items.some((item) => item.clientTransactionId === stored.clientTransactionId)) {
          this.backend.getPayPhoneIntent(stored.clientTransactionId, true).subscribe({
            next: (intent) => {
              if (!intent.recovered && intent.intentContext === 'CHECKOUT') {
                this.recoverablePayPhoneIntents.update((current) => [intent, ...current]);
              }
            },
          });
        }
      },
      error: () => this.recoverablePayPhoneIntents.set([]),
    });
  }

  applyRecoverablePayPhoneIntent(intent: PayPhoneIntentResponse): void {
    if (intent.status !== 'CONFIRMED' || this.hasPaymentFor('payphone')) {
      return;
    }
    const amountUsd = this.round2(intent.amountUsd);
    if (amountUsd > this.payableBalance() + 0.0001) {
      this.checkoutError.set('El monto recuperado supera el saldo pendiente del ticket.');
      return;
    }
    const session = this.payPhoneWidget.sessionFromIntent(intent);
    this.addPayPhonePaymentLine(session, amountUsd);
    this.recoverablePayPhoneIntents.update((items) =>
      items.filter((item) => item.clientTransactionId !== intent.clientTransactionId),
    );
    this.payPhoneRecoveryMessage.set('Pago PayPhone recuperado y aplicado al ticket.');
  }

  resumeRecoverablePayPhoneIntent(intent: PayPhoneIntentResponse): void {
    this.selectPaymentMethod('payphone');
    const amountUsd = this.round2(intent.amountUsd);
    this.draftAmount.set(this.formatUsd(amountUsd));
    if (intent.phoneNumber) {
      this.payPhonePhoneNumber.set(intent.phoneNumber);
    }
    const session = this.payPhoneWidget.sessionFromIntent(intent);
    this.payPhoneWidget.session.set(session);
    this.payPhoneWidget.statusMessage.set('Reanudando seguimiento del cobro PayPhone...');
    this.handlePayPhoneSession(session, amountUsd);
  }

  private handlePayphoneReturnFromCallback(): void {
    const params = new URL(window.location.href).searchParams;
    const clientTransactionId = params.get('payphoneIntent')?.trim();
    if (!clientTransactionId) {
      return;
    }
    const status = params.get('payphoneStatus')?.trim() ?? 'pending';
    this.payPhoneRecoveryMessage.set(
      status === 'confirmed'
        ? 'PayPhone confirmo el pago. Abra cobro para aplicarlo al ticket.'
        : 'PayPhone reporto un cobro pendiente. Abra cobro para reanudar el seguimiento.',
    );
    this.persistPayPhoneCheckoutIntent(clientTransactionId, 0);
    window.history.replaceState({}, '', window.location.pathname);
    if (this.lineCount() > 0 && this.desk.cajaOpen()) {
      this.openCobro();
    }
  }

  private persistPayPhoneCheckoutIntent(clientTransactionId: string, amountUsd: number): void {
    try {
      sessionStorage.setItem(
        POS_PAYPHONE_CHECKOUT_INTENT_KEY,
        JSON.stringify({
          clientTransactionId,
          amountUsd,
          tabId: this.activeTabId(),
          savedAt: new Date().toISOString(),
        }),
      );
    } catch {
      /* ignore */
    }
  }

  private readPayPhoneCheckoutIntentStorage(): { clientTransactionId: string; amountUsd: number } | null {
    try {
      const raw = sessionStorage.getItem(POS_PAYPHONE_CHECKOUT_INTENT_KEY);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw) as { clientTransactionId?: string; amountUsd?: number; tabId?: string };
      if (!parsed.clientTransactionId?.trim() || parsed.tabId !== this.activeTabId()) {
        return null;
      }
      return {
        clientTransactionId: parsed.clientTransactionId.trim(),
        amountUsd: this.round2(Number(parsed.amountUsd ?? 0)),
      };
    } catch {
      return null;
    }
  }

  private clearPayPhoneCheckoutIntentStorage(): void {
    try {
      sessionStorage.removeItem(POS_PAYPHONE_CHECKOUT_INTENT_KEY);
    } catch {
      /* ignore */
    }
    this.recoverablePayPhoneIntents.set([]);
  }

  private stopPayPhonePolling(): void {
    if (this.payPhonePollTimer) {
      clearInterval(this.payPhonePollTimer);
      this.payPhonePollTimer = null;
    }
  }

  private defaultPayPhonePhoneNumber(): string {
    return normalizePayPhoneLocalPhone(this.activeCustomer()?.phone);
  }

  private defaultPayPhoneCountryCode(): string {
    return this.payPhoneWidget.defaultCountryCodeForCheckout();
  }

  private persistCustomerPhoneIfChanged(phone: string): void {
    const customer = this.activeCustomer();
    if (!customer?.id || customer.isConsumidorFinal) {
      return;
    }
    const normalized = phone.trim();
    if (!normalized || normalized === (customer.phone?.trim() ?? '')) {
      return;
    }
    const body: PosCustomerRequest = {
      tipoIdentificacion: customer.tipoIdentificacion,
      identificacion: customer.doc,
      razonSocial: customer.razonSocial ?? customer.name,
      nombreComercial: customer.nombreComercial ?? null,
      direccion: customer.direccion ?? null,
      email: customer.email ?? null,
      phone: normalized,
      priceListId: customer.priceListId ?? null,
      active: customer.active ?? true,
    };
    this.backend.putCustomer(customer.id, body).subscribe({
      next: (res) => this.applyCustomer(customerResponseToSale(res)),
      error: () => {
        /* no bloquea el cobro si falla la actualización del teléfono */
      },
    });
  }

  private payPhoneErrorMessage(err: unknown): string {
    return formatPayPhoneApiError(err);
  }

  clearDraftCash(): void {
    this.draftAmount.set('0');
    this.draftReceived.set('0');
    this.checkoutError.set(null);
  }

  setDraftCashExact(): void {
    const amount = this.formatUsd(this.payableBalance());
    this.draftAmount.set(amount);
    this.draftReceived.set(amount);
    this.checkoutError.set(null);
  }

  setDraftCashTender(amount: number): void {
    const pending = this.round2(this.payableBalance());
    const received = this.round2(Math.max(0, amount));
    const applied = pending <= 0 ? 0 : received < pending ? received : pending;
    this.draftReceived.set(this.formatUsd(received));
    this.draftAmount.set(this.formatUsd(applied));
    this.checkoutError.set(null);
  }

  bumpDraftReceived(delta: number): void {
    const received = Math.max(0, this.round2(this.parseUsd(this.draftReceived()) + delta));
    this.setDraftCashTender(received);
  }

  canAddPaymentLine(): boolean {
    return this.addPaymentLineError() === null;
  }

  private addPaymentLineError(): string | null {
    const method = this.selectedPaymentMethod();
    const pending = this.payableBalance();
    const amount = this.round2(this.parseUsd(this.draftAmount()));
    const received = method === 'cash' ? this.round2(this.parseUsd(this.draftReceived())) : amount;
    if (pending <= 0) {
      return 'El ticket ya está cubierto. No puede agregar más pagos.';
    }
    if (this.hasPaymentFor(method)) {
      return `Ya registró un pago con ${this.paymentMethodLabel(method)}. Elimínelo o use otra forma de pago.`;
    }
    if (amount <= 0) {
      return 'Ingrese un monto mayor a cero para agregar el pago.';
    }
    if (method === 'cash' && received + 0.0001 < amount) {
      return 'El monto recibido debe ser mayor o igual al monto a aplicar.';
    }
    if (amount > pending + 0.0001) {
      return `El monto no puede superar el saldo pendiente (${this.formatUsd(pending)}).`;
    }
    if (method === 'card' && !this.draftAuthCode().trim()) {
      return 'Ingrese el codigo de autorizacion de la tarjeta.';
    }
    if (['stripe', 'kushki'].includes(method) && this.draftExternalStatus() !== 'confirmed') {
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
    const pending = this.payableBalance();
    const total = this.round2(Math.min(this.parseUsd(this.draftAmount()), pending));
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
      status: ['stripe', 'kushki'].includes(method.code) ? this.draftExternalStatus() : 'confirmed',
    };
    this.paymentLines.update((lines) => [...lines, line]);
    this.paymentCollection.set(null);
    this.checkoutError.set(null);
    const nextMethod = this.paymentMethods().find((item) => !this.hasPaymentFor(item.code));
    if (nextMethod && this.payableBalance() > 0) {
      this.selectedPaymentMethod.set(nextMethod.code);
      this.draftReference.set(nextMethod.code === 'cash' ? 'Efectivo' : '');
      this.draftAuthCode.set('');
      this.draftProviderTransactionId.set('');
      this.draftExternalStatus.set('idle');
    }
    this.fillDraftPending();
  }

  removePaymentLine(id: string): void {
    this.paymentLines.update((lines) => lines.filter((line) => line.id !== id));
    this.paymentCollection.set(null);
    this.checkoutError.set(null);
    this.fillDraftPending();
  }

  hasPaymentFor(method: PosPaymentMethodCode): boolean {
    return this.paymentLines().some((line) => line.method === method);
  }

  paymentMethodLabel(method: PosPaymentMethodCode): string {
    return this.paymentMethod(method).label;
  }

  private paymentMethod(method: PosPaymentMethodCode): PosPaymentMethodOption {
    const methods = this.paymentMethods();
    return methods.find((item) => item.code === method) ?? this.paymentWidgets.allPaymentMethods()[0]!;
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
    this.stopPayPhonePolling();
    this.payPhoneWidget.resetSession();
    this.payPhoneRecoveryMessage.set('');
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
    this.payPhonePhoneNumber.set('');
    this.payPhoneCountryCode.set(this.defaultPayPhoneCountryCode());
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
      this.checkoutError.set(this.puntoEmisionSetupMessage());
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
          } else if (response.invoiceStatus === 'PENDING') {
            this.saleActionMessage.set('Venta registrada. Emisión fiscal pendiente.');
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

  dismissCheckoutError(): void {
    this.checkoutError.set(null);
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
    return (this.resolvedPuntoEmisionId() ?? this.prefs.puntoEmisionId().trim()).trim();
  }

  private missingPuntoEmisionMessage(): string | null {
    if (!this.posApiConfigured() || this.effectivePuntoEmisionId()) {
      return null;
    }
    return this.puntoEmisionSetupMessage();
  }

  private puntoEmisionSetupMessage(): string {
    return this.runtimeConfig.puntoEmisionSetupHint();
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
        ivaPorcentaje: line.product.ivaPercent ?? 15,
        ivaCodigoPorcentaje: line.product.ivaTaxCode ?? null,
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
      if (err.status === 401 || err.status === 403) {
        return 'Sesión no autorizada. Vuelva a ingresar al POS e intente de nuevo.';
      }
      if (err.status === 0) {
        return 'Sin respuesta del servidor. Verifique que el servicio esté activo.';
      }
      const fromApi = extractApiErrorMessage(err, '');
      if (fromApi) {
        return fromApi;
      }
      if (err.status >= 500) {
        return 'El servidor no pudo procesar el cobro. Intente de nuevo en unos momentos.';
      }
      return `No se pudo completar el cobro (código ${err.status}).`;
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
    this.patchTabs((ts) => [
      ...ts,
      {
        id,
        label: `Venta ${n}`,
        cart: [],
        customer: SALE_CONSUMIDOR_FINAL,
      },
    ]);
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
    if (raw) {
      const q = raw.toLowerCase();
      if (q.includes('consum') || q === 'cf' || q === '999') {
        this.applyConsumidorFinal();
        return;
      }
    }
    this.openCustomerPicker(raw);
  }

  openCustomerPicker(query = ''): void {
    if (!this.posApiConfigured()) {
      this.toast.error('Configure la API del POS para buscar en el maestro de clientes.');
      return;
    }
    this.custPickerQuery.set(query);
    this.modal.set({ kind: 'pickCustomer' });
    this.loadCustomerPicker(query);
  }

  reloadCustomerPicker(): void {
    this.loadCustomerPicker(this.custPickerQuery().trim());
  }

  onCustPickerRowAction(event: { action: string; row: Record<string, unknown> }): void {
    if (event.action !== 'use') {
      return;
    }
    const id = String(event.row['id'] ?? '');
    const row = this.custPickerRows().find((c) => c.id === id);
    if (row) {
      this.selectCustomer(row);
    }
  }

  private bumpCustPickerGrid(): void {
    this.custPickerGridNonce.update((n) => n + 1);
  }

  openNewCustomerFromPicker(): void {
    const q = this.custPickerQuery().trim();
    this.openNewCustomer();
    if (/^\d{13}$/.test(q)) {
      this.newCustDraft.tipoIdentificacion = '04';
      this.newCustDraft.identificacion = q;
      this.newCustOnTipoChange();
    } else if (/^\d{10}$/.test(q)) {
      this.newCustDraft.tipoIdentificacion = '05';
      this.newCustDraft.identificacion = q;
      this.newCustOnTipoChange();
    } else if (q) {
      this.newCustDraft.razonSocial = q;
    }
  }

  selectCustomer(row: PosCustomerResponse): void {
    this.applyCustomer(customerResponseToSale(row));
    this.closeModal();
  }

  applyConsumidorFinal(): void {
    this.applyCustomer(SALE_CONSUMIDOR_FINAL);
  }

  private loadCustomerPicker(query: string): void {
    this.custPickerLoading.set(true);
    this.custSearchLoading.set(true);
    const q = query.trim();
    this.backend.getCustomers(q || undefined).subscribe({
      next: (rows) => {
        this.custPickerLoading.set(false);
        this.custSearchLoading.set(false);
        this.custPickerRows.set(rows);
        this.bumpCustPickerGrid();
        if (rows.length === 0) {
          this.toast.warning('Sin coincidencias. Pruebe otro criterio o cree un cliente nuevo.');
        }
      },
      error: () => {
        this.custPickerLoading.set(false);
        this.custSearchLoading.set(false);
        this.custPickerRows.set([]);
        this.bumpCustPickerGrid();
        this.toast.error('No se pudo consultar clientes. Verifique la conexión con pos-app.');
      },
    });
  }

  private applyCustomer(customer: SaleCustomer): void {
    this.patchActiveTab((t) => {
      const next = { ...t, customer };
      if (!this.prefs.allowManualPriceListSelection() && customer.priceListId) {
        return this.repriceAllLinesToList(next, customer.priceListId);
      }
      return next;
    });
    this.resetCustomerSearchUi();
    this.saleActionMessage.set(null);
    this.focusCatalogSearch();
  }

  private resetCustomerSearchUi(): void {
    this.custQuery.set('');
    this.custPickerQuery.set('');
    this.custPickerRows.set([]);
    this.custSearchLoading.set(false);
    this.custPickerLoading.set(false);
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
    this.stopPayPhonePolling();
    this.payPhoneWidget.resetSession();
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
    const listId = this.defaultPriceListId();
    const priced: DemoProduct = { ...p, price: this.resolvePrice(p, listId) };
    let scrollLineId: string | null = null;
    this.playUiSound('add');
    this.patchActiveTab((t) => {
      const rows = t.cart;
      const i = rows.findIndex((r) => r.product.id === p.id && r.priceListId === listId);
      if (i >= 0 && !this.prefs.separateSameProductLines()) {
        const next = [...rows];
        const row = next[i];
        scrollLineId = row.lineId;
        const qty = row.qty + 1;
        const unit = row.product.price;
        const gross = qty * unit;
        const disc = Math.min(row.discountAmount ?? 0, gross);
        next[i] = { ...row, qty, discountAmount: disc };
        return { ...t, cart: next };
      }
      const lineId = this.newLineId();
      scrollLineId = lineId;
      return {
        ...t,
        cart: [
          ...rows,
          { lineId, product: priced, priceListId: listId, qty: 1, discountAmount: 0 },
        ],
      };
    });
    if (scrollLineId) {
      this.scrollCartToLine(scrollLineId);
    }
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





