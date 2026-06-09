import { CommonModule } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PosBackendApiService } from '../../core/api/pos-backend-api.service';
import type { PosSalesReportResponse } from '../../core/api/pos-backend.types';

@Component({
  selector: 'pos-reportes-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  host: { class: 'pos-page-host' },
  template: `
    <div class="page">
      <header class="head">
        <h1>Reporte de ventas</h1>
        <p>Totales por día y productos más vendidos (backend pos-app).</p>
      </header>

      <div class="filters">
        <label>Desde <input type="date" [(ngModel)]="from" /></label>
        <label>Hasta <input type="date" [(ngModel)]="to" /></label>
        <button type="button" class="btn" [disabled]="loading()" (click)="load()">
          {{ loading() ? 'Cargando…' : 'Consultar' }}
        </button>
      </div>

      @if (error()) {
        <p class="err">{{ error() }}</p>
      }

      @if (report()) {
        <section class="summary">
          <div><span>Ventas</span><strong>{{ report()!.saleCount }}</strong></div>
          <div><span>Total</span><strong>{{ report()!.totalAmount | currency: 'USD' }}</strong></div>
        </section>

        <h2>Por día</h2>
        <table class="grid">
          <thead><tr><th>Fecha</th><th>Tickets</th><th>Total</th></tr></thead>
          <tbody>
            @for (d of report()!.dailyTotals; track d.date) {
              <tr>
                <td>{{ d.date }}</td>
                <td>{{ d.saleCount }}</td>
                <td>{{ d.totalAmount | currency: 'USD' }}</td>
              </tr>
            }
          </tbody>
        </table>

        <h2>Top productos</h2>
        <table class="grid">
          <thead><tr><th>SKU</th><th>Nombre</th><th>Cant.</th><th>Monto</th></tr></thead>
          <tbody>
            @for (p of report()!.topProducts; track p.sku) {
              <tr>
                <td>{{ p.sku }}</td>
                <td>{{ p.name }}</td>
                <td>{{ p.quantity }}</td>
                <td>{{ p.amount | currency: 'USD' }}</td>
              </tr>
            }
          </tbody>
        </table>
      }
    </div>
  `,
  styles: `
    .page { max-width: 960px; margin: 0 auto; }
    .head h1 { margin: 0 0 0.35rem; font-size: 1.25rem; }
    .head p { margin: 0 0 1rem; color: var(--pos-muted); font-size: 0.88rem; }
    .filters { display: flex; flex-wrap: wrap; gap: 0.65rem; align-items: flex-end; margin-bottom: 1rem; }
    label { display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.72rem; font-weight: 600; color: var(--pos-muted); }
    input { border-radius: 8px; border: 1px solid var(--pos-border-strong); background: var(--pos-bg); color: var(--pos-text); padding: 0.45rem 0.55rem; }
    .btn { border: none; border-radius: 8px; padding: 0.45rem 0.85rem; font-weight: 700; background: var(--pos-accent); color: #fff; cursor: pointer; }
    .summary { display: grid; grid-template-columns: repeat(auto-fill, minmax(8rem, 1fr)); gap: 0.65rem; margin-bottom: 1rem; }
    .summary div { padding: 0.75rem; border: 1px solid var(--pos-border); border-radius: 8px; background: var(--pos-surface); }
    .summary span { display: block; font-size: 0.72rem; color: var(--pos-muted); }
    h2 { font-size: 0.95rem; margin: 1rem 0 0.5rem; }
    .grid { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
    .grid th, .grid td { border-bottom: 1px solid var(--pos-border); padding: 0.4rem 0.5rem; text-align: left; }
    .err { color: #f87171; font-size: 0.85rem; }
  `,
})
export class PosReportesPage implements OnInit {
  private readonly api = inject(PosBackendApiService);

  readonly report = signal<PosSalesReportResponse | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

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
        this.error.set('No se pudo cargar el reporte (requiere scope pos.reports)');
        this.loading.set(false);
      },
    });
  }
}
