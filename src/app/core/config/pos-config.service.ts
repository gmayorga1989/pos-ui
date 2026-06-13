import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface PosRuntimeConfig {
  deploymentMode: string;
  authMode: string;
  invoicingProvider: string;
  catalogSource: string;
  carteraEnabled: boolean;
  carteraBaseUrl: string;
  invoicingEnabled: boolean;
}

@Injectable({ providedIn: 'root' })
export class PosConfigService {
  private readonly http = inject(HttpClient);
  private readonly loaded = signal(false);
  readonly config = signal<PosRuntimeConfig | null>(null);

  async ensureLoaded(): Promise<PosRuntimeConfig> {
    if (this.loaded() && this.config()) {
      return this.config()!;
    }
    const base = environment.posApiOrigin.replace(/\/+$/, '');
    const raw = await firstValueFrom(this.http.get<PosRuntimeConfig>(`${base}/api/v1/pos/config`));
    this.config.set(raw);
    this.loaded.set(true);
    try {
      sessionStorage.setItem('pos_auth_mode', raw.authMode);
    } catch {
      /* ignore */
    }
    return raw;
  }

  isNativeAuth(): boolean {
    return (this.config()?.authMode ?? environment.authModeFallback) === 'NATIVE';
  }

  isInvoicingEnabled(): boolean {
    return !!this.config()?.invoicingEnabled;
  }

  deploymentMode(): string {
    return this.config()?.deploymentMode ?? 'STANDALONE';
  }

  invoicingProvider(): string {
    return this.config()?.invoicingProvider ?? 'NONE';
  }

  isStandalone(): boolean {
    return this.deploymentMode() === 'STANDALONE';
  }

  isLuxora(): boolean {
    return this.deploymentMode() === 'LUXORA';
  }

  isIntegrated(): boolean {
    return this.deploymentMode() === 'INTEGRATED';
  }

  usesLocalPuntoEmision(): boolean {
    return this.invoicingProvider() === 'NONE';
  }

  requiresEfacturaPuntoEmision(): boolean {
    return this.invoicingProvider() === 'EFACTURA';
  }
}
