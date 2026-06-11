import type { PosCedulaConsultaResponse, PosRucConsultaResponse } from '../../core/api/pos-backend.types';
import { splitNombreCompletoEcuador, type PosCustomerFormState } from './pos-customer-form.util';

export function applyCedulaConsultaToForm(
  form: PosCustomerFormState,
  res: PosCedulaConsultaResponse,
): void {
  if (!res.encontrado || !res.nombres?.trim()) {
    return;
  }
  form.identificacion = res.identificacion;
  const { nombres, apellidos } = splitNombreCompletoEcuador(res.nombres);
  form.nombres = nombres;
  form.apellidos = apellidos;
  if (res.lugarNacimiento?.trim() && !form.direccion.trim()) {
    form.direccion = res.lugarNacimiento.trim();
  }
}

export function applyRucConsultaToForm(form: PosCustomerFormState, res: PosRucConsultaResponse): void {
  if (!res.encontrado) {
    return;
  }
  form.identificacion = res.numeroRuc;
  form.razonSocial = res.razonSocial?.trim() ?? '';
  if (res.nombreComercial?.trim()) {
    form.nombreComercial = res.nombreComercial.trim();
  } else if (!form.nombreComercial.trim() && form.razonSocial) {
    form.nombreComercial = form.razonSocial;
  }
}
