import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
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
  host: { class: 'pos-page-host' },
  template: `
    <pos-page-layout
      eyebrow="Maestros"
      title="Catálogo"
      subtitle="Productos del tenant. Sincronice con eFactura si el modo de despliegue lo permite."
      icon="catalogo">
      <div page-actions class="pos-page-actions-group">
        <button type="button" class="pos-btn pos-btn--primary" (click)="openCreate()">Agregar</button>
        <button type="button" class="pos-btn pos-btn--outline" (click)="mostrarFiltros.set(!mostrarFiltros())">
          {{ mostrarFiltros() ? 'Ocultar filtros' : 'Ver filtros' }}
        </button>
        <button type="button" class="pos-btn pos-btn--soft" (click)="aplicarFiltros()">Buscar</button>
        @if (mostrarFiltros()) {
          <button type="button" class="pos-btn pos-btn--outline" (click)="limpiarFiltros()">Limpiar</button>
        }
        @if (canSyncEfactura()) {
          <button type="button" class="pos-btn pos-btn--soft" [disabled]="syncing()" (click)="syncEfactura()">
            {{ syncing() ? 'Sincronizando…' : 'Sync eFactura' }}
          </button>
        }
        <a routerLink="/categorias" class="pos-btn pos-btn--soft">Categorías</a>
        <button type="button" class="pos-btn pos-btn--soft" (click)="reload()">Refrescar</button>
      </div>

      @if (message()) {
        <p class="pos-maestro-msg" [class.pos-maestro-msg--err]="messageIsError()">{{ message() }}</p>
      }

      <div class="pos-maestro-filters-panel" [class.is-open]="mostrarFiltros()">
        <div class="pos-maestro-filters-panel__inner">
          <div class="pos-maestro-filters">
            <label class="pos-maestro-filter pos-maestro-filter--grow">
              <span>Buscar</span>
              <input [(ngModel)]="filterQ" name="filterQ" placeholder="Nombre, SKU o código de barras" (keyup.enter)="aplicarFiltros()" />
            </label>
            <label class="pos-maestro-filter">
              <span>Categoría</span>
              <select [(ngModel)]="filterCategoryId" name="filterCategoryId">
                <option value="">Todas</option>
                @for (c of categoryOptions(); track c.id) {
                  <option [value]="c.id">{{ categorySelectLabel(c) }}</option>
                }
              </select>
            </label>
            <label class="pos-maestro-filter">
              <span>Etiqueta</span>
              <select [(ngModel)]="filterTag" name="filterTag">
                <option value="">Todas</option>
                <option>Retail</option>
                <option>Servicios</option>
                <option>Combo</option>
              </select>
            </label>
            <label class="pos-maestro-filter">
              <span>Estado</span>
              <select [(ngModel)]="filterEstado" name="filterEstado">
                <option value="">Todos</option>
                <option value="ACTIVO">Activo</option>
                <option value="INACTIVO">Inactivo</option>
              </select>
            </label>
          </div>
        </div>
      </div>

      <pos-tabulator-local-grid
        [data]="gridRows()"
        [columns]="columns"
        [reloadNonce]="gridNonce()"
        [pagination]="true"
        [paginationSize]="15"
        emptyContext="masters"
        (rowAction)="onRowAction($event)"
        (emptyAction)="onEmptyAction($event)" />
    </pos-page-layout>

    @if (formOpen()) {
      <div class="ts-modal-backdrop" (click)="closeForm()"></div>
      <section class="ts-form-modal ts-form-modal--wide" role="dialog" aria-modal="true">
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
            <p class="ts-form-modal__eyebrow">Maestros</p>
            <h3>{{ editingId() ? 'Editar producto' : 'Nuevo producto' }}</h3>
            <p class="ts-form-modal__subtitle">Complete los datos del ítem de catálogo.</p>
          </div>
          <button type="button" class="ts-form-modal__close" aria-label="Cerrar" (click)="closeForm()">
            <svg class="ts-form-modal__close-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M8 8l8 8M16 8l-8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
            </svg>
          </button>
        </header>
        <div class="ts-form-modal__body">
          <div class="pos-form-grid">
            <label class="pos-form-field"><span>SKU / Código interno</span><input [(ngModel)]="draft.sku" name="sku" required /></label>
            <label class="pos-form-field">
              <span>Código de barras</span>
              <input [(ngModel)]="draft.barcode" name="barcode" placeholder="EAN / UPC — compatible con lector" />
            </label>
            <label class="pos-form-field pos-form-field--span2"><span>Nombre</span><input [(ngModel)]="draft.name" name="name" required /></label>
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
            <label class="pos-form-field pos-form-field--span2">
              <span>Imagen</span>
              <div class="pos-catalog-image-field">
                @if (imagePreviewUrl() || draft.imageUrl) {
                  <img [src]="imagePreviewUrl() || resolveMediaUrl(draft.imageUrl)" alt="" class="pos-catalog-image-preview" />
                }
                <div class="pos-catalog-image-actions">
                  <input type="file" accept="image/png,image/jpeg,image/webp" (change)="onImageSelected($event)" />
                  <input [(ngModel)]="draft.imageUrl" name="imageUrl" placeholder="URL alternativa (https://…)" />
                </div>
              </div>
            </label>
            <label class="pos-form-field">
              <span>Ref. externa</span>
              <input [(ngModel)]="draft.externalRef" name="externalRef" placeholder="ID en sistema externo" [readonly]="isEfacturaProduct()" />
            </label>
            @if (editingId() && editingCatalogSource()) {
              <label class="pos-form-field">
                <span>Origen catálogo</span>
                <input [value]="catalogSourceLabel(editingCatalogSource())" readonly />
              </label>
            }
            <label class="pos-form-field">
              <span>Precio principal</span>
              <input type="number" step="0.01" min="0" [(ngModel)]="draft.price" name="price" required (ngModelChange)="onPrimaryPriceChange($event)" />
              @if (primaryPriceList()) {
                <small class="pos-form-hint">Lista: {{ primaryPriceList()!.name }}</small>
              }
            </label>
            <div class="pos-form-field pos-form-field--span2">
              <div class="pos-form-field__inline pos-form-field__inline--between">
                <span>Precios por lista</span>
                <button type="button" class="pos-btn pos-btn--outline pos-btn--sm" (click)="openPriceListForm()">Nueva lista</button>
              </div>
              <div class="pos-price-list-grid">
                @for (row of priceDrafts; track row.priceListId) {
                  <label class="pos-price-list-row">
                    <span>{{ row.priceListName }}@if (row.primary) { <em class="pos-form-hint"> (principal)</em> }</span>
                    <input type="number" step="0.01" min="0" [(ngModel)]="row.price" [name]="'price_' + row.priceListId" (ngModelChange)="onListPriceChange(row)" />
                  </label>
                }
              </div>
            </div>
            <label class="pos-form-field">
              <span>Tarifa IVA (SRI)</span>
              <select [(ngModel)]="draft.ivaTaxCode" name="ivaTaxCode" (ngModelChange)="onIvaCodeChange($event)">
                @for (opt of ivaOptions; track opt.code) {
                  <option [value]="opt.code">{{ opt.description }}</option>
                }
              </select>
            </label>
            <label class="pos-form-field">
              <span>Etiqueta / grupo</span>
              <select [(ngModel)]="draft.tag" name="tag"><option>Retail</option><option>Servicios</option><option>Combo</option></select>
            </label>
            <label class="pos-form-field">
              <span>% IVA aplicable</span>
              <input type="number" step="0.01" [ngModel]="draft.ivaPercent" name="ivaPercent" readonly />
            </label>
          </div>
        </div>
        <footer class="ts-form-modal__footer">
          <button type="button" class="pos-btn pos-btn--ghost" (click)="closeForm()">Cancelar</button>
          <button type="button" class="pos-btn pos-btn--primary" [disabled]="saving()" (click)="saveProduct()">
            {{ saving() ? 'Guardando…' : 'Guardar' }}
          </button>
        </footer>
      </section>
    }

    @if (priceListFormOpen()) {
      <div class="ts-modal-backdrop" (click)="closePriceListForm()"></div>
      <section class="ts-form-modal ts-form-modal--compact" role="dialog" aria-modal="true">
        <header class="ts-form-modal__header">
          <div class="ts-form-modal__head-text">
            <h3>Nueva lista de precios</h3>
          </div>
          <button type="button" class="ts-form-modal__close" aria-label="Cerrar" (click)="closePriceListForm()">
            <svg class="ts-form-modal__close-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M8 8l8 8M16 8l-8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
            </svg>
          </button>
        </header>
        <div class="ts-form-modal__body">
          <label class="pos-form-field">
            <span>Nombre</span>
            <input [(ngModel)]="newPriceListName" name="newPriceListName" placeholder="Ej. Mayorista" />
          </label>
        </div>
        <footer class="ts-form-modal__footer">
          <button type="button" class="pos-btn pos-btn--ghost" (click)="closePriceListForm()">Cancelar</button>
          <button type="button" class="pos-btn pos-btn--primary" [disabled]="savingPriceList()" (click)="createPriceList()">
            {{ savingPriceList() ? 'Guardando…' : 'Crear lista' }}
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

  readonly primaryPriceList = computed(() => this.priceLists().find((p) => p.primary) ?? null);

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
      width: 82,
      headerSort: false,
      hozAlign: 'center',
      formatter: () =>
        gridActionsMenu([
          { action: 'edit', label: 'Editar', icon: 'edit' },
          { action: 'delete', label: 'Inactivar', icon: 'inactivate', danger: true },
        ]),
    },
    {
      title: '',
      field: 'imageDisplayUrl',
      width: 52,
      headerSort: false,
      hozAlign: 'center',
      formatter: (cell) => {
        const url = String(tabulatorCellValue(cell) ?? '').trim();
        if (!url) return '—';
        return `<img src="${escapeHtml(url)}" alt="" class="pos-catalog-thumb" loading="lazy" />`;
      },
    },
    { title: 'SKU', field: 'sku', minWidth: 110, formatter: (cell) => tabulatorTextareaCell(tabulatorCellValue(cell)) },
    {
      title: 'Cód. barras',
      field: 'barcode',
      minWidth: 120,
      formatter: (cell) => tabulatorTextareaCell(tabulatorCellValue(cell) ?? '—'),
    },
    { title: 'Producto', field: 'name', minWidth: 200, formatter: (cell) => tabulatorTextareaCell(tabulatorCellValue(cell)) },
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
      width: 110,
      formatter: (cell) => {
        const v = Number(tabulatorCellValue(cell));
        return Number.isFinite(v) ? v.toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
      },
    },
    {
      title: 'Ref. ext.',
      field: 'externalRef',
      minWidth: 100,
      formatter: (cell) => tabulatorTextareaCell(tabulatorCellValue(cell) ?? '—'),
    },
    { title: 'Origen', field: 'catalogSourceLabel', width: 100 },
    { title: 'Etiqueta', field: 'tag', width: 110 },
    { title: 'Impuesto', field: 'ivaLabel', minWidth: 150, formatter: (cell) => tabulatorTextareaCell(tabulatorCellValue(cell)) },
    {
      title: 'Estado',
      field: 'active',
      width: 105,
      formatter: (cell) => this.estadoBadge(tabulatorCellValue(cell) === true),
    },
  ];

  readonly formOpen = signal(false);
  readonly editingId = signal<string | null>(null);
  readonly editingCatalogSource = signal<string | null>(null);
  readonly priceListFormOpen = signal(false);
  readonly savingPriceList = signal(false);
  readonly imagePreviewUrl = signal<string | null>(null);
  readonly saving = signal(false);
  readonly syncing = signal(false);
  readonly message = signal<string | null>(null);
  readonly messageIsError = signal(false);
  readonly deactivateId = signal<string | null>(null);
  readonly runtimeConfig = signal<{ catalogSource: string; invoicingProvider: string } | null>(null);

  draft: PosProductRequest = this.emptyDraft();
  priceDrafts: PriceDraftRow[] = [];
  newPriceListName = '';
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

  onIvaCodeChange(code: string): void {
    this.draft.ivaTaxCode = code;
    this.draft.ivaPercent = posSriIvaPercentForCode(code);
  }

  openCreate(): void {
    this.editingId.set(null);
    this.editingCatalogSource.set(null);
    this.clearImagePending();
    this.draft = this.emptyDraft();
    this.initPriceDrafts();
    this.formOpen.set(true);
  }

  openEdit(p: PosProductResponse): void {
    this.editingId.set(p.id);
    this.editingCatalogSource.set(p.catalogSource ?? 'POS');
    this.clearImagePending();
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
    this.draft = this.emptyDraft();
    this.priceDrafts = [];
  }

  openPriceListForm(): void {
    this.newPriceListName = '';
    this.priceListFormOpen.set(true);
  }

  closePriceListForm(): void {
    this.priceListFormOpen.set(false);
    this.newPriceListName = '';
  }

  createPriceList(): void {
    const name = this.newPriceListName.trim();
    if (!name) {
      this.setMessage('Indique el nombre de la lista', true);
      return;
    }
    this.savingPriceList.set(true);
    this.api
      .postPriceList({ name })
      .pipe(finalize(() => this.savingPriceList.set(false)))
      .subscribe({
        next: (created) => {
          this.closePriceListForm();
          this.reloadMasters();
          this.priceDrafts = [
            ...this.priceDrafts,
            { priceListId: created.id, priceListName: created.name, primary: false, price: 0 },
          ];
          this.setMessage('Lista de precios creada', false);
        },
        error: () => this.setMessage('Error al crear la lista de precios', true),
      });
  }

  onImageSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) {
      this.setMessage('La imagen no puede superar 3 MB', true);
      input.value = '';
      return;
    }
    this.pendingImageFile = file;
    const prev = this.imagePreviewUrl();
    if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev);
    this.imagePreviewUrl.set(URL.createObjectURL(file));
  }

  onPrimaryPriceChange(value: number): void {
    const primary = this.priceDrafts.find((r) => r.primary);
    if (primary) primary.price = Number(value) || 0;
  }

  onListPriceChange(row: PriceDraftRow): void {
    if (row.primary) this.draft.price = Number(row.price) || 0;
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
