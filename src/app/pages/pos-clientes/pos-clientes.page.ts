import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { ColumnDefinition } from 'tabulator-tables';
import { finalize } from 'rxjs';
import { PosBackendApiService } from '../../core/api/pos-backend-api.service';
import type { PosCustomerResponse } from '../../core/api/pos-backend.types';
import {
  applyTipoIdentificacionDefaults,
  buildCustomerRequest,
  CONSUMIDOR_FINAL_ID,
  customerFormFromResponse,
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
import { gridActionsMenu } from '../../shared/grid/grid-actions.util';
import { PosTabulatorLocalGridComponent } from '../../shared/grid/pos-tabulator-local-grid.component';
import { escapeHtml, tabulatorCellValue, tabulatorTextareaCell } from '../../shared/grid/tabulator-formatters.util';
import { PosPageLayoutComponent } from '../../shared/pos-page-layout.component';

const TIPO_ID_LABEL: Record<string, string> = {
  '04': 'RUC',
  '05': 'Cédula',
  '06': 'Pasaporte',
  '07': 'Consumidor final',
};

@Component({
  selector: 'pos-clientes-page',
  standalone: true,
  imports: [CommonModule, FormsModule, PosPageLayoutComponent, PosTabulatorLocalGridComponent],
  host: { class: 'pos-page-host' },
  template: `
    <pos-page-layout
      eyebrow="Maestros"
      title="Clientes"
      subtitle="Maestro de clientes para ventas y facturación electrónica."
      icon="clientes">
      <div page-actions class="pos-page-actions-group">
        <button type="button" class="pos-btn pos-btn--primary" (click)="openCreate()">Agregar</button>
        <button type="button" class="pos-btn pos-btn--outline" (click)="mostrarFiltros.set(!mostrarFiltros())">
          {{ mostrarFiltros() ? 'Ocultar filtros' : 'Ver filtros' }}
        </button>
        <button type="button" class="pos-btn pos-btn--soft" (click)="aplicarFiltros()">Buscar</button>
        @if (mostrarFiltros()) {
          <button type="button" class="pos-btn pos-btn--outline" (click)="limpiarFiltros()">Limpiar</button>
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
              <input [(ngModel)]="filterQ" name="filterQ" placeholder="Razón social, identificación o correo" (keyup.enter)="aplicarFiltros()" />
            </label>
            <label class="pos-maestro-filter">
              <span>Tipo ID</span>
              <select [(ngModel)]="filterTipo" name="filterTipo">
                <option value="">Todos</option>
                <option value="04">RUC</option>
                <option value="05">Cédula</option>
                <option value="06">Pasaporte</option>
                <option value="07">Consumidor final</option>
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
        emptyContext="customers"
        (rowAction)="onRowAction($event)"
        (emptyAction)="onEmptyAction($event)" />
    </pos-page-layout>

    @if (formOpen()) {
      <div class="ts-modal-backdrop" (click)="closeForm()"></div>
      <section class="ts-form-modal ts-form-modal--wide" role="dialog" aria-modal="true">
        <header class="ts-form-modal__header">
          <div class="ts-form-modal__icon" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <circle cx="9" cy="8" r="3" stroke="currentColor" stroke-width="1.5" />
              <path d="M3 19c0-3 2.5-5 6-5s6 2 6 5" stroke="currentColor" stroke-width="1.5" />
            </svg>
          </div>
          <div class="ts-form-modal__head-text">
            <p class="ts-form-modal__eyebrow">Maestros</p>
            <h3>{{ editingId() ? 'Editar cliente' : 'Nuevo cliente' }}</h3>
            <p class="ts-form-modal__subtitle">Datos según tipo de identificación para facturación electrónica.</p>
          </div>
          <button type="button" class="ts-form-modal__close" aria-label="Cerrar" (click)="closeForm()">×</button>
        </header>
        <div class="ts-form-modal__body">
          <div class="pos-form-grid">
            <label class="pos-form-field" [class.pos-form-field--invalid]="formErrors().tipoIdentificacion">
              <span>Tipo identificación</span>
              <select [(ngModel)]="draft.tipoIdentificacion" name="tipoIdentificacion" (ngModelChange)="onTipoChange()" [disabled]="!!editingId()">
                <option value="04">04 — RUC</option>
                <option value="05">05 — Cédula</option>
                <option value="06">06 — Pasaporte</option>
                <option value="07">07 — Consumidor final</option>
              </select>
              @if (formErrors().tipoIdentificacion) {
                <small class="pos-form-field__error">{{ formErrors().tipoIdentificacion }}</small>
              }
            </label>

            <label class="pos-form-field" [class.pos-form-field--invalid]="formErrors().identificacion">
              <span>{{ idLabel() }}</span>
              <div class="pos-form-field__inline">
                <input
                  [(ngModel)]="draft.identificacion"
                  name="identificacion"
                  [readonly]="isConsumidorFinal() || !!editingId()"
                  [attr.inputmode]="idInputMode()"
                  [maxlength]="idMaxLength()"
                  (input)="onIdentificacionInput()"
                  [placeholder]="idPlaceholder()" />
                @if (canConsultarCatastro()) {
                  <button
                    type="button"
                    class="pos-btn pos-btn--soft pos-form-field__action"
                    [disabled]="catastroLoading()"
                    (click)="consultarCatastro()">
                    {{ catastroLoading() ? '…' : 'Consultar' }}
                  </button>
                }
              </div>
              @if (formErrors().identificacion) {
                <small class="pos-form-field__error">{{ formErrors().identificacion }}</small>
              }
            </label>

            @if (isRuc()) {
              <label class="pos-form-field pos-form-field--span2" [class.pos-form-field--invalid]="formErrors().razonSocial">
                <span>Razón social</span>
                <input [(ngModel)]="draft.razonSocial" name="razonSocial" maxlength="300" placeholder="Razón social registrada" />
                @if (formErrors().razonSocial) {
                  <small class="pos-form-field__error">{{ formErrors().razonSocial }}</small>
                }
              </label>
              <label class="pos-form-field pos-form-field--span2" [class.pos-form-field--invalid]="formErrors().nombreComercial">
                <span>Nombre comercial</span>
                <input [(ngModel)]="draft.nombreComercial" name="nombreComercial" maxlength="300" placeholder="Nombre comercial o marca" />
                @if (formErrors().nombreComercial) {
                  <small class="pos-form-field__error">{{ formErrors().nombreComercial }}</small>
                }
              </label>
            } @else if (isPersona()) {
              <label class="pos-form-field" [class.pos-form-field--invalid]="formErrors().nombres">
                <span>Nombres</span>
                <input [(ngModel)]="draft.nombres" name="nombres" maxlength="150" placeholder="Nombres" />
                @if (formErrors().nombres) {
                  <small class="pos-form-field__error">{{ formErrors().nombres }}</small>
                }
              </label>
              <label class="pos-form-field" [class.pos-form-field--invalid]="formErrors().apellidos">
                <span>Apellidos</span>
                <input [(ngModel)]="draft.apellidos" name="apellidos" maxlength="150" placeholder="Apellidos" />
                @if (formErrors().apellidos) {
                  <small class="pos-form-field__error">{{ formErrors().apellidos }}</small>
                }
              </label>
              <label class="pos-form-field pos-form-field--span2" [class.pos-form-field--invalid]="formErrors().nombreComercial">
                <span>Nombre comercial</span>
                <input [(ngModel)]="draft.nombreComercial" name="nombreComercialAlias" maxlength="300" placeholder="Alias o nombre comercial (opcional)" />
                @if (formErrors().nombreComercial) {
                  <small class="pos-form-field__error">{{ formErrors().nombreComercial }}</small>
                }
              </label>
            } @else {
              <label class="pos-form-field pos-form-field--span2" [class.pos-form-field--invalid]="formErrors().razonSocial">
                <span>Nombre</span>
                <input [(ngModel)]="draft.razonSocial" name="razonSocialCf" maxlength="300" placeholder="Nombre del consumidor final" />
                @if (formErrors().razonSocial) {
                  <small class="pos-form-field__error">{{ formErrors().razonSocial }}</small>
                }
              </label>
            }

            <label class="pos-form-field pos-form-field--span2" [class.pos-form-field--invalid]="formErrors().direccion">
              <span>Dirección{{ direccionObligatoria() ? '' : ' (opcional)' }}</span>
              <input [(ngModel)]="draft.direccion" name="direccion" maxlength="500" placeholder="Calle principal, número, ciudad" />
              @if (formErrors().direccion) {
                <small class="pos-form-field__error">{{ formErrors().direccion }}</small>
              }
            </label>

            <label class="pos-form-field" [class.pos-form-field--invalid]="formErrors().phone">
              <span>Teléfono</span>
              <input [(ngModel)]="draft.phone" name="phone" maxlength="20" placeholder="Ej. 0991234567" inputmode="tel" />
              @if (formErrors().phone) {
                <small class="pos-form-field__error">{{ formErrors().phone }}</small>
              }
            </label>

            <label class="pos-form-field" [class.pos-form-field--invalid]="formErrors().email">
              <span>Correo</span>
              <input type="email" [(ngModel)]="draft.email" name="email" maxlength="200" placeholder="correo@ejemplo.com" />
              @if (formErrors().email) {
                <small class="pos-form-field__error">{{ formErrors().email }}</small>
              }
            </label>
          </div>
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
export class PosClientesPage implements OnInit {
  private readonly api = inject(PosBackendApiService);

  readonly customers = signal<PosCustomerResponse[]>([]);
  readonly mostrarFiltros = signal(false);
  readonly gridNonce = signal(0);
  filterQ = '';
  filterTipo = '';
  filterEstado = '';
  readonly appliedQ = signal('');
  readonly appliedTipo = signal('');
  readonly appliedEstado = signal('');

  readonly gridRows = computed(() =>
    this.customers()
      .filter((c) => this.matchesFilters(c))
      .map((c) => ({
        ...c,
        tipoLabel: TIPO_ID_LABEL[c.tipoIdentificacion] ?? c.tipoIdentificacion,
        displayName: c.nombreComercial?.trim() || c.razonSocial,
      }) as Record<string, unknown>),
  );

  readonly columns: ColumnDefinition[] = [
    {
      title: '',
      field: 'id',
      width: 82,
      headerSort: false,
      hozAlign: 'center',
      formatter: () => gridActionsMenu([{ action: 'edit', label: 'Editar', icon: 'edit' }]),
    },
    { title: 'Tipo', field: 'tipoLabel', width: 120 },
    { title: 'Identificación', field: 'identificacion', minWidth: 140, formatter: (cell) => tabulatorTextareaCell(tabulatorCellValue(cell)) },
    { title: 'Nombre / Razón social', field: 'displayName', minWidth: 220, formatter: (cell) => tabulatorTextareaCell(tabulatorCellValue(cell)) },
    { title: 'Dirección', field: 'direccion', minWidth: 180, formatter: (cell) => tabulatorTextareaCell(tabulatorCellValue(cell) ?? '—') },
    { title: 'Teléfono', field: 'phone', minWidth: 120, formatter: (cell) => tabulatorTextareaCell(tabulatorCellValue(cell) ?? '—') },
    { title: 'Correo', field: 'email', minWidth: 180, formatter: (cell) => tabulatorTextareaCell(tabulatorCellValue(cell) ?? '—') },
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
  readonly catastroLoading = signal(false);
  readonly message = signal<string | null>(null);
  readonly messageIsError = signal(false);
  readonly formErrors = signal<PosCustomerFormErrors>({});

  draft: PosCustomerFormState = emptyCustomerForm();

  ngOnInit(): void {
    this.reload();
  }

  isRuc(): boolean {
    return isRucTipo(this.draft.tipoIdentificacion);
  }

  isPersona(): boolean {
    return isPersonaNaturalTipo(this.draft.tipoIdentificacion);
  }

  isConsumidorFinal(): boolean {
    return isConsumidorFinalTipo(this.draft.tipoIdentificacion);
  }

  idLabel(): string {
    return identificacionLabel(this.draft.tipoIdentificacion);
  }

  idMaxLength(): number {
    return identificacionMaxLength(this.draft.tipoIdentificacion);
  }

  idInputMode(): string {
    return identificacionInputMode(this.draft.tipoIdentificacion);
  }

  idPlaceholder(): string {
    if (this.isRuc()) return '13 dígitos';
    if (this.draft.tipoIdentificacion === '05') return '10 dígitos';
    if (this.isConsumidorFinal()) return CONSUMIDOR_FINAL_ID;
    return 'Número de pasaporte';
  }

  direccionObligatoria(): boolean {
    return direccionRequired(this.draft.tipoIdentificacion);
  }

  onTipoChange(): void {
    applyTipoIdentificacionDefaults(this.draft);
    this.formErrors.set({});
  }

  onIdentificacionInput(): void {
    if (this.isRuc() || this.draft.tipoIdentificacion === '05') {
      this.draft.identificacion = this.draft.identificacion.replace(/\D/g, '').slice(0, this.idMaxLength());
    }
  }

  canConsultarCatastro(): boolean {
    return !this.editingId() && (this.isRuc() || this.draft.tipoIdentificacion === '05');
  }

  consultarCatastro(): void {
    const id = this.draft.identificacion.trim();
    if (this.isRuc()) {
      if (!/^\d{13}$/.test(id)) {
        this.setMessage('Ingrese un RUC de 13 dígitos', true);
        return;
      }
      this.catastroLoading.set(true);
      this.api.consultarRuc(id).subscribe({
        next: (res) => {
          this.catastroLoading.set(false);
          if (!res.encontrado) {
            this.setMessage('RUC no encontrado en el SRI', true);
            return;
          }
          applyRucConsultaToForm(this.draft, res);
          const stale = res.obsoleto ? ' (datos en caché)' : '';
          this.setMessage(`Datos del SRI cargados${stale}`, false);
        },
        error: () => {
          this.catastroLoading.set(false);
          this.setMessage('No se pudo consultar el RUC. Verifique la conexión con api-sri.', true);
        },
      });
      return;
    }
    if (this.draft.tipoIdentificacion === '05') {
      if (!/^\d{10}$/.test(id)) {
        this.setMessage('Ingrese una cédula de 10 dígitos', true);
        return;
      }
      this.catastroLoading.set(true);
      this.api.consultarCedula(id).subscribe({
        next: (res) => {
          this.catastroLoading.set(false);
          if (!res.encontrado || !res.nombres?.trim()) {
            this.setMessage('Cédula no encontrada', true);
            return;
          }
          applyCedulaConsultaToForm(this.draft, res);
          const stale = res.obsoleto ? ' (datos en caché)' : '';
          this.setMessage(`Datos de cédula cargados${stale}`, false);
        },
        error: () => {
          this.catastroLoading.set(false);
          this.setMessage('No se pudo consultar la cédula. Verifique la conexión con api-sri.', true);
        },
      });
    }
  }

  aplicarFiltros(): void {
    this.appliedQ.set(this.filterQ);
    this.appliedTipo.set(this.filterTipo);
    this.appliedEstado.set(this.filterEstado);
    this.bumpGrid();
  }

  limpiarFiltros(): void {
    this.filterQ = '';
    this.filterTipo = '';
    this.filterEstado = '';
    this.aplicarFiltros();
  }

  reload(): void {
    this.api.getCustomers().subscribe({
      next: (rows) => {
        this.customers.set(rows);
        this.bumpGrid();
      },
      error: () => this.setMessage('No se pudieron cargar los clientes', true),
    });
  }

  onEmptyAction(action: string): void {
    if (action === 'create') {
      this.openCreate();
    }
  }

  onRowAction(event: { action: string; row: Record<string, unknown> }): void {
    const id = String(event.row['id'] ?? '');
    if (!id || event.action !== 'edit') return;
    const c = this.customers().find((x) => x.id === id);
    if (c) this.openEdit(c);
  }

  openCreate(): void {
    this.editingId.set(null);
    this.draft = emptyCustomerForm('05');
    this.formErrors.set({});
    this.formOpen.set(true);
  }

  openEdit(c: PosCustomerResponse): void {
    this.editingId.set(c.id);
    this.draft = customerFormFromResponse(c);
    this.formErrors.set({});
    this.formOpen.set(true);
  }

  closeForm(): void {
    this.formOpen.set(false);
    this.editingId.set(null);
    this.draft = emptyCustomerForm();
    this.formErrors.set({});
  }

  save(): void {
    const errors = validateCustomerForm(this.draft);
    this.formErrors.set(errors);
    if (hasCustomerFormErrors(errors)) {
      this.setMessage('Revise los campos marcados en el formulario', true);
      return;
    }

    this.saving.set(true);
    const body = buildCustomerRequest(this.draft);
    const id = this.editingId();
    const req$ = id ? this.api.putCustomer(id, body) : this.api.postCustomer(body);
    req$.pipe(finalize(() => this.saving.set(false))).subscribe({
      next: () => {
        this.setMessage('Cliente guardado', false);
        this.closeForm();
        this.reload();
      },
      error: (err: unknown) => {
        const msg = this.extractApiError(err) ?? 'Error al guardar cliente';
        this.setMessage(msg, true);
      },
    });
  }

  private extractApiError(err: unknown): string | null {
    if (!err || typeof err !== 'object') return null;
    const e = err as { error?: { message?: string }; message?: string };
    return e.error?.message ?? e.message ?? null;
  }

  private matchesFilters(c: PosCustomerResponse): boolean {
    const q = this.appliedQ().trim().toLowerCase();
    const tipo = this.appliedTipo();
    const estado = this.appliedEstado();
    if (tipo && c.tipoIdentificacion !== tipo) return false;
    if (estado === 'ACTIVO' && !c.active) return false;
    if (estado === 'INACTIVO' && c.active) return false;
    if (!q) return true;
    return `${c.razonSocial} ${c.nombreComercial ?? ''} ${c.identificacion} ${c.email ?? ''} ${c.direccion ?? ''}`
      .toLowerCase()
      .includes(q);
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
}
