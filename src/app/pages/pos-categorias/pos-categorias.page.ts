import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import type { ColumnDefinition } from 'tabulator-tables';
import { finalize } from 'rxjs';
import { PosBackendApiService } from '../../core/api/pos-backend-api.service';
import type { PosProductCategoryRequest, PosProductCategoryResponse } from '../../core/api/pos-backend.types';
import { gridActionsMenu, type GridActionItem } from '../../shared/grid/grid-actions.util';
import { PosTabulatorLocalGridComponent } from '../../shared/grid/pos-tabulator-local-grid.component';
import { escapeHtml, tabulatorCellValue, tabulatorTextareaCell } from '../../shared/grid/tabulator-formatters.util';
import { PosToastService } from '../../core/ui/pos-toast.service';
import { PosPageLayoutComponent } from '../../shared/pos-page-layout.component';

@Component({
  selector: 'pos-categorias-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, PosPageLayoutComponent, PosTabulatorLocalGridComponent],
  host: { class: 'pos-page-host' },
  template: `
    <pos-page-layout
      eyebrow="Maestros"
      title="Categorías"
      subtitle="Jerarquía de categorías para organizar el catálogo de productos."
      icon="categorias">
      <div page-actions class="pos-page-actions-group">
        <button type="button" class="pos-btn pos-btn--primary" (click)="openCreate()">Agregar</button>
        <button type="button" class="pos-btn pos-btn--outline" (click)="mostrarFiltros.set(!mostrarFiltros())">
          {{ mostrarFiltros() ? 'Ocultar filtros' : 'Ver filtros' }}
        </button>
        <button type="button" class="pos-btn pos-btn--soft" (click)="aplicarFiltros()">Buscar</button>
        @if (mostrarFiltros()) {
          <button type="button" class="pos-btn pos-btn--outline" (click)="limpiarFiltros()">Limpiar</button>
        }
        <a routerLink="/catalogo" class="pos-btn pos-btn--soft">Ir a catálogo</a>
        <button type="button" class="pos-btn pos-btn--soft" (click)="reload()">Refrescar</button>
      </div>

      <div class="pos-maestro-filters-panel" [class.is-open]="mostrarFiltros()">
        <div class="pos-maestro-filters-panel__inner">
          <div class="pos-maestro-filters">
            <label class="pos-maestro-filter pos-maestro-filter--grow">
              <span>Buscar</span>
              <input [(ngModel)]="filterQ" name="filterQ" placeholder="Nombre, código o ruta" (keyup.enter)="aplicarFiltros()" />
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
      <section class="ts-form-modal" role="dialog" aria-modal="true">
        <header class="ts-form-modal__header">
          <div class="ts-form-modal__head-text">
            <p class="ts-form-modal__eyebrow">Maestros</p>
            <h3>{{ editingId() ? 'Editar categoría' : 'Nueva categoría' }}</h3>
          </div>
          <button type="button" class="ts-form-modal__close" aria-label="Cerrar" (click)="closeForm()">
            <svg class="ts-form-modal__close-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M8 8l8 8M16 8l-8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
            </svg>
          </button>
        </header>
        <div class="ts-form-modal__body">
          <div class="pos-form-grid">
            <label class="pos-form-field pos-form-field--span2">
              <span>Nombre</span>
              <input [(ngModel)]="draft.name" name="catName" required />
            </label>
            <label class="pos-form-field">
              <span>Código (opcional)</span>
              <input [(ngModel)]="draft.code" name="catCode" />
            </label>
            <label class="pos-form-field">
              <span>Orden</span>
              <input type="number" [(ngModel)]="draft.sortOrder" name="catSort" />
            </label>
            <label class="pos-form-field pos-form-field--span2">
              <span>Categoría padre</span>
              <select [(ngModel)]="draft.parentId" name="catParent">
                <option [ngValue]="null">Raíz</option>
                @for (c of parentOptions(); track c.id) {
                  <option [ngValue]="c.id">{{ categorySelectLabel(c) }}</option>
                }
              </select>
            </label>
          </div>
        </div>
        <footer class="ts-form-modal__footer">
          <button type="button" class="pos-btn pos-btn--ghost" (click)="closeForm()">Cancelar</button>
          <button type="button" class="pos-btn pos-btn--primary" [disabled]="saving()" (click)="saveCategory()">
            {{ saving() ? 'Guardando…' : 'Guardar' }}
          </button>
        </footer>
      </section>
    }

    @if (confirmAction()) {
      <div class="ts-modal-backdrop" (click)="cancelConfirm()"></div>
      <section class="ts-confirm-modal" role="alertdialog" aria-modal="true">
        <h3>{{ confirmAction() === 'deactivate' ? 'Inactivar categoría' : 'Activar categoría' }}</h3>
        <p>
          {{
            confirmAction() === 'deactivate'
              ? 'La categoría dejará de estar disponible para nuevos productos.'
              : 'La categoría volverá a estar disponible.'
          }}
        </p>
        <div class="ts-confirm-modal__actions">
          <button type="button" class="pos-btn pos-btn--ghost pos-btn--sm" (click)="cancelConfirm()">Cancelar</button>
          <button type="button" class="pos-btn pos-btn--primary pos-btn--sm" (click)="confirmActionRun()">
            Confirmar
          </button>
        </div>
      </section>
    }
  `,
})
export class PosCategoriasPage implements OnInit {
  private readonly api = inject(PosBackendApiService);
  private readonly toast = inject(PosToastService);

