import { inject, Injectable, computed, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { catchError, finalize, map, of, Subscription, tap, throwError } from 'rxjs';
import { PosBackendApiService } from '../api/pos-backend-api.service';
import { extractApiErrorMessage } from '../http-error.util';
import { mapCajaHistorialResponse } from '../api/pos-backend.mappers';
import type {
  PosCajaCierreRequest,
  PosCajaHistoryItem,
  PosCajaSnapshotResponse,
} from '../api/pos-backend.types';
import { PosAuthService } from '../auth/pos-auth.service';
import { PosLayoutPreferencesService } from '../layout/pos-layout-preferences.service';

const K_OPEN = 'pos_demo_caja_abierta';
const K_FLOAT = 'pos_demo_caja_fondo';
const K_SALES = 'pos_demo_ventas_hoy';
const K_EF = 'pos_demo_ventas_efectivo';
const K_TC = 'pos_demo_ventas_tarjeta';
const K_TR = 'pos_demo_ventas_transfer';
const K_TICKETS = 'pos_demo_tickets_hoy';

/**
 * Estado de caja y acumulados: intenta leer del API del POS (multi-tenant); si falla o no hay API,
 * conserva el respaldo local (localStorage) para demos offline.
 */
@Injectable({ providedIn: 'root' })
export class PosDeskSessionService {
  private readonly prefs = inject(PosLayoutPreferencesService);
  private readonly api = inject(PosBackendApiService);
  private readonly auth = inject(PosAuthService);

  private refreshSub?: Subscription;

  readonly cajaOpen = signal(false);
  readonly openingFloat = signal(0);
  readonly todaySalesTotal = signal(0);
  readonly todayCash = signal(0);
  readonly todayCard = signal(0);
  readonly todayTransfer = signal(0);
  readonly todayTickets = signal(0);
  readonly deskLoadError = signal<string | null>(null);
  readonly loading = signal(false);
  readonly opening = signal(false);
  readonly closing = signal(false);
  readonly openedAt = signal<string | null>(null);
  readonly sessionId = signal<string | null>(null);
  readonly history = signal<PosCajaHistoryItem[]>([]);
  readonly historyLoading = signal(false);
  readonly historyError = signal<string | null>(null);

  readonly cajaDisplayId = computed(() => {
    const id = this.prefs.cajaId().trim();
    return id || 'Sin código';
  });

  constructor() {
    this.refresh();
  }

  /** Recarga estado desde pos-app (GET /caja). */
  refresh(): void {
    this.refreshSub?.unsubscribe();
    this.deskLoadError.set(null);
    this.loading.set(true);
    const base = this.auth.apiBaseUrl?.replace(/\/+$/, '');
    if (!base) {
      this.hydrateLocalFallback();
      this.loading.set(false);
      return;
    }
    this.refreshSub = this.api
      .getCajaSnapshot()
      .pipe(
        tap((s) => this.applyServerSnapshot(s)),
        catchError((err: unknown) => {
          this.deskLoadError.set(this.errMsg(err));
          if (!this.shouldUseLocalFallback(err)) {
            this.cajaOpen.set(false);
            this.sessionId.set(null);
            return of(null);
          }
          this.hydrateLocalFallback();
          return of(null);
        }),
        finalize(() => this.loading.set(false)),
      )
      .subscribe();
  }

  openCaja(initialFloatUsd: number) {
    const base = this.auth.apiBaseUrl?.replace(/\/+$/, '');
    if (!base) {
      this.openCajaLocal(initialFloatUsd);
      return of(void 0);
    }
    this.opening.set(true);
    return this.api.postCajaApertura(initialFloatUsd).pipe(
      tap((s) => this.applyServerSnapshot(s)),
      map(() => void 0 as void),
      catchError((err: unknown) => {
        this.deskLoadError.set(this.errMsg(err));
        return throwError(() => err);
      }),
      finalize(() => this.opening.set(false)),
    );
  }

  closeCaja(request?: PosCajaCierreRequest) {
    const base = this.auth.apiBaseUrl?.replace(/\/+$/, '');
    if (!base) {
      this.closeCajaLocal();
      return of(void 0);
    }
    this.closing.set(true);
    return this.api.postCajaCierre(request).pipe(
      tap((s) => this.applyServerSnapshot(s)),
      map(() => void 0 as void),
      catchError((err: unknown) => {
        this.deskLoadError.set(this.errMsg(err));
        return throwError(() => err);
      }),
      finalize(() => this.closing.set(false)),
    );
  }

  loadHistory(): void {
    const base = this.auth.apiBaseUrl?.replace(/\/+$/, '');
    this.historyError.set(null);
    if (!base) {
      this.history.set([]);
      return;
    }
    this.historyLoading.set(true);
    this.api
      .getCajaHistorial()
      .pipe(
        tap((r) => this.history.set(mapCajaHistorialResponse(r))),
        catchError((err: unknown) => {
          this.historyError.set(this.errMsg(err));
          return of(null);
        }),
        finalize(() => this.historyLoading.set(false)),
      )
      .subscribe();
  }

  /** Tras un cobro remoto exitoso, sincroniza totales con el servidor. */
  refreshAfterRemoteSale(): void {
    this.refresh();
  }

  expectedCashInDrawer(): number {
    return Math.round((this.openingFloat() + this.todayCash()) * 100) / 100;
  }

  /** Sin pos-app: acumula venta solo en localStorage (demo / offline). */
  recordSaleFromLocalUI(total: number, split: { cash: number; card: number; transfer: number }): void {
    this.todayTickets.update((n) => n + 1);
    this.todaySalesTotal.update((n) => Math.round((n + total) * 100) / 100);
    this.todayCash.update((n) => Math.round((n + split.cash) * 100) / 100);
    this.todayCard.update((n) => Math.round((n + split.card) * 100) / 100);
    this.todayTransfer.update((n) => Math.round((n + split.transfer) * 100) / 100);
    this.persistLocalMirror();
  }

  private applyServerSnapshot(s: PosCajaSnapshotResponse): void {
    const session = s.session;
    const sessionStatus = session?.status?.toUpperCase();
    if (session && (sessionStatus === 'OPEN' || sessionStatus === 'ABIERTA')) {
      this.cajaOpen.set(true);
      this.sessionId.set(session.id);
      this.openedAt.set(session.openedAt);
      this.openingFloat.set(Number(session.openingFloat ?? 0));
    } else {
      this.cajaOpen.set(false);
      this.sessionId.set(null);
      this.openedAt.set(null);
      this.openingFloat.set(0);
    }
    const r = s.resumen;
    this.todayTickets.set(Number(r.tickets ?? 0));
    this.todaySalesTotal.set(Number(r.totalVentas ?? 0));
    this.todayCash.set(Number(r.efectivoCobros ?? 0));
    this.todayCard.set(Number(r.tarjetaCobros ?? 0));
    this.todayTransfer.set(Number(r.transferCobros ?? 0));
    this.persistLocalMirror();
  }

  private hydrateLocalFallback(): void {
    this.cajaOpen.set(localStorage.getItem(K_OPEN) === '1');
    this.sessionId.set(this.cajaOpen() ? 'LOCAL' : null);
    this.openedAt.set(null);
    this.openingFloat.set(Number(localStorage.getItem(K_FLOAT) || '0'));
    this.todaySalesTotal.set(Number(localStorage.getItem(K_SALES) || '0'));
    this.todayCash.set(Number(localStorage.getItem(K_EF) || '0'));
    this.todayCard.set(Number(localStorage.getItem(K_TC) || '0'));
    this.todayTransfer.set(Number(localStorage.getItem(K_TR) || '0'));
    this.todayTickets.set(Number(localStorage.getItem(K_TICKETS) || '0'));
  }

  private persistLocalMirror(): void {
    localStorage.setItem(K_OPEN, this.cajaOpen() ? '1' : '0');
    localStorage.setItem(K_FLOAT, String(this.openingFloat()));
    localStorage.setItem(K_SALES, String(this.todaySalesTotal()));
    localStorage.setItem(K_EF, String(this.todayCash()));
    localStorage.setItem(K_TC, String(this.todayCard()));
    localStorage.setItem(K_TR, String(this.todayTransfer()));
    localStorage.setItem(K_TICKETS, String(this.todayTickets()));
  }

  private openCajaLocal(initialFloatUsd: number): void {
    const t = Math.max(0, Math.round(initialFloatUsd * 100) / 100);
    this.cajaOpen.set(true);
    this.sessionId.set('LOCAL');
    this.openedAt.set(new Date().toISOString());
    this.openingFloat.set(t);
    this.persistLocalMirror();
  }

  private closeCajaLocal(): void {
    this.cajaOpen.set(false);
    this.sessionId.set(null);
    this.openedAt.set(null);
    this.openingFloat.set(0);
    this.persistLocalMirror();
  }

  private errMsg(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      if (err.status === 401 || err.status === 403) {
        return 'Sesión no autorizada. Vuelva a ingresar al POS.';
      }
      if (err.status === 0) {
        return 'Sin respuesta de pos-app. Verifique que el backend esté activo en el puerto 8094.';
      }
      const fromApi = extractApiErrorMessage(err, '');
      if (fromApi) {
        return fromApi;
      }
      return `Error del servidor (HTTP ${err.status}).`;
    }
    if (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
      return (err as { message: string }).message;
    }
    return 'No se pudo cargar la caja desde el servidor';
  }

  private shouldUseLocalFallback(err: unknown): boolean {
    if (!(err instanceof HttpErrorResponse)) {
      return true;
    }
    return err.status === 0;
  }
}
