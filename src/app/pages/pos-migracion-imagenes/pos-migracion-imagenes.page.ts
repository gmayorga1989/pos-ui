import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import type { ColumnDefinition } from 'tabulator-tables';
import { finalize } from 'rxjs';
import { PosBackendApiService } from '../../core/api/pos-backend-api.service';
import type { PosBulkImageLineResult, PosBulkImageResult } from '../../core/api/pos-backend.types';
import { extractApiErrorMessage } from '../../core/http-error.util';
import { PosToastService } from '../../core/ui/pos-toast.service';
import { PosTabulatorLocalGridComponent } from '../../shared/grid/pos-tabulator-local-grid.component';
import { tabulatorCellValue, tabulatorTextareaCell } from '../../shared/grid/tabulator-formatters.util';
import { PosPageLayoutComponent } from '../../shared/pos-page-layout.component';

@Component({
  selector: 'pos-migracion-imagenes-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, PosPageLayoutComponent, PosTabulatorLocalGridComponent],
  host: { class: 'pos-page-host' },
  template: `
    <pos-page-layout
      eyebrow="Catálogo"
      title="Imágenes de productos"
      subtitle="Suba un ZIP con fotos nombradas por SKU. Ideal después de importar el catálogo."
      icon="migracion">

      <div class="pos-mig-flow">
        <section class="pos-mig-panel">
          <header class="pos-mig-panel__head">
            <h2 class="pos-mig-panel__title">Carga masiva (ZIP)</h2>
            <p class="pos-mig-panel__hint">
              Empaquete las imágenes en un <strong>.zip</strong>. Cada archivo debe llamarse igual al SKU del producto.
            </p>
          </header>

          <div class="pos-mig-guide pos-mig-guide--compact">
            <div class="pos-mig-guide__cols">
              <div class="pos-mig-guide__group">
                <h3>Ejemplo de nombres</h3>
                <div class="pos-mig-chips pos-mig-chips--soft">
                  <span class="pos-mig-chip"><code>PROD-001.jpg</code></span>
                  <span class="pos-mig-chip"><code>PROD-002.png</code></span>
                  <span class="pos-mig-chip"><code>7890123456789.webp</code> <em>si usa código de barras</em></span>
                </div>
              </div>
              <div class="pos-mig-guide__group">
                <h3>Reglas</h3>
                <ul class="pos-mig-tips pos-mig-tips--compact">
                  <li>PNG, JPEG o WebP · máx. 3 MB por imagen · hasta 500 archivos.</li>
                  <li>Puede organizar en carpetas dentro del ZIP; se ignora la ruta.</li>
                  <li>Reemplace la imagen anterior si vuelve a subir el mismo SKU.</li>
                </ul>
              </div>
            </div>
          </div>

          <label class="pos-mig-filter-row">
            <span>Emparejar por</span>
            <select [(ngModel)]="matchBy" name="matchBy" [disabled]="uploading()">
              <option value="sku">SKU (recomendado)</option>
              <option value="barcode">Código de barras</option>
            </select>
          </label>

          <div
            class="pos-mig-dropzone"
            [class.pos-mig-dropzone--over]="dragOver()"
            [class.pos-mig-dropzone--has]="!!file()"
            (dragover)="onDragOver($event)"
            (dragleave)="dragOver.set(false)"
            (drop)="onDrop($event)"
            (click)="fileInput.click()"
            role="button"
            tabindex="0">
            <input
              #fileInput
              type="file"
              class="pos-mig-dropzone__input"
              accept=".zip,application/zip"
              (change)="onFileSelected($event)" />
            @if (file()) {
              <strong>{{ file()!.name }}</strong>
              <span>{{ formatBytes(file()!.size) }}</span>
              <button type="button" class="pos-btn pos-btn--outline pos-mig-dropzone__clear" (click)="clearFile($event)">
                Quitar
              </button>
            } @else {
              <strong>Suelte el archivo ZIP aquí</strong>
              <span>Máx. 80 MB</span>
            }
          </div>

          @if (message()) {
            <div class="pos-mig-inline-alert pos-mig-inline-alert--warn">{{ message() }}</div>
          }

          @if (result(); as res) {
            <div class="pos-mig-summary" [class.pos-mig-summary--warn]="res.errores > 0">
              <div class="pos-mig-summary__metric">
                <span>Archivos</span>
                <strong>{{ res.totalArchivos }}</strong>
              </div>
              <div class="pos-mig-summary__metric pos-mig-summary__metric--ok">
                <span>Asignados</span>
                <strong>{{ res.asignados }}</strong>
              </div>
              <div class="pos-mig-summary__metric" [class.pos-mig-summary__metric--err]="res.errores > 0">
                <span>Errores</span>
                <strong>{{ res.errores }}</strong>
              </div>
            </div>
            @if (res.detalles.length) {
              <pos-tabulator-local-grid
                [data]="asGridData(res.detalles)"
                [columns]="resultColumns"
                height="min(360px, calc(100vh - 22rem))"
                emptyDescription="Sin detalle." />
            }
          }

          <footer class="pos-mig-panel__footer">
            <a routerLink="/migracion" class="pos-btn pos-btn--outline">Volver a migración</a>
            <a routerLink="/venta" class="pos-btn pos-btn--soft">Ir a ventas</a>
            <button
              type="button"
              class="pos-btn pos-btn--primary"
              [disabled]="!file() || uploading()"
              (click)="subir()">
              {{ uploading() ? 'Subiendo…' : 'Subir imágenes' }}
            </button>
          </footer>
        </section>
      </div>
    </pos-page-layout>
  `,
})
export class PosMigracionImagenesPage {
  private readonly api = inject(PosBackendApiService);
  private readonly toast = inject(PosToastService);

