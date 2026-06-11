import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { ColumnDefinition } from 'tabulator-tables';
import { finalize } from 'rxjs';
import { PosBackendApiService } from '../../core/api/pos-backend-api.service';
import type {
  PosImportKind,
  PosImportLineResult,
  PosImportPreviewResult,
  PosImportPreset,
  PosImportResult,
} from '../../core/api/pos-backend.types';
import { extractApiErrorMessage } from '../../core/http-error.util';
import { PosToastService } from '../../core/ui/pos-toast.service';
import { PosTabulatorLocalGridComponent } from '../../shared/grid/pos-tabulator-local-grid.component';
import { escapeHtml, tabulatorCellValue, tabulatorTextareaCell } from '../../shared/grid/tabulator-formatters.util';
import { PosPageLayoutComponent } from '../../shared/pos-page-layout.component';

type MigracionPaso = 1 | 2 | 3 | 4 | 5;

interface MigracionTipoConfig {
  kind: PosImportKind;
  titulo: string;
  descripcion: string;
  plantillaNombre: string;
  obligatorias: string[];
  opcionales: string[];
  ejemplo: string;
  claveUpsert: string;
  tips: string[];
}

const TIPOS: MigracionTipoConfig[] = [
  {
    kind: 'products',
    titulo: 'Productos',
    descripcion: 'Catálogo de venta: SKU, precio, categoría e impuestos.',
    plantillaNombre: 'plantilla-productos-pos.xlsx',
    obligatorias: ['sku', 'nombre', 'precio'],
    opcionales: ['codigo_barras', 'descripcion', 'categoria_codigo', 'etiqueta', 'iva_codigo', 'ref_externa'],
    ejemplo: 'PROD-001;Arroz premium 1kg;1.25;7890123456789;Arroz de grano largo;ALIMENTOS;Retail;4;ERP-1001',
    claveUpsert: 'Si el SKU ya existe, se actualiza el producto.',
    tips: [
      'La plantilla Excel incluye comentarios en cada columna (pase el mouse sobre el encabezado).',
      'codigo_barras y sku van como Texto — evita que Excel los convierta a 7,89E+12.',
      'precio = lista principal; columnas precio_* = listas adicionales de su empresa.',
      'iva_codigo: 4 = 15 % IVA (por defecto si se omite).',
      'categoria_codigo debe existir antes de importar (Catálogo → Categorías: ALIMENTOS, BEBIDAS, etc.).',
    ],
  },
  {
    kind: 'customers',
    titulo: 'Clientes',
    descripcion: 'Maestro de clientes para ventas y facturación electrónica.',
    plantillaNombre: 'plantilla-clientes-pos.xlsx',
    obligatorias: ['tipo_identificacion', 'identificacion', 'razon_social'],
    opcionales: ['nombre_comercial', 'direccion', 'email', 'telefono'],
    ejemplo: '05;0912345678;Juan Pérez García;Juan PG;Av. Principal 123;juan@correo.com;0991234567',
    claveUpsert: 'Si la identificación ya existe, se actualiza el cliente.',
    tips: [
      'Plantilla Excel con comentarios en cada columna (tooltip en el encabezado).',
      'tipo_identificacion e identificacion como Texto (04 RUC, 05 Cédula, 06 Pasaporte, 07 CF).',
      'Máximo 2.000 filas por archivo.',
    ],
  },
];

const COL_LABELS: Record<string, string> = {
  sku: 'SKU / Código',
  nombre: 'Nombre',
  precio: 'Precio',
  codigo_barras: 'Código de barras',
  descripcion: 'Descripción',
  categoria_codigo: 'Categoría (código)',
  etiqueta: 'Etiqueta',
  iva_codigo: 'IVA (código)',
  ref_externa: 'Ref. externa',
  tipo_identificacion: 'Tipo identificación',
  identificacion: 'Identificación',
  razon_social: 'Razón social',
  nombre_comercial: 'Nombre comercial',
  direccion: 'Dirección',
  email: 'Correo',
  telefono: 'Teléfono',
};

