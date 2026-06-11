import type { PosCustomerResponse } from '../../core/api/pos-backend.types';
import { CONSUMIDOR_FINAL_ID, CONSUMIDOR_FINAL_NAME } from './pos-customer-form.util';

export interface SaleCustomer {
  id?: string;
  name: string;
  doc: string;
  tipoIdentificacion: string;
  email?: string | null;
  priceListId?: string | null;
  priceListName?: string | null;
  isConsumidorFinal?: boolean;
}

export const SALE_CONSUMIDOR_FINAL: SaleCustomer = {
  name: CONSUMIDOR_FINAL_NAME,
  doc: CONSUMIDOR_FINAL_ID,
  tipoIdentificacion: '07',
  email: null,
  isConsumidorFinal: true,
};

export function customerResponseToSale(c: PosCustomerResponse): SaleCustomer {
  const displayName = c.nombreComercial?.trim() || c.razonSocial;
  return {
    id: c.id,
    name: displayName,
    doc: c.identificacion,
    tipoIdentificacion: c.tipoIdentificacion,
    email: c.email ?? null,
    priceListId: c.priceListId ?? null,
    priceListName: c.priceListName ?? null,
    isConsumidorFinal: c.tipoIdentificacion === '07' || c.identificacion === CONSUMIDOR_FINAL_ID,
  };
}

export function saleCustomerTipoLabel(tipo: string): string {
  switch (tipo) {
    case '04':
      return 'RUC';
    case '05':
      return 'Cédula';
    case '06':
      return 'Pasaporte';
    case '07':
      return 'Consumidor final';
    default:
      return tipo;
  }
}
