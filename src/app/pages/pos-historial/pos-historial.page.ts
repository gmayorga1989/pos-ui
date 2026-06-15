import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { PosBackendApiService } from '../../core/api/pos-backend-api.service';
import { mapCajaHistorialResponse } from '../../core/api/pos-backend.mappers';
import type { PosCajaHistoryItem } from '../../core/api/pos-backend.types';
import { PosAuthService } from '../../core/auth/pos-auth.service';
import { decodeJwtPayload, readPosSessionDisplay } from '../../core/layout/pos-jwt-hint.util';
import { PosToastService } from '../../core/ui/pos-toast.service';
import { customerDisplayInitials } from '../../shared/customer/pos-sale-customer.util';

type ReportRow = PosCajaHistoryItem;

interface KpiCard {
  key: string;
  label: string;
  hint: string;
  amount: number;
  tone: 'sales' | 'cash' | 'card' | 'transfer' | 'diff';
}

@Component({
  selector: 'pos-historial-page',
  standalone: true,
  imports: [CommonModule],
  host: { class: 'pos-page-host' },
  template: `
    <div class="hist">
      <header class="hist__head">
        <div class="hist__intro">
          <span class="hist__eyebrow">Reportes POS</span>
          <h1 class="hist__title">Historial de caja</h1>
          <p class="hist__subtitle">Cierres, cobros y diferencias listos para revisión y descarga.</p>
        </div>
        <div class="hist__toolbar">
          <button
            type="button"
            class="hist-btn hist-btn--ghost pos-focus-ring"
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
            class="hist-btn hist-btn--excel pos-focus-ring"
            (click)="downloadExcel()"
            [disabled]="!rows().length">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="4" y="3" width="16" height="18" rx="2" stroke="currentColor" stroke-width="1.6" />
              <path d="M8 8h8M8 12h8M8 16h5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
            </svg>
            Excel
          </button>
          <button
            type="button"
            class="hist-btn hist-btn--pdf pos-focus-ring"
            (click)="downloadPdf()"
            [disabled]="!rows().length">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M8 4h9l3 3v13H8a1 1 0 01-1-1V5a1 1 0 011-1z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
              <path d="M16 4v4h4M10 13h6M10 17h4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
            </svg>
            PDF
          </button>
        </div>
      </header>

      @if (error()) {
        <div class="hist__notice" role="status">{{ error() }}</div>
      }

      <section class="hist-kpi" aria-label="Totales del reporte">
        @for (card of kpiCards(); track card.key) {
          <article class="hist-kpi__card" [class]="'hist-kpi__card--' + card.tone">
            <span class="hist-kpi__icon" aria-hidden="true">
              @switch (card.tone) {
                @case ('sales') {
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <path d="M6 6h12l-1.2 11H7.2L6 6zM9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                }
                @case ('cash') {
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <rect x="3" y="7" width="18" height="10" rx="2" stroke="currentColor" stroke-width="1.6" />
                    <circle cx="12" cy="12" r="2" stroke="currentColor" stroke-width="1.5" />
                  </svg>
                }
                @case ('card') {
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <rect x="3" y="6" width="18" height="12" rx="2" stroke="currentColor" stroke-width="1.6" />
                    <path d="M3 10h18" stroke="currentColor" stroke-width="1.6" />
                  </svg>
                }
                @case ('transfer') {
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <path d="M7 7h11M7 7l3-3M7 7l3 3M17 17H6M17 17l-3 3M17 17l-3-3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                }
                @default {
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <path d="M12 3v18M8 8h8M6 12h12M8 16h8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
                  </svg>
                }
              }
            </span>
            <div class="hist-kpi__copy">
              <span class="hist-kpi__label">{{ card.label }}</span>
              <strong class="hist-kpi__amount" [class.hist-kpi__amount--neg]="card.tone === 'diff' && card.amount < 0">
                {{ card.amount | currency: 'USD' : 'symbol-narrow' : '1.2-2' }}
              </strong>
              <small class="hist-kpi__hint">{{ card.hint }}</small>
            </div>
          </article>
        }
      </section>

      <section class="hist-grid-shell" aria-label="Grid de historial de caja">
        <div class="hist-grid-scroll">
          <table class="hist-grid">
            <thead>
              <tr>
                <th class="hist-grid__sticky-actions">Acciones</th>
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
                <tr [class.hist-grid__row--selected]="selected()?.id === row.id" (click)="select(row)">
                  <td class="hist-grid__sticky-actions" (click)="$event.stopPropagation()">
                    <div class="hist-grid__actions">
                      <button type="button" class="hist-grid__view pos-focus-ring" (click)="select(row)">Ver</button>
                      <button
                        type="button"
                        class="hist-grid__menu pos-focus-ring"
                        title="Más acciones"
                        (click)="toggleRowMenu(row.id)">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <circle cx="12" cy="6" r="1.4" fill="currentColor" />
                          <circle cx="12" cy="12" r="1.4" fill="currentColor" />
                          <circle cx="12" cy="18" r="1.4" fill="currentColor" />
                        </svg>
                      </button>
                      @if (rowMenuId() === row.id) {
                        <div class="hist-grid__menu-pop">
                          <button type="button" class="pos-focus-ring" (click)="select(row); closeRowMenu()">Ver detalle</button>
                          <button type="button" class="pos-focus-ring" (click)="copyShiftId(row.id)">Copiar ID</button>
                        </div>
                      }
                    </div>
                  </td>
                  <td>
                    <span class="hist-badge" [class.hist-badge--open]="row.status === 'OPEN'" [class.hist-badge--closed]="row.status === 'CLOSED'">
                      {{ labelStatus(row.status) }}
                    </span>
                  </td>
                  <td>{{ formatDate(row.openedAt) }}</td>
                  <td>{{ row.closedAt ? formatDate(row.closedAt) : '—' }}</td>
                  <td>
                    @if (row.openedBy) {
                      <span class="hist-person">
                        <span class="hist-person__avatar" aria-hidden="true">{{ personInitials(row.openedBy) }}</span>
                        <span class="hist-person__name">{{ row.openedBy }}</span>
                      </span>
                    } @else {
                      —
                    }
                  </td>
                  <td>
                    @if (row.closedBy) {
                      <span class="hist-person">
                        <span class="hist-person__avatar hist-person__avatar--muted" aria-hidden="true">{{ personInitials(row.closedBy) }}</span>
                        <span class="hist-person__name">{{ row.closedBy }}</span>
                      </span>
                    } @else {
                      —
                    }
                  </td>
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
                  <td colspan="14" class="hist-grid__empty">
                    {{ loading() ? 'Cargando historial...' : 'No hay cierres de caja para mostrar.' }}
                  </td>
                </tr>
              }
            </tbody>
            @if (rows().length) {
              <tfoot>
                <tr>
                  <td colspan="6" class="hist-grid__totals-label">Totales</td>
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
            }
          </table>
        </div>
      </section>

      @if (selected(); as row) {
        <section class="hist-detail" aria-label="Detalle del turno">
          <div class="hist-detail__main">
            <header class="hist-detail__head">
              <div>
                <span class="hist__eyebrow">Detalle del turno</span>
                <h2 class="hist-detail__title">{{ labelStatus(row.status) }} · {{ formatDate(row.openedAt) }}</h2>
                <p class="hist-detail__meta">
                  Abierto por <strong>{{ row.openedBy || '—' }}</strong>
                  @if (row.closedBy) {
                    · Cerrado por <strong>{{ row.closedBy }}</strong>
                  }
                </p>
                <div class="hist-detail__id-row">
                  <span class="hist-detail__id-label">ID</span>
                  <code class="hist-detail__id">{{ row.id }}</code>
                  <button type="button" class="hist-detail__copy pos-focus-ring" title="Copiar ID" (click)="copyShiftId(row.id)">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <rect x="8" y="8" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.6" />
                      <path d="M6 16H5a1 1 0 01-1-1V5a1 1 0 011-1h10a1 1 0 011 1v1" stroke="currentColor" stroke-width="1.6" />
                    </svg>
                  </button>
                </div>
              </div>
            </header>
            <div class="hist-detail__grid">
              <article class="hist-detail__item">
                <span class="hist-detail__item-icon" aria-hidden="true">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <path d="M6 4h12v16H6zM9 8h6M9 12h6M9 16h4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
                  </svg>
                </span>
                <div>
                  <span class="hist-detail__item-label">Notas</span>
                  <p class="hist-detail__item-value">{{ row.notes?.trim() || '—' }}</p>
                </div>
              </article>
              <article class="hist-detail__item">
                <span class="hist-detail__item-icon hist-detail__item-icon--card" aria-hidden="true">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <rect x="3" y="6" width="18" height="12" rx="2" stroke="currentColor" stroke-width="1.6" />
                    <path d="M3 10h18" stroke="currentColor" stroke-width="1.6" />
                  </svg>
                </span>
                <div>
                  <span class="hist-detail__item-label">Conteo tarjeta</span>
                  <p class="hist-detail__item-value">{{ money(row.countedCard) }}</p>
                </div>
                <button type="button" class="hist-detail__mini-copy pos-focus-ring" title="Copiar" (click)="copyValue(money(row.countedCard), 'Conteo tarjeta')">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><rect x="8" y="8" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.6" /><path d="M6 16H5a1 1 0 01-1-1V5a1 1 0 011-1h10a1 1 0 011 1v1" stroke="currentColor" stroke-width="1.6" /></svg>
                </button>
              </article>
              <article class="hist-detail__item">
                <span class="hist-detail__item-icon hist-detail__item-icon--transfer" aria-hidden="true">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <path d="M7 7h11M7 7l3-3M7 7l3 3M17 17H6M17 17l-3 3M17 17l-3-3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                </span>
                <div>
                  <span class="hist-detail__item-label">Conteo transferencia</span>
                  <p class="hist-detail__item-value">{{ money(row.countedTransfer) }}</p>
                </div>
                <button type="button" class="hist-detail__mini-copy pos-focus-ring" title="Copiar" (click)="copyValue(money(row.countedTransfer), 'Conteo transferencia')">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><rect x="8" y="8" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.6" /><path d="M6 16H5a1 1 0 01-1-1V5a1 1 0 011-1h10a1 1 0 011 1v1" stroke="currentColor" stroke-width="1.6" /></svg>
                </button>
              </article>
              <article class="hist-detail__item">
                <span class="hist-detail__item-icon hist-detail__item-icon--coins" aria-hidden="true">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <circle cx="8" cy="8" r="3" stroke="currentColor" stroke-width="1.5" />
                    <circle cx="16" cy="16" r="3" stroke="currentColor" stroke-width="1.5" />
                  </svg>
                </span>
                <div>
                  <span class="hist-detail__item-label">Denominaciones</span>
                  <p class="hist-detail__item-value hist-detail__item-value--wrap">{{ denominationSummary(row) }}</p>
                </div>
              </article>
            </div>
          </div>
          <div class="hist-detail__art" aria-hidden="true">
            <div class="hist-detail__art-frame">
              <svg class="hist-detail__safe" viewBox="0 0 200 160" fill="none">
              <rect x="36" y="24" width="128" height="112" rx="14" class="hist-detail__safe-body" stroke-width="2" />
              <circle cx="100" cy="80" r="22" class="hist-detail__safe-dial" stroke-width="2" />
              <path d="M100 68v12l8 6" class="hist-detail__safe-hand" stroke-width="2" stroke-linecap="round" />
              <rect x="52" y="118" width="96" height="10" rx="5" class="hist-detail__safe-base" />
            </svg>
            </div>
          </div>
        </section>
      }
    </div>
  `,
  styles: `
    .hist {
      display: grid;
      gap: 1rem;
      min-height: 0;
    }
    .hist__head {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      gap: 1rem;
      flex-wrap: wrap;
    }
    .hist__eyebrow {
      display: block;
      margin-bottom: 0.3rem;
      font-size: 0.68rem;
      font-weight: 800;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: color-mix(in srgb, var(--pos-accent-hover) 72%, var(--pos-text));
    }
    .hist__title {
      margin: 0;
      font-size: clamp(1.35rem, 2.4vw, 1.65rem);
      font-weight: 800;
      letter-spacing: -0.02em;
      line-height: 1.15;
    }
    .hist__subtitle {
      margin: 0.35rem 0 0;
      max-width: 36rem;
      color: var(--pos-muted);
      font-size: 0.88rem;
      line-height: 1.45;
    }
    .hist__toolbar {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 0.5rem;
    }
    .hist-btn {
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
    .hist-btn:hover:not(:disabled) {
      transform: translateY(-1px);
      border-color: color-mix(in srgb, var(--pos-accent) 35%, var(--pos-border));
    }
    .hist-btn:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }
    .hist-btn--ghost {
      color: var(--pos-muted);
      background: color-mix(in srgb, var(--pos-surface) 92%, var(--pos-bg));
    }
    .hist-btn--excel {
      border-color: color-mix(in srgb, #22c55e 35%, var(--pos-border));
      color: color-mix(in srgb, #16a34a 80%, var(--pos-text));
      background: color-mix(in srgb, #22c55e 8%, var(--pos-surface));
    }
    .hist-btn--pdf {
      border-color: var(--pos-text);
      background: var(--pos-text);
      color: var(--pos-surface);
    }
    .hist__notice {
      border: 1px solid color-mix(in srgb, var(--pos-warn) 40%, transparent);
      border-radius: var(--pos-radius-sm);
      padding: 0.7rem 0.85rem;
      background: color-mix(in srgb, var(--pos-warn) 10%, var(--pos-surface));
      color: color-mix(in srgb, var(--pos-warn) 85%, var(--pos-text));
      font-size: 0.84rem;
      font-weight: 700;
    }
    .hist-kpi {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 0.75rem;
    }
    .hist-kpi__card {
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
    .hist-kpi__icon {
      flex-shrink: 0;
      width: 3.25rem;
      height: 3.25rem;
      border-radius: 999px;
      display: grid;
      place-items: center;
    }
    .hist-kpi__card--sales .hist-kpi__icon {
      background: color-mix(in srgb, var(--lux-indigo) 14%, var(--pos-surface));
      color: var(--lux-indigo);
    }
    .hist-kpi__card--cash .hist-kpi__icon {
      background: color-mix(in srgb, #22c55e 14%, var(--pos-surface));
      color: #16a34a;
    }
    .hist-kpi__card--card .hist-kpi__icon {
      background: color-mix(in srgb, var(--lux-indigo) 12%, var(--pos-surface));
      color: #6366f1;
    }
    .hist-kpi__card--transfer .hist-kpi__icon {
      background: color-mix(in srgb, var(--lux-cyan) 14%, var(--pos-surface));
      color: #0891b2;
    }
    .hist-kpi__card--diff .hist-kpi__icon {
      background: color-mix(in srgb, #f59e0b 16%, var(--pos-surface));
      color: #d97706;
    }
    .hist-kpi__copy {
      min-width: 0;
    }
    .hist-kpi__label {
      display: block;
      font-size: 0.68rem;
      font-weight: 800;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--pos-muted);
    }
    .hist-kpi__amount {
      display: block;
      margin-top: 0.2rem;
      font-size: clamp(1.05rem, 1.8vw, 1.25rem);
      font-weight: 800;
      font-variant-numeric: tabular-nums;
      letter-spacing: -0.02em;
    }
    .hist-kpi__amount--neg {
      color: var(--pos-danger);
    }
    .hist-kpi__hint {
      display: block;
      margin-top: 0.2rem;
      font-size: 0.68rem;
      color: color-mix(in srgb, var(--pos-muted) 88%, var(--pos-text));
      line-height: 1.35;
    }
    .hist-grid-shell {
      border: 1px solid var(--pos-border);
      border-radius: var(--pos-radius);
      background: var(--pos-surface);
      overflow: hidden;
      box-shadow: 0 1px 0 color-mix(in srgb, var(--pos-text) 4%, transparent);
    }
    .hist-grid-scroll {
      overflow: auto;
      max-height: calc(100vh - 22rem);
    }
    .hist-grid {
      width: 100%;
      min-width: 1080px;
      border-collapse: collapse;
      font-size: 0.78rem;
    }
    .hist-grid th,
    .hist-grid td {
      padding: 0.62rem 0.7rem;
      border-bottom: 1px solid var(--pos-border);
      text-align: left;
      white-space: nowrap;
      vertical-align: middle;
    }
    .hist-grid thead th {
      position: sticky;
      top: 0;
      z-index: 2;
      background: color-mix(in srgb, var(--pos-surface) 90%, var(--pos-border));
      color: var(--pos-muted);
      font-size: 0.66rem;
      font-weight: 900;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .hist-grid__sticky-actions {
      position: sticky;
      left: 0;
      z-index: 3;
      background: var(--pos-surface);
      box-shadow: 1px 0 0 var(--pos-border);
    }
    .hist-grid thead .hist-grid__sticky-actions {
      background: color-mix(in srgb, var(--pos-surface) 90%, var(--pos-border));
    }
    .hist-grid tbody tr {
      cursor: pointer;
      transition: background var(--pos-transition);
    }
    .hist-grid tbody tr:hover td,
    .hist-grid__row--selected td {
      background: color-mix(in srgb, var(--pos-accent) 6%, var(--pos-surface));
    }
    .hist-grid tbody tr:hover .hist-grid__sticky-actions,
    .hist-grid__row--selected .hist-grid__sticky-actions {
      background: color-mix(in srgb, var(--pos-accent) 8%, var(--pos-surface));
    }
    .hist-grid__actions {
      position: relative;
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
    }
    .hist-grid__view {
      min-height: 1.85rem;
      padding: 0 0.55rem;
      border: 1px solid color-mix(in srgb, var(--pos-accent) 35%, var(--pos-border));
      border-radius: 999px;
      background: color-mix(in srgb, var(--pos-accent) 8%, var(--pos-surface));
      color: var(--pos-accent-hover);
      font-size: 0.7rem;
      font-weight: 800;
      cursor: pointer;
    }
    .hist-grid__menu {
      width: 1.85rem;
      height: 1.85rem;
      border: 1px solid var(--pos-border);
      border-radius: 999px;
      background: var(--pos-surface);
      color: var(--pos-muted);
      display: grid;
      place-items: center;
      cursor: pointer;
    }
    .hist-grid__menu-pop {
      position: absolute;
      top: calc(100% + 0.25rem);
      left: 0;
      z-index: 12;
      min-width: 8.5rem;
      padding: 0.3rem;
      border: 1px solid var(--pos-border);
      border-radius: var(--pos-radius-sm);
      background: var(--pos-elevated, var(--pos-surface));
      box-shadow: 0 12px 28px color-mix(in srgb, #000 18%, transparent);
      display: grid;
      gap: 0.15rem;
    }
    .hist-grid__menu-pop button {
      border: none;
      border-radius: 6px;
      background: transparent;
      color: var(--pos-text);
      text-align: left;
      padding: 0.45rem 0.55rem;
      font-size: 0.76rem;
      font-weight: 700;
      cursor: pointer;
    }
    .hist-grid__menu-pop button:hover {
      background: color-mix(in srgb, var(--pos-accent) 8%, var(--pos-surface));
    }
    .hist-badge {
      display: inline-flex;
      align-items: center;
      min-height: 1.45rem;
      padding: 0 0.55rem;
      border-radius: 999px;
      font-size: 0.66rem;
      font-weight: 900;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      background: color-mix(in srgb, var(--pos-muted) 12%, var(--pos-surface));
      color: var(--pos-muted);
    }
    .hist-badge--open {
      background: color-mix(in srgb, #f59e0b 18%, var(--pos-surface));
      color: #b45309;
    }
    .hist-badge--closed {
      background: color-mix(in srgb, #22c55e 14%, var(--pos-surface));
      color: #15803d;
    }
    .hist-person {
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
      max-width: 11rem;
    }
    .hist-person__avatar {
      flex-shrink: 0;
      width: 1.65rem;
      height: 1.65rem;
      border-radius: 999px;
      display: grid;
      place-items: center;
      font-size: 0.62rem;
      font-weight: 900;
      background: linear-gradient(135deg, var(--lux-indigo), var(--lux-magenta));
      color: #fff;
    }
    .hist-person__avatar--muted {
      background: color-mix(in srgb, var(--pos-muted) 22%, var(--pos-surface));
      color: var(--pos-muted);
      border: 1px solid var(--pos-border);
    }
    .hist-person__name {
      overflow: hidden;
      text-overflow: ellipsis;
      font-weight: 700;
      font-size: 0.76rem;
    }
    .num {
      text-align: right;
      font-variant-numeric: tabular-nums;
      font-weight: 700;
    }
    .neg {
      color: var(--pos-danger);
    }
    .hist-grid tfoot td {
      position: sticky;
      bottom: 0;
      z-index: 2;
      background: #1e1b4b;
      color: #fff;
      font-weight: 900;
      border-bottom: none;
      border-top: 1px solid color-mix(in srgb, #fff 8%, #1e1b4b);
    }
    .hist-grid tfoot .neg {
      color: #fca5a5;
    }
    .hist-grid__totals-label {
      text-transform: uppercase;
      letter-spacing: 0.05em;
      font-size: 0.68rem;
    }
    .hist-grid__empty {
      padding: 2rem;
      text-align: center;
      color: var(--pos-muted);
      font-weight: 600;
    }
    .hist-detail {
      position: relative;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 1rem;
      padding: 1rem 1.1rem;
      border: 1px solid color-mix(in srgb, var(--lux-indigo) 18%, var(--pos-border));
      border-radius: var(--pos-radius);
      background: linear-gradient(
        118deg,
        color-mix(in srgb, var(--lux-indigo) 9%, var(--pos-surface)) 0%,
        color-mix(in srgb, var(--lux-cyan) 11%, var(--pos-surface)) 48%,
        color-mix(in srgb, var(--pos-bg) 28%, var(--pos-surface)) 100%
      );
      overflow: hidden;
      box-shadow: 0 1px 0 color-mix(in srgb, var(--pos-text) 4%, transparent);
    }
    .hist-detail::before {
      content: '';
      position: absolute;
      inset: 0;
      background: radial-gradient(
        ellipse 42% 88% at 94% 42%,
        color-mix(in srgb, var(--lux-indigo) 16%, transparent),
        transparent 72%
      );
      pointer-events: none;
    }
    .hist-detail__main {
      position: relative;
      z-index: 1;
    }
    .hist-detail__head {
      margin-bottom: 0.85rem;
    }
    .hist-detail__title {
      margin: 0.15rem 0 0.35rem;
      font-size: 1.05rem;
      font-weight: 800;
      color: var(--pos-text);
    }
    .hist-detail__meta {
      margin: 0 0 0.55rem;
      font-size: 0.82rem;
      color: var(--pos-muted);
    }
    .hist-detail__meta strong {
      color: var(--pos-text);
      font-weight: 700;
    }
    .hist-detail__id-row {
      display: flex;
      align-items: center;
      gap: 0.45rem;
      margin-top: 0.25rem;
    }
    .hist-detail__id-label {
      font-size: 0.62rem;
      font-weight: 800;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--pos-muted);
    }
    .hist-detail__id {
      font-family: var(--pos-mono);
      font-size: 0.72rem;
      font-weight: 600;
      color: var(--pos-muted);
      word-break: break-all;
    }
    .hist-detail__copy,
    .hist-detail__mini-copy {
      border: 1px solid var(--pos-border);
      border-radius: 8px;
      background: color-mix(in srgb, var(--pos-bg) 55%, var(--pos-surface));
      color: var(--pos-muted);
      cursor: pointer;
      display: grid;
      place-items: center;
    }
    .hist-detail__copy {
      width: 1.85rem;
      height: 1.85rem;
      flex-shrink: 0;
    }
    .hist-detail__mini-copy {
      width: 1.55rem;
      height: 1.55rem;
      flex-shrink: 0;
      align-self: flex-start;
      margin-top: 0.15rem;
    }
    .hist-detail__grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 0.7rem;
    }
    .hist-detail__item {
      position: relative;
      display: flex;
      align-items: flex-start;
      gap: 0.6rem;
      min-height: 4.5rem;
      padding: 0.75rem 0.8rem;
      border: 1px solid var(--pos-border);
      border-radius: var(--pos-radius-sm);
      background: color-mix(in srgb, var(--pos-bg) 35%, var(--pos-surface));
    }
    .hist-detail__item-icon {
      flex-shrink: 0;
      width: 2rem;
      height: 2rem;
      border-radius: 10px;
      display: grid;
      place-items: center;
      background: color-mix(in srgb, var(--lux-indigo) 10%, var(--pos-surface));
      color: var(--lux-indigo);
    }
    .hist-detail__item-icon--card {
      background: color-mix(in srgb, var(--lux-indigo) 10%, var(--pos-surface));
      color: #6366f1;
    }
    .hist-detail__item-icon--transfer {
      background: color-mix(in srgb, var(--lux-cyan) 12%, var(--pos-surface));
      color: #0891b2;
    }
    .hist-detail__item-icon--coins {
      background: color-mix(in srgb, #f59e0b 12%, var(--pos-surface));
      color: #d97706;
    }
    .hist-detail__item-label {
      display: block;
      font-size: 0.66rem;
      font-weight: 800;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--pos-muted);
    }
    .hist-detail__item-value {
      margin: 0.3rem 0 0;
      font-size: 0.86rem;
      font-weight: 800;
      line-height: 1.35;
    }
    .hist-detail__item-value--wrap {
      white-space: normal;
      overflow-wrap: anywhere;
    }
    .hist-detail__art {
      position: relative;
      z-index: 1;
      display: flex;
      align-items: center;
      justify-content: flex-end;
      padding-right: 0.25rem;
    }
    .hist-detail__art-frame {
      width: 6.5rem;
      height: 6.5rem;
      border-radius: 1.1rem;
      display: grid;
      place-items: center;
      background: color-mix(in srgb, var(--lux-indigo) 12%, var(--pos-surface));
      border: 1px solid color-mix(in srgb, var(--lux-indigo) 20%, transparent);
      box-shadow: 0 10px 28px color-mix(in srgb, var(--lux-indigo) 12%, transparent);
    }
    .hist-detail__safe {
      width: 4.5rem;
      height: auto;
      opacity: 0.92;
    }
    .hist-detail__safe-body {
      fill: color-mix(in srgb, var(--lux-indigo) 8%, transparent);
      stroke: color-mix(in srgb, var(--lux-indigo) 22%, transparent);
    }
    .hist-detail__safe-dial {
      stroke: color-mix(in srgb, var(--lux-indigo) 35%, transparent);
      fill: none;
    }
    .hist-detail__safe-hand {
      stroke: color-mix(in srgb, var(--lux-indigo) 40%, transparent);
      fill: none;
    }
    .hist-detail__safe-base {
      fill: color-mix(in srgb, var(--lux-cyan) 12%, transparent);
    }
    @media (max-width: 1100px) {
      .hist-kpi {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
      .hist-detail__grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
    @media (max-width: 760px) {
      .hist__head {
        align-items: stretch;
        flex-direction: column;
      }
      .hist__toolbar {
        justify-content: stretch;
      }
      .hist-btn {
        flex: 1 1 auto;
        justify-content: center;
      }
      .hist-kpi {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .hist-detail {
        grid-template-columns: 1fr;
      }
      .hist-detail__art {
        display: none;
      }
      .hist-grid-scroll {
        max-height: calc(100vh - 26rem);
      }
    }
  `,
})
export class PosHistorialPage implements OnInit {
  private readonly api = inject(PosBackendApiService);
  private readonly auth = inject(PosAuthService);
  private readonly toast = inject(PosToastService);

