import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import type { ColumnDefinition } from 'tabulator-tables';
import { finalize } from 'rxjs';
import { PosBackendApiService } from '../../core/api/pos-backend-api.service';
import type { PosPriceListRequest, PosPriceListResponse } from '../../core/api/pos-backend.types';
import { gridActionsMenu, type GridActionItem } from '../../shared/grid/grid-actions.util';
import { PosTabulatorLocalGridComponent } from '../../shared/grid/pos-tabulator-local-grid.component';
import { escapeHtml, tabulatorCellValue, tabulatorTextareaCell } from '../../shared/grid/tabulator-formatters.util';
import { PosToastService } from '../../core/ui/pos-toast.service';
import { PosPageLayoutComponent } from '../../shared/pos-page-layout.component';

@Component({
  selector: 'pos-listas-precio-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, PosPageLayoutComponent, PosTabulatorLocalGridComponent],
  host: { class: 'pos-page-host' },
  template: `
    <pos-page-layout
      eyebrow="Catálogo"
      title="Listas de precios"
      subtitle="Configure las listas antes de asignar precios en productos, importación o venta."
      icon="listas-precio">
      <div page-actions class="pos-page-actions-group">
        <button type="button" class="pos-btn pos-btn--primary" (click)="openCreate()">Nueva lista</button>
        <button type="button" class="pos-btn pos-btn--outline" (click)="mostrarFiltros.set(!mostrarFiltros())">
          {{ mostrarFiltros() ? 'Ocultar filtros' : 'Ver filtros' }}
        </button>
        <button type="button" class="pos-btn pos-btn--soft" (click)="reload()">Refrescar</button>
        <a routerLink="/catalogo" class="pos-btn pos-btn--soft">Ir a catálogo</a>
      </div>

      <p class="pos-maestro-msg pos-maestro-msg--info">
        La <strong>lista principal</strong> se crea automáticamente y alimenta el precio de venta. Cree listas adicionales
        (mayorista, distribuidor, etc.) y asígnelas en cada producto.
      </p>

      <div class="pos-maestro-filters-panel" [class.is-open]="mostrarFiltros()">
        <div class="pos-maestro-filters-panel__inner">
          <div class="pos-maestro-filters">
            <label class="pos-maestro-filter pos-maestro-filter--grow">
              <span>Buscar</span>
              <input [(ngModel)]="filterQ" name="filterQ" placeholder="Nombre o código" (keyup.enter)="aplicarFiltros()" />
            </label>
            <label class="pos-maestro-filter">
              <span>Estado</span>
              <select [(ngModel)]="filterEstado" name="filterEstado">
                <option value="">Activas</option>
                <option value="TODAS">Incluir inactivas</option>
              </select>
            </label>
            <button type="button" class="pos-btn pos-btn--soft" (click)="aplicarFiltros()">Buscar</button>
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
      <section class="ts-form-modal ts-form-modal--compact" role="dialog" aria-modal="true">
        <header class="ts-form-modal__header">
          <div class="ts-form-modal__head-text">
            <p class="ts-form-modal__eyebrow">Catálogo</p>
            <h3>{{ editingPrimary() ? 'Editar lista principal' : editingId() ? 'Editar lista' : 'Nueva lista de precios' }}</h3>
          </div>
          <button type="button" class="ts-form-modal__close" aria-label="Cerrar" (click)="closeForm()">
            <svg class="ts-form-modal__close-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M8 8l8 8M16 8l-8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
            </svg>
          </button>
        </header>
        <div class="ts-form-modal__body">
          <label class="pos-form-field">
            <span>Nombre <abbr class="pos-form-required" title="Obligatorio">*</abbr></span>
            <input [(ngModel)]="draft.name" name="plName" placeholder="Ej. Mayorista" />
          </label>
          <label class="pos-form-field">
            <span>Código</span>
            <input
              [(ngModel)]="draft.code"
              name="plCode"
              placeholder="Ej. MAYORISTA"
              [readonly]="editingPrimary()"
              [attr.title]="editingPrimary() ? 'El código de la lista principal no se modifica' : null" />
            <small class="pos-form-hint">Se usa en importación como columna precio_CODIGO. Máx. 40 caracteres.</small>
          </label>
          <label class="pos-form-field">
            <span>Moneda</span>
            <input [(ngModel)]="draft.currency" name="plCurrency" placeholder="USD" maxlength="3" />
          </label>
        </div>
        <footer class="ts-form-modal__footer">
          <button type="button" class="pos-btn pos-btn--ghost" (click)="closeForm()">Cancelar</button>
          <button type="button" class="pos-btn pos-btn--primary" [disabled]="saving()" (click)="save()">
            {{ saving() ? 'Guardando…' : 'Guardar' }}
          </button>
        </footer>
      </section>
    }
  `,
})
export class PosListasPrecioPage implements OnInit {
  private readonly api = inject(PosBackendApiService);
  private readonly toast = inject(PosToastService);

  readonly items = signal<PosPriceListResponse[]>([]);
  readonly gridNonce = signal(0);
  readonly mostrarFiltros = signal(false);
  readonly formOpen = signal(false);
  readonly editingId = signal<string | null>(null);
  readonly editingPrimary = signal(false);
  readonly saving = signal(false);

