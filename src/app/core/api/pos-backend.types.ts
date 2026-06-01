export interface PosCajaSnapshotResponse {
  session: null | {
    id: string;
    status: string;
    openedAt: string;
    closedAt?: string | null;
    openingFloat: number;
    openedBy?: string | null;
    closedBy?: string | null;
  };
  resumen: {
    tickets: number;
    totalVentas: number;
    efectivoCobros: number;
    tarjetaCobros: number;
    transferCobros: number;
  };
}

export interface PosCajaAperturaRequest {
  openingFloat?: number | null;
}

export interface PosCajaCierreDenomination {
  denomination: number;
  quantity: number;
}

export interface PosCajaCierreRequest {
  countedCash: number;
  countedCard: number;
  countedTransfer: number;
  notes?: string | null;
  denominations: PosCajaCierreDenomination[];
}

export interface PosCajaHistoryItem {
  id: string;
  status: string;
  openedAt: string;
  closedAt?: string | null;
  openingFloat: number;
  totalVentas: number;
  efectivoCobros: number;
  tarjetaCobros: number;
  transferCobros: number;
  expectedCash?: number | null;
  countedCash?: number | null;
  countedCard?: number | null;
  countedTransfer?: number | null;
  cashDifference?: number | null;
  notes?: string | null;
  openedBy?: string | null;
  closedBy?: string | null;
  denominations?: PosCajaCierreDenomination[] | null;
}

export interface PosCajaHistorialResponse {
  items: PosCajaHistoryItem[];
}

export interface PosCheckoutResponse {
  saleId: string;
  paymentCollectionId?: string | null;
  comprobanteLocalId?: string | null;
  comprobanteTipo?: string | null;
  comprobanteEstado?: string | null;
  comprobanteSyncStatus?: string | null;
  invoiceStatus: string;
  comprobanteId?: string | null;
  estadoSri?: string | null;
  numeroComprobante?: string | null;
  claveAcceso?: string | null;
}

export interface PosCheckoutCliente {
  tipoIdentificacion: string;
  identificacion: string;
  razonSocial: string;
  email?: string | null;
}

export interface PosCheckoutLine {
  codigoPrincipal: string;
  codigoAuxiliar?: string | null;
  descripcion: string;
  cantidad: number;
  precioUnitario: number;
  descuento?: number | null;
  ivaPorcentaje?: number | null;
  ivaCodigoPorcentaje?: string | null;
}

export interface PosCheckoutPago {
  formaPago: string;
  total: number;
  recibido?: number | null;
  canal?: string | null;
  proveedor?: string | null;
  transaccionProveedorId?: string | null;
  codigoAutorizacion?: string | null;
  referencia?: string | null;
  plazo?: number | null;
  unidadTiempo?: string | null;
}

export interface PosPaymentCollectionLine {
  id?: string | null;
  formaPago?: string | null;
  total?: number | null;
  recibido?: number | null;
  vuelto?: number | null;
  canal?: string | null;
  proveedor?: string | null;
  transaccionProveedorId?: string | null;
  codigoAutorizacion?: string | null;
  referencia?: string | null;
  estado?: string | null;
}

export interface PosPaymentCollectionResponse {
  id: string;
  status?: string | null;
  estado?: string | null;
  total?: number | null;
  totalPagar?: number | null;
  totalPagado?: number | null;
  vuelto?: number | null;
  change?: number | null;
  lines?: PosPaymentCollectionLine[] | null;
  lineas?: PosPaymentCollectionLine[] | null;
}

export interface PosCheckoutRequestBody {
  puntoEmisionId: string;
  comprobanteTipo?: string | null;
  fechaEmision?: string | null;
  cliente: PosCheckoutCliente;
  items: PosCheckoutLine[];
  pagos?: PosCheckoutPago[] | null;
}

export interface PosOfflineComprobanteTotals {
  subtotalSinImpuestos: number;
  totalDescuento: number;
  totalImpuestos: number;
  importeTotal: number;
  currency?: string | null;
}

export interface PosOfflineComprobanteSyncRequest {
  offlineDeviceId: string;
  offlineSequence: string;
  offlineCreatedAt: string;
  tipo: 'FACTURA' | 'NOTA_VENTA' | 'TICKET';
  puntoEmisionId: string;
  fechaEmision: string;
  cliente: PosCheckoutCliente;
  items: PosCheckoutLine[];
  pagos: PosCheckoutPago[];
  totales: PosOfflineComprobanteTotals;
  sourcePayloadJson?: string | null;
}

