import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PosBackendApiService } from '../../core/api/pos-backend-api.service';
import type { PosSalesReportResponse } from '../../core/api/pos-backend.types';
import { PosToastService } from '../../core/ui/pos-toast.service';

@Component({
  selector: 'pos-reportes-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  host: { class: 'pos-page-host' },
  template: `
    <div class="rep">
      <header class="rep__head">
        <div class="rep__intro">
          <span class="rep__eyebrow">Reporte de ventas</span>
          <h1 class="rep__title">Reporte de ventas</h1>
          <p class="rep__subtitle">Totales por día y productos más vendidos (backend pos-app).</p>
        </div>
        <div class="rep__toolbar">
          <button
            type="button"
            class="rep-btn rep-btn--ghost pos-focus-ring"
            (click)="load()"
            [disabled]="loading()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M4 12a8 8 0 0113.8-5.6M20 4v5h-5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
              <path d="M20 12a8 8 0 01-13.8 5.6M4 20v-5h5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            Actualizar
          </button>
          <button
            type="button"
            class="rep-btn rep-btn--excel pos-focus-ring"
            (click)="downloadExcel()"
            [disabled]="!hasData()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="4" y="3" width="16" height="18" rx="2" stroke="currentColor" stroke-width="1.6" />
              <path d="M8 8h8M8 12h8M8 16h5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
            </svg>
            Excel
          </button>
          <button
            type="button"
            class="rep-btn rep-btn--pdf pos-focus-ring"
            (click)="downloadPdf()"
            [disabled]="!hasData()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M8 4h9l3 3v13H8a1 1 0 01-1-1V5a1 1 0 011-1z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
              <path d="M16 4v4h4M10 13h6M10 17h4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
            </svg>
            PDF
          </button>
        </div>
      </header>

      <div class="rep-top-row">
        <section class="rep-filters" aria-label="Filtros del reporte">
          <label class="rep-filters__field">
            <span>Desde</span>
            <input type="date" [(ngModel)]="from" name="from" class="rep-filters__input pos-focus-ring" />
          </label>
          <label class="rep-filters__field">
            <span>Hasta</span>
            <input type="date" [(ngModel)]="to" name="to" class="rep-filters__input pos-focus-ring" />
          </label>
          <button type="button" class="rep-btn rep-btn--primary pos-focus-ring" [disabled]="loading()" (click)="load()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="1.7" />
              <path d="M20 20l-3.5-3.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
            </svg>
            {{ loading() ? 'Consultando…' : 'Consultar' }}
          </button>
        </section>

        @if (report(); as data) {
          <section class="rep-kpi" aria-label="Resumen del reporte">
            <article class="rep-kpi__card rep-kpi__card--sales">
              <span class="rep-kpi__icon" aria-hidden="true">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <path d="M6 6h12l-1.2 11H7.2L6 6zM9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </span>
              <div class="rep-kpi__copy">
                <span class="rep-kpi__label">Ventas</span>
                <strong class="rep-kpi__amount">{{ data.saleCount }}</strong>
                <small class="rep-kpi__hint">Tickets totales</small>
              </div>
            </article>
            <article class="rep-kpi__card rep-kpi__card--total">
              <span class="rep-kpi__icon" aria-hidden="true">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.6" />
                  <path d="M12 8v8M9.5 10.5h5M9.5 13.5h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                </svg>
              </span>
              <div class="rep-kpi__copy">
                <span class="rep-kpi__label">Total</span>
                <strong class="rep-kpi__amount">{{ money(data.totalAmount) }}</strong>
                <small class="rep-kpi__hint">Ventas totales</small>
              </div>
            </article>
          </section>
        }
      </div>

      @if (error()) {
        <div class="rep__notice" role="status">{{ error() }}</div>
      }

      @if (report(); as data) {
        <div class="rep-panels">
          <section class="rep-panel" aria-label="Ventas por día">
            <header class="rep-panel__head">
              <span class="rep-panel__icon rep-panel__icon--calendar" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <rect x="4" y="5" width="16" height="15" rx="2" stroke="currentColor" stroke-width="1.6" />
                  <path d="M8 3v4M16 3v4M4 10h16" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
                </svg>
              </span>
              <h2 class="rep-panel__title">Por día</h2>
            </header>
            <div class="rep-panel__body">
              <table class="rep-table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th class="num">Tickets</th>
                    <th class="num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  @for (d of data.dailyTotals; track d.date) {
                    <tr>
                      <td>{{ formatDateLong(d.date) }}</td>
                      <td class="num">{{ d.saleCount }}</td>
                      <td class="num">{{ money(d.totalAmount) }}</td>
                    </tr>
                  } @empty {
                    <tr>
                      <td colspan="3" class="rep-table__empty">Sin ventas en el rango seleccionado.</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </section>

          <section class="rep-panel" aria-label="Top productos">
            <header class="rep-panel__head">
              <span class="rep-panel__icon rep-panel__icon--star" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path d="M12 3.8l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 16.9l-4.8 2.5.9-5.4-3.9-3.8 5.4-.8L12 3.8z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
                </svg>
              </span>
              <h2 class="rep-panel__title">Top productos</h2>
            </header>
            <div class="rep-panel__body">
              <table class="rep-table">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Nombre</th>
                    <th class="num">Cant.</th>
                    <th class="num">Monto</th>
                  </tr>
                </thead>
                <tbody>
                  @for (p of data.topProducts; track p.sku) {
                    <tr>
                      <td>
                        <span class="rep-product-sku">
                          <span class="rep-product-sku__icon" aria-hidden="true">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                              <path d="M6 8h12l-1 10H7L6 8zM9 8V6a1 1 0 011-1h4a1 1 0 011 1v2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
                            </svg>
                          </span>
                          {{ p.sku }}
                        </span>
                      </td>
                      <td>{{ p.name }}</td>
                      <td class="num">{{ p.quantity }}</td>
                      <td class="num">{{ money(p.amount) }}</td>
                    </tr>
                  } @empty {
                    <tr>
                      <td colspan="4" class="rep-table__empty">Sin productos en el rango seleccionado.</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <footer class="rep-info" aria-label="Información del reporte">
          <div class="rep-info__copy">
            <span class="rep-info__icon" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.6" />
                <path d="M12 11v5M12 8h.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
              </svg>
            </span>
            <p>
              <strong>Información:</strong>
              Los datos mostrados corresponden al rango de fechas seleccionado
              ({{ formatDateShort(data.from) }} — {{ formatDateShort(data.to) }}).
            </p>
          </div>
          <div class="rep-info__art" aria-hidden="true">
            <svg class="rep-info__chart" viewBox="0 0 120 80" fill="none">
              <rect x="8" y="42" width="14" height="30" rx="3" class="rep-info__bar rep-info__bar--1" />
              <rect x="30" y="28" width="14" height="44" rx="3" class="rep-info__bar rep-info__bar--2" />
              <rect x="52" y="18" width="14" height="54" rx="3" class="rep-info__bar rep-info__bar--3" />
              <rect x="74" y="34" width="14" height="38" rx="3" class="rep-info__bar rep-info__bar--4" />
              <circle cx="98" cy="28" r="16" class="rep-info__pie" stroke-width="2" />
              <path d="M98 28 L98 12 A16 16 0 0 1 110 36 Z" class="rep-info__pie-slice" />
            </svg>
          </div>
        </footer>
      }
    </div>
  `,
  styles: `
    .rep {
      display: grid;
      gap: 1rem;
      min-height: 0;
    }
    .rep__head {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      gap: 1rem;
      flex-wrap: wrap;
    }
    .rep__eyebrow {
      display: block;
      margin-bottom: 0.3rem;
      font-size: 0.68rem;
      font-weight: 800;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: color-mix(in srgb, var(--pos-accent-hover) 72%, var(--pos-text));
    }
    .rep__title {
      margin: 0;
      font-size: clamp(1.35rem, 2.4vw, 1.65rem);
      font-weight: 800;
      letter-spacing: -0.02em;
      line-height: 1.15;
    }
    .rep__subtitle {
      margin: 0.35rem 0 0;
      max-width: 36rem;
      color: var(--pos-muted);
      font-size: 0.88rem;
      line-height: 1.45;
    }
    .rep__toolbar {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 0.5rem;
    }
    .rep-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
      min-height: 2.45rem;
      padding: 0 0.95rem;
      border-radius: var(--pos-radius-sm);
      border: 1px solid var(--pos-border);
      background: var(--pos-surface);
      color: var(--pos-text);
      font-size: 0.82rem;
      font-weight: 800;
      cursor: pointer;
      transition: background var(--pos-transition), border-color var(--pos-transition), transform var(--pos-transition);
    }
    .rep-btn:hover:not(:disabled) {
      transform: translateY(-1px);
      border-color: color-mix(in srgb, var(--pos-accent) 35%, var(--pos-border));
    }
    .rep-btn:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }
    .rep-btn--ghost {
      color: var(--pos-muted);
      background: color-mix(in srgb, var(--pos-surface) 92%, var(--pos-bg));
    }
    .rep-btn--excel {
      border-color: color-mix(in srgb, #22c55e 35%, var(--pos-border));
      color: color-mix(in srgb, #16a34a 80%, var(--pos-text));
      background: color-mix(in srgb, #22c55e 8%, var(--pos-surface));
    }
    .rep-btn--pdf {
      border-color: var(--pos-text);
      background: var(--pos-text);
      color: var(--pos-surface);
    }
    .rep-btn--primary {
      border-color: var(--pos-accent);
      background: var(--pos-accent);
      color: #fff;
    }
    .rep__notice {
      border: 1px solid color-mix(in srgb, var(--pos-warn) 40%, transparent);
      border-radius: var(--pos-radius-sm);
      padding: 0.7rem 0.85rem;
      background: color-mix(in srgb, var(--pos-warn) 10%, var(--pos-surface));
      color: color-mix(in srgb, var(--pos-warn) 85%, var(--pos-text));
      font-size: 0.84rem;
      font-weight: 700;
    }
    .rep-top-row {
      display: grid;
      grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
      gap: 0.85rem;
      align-items: stretch;
    }
    .rep-top-row:has(.rep-filters:only-child) {
      grid-template-columns: minmax(0, 1fr);
    }
    .rep-filters {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      gap: 0.75rem;
      padding: 0.95rem 1rem;
      border: 1px solid var(--pos-border);
      border-radius: var(--pos-radius);
      background: var(--pos-surface);
      box-shadow: 0 1px 0 color-mix(in srgb, var(--pos-text) 4%, transparent);
      min-height: 5.25rem;
    }
    .rep-filters__field {
      display: flex;
      flex-direction: column;
      gap: 0.3rem;
      min-width: 10.5rem;
    }
    .rep-filters__field span {
      font-size: 0.68rem;
      font-weight: 800;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: var(--pos-muted);
    }
    .rep-filters__input {
      min-height: 2.45rem;
      padding: 0.45rem 0.65rem;
      border: 1px solid var(--pos-border);
      border-radius: var(--pos-radius-sm);
      background: color-mix(in srgb, var(--pos-bg) 40%, var(--pos-surface));
      color: var(--pos-text);
      font-size: 0.84rem;
      font-weight: 600;
    }
    .rep-kpi {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.75rem;
      min-width: 0;
    }
    .rep-kpi__card {
      display: flex;
      align-items: center;
      gap: 0.85rem;
      padding: 0.95rem 1rem;
      min-height: 5.25rem;
      border: 1px solid var(--pos-border);
      border-radius: var(--pos-radius);
      background: var(--pos-surface);
      box-shadow: 0 1px 0 color-mix(in srgb, var(--pos-text) 4%, transparent);
    }
    .rep-kpi__icon {
      flex-shrink: 0;
      width: 3.25rem;
      height: 3.25rem;
      border-radius: 999px;
      display: grid;
      place-items: center;
    }
    .rep-kpi__card--sales .rep-kpi__icon {
      background: color-mix(in srgb, var(--lux-indigo) 14%, var(--pos-surface));
      color: var(--lux-indigo);
    }
    .rep-kpi__card--total .rep-kpi__icon {
      background: color-mix(in srgb, #22c55e 14%, var(--pos-surface));
      color: #16a34a;
    }
    .rep-kpi__label {
      display: block;
      font-size: 0.68rem;
      font-weight: 800;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--pos-muted);
    }
    .rep-kpi__amount {
      display: block;
      margin-top: 0.2rem;
      font-size: clamp(1.05rem, 1.8vw, 1.25rem);
      font-weight: 800;
      font-variant-numeric: tabular-nums;
      letter-spacing: -0.02em;
    }
    .rep-kpi__hint {
      display: block;
      margin-top: 0.2rem;
      font-size: 0.68rem;
      color: color-mix(in srgb, var(--pos-muted) 88%, var(--pos-text));
      line-height: 1.35;
    }
    .rep-panels {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 0.85rem;
      align-items: start;
    }
    .rep-panel {
      border: 1px solid var(--pos-border);
      border-radius: var(--pos-radius);
      background: var(--pos-surface);
      overflow: hidden;
      box-shadow: 0 1px 0 color-mix(in srgb, var(--pos-text) 4%, transparent);
    }
    .rep-panel__head {
      display: flex;
      align-items: center;
      gap: 0.55rem;
      padding: 0.8rem 0.95rem;
      border-bottom: 1px solid var(--pos-border);
      background: color-mix(in srgb, var(--pos-surface) 94%, var(--pos-bg));
    }
    .rep-panel__icon {
      width: 2rem;
      height: 2rem;
      border-radius: 10px;
      display: grid;
      place-items: center;
    }
    .rep-panel__icon--calendar {
      background: color-mix(in srgb, var(--lux-indigo) 10%, var(--pos-surface));
      color: var(--lux-indigo);
    }
    .rep-panel__icon--star {
      background: color-mix(in srgb, #f59e0b 12%, var(--pos-surface));
      color: #d97706;
    }
    .rep-panel__title {
      margin: 0;
      font-size: 0.78rem;
      font-weight: 900;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--pos-text);
    }
    .rep-panel__body {
      overflow: auto;
    }
    .rep-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.8rem;
    }
    .rep-table th,
    .rep-table td {
      padding: 0.65rem 0.85rem;
      border-bottom: 1px solid var(--pos-border);
      text-align: left;
      vertical-align: middle;
    }
    .rep-table thead th {
      background: color-mix(in srgb, var(--lux-indigo) 8%, var(--pos-surface));
      color: var(--pos-muted);
      font-size: 0.66rem;
      font-weight: 900;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .rep-table tbody tr:last-child td {
      border-bottom: none;
    }
    .rep-table .num {
      text-align: right;
      font-variant-numeric: tabular-nums;
      font-weight: 700;
    }
    .rep-table__empty {
      padding: 1.5rem;
      text-align: center;
      color: var(--pos-muted);
      font-weight: 600;
    }
    .rep-product-sku {
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
      font-weight: 700;
    }
    .rep-product-sku__icon {
      width: 1.55rem;
      height: 1.55rem;
      border-radius: 8px;
      display: grid;
      place-items: center;
      background: color-mix(in srgb, var(--lux-cyan) 12%, var(--pos-surface));
      color: #0891b2;
      flex-shrink: 0;
    }
    .rep-info {
      position: relative;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 1rem;
      align-items: center;
      padding: 0.9rem 1rem;
      border: 1px solid color-mix(in srgb, var(--lux-indigo) 18%, var(--pos-border));
      border-radius: var(--pos-radius);
      background: linear-gradient(
        118deg,
        color-mix(in srgb, var(--lux-indigo) 9%, var(--pos-surface)) 0%,
        color-mix(in srgb, var(--lux-cyan) 11%, var(--pos-surface)) 48%,
        color-mix(in srgb, var(--pos-bg) 28%, var(--pos-surface)) 100%
      );
      overflow: hidden;
    }
    .rep-info::before {
      content: '';
      position: absolute;
      inset: 0;
      background: radial-gradient(
        ellipse 42% 88% at 94% 42%,
        color-mix(in srgb, var(--lux-indigo) 14%, transparent),
        transparent 72%
      );
      pointer-events: none;
    }
    .rep-info__copy {
      position: relative;
      z-index: 1;
      display: flex;
      align-items: flex-start;
      gap: 0.65rem;
    }
    .rep-info__icon {
      flex-shrink: 0;
      width: 2rem;
      height: 2rem;
      border-radius: 10px;
      display: grid;
      place-items: center;
      background: color-mix(in srgb, var(--lux-indigo) 12%, var(--pos-surface));
      color: var(--lux-indigo);
    }
    .rep-info__copy p {
      margin: 0;
      font-size: 0.82rem;
      line-height: 1.45;
      color: var(--pos-muted);
    }
    .rep-info__copy strong {
      color: var(--pos-text);
      font-weight: 800;
    }
    .rep-info__art {
      position: relative;
      z-index: 1;
      display: flex;
      align-items: center;
      justify-content: flex-end;
      padding-right: 0.25rem;
    }
    .rep-info__chart {
      width: 7.5rem;
      height: auto;
      opacity: 0.9;
    }
    .rep-info__bar--1 { fill: color-mix(in srgb, var(--lux-indigo) 35%, transparent); }
    .rep-info__bar--2 { fill: color-mix(in srgb, var(--lux-indigo) 50%, transparent); }
    .rep-info__bar--3 { fill: color-mix(in srgb, var(--lux-magenta) 45%, transparent); }
    .rep-info__bar--4 { fill: color-mix(in srgb, var(--lux-cyan) 45%, transparent); }
    .rep-info__pie {
      stroke: color-mix(in srgb, var(--lux-indigo) 30%, transparent);
      fill: color-mix(in srgb, var(--lux-indigo) 8%, transparent);
    }
    .rep-info__pie-slice {
      fill: color-mix(in srgb, var(--lux-magenta) 35%, transparent);
    }
    @media (max-width: 900px) {
      .rep-top-row {
        grid-template-columns: 1fr;
      }
    }
    @media (max-width: 760px) {
      .rep__head {
        align-items: stretch;
        flex-direction: column;
      }
      .rep__toolbar {
        justify-content: stretch;
      }
      .rep-btn {
        flex: 1 1 auto;
        justify-content: center;
      }
      .rep-kpi {
        grid-template-columns: 1fr;
      }
      .rep-info {
        grid-template-columns: 1fr;
      }
      .rep-info__art {
        display: none;
      }
    }
  `,
})
export class PosReportesPage implements OnInit {
  private readonly api = inject(PosBackendApiService);
  private readonly toast = inject(PosToastService);