  readonly categories = signal<PosProductCategoryResponse[]>([]);
  readonly mostrarFiltros = signal(false);
  readonly gridNonce = signal(0);
  filterQ = '';
  filterEstado = '';
  readonly appliedQ = signal('');
  readonly appliedEstado = signal('');

  readonly parentOptions = computed(() => {
    const editing = this.editingId();
    return this.categories()
      .filter((c) => c.active && c.id !== editing)
      .sort((a, b) => a.pathLabel.localeCompare(b.pathLabel, 'es'));
  });

  readonly gridRows = computed(() =>
    this.categories()
      .filter((c) => this.matchesFilters(c))
      .map((c) => ({ ...c }) as Record<string, unknown>),
  );

  readonly columns: ColumnDefinition[] = [
    {
      title: '',
      field: 'id',
      width: 82,
      headerSort: false,
      hozAlign: 'center',
      formatter: (cell) => this.categoryActionsMenu(cell),
    },
    {
      title: 'Ruta',
      field: 'pathLabel',
      minWidth: 220,
      formatter: (cell) => tabulatorTextareaCell(tabulatorCellValue(cell)),
    },
    { title: 'Código', field: 'code', width: 110, formatter: (cell) => tabulatorTextareaCell(tabulatorCellValue(cell) ?? '—') },
    { title: 'Orden', field: 'sortOrder', width: 80, hozAlign: 'right' },
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
  readonly confirmAction = signal<'deactivate' | 'activate' | null>(null);
  readonly confirmId = signal<string | null>(null);

  draft: PosProductCategoryRequest = this.emptyDraft();

  ngOnInit(): void {
    this.reload();
  }

  categorySelectLabel(c: PosProductCategoryResponse): string {
    const depth = c.pathLabel.includes(' › ') ? c.pathLabel.split(' › ').length - 1 : 0;
    const pad = depth > 0 ? `${'—'.repeat(depth)} ` : '';
    return `${pad}${c.name}`;
  }

  aplicarFiltros(): void {
    this.appliedQ.set(this.filterQ);
    this.appliedEstado.set(this.filterEstado);
    this.bumpGrid();
  }

  limpiarFiltros(): void {
    this.filterQ = '';
    this.filterEstado = '';
    this.aplicarFiltros();
  }

  reload(): void {
    this.api.getProductCategories(true).subscribe({
      next: (rows) => {
        this.categories.set(rows);
        this.bumpGrid();
      },
      error: () => this.toast.error('No se pudieron cargar las categorías'),
    });
  }

  onEmptyAction(action: string): void {
    if (action === 'create') this.openCreate();
  }

  onRowAction(event: { action: string; row: Record<string, unknown> }): void {
    const id = String(event.row['id'] ?? '');
    if (!id) return;
    const row = this.categories().find((c) => c.id === id);
    if (!row) return;
    if (event.action === 'edit') {
      this.openEdit(row);
      return;
    }
    if (event.action === 'deactivate') {
      this.confirmAction.set('deactivate');
      this.confirmId.set(id);
      return;
    }
    if (event.action === 'activate') {
      this.confirmAction.set('activate');
      this.confirmId.set(id);
    }
  }

  openCreate(): void {
    this.editingId.set(null);
    this.draft = this.emptyDraft();
    this.formOpen.set(true);
  }

  openEdit(c: PosProductCategoryResponse): void {
    this.editingId.set(c.id);
    this.draft = {
      name: c.name,
      code: c.code ?? '',
      parentId: c.parentId ?? null,
      sortOrder: c.sortOrder,
      active: c.active,
    };
    this.formOpen.set(true);
  }

  closeForm(): void {
    this.formOpen.set(false);
    this.editingId.set(null);
    this.draft = this.emptyDraft();
  }

  saveCategory(): void {
    if (!this.draft.name.trim()) {
      this.toast.error('Indique el nombre de la categoría');
      return;
    }
    this.saving.set(true);
    const id = this.editingId();
    const body: PosProductCategoryRequest = {
      name: this.draft.name.trim(),
      code: this.draft.code?.trim() || null,
      parentId: this.draft.parentId ?? null,
      sortOrder: Number(this.draft.sortOrder ?? 0),
      active: this.draft.active ?? true,
    };
    const req$ = id ? this.api.putProductCategory(id, body) : this.api.postProductCategory(body);
    req$.pipe(finalize(() => this.saving.set(false))).subscribe({
      next: () => {
        this.toast.success('Categoría guardada');
        this.closeForm();
        this.reload();
      },
      error: () => this.toast.error('Error al guardar la categoría'),
    });
  }

  cancelConfirm(): void {
    this.confirmAction.set(null);
    this.confirmId.set(null);
  }

  confirmActionRun(): void {
    const id = this.confirmId();
    const action = this.confirmAction();
    if (!id || !action) return;
    this.cancelConfirm();
    if (action === 'deactivate') {
      this.api.deleteProductCategory(id).subscribe({
        next: () => {
          this.toast.success('Categoría inactivada');
          this.reload();
        },
        error: () => this.toast.error('No se pudo inactivar la categoría'),
      });
      return;
    }
    this.api.activateProductCategory(id).subscribe({
      next: () => {
        this.toast.success('Categoría activada');
        this.reload();
      },
      error: () => this.toast.error('No se pudo activar la categoría'),
    });
  }

  private matchesFilters(c: PosProductCategoryResponse): boolean {
    const q = this.appliedQ().trim().toLowerCase();
    const estado = this.appliedEstado();
    if (estado === 'ACTIVO' && !c.active) return false;
    if (estado === 'INACTIVO' && c.active) return false;
    if (!q) return true;
    return `${c.name} ${c.code ?? ''} ${c.pathLabel}`.toLowerCase().includes(q);
  }

  private estadoBadge(active: boolean): string {
    const label = active ? 'Activo' : 'Inactivo';
    const cls = active ? 'pos-badge pos-badge--ok' : 'pos-badge pos-badge--muted';
    return `<span class="${cls}">${escapeHtml(label)}</span>`;
  }

  private categoryActionsMenu(cell: unknown): string {
    const row = (cell as { getRow: () => { getData: () => Record<string, unknown> } }).getRow().getData();
    const active = row['active'] === true;
    const actions: GridActionItem[] = [{ action: 'edit', label: 'Editar', icon: 'edit' }];
    if (active) {
      actions.push({ action: 'deactivate', label: 'Inactivar', icon: 'inactivate', danger: true });
    } else {
      actions.push({ action: 'activate', label: 'Activar', icon: 'activate' });
    }
    return gridActionsMenu(actions);
  }

  private bumpGrid(): void {
    this.gridNonce.update((n) => n + 1);
  }

  private emptyDraft(): PosProductCategoryRequest {
    return { name: '', code: '', parentId: null, sortOrder: 0, active: true };
  }
}
