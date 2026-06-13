import { HttpClient, HttpHeaders } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable, map } from 'rxjs';
import { PosAuthService } from '../auth/pos-auth.service';
import type {
  PosCajaSnapshotResponse,
  PosCajaAperturaRequest,
  PosCajaCierreRequest,
  PosCajaHistorialResponse,
  PosCajaHistoryItem,
  PosCheckoutRequestBody,
  PosCheckoutResponse,
  PosPaymentCollectionResponse,
  PosComprobanteResponse,
  PosOfflineComprobanteSyncRequest,
  PosOfflineSyncStatusResponse,
  PosPuntoEmisionOption,
  PosPuntoEmisionRequest,
  KushkiSubscriptionCreateRequest,
  KushkiSubscriptionCreateResponse,
  KushkiTenantConfigRequest,
  KushkiTenantConfigResponse,
  PayPhoneSaleRequest,
  PayPhoneSaleResponse,
  PayPhoneSaleStatusResponse,
  PayPhoneIntentResponse,
  PayPhoneRecoverableIntentsResponse,
  PayPhoneTenantConfigRequest,
  PayPhoneTenantConfigResponse,
  PosCedulaConsultaResponse,
  PosCustomerRequest,
  PosCustomerResponse,
  PosRucConsultaResponse,
  PosInvoicingConfigRequest,
  PosInvoicingConfigResponse,
  PosPriceListRequest,
  PosPriceListResponse,
  PosProductCategoryRequest,
  PosProductCategoryResponse,
  PosProductPriceEntry,
  PosProductPriceMatrixEntry,
  PosProductPriceResponse,
  PosBulkImageResult,
  PosImportKind,
  PosImportPreset,
  PosImportPreviewResult,
  PosImportResult,
  PosProductRequest,
  PosProductResponse,
  PosSalesReportResponse,
  PosSaleListResponse,
  StripeSubscriptionCheckoutRequest,
  StripeSubscriptionCheckoutResponse,
  StripeTenantConfigRequest,
  StripeTenantConfigResponse,
} from './pos-backend.types';
import { mapCajaHistorialResponse, normalizePaymentCollection } from './pos-backend.mappers';

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

  getCajaHistorial(): Observable<PosCajaHistoryItem[]> {
    const root = this.apiRoot();
    if (!root) {
      throw new Error('posApiOrigin no configurado');
    }
    return this.http
      .get<PosCajaHistorialResponse>(`${root}/caja/historial`)
      .pipe(map((response) => mapCajaHistorialResponse(response)));
  }

  getLocalPuntosEmision(): Observable<PosPuntoEmisionOption[]> {
    const root = this.apiRoot();
    if (!root) {
      throw new Error('posApiOrigin no configurado');
    }
    return this.http.get<PosPuntoEmisionOption[]>(`${root}/puntos-emision`);
  }

  postLocalPuntoEmision(body: PosPuntoEmisionRequest): Observable<PosPuntoEmisionOption> {
    const root = this.apiRoot();
    if (!root) {
      throw new Error('posApiOrigin no configurado');
    }
    return this.http.post<PosPuntoEmisionOption>(`${root}/puntos-emision`, body);
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
    return this.http
      .get<PosPaymentCollectionResponse>(`${root}/cobros/${encodeURIComponent(collectionId)}`)
      .pipe(map((response) => normalizePaymentCollection(response)!));
  }

  listSales(from: string, to: string, cashSessionId?: string | null): Observable<PosSaleListResponse> {
    const root = this.apiRoot();
    if (!root) {
      throw new Error('posApiOrigin no configurado');
    }
    let url = `${root}/sales?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    if (cashSessionId?.trim()) {
      url += `&cashSessionId=${encodeURIComponent(cashSessionId.trim())}`;
    }
    return this.http.get<PosSaleListResponse>(url);
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

  postPayPhoneSale(
    body: PayPhoneSaleRequest,
    idempotencyKey: string,
    context: 'CHECKOUT' | 'TEST' = 'CHECKOUT',
  ): Observable<PayPhoneSaleResponse> {
    const root = this.apiRoot();
    if (!root) {
      throw new Error('posApiOrigin no configurado');
    }
    const headers = new HttpHeaders({
      'Idempotency-Key': idempotencyKey,
      'X-Pos-Payphone-Context': context,
    });
    return this.http.post<PayPhoneSaleResponse>(`${root}/payments/payphone/sales`, body, { headers });
  }

  getPayPhoneIntent(clientTransactionId: string, refresh = true): Observable<PayPhoneIntentResponse> {
    const root = this.apiRoot();
    if (!root) {
      throw new Error('posApiOrigin no configurado');
    }
    const q = refresh ? '?refresh=true' : '?refresh=false';
    return this.http.get<PayPhoneIntentResponse>(
      `${root}/payments/payphone/intents/${encodeURIComponent(clientTransactionId)}${q}`,
    );
  }

  getRecoverablePayPhoneIntents(): Observable<PayPhoneRecoverableIntentsResponse> {
    const root = this.apiRoot();
    if (!root) {
      throw new Error('posApiOrigin no configurado');
    }
    return this.http.get<PayPhoneRecoverableIntentsResponse>(`${root}/payments/payphone/intents/recoverable`);
  }

  consumePayPhoneIntent(clientTransactionId: string): Observable<PayPhoneIntentResponse> {
    const root = this.apiRoot();
    if (!root) {
      throw new Error('posApiOrigin no configurado');
    }
    return this.http.post<PayPhoneIntentResponse>(
      `${root}/payments/payphone/intents/${encodeURIComponent(clientTransactionId)}/consume`,
      {},
    );
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

  getProductCategories(includeInactive = false): Observable<PosProductCategoryResponse[]> {
    const root = this.apiRoot();
    if (!root) {
      throw new Error('posApiOrigin no configurado');
    }
    const q = includeInactive ? '?includeInactive=true' : '';
    return this.http.get<PosProductCategoryResponse[]>(`${root}/product-categories${q}`);
  }

  postProductCategory(body: PosProductCategoryRequest): Observable<PosProductCategoryResponse> {
    const root = this.apiRoot();
    if (!root) {
      throw new Error('posApiOrigin no configurado');
    }
    return this.http.post<PosProductCategoryResponse>(`${root}/product-categories`, body);
  }

  getPriceLists(includeInactive = false): Observable<PosPriceListResponse[]> {
    const root = this.apiRoot();
    if (!root) {
      throw new Error('posApiOrigin no configurado');
    }
    const q = includeInactive ? '?includeInactive=true' : '';
    return this.http.get<PosPriceListResponse[]>(`${root}/price-lists${q}`);
  }

  postPriceList(body: PosPriceListRequest): Observable<PosPriceListResponse> {
    const root = this.apiRoot();
    if (!root) {
      throw new Error('posApiOrigin no configurado');
    }
    return this.http.post<PosPriceListResponse>(`${root}/price-lists`, body);
  }

  putPriceList(id: string, body: PosPriceListRequest): Observable<PosPriceListResponse> {
    const root = this.apiRoot();
    if (!root) {
      throw new Error('posApiOrigin no configurado');
    }
    return this.http.put<PosPriceListResponse>(`${root}/price-lists/${encodeURIComponent(id)}`, body);
  }

  activatePriceList(id: string): Observable<PosPriceListResponse> {
    const root = this.apiRoot();
    if (!root) {
      throw new Error('posApiOrigin no configurado');
    }
    return this.http.post<PosPriceListResponse>(`${root}/price-lists/${encodeURIComponent(id)}/activate`, {});
  }

  deactivatePriceList(id: string): Observable<void> {
    const root = this.apiRoot();
    if (!root) {
      throw new Error('posApiOrigin no configurado');
    }
    return this.http.post<void>(`${root}/price-lists/${encodeURIComponent(id)}/deactivate`, {});
  }

  getProductPrices(productId: string): Observable<PosProductPriceResponse[]> {
    const root = this.apiRoot();
    if (!root) {
      throw new Error('posApiOrigin no configurado');
    }
    return this.http.get<PosProductPriceResponse[]>(
      `${root}/products/${encodeURIComponent(productId)}/prices`,
    );
  }

  getProductPriceMatrix(): Observable<PosProductPriceMatrixEntry[]> {
    const root = this.apiRoot();
    if (!root) {
      throw new Error('posApiOrigin no configurado');
    }
    return this.http.get<PosProductPriceMatrixEntry[]>(`${root}/products/prices-matrix`);
  }

  uploadProductImage(productId: string, file: File): Observable<PosProductResponse> {
    const root = this.apiRoot();
    if (!root) {
      throw new Error('posApiOrigin no configurado');
    }
    const form = new FormData();
    form.append('file', file);
    return this.http.post<PosProductResponse>(`${root}/products/${encodeURIComponent(productId)}/image`, form);
  }

  bulkUploadProductImages(file: File, matchBy: 'sku' | 'barcode' = 'sku'): Observable<PosBulkImageResult> {
    const root = this.apiRoot();
    if (!root) {
      throw new Error('posApiOrigin no configurado');
    }
    const form = new FormData();
    form.append('file', file);
    return this.http.post<PosBulkImageResult>(`${root}/products/images/bulk?matchBy=${matchBy}`, form);
  }

  putProductCategory(id: string, body: PosProductCategoryRequest): Observable<PosProductCategoryResponse> {
    const root = this.apiRoot();
    if (!root) {
      throw new Error('posApiOrigin no configurado');
    }
    return this.http.put<PosProductCategoryResponse>(
      `${root}/product-categories/${encodeURIComponent(id)}`,
      body,
    );
  }

  deleteProductCategory(id: string): Observable<void> {
    const root = this.apiRoot();
    if (!root) {
      throw new Error('posApiOrigin no configurado');
    }
    return this.http.delete<void>(`${root}/product-categories/${encodeURIComponent(id)}`);
  }

  activateProductCategory(id: string): Observable<PosProductCategoryResponse> {
    const root = this.apiRoot();
    if (!root) {
      throw new Error('posApiOrigin no configurado');
    }
    return this.http.post<PosProductCategoryResponse>(
      `${root}/product-categories/${encodeURIComponent(id)}/activate`,
      {},
    );
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

  getImportPresets(kind?: PosImportKind): Observable<PosImportPreset[]> {
    const root = this.apiRoot();
    if (!root) {
      throw new Error('posApiOrigin no configurado');
    }
    const q = kind ? `?kind=${encodeURIComponent(kind)}` : '';
    return this.http.get<PosImportPreset[]>(`${root}/import/presets${q}`);
  }

  downloadImportTemplate(kind: PosImportKind): Observable<Blob> {
    const root = this.apiRoot();
    if (!root) {
      throw new Error('posApiOrigin no configurado');
    }
    const segment = kind === 'products' ? 'products' : 'customers';
    return this.http.get(`${root}/import/${segment}/template`, { responseType: 'blob' });
  }

  previewImport(
    kind: PosImportKind,
    file: File,
    mapping?: Record<string, string> | null,
  ): Observable<PosImportPreviewResult> {
    const root = this.apiRoot();
    if (!root) {
      throw new Error('posApiOrigin no configurado');
    }
    const segment = kind === 'products' ? 'products' : 'customers';
    return this.http.post<PosImportPreviewResult>(`${root}/import/${segment}/preview`, this.importForm(file, mapping));
  }

  importFromTemplate(
    kind: PosImportKind,
    file: File,
    mapping?: Record<string, string> | null,
  ): Observable<PosImportResult> {
    const root = this.apiRoot();
    if (!root) {
      throw new Error('posApiOrigin no configurado');
    }
    const segment = kind === 'products' ? 'products' : 'customers';
    return this.http.post<PosImportResult>(`${root}/import/${segment}`, this.importForm(file, mapping));
  }

  private importForm(file: File, mapping?: Record<string, string> | null): FormData {
    const form = new FormData();
    form.append('file', file);
    const clean = this.cleanMapping(mapping);
    if (clean) {
      form.append('mapping', new Blob([JSON.stringify(clean)], { type: 'application/json' }));
    }
    return form;
  }

  private cleanMapping(mapping?: Record<string, string> | null): Record<string, string> | null {
    if (!mapping) return null;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(mapping)) {
      if (v?.trim()) out[k] = v.trim();
    }
    return Object.keys(out).length ? out : null;
  }
}
