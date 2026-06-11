import { HttpClient, HttpHeaders } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { PosAuthService } from '../auth/pos-auth.service';
import type {
  PosCajaSnapshotResponse,
  PosCajaAperturaRequest,
  PosCajaCierreRequest,
  PosCajaHistorialResponse,
  PosCheckoutRequestBody,
  PosCheckoutResponse,
  PosPaymentCollectionResponse,
  PosComprobanteResponse,
  PosOfflineComprobanteSyncRequest,
  PosOfflineSyncStatusResponse,
  PosPuntoEmisionOption,
  KushkiSubscriptionCreateRequest,
  KushkiSubscriptionCreateResponse,
  KushkiTenantConfigRequest,
  KushkiTenantConfigResponse,
  PayPhoneSaleRequest,
  PayPhoneSaleResponse,
  PayPhoneSaleStatusResponse,
  PayPhoneTenantConfigRequest,
  PayPhoneTenantConfigResponse,
  PosCedulaConsultaResponse,
  PosCustomerRequest,
  PosCustomerResponse,
  PosRucConsultaResponse,
  PosInvoicingConfigRequest,
  PosInvoicingConfigResponse,
  PosProductRequest,
  PosProductResponse,
  PosSalesReportResponse,
  StripeSubscriptionCheckoutRequest,
  StripeSubscriptionCheckoutResponse,
  StripeTenantConfigRequest,
  StripeTenantConfigResponse,
} from './pos-backend.types';

