import { signal } from '@angular/core';
import { Observable, of } from 'rxjs';
import type {
  ManualPaymentWidget,
  PaymentCollectionSession,
  PaymentCollectionStartInput,
  PaymentWidgetAmountContext,
  PosExternalPaymentStatus,
  PosPaymentLineDraft,
  PosPaymentMethodCode,
  PosPaymentMethodOption,
} from './pos-payment-widget.types';

export abstract class ManualExternalPaymentWidget implements ManualPaymentWidget {
  abstract readonly code: PosPaymentMethodCode;
  abstract readonly methodOption: PosPaymentMethodOption;

  readonly isAvailable = signal(false);
  readonly availabilityHint = signal('');
  readonly session = signal<PaymentCollectionSession | null>(null);
  readonly busy = signal(false);
  readonly statusMessage = signal('');

  abstract loadAvailability(): void;

  resetSession(): void {
    this.session.set(null);
    this.busy.set(false);
    this.statusMessage.set('');
  }

  startCollection(
    _amounts: PaymentWidgetAmountContext,
    input: PaymentCollectionStartInput,
  ): Observable<PaymentCollectionSession> {
    const next = this.initiateManualCollection(input.reference.trim() || this.methodOption.label);
    this.session.set(next);
    this.statusMessage.set('Confirme manualmente la transaccion del proveedor.');
    return of(next);
  }

  refreshStatus(session: PaymentCollectionSession): Observable<PaymentCollectionSession> {
    return of(session);
  }

  mapProviderStatus(status: string | null | undefined): PosExternalPaymentStatus {
    return this.mapManualStatus(status);
  }

  initiateManualCollection(reference: string): PaymentCollectionSession {
    const clientTransactionId = this.newClientTransactionId();
    return {
      providerTransactionId: `POS-${this.code.toUpperCase()}-${Date.now()}`,
      clientTransactionId,
      externalStatus: 'confirmed',
      providerStatus: 'manual',
      message: reference.trim() || null,
    };
  }

  toPaymentLineDraft(session: PaymentCollectionSession, amountUsd: number): PosPaymentLineDraft {
    const total = Math.round(amountUsd * 100) / 100;
    return {
      id: `pay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      method: this.methodOption.code,
      formaPago: this.methodOption.formaPago,
      canal: this.methodOption.canal,
      proveedor: this.methodOption.proveedor,
      total,
      recibido: total,
      vuelto: 0,
      transaccionProveedorId: session.providerTransactionId,
      codigoAutorizacion: null,
      referencia: session.message?.trim() || this.methodOption.label,
      status: session.externalStatus,
    };
  }

  protected applyAvailability(available: boolean, hint: string): void {
    this.isAvailable.set(available);
    this.availabilityHint.set(hint);
  }

  protected mapManualStatus(status: string | null | undefined): PosExternalPaymentStatus {
    const normalized = (status ?? '').trim().toLowerCase();
    if (normalized === 'confirmed' || normalized === 'approved') {
      return 'confirmed';
    }
    if (normalized === 'rejected' || normalized === 'failed') {
      return 'rejected';
    }
    if (normalized === 'pending') {
      return 'pending';
    }
    return 'idle';
  }

  protected newClientTransactionId(): string {
    return `POS-${this.code.toUpperCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}
