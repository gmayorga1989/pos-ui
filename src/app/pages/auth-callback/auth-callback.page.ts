import { Component, inject, OnInit, signal } from '@angular/core';

import { ActivatedRoute, Router } from '@angular/router';

import { PosAuthService } from '../../core/auth/pos-auth.service';

import { PosSsoHandoffService } from '../../core/auth/pos-sso-handoff.service';

import { PosConfigService } from '../../core/config/pos-config.service';

import { PosSsoBridgeComponent } from '../../shared/pos-sso-bridge.component';



const HANDOFF_MIN_MS = 750;



@Component({

  selector: 'pos-auth-callback',

  standalone: true,

  imports: [PosSsoBridgeComponent],

  template: `

    @if (!handoff.active()) {

      <pos-sso-bridge [message]="message()" [error]="error()" />

    }

  `,

})

export class AuthCallbackPage implements OnInit {

  private readonly route = inject(ActivatedRoute);

  private readonly router = inject(Router);

  private readonly auth = inject(PosAuthService);

  private readonly config = inject(PosConfigService);

  readonly handoff = inject(PosSsoHandoffService);



  readonly message = signal('Estableciendo sesión segura…');

  readonly error = signal('');



  constructor() {

    this.handoff.begin();

  }



  async ngOnInit(): Promise<void> {

    const at = this.route.snapshot.queryParamMap.get('at')?.trim();

    const rt = this.route.snapshot.queryParamMap.get('rt')?.trim();



    if (at && rt) {

      if (globalThis.history?.replaceState) {

        globalThis.history.replaceState(null, '', '/auth/callback');

      }



      this.message.set('Preparando terminal de venta…');

      this.auth.setSession(at, rt, {

        companyName: this.route.snapshot.queryParamMap.get('companyName') ?? '',

        cashierName: this.route.snapshot.queryParamMap.get('cashierName') ?? '',

        cashierEmail: this.route.snapshot.queryParamMap.get('cashierEmail') ?? '',

      });



      const minDelay = new Promise<void>((resolve) => setTimeout(resolve, HANDOFF_MIN_MS));

      const configReady = this.config.ensureLoaded().catch(() => undefined);



      await Promise.all([minDelay, configReady]);



      this.message.set('Abriendo punto de venta…');

      await this.router.navigateByUrl('/venta', { replaceUrl: true });

      return;

    }



    try {

      await this.config.ensureLoaded();

      if (this.config.isNativeAuth()) {

        this.handoff.complete();

        await this.router.navigateByUrl('/login', { replaceUrl: true });

        return;

      }

    } catch {

      /* mantener hint SSO */

    }



    this.handoff.complete();

    this.error.set('Abra POS desde el inicio de Luxora Suite con su usuario, o use el entorno local.');

  }

}


