import { Injectable, inject } from '@angular/core';
import { PosBackendApiService } from '../api/pos-backend-api.service';
import { PosAuthService } from '../auth/pos-auth.service';
import { ManualExternalPaymentWidget } from './manual-external-payment.widget';

@Injectable({ providedIn: 'root' })
export class KushkiPaymentWidget extends ManualExternalPaymentWidget {
  private readonly api = inject(PosBackendApiService);
  private readonly auth = inject(PosAuthService);

  readonly code = 'kushki' as const;
  readonly methodOption = {
    code: 'kushki' as const,
    label: 'Kushki',
    icon: 'K',
    formaPago: '19',
    canal: 'KUSHKI',
    proveedor: 'KUSHKI',
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
    this.api.getKushkiConfig().subscribe({
      next: (cfg) => {
        const available = cfg.enabled && cfg.configured;
        this.applyAvailability(
          available,
          available ? 'Kushki listo para cobros manuales' : cfg.enabled ? 'Kushki no configurado' : 'Kushki deshabilitado',
        );
        this.loading = false;
      },
      error: () => {
        this.applyAvailability(false, 'No se pudo cargar la configuracion Kushki');
        this.loading = false;
      },
    });
  }
}
