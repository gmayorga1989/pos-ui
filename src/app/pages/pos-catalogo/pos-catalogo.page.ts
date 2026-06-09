import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { ColumnDefinition } from 'tabulator-tables';
import { finalize } from 'rxjs';
import { PosBackendApiService } from '../../core/api/pos-backend-api.service';
import type { PosProductRequest, PosProductResponse } from '../../core/api/pos-backend.types';
import { PosConfigService } from '../../core/config/pos-config.service';
import { gridActionsMenu } from '../../shared/grid/grid-actions.util';
import { PosTabulatorLocalGridComponent } from '../../shared/grid/pos-tabulator-local-grid.component';
import { escapeHtml, tabulatorCellValue, tabulatorTextareaCell } from '../../shared/grid/tabulator-formatters.util';
import { PosPageLayoutComponent } from '../../shared/pos-page-layout.component';

@Component({
  selector: 'pos-catalogo-page',
  standalone: true,
  imports: [CommonModule, FormsModule, PosPageLayoutComponent, PosTabulatorLocalGridComponent],
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
        emptyContext="masters"
        (rowAction)="onRowAction($event)"
        (emptyAction)="onEmptyAction($event)" />
    </pos-page-layout>

    @if (formOpen()) {
      <div class="ts-modal-backdrop" (click)="closeForm()"></div>
      <section class="ts-form-modal" role="dialog" aria-modal="true">
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
          <button type="button" class="ts-form-modal__close" aria-label="Cerrar" (click)="closeForm()">×</button>
        </header>
        <div class="ts-form-modal__body">
          <div class="pos-form-grid">
            <label class="pos-form-field"><span>SKU</span><input [(ngModel)]="draft.sku" name="sku" required /></label>
            <label class="pos-form-field"><span>Código de barras</span><input [(ngModel)]="draft.barcode" name="barcode" /></label>
            <label class="pos-form-field" style="grid-column: 1 / -1"><span>Nombre</span><input [(ngModel)]="draft.name" name="name" required /></label>
            <label class="pos-form-field"><span>Precio</span><input type="number" step="0.01" [(ngModel)]="draft.price" name="price" required /></label>
            <label class="pos-form-field">
              <span>Etiqueta</span>
              <select [(ngModel)]="draft.tag" name="tag"><option>Retail</option><option>Servicios</option><option>Combo</option></select>
            </label>
            <label class="pos-form-field"><span>IVA %</span><input type="number" step="0.01" [(ngModel)]="draft.ivaPercent" name="ivaPercent" /></label>
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

  readonly products = signal<PosProductResponse[]>([]);
  readonly mostrarFiltros = signal(false);
  readonly gridNonce = signal(0);
  filterQ = '';
  filterTag = '';
  filterEstado = '';
  readonly appliedQ = signal('');
  readonly appliedTag = signal('');
  readonly appliedEstado = signal('');

  readonly gridRows = computed(() =>
    this.products()
      .filter((p) => this.matchesFilters(p))
      .map((p) => ({ ...p }) as Record<string, unknown>),
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
    { title: 'SKU', field: 'sku', minWidth: 120, formatter: (cell) => tabulatorTextareaCell(tabulatorCellValue(cell)) },
    { title: 'Producto', field: 'name', minWidth: 220, formatter: (cell) => tabulatorTextareaCell(tabulatorCellValue(cell)) },
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
    { title: 'Etiqueta', field: 'tag', width: 110 },
    {
      title: 'IVA',
      field: 'ivaPercent',
      width: 80,
      formatter: (cell) => `${tabulatorCellValue(cell)}%`,
    },
    {
      title: 'Estado',
      field: 'active',
      width: 105,
      formatter: (cell) => this.estadoBadge(tabulatorCellValue(cell) === true),
    },
  ];

  readonly formOpen = signal(false);
  readonly editingId = signal<string | null>(null);
  readonly saving = signal(false);
  readonly syncing = signal(false);
  readonly message = signal<string | null>(null);
  readonly messageIsError = signal(false);
  readonly deactivateId = signal<string | null>(null);
  readonly runtimeConfig = signal<{ catalogSource: string; invoicingProvider: string } | null>(null);

  draft: PosProductRequest = this.emptyDraft();

  async ngOnInit(): Promise<void> {
    const cfg = await this.config.ensureLoaded();
    this.runtimeConfig.set({ catalogSource: cfg.catalogSource, invoicingProvider: cfg.invoicingProvider });
    this.reload();
  }

  canSyncEfactura(): boolean {
    const c = this.runtimeConfig();
    return c?.catalogSource === 'EFACTURA_SYNC' || c?.catalogSource === 'HYBRID';
  }

  aplicarFiltros(): void {
    this.appliedQ.set(this.filterQ);
    this.appliedTag.set(this.filterTag);
    this.appliedEstado.set(this.filterEstado);
    this.bumpGrid();
  }

  limpiarFiltros(): void {
    this.filterQ = '';
    this.filterTag = '';
    this.filterEstado = '';
    this.aplicarFiltros();
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

  openCreate(): void {
    this.editingId.set(null);
    this.draft = this.emptyDraft();
    this.formOpen.set(true);
  }

  openEdit(p: PosProductResponse): void {
    this.editingId.set(p.id);
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
      active: p.active,
    };
    this.formOpen.set(true);
  }

  closeForm(): void {
    this.formOpen.set(false);
    this.editingId.set(null);
    this.draft = this.emptyDraft();
  }

  saveProduct(): void {
    this.saving.set(true);
    const id = this.editingId();
    const req$ = id ? this.api.putProduct(id, this.draft) : this.api.postProduct(this.draft);
    req$.pipe(finalize(() => this.saving.set(false))).subscribe({
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
    const tag = this.appliedTag();
    const estado = this.appliedEstado();
    if (tag && p.tag !== tag) return false;
    if (estado === 'ACTIVO' && !p.active) return false;
    if (estado === 'INACTIVO' && p.active) return false;
    if (!q) return true;
    return `${p.name} ${p.sku} ${p.barcode ?? ''}`.toLowerCase().includes(q);
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

  private emptyDraft(): PosProductRequest {
    return { sku: '', barcode: '', name: '', price: 0, tag: 'Retail', ivaPercent: 15, ivaTaxCode: '2' };
  }
}
