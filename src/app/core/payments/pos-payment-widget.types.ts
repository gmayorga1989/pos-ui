import type { Observable } from 'rxjs';
import type { Signal } from '@angular/core';

export type PosPaymentMethodCode =
  | 'cash'
  | 'card'
  | 'transfer'
  | 'stripe'
  | 'kushki'
  | 'payphone'
  | 'other';

export type PosExternalPaymentStatus = 'idle' | 'pending' | 'confirmed' | 'rejected';

export interface PosPaymentMethodOption {
  code: PosPaymentMethodCode;
  label: string;
  icon: string;
  formaPago: string;
  canal: string;
  proveedor: string | null;
}

export interface PosPaymentLineDraft {
  id: string;
  method: PosPaymentMethodCode;
  formaPago: string;
  canal: string;
  proveedor: string | null;
  total: number;
  recibido: number | null;
  vuelto: number;
  transaccionProveedorId: string | null;
  codigoAutorizacion: string | null;
  referencia: string | null;
  status: PosExternalPaymentStatus;
}

export interface PaymentWidgetAmountContext {
  paymentUsd: number;
  subtotalUsd: number;
  taxUsd: number;
  ticketTotalUsd: number;
}

export interface PaymentCollectionStartInput {
  phoneNumber?: string;
  countryCode?: string;
  reference: string;
}

export interface PayPhoneConfigFormState {
  enabled: boolean;
  token: string;
  storeId: string;
  baseUrl: string;
  currency: string;
  timeZone: string;
  defaultCountryCode: string;
}

export interface PaymentCollectionSession {
  providerTransactionId: string | null;
  clientTransactionId: string;
  externalStatus: PosExternalPaymentStatus;
  providerStatus: string | null;
  message: string | null;
}

export interface PosPaymentWidget {
  readonly code: PosPaymentMethodCode;
  readonly methodOption: PosPaymentMethodOption;
  readonly isAvailable: Signal<boolean>;
  readonly availabilityHint: Signal<string>;
  readonly session: Signal<PaymentCollectionSession | null>;
  readonly busy: Signal<boolean>;
  readonly statusMessage: Signal<string>;
  loadAvailability(): void;
  resetSession(): void;
  startCollection(
    amounts: PaymentWidgetAmountContext,
    input: PaymentCollectionStartInput,
  ): Observable<PaymentCollectionSession>;
  refreshStatus(session: PaymentCollectionSession): Observable<PaymentCollectionSession>;
  mapProviderStatus(status: string | null | undefined): PosExternalPaymentStatus;
  toPaymentLineDraft(session: PaymentCollectionSession, amountUsd: number): PosPaymentLineDraft;
}

export interface ManualPaymentWidget extends PosPaymentWidget {
  initiateManualCollection(reference: string): PaymentCollectionSession;
}
