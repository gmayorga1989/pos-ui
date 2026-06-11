import { Injectable, signal } from '@angular/core';

export type PosToastVariant = 'success' | 'error' | 'info' | 'warning' | 'loading';

export interface PosToast {
  id: number;
  message: string;
  variant: PosToastVariant;
}

@Injectable({ providedIn: 'root' })
export class PosToastService {
  private seq = 0;
  private readonly items = signal<PosToast[]>([]);

  readonly toasts = this.items.asReadonly();

  show(message: string, variant: PosToastVariant = 'info', durationMs = 5200): number {
    const text = message.trim();
    if (!text) {
      return 0;
    }
    const id = ++this.seq;
    this.items.update((list) => [...list, { id, message: text, variant }]);
    if (durationMs > 0) {
      setTimeout(() => this.dismiss(id), durationMs);
    }
    return id;
  }

  dismiss(id: number): void {
    this.items.update((list) => list.filter((t) => t.id !== id));
  }

  success(message: string, durationMs?: number): number {
    return this.show(message, 'success', durationMs);
  }

  error(message: string, durationMs?: number): number {
    return this.show(message, 'error', durationMs);
  }

  info(message: string, durationMs?: number): number {
    return this.show(message, 'info', durationMs);
  }

  warning(message: string, durationMs?: number): number {
    return this.show(message, 'warning', durationMs);
  }

  loading(message: string): number {
    return this.show(message, 'loading', 0);
  }
}
