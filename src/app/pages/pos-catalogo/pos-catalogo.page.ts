import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';

@Component({
  selector: 'pos-catalogo-page',
  standalone: true,
  imports: [CommonModule],
  host: { class: 'pos-page-host' },
  template: `
    <div class="page">
      <header class="head">
        <h1>Catálogo</h1>
        <p>Búsqueda avanzada, variantes, stock y precios por lista — conectable al inventario de eFactura.</p>
      </header>
      <div class="grid">
        @for (i of [1, 2, 3, 4, 5, 6]; track i) {
          <div class="ph">
            <div class="ph__shine"></div>
            <span class="ph__label">Artículo {{ i }}</span>
          </div>
        }
      </div>
      <p class="foot">Vista previa visual · datos reales vendrán de la API de catálogo.</p>
    </div>
  `,
  styles: `
    .page {
      max-width: 960px;
      margin: 0 auto;
    }
    .head h1 {
      margin: 0 0 0.35rem;
      font-size: 1.25rem;
      font-weight: 700;
    }
    .head p {
      margin: 0 0 1.25rem;
      color: var(--pos-muted);
      font-size: 0.88rem;
      max-width: 40rem;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(8.5rem, 1fr));
      gap: 0.65rem;
    }
    .ph {
      position: relative;
      border-radius: var(--pos-radius-sm);
      border: 1px dashed var(--pos-border-strong);
      min-height: 7rem;
      overflow: hidden;
      background: var(--pos-surface);
    }
    .ph__shine {
      position: absolute;
      inset: 0;
      background: linear-gradient(
        110deg,
        transparent 40%,
        rgba(255, 255, 255, 0.04) 50%,
        transparent 60%
      );
      animation: shine 2.4s ease-in-out infinite;
    }
    @keyframes shine {
      0% {
        transform: translateX(-100%);
      }
      100% {
        transform: translateX(100%);
      }
    }
    .ph__label {
      position: absolute;
      bottom: 0.5rem;
      left: 0.55rem;
      font-size: 0.72rem;
      color: var(--pos-faint);
    }
    .foot {
      margin-top: 1.25rem;
      font-size: 0.78rem;
      color: var(--pos-faint);
    }
  `,
})
export class PosCatalogoPage {}
