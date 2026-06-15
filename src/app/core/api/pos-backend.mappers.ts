import type {
  PosCajaCierreDenomination,
  PosCajaHistorialResponse,
  PosCajaHistoryItem,
  PosCajaSessionDto,
  PosPaymentCollectionLine,
  PosPaymentCollectionResponse,
} from './pos-backend.types';

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function str(value: unknown): string {
  return value == null ? '' : String(value);
}

/** Convierte SessionDto del backend en fila de historial para UI. */
export function mapCajaSessionToHistoryItem(session: PosCajaSessionDto): PosCajaHistoryItem {
  const openingFloat = num(session.openingFloat);
  const expectedCash = num(session.expectedCash);
  const expectedCard = num(session.expectedCard);
  const expectedTransfer = num(session.expectedTransfer);
  const expectedTotal = num(session.expectedTotal, expectedCash + expectedCard + expectedTransfer);
  const cashSales = Math.max(0, Math.round((expectedCash - openingFloat) * 100) / 100);
  const totalVentas = Math.max(0, Math.round((expectedTotal - openingFloat) * 100) / 100);

  const denominations: PosCajaCierreDenomination[] | null =
    session.denominations?.map((d) => ({
      denomination: num(d.denomination),
      quantity: num(d.quantity),
    })) ?? null;

  return {
    id: str(session.id),
    status: str(session.status),
    openedAt: str(session.openedAt),
    closedAt: session.closedAt ?? null,
    openingFloat,
    totalVentas,
    efectivoCobros: cashSales,
    tarjetaCobros: expectedCard,
    transferCobros: expectedTransfer,
    expectedCash,
    countedCash: session.countedCash == null ? null : num(session.countedCash),
    countedCard: session.countedCard == null ? null : num(session.countedCard),
    countedTransfer: session.countedTransfer == null ? null : num(session.countedTransfer),
    cashDifference: session.cashDifference == null ? null : num(session.cashDifference),
    notes: session.closeNotes ?? null,
    openedByUserId: session.openedByUserId ?? null,
    closedByUserId: session.closedByUserId ?? null,
    openedBy: session.openedByUserLabel?.trim() || null,
    closedBy: session.closedByUserLabel?.trim() || null,
    denominations,
  };
}

export function mapCajaHistorialResponse(
  response: PosCajaHistorialResponse | PosCajaHistoryItem[] | null | undefined,
): PosCajaHistoryItem[] {
  if (!response) {
    return [];
  }
  if (Array.isArray(response)) {
    return response;
  }
  const sessions = response.sessions ?? response.items ?? [];
  return sessions.map((s) =>
    'totalVentas' in s && typeof (s as PosCajaHistoryItem).totalVentas === 'number'
      ? (s as PosCajaHistoryItem)
      : mapCajaSessionToHistoryItem(s as PosCajaSessionDto),
  );
}

function mapPaymentCollectionLine(raw: Record<string, unknown>): PosPaymentCollectionLine {
  return {
    id: raw['id'] == null ? null : str(raw['id']),
    formaPago: (raw['formaPago'] as string | null) ?? null,
    total: raw['amount'] != null ? num(raw['amount']) : raw['total'] != null ? num(raw['total']) : null,
    recibido: raw['receivedAmount'] != null ? num(raw['receivedAmount']) : raw['recibido'] != null ? num(raw['recibido']) : null,
    vuelto: raw['changeAmount'] != null ? num(raw['changeAmount']) : raw['vuelto'] != null ? num(raw['vuelto']) : null,
    canal: (raw['channel'] as string | null) ?? (raw['canal'] as string | null) ?? null,
    proveedor: (raw['provider'] as string | null) ?? (raw['proveedor'] as string | null) ?? null,
    transaccionProveedorId:
      (raw['providerTransactionId'] as string | null) ?? (raw['transaccionProveedorId'] as string | null) ?? null,
    codigoAutorizacion:
      (raw['authorizationCode'] as string | null) ?? (raw['codigoAutorizacion'] as string | null) ?? null,
    referencia: (raw['reference'] as string | null) ?? (raw['referencia'] as string | null) ?? null,
    estado: (raw['status'] as string | null) ?? (raw['estado'] as string | null) ?? null,
  };
}

/** Normaliza la respuesta de cobro del backend a campos canónicos con alias legacy. */
export function normalizePaymentCollection(
  raw: PosPaymentCollectionResponse | null | undefined,
): PosPaymentCollectionResponse | null {
  if (!raw) {
    return null;
  }
  const amountDue = raw.amountDue ?? raw.totalPagar ?? raw.total ?? null;
  const amountPaid = raw.amountPaid ?? raw.totalPagado ?? null;
  const changeAmount = raw.changeAmount ?? raw.vuelto ?? raw.change ?? null;
  const linesRaw = raw.lines ?? raw.lineas ?? [];
  const lines = linesRaw.map((line) => mapPaymentCollectionLine(line as unknown as Record<string, unknown>));

  return {
    ...raw,
    status: raw.status ?? raw.estado ?? null,
    amountDue,
    amountPaid,
    changeAmount,
    totalPagar: amountDue,
    totalPagado: amountPaid,
    vuelto: changeAmount,
    lines,
    lineas: lines,
  };
}
