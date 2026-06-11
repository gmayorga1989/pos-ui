import { Component, input } from '@angular/core';

export type PosPageIcon = 'maestros' | 'catalogo' | 'categorias' | 'clientes' | 'default';

@Component({
  selector: 'pos-page-layout',
  standalone: true,
  template: `
    <section class="pos-page-card">
      <header class="pos-page-header">
        <div class="pos-page-heading">
          <div class="pos-page-icon" aria-hidden="true">
            @switch (icon()) {
              @case ('catalogo') {
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <rect x="4" y="4" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.5" />
                  <rect x="14" y="4" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.5" />
                  <rect x="4" y="14" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.5" />
                  <rect x="14" y="14" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.5" />
                </svg>
              }
              @case ('categorias') {
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path d="M4 6h16M4 12h10M4 18h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                  <path d="M17 11v6M14 14h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                </svg>
              }
              @case ('clientes') {
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <circle cx="9" cy="8" r="3" stroke="currentColor" stroke-width="1.5" />
                  <path d="M3 19c0-3 2.5-5 6-5s6 2 6 5" stroke="currentColor" stroke-width="1.5" />
                  <circle cx="17" cy="9" r="2.5" stroke="currentColor" stroke-width="1.5" />
                  <path d="M14 19c.3-2 1.8-3.5 4-3.5" stroke="currentColor" stroke-width="1.5" />
                </svg>
              }
              @case ('maestros') {
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path d="M5 5.5H19M5 12H19M5 18.5H13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
                  <path d="M16.5 17.5H20M18.25 15.75V19.25" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
                </svg>
              }
              @default {
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path d="M4.5 10.5L12 4L19.5 10.5V19C19.5 19.55 19.05 20 18.5 20H5.5C4.95 20 4.5 19.55 4.5 19V10.5Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" />
                  <path d="M9 20V14.5H15V20" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" />
                </svg>
              }
            }
          </div>
          <div class="pos-page-title">
            @if (eyebrow()) {
              <span class="pos-page-eyebrow">{{ eyebrow() }}</span>
            }
            <h1>{{ title() }}</h1>
            @if (subtitle()) {
              <p>{{ subtitle() }}</p>
            }
          </div>
        </div>
        <div class="pos-page-actions pos-page-actions-toolbar">
          <ng-content select="[page-actions]" />
        </div>
      </header>
      <div class="pos-page-body">
        <ng-content />
      </div>
    </section>
  `,
})
export class PosPageLayoutComponent {
  readonly title = input.required<string>();
  readonly subtitle = input('');
  readonly eyebrow = input('Maestros');
  readonly icon = input<PosPageIcon>('maestros');
}
