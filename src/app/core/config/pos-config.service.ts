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
  efacturaBackgroundConfigured?: boolean;
  persistenceEngine?: string;
  persistenceDatabase?: string;
  ephemeralPersistence?: boolean;
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
    const provider = this.invoicingProvider();
    // Perfil A (standalone) y C (terceros): puntos en pos-app.
    return provider === 'NONE' || provider === 'CUSTOM';
  }

  requiresEfacturaPuntoEmision(): boolean {
    // Perfil B (Luxora + eFactura): puntos desde efactura-app.
    return this.invoicingProvider() === 'EFACTURA';
  }

  isCustomInvoicing(): boolean {
    return this.invoicingProvider() === 'CUSTOM';
  }

  /** Mensaje de configuración según perfil de facturación activo. */
  puntoEmisionSetupHint(): string {
    if (this.requiresEfacturaPuntoEmision()) {
      return 'Seleccione un punto de emisión de eFactura en Ajustes → Estación.';
    }
    if (this.isCustomInvoicing()) {
      return 'Configure el punto de emisión local en Ajustes → Estación (se envía al facturador externo).';
    }
    return 'Elija un punto de emisión en Ajustes → Estación.';
  }

  puntoEmisionFieldLabel(): string {
    if (this.requiresEfacturaPuntoEmision()) {
      return 'Punto de emisión (eFactura)';
    }
    if (this.isCustomInvoicing()) {
      return 'Punto de emisión (local / tercero)';
    }
    return 'Punto de emisión (POS)';
  }

  deploymentProfileLabel(): string {
    if (this.isStandalone() && !this.isInvoicingEnabled()) {
      return 'POS standalone';
    }
    if (this.requiresEfacturaPuntoEmision()) {
      return 'Luxora + eFactura';
    }
    if (this.isCustomInvoicing()) {
      return 'Integración terceros';
    }
    return this.deploymentMode();
  }

  invoicingProfileChipLabel(): string {
    if (this.requiresEfacturaPuntoEmision()) {
      return 'eFactura';
    }
    if (this.isCustomInvoicing()) {
      return 'Tercero';
    }
    return 'POS solo';
  }

  efacturaBackgroundConfigured(): boolean {
    return !!this.config()?.efacturaBackgroundConfigured;
  }

  deploymentProfileDescription(): string {
    if (this.requiresEfacturaPuntoEmision()) {
      return 'Las ventas emiten comprobantes electrónicos vía eFactura. Configure aquí la caja y el punto de emisión autorizado (ej. 001-001).';
    }
    if (this.isCustomInvoicing()) {
      return 'Las ventas se envían a un facturador HTTP externo. La caja y el punto local identifican esta estación.';
    }
    return 'Solo ticket POS en esta estación; sin emisión electrónica automática al SRI.';
  }

  ephemeralPersistence(): boolean {
    return !!this.config()?.ephemeralPersistence;
  }

  persistenceLabel(): string {
    const cfg = this.config();
    if (!cfg?.persistenceEngine) {
      return '';
    }
    const db = cfg.persistenceDatabase?.trim();
    return db ? `${cfg.persistenceEngine} · ${db}` : cfg.persistenceEngine;
  }
}
