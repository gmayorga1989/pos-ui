import { CommonModule } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { environment } from '../../../environments/environment';
import { PosAuthService } from '../../core/auth/pos-auth.service';
import { PosConfigService } from '../../core/config/pos-config.service';

interface LoginCompanyOption {
  companyId: string;
  companySlug: string;
  legalName: string;
  displayName: string | null;
}

@Component({
  selector: 'pos-login-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="pos-auth">
      <div class="pos-auth__card">
        <p class="pos-auth__eyebrow">POS Luxora</p>
        @if (phase() === 'credentials') {
          <h1>Iniciar sesión</h1>
          <p class="pos-auth__lead">Acceda con su usuario de empresa.</p>
          <label class="pos-auth__field">
            <span>Correo</span>
            <input type="email" [(ngModel)]="email" autocomplete="username" />
          </label>
          <label class="pos-auth__field">
            <span>Contraseña</span>
            <input type="password" [(ngModel)]="password" autocomplete="current-password" />
          </label>
          @if (error()) {
            <p class="pos-auth__err">{{ error() }}</p>
          }
          <button type="button" class="pos-auth__cta" [disabled]="busy()" (click)="submitChallenge()">
            Continuar
          </button>
          <button type="button" class="pos-auth__link" (click)="phase.set('register')">Crear empresa POS</button>
        }
        @if (phase() === 'register') {
          <h1>Nueva empresa</h1>
          <p class="pos-auth__lead">Registre su negocio para usar POS sin Suite.</p>
          <label class="pos-auth__field"><span>Identificador (slug)</span><input [(ngModel)]="regSlug" placeholder="mi-tienda" /></label>
          <label class="pos-auth__field"><span>Nombre legal</span><input [(ngModel)]="regLegalName" /></label>
          <label class="pos-auth__field"><span>Correo admin</span><input type="email" [(ngModel)]="regEmail" /></label>
          <label class="pos-auth__field"><span>Contraseña</span><input type="password" [(ngModel)]="regPassword" /></label>
          @if (error()) { <p class="pos-auth__err">{{ error() }}</p> }
          <button type="button" class="pos-auth__cta" [disabled]="busy()" (click)="submitRegister()">Crear cuenta</button>
          <button type="button" class="pos-auth__link" (click)="phase.set('credentials')">Ya tengo cuenta</button>
        }
        @if (phase() === 'company') {
          <h1>Elija empresa</h1>
          <p class="pos-auth__lead">Su usuario pertenece a varias empresas.</p>
          @for (c of companies(); track c.companyId) {
            <button type="button" class="pos-auth__company" [disabled]="busy()" (click)="complete(c)">
              <strong>{{ c.legalName }}</strong>
              <small>{{ c.companySlug }}</small>
            </button>
          }
        }
        @if (phase() === 'sso-hint') {
          <h1>Use Luxora Suite</h1>
          <p class="pos-auth__lead">Este entorno está configurado con inicio de sesión vía Suite.</p>
          <a class="pos-auth__cta" [href]="suiteLoginUrl">Ir a Suite</a>
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
      width: min(24rem, 100%);
      padding: 1.35rem 1.4rem 1.5rem;
      border: 1px solid var(--pos-border);
      border-radius: var(--pos-radius, 11px);
      background: var(--pos-surface, #0b1324);
      color: var(--pos-text, #f1f5f9);
    }
    .pos-auth__eyebrow {
      margin: 0 0 0.35rem;
      font-size: 0.68rem;
      font-weight: 800;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--lux-primary, #38bdf8);
    }
    .pos-auth h1 {
      margin: 0;
      font-size: 1.25rem;
      font-weight: 800;
    }
    .pos-auth__lead {
      margin: 0.55rem 0 1rem;
      font-size: 0.86rem;
      color: var(--pos-muted, #94a3b8);
    }
    .pos-auth__field {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      margin-bottom: 0.65rem;
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--pos-muted);
    }
    .pos-auth__field input {
      border-radius: 8px;
      border: 1px solid var(--pos-border-strong);
      background: var(--pos-bg);
      color: var(--pos-text);
      padding: 0.5rem 0.6rem;
      font-size: 0.88rem;
    }
    .pos-auth__cta,
    .pos-auth__company {
      display: flex;
      width: 100%;
      margin-top: 0.5rem;
      min-height: 2.35rem;
      align-items: center;
      justify-content: center;
      padding: 0.55rem 1rem;
      border-radius: 0.65rem;
      font-size: 0.84rem;
      font-weight: 700;
      text-decoration: none;
      color: #fff;
      background: var(--lux-gradient-diagonal, linear-gradient(135deg, #38bdf8, #6366f1));
      border: none;
      cursor: pointer;
    }
    .pos-auth__company {
      flex-direction: column;
      background: transparent;
      color: var(--pos-text);
      border: 1px solid var(--pos-border-strong);
    }
    .pos-auth__company small {
      color: var(--pos-muted);
      font-weight: 500;
    }
    .pos-auth__err {
      color: #f87171;
      font-size: 0.8rem;
      margin: 0.35rem 0;
    }
    .pos-auth__link {
      display: block;
      width: 100%;
      margin-top: 0.65rem;
      border: none;
      background: transparent;
      color: var(--pos-muted);
      font-size: 0.8rem;
      font-weight: 600;
      cursor: pointer;
      text-decoration: underline;
    }
  `,
})
export class PosLoginPage implements OnInit {
  private readonly auth = inject(PosAuthService);
  private readonly config = inject(PosConfigService);
  private readonly router = inject(Router);

  readonly suiteLoginUrl = `${environment.suiteShellOrigin.replace(/\/+$/, '')}/login`;
  readonly phase = signal<'credentials' | 'company' | 'sso-hint' | 'register'>('credentials');
  readonly companies = signal<LoginCompanyOption[]>([]);
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);

  email = '';
  password = '';
  regSlug = '';
  regLegalName = '';
  regEmail = '';
  regPassword = '';
  private challengeToken = '';

  async ngOnInit(): Promise<void> {
    if (this.auth.isAuthenticated()) {
      await this.router.navigateByUrl('/venta');
      return;
    }
    await this.config.ensureLoaded();
    if (!this.config.isNativeAuth()) {
      this.phase.set('sso-hint');
    }
  }

  submitRegister(): void {
    this.error.set(null);
    this.busy.set(true);
    const base = this.auth.identityBaseUrl.replace(/\/+$/, '');
    fetch(`${base}/api/v1/public/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companySlug: this.regSlug.trim(),
        legalName: this.regLegalName.trim(),
        email: this.regEmail.trim(),
        password: this.regPassword,
        displayName: this.regLegalName.trim(),
      }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || 'No se pudo registrar la empresa');
        }
        return res.json() as Promise<{ accessToken: string; refreshToken: string; companySlug: string }>;
      })
      .then((tokens) => {
        this.auth.setSession(tokens.accessToken, tokens.refreshToken, {
          companyName: this.regLegalName.trim(),
          cashierName: this.regLegalName.trim(),
          cashierEmail: this.regEmail.trim(),
        });
        void this.router.navigateByUrl('/venta');
      })
      .catch((err: Error) => this.error.set(err.message ?? 'Error de registro'))
      .finally(() => this.busy.set(false));
  }

  submitChallenge(): void {
    this.error.set(null);
    this.busy.set(true);
    const base = this.auth.identityBaseUrl.replace(/\/+$/, '');
    fetch(`${base}/api/v1/auth/login/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: this.email.trim(), password: this.password }),
    })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(res.status === 401 ? 'Credenciales incorrectas' : 'No se pudo iniciar sesión');
        }
        return res.json() as Promise<{ challengeToken: string; companies: LoginCompanyOption[] }>;
      })
      .then((data) => {
        this.challengeToken = data.challengeToken;
        const list = data.companies ?? [];
        if (list.length === 1) {
          this.complete(list[0]!);
          return;
        }
        this.companies.set(list);
        this.phase.set('company');
      })
      .catch((err: Error) => this.error.set(err.message ?? 'Error de autenticación'))
      .finally(() => this.busy.set(false));
  }

  complete(company: LoginCompanyOption): void {
    this.error.set(null);
    this.busy.set(true);
    const base = this.auth.identityBaseUrl.replace(/\/+$/, '');
    fetch(`${base}/api/v1/auth/login/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challengeToken: this.challengeToken, companySlug: company.companySlug }),
    })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error('No se pudo completar el inicio de sesión');
        }
        return res.json() as Promise<{
          accessToken: string;
          refreshToken: string;
        }>;
      })
      .then((tokens) => {
        this.auth.setSession(tokens.accessToken, tokens.refreshToken, {
          companyName: company.legalName,
          cashierName: company.displayName ?? '',
          cashierEmail: this.email.trim(),
        });
        void this.router.navigateByUrl('/venta');
      })
      .catch((err: Error) => this.error.set(err.message ?? 'Error de autenticación'))
      .finally(() => this.busy.set(false));
  }
}
