import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { PosAuthService } from './pos-auth.service';

export const posAuthGuard: CanActivateFn = () => {
  const auth = inject(PosAuthService);
  const router = inject(Router);
  return auth.isAuthenticated() ? true : router.createUrlTree(['/auth/callback']);
};
