import { Injectable, inject, signal } from '@angular/core';
import { Observable, finalize, map, tap } from 'rxjs';
import { PosBackendApiService } from '../api/pos-backend-api.service';
import { PosAuthService } from '../auth/pos-auth.service';
import type { PayPhoneIntentResponse, PayPhoneSaleRequest, PayPhoneSaleResponse, PayPhoneSaleStatusResponse, PayPhoneTenantConfigResponse } from '../api/pos-backend.types';
import { centsToUsd, payPhoneAmountCents, roundUsd, usdInputToCents } from './payment-money.util';
import type {
  PayPhoneConfigFormState,
  PayPhoneTestSaleInput,
  PaymentCollectionSession,
  PaymentCollectionStartInput,
  PaymentWidgetAmountContext,
  PosExternalPaymentStatus,
  PosPaymentLineDraft,
  PosPaymentMethodOption,
  PosPaymentWidget,
} from './pos-payment-widget.types';

@Injectable({ providedIn: 'root' })
export class PayPhonePaymentWidget implements PosPaymentWidget {
  private readonly api = inject(PosBackendApiService);
  private readonly auth = inject(PosAuthService);

  readonly code = 'payphone' as const;
  readonly methodOption: PosPaymentMethodOption = {
    code: 'payphone',
    label: 'PayPhone',
    icon: 'P',
    formaPago: '19',
    canal: 'PAYPHONE',
    proveedor: 'PAYPHONE',
  };

  readonly isAvailable = signal(false);
  readonly availabilityHint = signal('PayPhone no disponible');
  readonly session = signal<PaymentCollectionSession | null>(null);
  readonly busy = signal(false);
  readonly statusMessage = signal('');

  readonly configLoading = signal(false);
  readonly configSaving = signal(false);
  readonly configStatus = signal('');
  readonly configEnabled = signal(false);
  readonly configToken = signal('');
  readonly configTokenConfigured = signal(false);
  readonly configStoreId = signal('');
  readonly configBaseUrl = signal('');
  readonly configCurrency = signal('USD');
  readonly configTimeZone = signal('America/Guayaquil');
  readonly configResponseUrl = signal('');
  readonly configResponseUrlAutoManaged = signal(true);
  readonly configured = signal(false);
  readonly testCheckingStatus = signal(false);

  private loadingAvailability = false;
  private lastStatusCheckAt = 0;

  loadAvailability(): void {
    this.loadConfig(false);
  }

  loadConfig(updateStatus = true): void {
    if (!this.auth.apiBaseUrl?.trim()) {
      this.applyAvailability(false, 'API POS no configurada');
      if (updateStatus) {
        this.configStatus.set('API POS no configurada.');
      }
      return;
    }
    if (this.loadingAvailability) {
      return;
    }
    this.loadingAvailability = true;
    this.configLoading.set(true);
    this.api.getPayPhoneConfig().subscribe({
      next: (cfg) => {
        this.applyConfig(cfg);
        const available = cfg.enabled && cfg.configured;
        this.applyAvailability(
          available,
          available ? 'PayPhone listo para cobros' : cfg.enabled ? 'PayPhone no configurado' : 'PayPhone deshabilitado',
        );
        if (updateStatus) {
          this.configStatus.set(cfg.configured ? 'Configuracion PayPhone cargada.' : 'PayPhone no configurado para esta empresa.');
        }
        this.loadingAvailability = false;
        this.configLoading.set(false);
      },
      error: (err: unknown) => {
        this.applyAvailability(false, 'No se pudo cargar la configuracion PayPhone');
        if (updateStatus) {
          this.configStatus.set(this.errorMessage(err));
        }
        this.loadingAvailability = false;
        this.configLoading.set(false);
      },
    });
  }

  saveConfig(form: PayPhoneConfigFormState): Observable<PayPhoneTenantConfigResponse> {
    this.configSaving.set(true);
    return this.api
      .putPayPhoneConfig({
        enabled: form.enabled,
        token: form.token.trim() || null,
        storeId: form.storeId.trim() || null,
        baseUrl: form.baseUrl.trim() || null,
        currency: form.currency.trim().toUpperCase() || 'USD',
        timeZone: form.timeZone.trim() || 'America/Guayaquil',
      })
      .pipe(
        tap((cfg) => {
          this.configToken.set('');
          this.applyConfig(cfg);
          const available = cfg.enabled && cfg.configured;
          this.applyAvailability(
            available,
            available ? 'PayPhone listo para cobros' : cfg.enabled ? 'PayPhone no configurado' : 'PayPhone deshabilitado',
          );
          this.configStatus.set(
            cfg.configured
              ? 'PayPhone configurado correctamente.'
              : 'Configuracion guardada, pero faltan datos para operar.',
          );
        }),
        finalize(() => this.configSaving.set(false)),
      );
  }

