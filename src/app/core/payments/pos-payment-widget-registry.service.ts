import { Injectable, inject } from '@angular/core';
import { KushkiPaymentWidget } from './kushki-payment.widget';
import { PayPhonePaymentWidget } from './payphone-payment.widget';
import { StripePaymentWidget } from './stripe-payment.widget';
import type { ManualPaymentWidget } from './pos-payment-widget.types';
import type { PosPaymentMethodCode, PosPaymentMethodOption, PosPaymentWidget } from './pos-payment-widget.types';

const BASE_PAYMENT_METHODS: PosPaymentMethodOption[] = [
  { code: 'cash', label: 'Efectivo', icon: '$', formaPago: '01', canal: 'CASH', proveedor: null },
  { code: 'card', label: 'Tarjeta', icon: '#', formaPago: '19', canal: 'CARD', proveedor: null },
  { code: 'transfer', label: 'Transfer.', icon: '>', formaPago: '20', canal: 'TRANSFER', proveedor: null },
  { code: 'other', label: 'Otro', icon: '+', formaPago: '20', canal: 'OTHER', proveedor: null },
];

@Injectable({ providedIn: 'root' })
export class PosPaymentWidgetRegistryService {
  private readonly payphone = inject(PayPhonePaymentWidget);
  private readonly stripe = inject(StripePaymentWidget);
  private readonly kushki = inject(KushkiPaymentWidget);

  readonly widgets: PosPaymentWidget[] = [this.payphone, this.stripe, this.kushki];

  allPaymentMethods(): PosPaymentMethodOption[] {
    return [...BASE_PAYMENT_METHODS, ...this.widgets.map((widget) => widget.methodOption)];
  }

  availablePaymentMethods(): PosPaymentMethodOption[] {
    return this.allPaymentMethods().filter((method) => this.isMethodVisible(method.code));
  }

  widgetFor(code: PosPaymentMethodCode): PosPaymentWidget | null {
    return this.widgets.find((widget) => widget.code === code) ?? null;
  }

  manualWidgetFor(code: PosPaymentMethodCode): ManualPaymentWidget | null {
    const widget = this.widgetFor(code);
    return widget && this.isManualWidget(widget) ? widget : null;
  }

  isExternalMethod(code: PosPaymentMethodCode): boolean {
    return code === 'stripe' || code === 'kushki' || code === 'payphone';
  }

  hasWidget(code: PosPaymentMethodCode): boolean {
    return this.widgetFor(code) != null;
  }

  loadAllAvailability(): void {
    for (const widget of this.widgets) {
      widget.loadAvailability();
    }
  }

  private isMethodVisible(code: PosPaymentMethodCode): boolean {
    const widget = this.widgetFor(code);
    if (widget) {
      return widget.isAvailable();
    }
    return true;
  }

  private isManualWidget(widget: PosPaymentWidget): widget is ManualPaymentWidget {
    return typeof (widget as ManualPaymentWidget).initiateManualCollection === 'function';
  }
}
