import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'pos-conexiones-page',
  standalone: true,
  imports: [CommonModule],
  host: { class: 'pos-page-host' },
  template: `
    <div class="page">
      <header class="head">
        <h1>Conexiones del ecosistema</h1>
        <p>
          El POS puede operar solo con <strong>pos-app</strong> o enlazarse a otras apps del Suite. Aquí define
          dónde viven los servicios (URLs de entorno).
        </p>
      </header>
      <div class="cards">
        <article class="card">
          <div class="card__icon card__icon--pos">POS</div>
          <h2>API POS</h2>
          <p class="url">{{ posApi }}</p>
          <p class="desc">Catálogo local, tickets y caja. Autenticación con el mismo JWT de Identity.</p>
          <span class="pill pill--on">Activo (dev)</span>
        </article>
        <article class="card">
          <div class="card__icon card__icon--ef">eF</div>
          <h2>eFactura</h2>
          <p class="url">{{ efactura }}</p>
          <p class="desc">Facturación electrónica, productos maestros y emisión de comprobantes.</p>
          @if (has(efactura)) {
            <a class="btn pos-focus-ring" [href]="efactura" target="_blank" rel="noopener noreferrer">Abrir UI</a>
          } @else {
            <span class="pill pill--off">Sin URL en entorno</span>
          }
        </article>
        <article class="card">
          <div class="card__icon card__icon--car">C</div>
          <h2>Cartera</h2>
          <p class="url">{{ cartera }}</p>
          <p class="desc">Cuentas por cobrar y cobros vinculados a clientes y documentos.</p>
          @if (has(cartera)) {
            <a class="btn pos-focus-ring" [href]="cartera" target="_blank" rel="noopener noreferrer">Abrir UI</a>
          } @else {
            <span class="pill pill--off">Sin URL en entorno</span>
          }
        </article>
        <article class="card">
          <div class="card__icon card__icon--suite">S</div>
          <h2>Suite Shell</h2>
          <p class="url">{{ suite }}</p>
          <p class="desc">Hub central, SSO y retorno seguro con handoff / bridge.</p>
          @if (has(suite)) {
            <a class="btn pos-focus-ring" [href]="suiteHome" target="_blank" rel="noopener noreferrer">Ir al hub</a>
          } @else {
            <span class="pill pill--off">Sin URL en entorno</span>
          }
        </article>
      </div>
    </div>
  `,
  styles: `
    .page {
      max-width: 980px;
      margin: 0 auto;
    }
    .head h1 {
      margin: 0 0 0.35rem;
      font-size: 1.25rem;
      font-weight: 700;
    }
    .head p {
      margin: 0 0 1.35rem;
      color: var(--pos-muted);
      font-size: 0.88rem;
      max-width: 46rem;
      line-height: 1.5;
    }
    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
      gap: 1rem;
    }
    .card {
      border-radius: var(--pos-radius);
      border: 1px solid var(--pos-border);
      background: var(--pos-surface);
      padding: 1rem 1.05rem 1.1rem;
      box-shadow: var(--pos-shadow-soft);
      display: flex;
      flex-direction: column;
      gap: 0.45rem;
    }
    .card h2 {
      margin: 0;
      font-size: 1rem;
      font-weight: 700;
    }
    .card__icon {
      width: 2.5rem;
      height: 2.5rem;
      border-radius: var(--pos-radius-sm);
      display: grid;
      place-items: center;
      font-size: 0.72rem;
      font-weight: 800;
      letter-spacing: 0.04em;
      margin-bottom: 0.25rem;
    }
    .card__icon--pos {
      background: var(--pos-accent-muted);
      color: var(--pos-accent-hover);
      border: 1px solid rgba(45, 212, 191, 0.3);
    }
    .card__icon--ef {
      background: rgba(99, 102, 241, 0.18);
      color: #a5b4fc;
      border: 1px solid rgba(129, 140, 248, 0.35);
    }
    .card__icon--car {
      background: rgba(56, 189, 248, 0.14);
      color: #7dd3fc;
      border: 1px solid rgba(56, 189, 248, 0.3);
    }
    .card__icon--suite {
      background: rgba(248, 250, 252, 0.08);
      color: var(--pos-text);
      border: 1px solid var(--pos-border-strong);
    }
    .url {
      margin: 0;
      font-family: var(--pos-mono);
      font-size: 0.68rem;
      color: var(--pos-faint);
      word-break: break-all;
    }
    .desc {
      margin: 0;
      flex: 1;
      font-size: 0.78rem;
      color: var(--pos-muted);
      line-height: 1.45;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-top: 0.35rem;
      padding: 0.45rem 0.85rem;
      border-radius: var(--pos-radius-sm);
      border: 1px solid rgba(45, 212, 191, 0.45);
      background: var(--pos-accent-muted);
      color: var(--pos-accent-hover);
      font-size: 0.78rem;
      font-weight: 700;
      text-decoration: none;
      transition: background var(--pos-transition);
    }
    .btn:hover {
      background: rgba(45, 212, 191, 0.22);
    }
    .pill {
      margin-top: 0.35rem;
      display: inline-block;
      font-size: 0.68rem;
      font-weight: 700;
      padding: 0.25rem 0.55rem;
      border-radius: 999px;
      width: fit-content;
    }
    .pill--on {
      border: 1px solid rgba(52, 211, 153, 0.35);
      color: var(--pos-status-ok);
    }
    .pill--off {
      border: 1px solid var(--pos-border);
      color: var(--pos-faint);
    }
  `,
})
export class PosConexionesPage {
  readonly posApi = environment.posApiOrigin || '(no configurado)';
  readonly efactura = environment.efacturaUiOrigin || '';
  readonly cartera = environment.carteraUiOrigin || '';
  readonly suite = environment.suiteShellOrigin || '';

  readonly suiteHome = `${(environment.suiteShellOrigin || '').replace(/\/+$/, '')}/home`;

  has(s: string): boolean {
    return !!(s && s.trim());
  }
}