  configFormState(): PayPhoneConfigFormState {
    return {
      enabled: this.configEnabled(),
      token: this.configToken(),
      storeId: this.configStoreId(),
      baseUrl: this.configBaseUrl(),
      currency: this.configCurrency(),
      timeZone: this.configTimeZone(),
    };
  }

  configLabel(): string {
    if (this.configLoading()) {
      return 'Cargando configuracion...';
    }
    if (!this.configEnabled()) {
      return 'PayPhone deshabilitado';
    }
    return this.configured() ? 'Configurado' : 'No configurado';
  }

  testAmountView(input: PayPhoneTestSaleInput): number {
    return centsToUsd(this.testAmountCents(input));
  }

  testAmountCents(input: PayPhoneTestSaleInput): number {
    return payPhoneAmountCents(input);
  }

  canCreateTestSale(input: PayPhoneTestSaleInput): boolean {
    return (
      this.configured() &&
      !this.busy() &&
      !!input.phoneNumber.trim() &&
      !!input.countryCode.trim() &&
      !!input.reference.trim() &&
      this.testAmountCents(input) > 0
    );
  }

  startTestSale(input: PayPhoneTestSaleInput, idempotencyKey: string): Observable<PaymentCollectionSession> {
    const body = this.buildTestSaleRequest(input);
    this.busy.set(true);
    this.configStatus.set('Creando cobro PayPhone...');
    return this.api.postPayPhoneSale(body, idempotencyKey, 'TEST').pipe(
      map((response) => this.toSession(response, this.resolveClientTransactionId(response, idempotencyKey))),
      tap((next) => {
        this.session.set(next);
        this.configStatus.set(`Cobro creado${next.providerStatus ? `: ${next.providerStatus}` : ''}.`);
      }),
      finalize(() => this.busy.set(false)),
    );
  }

  canCheckTestStatus(): boolean {
    const session = this.session();
    const hasId = !!session?.providerTransactionId?.trim() || !!session?.clientTransactionId?.trim();
    return hasId && !this.testCheckingStatus() && Date.now() - this.lastStatusCheckAt >= 10_000;
  }

  checkTestStatus(): Observable<PaymentCollectionSession> {
    const session = this.session();
    if (!session) {
      throw new Error('No hay cobro PayPhone para consultar');
    }
    this.lastStatusCheckAt = Date.now();
    this.testCheckingStatus.set(true);
    return this.refreshIntent(session.clientTransactionId).pipe(
      tap((next) => {
        this.configStatus.set(`Estado PayPhone${next.providerStatus ? `: ${next.providerStatus}` : ' recibido'}.`);
      }),
      finalize(() => this.testCheckingStatus.set(false)),
    );
  }

  resetSession(): void {
    this.session.set(null);
    this.busy.set(false);
    this.statusMessage.set('');
  }

  startCollection(
    amounts: PaymentWidgetAmountContext,
    input: PaymentCollectionStartInput,
  ): Observable<PaymentCollectionSession> {
    if (!input.phoneNumber?.trim() || !input.countryCode?.trim()) {
      throw new Error('Telefono y codigo de pais son requeridos para PayPhone');
    }
    const idempotencyKey = this.newIdempotencyKey();
    const body = this.buildSaleRequest(amounts, input);
    this.busy.set(true);
    this.statusMessage.set('Creando cobro PayPhone...');
    return this.api.postPayPhoneSale(body, idempotencyKey, 'CHECKOUT').pipe(
      map((response) => this.toSession(response, this.resolveClientTransactionId(response, idempotencyKey))),
      tap((next) => {
        this.session.set(next);
        this.statusMessage.set(this.describeSession(next));
      }),
      finalize(() => this.busy.set(false)),
    );
  }

  refreshStatus(session: PaymentCollectionSession): Observable<PaymentCollectionSession> {
    return this.refreshIntent(session.clientTransactionId);
  }

  refreshIntent(clientTransactionId: string): Observable<PaymentCollectionSession> {
    this.busy.set(true);
    return this.api.getPayPhoneIntent(clientTransactionId, true).pipe(
      map((intent) => this.toSessionFromIntent(intent)),
      tap((next) => {
        this.session.set(next);
        this.statusMessage.set(this.describeSession(next));
      }),
      finalize(() => this.busy.set(false)),
    );
  }

