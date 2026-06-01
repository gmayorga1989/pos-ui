import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { PosBackendApiService } from '../../core/api/pos-backend-api.service';
import type { PosCajaHistoryItem } from '../../core/api/pos-backend.types';

type ReportRow = PosCajaHistoryItem;

@Component({
  selector: 'pos-historial-page',
  standalone: true,
  imports: [CommonModule],
  host: { class: 'pos-page-host' },
  template: `
    <div class="page">
      <header class="head">
        <div>
          <span class="eyebrow">Reportes POS</span>
          <h1>Historial de caja</h1>
          <p>Cierres, cobros y diferencias listos para revisión y descarga.</p>
        </div>
        <div class="toolbar">
          <button type="button" class="btn btn--ghost pos-focus-ring" (click)="load()" [disabled]="loading()">Actualizar</button>
          <button type="button" class="btn pos-focus-ring" (click)="downloadExcel()" [disabled]="!rows().length">Excel</button>
          <button type="button" class="btn btn--dark pos-focus-ring" (click)="downloadPdf()" [disabled]="!rows().length">PDF</button>
        </div>
      </header>

      @if (error()) {
        <div class="notice" role="status">{{ error() }}</div>
      }

      <section class="summary" aria-label="Totales del reporte">
        <div>
          <span>Ventas</span>
          <strong>{{ totals().totalVentas | currency: 'USD' : 'symbol-narrow' : '1.2-2' }}</strong>
        </div>
        <div>
          <span>Efectivo</span>
          <strong>{{ totals().efectivoCobros | currency: 'USD' : 'symbol-narrow' : '1.2-2' }}</strong>
        </div>
        <div>
          <span>Tarjeta</span>
          <strong>{{ totals().tarjetaCobros | currency: 'USD' : 'symbol-narrow' : '1.2-2' }}</strong>
        </div>
        <div>
          <span>Transferencia</span>
          <strong>{{ totals().transferCobros | currency: 'USD' : 'symbol-narrow' : '1.2-2' }}</strong>
        </div>
        <div>
          <span>Diferencia</span>
          <strong [class.neg]="totals().cashDifference < 0">{{ totals().cashDifference | currency: 'USD' : 'symbol-narrow' : '1.2-2' }}</strong>
        </div>
      </section>

      <section class="grid-shell" aria-label="Grid de historial de caja">
        <div class="grid-scroll">
          <table class="report-grid">
            <thead>
              <tr>
                <th class="actions-col">Acciones</th>
                <th>Estado</th>
                <th>Apertura</th>
                <th>Cierre</th>
                <th>Abrió</th>
                <th>Cerró</th>
                <th class="num">Fondo</th>
                <th class="num">Ventas</th>
                <th class="num">Efectivo</th>
                <th class="num">Tarjeta</th>
                <th class="num">Transferencia</th>
                <th class="num">Esperado</th>
                <th class="num">Contado</th>
                <th class="num">Diferencia</th>
              </tr>
            </thead>
            <tbody>
              @for (row of rows(); track row.id) {
                <tr [class.selected]="selected()?.id === row.id">
                  <td class="actions-cell">
                    <button type="button" class="icon-btn pos-focus-ring" title="Ver detalle" (click)="select(row)">Ver</button>
                  </td>
                  <td><span class="badge" [class.badge--open]="row.status === 'OPEN'">{{ labelStatus(row.status) }}</span></td>
                  <td>{{ formatDate(row.openedAt) }}</td>
                  <td>{{ row.closedAt ? formatDate(row.closedAt) : '-' }}</td>
                  <td>{{ row.openedBy || '-' }}</td>
                  <td>{{ row.closedBy || '-' }}</td>
                  <td class="num">{{ money(row.openingFloat) }}</td>
                  <td class="num">{{ money(row.totalVentas) }}</td>
                  <td class="num">{{ money(row.efectivoCobros) }}</td>
                  <td class="num">{{ money(row.tarjetaCobros) }}</td>
                  <td class="num">{{ money(row.transferCobros) }}</td>
                  <td class="num">{{ money(row.expectedCash) }}</td>
                  <td class="num">{{ money(row.countedCash) }}</td>
                  <td class="num" [class.neg]="amount(row.cashDifference) < 0">{{ money(row.cashDifference) }}</td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="14" class="empty">{{ loading() ? 'Cargando historial...' : 'No hay cierres de caja para mostrar.' }}</td>
                </tr>
              }
            </tbody>
            <tfoot>
              <tr>
                <td colspan="6">Totales</td>
                <td class="num">{{ money(totals().openingFloat) }}</td>
                <td class="num">{{ money(totals().totalVentas) }}</td>
                <td class="num">{{ money(totals().efectivoCobros) }}</td>
                <td class="num">{{ money(totals().tarjetaCobros) }}</td>
                <td class="num">{{ money(totals().transferCobros) }}</td>
                <td class="num">{{ money(totals().expectedCash) }}</td>
                <td class="num">{{ money(totals().countedCash) }}</td>
                <td class="num" [class.neg]="totals().cashDifference < 0">{{ money(totals().cashDifference) }}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      @if (selected(); as row) {
        <aside class="detail">
          <div>
            <span class="eyebrow">Detalle</span>
            <h2>{{ row.id }}</h2>
          </div>
          <dl>
            <div><dt>Notas</dt><dd>{{ row.notes || '-' }}</dd></div>
            <div><dt>Conteo tarjeta</dt><dd>{{ money(row.countedCard) }}</dd></div>
            <div><dt>Conteo transferencia</dt><dd>{{ money(row.countedTransfer) }}</dd></div>
            <div><dt>Denominaciones</dt><dd>{{ denominationSummary(row) }}</dd></div>
          </dl>
        </aside>
      }
    </div>
  `,
  styles: `
    .page {
      display: grid;
      gap: 1rem;
    }
    .head {
      display: flex;
      justify-content: space-between;
      gap: 1rem;
      align-items: end;
    }
    .eyebrow {
      display: block;
      margin-bottom: 0.25rem;
      font-size: 0.68rem;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--pos-accent-hover);
    }
    .head h1,
    .detail h2 {
      margin: 0;
      font-size: 1.25rem;
      font-weight: 800;
    }
    .head p {
      margin: 0.3rem 0 0;
      color: var(--pos-muted);
      font-size: 0.86rem;
    }
    .toolbar {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 0.45rem;
    }
    .btn,
    .icon-btn {
      border: 1px solid var(--pos-border);
      border-radius: var(--pos-radius-sm);
      background: var(--pos-surface);
      color: var(--pos-text);
      font-weight: 800;
      cursor: pointer;
    }
    .btn {
      min-height: 2.3rem;
      padding: 0 0.85rem;
    }
    .btn--dark {
      background: var(--pos-text);
      border-color: var(--pos-text);
      color: var(--pos-surface);
    }
    .btn--ghost {
      color: var(--pos-muted);
    }
    .btn:disabled {
      opacity: 0.48;
      cursor: not-allowed;
    }
    .notice {
      border: 1px solid color-mix(in srgb, var(--pos-danger) 45%, transparent);
      border-radius: var(--pos-radius-sm);
      padding: 0.65rem 0.75rem;
      background: color-mix(in srgb, var(--pos-danger) 10%, var(--pos-surface));
      color: var(--pos-danger);
      font-size: 0.84rem;
      font-weight: 700;
    }
    .summary {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 0.65rem;
    }
    .summary div {
      border: 1px solid var(--pos-border);
      border-radius: var(--pos-radius-sm);
      background: var(--pos-surface);
      padding: 0.65rem 0.75rem;
    }
    .summary span {
      display: block;
      color: var(--pos-muted);
      font-size: 0.72rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .summary strong {
      display: block;
      margin-top: 0.25rem;
      font-size: 1.05rem;
    }
    .grid-shell {
      border: 1px solid var(--pos-border);
      border-radius: var(--pos-radius-sm);
      background: var(--pos-surface);
      overflow: hidden;
    }
    .grid-scroll {
      overflow: auto;
      max-height: calc(100vh - 19rem);
    }
    .report-grid {
      width: 100%;
      min-width: 980px;
      border-collapse: collapse;
      font-size: 0.78rem;
    }
    th,
    td {
      padding: 0.58rem 0.65rem;
      border-bottom: 1px solid var(--pos-border);
      text-align: left;
      white-space: nowrap;
    }
    thead th {
      position: sticky;
      top: 0;
      z-index: 2;
      background: color-mix(in srgb, var(--pos-surface) 88%, var(--pos-border));
      color: var(--pos-muted);
      font-size: 0.68rem;
      font-weight: 900;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .actions-col,
    .actions-cell {
      position: sticky;
      left: 0;
      z-index: 3;
      background: var(--pos-surface);
      box-shadow: 1px 0 0 var(--pos-border);
    }
    thead .actions-col {
      background: color-mix(in srgb, var(--pos-surface) 88%, var(--pos-border));
    }
    tbody tr:hover td {
      background: color-mix(in srgb, var(--pos-accent) 5%, var(--pos-surface));
    }
    tbody tr:hover .actions-cell,
    tbody tr.selected .actions-cell {
      background: color-mix(in srgb, var(--pos-accent) 8%, var(--pos-surface));
    }
    tbody tr.selected td {
      background: color-mix(in srgb, var(--pos-accent) 8%, var(--pos-surface));
    }
    .icon-btn {
      min-width: 2.7rem;
      min-height: 1.8rem;
      padding: 0 0.45rem;
      font-size: 0.72rem;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      min-height: 1.35rem;
      padding: 0 0.45rem;
      border-radius: 999px;
      background: color-mix(in srgb, var(--pos-accent) 10%, var(--pos-surface));
      color: var(--pos-accent-hover);
      font-size: 0.66rem;
      font-weight: 900;
      text-transform: uppercase;
    }
    .badge--open {
      background: color-mix(in srgb, var(--pos-warn) 16%, var(--pos-surface));
      color: var(--pos-warn);
    }
    .num {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .neg {
      color: var(--pos-danger);
    }
    tfoot td {
      position: sticky;
      bottom: 0;
      z-index: 2;
      background: color-mix(in srgb, var(--pos-surface) 86%, var(--pos-border));
      font-weight: 900;
    }
    .empty {
      padding: 1.8rem;
      text-align: center;
      color: var(--pos-muted);
    }
    .detail {
      border: 1px solid var(--pos-border);
      border-radius: var(--pos-radius-sm);
      background: var(--pos-surface);
      padding: 0.85rem;
      display: grid;
      gap: 0.75rem;
    }
    .detail dl {
      margin: 0;
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 0.65rem;
    }
    .detail div {
      min-width: 0;
    }
    .detail dt {
      color: var(--pos-muted);
      font-size: 0.7rem;
      font-weight: 800;
      text-transform: uppercase;
    }
    .detail dd {
      margin: 0.25rem 0 0;
      font-size: 0.84rem;
      font-weight: 700;
      overflow-wrap: anywhere;
    }
    @media (max-width: 760px) {
      .head {
        align-items: stretch;
        flex-direction: column;
      }
      .toolbar {
        justify-content: stretch;
      }
      .btn {
        flex: 1 1 auto;
      }
      .summary,
      .detail dl {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .grid-scroll {
        max-height: calc(100vh - 23rem);
      }
    }
  `,
})
export class PosHistorialPage implements OnInit {
  private readonly api = inject(PosBackendApiService);

