import { CommonModule } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { environment } from '../../../environments/environment';
import { PosAuthService } from '../../core/auth/pos-auth.service';

@Component({
  selector: 'pos-auth-callback',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="pos-auth">
      <div class="pos-auth__card">
        @if (phase() === 'busy') {
          <p class="pos-auth__eyebrow">POS</p>
          <h1>Conectando…</h1>
          <p class="pos-auth__lead">Estableciendo su sesión de venta.</p>
          <span class="pos-auth__spinner" aria-hidden="true"></span>
        }
        @if (phase() === 'missing') {
          <p class="pos-auth__eyebrow">Sesión</p>
          <h1>Inicie desde Suite</h1>
          <p class="pos-auth__lead">
            Abra <strong>POS</strong> desde el inicio de Luxora Suite con su usuario, o use el entorno de desarrollo local.
          </p>
          <a class="pos-auth__cta" [href]="suiteLoginUrl">Ir a Luxora Suite</a>
        }
      </div>
    </div>
  `,
  styles: `
    .pos-auth {
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 2rem;
      background: var(--pos-bg-deep, #070b14);
    }

    .pos-auth__card {
      width: min(22rem, 100%);
      padding: 1.35rem 1.4rem 1.5rem;
      text-align: center;
      border: 1px solid color-mix(in srgb, var(--lux-indigo) 16%, var(--lux-app-border, #e2e8f0));
      border-radius: var(--lux-card-radius, 12px);
      background: var(--pos-surface, var(--lux-auth-pane-bg, #0b1324));
      box-shadow: var(--pos-panel-shadow, var(--lux-auth-card-shadow));
      color: var(--pos-text, #f1f5f9);
    }

    .pos-auth__eyebrow {
      margin: 0 0 0.35rem;
      font-size: 0.68rem;
      font-weight: 800;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--lux-primary);
    }

    .pos-auth h1 {
      margin: 0;
      font-size: 1.25rem;
      font-weight: 800;
      letter-spacing: -0.02em;
    }

    .pos-auth__lead {
      margin: 0.55rem 0 0;
      font-size: 0.86rem;
      line-height: 1.5;
      color: var(--lux-app-muted, #64748b);
    }

    .pos-auth__cta {
      display: inline-flex;
      margin-top: 1rem;
      min-height: 2.35rem;
      align-items: center;
      justify-content: center;
      padding: 0 1rem;
      border-radius: 0.65rem;
      font-size: 0.84rem;
      font-weight: 700;
      text-decoration: none;
      color: #fff;
      background: var(--lux-gradient-diagonal);
      box-shadow: 0 8px 20px -10px rgba(var(--lux-primary-rgb), 0.55);
    }

    .pos-auth__spinner {
      display: inline-block;
      width: 1.25rem;
      height: 1.25rem;
      margin-top: 1rem;
      border: 2px solid var(--lux-primary-soft);
      border-top-color: var(--lux-primary);
      border-radius: 999px;
      animation: pos-auth-spin 0.7s linear infinite;
    }

    @keyframes pos-auth-spin {
      to {
        transform: rotate(360deg);
      }
    }
  `,
})
export class AuthCallbackPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(PosAuthService);

  readonly suiteLoginUrl = `${environment.suiteShellOrigin.replace(/\/+$/, '')}/login`;
  readonly phase = signal<'busy' | 'missing'>('busy');

  ngOnInit(): void {
    const at = this.route.snapshot.queryParamMap.get('at');
    const rt = this.route.snapshot.queryParamMap.get('rt');
    if (at && rt) {
      this.auth.setSession(at, rt, {
        companyName: this.route.snapshot.queryParamMap.get('companyName') ?? '',
        cashierName: this.route.snapshot.queryParamMap.get('cashierName') ?? '',
        cashierEmail: this.route.snapshot.queryParamMap.get('cashierEmail') ?? '',
      });
      void this.router.navigateByUrl('/venta');
      return;
    }
    this.phase.set('missing');
  }
}