  filterQ = '';
  filterEstado = '';
  draft: PosPriceListRequest = { name: '', code: '', currency: 'USD' };

  readonly gridRows = computed(() => {
    const q = this.filterQ.trim().toLowerCase();
    return this.items()
      .filter((row) => {
        if (!q) return true;
        return row.name.toLowerCase().includes(q) || row.code.toLowerCase().includes(q);
      })
      .map((row) => ({ ...row }) as Record<string, unknown>);
  });

  readonly columns: ColumnDefinition[] = [
    {
      title: '',
      field: '_actions',
      width: 52,
      hozAlign: 'center',
      headerSort: false,
      formatter: (cell) => this.actionsMenu(cell),
    },
    { title: 'Código', field: 'code', width: 120, formatter: (cell) => tabulatorTextareaCell(tabulatorCellValue(cell)) },
    { title: 'Nombre', field: 'name', minWidth: 180, formatter: (cell) => tabulatorTextareaCell(tabulatorCellValue(cell)) },
    {
      title: 'Tipo',
      field: 'primary',
      width: 110,
      formatter: (cell) => {
        const primary = tabulatorCellValue(cell) === true;
        const cls = primary ? 'pos-mig-estado--ok' : 'pos-mig-estado--upd';
        const label = primary ? 'Principal' : 'Adicional';
        return `<span class="pos-mig-estado ${cls}">${escapeHtml(label)}</span>`;
      },
    },
    { title: 'Moneda', field: 'currency', width: 80, formatter: (cell) => tabulatorTextareaCell(tabulatorCellValue(cell)) },
    {
      title: 'Estado',
      field: 'active',
      width: 100,
      formatter: (cell) => this.estadoBadge(tabulatorCellValue(cell) === true),
    },
  ];

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    const includeInactive = this.filterEstado === 'TODAS';
    this.api.getPriceLists(includeInactive).subscribe({
      next: (rows) => {
        this.items.set(rows);
        this.gridNonce.update((n) => n + 1);
      },
      error: () => this.toast.error('No se pudieron cargar las listas de precio'),
    });
  }

  aplicarFiltros(): void {
    this.reload();
  }

  openCreate(): void {
    this.editingId.set(null);
    this.editingPrimary.set(false);
    this.draft = { name: '', code: '', currency: 'USD' };
    this.formOpen.set(true);
  }

  closeForm(): void {
    this.formOpen.set(false);
  }

  save(): void {
    if (!this.draft.name?.trim()) {
      this.toast.error('Indique el nombre de la lista');
      return;
    }
    this.saving.set(true);
    const id = this.editingId();
    const req$ = id ? this.api.putPriceList(id, this.draft) : this.api.postPriceList(this.draft);
    req$.pipe(finalize(() => this.saving.set(false))).subscribe({
      next: () => {
        this.toast.success(id ? 'Lista actualizada' : 'Lista creada');
        this.closeForm();
        this.reload();
      },
      error: (err: unknown) => this.toast.error(this.errMsg(err, 'No se pudo guardar la lista')),
    });
  }

  onRowAction(ev: { action: string; row: Record<string, unknown> }): void {
    const id = String(ev.row['id'] ?? '');
    const row = this.items().find((r) => r.id === id);
    if (!row) return;
    if (ev.action === 'edit') {
      this.editingId.set(id);
      this.editingPrimary.set(row.primary);
      this.draft = { name: row.name, code: row.code, currency: row.currency };
      this.formOpen.set(true);
      return;
    }
    if (ev.action === 'activate') {
      this.api.activatePriceList(id).subscribe({
        next: () => {
          this.toast.success('Lista activada');
          this.reload();
        },
        error: (err: unknown) => this.toast.error(this.errMsg(err, 'No se pudo activar')),
      });
      return;
    }
    if (ev.action === 'deactivate') {
      this.api.deactivatePriceList(id).subscribe({
        next: () => {
          this.toast.success('Lista inactivada');
          this.reload();
        },
        error: (err: unknown) => this.toast.error(this.errMsg(err, 'No se pudo inactivar')),
      });
    }
  }

  onEmptyAction(action: string): void {
    if (action === 'create') this.openCreate();
  }

  private actionsMenu(cell: unknown): string {
    const row = (cell as { getData: () => Record<string, unknown> }).getData();
    const primary = row['primary'] === true;
    const active = row['active'] === true;
    const items: GridActionItem[] = [{ action: 'edit', label: 'Editar' }];
    if (!primary) {
      items.push(active ? { action: 'deactivate', label: 'Inactivar' } : { action: 'activate', label: 'Activar' });
    }
    return gridActionsMenu(cell, items);
  }

  private estadoBadge(active: boolean): string {
    const cls = active ? 'pos-mig-estado--ok' : 'pos-mig-estado--err';
    return `<span class="pos-mig-estado ${cls}">${active ? 'Activa' : 'Inactiva'}</span>`;
  }

  private errMsg(err: unknown, fallback: string): string {
    if (err && typeof err === 'object' && 'error' in err) {
      const e = (err as { error?: unknown }).error;
      if (typeof e === 'string' && e.trim()) return e;
    }
    return fallback;
  }
}
