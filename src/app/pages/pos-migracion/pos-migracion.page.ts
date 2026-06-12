import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { ColumnDefinition } from 'tabulator-tables';
import { finalize, forkJoin } from 'rxjs';
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
type RevisarTab = 'config' | 'errores';

interface ListaPrecioFaltante {
  code: string;
  column: string;
}

interface MapeoFilaArchivo {
  archivo: string;
  vistaPrevia: string;
  objetivo: string;
}

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
      'Columnas precio_mayorista, precio_distribuidor, etc. requieren listas de precio con el mismo código.',
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
  host: { class: 'pos-page-host pos-page-host--migracion' },
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
          <section class="pos-mig-panel pos-mig-panel--card">
            <header class="pos-mig-panel__head">
              <h2 class="pos-mig-panel__title">
                <span class="pos-mig-panel__step">1</span>
                ¿Qué desea migrar?
              </h2>
              <p class="pos-mig-panel__hint">Elija el tipo de datos. En el siguiente paso indicará de dónde provienen.</p>
            </header>
            <div class="pos-mig-tipo-grid pos-mig-tipo-grid--pick" role="listbox" aria-label="Tipo de migración">
              <button
                type="button"
                class="pos-mig-tipo-card pos-mig-tipo-card--pick pos-focus-ring"
                role="option"
                (click)="irImagenes()">
                <span class="pos-mig-tipo-card__icon" aria-hidden="true">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                    <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" stroke-width="1.6" />
                    <circle cx="8.5" cy="10.5" r="1.5" fill="currentColor" />
                    <path d="M3 16l5-5 4 4 3-3 6 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                </span>
                <strong>Imágenes de productos</strong>
                <span>ZIP con fotos nombradas por SKU (ej. PROD-001.jpg)</span>
              </button>
              @for (t of tipos; track t.kind) {
                <button
                  type="button"
                  class="pos-mig-tipo-card pos-mig-tipo-card--pick pos-focus-ring"
                  role="option"
                  [attr.aria-selected]="kind() === t.kind"
                  [class.pos-mig-tipo-card--on]="kind() === t.kind"
                  (click)="seleccionarTipo(t.kind)">
                  @if (kind() === t.kind) {
                    <span class="pos-mig-tipo-card__check" aria-hidden="true">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                        <path d="M8 12.5l2.5 2.5L16 9" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
                      </svg>
                    </span>
                  }
                  <span class="pos-mig-tipo-card__icon" aria-hidden="true">
                    @if (t.kind === 'products') {
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                        <rect x="4" y="4" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.5" />
                        <rect x="14" y="4" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.5" />
                        <rect x="4" y="14" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.5" />
                        <rect x="14" y="14" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.5" />
                      </svg>
                    } @else {
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
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
              <button
                type="button"
                class="pos-btn pos-btn--primary pos-mig-btn-next"
                [disabled]="!puedeAvanzar()"
                (click)="avanzar()">
                Siguiente
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </button>
            </footer>
          </section>
        }
        @case (2) {
          <section class="pos-mig-panel pos-mig-panel--card">
            <header class="pos-mig-panel__head">
              <h2 class="pos-mig-panel__title">
                <span class="pos-mig-panel__step">2</span>
                Origen de los datos
              </h2>
              <p class="pos-mig-panel__hint">
                Seleccione el sistema del que exportó. Luxora ofrece plantilla lista; otros orígenes usan mapeo automático.
              </p>
            </header>

            <div class="pos-mig-origen-grid" role="listbox" aria-label="Origen de los datos">
              @for (p of presetsFiltrados(); track p.id) {
                <button
                  type="button"
                  class="pos-mig-tipo-card pos-mig-tipo-card--pick pos-mig-tipo-card--origen pos-focus-ring"
                  role="option"
                  [attr.aria-selected]="presetId() === p.id"
                  [class.pos-mig-tipo-card--on]="presetId() === p.id"
                  (click)="seleccionarPreset(p)">
                  @if (presetId() === p.id) {
                    <span class="pos-mig-tipo-card__check" aria-hidden="true">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                        <path d="M8 12.5l2.5 2.5L16 9" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
                      </svg>
                    </span>
                  }
                  <span class="pos-mig-tipo-card__icon" aria-hidden="true">
                    @switch (p.id) {
                      @case ('luxora') {
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                          <path d="M8 4h11a1 1 0 011 1v14a1 1 0 01-1 1H8a1 1 0 01-1-1V5a1 1 0 011-1z" stroke="currentColor" stroke-width="1.6" />
                          <path d="M8 8h8M8 11h8M8 14h5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
                          <path d="M5 7v12a1 1 0 001 1h1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
                        </svg>
                      }
                      @case ('excel_generico') {
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                          <path d="M6 4h11l3 3v13a1 1 0 01-1 1H6a1 1 0 01-1-1V5a1 1 0 011-1z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
                          <path d="M17 4v3h3" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
                          <path d="M9 12l2 2 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
                        </svg>
                      }
                      @case ('efactura_productos') {
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                          <path d="M6 4h11l3 3v13a1 1 0 01-1 1H6a1 1 0 01-1-1V5a1 1 0 011-1z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
                          <path d="M17 4v3h3" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
                          <path d="M8 13h8M8 16h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
                        </svg>
                      }
                      @default {
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                          <ellipse cx="12" cy="6" rx="7" ry="3" stroke="currentColor" stroke-width="1.6" />
                          <path d="M5 6v5c0 1.7 3.1 3 7 3s7-1.3 7-3V6" stroke="currentColor" stroke-width="1.6" />
                          <path d="M5 11v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5" stroke="currentColor" stroke-width="1.6" />
                        </svg>
                      }
                    }
                  </span>
                  <strong>{{ presetTituloCorto(p) }}</strong>
                  <span>{{ presetDescripcionCorta(p) }}</span>
                </button>
              }
            </div>

            @if (esPlantillaLuxora()) {
              <div class="pos-mig-origen-extra">
                <p class="pos-mig-origen-extra__text">
                  Use la plantilla oficial con las columnas ya nombradas para {{ kind() === 'products' ? 'productos' : 'clientes' }}.
                </p>
                <button type="button" class="pos-btn pos-btn--outline pos-btn--sm" [disabled]="downloading()" (click)="descargarPlantilla()">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M12 4v10M12 14l-4-4M12 14l4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
                    <path d="M5 18h14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
                  </svg>
                  {{ downloading() ? 'Descargando…' : 'Descargar plantilla' }}
                </button>
              </div>
            } @else {
              <p class="pos-mig-origen-hint">Al cargar el archivo podrá revisar y ajustar el mapeo de columnas en el paso de revisión.</p>
            }

            <details class="pos-mig-origen-details">
              <summary>Ver columnas y consejos de la plantilla</summary>
              <div class="pos-mig-guide pos-mig-guide--nested">
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
            </details>

            <footer class="pos-mig-panel__footer">
              <button type="button" class="pos-btn pos-btn--outline" (click)="retroceder()">Atrás</button>
              <button type="button" class="pos-btn pos-btn--primary pos-mig-btn-next" (click)="avanzar()">
                Siguiente
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </button>
            </footer>
          </section>
        }
        @case (3) {
          <section class="pos-mig-panel pos-mig-panel--card">
            <header class="pos-mig-panel__head">
              <h2 class="pos-mig-panel__title">
                <span class="pos-mig-panel__step">3</span>
                Subir archivo
              </h2>
              <p class="pos-mig-panel__hint">
                Origen <strong>{{ presetTituloCorto(presetActivo()) }}</strong> · CSV o Excel (.xlsx) · máx. 2.000 filas
              </p>
            </header>

            <div class="pos-mig-upload">
              <div
                class="pos-mig-dropzone pos-mig-dropzone--upload pos-focus-ring"
                [class.pos-mig-dropzone--over]="dragOver()"
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
                <span class="pos-mig-dropzone__icon" aria-hidden="true">
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
                    <path d="M12 15V5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
                    <path d="M8 9l4-4 4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
                    <path d="M5 19h14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
                    <path d="M7 19v-2a2 2 0 012-2h6a2 2 0 012 2v2" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
                  </svg>
                </span>
                <strong class="pos-mig-dropzone__title">Arrastre su archivo aquí o haga clic para seleccionar</strong>
                <span class="pos-mig-dropzone__hint">CSV o Excel (.xlsx) · máx. 2.000 filas</span>
              </div>

              @if (file(); as f) {
                <div class="pos-mig-file-row">
                  <span class="pos-mig-file-row__icon" aria-hidden="true">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                      <path d="M8 4h11a1 1 0 011 1v14a1 1 0 01-1 1H8a1 1 0 01-1-1V5a1 1 0 011-1z" stroke="currentColor" stroke-width="1.6" />
                      <path d="M8 8h8M8 11h8M8 14h5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
                    </svg>
                  </span>
                  <div class="pos-mig-file-row__meta">
                    <strong>{{ f.name }}</strong>
                    <span>{{ formatBytes(f.size) }}</span>
                  </div>
                  <span class="pos-mig-file-row__status">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M8 12.5l2.5 2.5L16 9" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
                    </svg>
                    Archivo listo
                  </span>
                  <button
                    type="button"
                    class="pos-mig-file-row__remove pos-focus-ring"
                    aria-label="Quitar archivo"
                    (click)="clearFile($event)">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M5 7h14" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
                      <path d="M10 11v6M14 11v6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
                      <path d="M8 7l.6-2h6.8l.6 2" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" />
                      <path d="M9 7v12a1 1 0 001 1h4a1 1 0 001-1V7" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" />
                    </svg>
                  </button>
                </div>
              }
            </div>

            <footer class="pos-mig-panel__footer">
              <button type="button" class="pos-btn pos-btn--outline" (click)="retroceder()">Atrás</button>
              <button
                type="button"
                class="pos-btn pos-btn--primary pos-mig-btn-next"
                [disabled]="!file() || previewing()"
                (click)="avanzar()">
                {{ previewing() ? 'Analizando…' : 'Siguiente' }}
                @if (!previewing()) {
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                }
              </button>
            </footer>
          </section>
        }
        @case (4) {
          <section class="pos-mig-panel pos-mig-panel--card">
            <header class="pos-mig-panel__head">
              <h2 class="pos-mig-panel__title">
                <span class="pos-mig-panel__step">4</span>
                Vista previa y mapeo
              </h2>
              <p class="pos-mig-panel__hint">Revise el resumen, ajuste columnas si hace falta y confirme la importación.</p>
            </header>
            @if (preview(); as pv) {
              <div class="pos-mig-summary pos-mig-summary--review">
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

              @if (hayPreparacionPendiente()) {
                <div class="pos-mig-preparar">
                  <div class="pos-mig-preparar__head">
                    <h3 class="pos-mig-preparar__title">Complete el catálogo antes de importar</h3>
                    <p class="pos-mig-preparar__hint">
                      Su archivo usa datos que aún no existen en el POS. Puede crearlos aquí con un clic.
                    </p>
                  </div>

                  @if (categoriasFaltantes().length) {
                    <div class="pos-mig-preparar__block">
                      <h4>Categorías ({{ categoriasFaltantes().length }})</h4>
                      <ul class="pos-mig-fix-panel__list">
                        @for (c of categoriasFaltantes(); track c) {
                          <li class="pos-mig-fix-panel__item">
                            <code>{{ c }}</code>
                            <span>{{ nombreDesdeCodigo(c) }}</span>
                          </li>
                        }
                      </ul>
                    </div>
                  }

                  @if (listasPrecioFaltantes().length) {
                    <div class="pos-mig-preparar__block">
                      <h4>Listas de precio ({{ listasPrecioFaltantes().length }})</h4>
                      <p class="pos-mig-preparar__subhint">
                        Columnas como <code>precio_mayorista</code> requieren una lista con ese código.
                      </p>
                      <ul class="pos-mig-fix-panel__list">
                        @for (lp of listasPrecioFaltantes(); track lp.code) {
                          <li class="pos-mig-fix-panel__item">
                            <code>{{ lp.code }}</code>
                            <span>{{ nombreDesdeCodigo(lp.code) }} · {{ lp.column }}</span>
                          </li>
                        }
                      </ul>
                    </div>
                  }

                  <div class="pos-mig-preparar__actions">
                    <button
                      type="button"
                      class="pos-btn pos-btn--primary"
                      [disabled]="creandoPreparacion() || previewing()"
                      (click)="crearPreparacionCatalogo()">
                      {{ creandoPreparacion() ? 'Creando…' : 'Crear lo que falta y actualizar' }}
                    </button>
                    <a routerLink="/categorias" class="pos-btn pos-btn--outline">Categorías</a>
                    <a routerLink="/listas-precio" class="pos-btn pos-btn--outline">Listas de precio</a>
                  </div>
                </div>
              }

              <div class="pos-mig-review-toolbar">
                <nav class="pos-mig-tabs pos-mig-tabs--review" role="tablist" aria-label="Revisión de importación">
                  <button
                    type="button"
                    class="pos-mig-tabs__tab"
                    role="tab"
                    [class.pos-mig-tabs__tab--active]="revisarTab() === 'config'"
                    [attr.aria-selected]="revisarTab() === 'config'"
                    (click)="revisarTab.set('config')">
                    Configuración
                  </button>
                  <button
                    type="button"
                    class="pos-mig-tabs__tab"
                    role="tab"
                    [class.pos-mig-tabs__tab--active]="revisarTab() === 'errores'"
                    [attr.aria-selected]="revisarTab() === 'errores'"
                    (click)="revisarTab.set('errores')">
                    Errores@if (conteoErroresPreview() > 0) { ({{ conteoErroresPreview() }})}
                  </button>
                </nav>
                <button
                  type="button"
                  class="pos-btn pos-btn--ghost pos-btn--sm pos-mig-review-toolbar__refresh"
                  [disabled]="previewing()"
                  (click)="refrescarPreview()">
                  {{ previewing() ? 'Analizando…' : 'Actualizar vista previa' }}
                </button>
              </div>

              <div class="pos-mig-tabs__panel" role="tabpanel">
                @if (revisarTab() === 'config') {
                  @if (!pv.mapeoCompleto) {
                    <div class="pos-mig-inline-alert pos-mig-inline-alert--warn">
                      Asigne las columnas obligatorias faltantes: <strong>{{ pv.columnasFaltantes.join(', ') }}</strong>
                    </div>
                  }

                  <div class="pos-mig-map-table-wrap">
                    <table class="pos-mig-map-table">
                      <thead>
                        <tr>
                          <th>Columna del archivo</th>
                          <th>Vista previa</th>
                          <th>Mapear con</th>
                          <th>Estado</th>
                        </tr>
                      </thead>
                      <tbody>
                        @for (row of filasMapeoDesdeArchivo(pv); track row.archivo) {
                          <tr>
                            <td data-label="Columna del archivo">
                              <code class="pos-mig-map-table__code">{{ row.archivo }}</code>
                            </td>
                            <td data-label="Vista previa" class="pos-mig-map-table__preview">{{ row.vistaPrevia }}</td>
                            <td data-label="Mapear con">
                              <select
                                class="pos-mig-map-table__select"
                                [ngModel]="row.objetivo"
                                [name]="'map_archivo_' + row.archivo"
                                (ngModelChange)="onMapeoArchivoChange(row.archivo, $event)">
                                <option value="">— Sin asignar —</option>
                                @for (col of columnasMapeo(); track col) {
                                  <option [value]="col">{{ colLabel(col) }}</option>
                                }
                              </select>
                            </td>
                            <td data-label="Estado">
                              @if (estadoMapeoFila(row.objetivo); as estado) {
                                <span class="pos-mig-map-estado pos-mig-map-estado--{{ estado.kind }}">{{ estado.label }}</span>
                              }
                            </td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                } @else {
                  @if (conteoErroresPreview() === 0) {
                    <div class="pos-mig-inline-alert pos-mig-inline-alert--ok">
                      No hay errores de validación. Puede confirmar la importación.
                    </div>
                  } @else {
                    @if (resumenErrores(pv.detalles); as resumen) {
                      <div class="pos-mig-inline-alert pos-mig-inline-alert--warn">{{ resumen }}</div>
                    }

                    @if (hayPreparacionPendiente()) {
                      <div class="pos-mig-inline-alert pos-mig-inline-alert--warn">
                        Use el panel <strong>Complete el catálogo</strong> arriba para crear categorías o listas de precio.
                      </div>
                    }

                    <div class="pos-maestro-grid-wrap pos-maestro-tabulator-wrap">
                      <pos-tabulator-local-grid
                        [data]="asGridData(detallesErroresPreview())"
                        [columns]="previewColumns"
                        height="min(280px, calc(100vh - 24rem))"
                        emptyDescription="Sin errores." />
                    </div>
                  }
                }
              </div>

              <footer class="pos-mig-panel__footer">
                <button type="button" class="pos-btn pos-btn--outline" (click)="retroceder()">Atrás</button>
                <button
                  type="button"
                  class="pos-btn pos-btn--primary pos-mig-btn-next"
                  [disabled]="importing() || !pv.mapeoCompleto || pv.filasValidas === 0"
                  (click)="ejecutarImportacion()">
                  {{ importing() ? 'Importando…' : 'Siguiente' }}
                  @if (!importing()) {
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
                    </svg>
                  }
                </button>
              </footer>
            }
          </section>
        }
        @case (5) {
          <section class="pos-mig-panel pos-mig-panel--card">
            <header class="pos-mig-panel__head">
              <h2 class="pos-mig-panel__title">
                <span class="pos-mig-panel__step">5</span>
                Importación completada
              </h2>
              <p class="pos-mig-panel__hint">Resumen final de la importación y acciones disponibles.</p>
            </header>
            @if (result(); as res) {
              @if (res.errores === 0) {
                <div class="pos-mig-result-banner pos-mig-result-banner--ok" role="status">
                  <span class="pos-mig-result-banner__icon" aria-hidden="true">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.6" />
                      <path d="M8 12.5l2.5 2.5L16 9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                    </svg>
                  </span>
                  <div class="pos-mig-result-banner__body">
                    <strong>¡Todo listo!</strong>
                    <p>Sus datos han sido importados correctamente.</p>
                  </div>
                </div>
              } @else {
                <div class="pos-mig-result-banner pos-mig-result-banner--warn" role="status">
                  <span class="pos-mig-result-banner__icon" aria-hidden="true">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.6" />
                      <path d="M12 8v5M12 16h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                    </svg>
                  </span>
                  <div class="pos-mig-result-banner__body">
                    <strong>Importación con observaciones</strong>
                    <p>
                      Las filas válidas ya fueron guardadas.
                      @if (resumenErrores(res.detalles); as resumen) {
                        {{ resumen }}
                      } @else {
                        Revise el detalle por fila abajo.
                      }
                    </p>
                  </div>
                </div>
              }

              <div class="pos-mig-summary pos-mig-summary--result">
                <div class="pos-mig-summary__metric">
                  <span>Filas procesadas</span>
                  <strong>{{ res.totalFilas }}</strong>
                </div>
                <div class="pos-mig-summary__metric pos-mig-summary__metric--ok">
                  <span>Creadas</span>
                  <strong>{{ res.creados }}</strong>
                </div>
                <div class="pos-mig-summary__metric pos-mig-summary__metric--ok">
                  <span>Actualizadas</span>
                  <strong>{{ res.actualizados }}</strong>
                </div>
                <div class="pos-mig-summary__metric" [class.pos-mig-summary__metric--err]="res.errores > 0">
                  <span>Errores</span>
                  <strong>{{ res.errores }}</strong>
                </div>
              </div>

              @if (res.detalles.length && res.errores > 0) {
                <div class="pos-maestro-grid-wrap pos-maestro-tabulator-wrap">
                  <pos-tabulator-local-grid
                    [data]="asGridData(res.detalles)"
                    [columns]="resultColumns"
                    height="min(320px, calc(100vh - 26rem))"
                    emptyDescription="Sin detalle de filas." />
                </div>
              }

              <section class="pos-mig-result-actions" aria-labelledby="mig-result-actions-title">
                <h3 id="mig-result-actions-title" class="pos-mig-result-actions__title">¿Qué desea hacer ahora?</h3>
                <div class="pos-mig-result-actions__grid">
                  @if (kind() === 'products') {
                    <a routerLink="/catalogo" class="pos-mig-result-action pos-focus-ring">
                      <span class="pos-mig-result-action__icon" aria-hidden="true">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                          <rect x="4" y="4" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.5" />
                          <rect x="14" y="4" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.5" />
                          <rect x="4" y="14" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.5" />
                          <rect x="14" y="14" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.5" />
                        </svg>
                      </span>
                      <span>Ver catálogo</span>
                    </a>
                    <a routerLink="/catalogo" class="pos-mig-result-action pos-focus-ring">
                      <span class="pos-mig-result-action__icon" aria-hidden="true">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                          <path d="M4 7h16M4 12h10M4 17h14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                        </svg>
                      </span>
                      <span>Ir a productos</span>
                    </a>
                  } @else {
                    <a routerLink="/clientes" class="pos-mig-result-action pos-focus-ring">
                      <span class="pos-mig-result-action__icon" aria-hidden="true">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                          <circle cx="9" cy="8" r="3" stroke="currentColor" stroke-width="1.5" />
                          <path d="M3 19c0-3 2.5-5 6-5s6 2 6 5" stroke="currentColor" stroke-width="1.5" />
                        </svg>
                      </span>
                      <span>Ver clientes</span>
                    </a>
                    <a routerLink="/clientes" class="pos-mig-result-action pos-focus-ring">
                      <span class="pos-mig-result-action__icon" aria-hidden="true">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                          <path d="M4 7h16M4 12h10M4 17h14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                        </svg>
                      </span>
                      <span>Ir a clientes</span>
                    </a>
                  }
                  <button type="button" class="pos-mig-result-action pos-focus-ring" (click)="reiniciar()">
                    <span class="pos-mig-result-action__icon" aria-hidden="true">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                        <path d="M12 15V5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                        <path d="M8 9l4-4 4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
                        <path d="M5 19h14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                      </svg>
                    </span>
                    <span>Nueva migración</span>
                  </button>
                </div>
              </section>

              <footer class="pos-mig-panel__footer">
                <button type="button" class="pos-btn pos-btn--primary pos-mig-btn-next" (click)="finalizarMigracion()">
                  Finalizar
                </button>
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
  readonly revisarTab = signal<RevisarTab>('config');
  readonly creandoPreparacion = signal(false);
  readonly categoriasExistentes = signal<Set<string>>(new Set());
  readonly listasPrecioExistentes = signal<Set<string>>(new Set());

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

  readonly presetActivo = computed((): PosImportPreset => {
    const p = this.presets().find((x) => x.id === this.presetId());
    return (
      p ?? {
        id: 'luxora',
        kind: 'both',
        nombre: 'Plantilla POS Luxora',
        descripcion: 'Use la plantilla oficial con columnas ya nombradas.',
        mapeo: {},
      }
    );
  });

  readonly esPlantillaLuxora = computed(() => this.presetId() === 'luxora');

  readonly columnasMapeo = computed(() => {
    const objetivo = this.preview()?.columnasObjetivo;
    if (objetivo?.length) {
      return objetivo;
    }
    return [...this.config().obligatorias, ...this.config().opcionales];
  });

  readonly detallesErroresPreview = computed(() => {
    const pv = this.preview();
    if (!pv) return [];
    return pv.detalles.filter((d) => d.estado === 'ERROR' || d.estado === 'MAPEO');
  });

  readonly conteoErroresPreview = computed(() => this.detallesErroresPreview().length);

  readonly categoriasFaltantes = computed(() => {
    if (this.kind() !== 'products') return [];
    const codes = new Set<string>();
    const existentes = this.categoriasExistentes();
    const re = /Categor[ií]a «([^»]+)» no existe/i;
    for (const d of this.detallesErroresPreview()) {
      const m = d.mensaje?.match(re);
      if (m?.[1]) {
        codes.add(m[1].trim().toUpperCase());
      }
    }
    for (const row of this.preview()?.muestra ?? []) {
      const raw = row['categoria_codigo']?.trim();
      if (raw) {
        codes.add(raw.toUpperCase());
      }
    }
    return [...codes].filter((c) => !existentes.has(c)).sort((a, b) => a.localeCompare(b));
  });

  readonly listasPrecioFaltantes = computed((): ListaPrecioFaltante[] => {
    const pv = this.preview();
    if (!pv || this.kind() !== 'products') return [];
    const existentes = this.listasPrecioExistentes();
    const objetivo = new Set(pv.columnasObjetivo.map((c) => c.trim().toLowerCase()));
    const seen = new Set<string>();
    const out: ListaPrecioFaltante[] = [];
    for (const header of pv.columnasDetectadas) {
      const col = header.trim().toLowerCase();
      if (!col.startsWith('precio_')) {
        continue;
      }
      if (objetivo.has(col)) {
        continue;
      }
      const code = col.slice('precio_'.length).toUpperCase();
      if (!code || seen.has(code) || existentes.has(code)) {
        continue;
      }
      seen.add(code);
      out.push({ code, column: col });
    }
    return out.sort((a, b) => a.code.localeCompare(b.code));
  });

  readonly hayPreparacionPendiente = computed(
    () =>
      this.kind() === 'products' &&
      (this.categoriasFaltantes().length > 0 || this.listasPrecioFaltantes().length > 0),
  );

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

  presetTituloCorto(p: PosImportPreset): string {
    return p.nombre.replace(/\s*\([^)]*\)\s*$/, '').trim();
  }

  presetDescripcionCorta(p: PosImportPreset): string {
    const text = p.descripcion.trim();
    if (p.id === 'luxora') {
      return 'Use la plantilla oficial con columnas ya nombradas.';
    }
    if (p.id === 'excel_generico') {
      return 'Suba su exportación y el sistema sugerirá el mapeo.';
    }
    if (p.id === 'efactura_productos') {
      return 'Para listas exportadas con códigos y descripciones de eFactura u otro ERP del grupo.';
    }
    if (p.id.startsWith('erp_')) {
      return this.kind() === 'products'
        ? 'Mapeo típico: Código → SKU, Descripción → nombre, PVP → precio.'
        : 'Mapeo típico: Tipo + documento + nombre del cliente.';
    }
    return text;
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

  irImagenes(): void {
    void this.router.navigate(['/migracion/imagenes']);
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

  finalizarMigracion(): void {
    const path = this.kind() === 'products' ? '/catalogo' : '/clientes';
    void this.router.navigate([path]);
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

  filasMapeoDesdeArchivo(pv: PosImportPreviewResult): MapeoFilaArchivo[] {
    const muestra0 = pv.muestra[0] ?? {};
    return pv.columnasDetectadas.map((archivo) => {
      const objetivo = this.objetivoParaColumnaArchivo(archivo);
      const raw = objetivo ? muestra0[objetivo] : undefined;
      const vistaPrevia = raw != null && String(raw).trim() ? String(raw) : '—';
      return { archivo, vistaPrevia, objetivo };
    });
  }

  objetivoParaColumnaArchivo(archivo: string): string {
    for (const col of this.columnasMapeo()) {
      if (this.mappingDraft[col] === archivo) {
        return col;
      }
    }
    return '';
  }

  onMapeoArchivoChange(archivo: string, objetivo: string): void {
    for (const col of this.columnasMapeo()) {
      if (this.mappingDraft[col] === archivo) {
        this.mappingDraft[col] = '';
      }
    }
    if (objetivo) {
      this.mappingDraft[objetivo] = archivo;
    }
  }

  estadoMapeoFila(objetivo: string): { label: string; kind: 'ok' | 'muted' } {
    if (!objetivo) {
      return { label: 'Sin asignar', kind: 'muted' };
    }
    return { label: 'Válido', kind: 'ok' };
  }

  refrescarPreview(): void {
    void this.ejecutarPreview(false);
  }

  nombreDesdeCodigo(code: string): string {
    return code
      .toLowerCase()
      .split(/[_\s-]+/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }

  crearPreparacionCatalogo(): void {
    const cats = this.categoriasFaltantes();
    const lists = this.listasPrecioFaltantes();
    if (!cats.length && !lists.length) {
      return;
    }
    this.creandoPreparacion.set(true);
    const requests = [
      ...cats.map((code, index) =>
        this.api.postProductCategory({
          code,
          name: this.nombreDesdeCodigo(code),
          parentId: null,
          sortOrder: index,
          active: true,
        }),
      ),
      ...lists.map((lp) =>
        this.api.postPriceList({
          code: lp.code,
          name: this.nombreDesdeCodigo(lp.code),
          currency: 'USD',
        }),
      ),
    ];
    forkJoin(requests)
      .pipe(finalize(() => this.creandoPreparacion.set(false)))
      .subscribe({
        next: () => {
          const partes: string[] = [];
          if (cats.length) partes.push(`${cats.length} categoría(s)`);
          if (lists.length) partes.push(`${lists.length} lista(s) de precio`);
          this.toast.success(`${partes.join(' y ')} creada(s). Actualizando vista previa…`);
          this.cargarCatalogoReferencia();
          this.refrescarPreview();
        },
        error: (err: unknown) =>
          this.toast.error(extractApiErrorMessage(err, 'No se pudo completar el catálogo')),
      });
  }

  private cargarCatalogoReferencia(): void {
    if (this.kind() !== 'products') {
      return;
    }
    forkJoin({
      cats: this.api.getProductCategories(),
      lists: this.api.getPriceLists(),
    }).subscribe({
      next: ({ cats, lists }) => {
        this.categoriasExistentes.set(
          new Set(
            cats
              .filter((c) => c.active && c.code)
              .map((c) => c.code!.trim().toUpperCase()),
          ),
        );
        this.listasPrecioExistentes.set(
          new Set(
            lists
              .filter((l) => l.active && !l.primary)
              .map((l) => l.code.trim().toUpperCase()),
          ),
        );
      },
      error: () => {
        this.categoriasExistentes.set(new Set());
        this.listasPrecioExistentes.set(new Set());
      },
    });
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
          this.cargarCatalogoReferencia();
          const hayErrores = pv.filasConError > 0 || pv.detalles.some((d) => d.estado === 'ERROR' || d.estado === 'MAPEO');
          this.revisarTab.set(hayErrores ? 'errores' : 'config');
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
    this.revisarTab.set('config');
    this.categoriasExistentes.set(new Set());
    this.listasPrecioExistentes.set(new Set());
    this.mappingDraft = {};
  }

  private showMsg(text: string, isError: boolean): void {
    this.message.set(text);
    this.messageIsError.set(isError);
    if (isError) this.toast.error(text);
  }

}
