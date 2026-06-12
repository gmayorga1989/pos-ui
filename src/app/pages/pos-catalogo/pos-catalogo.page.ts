import { CommonModule } from '@angular/common';
import { Component, computed, ElementRef, inject, OnInit, signal, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import type { ColumnDefinition } from 'tabulator-tables';
import { finalize, switchMap, of } from 'rxjs';
import { PosBackendApiService } from '../../core/api/pos-backend-api.service';
import type {
  PosPriceListResponse,
  PosProductCategoryResponse,
  PosProductPriceResponse,
  PosProductRequest,
  PosProductResponse,
} from '../../core/api/pos-backend.types';
import { PosAuthService } from '../../core/auth/pos-auth.service';
import { PosConfigService } from '../../core/config/pos-config.service';
import { gridActionsMenu } from '../../shared/grid/grid-actions.util';
import { PosTabulatorLocalGridComponent } from '../../shared/grid/pos-tabulator-local-grid.component';
import { escapeHtml, tabulatorCellValue, tabulatorTextareaCell } from '../../shared/grid/tabulator-formatters.util';
import {
  POS_SRI_IVA_DEFAULT_CODE,
  POS_SRI_IVA_OPTIONS,
  posSriIvaLabel,
  posSriIvaPercentForCode,
} from '../../shared/catalog/pos-sri-iva.util';
import {
  POS_PRODUCT_IMAGE_ACCEPT,
  POS_PRODUCT_IMAGE_HINT,
  validateProductImageFile,
} from '../../shared/catalog/pos-product-image.util';
import { PosPageLayoutComponent } from '../../shared/pos-page-layout.component';

interface PriceDraftRow {
  priceListId: string;
  priceListName: string;
  primary: boolean;
  price: number;
}

@Component({
  selector: 'pos-catalogo-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, PosPageLayoutComponent, PosTabulatorLocalGridComponent],
  host: { class: 'pos-page-host pos-page-host--catalog' },
  template: `
    <pos-page-layout
      eyebrow="Catálogo"
      title="Productos"
      subtitle="Administra tus productos, precios, impuestos y más."
      icon="catalogo">
      @if (message()) {
        <p class="pos-maestro-msg" [class.pos-maestro-msg--err]="messageIsError()">{{ message() }}</p>
      }

      <div class="pos-catalog-toolbar">
        <label class="pos-catalog-search">
          <svg class="pos-catalog-search__ico" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="1.6" />
            <path d="M16 16l5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
          </svg>
          <span class="sr-only">Buscar productos</span>
          <input
            class="pos-catalog-search__input"
            [(ngModel)]="filterQ"
            name="catalogSearchQ"
            placeholder="Buscar por nombre, SKU o código de barras…"
            (input)="onSearchInput()"
            (keyup.enter)="aplicarFiltros()" />
        </label>
        <div class="pos-catalog-toolbar__actions">
          <button type="button" class="pos-btn pos-btn--primary pos-catalog-toolbar__add" (click)="openCreate()">
            + Agregar
          </button>
          <button type="button" class="pos-btn pos-btn--outline" (click)="mostrarFiltros.set(!mostrarFiltros())">
            {{ mostrarFiltros() ? 'Ocultar filtros' : 'Ver filtros' }}
          </button>
          <a routerLink="/categorias" class="pos-btn pos-btn--outline">Categorías</a>
          <a routerLink="/listas-precio" class="pos-btn pos-btn--outline">Listas precio</a>
          <a routerLink="/migracion" [queryParams]="{ tipo: 'productos' }" class="pos-btn pos-btn--outline">Importar</a>
          @if (canSyncEfactura()) {
            <button type="button" class="pos-btn pos-btn--outline" [disabled]="syncing()" (click)="syncEfactura()">
              {{ syncing() ? 'Sincronizando…' : 'Sync eFactura' }}
            </button>
          }
          <button type="button" class="pos-catalog-toolbar__refresh" aria-label="Refrescar catálogo" title="Refrescar" (click)="reload()">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M20 12a8 8 0 10-16 0" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
              <path d="M4 4v5h5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
        </div>
      </div>

      <div class="pos-maestro-filters-panel" [class.is-open]="mostrarFiltros()">
        <div class="pos-maestro-filters-panel__inner">
          <div class="pos-maestro-filters">
            <label class="pos-maestro-filter">
              <span>Categoría</span>
              <select [(ngModel)]="filterCategoryId" name="filterCategoryId" (change)="aplicarFiltros()">
                <option value="">Todas</option>
                @for (c of categoryOptions(); track c.id) {
                  <option [value]="c.id">{{ categorySelectLabel(c) }}</option>
                }
              </select>
            </label>
            <label class="pos-maestro-filter">
              <span>Etiqueta</span>
              <select [(ngModel)]="filterTag" name="filterTag" (change)="aplicarFiltros()">
                <option value="">Todas</option>
                <option>Retail</option>
                <option>Servicios</option>
                <option>Combo</option>
              </select>
            </label>
            <label class="pos-maestro-filter">
              <span>Estado</span>
              <select [(ngModel)]="filterEstado" name="filterEstado" (change)="aplicarFiltros()">
                <option value="">Todos</option>
                <option value="ACTIVO">Activo</option>
                <option value="INACTIVO">Inactivo</option>
              </select>
            </label>
            @if (mostrarFiltros()) {
              <button type="button" class="pos-btn pos-btn--outline pos-btn--sm" (click)="limpiarFiltros()">Limpiar</button>
            }
          </div>
        </div>
      </div>

      <div class="pos-maestro-grid-wrap pos-catalog-grid-wrap">
        <pos-tabulator-local-grid
          [data]="gridRows()"
          [columns]="columns"
          [reloadNonce]="gridNonce()"
          [pagination]="true"
          [paginationSize]="15"
          height="min(620px, calc(100vh - 15.5rem))"
          emptyContext="masters"
          (rowAction)="onRowAction($event)"
          (emptyAction)="onEmptyAction($event)" />
      </div>
    </pos-page-layout>

    @if (formOpen()) {
      <div class="ts-modal-backdrop" (click)="closeForm()"></div>
      <section class="ts-form-modal ts-form-modal--product" role="dialog" aria-modal="true" aria-labelledby="product-form-title">
        <header class="ts-form-modal__header">
          <div class="ts-form-modal__icon" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <rect x="4" y="4" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.5" />
              <rect x="14" y="4" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.5" />
              <rect x="4" y="14" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.5" />
              <rect x="14" y="14" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.5" />
            </svg>
          </div>
          <div class="ts-form-modal__head-text">
            <p class="ts-form-modal__eyebrow">Maestros · Catálogo</p>
            <h3 id="product-form-title">{{ editingId() ? 'Editar producto' : 'Nuevo producto' }}</h3>
            <p class="ts-form-modal__subtitle">Organice identificación, precios, fiscal e imagen del ítem.</p>
          </div>
          <button type="button" class="ts-form-modal__close" aria-label="Cerrar" (click)="closeForm()">
            <svg class="ts-form-modal__close-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M8 8l8 8M16 8l-8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
            </svg>
          </button>
        </header>
        <div class="ts-form-modal__body">
          <div class="pos-product-form">
            <div class="pos-product-form__main">
              <section class="pos-form-section" aria-labelledby="product-section-ident">
                <div class="pos-form-section__head">
                  <h4 class="pos-form-section__title" id="product-section-ident">Identificación</h4>
                  <p class="pos-form-section__desc">Datos básicos visibles en venta y facturación.</p>
                </div>
                <div class="pos-form-section__body">
                  <label class="pos-form-field" [class.pos-form-field--invalid]="formErrors()['sku']">
                    <span>SKU / Código interno <abbr class="pos-form-required" title="Obligatorio">*</abbr></span>
                    <input [(ngModel)]="draft.sku" name="sku" autocomplete="off" placeholder="Ej. PROD-001" />
                    @if (formErrors()['sku']) {
                      <small class="pos-form-field__error">{{ formErrors()['sku'] }}</small>
                    }
                  </label>
                  <label class="pos-form-field">
                    <span>Código de barras</span>
                    <input [(ngModel)]="draft.barcode" name="barcode" placeholder="EAN / UPC — compatible con lector" />
                  </label>
                  <label class="pos-form-field pos-form-field--span2" [class.pos-form-field--invalid]="formErrors()['name']">
                    <span>Nombre del producto <abbr class="pos-form-required" title="Obligatorio">*</abbr></span>
                    <input [(ngModel)]="draft.name" name="name" placeholder="Nombre comercial o descriptivo" />
                    @if (formErrors()['name']) {
                      <small class="pos-form-field__error">{{ formErrors()['name'] }}</small>
                    }
                  </label>
                  <label class="pos-form-field pos-form-field--span2">
                    <span>Descripción</span>
                    <textarea [(ngModel)]="draft.description" name="description" rows="2" placeholder="Detalle opcional para uso interno"></textarea>
                  </label>
                </div>
              </section>

              <section class="pos-form-section" aria-labelledby="product-section-class">
                <div class="pos-form-section__head">
                  <h4 class="pos-form-section__title" id="product-section-class">Clasificación</h4>
                  <p class="pos-form-section__desc">Agrupe y filtre en catálogo y reportes.</p>
                </div>
                <div class="pos-form-section__body">
                  <label class="pos-form-field">
                    <span>Categoría</span>
                    <div class="pos-form-field__inline">
                      <select [(ngModel)]="draft.categoryId" name="categoryId">
                        <option [ngValue]="null">Sin categoría</option>
                        @for (c of categoryOptions(); track c.id) {
                          <option [ngValue]="c.id">{{ categorySelectLabel(c) }}</option>
                        }
                      </select>
                      <a routerLink="/categorias" class="pos-btn pos-btn--outline pos-btn--sm pos-form-field__action">Gestionar</a>
                    </div>
                  </label>
                  <label class="pos-form-field">
                    <span>Etiqueta / grupo</span>
                    <select [(ngModel)]="draft.tag" name="tag">
                      <option>Retail</option>
                      <option>Servicios</option>
                      <option>Combo</option>
                    </select>
                  </label>
                </div>
              </section>

              <section class="pos-form-section" aria-labelledby="product-section-prices">
                <div class="pos-form-section__head">
                  <div class="pos-form-field__inline pos-form-field__inline--between">
                    <div>
                      <h4 class="pos-form-section__title" id="product-section-prices">Precios</h4>
                      <p class="pos-form-section__desc">La lista principal se usa en venta y checkout.</p>
                    </div>
                    <a routerLink="/listas-precio" class="pos-btn pos-btn--outline pos-btn--sm">Gestionar listas</a>
                  </div>
                </div>
                <div class="pos-form-section__body pos-form-section__body--single">
                  <div class="pos-price-table">
                    <div class="pos-price-table__head">
                      <span>Lista de precios</span>
                      <span>Precio <abbr class="pos-form-required" title="Obligatorio">*</abbr></span>
                    </div>
                    @for (row of priceDrafts; track row.priceListId) {
                      <label class="pos-price-table__row" [class.pos-form-field--invalid]="row.primary && formErrors()['price']">
                        <span class="pos-price-table__name">
                          {{ row.priceListName }}
                          @if (row.primary) {
                            <span class="pos-price-table__badge">Principal</span>
                          }
                        </span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          [(ngModel)]="row.price"
                          [name]="'price_' + row.priceListId"
                          (ngModelChange)="onListPriceChange(row)" />
                      </label>
                    }
                  </div>
                  @if (formErrors()['price']) {
                    <small class="pos-form-field__error">{{ formErrors()['price'] }}</small>
                  }
                </div>
              </section>

              <section class="pos-form-section" aria-labelledby="product-section-tax">
                <div class="pos-form-section__head">
                  <h4 class="pos-form-section__title" id="product-section-tax">Impuestos (SRI)</h4>
                  <p class="pos-form-section__desc">Tarifa de IVA aplicable al comprobante electrónico.</p>
                </div>
                <div class="pos-form-section__body">
                  <label class="pos-form-field">
                    <span>Tarifa IVA <abbr class="pos-form-required" title="Obligatorio">*</abbr></span>
                    <select [(ngModel)]="draft.ivaTaxCode" name="ivaTaxCode" (ngModelChange)="onIvaCodeChange($event)">
                      @for (opt of ivaOptions; track opt.code) {
                        <option [value]="opt.code">{{ opt.description }}</option>
                      }
                    </select>
                  </label>
                  <label class="pos-form-field">
                    <span>% IVA aplicable</span>
                    <input type="number" step="0.01" [ngModel]="draft.ivaPercent" name="ivaPercent" readonly />
                  </label>
                </div>
              </section>

              <section class="pos-form-section" aria-labelledby="product-section-integration">
                <div class="pos-form-section__head">
                  <h4 class="pos-form-section__title" id="product-section-integration">Integración</h4>
                  <p class="pos-form-section__desc">Referencias externas y origen del registro.</p>
                </div>
                <div class="pos-form-section__body">
                  <label class="pos-form-field">
                    <span>Referencia externa</span>
                    <input [(ngModel)]="draft.externalRef" name="externalRef" placeholder="ID en ERP u otro sistema" [readonly]="isEfacturaProduct()" />
                  </label>
                  @if (editingId() && editingCatalogSource()) {
                    <label class="pos-form-field">
                      <span>Origen catálogo</span>
                      <input [value]="catalogSourceLabel(editingCatalogSource())" readonly />
                    </label>
                  }
                </div>
              </section>
            </div>

            <aside class="pos-product-form__aside">
              <div class="pos-image-panel">
                <h4 class="pos-image-panel__title">Imagen del producto</h4>
                <div
                  class="pos-image-dropzone"
                  [class.is-dragover]="imageDragOver()"
                  [class.has-preview]="hasImagePreview()"
                  (dragover)="onImageDragOver($event)"
                  (dragleave)="onImageDragLeave($event)"
                  (drop)="onImageDrop($event)"
                  (click)="onDropzoneClick($event)">
                  <input
                    #imageFileInput
                    class="pos-image-dropzone__input"
                    type="file"
                    [accept]="imageAccept"
                    (change)="onImageSelected($event)" />
                  @if (hasImagePreview()) {
                    <img [src]="imagePreviewUrl() || resolveMediaUrl(draft.imageUrl)" alt="Vista previa del producto" class="pos-image-dropzone__preview" />
                    <div class="pos-image-dropzone__actions">
                      <button type="button" class="pos-btn pos-btn--outline pos-btn--sm" (click)="triggerImageSelect($event)">Cambiar</button>
                      <button type="button" class="pos-btn pos-btn--ghost pos-btn--sm" (click)="removeImage($event)">Quitar</button>
                    </div>
                  } @else {
                    <div class="pos-image-dropzone__placeholder">
                      <div class="pos-image-dropzone__icon" aria-hidden="true">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                          <path d="M12 16V8M8 12h8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
                          <rect x="4" y="4" width="16" height="16" rx="3" stroke="currentColor" stroke-width="1.5" />
                        </svg>
                      </div>
                      <p class="pos-image-dropzone__label">Arrastre una imagen o haga clic</p>
                      <p class="pos-image-dropzone__hint">{{ imageHint }}</p>
                    </div>
                  }
                </div>
                @if (imageError()) {
                  <p class="pos-image-dropzone__error" role="alert">{{ imageError() }}</p>
                }
                <button type="button" class="pos-image-url-toggle" (click)="showImageUrlField.set(!showImageUrlField())">
                  {{ showImageUrlField() ? 'Ocultar URL' : 'Usar URL en su lugar' }}
                </button>
                @if (showImageUrlField()) {
                  <label class="pos-image-url-field">
                    <span>URL de imagen</span>
                    <input [(ngModel)]="draft.imageUrl" name="imageUrl" placeholder="https://…" />
                    <small class="pos-form-hint">Alternativa si la imagen ya está alojada externamente.</small>
                  </label>
                }
              </div>
            </aside>
          </div>
        </div>
        <footer class="ts-form-modal__footer">
          <p class="pos-product-form__required-note"><abbr class="pos-form-required" title="Obligatorio">*</abbr> Campo obligatorio</p>
          <button type="button" class="pos-btn pos-btn--ghost" (click)="closeForm()">Cancelar</button>
          <button type="button" class="pos-btn pos-btn--primary" [disabled]="saving()" (click)="saveProduct()">
            {{ saving() ? 'Guardando…' : 'Guardar producto' }}
          </button>
        </footer>
      </section>
    }

    @if (deactivateId()) {
      <div class="ts-modal-backdrop" (click)="cancelDeactivate()"></div>
      <section class="ts-confirm-modal" role="alertdialog" aria-modal="true">
        <h3>Desactivar producto</h3>
        <p>El producto dejará de mostrarse en venta. ¿Continuar?</p>
        <div class="ts-confirm-modal__actions">
          <button type="button" class="pos-btn pos-btn--ghost pos-btn--sm" (click)="cancelDeactivate()">Cancelar</button>
          <button type="button" class="pos-btn pos-btn--danger pos-btn--sm" (click)="confirmDeactivate()">Desactivar</button>
        </div>
      </section>
    }
  `,
})
export class PosCatalogoPage implements OnInit {
  private readonly api = inject(PosBackendApiService);
  private readonly config = inject(PosConfigService);
  private readonly auth = inject(PosAuthService);

  readonly products = signal<PosProductResponse[]>([]);
  readonly categories = signal<PosProductCategoryResponse[]>([]);
  readonly priceLists = signal<PosPriceListResponse[]>([]);
  readonly mostrarFiltros = signal(false);
  readonly gridNonce = signal(0);
  filterQ = '';
  filterCategoryId = '';
  filterTag = '';
  filterEstado = '';
  readonly appliedQ = signal('');
  readonly appliedCategoryId = signal('');
  readonly appliedTag = signal('');
  readonly appliedEstado = signal('');

  readonly categoryOptions = computed(() =>
    [...this.categories()].sort((a, b) => a.pathLabel.localeCompare(b.pathLabel, 'es')),
  );

  readonly ivaOptions = POS_SRI_IVA_OPTIONS;

  readonly gridRows = computed(() =>
    this.products()
      .filter((p) => this.matchesFilters(p))
      .map(
        (p) =>
          ({
            ...p,
            imageDisplayUrl: this.resolveMediaUrl(p.imageUrl),
            ivaLabel: posSriIvaLabel(p.ivaTaxCode, p.ivaPercent),
            catalogSourceLabel: this.catalogSourceLabel(p.catalogSource),
          }) as Record<string, unknown>,
      ),
  );

  readonly columns: ColumnDefinition[] = [
    {
      title: '',
      field: 'id',
      width: 52,
      headerSort: false,
      hozAlign: 'center',
      formatter: () =>
        gridActionsMenu([
          { action: 'edit', label: 'Editar', icon: 'edit' },
          { action: 'delete', label: 'Inactivar', icon: 'inactivate', danger: true },
        ]),
    },
    {
      title: 'SKU',
      field: 'sku',
      minWidth: 150,
      formatter: (cell) => this.formatCatalogSkuCell(cell),
    },
    {
      title: 'Código de barras',
      field: 'barcode',
      minWidth: 130,
      formatter: (cell) => tabulatorTextareaCell(tabulatorCellValue(cell) ?? '—'),
    },
    {
      title: 'Producto',
      field: 'name',
      minWidth: 200,
      formatter: (cell) => tabulatorTextareaCell(tabulatorCellValue(cell)),
    },
    {
      title: 'Categoría',
      field: 'categoryName',
      minWidth: 130,
      formatter: (cell) => tabulatorTextareaCell(tabulatorCellValue(cell) ?? '—'),
    },
    {
      title: 'Precio',
      field: 'price',
      hozAlign: 'right',
      width: 100,
      formatter: (cell) => {
        const v = Number(tabulatorCellValue(cell));
        if (!Number.isFinite(v)) return '';
        return `<span class="pos-catalog-price">${escapeHtml(v.toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))}</span>`;
      },
    },
    {
      title: 'Stock',
      field: 'stockQty',
      hozAlign: 'right',
      width: 88,
      formatter: (cell) => {
        const v = tabulatorCellValue(cell);
        const n = v == null || v === '' ? null : Number(v);
        const label = n != null && Number.isFinite(n) ? String(n) : '—';
        return `<span class="pos-catalog-stock">${escapeHtml(label)}</span>`;
      },
    },
    {
      title: 'Impuesto',
      field: 'ivaLabel',
      minWidth: 140,
      formatter: (cell) => tabulatorTextareaCell(tabulatorCellValue(cell)),
    },
    {
      title: 'Estado',
      field: 'active',
      width: 100,
      hozAlign: 'center',
      formatter: (cell) => this.estadoBadge(tabulatorCellValue(cell) === true),
    },
  ];

  readonly formOpen = signal(false);
  readonly editingId = signal<string | null>(null);
  readonly editingCatalogSource = signal<string | null>(null);
  readonly imagePreviewUrl = signal<string | null>(null);
  readonly imageDragOver = signal(false);
  readonly showImageUrlField = signal(false);
  readonly imageError = signal<string | null>(null);
  readonly formErrors = signal<Record<string, string>>({});
  readonly saving = signal(false);
  readonly syncing = signal(false);
  readonly message = signal<string | null>(null);
  readonly messageIsError = signal(false);
  readonly deactivateId = signal<string | null>(null);
  readonly runtimeConfig = signal<{ catalogSource: string; invoicingProvider: string } | null>(null);

  readonly imageAccept = POS_PRODUCT_IMAGE_ACCEPT;
  readonly imageHint = POS_PRODUCT_IMAGE_HINT;

  @ViewChild('imageFileInput') private imageFileInput?: ElementRef<HTMLInputElement>;

  draft: PosProductRequest = this.emptyDraft();
  priceDrafts: PriceDraftRow[] = [];
  private pendingImageFile: File | null = null;

  async ngOnInit(): Promise<void> {
    const cfg = await this.config.ensureLoaded();
    this.runtimeConfig.set({ catalogSource: cfg.catalogSource, invoicingProvider: cfg.invoicingProvider });
    this.reloadMasters();
    this.reload();
  }

  canSyncEfactura(): boolean {
    const c = this.runtimeConfig();
    return c?.catalogSource === 'EFACTURA_SYNC' || c?.catalogSource === 'HYBRID';
  }

  aplicarFiltros(): void {
    this.appliedQ.set(this.filterQ);
    this.appliedCategoryId.set(this.filterCategoryId);
    this.appliedTag.set(this.filterTag);
    this.appliedEstado.set(this.filterEstado);
    this.bumpGrid();
  }

  limpiarFiltros(): void {
    this.filterQ = '';
    this.filterCategoryId = '';
    this.filterTag = '';
    this.filterEstado = '';
    this.aplicarFiltros();
  }

  reloadMasters(): void {
    this.api.getProductCategories().subscribe({
      next: (rows) => this.categories.set(rows),
      error: () => this.setMessage('No se pudieron cargar las categorías', true),
    });
    this.api.getPriceLists().subscribe({
      next: (rows) => this.priceLists.set(rows),
      error: () => this.setMessage('No se pudieron cargar las listas de precio', true),
    });
  }

  reload(): void {
    this.api.getProducts().subscribe({
      next: (rows) => {
        this.products.set(rows);
        this.bumpGrid();
      },
      error: () => this.setMessage('No se pudo cargar el catálogo', true),
    });
  }

  onEmptyAction(action: string): void {
    if (action === 'create') {
      this.openCreate();
    }
  }

  onRowAction(event: { action: string; row: Record<string, unknown> }): void {
    const id = String(event.row['id'] ?? '');
    if (!id) return;
    if (event.action === 'edit') {
      const p = this.products().find((x) => x.id === id);
      if (p) this.openEdit(p);
      return;
    }
    if (event.action === 'delete') {
      this.askDeactivate(id);
    }
  }

  onSearchInput(): void {
    this.aplicarFiltros();
  }

  private formatCatalogSkuCell(cell: unknown): string {
    const row = (cell as { getRow: () => { getData: () => Record<string, unknown> } }).getRow().getData();
    const sku = String(row['sku'] ?? '');
    const url = String(row['imageDisplayUrl'] ?? '').trim();
    const thumb = url
      ? `<img src="${escapeHtml(url)}" alt="" class="pos-catalog-thumb" loading="lazy" decoding="async" />`
      : `<span class="pos-catalog-thumb pos-catalog-thumb--empty" aria-hidden="true"></span>`;
    return `<div class="pos-catalog-sku">${thumb}<span class="ts-cell-textarea pos-catalog-sku__code">${escapeHtml(sku)}</span></div>`;
  }

  onIvaCodeChange(code: string): void {
    this.draft.ivaTaxCode = code;
    this.draft.ivaPercent = posSriIvaPercentForCode(code);
  }

  openCreate(): void {
    this.editingId.set(null);
    this.editingCatalogSource.set(null);
    this.clearImagePending();
    this.formErrors.set({});
    this.imageError.set(null);
    this.showImageUrlField.set(false);
    this.draft = this.emptyDraft();
    this.initPriceDrafts();
    this.formOpen.set(true);
  }

  openEdit(p: PosProductResponse): void {
    this.editingId.set(p.id);
    this.editingCatalogSource.set(p.catalogSource ?? 'POS');
    this.clearImagePending();
    this.formErrors.set({});
    this.imageError.set(null);
    this.showImageUrlField.set(!!p.imageUrl?.trim());
    this.draft = {
      sku: p.sku,
      barcode: p.barcode ?? '',
      name: p.name,
      description: p.description ?? '',
      price: Number(p.price),
      tag: p.tag,
      ivaPercent: Number(p.ivaPercent),
      ivaTaxCode: p.ivaTaxCode,
      stockQty: p.stockQty ?? undefined,
      categoryId: p.categoryId ?? null,
      imageUrl: p.imageUrl ?? '',
      externalRef: p.externalRef ?? '',
      catalogSource: p.catalogSource ?? 'POS',
      active: p.active,
    };
    this.formOpen.set(true);
    this.api.getProductPrices(p.id).subscribe({
      next: (prices) => this.initPriceDrafts(prices),
      error: () => this.initPriceDrafts(),
    });
  }

  closeForm(): void {
    this.formOpen.set(false);
    this.editingId.set(null);
    this.editingCatalogSource.set(null);
    this.clearImagePending();
    this.formErrors.set({});
    this.imageError.set(null);
    this.showImageUrlField.set(false);
    this.draft = this.emptyDraft();
    this.priceDrafts = [];
  }

  onImageSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) void this.processImageFile(file);
    input.value = '';
  }

  onImageDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.imageDragOver.set(true);
  }

  onImageDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.imageDragOver.set(false);
  }

  onImageDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.imageDragOver.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) void this.processImageFile(file);
  }

  onDropzoneClick(event: MouseEvent): void {
    if (this.hasImagePreview()) return;
    const target = event.target as HTMLElement;
    if (target.closest('button')) return;
    this.imageFileInput?.nativeElement.click();
  }

  triggerImageSelect(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.imageFileInput?.nativeElement.click();
  }

  removeImage(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.clearImagePending();
    this.draft.imageUrl = '';
    this.imageError.set(null);
    if (this.imageFileInput?.nativeElement) {
      this.imageFileInput.nativeElement.value = '';
    }
  }

  async processImageFile(file: File): Promise<void> {
    const error = await validateProductImageFile(file);
    if (error) {
      this.imageError.set(error);
      return;
    }
    this.imageError.set(null);
    this.pendingImageFile = file;
    this.draft.imageUrl = '';
    const prev = this.imagePreviewUrl();
    if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev);
    this.imagePreviewUrl.set(URL.createObjectURL(file));
  }

  onListPriceChange(row: PriceDraftRow): void {
    if (row.primary) this.draft.price = Number(row.price) || 0;
  }

  hasImagePreview(): boolean {
    return !!(this.imagePreviewUrl() || (this.draft.imageUrl ?? '').trim());
  }

  resolveMediaUrl(url?: string | null): string {
    if (!url) return '';
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('blob:')) return url;
    const base = this.auth.apiBaseUrl?.replace(/\/+$/, '') ?? '';
    return `${base}${url.startsWith('/') ? url : `/${url}`}`;
  }

  isEfacturaProduct(): boolean {
    return this.editingCatalogSource() === 'EFACTURA';
  }

  categorySelectLabel(c: PosProductCategoryResponse): string {
    const depth = c.pathLabel.includes(' › ') ? c.pathLabel.split(' › ').length - 1 : 0;
    const pad = depth > 0 ? `${'—'.repeat(depth)} ` : '';
    return `${pad}${c.name}`;
  }

  catalogSourceLabel(source?: string | null): string {
    switch ((source ?? 'POS').toUpperCase()) {
      case 'EFACTURA':
        return 'eFactura';
      case 'EXTERNAL':
        return 'Integración externa';
      default:
        return 'POS local';
    }
  }

  saveProduct(): void {
    if (!this.validateForm()) return;
    this.saving.set(true);
    const id = this.editingId();
    const primary = this.priceDrafts.find((r) => r.primary);
    if (primary) this.draft.price = Number(primary.price) || 0;
    const payload: PosProductRequest = {
      ...this.draft,
      prices: this.priceDrafts.map((r) => ({ priceListId: r.priceListId, price: Number(r.price) || 0 })),
    };
    const req$ = id ? this.api.putProduct(id, payload) : this.api.postProduct(payload);
    req$
      .pipe(
        switchMap((saved) => {
          const productId = id ?? saved.id;
          if (this.pendingImageFile && productId) {
            return this.api.uploadProductImage(productId, this.pendingImageFile);
          }
          return of(saved);
        }),
        finalize(() => this.saving.set(false)),
      )
      .subscribe({
        next: () => {
          this.setMessage('Producto guardado', false);
          this.closeForm();
          this.reload();
        },
        error: () => this.setMessage('Error al guardar producto', true),
      });
  }

  askDeactivate(id: string): void {
    this.deactivateId.set(id);
  }

  cancelDeactivate(): void {
    this.deactivateId.set(null);
  }

  confirmDeactivate(): void {
    const id = this.deactivateId();
    if (!id) return;
    this.deactivateId.set(null);
    this.api.deleteProduct(id).subscribe({
      next: () => {
        this.setMessage('Producto desactivado', false);
        this.reload();
      },
      error: () => this.setMessage('No se pudo desactivar el producto', true),
    });
  }

  syncEfactura(): void {
    this.syncing.set(true);
    this.api
      .syncEfacturaCatalog()
      .pipe(finalize(() => this.syncing.set(false)))
      .subscribe({
        next: (r) => {
          this.setMessage(`Sincronizados ${r.itemsSynced} ítems desde eFactura`, false);
          this.reload();
        },
        error: () => this.setMessage('Error al sincronizar con eFactura', true),
      });
  }

  private matchesFilters(p: PosProductResponse): boolean {
    const q = this.appliedQ().trim().toLowerCase();
    const categoryId = this.appliedCategoryId();
    const tag = this.appliedTag();
    const estado = this.appliedEstado();
    if (categoryId && p.categoryId !== categoryId) return false;
    if (tag && p.tag !== tag) return false;
    if (estado === 'ACTIVO' && !p.active) return false;
    if (estado === 'INACTIVO' && p.active) return false;
    if (!q) return true;
    return `${p.name} ${p.sku} ${p.barcode ?? ''} ${p.externalRef ?? ''}`.toLowerCase().includes(q);
  }

  private estadoBadge(active: boolean): string {
    const label = active ? 'Activo' : 'Inactivo';
    const cls = active ? 'pos-badge pos-badge--ok' : 'pos-badge pos-badge--muted';
    return `<span class="${cls}">${escapeHtml(label)}</span>`;
  }

  private bumpGrid(): void {
    this.gridNonce.update((n) => n + 1);
  }

  private setMessage(text: string, isError: boolean): void {
    this.message.set(text);
    this.messageIsError.set(isError);
  }

  private validateForm(): boolean {
    const errors: Record<string, string> = {};
    if (!this.draft.sku.trim()) errors['sku'] = 'Indique el SKU o código interno.';
    if (!this.draft.name.trim()) errors['name'] = 'Indique el nombre del producto.';
    const primary = this.priceDrafts.find((r) => r.primary);
    const primaryPrice = Number(primary?.price ?? this.draft.price);
    if (!Number.isFinite(primaryPrice) || primaryPrice < 0) {
      errors['price'] = 'Indique un precio válido en la lista principal.';
    }
    this.formErrors.set(errors);
    return Object.keys(errors).length === 0;
  }

  private initPriceDrafts(fromPrices?: PosProductPriceResponse[]): void {
    const lists = this.priceLists();
    if (fromPrices?.length) {
      this.priceDrafts = fromPrices.map((p) => ({
        priceListId: p.priceListId,
        priceListName: p.priceListName,
        primary: p.primary,
        price: Number(p.price) || 0,
      }));
      return;
    }
    this.priceDrafts = lists.map((l) => ({
      priceListId: l.id,
      priceListName: l.name,
      primary: l.primary,
      price: l.primary ? Number(this.draft.price) || 0 : 0,
    }));
  }

  private clearImagePending(): void {
    const prev = this.imagePreviewUrl();
    if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev);
    this.imagePreviewUrl.set(null);
    this.pendingImageFile = null;
  }

  private emptyDraft(): PosProductRequest {
    return {
      sku: '',
      barcode: '',
      name: '',
      description: '',
      price: 0,
      tag: 'Retail',
      categoryId: null,
      imageUrl: '',
      externalRef: '',
      catalogSource: 'POS',
      ivaPercent: posSriIvaPercentForCode(POS_SRI_IVA_DEFAULT_CODE),
      ivaTaxCode: POS_SRI_IVA_DEFAULT_CODE,
    };
  }
}
