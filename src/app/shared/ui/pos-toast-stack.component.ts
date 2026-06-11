import { Component, inject } from '@angular/core';
import { PosToastService, type PosToastVariant } from '../../core/ui/pos-toast.service';

const TOAST_LABELS: Record<PosToastVariant, string> = {
  success: 'Completado',
  error: 'Error',
  warning: 'Atención',
  info: 'Información',
  loading: 'En proceso',
};

@Component({
  selector: 'pos-toast-stack',
  standalone: true,
  template: `
    <div class="pos-toast-host" aria-live="polite" aria-relevant="additions">
      @for (item of toast.toasts(); track item.id) {
        <div
          class="pos-toast"
          [class.pos-toast--success]="item.variant === 'success'"
          [class.pos-toast--error]="item.variant === 'error'"
          [class.pos-toast--info]="item.variant === 'info'"
          [class.pos-toast--warning]="item.variant === 'warning'"
          [class.pos-toast--loading]="item.variant === 'loading'"
          role="status"
          [attr.aria-busy]="item.variant === 'loading' ? 'true' : null">
          <div class="pos-toast__accent" aria-hidden="true"></div>

          <div class="pos-toast__icon" aria-hidden="true">
            @if (item.variant === 'loading') {
              <span class="pos-toast__spinner"></span>
            } @else {
              <svg viewBox="0 0 24 24" focusable="false">
                <path [attr.d]="iconPath(item.variant)" fill="currentColor" />
              </svg>
            }
          </div>

          <div class="pos-toast__content">
            <span class="pos-toast__kicker">{{ etiqueta(item.variant) }}</span>
            <p class="pos-toast__message">{{ item.message }}</p>
          </div>

          <button
            type="button"
            class="pos-toast__dismiss"
            aria-label="Cerrar"
            (click)="cerrar($event, item.id)">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path
                d="M6.4 5.4a1 1 0 0 1 1.4 0L12 9.6l4.2-4.2a1 1 0 1 1 1.4 1.4L13.4 11l4.2 4.2a1 1 0 0 1-1.4 1.4L12 12.4l-4.2 4.2a1 1 0 0 1-1.4-1.4L10.6 11 6.4 6.8a1 1 0 0 1 0-1.4Z"
                fill="currentColor" />
            </svg>
          </button>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .pos-toast-host {
        position: fixed;
        z-index: 12000;
        top: 1.15rem;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        flex-direction: column;
        align-items: stretch;
        gap: 0.65rem;
        pointer-events: none;
        width: min(460px, calc(100vw - 2rem));
      }

      .pos-toast {
        pointer-events: auto;
        position: relative;
        display: grid;
        grid-template-columns: auto 1fr auto;
        align-items: start;
        gap: 0.75rem 0.85rem;
        padding: 0.95rem 0.85rem 0.95rem 0;
        border-radius: 14px;
        border: 1px solid var(--pos-toast-border, rgba(148, 163, 184, 0.35));
        background: var(--pos-toast-surface, rgba(15, 23, 42, 0.92));
        color: var(--pos-toast-text, #f1f5f9);
        backdrop-filter: blur(14px) saturate(1.25);
        -webkit-backdrop-filter: blur(14px) saturate(1.25);
        box-shadow:
          0 0 0 1px rgba(255, 255, 255, 0.06) inset,
          0 4px 6px rgba(0, 0, 0, 0.18),
          0 18px 40px rgba(0, 0, 0, 0.32);
        overflow: hidden;
        isolation: isolate;
        animation: pos-toast-enter 0.42s cubic-bezier(0.16, 1, 0.3, 1);
      }

      .pos-toast::after {
        content: '';
        position: absolute;
        inset: 0;
        border-radius: inherit;
        pointer-events: none;
        box-shadow: 0 0 0 1px var(--pos-toast-ring, rgba(99, 102, 241, 0.28));
        z-index: 1;
      }

      .pos-toast__accent {
        position: absolute;
        left: 0;
        top: 0;
        bottom: 0;
        width: 4px;
        border-radius: 14px 0 0 14px;
        background: var(--pos-toast-accent, var(--lux-indigo, #6366f1));
      }

      .pos-toast__icon {
        grid-column: 1;
        margin-left: 1rem;
        width: 2.25rem;
        height: 2.25rem;
        display: grid;
        place-items: center;
        border-radius: 10px;
        background: var(--pos-toast-icon-bg, rgba(99, 102, 241, 0.18));
        color: var(--pos-toast-icon-fg, #a5b4fc);
        flex-shrink: 0;
        z-index: 2;
      }

      .pos-toast__icon svg {
        width: 1.2rem;
        height: 1.2rem;
      }

      .pos-toast__spinner {
        width: 1.15rem;
        height: 1.15rem;
        border: 2px solid color-mix(in srgb, var(--pos-toast-icon-fg, #a5b4fc) 25%, transparent);
        border-top-color: var(--pos-toast-icon-fg, #a5b4fc);
        border-radius: 50%;
        animation: pos-toast-spin 0.75s linear infinite;
      }

      .pos-toast__content {
        grid-column: 2;
        min-width: 0;
        padding-top: 0.1rem;
        position: relative;
        z-index: 2;
      }

      .pos-toast__kicker {
        display: block;
        font-size: 0.68rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--pos-toast-kicker, #94a3b8);
        margin-bottom: 0.22rem;
      }

      .pos-toast__message {
        margin: 0;
        font-size: 0.9375rem;
        font-weight: 500;
        line-height: 1.45;
        color: var(--pos-toast-text, #f1f5f9);
        letter-spacing: -0.01em;
      }

      .pos-toast__dismiss {
        grid-column: 3;
        align-self: start;
        display: grid;
        place-items: center;
        width: 1.75rem;
        height: 1.75rem;
        margin-top: 0.05rem;
        margin-right: 0.15rem;
        padding: 0;
        border: none;
        border-radius: 8px;
        background: transparent;
        color: #64748b;
        cursor: pointer;
        transition:
          background-color 0.15s ease,
          color 0.15s ease;
        z-index: 2;
      }

      .pos-toast__dismiss:hover {
        background: rgba(255, 255, 255, 0.08);
        color: #cbd5e1;
      }

      .pos-toast__dismiss:focus-visible {
        outline: 2px solid var(--lux-indigo, #6366f1);
        outline-offset: 2px;
      }

      .pos-toast--success {
        --pos-toast-accent: #34d399;
        --pos-toast-surface: rgba(6, 44, 34, 0.94);
        --pos-toast-border: rgba(52, 211, 153, 0.35);
        --pos-toast-ring: rgba(52, 211, 153, 0.4);
        --pos-toast-icon-bg: rgba(16, 185, 129, 0.22);
        --pos-toast-icon-fg: #6ee7b7;
        --pos-toast-kicker: #6ee7b7;
        --pos-toast-text: #ecfdf5;
      }

      .pos-toast--error {
        --pos-toast-accent: #f87171;
        --pos-toast-surface: rgba(69, 10, 10, 0.94);
        --pos-toast-border: rgba(248, 113, 113, 0.35);
        --pos-toast-ring: rgba(248, 113, 113, 0.38);
        --pos-toast-icon-bg: rgba(239, 68, 68, 0.22);
        --pos-toast-icon-fg: #fca5a5;
        --pos-toast-kicker: #fca5a5;
        --pos-toast-text: #fef2f2;
      }

      .pos-toast--info {
        --pos-toast-accent: var(--lux-indigo, #6366f1);
        --pos-toast-surface: rgba(15, 23, 42, 0.94);
        --pos-toast-border: rgba(129, 140, 248, 0.35);
        --pos-toast-ring: rgba(99, 102, 241, 0.42);
        --pos-toast-icon-bg: rgba(99, 102, 241, 0.22);
        --pos-toast-icon-fg: #a5b4fc;
        --pos-toast-kicker: #a5b4fc;
        --pos-toast-text: #f1f5f9;
      }

      .pos-toast--warning {
        --pos-toast-accent: #fbbf24;
        --pos-toast-surface: rgba(69, 45, 6, 0.94);
        --pos-toast-border: rgba(251, 191, 36, 0.35);
        --pos-toast-ring: rgba(251, 191, 36, 0.38);
        --pos-toast-icon-bg: rgba(245, 158, 11, 0.22);
        --pos-toast-icon-fg: #fcd34d;
        --pos-toast-kicker: #fcd34d;
        --pos-toast-text: #fffbeb;
      }

      .pos-toast--loading {
        --pos-toast-accent: var(--lux-cyan, #00e5ff);
        --pos-toast-surface: rgba(12, 20, 38, 0.94);
        --pos-toast-border: rgba(0, 229, 255, 0.28);
        --pos-toast-ring: rgba(0, 229, 255, 0.35);
        --pos-toast-icon-bg: rgba(0, 229, 255, 0.12);
        --pos-toast-icon-fg: #67e8f9;
        --pos-toast-kicker: #67e8f9;
        --pos-toast-text: #f0f9ff;
      }

      .pos-toast--loading .pos-toast__message {
        font-weight: 600;
      }

      @keyframes pos-toast-enter {
        from {
          opacity: 0;
          transform: translateY(-18px) scale(0.95);
        }
        to {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }

      @keyframes pos-toast-spin {
        to {
          transform: rotate(360deg);
        }
      }

      @media (max-width: 575.98px) {
        .pos-toast-host {
          top: auto;
          bottom: 1rem;
          width: calc(100vw - 1.25rem);
        }
      }
    `,
  ],
})
export class PosToastStackComponent {
  readonly toast = inject(PosToastService);

  cerrar(event: MouseEvent, id: number): void {
    event.stopPropagation();
    this.toast.dismiss(id);
  }

  iconPath(variant: PosToastVariant): string {
    switch (variant) {
      case 'success':
        return 'M9.55 17.05 4.5 12l1.4-1.42 3.65 3.65 8.06-8.06L18.9 7.1 9.55 17.05Z';
      case 'error':
        return 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 14h-2v-2h2v2Zm0-8h-2v6h2V8Z';
      case 'warning':
        return 'M12 2 1.5 20h21L12 2Zm0 13.5a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2Zm0-7.2a1.1 1.1 0 0 1 1.1 1.1v3.6a1.1 1.1 0 1 1-2.2 0V9.4A1.1 1.1 0 0 1 12 8.3Z';
      default:
        return 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 14h-2v-5h2v5Zm0-8h-2V8h2v2Z';
    }
  }

  etiqueta(variant: PosToastVariant): string {
    return TOAST_LABELS[variant];
  }
}
