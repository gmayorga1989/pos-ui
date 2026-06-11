/**
 * Códigos de tarifa IVA según tabla del SRI (codigoPorcentaje en comprobantes electrónicos).
 * Referencia: ficha técnica comprobantes electrónicos Ecuador.
 */
export interface PosSriIvaOption {
  code: string;
  label: string;
  percent: number;
  description: string;
}

/** Tarifas vigentes más usadas en retail y servicios. */
export const POS_SRI_IVA_OPTIONS: PosSriIvaOption[] = [
  { code: '0', label: '0% — No objeto / exento', percent: 0, description: 'Tarifa 0% (código 0)' },
  { code: '4', label: '15% — Tarifa estándar', percent: 15, description: 'IVA 15% (código 4)' },
  { code: '5', label: '5% — Tarifa reducida', percent: 5, description: 'IVA 5% (código 5)' },
  { code: '6', label: '8% — Tarifa especial', percent: 8, description: 'IVA 8% (código 6)' },
  { code: '2', label: '12% — Histórico', percent: 12, description: 'IVA 12% (código 2, legado)' },
];

const BY_CODE = new Map(POS_SRI_IVA_OPTIONS.map((o) => [o.code, o]));

export function posSriIvaByCode(code: string | null | undefined): PosSriIvaOption | undefined {
  if (!code) {
    return undefined;
  }
  return BY_CODE.get(code.trim());
}

export function posSriIvaLabel(code: string, percent?: number | null): string {
  const opt = posSriIvaByCode(code);
  if (opt) {
    return opt.label;
  }
  const pct = percent ?? 0;
  return `${pct}% (cód. ${code})`;
}

export function posSriIvaPercentForCode(code: string): number {
  return posSriIvaByCode(code)?.percent ?? 15;
}

export const POS_SRI_IVA_DEFAULT_CODE = '4';
