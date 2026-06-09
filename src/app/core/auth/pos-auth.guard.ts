import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { PosConfigService } from '../config/pos-config.service';
import { PosAuthService } from './pos-auth.service';

export const posAuthGuard: CanActivateFn = async () => {
  const auth = inject(PosAuthService);
  const router = inject(Router);
  const config = inject(PosConfigService);

  if (auth.isAuthenticated()) {
    return true;
  }

  try {
    await config.ensureLoaded();
  } catch {
    /* fallback a authModeFallback del environment */
  }

  if (config.isNativeAuth()) {
    return router.createUrlTree(['/login']);
  }
  return router.createUrlTree(['/auth/callback']);
};
