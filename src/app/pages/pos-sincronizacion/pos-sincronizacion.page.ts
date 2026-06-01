import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { PosOfflineSyncService, type PosOfflineComprobanteRecord, type PosOfflineQueueStatus } from '../../core/offline/pos-offline-sync.service';

type SyncFilter = 'all' | 'pending' | 'error' | 'synced';

@Component({
  selector: 'pos-sincronizacion-page',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section class="sync-page">
      <header class="sync-head">
        <div>
          <span class="eyebrow">Sincronización offline</span>
          <h1>Comprobantes pendientes y enviados</h1>
          <p>Controle la cola local de comprobantes creados sin conexión y su envío posterior al backend.</p>
        </div>
        <div class="sync-actions">
          <button type="button" class="btn btn--ghost pos-focus-ring" (click)="refresh()">Actualizar</button>
          <button type="button" class="btn pos-focus-ring" [disabled]="offline.syncing()" (click)="syncNow()">
            {{ offline.syncing() ? 'Sincronizando...' : 'Sincronizar ahora' }}
          </button>
        </div>
      </header>

      <div class="summary">
        <div class="metric">
          <span>Estado</span>
          <strong [class.metric__online]="online()" [class.metric__offline]="!online()">{{ online() ? 'Online' : 'Offline' }}</strong>
        </div>
        <div class="metric">
          <span>Pendientes</span>
          <strong>{{ pendingCount() }}</strong>
        </div>
        <div class="metric">
          <span>Errores</span>
          <strong>{{ errorCount() }}</strong>
        </div>
        <div class="metric">
          <span>Sincronizados</span>
          <strong>{{ syncedCount() }}</strong>
        </div>
      </div>

      @if (offline.lastMessage()) {
        <p class="notice">{{ offline.lastMessage() }}</p>
      }

      <div class="filters" role="tablist" aria-label="Filtro de sincronización">
        <button type="button" class="filter pos-focus-ring" [class.filter--on]="filter() === 'all'" (click)="filter.set('all')">Todos</button>
        <button type="button" class="filter pos-focus-ring" [class.filter--on]="filter() === 'pending'" (click)="filter.set('pending')">Pendientes</button>
        <button type="button" class="filter pos-focus-ring" [class.filter--on]="filter() === 'error'" (click)="filter.set('error')">Errores</button>
        <button type="button" class="filter pos-focus-ring" [class.filter--on]="filter() === 'synced'" (click)="filter.set('synced')">Sincronizados</button>
      </div>

      <div class="list">
        @for (item of filteredRecords(); track item.localId) {
          <article class="row" [class.row--error]="item.status === 'ERROR'" [class.row--synced]="item.status === 'SYNCED'">
            <div class="row__main">
              <span class="status" [class.status--pending]="item.status === 'PENDING'" [class.status--syncing]="item.status === 'SYNCING'" [class.status--synced]="item.status === 'SYNCED'" [class.status--error]="item.status === 'ERROR'">
                {{ statusLabel(item.status) }}
              </span>
              <strong>{{ item.request.tipo }} · {{ item.offlineDeviceId }}-{{ item.offlineSequence }}</strong>
              <small>{{ item.offlineCreatedAt | date: 'short' }} · {{ item.request.cliente.razonSocial }}</small>
              @if (item.syncError) {
                <p>{{ item.syncError }}</p>
              }
            </div>
            <div class="row__meta">
              <strong>{{ item.request.totales.importeTotal | currency: item.request.totales.currency || 'USD' : 'symbol-narrow' : '1.2-2' }}</strong>
              <span>{{ item.request.items.length }} línea(s)</span>
              @if (item.remoteComprobanteId) {
                <span>ID {{ item.remoteComprobanteId }}</span>
              }
            </div>
          </article>
        } @empty {
          <div class="empty">
            <strong>No hay comprobantes en este filtro.</strong>
            <span>Cuando el POS trabaje sin conexión, los comprobantes aparecerán aquí.</span>
          </div>
        }
      </div>
    </section>
  `,
  styles: `
    :host {
      flex: 1;
      min-height: 0;
      display: flex;
    }
    .sync-page {
      flex: 1;
      min-height: 0;
      overflow: auto;
      padding: var(--pos-content-pad-y) var(--pos-content-pad-x);
    }
    .sync-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 1rem;
      margin-bottom: 0.85rem;
    }
    .eyebrow {
      color: var(--pos-accent-hover);
      font-size: 0.64rem;
      font-weight: 850;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    h1 {
      margin: 0.15rem 0 0;
      font-size: 1.05rem;
      line-height: 1.2;
    }
    p {
      margin: 0.35rem 0 0;
      color: var(--pos-muted);
      font-size: 0.78rem;
      line-height: 1.45;
    }
    .sync-actions,
    .filters {
      display: flex;
      gap: 0.45rem;
      flex-wrap: wrap;
    }
    .btn,
    .filter {
      border: 1px solid var(--pos-border-strong);
      border-radius: var(--pos-radius-sm);
      background: var(--pos-accent);
      color: #fff;
      padding: 0.48rem 0.7rem;
      font-size: 0.76rem;
      font-weight: 800;
      cursor: pointer;
    }
    .btn--ghost,
    .filter {
      background: var(--pos-surface);
      color: var(--pos-text);
    }
    .btn:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }
    .summary {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 0.65rem;
      margin-bottom: 0.7rem;
    }
    .metric,
    .row,
    .empty,
    .notice {
      border: 1px solid var(--pos-border);
      border-radius: var(--pos-radius-sm);
      background: var(--pos-surface);
      box-shadow: 0 12px 30px -28px rgba(17, 24, 39, 0.35);
    }
    .metric {
      padding: 0.75rem;
    }
    .metric span {
      display: block;
      color: var(--pos-muted);
      font-size: 0.68rem;
      font-weight: 750;
    }
    .metric strong {
      display: block;
      margin-top: 0.2rem;
      font-size: 1rem;
    }
    .metric__online {
      color: #047857;
    }
    .metric__offline {
      color: #b91c1c;
    }
    .notice {
      padding: 0.65rem 0.75rem;
      margin-bottom: 0.7rem;
      color: var(--pos-muted);
    }
    .filters {
      margin-bottom: 0.7rem;
    }
    .filter--on {
      border-color: color-mix(in srgb, var(--pos-accent) 50%, var(--pos-border));
      background: var(--pos-accent-muted);
      color: var(--pos-accent-hover);
    }
    .list {
      display: grid;
      gap: 0.55rem;
    }
    .row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 0.8rem;
      padding: 0.72rem;
    }
    .row__main {
      min-width: 0;
    }
    .row__main strong,
    .row__main small,
    .row__main p,
    .row__meta span {
      display: block;
    }
    .row__main strong {
      margin-top: 0.35rem;
      font-size: 0.84rem;
    }
    .row__main small,
    .row__meta span {
      margin-top: 0.18rem;
      color: var(--pos-muted);
      font-size: 0.68rem;
    }
    .row__main p {
      color: #b91c1c;
    }
    .row__meta {
      text-align: right;
      white-space: nowrap;
    }
    .status {
      display: inline-flex;
      border-radius: 999px;
      padding: 0.14rem 0.42rem;
      font-size: 0.58rem;
      font-weight: 850;
      text-transform: uppercase;
      background: var(--pos-surface-2);
      color: var(--pos-muted);
    }
    .status--pending,
    .status--syncing {
      background: rgba(251, 191, 36, 0.16);
      color: #92400e;
    }
    .status--synced {
      background: rgba(16, 185, 129, 0.14);
      color: #047857;
    }
    .status--error {
      background: rgba(248, 113, 113, 0.14);
      color: #b91c1c;
    }
    .empty {
      padding: 1rem;
      color: var(--pos-muted);
    }
    .empty strong,
    .empty span {
      display: block;
    }
    @media (max-width: 760px) {
      .sync-head,
      .row {
        grid-template-columns: 1fr;
        display: grid;
      }
      .summary {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .row__meta {
        text-align: left;
      }
    }
  `,
})
export class PosSincronizacionPage implements OnInit {
  readonly offline = inject(PosOfflineSyncService);
  readonly filter = signal<SyncFilter>('all');
  readonly online = signal(navigator.onLine);

  readonly pendingCount = computed(() => this.countBy('PENDING') + this.countBy('ERROR'));
  readonly errorCount = computed(() => this.countBy('ERROR'));
  readonly syncedCount = computed(() => this.countBy('SYNCED'));

  readonly filteredRecords = computed(() => {
    const filter = this.filter();
    const records = this.offline.records();
    if (filter === 'pending') {
      return records.filter((r) => r.status === 'PENDING' || r.status === 'SYNCING');
    }
    if (filter === 'error') {
      return records.filter((r) => r.status === 'ERROR');
    }
    if (filter === 'synced') {
      return records.filter((r) => r.status === 'SYNCED');
    }
    return records;
  });

  ngOnInit(): void {
    void this.offline.loadRecords();
    window.addEventListener('online', this.updateOnline);
    window.addEventListener('offline', this.updateOnline);
  }

  refresh(): void {
    this.updateOnline();
    void this.offline.loadRecords();
  }

  syncNow(): void {
    void this.offline.syncPending();
  }

  statusLabel(status: PosOfflineQueueStatus): string {
    switch (status) {
      case 'PENDING':
        return 'Pendiente';
      case 'SYNCING':
        return 'Enviando';
      case 'SYNCED':
        return 'Sincronizado';
      case 'ERROR':
        return 'Error';
    }
  }

  private readonly updateOnline = (): void => {
    this.online.set(navigator.onLine);
  };

  private countBy(status: PosOfflineQueueStatus): number {
    return this.offline.records().filter((r) => r.status === status).length;
  }
}