  readonly rows = signal<ReportRow[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly selected = signal<ReportRow | null>(null);

  readonly totals = computed(() =>
    this.rows().reduce(
      (acc, row) => ({
        openingFloat: acc.openingFloat + this.amount(row.openingFloat),
        totalVentas: acc.totalVentas + this.amount(row.totalVentas),
        efectivoCobros: acc.efectivoCobros + this.amount(row.efectivoCobros),
        tarjetaCobros: acc.tarjetaCobros + this.amount(row.tarjetaCobros),
        transferCobros: acc.transferCobros + this.amount(row.transferCobros),
        expectedCash: acc.expectedCash + this.amount(row.expectedCash),
        countedCash: acc.countedCash + this.amount(row.countedCash),
        cashDifference: acc.cashDifference + this.amount(row.cashDifference),
      }),
      {
        openingFloat: 0,
        totalVentas: 0,
        efectivoCobros: 0,
        tarjetaCobros: 0,
        transferCobros: 0,
        expectedCash: 0,
        countedCash: 0,
        cashDifference: 0,
      },
    ),
  );

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const response = await firstValueFrom(this.api.getCajaHistorial());
      const rows = response.items ?? [];
      this.rows.set(rows);
      this.selected.set(rows[0] ?? null);
    } catch (err) {
      this.rows.set(this.demoRows());
      this.selected.set(this.rows()[0] ?? null);
      this.error.set(this.errorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  select(row: ReportRow): void {
    this.selected.set(row);
  }

  labelStatus(status: string): string {
    const upper = String(status ?? '').toUpperCase();
    if (upper === 'OPEN') {
      return 'Abierta';
    }
    if (upper === 'CLOSED') {
      return 'Cerrada';
    }
    return upper || '-';
  }

  formatDate(value?: string | null): string {
    if (!value) {
      return '-';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return new Intl.DateTimeFormat('es-EC', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(date);
  }

  money(value?: number | null): string {
    return new Intl.NumberFormat('es-EC', {
      style: 'currency',
      currency: 'USD',
    }).format(this.amount(value));
  }

  amount(value?: number | null): number {
    const n = Number(value ?? 0);
    return Number.isFinite(n) ? n : 0;
  }

  denominationSummary(row: ReportRow): string {
    const denominations = row.denominations ?? [];
    if (!denominations.length) {
      return '-';
    }
    return denominations
      .filter((d) => this.amount(d.quantity) > 0)
      .map((d) => `${this.money(d.denomination)} x ${d.quantity}`)
      .join(', ');
  }

  downloadExcel(): void {
    const html = this.reportHtml('excel');
    const blob = new Blob(['\ufeff', html], { type: 'application/vnd.ms-excel;charset=utf-8' });
    this.downloadBlob(blob, `historial-caja-${this.todayKey()}.xls`);
  }

  downloadPdf(): void {
    const win = window.open('', '_blank');
    if (!win) {
      this.error.set('El navegador bloqueo la ventana de descarga PDF.');
      return;
    }
    win.document.open();
    win.document.write(this.reportHtml('pdf'));
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 250);
  }

  private reportHtml(kind: 'excel' | 'pdf'): string {
    const generated = new Intl.DateTimeFormat('es-EC', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date());
    const rows = this.rows()
      .map(
        (row) => `
          <tr>
            <td>${this.escape(this.labelStatus(row.status))}</td>
            <td>${this.escape(this.formatDate(row.openedAt))}</td>
            <td>${this.escape(row.closedAt ? this.formatDate(row.closedAt) : '-')}</td>
            <td>${this.escape(row.openedBy || '-')}</td>
            <td>${this.escape(row.closedBy || '-')}</td>
            <td class="num">${this.money(row.openingFloat)}</td>
            <td class="num">${this.money(row.totalVentas)}</td>
            <td class="num">${this.money(row.efectivoCobros)}</td>
            <td class="num">${this.money(row.tarjetaCobros)}</td>
            <td class="num">${this.money(row.transferCobros)}</td>
            <td class="num">${this.money(row.expectedCash)}</td>
            <td class="num">${this.money(row.countedCash)}</td>
            <td class="num">${this.money(row.cashDifference)}</td>
          </tr>`,
      )
      .join('');
    const totals = this.totals();
    return `<!doctype html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>Historial de caja</title>
          <style>
            body { margin: 0; padding: 28px; font-family: Arial, sans-serif; color: #18202f; background: #fff; }
            .report-head { border-bottom: 3px solid #1f6f5b; padding-bottom: 14px; margin-bottom: 18px; display: flex; justify-content: space-between; gap: 18px; }
            h1 { margin: 0; font-size: 24px; }
            p { margin: 6px 0 0; color: #687184; font-size: 12px; }
            .brand { font-size: 11px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: #1f6f5b; }
            table { width: 100%; border-collapse: collapse; font-size: ${kind === 'pdf' ? '10px' : '12px'}; }
            th { background: #edf4f1; color: #304036; text-transform: uppercase; font-size: 10px; letter-spacing: .04em; }
            th, td { border: 1px solid #d9e1dc; padding: 7px 8px; text-align: left; white-space: nowrap; }
            .num { text-align: right; font-variant-numeric: tabular-nums; }
            tfoot td { background: #15241f; color: #fff; font-weight: 800; }
            @media print { body { padding: 16px; } .report-head { break-after: avoid; } }
          </style>
        </head>
        <body>
          <div class="report-head">
            <div>
              <div class="brand">Reporte POS</div>
              <h1>Historial de caja</h1>
              <p>Generado: ${this.escape(generated)}</p>
            </div>
            <div>
              <p><strong>Total ventas:</strong> ${this.money(totals.totalVentas)}</p>
              <p><strong>Diferencia:</strong> ${this.money(totals.cashDifference)}</p>
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th>Estado</th><th>Apertura</th><th>Cierre</th><th>Abrió</th><th>Cerró</th>
                <th>Fondo</th><th>Ventas</th><th>Efectivo</th><th>Tarjeta</th><th>Transferencia</th><th>Esperado</th><th>Contado</th><th>Diferencia</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
            <tfoot>
              <tr>
                <td colspan="5">Totales</td>
                <td class="num">${this.money(totals.openingFloat)}</td>
                <td class="num">${this.money(totals.totalVentas)}</td>
                <td class="num">${this.money(totals.efectivoCobros)}</td>
                <td class="num">${this.money(totals.tarjetaCobros)}</td>
                <td class="num">${this.money(totals.transferCobros)}</td>
                <td class="num">${this.money(totals.expectedCash)}</td>
                <td class="num">${this.money(totals.countedCash)}</td>
                <td class="num">${this.money(totals.cashDifference)}</td>
              </tr>
            </tfoot>
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

  private errorMessage(err: unknown): string {
    if (err instanceof Error) {
      return `${err.message}. Mostrando datos de demostracion hasta que el backend responda.`;
    }
    return 'No se pudo cargar el historial desde el servidor. Mostrando datos de demostracion.';
  }

  private demoRows(): ReportRow[] {
    const now = new Date();
    return [
      {
        id: 'DEMO-001',
        status: 'CLOSED',
        openedAt: new Date(now.getTime() - 1000 * 60 * 60 * 8).toISOString(),
        closedAt: now.toISOString(),
        openingFloat: 80,
        totalVentas: 342.9,
        efectivoCobros: 180.4,
        tarjetaCobros: 112.5,
        transferCobros: 50,
        expectedCash: 260.4,
        countedCash: 260,
        cashDifference: -0.4,
        openedBy: 'Caja demo',
        closedBy: 'Supervisor',
      },
    ];
  }
}
