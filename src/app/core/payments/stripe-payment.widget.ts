import { Injectable, inject } from '@angular/core';
import { PosBackendApiService } from '../api/pos-backend-api.service';
import { PosAuthService } from '../auth/pos-auth.service';
import { ManualExternalPaymentWidget } from './manual-external-payment.widget';

@Injectable({ providedIn: 'root' })
export class StripePaymentWidget extends ManualExternalPaymentWidget {
  private readonly api = inject(PosBackendApiService);
  private readonly auth = inject(PosAuthService);

  readonly code = 'stripe' as const;
  readonly methodOption = {
    code: 'stripe' as const,
    label: 'Stripe',
    icon: 'S',
    formaPago: '19',
    canal: 'STRIPE',
    proveedor: 'STRIPE',
  };

  private loading = false;

  loadAvailability(): void {
    if (!this.auth.apiBaseUrl?.trim()) {
      this.applyAvailability(false, 'API POS no configurada');
      return;
    }
    if (this.loading) {
      return;
    }
    this.loading = true;
    this.api.getStripeConfig().subscribe({
      next: (cfg) => {
        const available = cfg.enabled && cfg.configured;
        this.applyAvailability(
          available,
          available ? 'Stripe listo para cobros manuales' : cfg.enabled ? 'Stripe no configurado' : 'Stripe deshabilitado',
        );
        this.loading = false;
      },
      error: () => {
        this.applyAvailability(false, 'No se pudo cargar la configuracion Stripe');
        this.loading = false;
      },
    });
  }
}