export interface PosComprobanteResponse {
  id: string;
  saleId?: string | null;
  tipo: string;
  estado: string;
  syncStatus: string;
  puntoEmisionId?: string | null;
  fechaEmision: string;
  numeroLocal?: string | null;
  numeroExterno?: string | null;
  claveAcceso?: string | null;
  externalProvider?: string | null;
  externalId?: string | null;
  externalStatus?: string | null;
  subtotalSinImpuestos: number;
  totalDescuento: number;
  totalImpuestos: number;
  importeTotal: number;
  currency: string;
  offlineDeviceId?: string | null;
  offlineSequence?: string | null;
}

export interface PosOfflineSyncStatusResponse {
  items: Array<{
    id: string;
    offlineDeviceId: string;
    offlineSequence: string;
    offlineCreatedAt: string;
    syncStatus: string;
    syncError?: string | null;
    estado: string;
    tipo: string;
    fechaEmision: string;
    numeroLocal?: string | null;
    externalProvider?: string | null;
    externalStatus?: string | null;
  }>;
}

export interface PosPuntoEmisionOption {
  id: string;
  establecimientoCodigo: string;
  codigo: string;
  nombre: string;
}

export interface StripeTenantConfigResponse {
  enabled: boolean;
  publishableKey?: string | null;
  subscriptionPrices: Record<string, string>;
  successUrl?: string | null;
  cancelUrl?: string | null;
  automaticTaxEnabled: boolean;
  allowPromotionCodes: boolean;
  configured: boolean;
  secretConfigured: boolean;
}

export interface StripeTenantConfigRequest {
  enabled: boolean;
  secretKey?: string | null;
  publishableKey?: string | null;
  starterPriceId?: string | null;
  subscriptionPrices?: Record<string, string>;
  successUrl?: string | null;
  cancelUrl?: string | null;
  automaticTaxEnabled: boolean;
  allowPromotionCodes: boolean;
}

export interface StripeSubscriptionCheckoutRequest {
  planCode: string;
}

export interface StripeSubscriptionCheckoutResponse {
  sessionId: string;
  url: string;
}

export interface KushkiSubscriptionPlan {
  planCode: string;
  planName: string;
  periodicity: string;
  subtotalIva: number;
  subtotalIva0: number;
  ice: number;
  iva: number;
  currency: string;
}

export interface KushkiTenantConfigResponse {
  enabled: boolean;
  publicMerchantId?: string | null;
  baseUrl?: string | null;
  testEnvironment: boolean;
  subscriptionPlans: KushkiSubscriptionPlan[];
  configured: boolean;
  privateMerchantConfigured: boolean;
}

export interface KushkiTenantConfigRequest {
  enabled: boolean;
  publicMerchantId?: string | null;
  privateMerchantId?: string | null;
  baseUrl?: string | null;
  testEnvironment: boolean;
  subscriptionPlans: KushkiSubscriptionPlan[];
}

export interface KushkiSubscriptionContactDetails {
  documentType: string;
  documentNumber: string;
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
}

export interface KushkiSubscriptionCreateRequest {
  token: string;
  planCode: string;
  startDate: string;
  contactDetails: KushkiSubscriptionContactDetails;
  metadata: Record<string, string>;
}

export interface KushkiSubscriptionCreateResponse {
  subscriptionId?: string | null;
  status?: string | null;
  message?: string | null;
}

export interface PayPhoneTenantConfigResponse {
  enabled: boolean;
  tokenConfigured: boolean;
  storeId?: string | null;
  baseUrl?: string | null;
  currency?: string | null;
  timeZone?: string | null;
  responseUrl?: string | null;
  configured: boolean;
}

export interface PayPhoneTenantConfigRequest {
  enabled: boolean;
  token?: string | null;
  storeId?: string | null;
  baseUrl?: string | null;
  currency?: string | null;
  timeZone?: string | null;
  responseUrl?: string | null;
}

export interface PayPhoneSaleRequest {
  phoneNumber: string;
  countryCode: string;
  amount: number;
  amountWithoutTax: number;
  amountWithTax: number;
  tax: number;
  service: number;
  tip: number;
  reference: string;
  clientTransactionId?: string | null;
  clientUserId?: string | null;
  optionalParameter1?: string | null;
  optionalParameter2?: string | null;
  optionalParameter3?: string | null;
}

export interface PayPhoneSaleResponse {
  transactionId?: string | null;
  clientTransactionId?: string | null;
  status?: string | null;
  message?: string | null;
  paymentUrl?: string | null;
  [key: string]: unknown;
}

export interface PayPhoneSaleStatusResponse {
  transactionId?: string | null;
  clientTransactionId?: string | null;
  status?: string | null;
  message?: string | null;
  [key: string]: unknown;
}