@Component({
  selector: 'pos-migracion-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, PosPageLayoutComponent, PosTabulatorLocalGridComponent],
  host: { class: 'pos-page-host' },
  template: `
    <pos-page-layout
      eyebrow="Maestros"
      title="Centro de migración"
      subtitle="Importe desde Excel o CSV. Elija el origen, revise la vista previa y confirme."
      icon="migracion">

      <nav class="pos-mig-steps" aria-label="Pasos de migración">
        @for (s of stepLabels; track s.n) {
          <div
            class="pos-mig-steps__item"
            [class.pos-mig-steps__item--done]="paso() > s.n"
            [class.pos-mig-steps__item--active]="paso() === s.n">
            <span class="pos-mig-steps__n">{{ s.n }}</span>
            <span class="pos-mig-steps__label">{{ s.label }}</span>
          </div>
        }
      </nav>

      @if (message(); as msg) {
        <div
          class="pos-mig-alert"
          [class.pos-mig-alert--err]="messageIsError()"
          [class.pos-mig-alert--ok]="!messageIsError()"
          role="alert"
          aria-live="polite">
          <div class="pos-mig-alert__icon" aria-hidden="true">
            @if (messageIsError()) {
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.6" />
                <path d="M12 8v5M12 16h.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
              </svg>
            } @else {
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.6" />
                <path d="M8 12.5l2.5 2.5L16 9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            }
          </div>
          <div class="pos-mig-alert__body">
            <strong class="pos-mig-alert__title">{{ messageTitle() }}</strong>
            <p class="pos-mig-alert__text">{{ msg }}</p>
          </div>
          <button type="button" class="pos-mig-alert__close" (click)="clearMessage()" aria-label="Cerrar aviso">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M8 8l8 8M16 8l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
            </svg>
          </button>
        </div>
      }

      <div class="pos-mig-flow">
      @switch (paso()) {
        @case (1) {
          <section class="pos-mig-panel">
            <header class="pos-mig-panel__head">
              <h2 class="pos-mig-panel__title">¿Qué desea migrar?</h2>
              <p class="pos-mig-panel__hint">Elija el tipo de datos. En el siguiente paso indicará de dónde provienen.</p>
            </header>
            <div class="pos-mig-tipo-grid pos-mig-tipo-grid--pick">
              @for (t of tipos; track t.kind) {
                <button
                  type="button"
                  class="pos-mig-tipo-card pos-focus-ring"
                  [class.pos-mig-tipo-card--on]="kind() === t.kind"
                  (click)="seleccionarTipo(t.kind)">
                  <span class="pos-mig-tipo-card__icon" aria-hidden="true">
                    @if (t.kind === 'products') {
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                        <rect x="4" y="4" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.5" />
                        <rect x="14" y="4" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.5" />
                        <rect x="4" y="14" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.5" />
                        <rect x="14" y="14" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.5" />
                      </svg>
                    } @else {
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                        <circle cx="9" cy="8" r="3" stroke="currentColor" stroke-width="1.5" />
                        <path d="M3 19c0-3 2.5-5 6-5s6 2 6 5" stroke="currentColor" stroke-width="1.5" />
                        <circle cx="17" cy="9" r="2.5" stroke="currentColor" stroke-width="1.5" />
                        <path d="M14 19c.3-2 1.8-3.5 4-3.5" stroke="currentColor" stroke-width="1.5" />
                      </svg>
                    }
                  </span>
                  <strong>{{ t.titulo }}</strong>
                  <span>{{ t.descripcion }}</span>
                </button>
              }
            </div>
            <footer class="pos-mig-panel__footer">
              <button type="button" class="pos-btn pos-btn--soft" [disabled]="!puedeAvanzar()" (click)="avanzar()">Siguiente</button>
            </footer>
          </section>
        }
        @case (2) {
          <section class="pos-mig-panel">
            <header class="pos-mig-panel__head">
              <h2 class="pos-mig-panel__title">Origen de los datos</h2>
              <p class="pos-mig-panel__hint">Seleccione el sistema del que exportó. Luxora ofrece plantilla lista; otros orígenes usan mapeo automático.</p>
            </header>

            <div class="pos-mig-preset-grid">
              @for (p of presetsFiltrados(); track p.id) {
                <button
                  type="button"
                  class="pos-mig-preset-card pos-focus-ring"
                  [class.pos-mig-preset-card--on]="presetId() === p.id"
                  (click)="seleccionarPreset(p)">
                  <span class="pos-mig-preset-card__radio" aria-hidden="true"></span>
                  <span class="pos-mig-preset-card__body">
                    <strong>{{ p.nombre }}</strong>
                    <span>{{ p.descripcion }}</span>
                  </span>
                </button>
              }
            </div>

            <div class="pos-mig-guide">
              <div class="pos-mig-guide__toolbar">
                <div class="pos-mig-guide__selected">
                  <span class="pos-mig-guide__kicker">Origen activo</span>
                  <strong>{{ presetNombre() }}</strong>
                </div>
                @if (esPlantillaLuxora()) {
                  <button type="button" class="pos-btn pos-btn--primary" [disabled]="downloading()" (click)="descargarPlantilla()">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M12 4v10M12 14l-4-4M12 14l4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
                      <path d="M5 18h14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
                    </svg>
                    {{ downloading() ? 'Descargando…' : 'Descargar plantilla' }}
                  </button>
                } @else {
                  <p class="pos-mig-guide__hint">Al cargar el archivo podrá revisar y ajustar el mapeo de columnas.</p>
                }
              </div>

              <div class="pos-mig-guide__cols">
                <div class="pos-mig-guide__group">
                  <h3>Columnas obligatorias</h3>
                  <div class="pos-mig-chips">
                    @for (c of config().obligatorias; track c) {
                      <span class="pos-mig-chip pos-mig-chip--req" [title]="colLabel(c)">
                        <code>{{ c }}</code>
                        <em>{{ colLabel(c) }}</em>
                      </span>
                    }
                  </div>
                </div>
                <div class="pos-mig-guide__group">
                  <h3>Columnas opcionales</h3>
                  <div class="pos-mig-chips pos-mig-chips--soft">
                    @for (c of config().opcionales; track c) {
                      <span class="pos-mig-chip" [title]="colLabel(c)">
                        <code>{{ c }}</code>
                      </span>
                    }
                  </div>
                </div>
              </div>

              <p class="pos-mig-guide__upsert">{{ config().claveUpsert }}</p>
              <ul class="pos-mig-tips pos-mig-tips--compact">
                @for (tip of config().tips; track tip) {
                  <li>{{ tip }}</li>
                }
              </ul>
            </div>

            <footer class="pos-mig-panel__footer">
              <button type="button" class="pos-btn pos-btn--outline" (click)="retroceder()">Atrás</button>
              <button type="button" class="pos-btn pos-btn--soft" (click)="avanzar()">Siguiente</button>
            </footer>
          </section>
        }
        @case (3) {
          <section class="pos-mig-panel">
            <header class="pos-mig-panel__head">
              <h2 class="pos-mig-panel__title">Subir archivo</h2>
              <p class="pos-mig-panel__hint">
                CSV o Excel (.xlsx) · origen <strong>{{ presetNombre() }}</strong> · máx. 2.000 filas
              </p>
            </header>
            <div
              class="pos-mig-dropzone pos-focus-ring"
              [class.pos-mig-dropzone--over]="dragOver()"
              [class.pos-mig-dropzone--has]="!!file()"
              (dragover)="onDragOver($event)"
              (dragleave)="dragOver.set(false)"
              (drop)="onDrop($event)"
              (click)="fileInput.click()"
              role="button"
              tabindex="0"
              (keydown.enter)="fileInput.click()"
              (keydown.space)="onDropzoneKey($event)">
              <input
                #fileInput
                type="file"
                class="pos-mig-dropzone__input"
                accept=".csv,.txt,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                (change)="onFileSelected($event)" />
              @if (file()) {
                <strong>{{ file()!.name }}</strong>
                <span>{{ formatBytes(file()!.size) }}</span>
                <button type="button" class="pos-btn pos-btn--outline pos-mig-dropzone__clear" (click)="clearFile($event)">
                  Quitar
                </button>
              } @else {
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M12 16V4M12 4l-4 4M12 4l4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                  <path d="M4 18v2a2 2 0 002 2h12a2 2 0 002-2v-2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                </svg>
                <strong>Suelte el archivo aquí</strong>
                <span>CSV o Excel (.xlsx) · máx. 2.000 filas</span>
              }
            </div>
            <footer class="pos-mig-panel__footer">
              <button type="button" class="pos-btn pos-btn--outline" (click)="retroceder()">Atrás</button>
              <button
                type="button"
                class="pos-btn pos-btn--soft"
                [disabled]="!file() || previewing()"
                (click)="avanzar()">
                {{ previewing() ? 'Analizando…' : 'Analizar archivo' }}
              </button>
            </footer>
          </section>
        }
        @case (4) {
          <section class="pos-mig-panel">
            <header class="pos-mig-panel__head">
              <h2 class="pos-mig-panel__title">Vista previa y mapeo</h2>
              <p class="pos-mig-panel__hint">Revise el resumen, ajuste columnas si hace falta y confirme la importación.</p>
            </header>
            @if (preview(); as pv) {
              <div class="pos-mig-summary">
                <div class="pos-mig-summary__metric">
                  <span>Filas</span>
                  <strong>{{ pv.totalFilas }}</strong>
                </div>
                <div class="pos-mig-summary__metric pos-mig-summary__metric--ok">
                  <span>Válidas</span>
                  <strong>{{ pv.filasValidas }}</strong>
                </div>
                <div class="pos-mig-summary__metric" [class.pos-mig-summary__metric--err]="pv.filasConError > 0">
                  <span>Con error</span>
                  <strong>{{ pv.filasConError }}</strong>
                </div>
                <div class="pos-mig-summary__metric pos-mig-summary__metric--ok">
                  <span>A crear</span>
                  <strong>{{ pv.estimadoCrear }}</strong>
                </div>
                <div class="pos-mig-summary__metric pos-mig-summary__metric--ok">
                  <span>A actualizar</span>
                  <strong>{{ pv.estimadoActualizar }}</strong>
                </div>
              </div>

              @if (!pv.mapeoCompleto) {
                <p class="pos-mig-warn">
                  Asigne las columnas obligatorias faltantes: {{ pv.columnasFaltantes.join(', ') }}
                </p>
              }

              @if (resumenErrores(pv.detalles); as resumen) {
                <p class="pos-mig-warn">{{ resumen }}</p>
              }

              <div class="pos-mig-mapping">
                <div class="pos-mig-mapping__head">
                  <h3>Mapeo de columnas</h3>
                  <button type="button" class="pos-btn pos-btn--soft" [disabled]="previewing()" (click)="refrescarPreview()">
                    {{ previewing() ? 'Analizando…' : 'Actualizar vista previa' }}
                  </button>
                </div>
                <p class="pos-mig-panel__hint">
                  Columnas detectadas en su archivo:
                  <code>{{ pv.columnasDetectadas.join(' · ') }}</code>
                </p>
                <div class="pos-mig-mapping__grid">
                  @for (col of columnasMapeo(); track col) {
                    <label class="pos-mig-mapping__row" [class.pos-mig-mapping__row--req]="esObligatoria(col)">
                      <span>
                        {{ colLabel(col) }}
                        @if (esObligatoria(col)) {
                          <em>*</em>
                        }
                        <small><code>{{ col }}</code></small>
                      </span>
                      <select [(ngModel)]="mappingDraft[col]" [name]="'map_' + col" (ngModelChange)="onMappingChange()">
                        <option value="">— Sin asignar —</option>
                        @for (h of pv.columnasDetectadas; track h) {
                          <option [value]="h">{{ h }}</option>
                        }
                      </select>
                    </label>
                  }
                </div>
              </div>

              @if (pv.muestra.length) {
                <h3 class="pos-mig-subtitle">Muestra (primeras filas)</h3>
                <pos-tabulator-local-grid
                  [data]="asGridData(pv.muestra)"
                  [columns]="muestraColumns()"
                  height="220px"
                  emptyDescription="Sin muestra." />
              }

              @if (pv.detalles.length) {
                <h3 class="pos-mig-subtitle">Validación por fila</h3>
                <pos-tabulator-local-grid
                  [data]="asGridData(pv.detalles)"
                  [columns]="previewColumns"
                  height="min(320px, calc(100vh - 28rem))"
                  emptyDescription="Sin detalle." />
              }

              <footer class="pos-mig-panel__footer">
                <button type="button" class="pos-btn pos-btn--outline" (click)="retroceder()">Atrás</button>
                <button
                  type="button"
                  class="pos-btn pos-btn--primary"
                  [disabled]="importing() || !pv.mapeoCompleto || pv.filasValidas === 0"
                  (click)="ejecutarImportacion()">
                  {{ importing() ? 'Importando…' : 'Confirmar importación' }}
                </button>
              </footer>
            }
          </section>
        }
        @case (5) {
          <section class="pos-mig-panel">
            <header class="pos-mig-panel__head">
              <h2 class="pos-mig-panel__title">Resultado</h2>
              <p class="pos-mig-panel__hint">Resumen de la importación. Puede iniciar otra carga o ir al maestro.</p>
            </header>
            @if (result(); as res) {
              <div class="pos-mig-summary" [class.pos-mig-summary--warn]="res.errores > 0">
                <div class="pos-mig-summary__metric">
                  <span>Filas procesadas</span>
                  <strong>{{ res.totalFilas }}</strong>
                </div>
                <div class="pos-mig-summary__metric pos-mig-summary__metric--ok">
                  <span>Creados</span>
                  <strong>{{ res.creados }}</strong>
                </div>
                <div class="pos-mig-summary__metric pos-mig-summary__metric--ok">
                  <span>Actualizados</span>
                  <strong>{{ res.actualizados }}</strong>
                </div>
                <div class="pos-mig-summary__metric" [class.pos-mig-summary__metric--err]="res.errores > 0">
                  <span>Errores</span>
                  <strong>{{ res.errores }}</strong>
                </div>
              </div>
              @if (res.errores === 0) {
                <p class="pos-mig-success">Importación completada sin errores.</p>
              } @else {
                <p class="pos-mig-warn">
                  Las filas válidas ya fueron guardadas.
                  @if (resumenErrores(res.detalles); as resumen) {
                    {{ resumen }}
                  } @else {
                    Revise el detalle por fila abajo.
                  }
                </p>
              }
              @if (res.detalles.length) {
                <pos-tabulator-local-grid
                  [data]="asGridData(res.detalles)"
                  [columns]="resultColumns"
                  height="min(420px, calc(100vh - 22rem))"
                  emptyDescription="Sin detalle de filas." />
              }
              <footer class="pos-mig-panel__footer">
                <button type="button" class="pos-btn pos-btn--outline" (click)="reiniciar()">Nueva importación</button>
                @if (kind() === 'products') {
                  <a routerLink="/catalogo" class="pos-btn pos-btn--soft">Ir al catálogo</a>
                } @else {
                  <a routerLink="/clientes" class="pos-btn pos-btn--soft">Ir a clientes</a>
                }
              </footer>
            }
          </section>
        }
      }
      </div>
    </pos-page-layout>
  `,
})
export class PosMigracionPage implements OnInit {
  private readonly api = inject(PosBackendApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toast = inject(PosToastService);

  readonly tipos = TIPOS;
  readonly stepLabels = [
    { n: 1 as MigracionPaso, label: 'Tipo' },
    { n: 2 as MigracionPaso, label: 'Origen' },
    { n: 3 as MigracionPaso, label: 'Cargar' },
    { n: 4 as MigracionPaso, label: 'Revisar' },
    { n: 5 as MigracionPaso, label: 'Resultado' },
  ];

  readonly kind = signal<PosImportKind>('products');
  readonly paso = signal<MigracionPaso>(1);
  readonly presetId = signal('luxora');
  readonly presets = signal<PosImportPreset[]>([]);
  readonly file = signal<File | null>(null);
  readonly dragOver = signal(false);
  readonly downloading = signal(false);
  readonly previewing = signal(false);
  readonly importing = signal(false);
  readonly preview = signal<PosImportPreviewResult | null>(null);
  readonly result = signal<PosImportResult | null>(null);
  readonly message = signal('');
  readonly messageIsError = signal(false);

  readonly messageTitle = computed(() => {
    const m = this.message().toLowerCase();
    if (!m) return '';
    if (m.includes('encabezado') || m.includes('columna') || m.includes('mapeo')) {
      return 'Formato del archivo';
    }
    if (m.includes('categoría') || m.includes('categoria')) {
      return 'Categorías del catálogo';
    }
    if (m.includes('permiso') || m.includes('sesión') || m.includes('sesion')) {
      return 'Acceso';
    }
    if (m.includes('conexión') || m.includes('conexion') || m.includes('servidor')) {
      return 'Conexión con el servidor';
    }
    return this.messageIsError() ? 'Revisar antes de continuar' : 'Todo correcto';
  });

  mappingDraft: Record<string, string> = {};

  readonly config = computed(() => TIPOS.find((t) => t.kind === this.kind()) ?? TIPOS[0]);

  readonly presetsFiltrados = computed(() =>
    this.presets().filter((p) => p.kind === 'both' || p.kind === this.kind()),
  );

  readonly presetNombre = computed(() => {
    const p = this.presets().find((x) => x.id === this.presetId());
    return p?.nombre ?? 'Plantilla POS Luxora';
  });

  readonly esPlantillaLuxora = computed(() => this.presetId() === 'luxora');

  readonly columnasMapeo = computed(() => {
    const objetivo = this.preview()?.columnasObjetivo;
    if (objetivo?.length) {
      return objetivo;
    }
    return [...this.config().obligatorias, ...this.config().opcionales];
  });

  readonly previewColumns: ColumnDefinition[] = [
    { title: 'Fila', field: 'fila', width: 72, hozAlign: 'right' },
    {
      title: 'Referencia',
      field: 'referencia',
      minWidth: 120,
      formatter: (cell) => tabulatorTextareaCell(tabulatorCellValue(cell)),
    },
    {
      title: 'Estado',
      field: 'estado',
      width: 130,
      formatter: (cell) => this.estadoPreviewBadge(String(tabulatorCellValue(cell) ?? '')),
    },
    {
      title: 'Mensaje',
      field: 'mensaje',
      minWidth: 200,
      formatter: (cell) => tabulatorTextareaCell(tabulatorCellValue(cell)),
    },
  ];

  readonly resultColumns: ColumnDefinition[] = [
    { title: 'Fila', field: 'fila', width: 72, hozAlign: 'right' },
    {
      title: 'Referencia',
      field: 'referencia',
      minWidth: 120,
      formatter: (cell) => tabulatorTextareaCell(tabulatorCellValue(cell)),
    },
    {
      title: 'Estado',
      field: 'estado',
      width: 130,
      formatter: (cell) => this.estadoResultadoBadge(String(tabulatorCellValue(cell) ?? '')),
    },
    {
      title: 'Mensaje',
      field: 'mensaje',
      minWidth: 200,
      formatter: (cell) => tabulatorTextareaCell(tabulatorCellValue(cell)),
    },
  ];

  ngOnInit(): void {
    this.cargarPresets();
    const tipo = this.route.snapshot.queryParamMap.get('tipo');
    if (tipo === 'productos' || tipo === 'products') {
      this.kind.set('products');
      this.paso.set(2);
    } else if (tipo === 'clientes' || tipo === 'customers') {
      this.kind.set('customers');
      this.paso.set(2);
    }
  }

  muestraColumns(): ColumnDefinition[] {
    return this.columnasMapeo()
      .filter((c) => this.preview()?.muestra.some((row) => row[c]))
      .map((c) => ({
        title: this.colLabel(c),
        field: c,
        minWidth: 100,
        formatter: (cell: unknown) => tabulatorTextareaCell(tabulatorCellValue(cell)),
      }));
  }

  asGridData(rows: PosImportLineResult[] | Record<string, string>[]): Record<string, unknown>[] {
    return rows as unknown as Record<string, unknown>[];
  }

  resumenErrores(detalles: PosImportLineResult[]): string | null {
    const errores = detalles.filter((d) => d.estado === 'ERROR' || d.estado === 'MAPEO');
    if (!errores.length) {
      return null;
    }
    const mensajes = [...new Set(errores.map((e) => e.mensaje).filter(Boolean))];
    if (mensajes.length === 1) {
      const prefijo = errores[0].estado === 'MAPEO' ? '' : `${errores.length} fila(s) con el mismo problema: `;
      return `${prefijo}${mensajes[0]}`;
    }
    const first = errores[0];
    const extra = mensajes.length > 1 ? ` (+${mensajes.length - 1} tipo(s) de error más)` : '';
    return `${errores.length} error(es). Ejemplo fila ${first.fila} (${first.referencia || 'sin ref'}): ${first.mensaje}${extra}`;
  }

  private estadoPreviewBadge(estado: string): string {
    const cls =
      estado === 'ERROR' || estado === 'MAPEO'
        ? 'pos-mig-estado--err'
        : estado === 'CREAR'
          ? 'pos-mig-estado--ok'
          : 'pos-mig-estado--upd';
    return `<span class="pos-mig-estado ${cls}">${escapeHtml(estado)}</span>`;
  }

  private estadoResultadoBadge(estado: string): string {
    const cls =
      estado === 'ERROR' ? 'pos-mig-estado--err' : estado === 'CREADO' ? 'pos-mig-estado--ok' : 'pos-mig-estado--upd';
    return `<span class="pos-mig-estado ${cls}">${escapeHtml(estado)}</span>`;
  }

  colLabel(col: string): string {
    if (col.startsWith('precio_')) {
      return `Precio ${col.replace('precio_', '')}`;
    }
    return COL_LABELS[col] ?? col;
  }

  esObligatoria(col: string): boolean {
    return this.config().obligatorias.includes(col);
  }

  seleccionarTipo(kind: PosImportKind): void {
    this.kind.set(kind);
    this.presetId.set('luxora');
    this.clearState();
    this.cargarPresets();
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tipo: kind === 'products' ? 'productos' : 'clientes' },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  seleccionarPreset(p: PosImportPreset): void {
    this.presetId.set(p.id);
    this.mappingDraft = { ...p.mapeo };
    this.preview.set(null);
  }

  puedeAvanzar(): boolean {
    const p = this.paso();
    if (p === 1 || p === 2) return true;
    if (p === 3) return !!this.file();
    return false;
  }

  avanzar(): void {
    if (!this.puedeAvanzar()) return;
    if (this.paso() === 3) {
      void this.ejecutarPreview(true);
      return;
    }
    this.paso.set(Math.min(5, this.paso() + 1) as MigracionPaso);
  }

  retroceder(): void {
    this.paso.set(Math.max(1, this.paso() - 1) as MigracionPaso);
  }

  reiniciar(): void {
    this.clearState();
    this.presetId.set('luxora');
    this.paso.set(1);
    this.result.set(null);
    void this.router.navigate([], { relativeTo: this.route, queryParams: { tipo: null }, queryParamsHandling: 'merge' });
  }

  descargarPlantilla(): void {
    this.downloading.set(true);
    this.api
      .downloadImportTemplate(this.kind())
      .pipe(finalize(() => this.downloading.set(false)))
      .subscribe({
        next: (blob) => {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = this.config().plantillaNombre;
          a.click();
          URL.revokeObjectURL(url);
          this.toast.success('Plantilla descargada');
        },
        error: () => this.showMsg('No se pudo descargar la plantilla.', true),
      });
  }

  onDragOver(ev: DragEvent): void {
    ev.preventDefault();
    this.dragOver.set(true);
  }

  onDrop(ev: DragEvent): void {
    ev.preventDefault();
    this.dragOver.set(false);
    const f = ev.dataTransfer?.files?.[0];
    if (f) this.assignFile(f);
  }

  onDropzoneKey(ev: Event): void {
    ev.preventDefault();
    (ev.target as HTMLElement).click();
  }

  onFileSelected(ev: Event): void {
    const f = (ev.target as HTMLInputElement).files?.[0];
    if (f) this.assignFile(f);
  }

  clearFile(ev: Event): void {
    ev.stopPropagation();
    this.file.set(null);
    this.preview.set(null);
    this.result.set(null);
  }

  onMappingChange(): void {
    // usuario ajusta selects; refresca con botón
  }

  refrescarPreview(): void {
    void this.ejecutarPreview(false);
  }

  ejecutarImportacion(): void {
    const f = this.file();
    if (!f) {
      this.showMsg('Seleccione un archivo.', true);
      return;
    }
    this.importing.set(true);
    this.message.set('');
    this.api
      .importFromTemplate(this.kind(), f, this.buildEffectiveMapping())
      .pipe(finalize(() => this.importing.set(false)))
      .subscribe({
        next: (res) => {
          this.result.set(res);
          this.paso.set(5);
          if (res.errores === 0) {
            this.toast.success(`Importación lista: ${res.creados} creados, ${res.actualizados} actualizados.`);
          } else {
            this.showMsg(this.resumenErrores(res.detalles) ?? `Importación con ${res.errores} error(es).`, true);
          }
        },
        error: (err: unknown) => this.showMsg(extractApiErrorMessage(err, 'No se pudo importar el archivo.'), true),
      });
  }

  formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  private cargarPresets(): void {
    this.api.getImportPresets(this.kind()).subscribe({
      next: (list) => {
        this.presets.set(list);
        const current = list.find((p) => p.id === this.presetId());
        if (current) {
          this.mappingDraft = { ...current.mapeo };
        }
      },
      error: () => this.presets.set([]),
    });
  }

  private ejecutarPreview(advanceStep: boolean): void {
    const f = this.file();
    if (!f) {
      this.showMsg('Seleccione un archivo.', true);
      return;
    }
    this.previewing.set(true);
    this.message.set('');
    this.api
      .previewImport(this.kind(), f, this.buildEffectiveMapping())
      .pipe(finalize(() => this.previewing.set(false)))
      .subscribe({
        next: (pv) => {
          this.preview.set(pv);
          this.mappingDraft = this.mergeMapping(pv);
          if (advanceStep) {
            this.paso.set(4);
          }
        },
        error: (err: unknown) => this.showMsg(extractApiErrorMessage(err, 'No se pudo analizar el archivo.'), true),
      });
  }

  private mergeMapping(pv: PosImportPreviewResult): Record<string, string> {
    const cols = pv.columnasObjetivo.length ? pv.columnasObjetivo : this.columnasMapeo();
    const next: Record<string, string> = {};
    for (const col of cols) {
      next[col] = this.mappingDraft[col] || pv.mapeoAplicado[col] || pv.mapeoSugerido[col] || '';
    }
    return next;
  }

  private buildEffectiveMapping(): Record<string, string> | null {
    const pv = this.preview();
    const cols = pv?.columnasObjetivo?.length ? pv.columnasObjetivo : this.columnasMapeo();
    const next: Record<string, string> = {};
    for (const col of cols) {
      const value = this.mappingDraft[col] || pv?.mapeoAplicado[col] || pv?.mapeoSugerido[col] || '';
      if (value) {
        next[col] = value;
      }
    }
    return Object.keys(next).length ? next : null;
  }

  private assignFile(f: File): void {
    const name = f.name.toLowerCase();
    const ok =
      name.endsWith('.csv') ||
      name.endsWith('.txt') ||
      name.endsWith('.xlsx') ||
      name.endsWith('.xls') ||
      f.type === 'text/csv' ||
      f.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    if (!ok) {
      this.showMsg('Use CSV (.csv) o Excel (.xlsx).', true);
      return;
    }
    this.file.set(f);
    this.preview.set(null);
    this.result.set(null);
    this.message.set('');
  }

  clearMessage(): void {
    this.message.set('');
    this.messageIsError.set(false);
  }

  private clearState(): void {
    this.file.set(null);
    this.preview.set(null);
    this.result.set(null);
    this.clearMessage();
    this.mappingDraft = {};
  }

  private showMsg(text: string, isError: boolean): void {
    this.message.set(text);
    this.messageIsError.set(isError);
    if (isError) this.toast.error(text);
  }

}