  sessionFromIntent(intent: PayPhoneIntentResponse): PaymentCollectionSession {
    return this.toSessionFromIntent(intent);
  }

  mapProviderStatus(status: string | null | undefined): PosExternalPaymentStatus {
    const normalized = (status ?? '').trim().toLowerCase();
    if (!normalized) {
      return 'pending';
    }
    if (/(approved|success|completed|paid|aceptad|aprob)/i.test(normalized)) {
      return 'confirmed';
    }
    if (/(cancel|reject|fail|declin|deneg|anul)/i.test(normalized)) {
      return 'rejected';
    }
    if (/(pending|wait|process|progress|enviad)/i.test(normalized)) {
      return 'pending';
    }
    if (normalized === '2' || normalized === 'approved') {
      return 'confirmed';
    }
    if (normalized === '3' || normalized === '4') {
      return 'rejected';
    }
    return 'pending';
  }

  toPaymentLineDraft(session: PaymentCollectionSession, amountUsd: number): PosPaymentLineDraft {
    const total = roundUsd(amountUsd);
    return {
      id: `pay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      method: this.methodOption.code,
      formaPago: this.methodOption.formaPago,
      canal: this.methodOption.canal,
      proveedor: this.methodOption.proveedor,
      total,
      recibido: total,
      vuelto: 0,
      transaccionProveedorId: session.providerTransactionId ?? session.clientTransactionId,
      codigoAutorizacion: null,
      referencia: session.clientTransactionId,
      status: session.externalStatus,
    };
  }

  buildSaleRequest(amounts: PaymentWidgetAmountContext, input: PaymentCollectionStartInput): PayPhoneSaleRequest {
    const breakdown = this.buildAmountBreakdown(amounts);
    return {
      phoneNumber: input.phoneNumber!.trim(),
      countryCode: input.countryCode!.trim(),
      amount: breakdown.amountCents,
      amountWithoutTax: breakdown.amountWithoutTaxCents,
      amountWithTax: breakdown.amountWithTaxCents,
      tax: breakdown.taxCents,
      service: 0,
      tip: 0,
      reference: input.reference.trim(),
    };
  }

  buildTestSaleRequest(input: PayPhoneTestSaleInput): PayPhoneSaleRequest {
    const amount = this.testAmountCents(input);
    return {
      phoneNumber: input.phoneNumber.trim(),
      countryCode: input.countryCode.trim(),
      amount,
      amountWithoutTax: usdInputToCents(input.amountWithoutTax),
      amountWithTax: usdInputToCents(input.amountWithTax),
      tax: usdInputToCents(input.tax),
      service: usdInputToCents(input.service),
      tip: usdInputToCents(input.tip),
      reference: input.reference.trim(),
      clientTransactionId: input.clientTransactionId?.trim() || null,
      clientUserId: input.clientUserId?.trim() || null,
      optionalParameter1: input.optionalParameter1?.trim() || null,
      optionalParameter2: input.optionalParameter2?.trim() || null,
      optionalParameter3: input.optionalParameter3?.trim() || null,
    };
  }

  buildAmountBreakdown(amounts: PaymentWidgetAmountContext): {
    amountCents: number;
    amountWithoutTaxCents: number;
    amountWithTaxCents: number;
    taxCents: number;
  } {
    const payment = Math.max(0, roundUsd(amounts.paymentUsd));
    const ticketTotal = Math.max(0, roundUsd(amounts.ticketTotalUsd));
    const subtotal = Math.max(0, roundUsd(amounts.subtotalUsd));
    const tax = Math.max(0, roundUsd(amounts.taxUsd));
    const ratio = ticketTotal > 0 ? payment / ticketTotal : 1;
    const amountWithoutTaxCents = usdInputToCents(subtotal * ratio);
    const taxCents = usdInputToCents(tax * ratio);
    const amountWithTaxCents = 0;
    const amountCents = amountWithoutTaxCents + amountWithTaxCents + taxCents;
    return { amountCents, amountWithoutTaxCents, amountWithTaxCents, taxCents };
  }

  private applyConfig(cfg: PayPhoneTenantConfigResponse): void {
    this.configEnabled.set(cfg.enabled);
    this.configTokenConfigured.set(cfg.tokenConfigured);
    this.configStoreId.set(cfg.storeId ?? '');
    this.configBaseUrl.set(cfg.baseUrl ?? '');
    this.configCurrency.set((cfg.currency ?? 'USD').trim().toUpperCase() || 'USD');
    this.configTimeZone.set(cfg.timeZone ?? 'America/Guayaquil');
    this.configResponseUrl.set(cfg.responseUrl ?? '');
    this.configResponseUrlAutoManaged.set(cfg.responseUrlAutoManaged ?? true);
    this.configured.set(cfg.configured);
  }

  private toSessionFromIntent(intent: PayPhoneIntentResponse): PaymentCollectionSession {
    return {
      providerTransactionId: intent.providerTransactionId ?? null,
      clientTransactionId: intent.clientTransactionId,
      externalStatus: intent.externalStatus === 'idle' ? 'pending' : intent.externalStatus,
      providerStatus: intent.providerStatus ?? intent.status,
      message: intent.message ?? null,
    };
  }

  private resolveClientTransactionId(response: PayPhoneSaleResponse, fallback: string): string {
    return this.stringFromUnknown(response.clientTransactionId) || fallback;
  }

  private newIdempotencyKey(): string {
    return `POS-PAYPHONE-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private applyAvailability(available: boolean, hint: string): void {
    this.isAvailable.set(available);
    this.availabilityHint.set(hint);
  }

  private toSession(response: PayPhoneSaleResponse, clientTransactionId: string): PaymentCollectionSession {
    const providerTransactionId = this.stringFromUnknown(response.transactionId);
    const providerStatus = this.stringFromUnknown(response.status);
    const externalStatus = this.mapProviderStatus(providerStatus);
    return {
      providerTransactionId,
      clientTransactionId: this.stringFromUnknown(response.clientTransactionId) || clientTransactionId,
      externalStatus: externalStatus === 'idle' ? 'pending' : externalStatus,
      providerStatus,
      message: this.stringFromUnknown(response.message),
    };
  }

  private toSessionFromStatus(
    response: PayPhoneSaleStatusResponse,
    clientTransactionId: string,
    previousTransactionId: string | null,
  ): PaymentCollectionSession {
    const nested = this.readPayPhonePayload(response);
    const providerTransactionId =
      this.stringFromUnknown(response.transactionId) ??
      this.stringFromUnknown(nested['transactionId']) ??
      previousTransactionId;
    const providerStatus =
      this.stringFromUnknown(response.status) ??
      this.stringFromUnknown(nested['status']) ??
      this.stringFromUnknown(nested['statusCode']);
    const resolvedClientTx =
      this.stringFromUnknown(response.clientTransactionId) ??
      this.stringFromUnknown(nested['clientTransactionId']) ??
      clientTransactionId;
    const externalStatus = this.mapProviderStatus(providerStatus);
    return {
      providerTransactionId,
      clientTransactionId: resolvedClientTx,
      externalStatus: externalStatus === 'idle' ? 'pending' : externalStatus,
      providerStatus,
      message:
        this.stringFromUnknown(response.message) ??
        this.stringFromUnknown(nested['message']) ??
        this.stringFromUnknown(nested['statusMessage']),
    };
  }

  private readPayPhonePayload(response: PayPhoneSaleStatusResponse | PayPhoneSaleResponse): Record<string, unknown> {
    const raw = response['payphoneResponse'];
    if (raw && typeof raw === 'object') {
      return raw as Record<string, unknown>;
    }
    return {};
  }

  private describeSession(session: PaymentCollectionSession): string {
    const status = session.providerStatus?.trim();
    if (session.externalStatus === 'confirmed') {
      return status ? `Cobro confirmado (${status})` : 'Cobro confirmado';
    }
    if (session.externalStatus === 'rejected') {
      return status ? `Cobro rechazado (${status})` : 'Cobro rechazado';
    }
    return status ? `Cobro pendiente (${status})` : 'Cobro pendiente; espere confirmacion en el telefono';
  }

  private stringFromUnknown(value: unknown): string | null {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed || null;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
    return null;
  }

  private errorMessage(err: unknown): string {
    if (err && typeof err === 'object' && 'error' in err) {
      const body = (err as { error?: { message?: string } | string }).error;
      if (typeof body === 'string' && body.trim()) {
        return body;
      }
      if (body && typeof body === 'object' && typeof body.message === 'string' && body.message.trim()) {
        return body.message;
      }
    }
    return err instanceof Error ? err.message : 'Error PayPhone';
  }
}