  readonly file = signal<File | null>(null);
  readonly dragOver = signal(false);
  readonly uploading = signal(false);
  readonly result = signal<PosBulkImageResult | null>(null);
  readonly message = signal('');

  matchBy: 'sku' | 'barcode' = 'sku';

  readonly resultColumns: ColumnDefinition[] = [
    { title: 'Archivo', field: 'archivo', minWidth: 140, formatter: (c) => tabulatorTextareaCell(tabulatorCellValue(c)) },
    { title: 'Referencia', field: 'referencia', width: 120 },
    { title: 'Estado', field: 'estado', width: 90 },
    { title: 'Mensaje', field: 'mensaje', minWidth: 200, formatter: (c) => tabulatorTextareaCell(tabulatorCellValue(c)) },
  ];

  asGridData(rows: PosBulkImageLineResult[]): Record<string, unknown>[] {
    return rows as unknown as Record<string, unknown>[];
  }

  formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
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

  onFileSelected(ev: Event): void {
    const f = (ev.target as HTMLInputElement).files?.[0];
    if (f) this.assignFile(f);
  }

  clearFile(ev: Event): void {
    ev.stopPropagation();
    this.file.set(null);
    this.result.set(null);
    this.message.set('');
  }

  subir(): void {
    const f = this.file();
    if (!f) return;
    this.uploading.set(true);
    this.message.set('');
    this.api
      .bulkUploadProductImages(f, this.matchBy)
      .pipe(finalize(() => this.uploading.set(false)))
      .subscribe({
        next: (res) => {
          this.result.set(res);
          if (res.errores === 0) {
            this.toast.success(`${res.asignados} imagen(es) asignada(s).`);
          } else {
            this.message.set(`${res.errores} imagen(es) con error. Revise el detalle.`);
          }
        },
        error: (err: unknown) => {
          this.message.set(extractApiErrorMessage(err, 'No se pudo procesar el ZIP.'));
        },
      });
  }

  private assignFile(f: File): void {
    const name = f.name.toLowerCase();
    if (!name.endsWith('.zip')) {
      this.message.set('Use un archivo ZIP (.zip).');
      return;
    }
    this.file.set(f);
    this.result.set(null);
    this.message.set('');
  }
}