  readonly report = signal<PosSalesReportResponse | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly hasData = computed(() => !!this.report());

  from = '';
  to = '';

  ngOnInit(): void {
    const today = new Date();
    const weekAgo = new Date(today);
    weekAgo.setDate(today.getDate() - 7);
    this.to = today.toISOString().slice(0, 10);
    this.from = weekAgo.toISOString().slice(0, 10);
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.getSalesReport(this.from || undefined, this.to || undefined).subscribe({
      next: (r) => {
        this.report.set(r);
        this.loading.set(false);
      },
      error: () => {
        this.report.set(null);
        this.error.set('No se pudo cargar el reporte (requiere scope pos.reports).');
        this.loading.set(false);
      },
    });
  }

  downloadExcel(): void {
    const html = this.reportHtml('excel');
    const blob = new Blob(['\ufeff', html], { type: 'application/vnd.ms-excel;charset=utf-8' });
    this.downloadBlob(blob, `reporte-ventas-${this.todayKey()}.xls`);
    this.toast.success('Excel generado correctamente.');
  }

  downloadPdf(): void {
    const win = window.open('', '_blank');
    if (!win) {
      const msg = 'El navegador bloqueó la ventana de descarga PDF.';
      this.error.set(msg);
      this.toast.error(msg);
      return;
    }
    win.document.open();
    win.document.write(this.reportHtml('pdf'));
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 250);
    this.toast.info('PDF listo para imprimir o guardar.');
  }

  money(value?: number | null): string {
    return new Intl.NumberFormat('es-EC', {
      style: 'currency',
      currency: 'USD',
    }).format(Number(value ?? 0));
  }

  formatDateLong(value: string): string {
    const date = new Date(`${value}T12:00:00`);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return new Intl.DateTimeFormat('es-EC', { dateStyle: 'long' }).format(date);
  }

  formatDateShort(value: string): string {
    const date = new Date(`${value}T12:00:00`);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return new Intl.DateTimeFormat('es-EC', { dateStyle: 'short' }).format(date);
  }

  private reportHtml(kind: 'excel' | 'pdf'): string {
    const data = this.report();
    if (!data) {
      return '';
    }
    const generated = new Intl.DateTimeFormat('es-EC', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date());
    const dailyRows = data.dailyTotals
      .map(
        (d) => `
          <tr>
            <td>${this.escape(this.formatDateLong(d.date))}</td>
            <td class="num">${d.saleCount}</td>
            <td class="num">${this.escape(this.money(d.totalAmount))}</td>
          </tr>`,
      )
      .join('');
    const productRows = data.topProducts
      .map(
        (p) => `
          <tr>
            <td>${this.escape(p.sku)}</td>
            <td>${this.escape(p.name)}</td>
            <td class="num">${p.quantity}</td>
            <td class="num">${this.escape(this.money(p.amount))}</td>
          </tr>`,
      )
      .join('');
    return `<!doctype html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>Reporte de ventas</title>
          <style>
            body { margin: 0; padding: 28px; font-family: Arial, sans-serif; color: #18202f; background: #fff; }
            .report-head { border-bottom: 3px solid #6366f1; padding-bottom: 14px; margin-bottom: 18px; }
            h1 { margin: 0; font-size: 24px; }
            p { margin: 6px 0 0; color: #687184; font-size: 12px; }
            .brand { font-size: 11px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: #6366f1; }
            h2 { margin: 18px 0 8px; font-size: 14px; }
            table { width: 100%; border-collapse: collapse; font-size: ${kind === 'pdf' ? '10px' : '12px'}; margin-bottom: 16px; }
            th { background: #eef2ff; color: #304036; text-transform: uppercase; font-size: 10px; letter-spacing: .04em; }
            th, td { border: 1px solid #d9e1dc; padding: 7px 8px; text-align: left; white-space: nowrap; }
            .num { text-align: right; font-variant-numeric: tabular-nums; }
          </style>
        </head>
        <body>
          <div class="report-head">
            <div class="brand">Reporte POS</div>
            <h1>Reporte de ventas</h1>
            <p>Rango: ${this.escape(this.formatDateShort(data.from))} — ${this.escape(this.formatDateShort(data.to))}</p>
            <p>Generado: ${this.escape(generated)}</p>
            <p><strong>Tickets:</strong> ${data.saleCount} · <strong>Total:</strong> ${this.escape(this.money(data.totalAmount))}</p>
          </div>
          <h2>Por día</h2>
          <table>
            <thead><tr><th>Fecha</th><th>Tickets</th><th>Total</th></tr></thead>
            <tbody>${dailyRows}</tbody>
          </table>
          <h2>Top productos</h2>
          <table>
            <thead><tr><th>SKU</th><th>Nombre</th><th>Cant.</th><th>Monto</th></tr></thead>
            <tbody>${productRows}</tbody>
          </table>
        </body>
      </html>`;
  }

  private downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  private todayKey(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private escape(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
