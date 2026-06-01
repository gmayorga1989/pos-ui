import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, finalize, map, shareReplay, tap, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';

const ACCESS = 'pos_access_token';
const REFRESH = 'pos_refresh_token';
const COMPANY_NAME = 'pos_company_name';
const CASHIER_NAME = 'pos_cashier_name';
const CASHIER_EMAIL = 'pos_cashier_email';

export interface PosSessionContext {
  companyName: string;
  cashierName: string;
  cashierEmail: string;
}

interface PosTokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds?: number;
}

@Injectable({ providedIn: 'root' })
export class PosAuthService {
  private readonly http = inject(HttpClient);
  private refreshInFlight$?: Observable<string>;
  private autoRefreshId?: ReturnType<typeof setInterval>;

  readonly identityBaseUrl = environment.identityBaseUrl;
  readonly apiBaseUrl = environment.posApiOrigin;

  constructor() {
    this.startAutoRefresh();
  }

  isAuthenticated(): boolean {
    return !!sessionStorage.getItem(ACCESS);
  }

  setSession(access: string, refresh: string, context?: Partial<PosSessionContext>): void {
    sessionStorage.setItem(ACCESS, access);
    sessionStorage.setItem(REFRESH, refresh);
    this.setOptional(COMPANY_NAME, context?.companyName);
    this.setOptional(CASHIER_NAME, context?.cashierName);
    this.setOptional(CASHIER_EMAIL, context?.cashierEmail);
    this.startAutoRefresh();
  }

  clear(): void {
    sessionStorage.removeItem(ACCESS);
    sessionStorage.removeItem(REFRESH);
    sessionStorage.removeItem(COMPANY_NAME);
    sessionStorage.removeItem(CASHIER_NAME);
    sessionStorage.removeItem(CASHIER_EMAIL);
    if (this.autoRefreshId) {
      clearInterval(this.autoRefreshId);
      this.autoRefreshId = undefined;
    }
  }

  accessToken(): string | null {
    return sessionStorage.getItem(ACCESS);
  }

  refreshToken(): string | null {
    return sessionStorage.getItem(REFRESH);
  }

  shouldRefreshSoon(token: string | null = this.accessToken(), skewSeconds = 120): boolean {
    const exp = this.jwtExp(token);
    if (!exp) {
      return false;
    }
    return exp * 1000 - Date.now() <= skewSeconds * 1000;
  }

  refreshSession(): Observable<string> {
    const rt = this.refreshToken();
    const base = this.identityBaseUrl?.replace(/\/+$/, '');
    if (!rt || !base) {
      return throwError(() => new Error('No hay refresh token o identityBaseUrl configurado'));
    }
    if (this.refreshInFlight$) {
      return this.refreshInFlight$;
    }
    this.refreshInFlight$ = this.http
      .post<PosTokenResponse>(`${base}/api/v1/auth/refresh`, { refreshToken: rt })
      .pipe(
        tap((r) => this.setSession(r.accessToken, r.refreshToken, this.sessionContext())),
        map((r) => r.accessToken),
        catchError((err: unknown) => {
          if (!(err instanceof HttpErrorResponse) || err.status !== 0) {
            this.clear();
          }
          return throwError(() => err);
        }),
        finalize(() => {
          this.refreshInFlight$ = undefined;
        }),
        shareReplay({ bufferSize: 1, refCount: false }),
      );
    return this.refreshInFlight$;
  }

  sessionContext(): PosSessionContext {
    return {
      companyName: sessionStorage.getItem(COMPANY_NAME)?.trim() ?? '',
      cashierName: sessionStorage.getItem(CASHIER_NAME)?.trim() ?? '',
      cashierEmail: sessionStorage.getItem(CASHIER_EMAIL)?.trim() ?? '',
    };
  }

  private setOptional(key: string, value: string | null | undefined): void {
    const clean = value?.trim();
    if (clean) {
      sessionStorage.setItem(key, clean);
    } else {
      sessionStorage.removeItem(key);
    }
  }

  private startAutoRefresh(): void {
    if (this.autoRefreshId || !this.refreshToken()) {
      return;
    }
    this.autoRefreshId = setInterval(() => {
      if (!this.refreshToken()) {
        this.clear();
        return;
      }
      if (this.shouldRefreshSoon(this.accessToken(), 180)) {
        this.refreshSession().subscribe({ error: () => undefined });
      }
    }, 60_000);
  }

  private jwtExp(token: string | null): number | null {
    const parts = token?.split('.') ?? [];
    if (parts.length < 2 || !parts[1]) {
      return null;
    }
    try {
      const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
      const payload = JSON.parse(atob(padded)) as Record<string, unknown>;
      return typeof payload['exp'] === 'number' ? payload['exp'] : null;
    } catch {
      return null;
    }
  }
}