@Injectable({ providedIn: 'root' })
export class PosBackendApiService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(PosAuthService);

  private apiRoot(): string | null {
    const b = this.auth.apiBaseUrl?.replace(/\/+$/, '');
    return b ? `${b}/api/v1/pos` : null;
  }

  getCajaSnapshot(): Observable<PosCajaSnapshotResponse> {
    const root = this.apiRoot();
    if (!root) {
      throw new Error('posApiOrigin no configurado');
    }
    return this.http.get<PosCajaSnapshotResponse>(`${root}/caja`);
  }

  postCajaApertura(openingFloat?: number | null): Observable<PosCajaSnapshotResponse> {
    const root = this.apiRoot();
    if (!root) {
      throw new Error('posApiOrigin no configurado');
    }
    const body: PosCajaAperturaRequest = openingFloat == null ? {} : { openingFloat };
    return this.http.post<PosCajaSnapshotResponse>(`${root}/caja/apertura`, body);
  }

  postCajaCierre(body?: PosCajaCierreRequest): Observable<PosCajaSnapshotResponse> {
    const root = this.apiRoot();
    if (!root) {
      throw new Error('posApiOrigin no configurado');
    }
    return this.http.post<PosCajaSnapshotResponse>(`${root}/caja/cierre`, body ?? {});
  }

  getCajaHistorial(): Observable<PosCajaHistorialResponse> {
    const root = this.apiRoot();
    if (!root) {
      throw new Error('posApiOrigin no configurado');
    }
    return this.http.get<PosCajaHistorialResponse>(`${root}/caja/historial`);
  }

  getPuntosEmision(): Observable<PosPuntoEmisionOption[]> {
    const root = this.apiRoot();
    if (!root) {
      throw new Error('posApiOrigin no configurado');
    }
    return this.http.get<PosPuntoEmisionOption[]>(`${root}/efactura/facturas/puntos-emision`);
  }

  postCheckout(body: PosCheckoutRequestBody, idempotencyKey: string): Observable<PosCheckoutResponse> {
    const root = this.apiRoot();
    if (!root) {
      throw new Error('posApiOrigin no configurado');
    }
    const headers = new HttpHeaders({ 'Idempotency-Key': idempotencyKey });
    return this.http.post<PosCheckoutResponse>(`${root}/sales/checkout`, body, { headers });
  }

  getCobro(collectionId: string): Observable<PosPaymentCollectionResponse> {
    const root = this.apiRoot();
    if (!root) {
      throw new Error('posApiOrigin no configurado');
    }
    return this.http.get<PosPaymentCollectionResponse>(`${root}/cobros/${encodeURIComponent(collectionId)}`);
  }

  postOfflineComprobanteSync(body: PosOfflineComprobanteSyncRequest): Observable<PosComprobanteResponse> {
    const root = this.apiRoot();
    if (!root) {
      throw new Error('posApiOrigin no configurado');
    }
    return this.http.post<PosComprobanteResponse>(`${root}/comprobantes/offline-sync`, body);
  }

  getOfflineSyncStatus(offlineDeviceId: string): Observable<PosOfflineSyncStatusResponse> {
    const root = this.apiRoot();
    if (!root) {
      throw new Error('posApiOrigin no configurado');
    }
    return this.http.get<PosOfflineSyncStatusResponse>(
      `${root}/comprobantes/sync-status?offlineDeviceId=${encodeURIComponent(offlineDeviceId)}`,
    );
  }

  getStripeConfig(): Observable<StripeTenantConfigResponse> {
    const root = this.apiRoot();
    if (!root) {
      throw new Error('posApiOrigin no configurado');
    }
    return this.http.get<StripeTenantConfigResponse>(`${root}/payments/stripe/config`);
  }

  putStripeConfig(body: StripeTenantConfigRequest): Observable<StripeTenantConfigResponse> {
    const root = this.apiRoot();
    if (!root) {
      throw new Error('posApiOrigin no configurado');
    }
    return this.http.put<StripeTenantConfigResponse>(`${root}/payments/stripe/config`, body);
  }

  postStripeSubscriptionCheckout(
    body: StripeSubscriptionCheckoutRequest,
    idempotencyKey: string,
  ): Observable<StripeSubscriptionCheckoutResponse> {
    const root = this.apiRoot();
    if (!root) {
      throw new Error('posApiOrigin no configurado');
    }
    const headers = new HttpHeaders({ 'Idempotency-Key': idempotencyKey });
    return this.http.post<StripeSubscriptionCheckoutResponse>(
      `${root}/payments/stripe/subscription-checkout`,
      body,
      { headers },
    );
  }

  getKushkiConfig(): Observable<KushkiTenantConfigResponse> {
    const root = this.apiRoot();
    if (!root) {
      throw new Error('posApiOrigin no configurado');
    }
    return this.http.get<KushkiTenantConfigResponse>(`${root}/payments/kushki/config`);
  }

  putKushkiConfig(body: KushkiTenantConfigRequest): Observable<KushkiTenantConfigResponse> {
    const root = this.apiRoot();
    if (!root) {
      throw new Error('posApiOrigin no configurado');
    }
    return this.http.put<KushkiTenantConfigResponse>(`${root}/payments/kushki/config`, body);
  }

  postKushkiSubscription(
    body: KushkiSubscriptionCreateRequest,
    idempotencyKey: string,
  ): Observable<KushkiSubscriptionCreateResponse> {
    const root = this.apiRoot();
    if (!root) {
      throw new Error('posApiOrigin no configurado');
    }
    const headers = new HttpHeaders({ 'Idempotency-Key': idempotencyKey });
    return this.http.post<KushkiSubscriptionCreateResponse>(`${root}/payments/kushki/subscriptions`, body, {
      headers,
    });
  }

  getPayPhoneConfig(): Observable<PayPhoneTenantConfigResponse> {
    const root = this.apiRoot();
    if (!root) {
      throw new Error('posApiOrigin no configurado');
    }
    return this.http.get<PayPhoneTenantConfigResponse>(`${root}/payments/payphone/config`);
  }

  putPayPhoneConfig(body: PayPhoneTenantConfigRequest): Observable<PayPhoneTenantConfigResponse> {
    const root = this.apiRoot();
    if (!root) {
      throw new Error('posApiOrigin no configurado');
    }
    return this.http.put<PayPhoneTenantConfigResponse>(`${root}/payments/payphone/config`, body);
  }

  postPayPhoneSale(body: PayPhoneSaleRequest, idempotencyKey: string): Observable<PayPhoneSaleResponse> {
    const root = this.apiRoot();
    if (!root) {
      throw new Error('posApiOrigin no configurado');
    }
    const headers = new HttpHeaders({ 'Idempotency-Key': idempotencyKey });
    return this.http.post<PayPhoneSaleResponse>(`${root}/payments/payphone/sales`, body, { headers });
  }

  getPayPhoneSaleStatus(transactionId: string): Observable<PayPhoneSaleStatusResponse> {
    const root = this.apiRoot();
    if (!root) {
      throw new Error('posApiOrigin no configurado');
    }
    return this.http.get<PayPhoneSaleStatusResponse>(
      `${root}/payments/payphone/sales/${encodeURIComponent(transactionId)}/status`,
    );
  }

  getPayPhoneSaleStatusByClientTransactionId(
    clientTransactionId: string,
  ): Observable<PayPhoneSaleStatusResponse> {
    const root = this.apiRoot();
    if (!root) {
      throw new Error('posApiOrigin no configurado');
    }
    return this.http.get<PayPhoneSaleStatusResponse>(
      `${root}/payments/payphone/sales/client/${encodeURIComponent(clientTransactionId)}/status`,
    );
  }

  getProducts(): Observable<PosProductResponse[]> {
    const root = this.apiRoot();
    if (!root) {
      throw new Error('posApiOrigin no configurado');
    }
    return this.http.get<PosProductResponse[]>(`${root}/products`);
  }

  postProduct(body: PosProductRequest): Observable<PosProductResponse> {
    const root = this.apiRoot();
    if (!root) {
      throw new Error('posApiOrigin no configurado');
    }
    return this.http.post<PosProductResponse>(`${root}/products`, body);
  }

  putProduct(id: string, body: PosProductRequest): Observable<PosProductResponse> {
    const root = this.apiRoot();
    if (!root) {
      throw new Error('posApiOrigin no configurado');
    }
    return this.http.put<PosProductResponse>(`${root}/products/${encodeURIComponent(id)}`, body);
  }

  deleteProduct(id: string): Observable<void> {
    const root = this.apiRoot();
    if (!root) {
      throw new Error('posApiOrigin no configurado');
    }
    return this.http.delete<void>(`${root}/products/${encodeURIComponent(id)}`);
  }

  getCustomers(q?: string, includeInactive = false): Observable<PosCustomerResponse[]> {
    const root = this.apiRoot();
    if (!root) {
      throw new Error('posApiOrigin no configurado');
    }
    const search = new URLSearchParams();
    if (q?.trim()) {
      search.set('q', q.trim());
    }
    if (includeInactive) {
      search.set('includeInactive', 'true');
    }
    const qs = search.toString();
    return this.http.get<PosCustomerResponse[]>(`${root}/customers${qs ? `?${qs}` : ''}`);
  }

  postCustomer(body: PosCustomerRequest): Observable<PosCustomerResponse> {
    const root = this.apiRoot();
    if (!root) {
      throw new Error('posApiOrigin no configurado');
    }
    return this.http.post<PosCustomerResponse>(`${root}/customers`, body);
  }

  putCustomer(id: string, body: PosCustomerRequest): Observable<PosCustomerResponse> {
    const root = this.apiRoot();
    if (!root) {
      throw new Error('posApiOrigin no configurado');
    }
    return this.http.put<PosCustomerResponse>(`${root}/customers/${encodeURIComponent(id)}`, body);
  }

  consultarCedula(cedula: string): Observable<PosCedulaConsultaResponse> {
    const root = this.apiRoot();
    if (!root) {
      throw new Error('posApiOrigin no configurado');
    }
    return this.http.get<PosCedulaConsultaResponse>(
      `${root}/catastro/cedula/${encodeURIComponent(cedula.trim())}`,
    );
  }

  consultarRuc(ruc: string): Observable<PosRucConsultaResponse> {
    const root = this.apiRoot();
    if (!root) {
      throw new Error('posApiOrigin no configurado');
    }
    return this.http.get<PosRucConsultaResponse>(`${root}/catastro/ruc/${encodeURIComponent(ruc.trim())}`);
  }

  syncEfacturaCatalog(): Observable<{ itemsSynced: number; source: string }> {
    const root = this.apiRoot();
    if (!root) {
      throw new Error('posApiOrigin no configurado');
    }
    return this.http.post<{ itemsSynced: number; source: string }>(`${root}/catalog/sync-efactura`, {});
  }

  getInvoicingConfig(): Observable<PosInvoicingConfigResponse> {
    const root = this.apiRoot();
    if (!root) {
      throw new Error('posApiOrigin no configurado');
    }
    return this.http.get<PosInvoicingConfigResponse>(`${root}/invoicing/config`);
  }

  putInvoicingConfig(body: PosInvoicingConfigRequest): Observable<PosInvoicingConfigResponse> {
    const root = this.apiRoot();
    if (!root) {
      throw new Error('posApiOrigin no configurado');
    }
    return this.http.put<PosInvoicingConfigResponse>(`${root}/invoicing/config`, body);
  }

  getInvoicingPending(): Observable<{ pendingExternal: number }> {
    const root = this.apiRoot();
    if (!root) {
      throw new Error('posApiOrigin no configurado');
    }
    return this.http.get<{ pendingExternal: number }>(`${root}/invoicing/pending`);
  }

  retryInvoicingPending(): Observable<{ pendingExternal: number }> {
    const root = this.apiRoot();
    if (!root) {
      throw new Error('posApiOrigin no configurado');
    }
    return this.http.post<{ pendingExternal: number }>(`${root}/invoicing/retry-pending`, {});
  }

  getSalesReport(from?: string, to?: string): Observable<PosSalesReportResponse> {
    const root = this.apiRoot();
    if (!root) {
      throw new Error('posApiOrigin no configurado');
    }
    const q = new URLSearchParams();
    if (from) {
      q.set('from', from);
    }
    if (to) {
      q.set('to', to);
    }
    const suffix = q.toString() ? `?${q}` : '';
    return this.http.get<PosSalesReportResponse>(`${root}/reports/sales${suffix}`);
  }
}