  readonly rows = signal<ReportRow[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly selected = signal<ReportRow | null>(null);
  readonly rowMenuId = signal<string | null>(null);

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

  readonly kpiCards = computed((): KpiCard[] => {
    const t = this.totals();
    return [
      { key: 'sales', label: 'Ventas', hint: 'Total ventas del día', amount: t.totalVentas, tone: 'sales' },
      { key: 'cash', label: 'Efectivo', hint: 'Total en efectivo', amount: t.efectivoCobros, tone: 'cash' },
      { key: 'card', label: 'Tarjeta', hint: 'Total con tarjeta', amount: t.tarjetaCobros, tone: 'card' },
      {
        key: 'transfer',
        label: 'Transferencia',
        hint: 'Total transferencias',
        amount: t.transferCobros,
        tone: 'transfer',
      },
      { key: 'diff', label: 'Diferencia', hint: 'Diferencia total', amount: t.cashDifference, tone: 'diff' },
    ];
  });

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    this.closeRowMenu();
    try {
      const response = await firstValueFrom(this.api.getCajaHistorial());
      const rows = this.enrichRows(mapCajaHistorialResponse(response));
      this.rows.set(rows);
      this.selected.set(rows[0] ?? null);
    } catch (err) {
      const rows = this.enrichRows(this.demoRows());
      this.rows.set(rows);
      this.selected.set(rows[0] ?? null);
      this.error.set(this.errorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  select(row: ReportRow): void {
    this.selected.set(row);
    this.closeRowMenu();
  }

  toggleRowMenu(rowId: string): void {
    this.rowMenuId.update((current) => (current === rowId ? null : rowId));
  }

  closeRowMenu(): void {
    this.rowMenuId.set(null);
  }

  personInitials(name: string): string {
    return customerDisplayInitials(name);
  }

  async copyShiftId(id: string): Promise<void> {
    await this.copyValue(id, 'ID del turno');
    this.closeRowMenu();
  }

  private enrichRows(rows: ReportRow[]): ReportRow[] {
    const ctx = this.personContext();
    return rows.map((row) => ({
      ...row,
      openedBy: this.resolvePersonLabel(row.openedBy, row.openedByUserId, ctx),
      closedBy: this.resolvePersonLabel(row.closedBy, row.closedByUserId, ctx),
    }));
  }

  private personContext(): { displayName: string; email: string; userId: string } {
    const session = this.auth.sessionContext();
    const jwt = readPosSessionDisplay(this.auth.accessToken());
    const claims = decodeJwtPayload(this.auth.accessToken() ?? '') ?? {};
    const sub = claims['sub'] ?? claims['user_id'] ?? claims['userId'];
    return {
      displayName: session.cashierName || jwt.cashierName || jwt.cashierLabel,
      email: session.cashierEmail || jwt.cashierEmail,
      userId: sub != null ? String(sub) : '',
    };
  }

  private resolvePersonLabel(
    stored: string | null | undefined,
    userId: string | null | undefined,
    ctx: { displayName: string; email: string; userId: string },
  ): string | null {
    const label = stored?.trim() || null;
    const name = ctx.displayName.trim();
    const email = ctx.email.trim();
    const emailPrefix = email.includes('@') ? email.slice(0, email.indexOf('@')) : email;
    const sameUser = !userId || !ctx.userId || String(userId) === ctx.userId;

    if (name && sameUser) {
      if (!label) {
        return name;
      }
      if (this.looksLikeLogin(label) || label.toLowerCase() === emailPrefix.toLowerCase()) {
        return name;
      }
    }
    if (label && !this.looksLikeLogin(label)) {
      return label;
    }
    return name || label;
  }

  private looksLikeLogin(value: string): boolean {
    const v = value.trim();
    if (!v) {
      return false;
    }
    if (v.includes('@')) {
      return true;
    }
    return /^[a-z0-9._-]+$/.test(v);
  }


  async copyValue(value: string, label: string): Promise<void> {
    const text = value.trim();
    if (!text || text === '—' || text === '-') {
      this.toast.warning(`No hay ${label.toLowerCase()} para copiar.`);
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      this.toast.success(`${label} copiado al portapapeles.`);
    } catch {
      this.toast.error(`No se pudo copiar ${label.toLowerCase()}.`);
    }
  }

  labelStatus(status: string): string {
    const upper = String(status ?? '').toUpperCase();
    if (upper === 'OPEN') {
      return 'Abierta';
    }
    if (upper === 'CLOSED') {
      return 'Cerrada';
    }
    return upper || '—';
  }

  formatDate(value?: string | null): string {
    if (!value) {
      return '—';
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
      return '—';
    }
    return denominations
      .filter((d) => this.amount(d.quantity) > 0)
      .map((d) => `${this.money(d.denomination)} × ${d.quantity}`)
      .join(', ');
  }

  downloadExcel(): void {
    const html = this.reportHtml('excel');
    const blob = new Blob(['\ufeff', html], { type: 'application/vnd.ms-excel;charset=utf-8' });
    this.downloadBlob(blob, `historial-caja-${this.todayKey()}.xls`);
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

  private reportHtml(kind: 'excel' | 'pdf'): string {
    const generated = new Intl.DateTimeFormat('es-EC', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date());
    const rows = this.rows()
      .map(
        (row) => `
          <tr>
            <td>${this.escape(this.labelStatus(row.status))}</td>
            <td>${this.escape(this.formatDate(row.openedAt))}</td>
            <td>${this.escape(row.closedAt ? this.formatDate(row.closedAt) : '—')}</td>
            <td>${this.escape(row.openedBy || '—')}</td>
            <td>${this.escape(row.closedBy || '—')}</td>
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
            .report-head { border-bottom: 3px solid #6366f1; padding-bottom: 14px; margin-bottom: 18px; display: flex; justify-content: space-between; gap: 18px; }
            h1 { margin: 0; font-size: 24px; }
            p { margin: 6px 0 0; color: #687184; font-size: 12px; }
            .brand { font-size: 11px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: #6366f1; }
            table { width: 100%; border-collapse: collapse; font-size: ${kind === 'pdf' ? '10px' : '12px'}; }
            th { background: #eef2ff; color: #304036; text-transform: uppercase; font-size: 10px; letter-spacing: .04em; }
            th, td { border: 1px solid #d9e1dc; padding: 7px 8px; text-align: left; white-space: nowrap; }
            .num { text-align: right; font-variant-numeric: tabular-nums; }
            tfoot td { background: #1e1b4b; color: #fff; font-weight: 800; }
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
      return `${err.message}. Mostrando datos de demostración hasta que el backend responda.`;
    }
    return 'No se pudo cargar el historial desde el servidor. Mostrando datos de demostración.';
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
