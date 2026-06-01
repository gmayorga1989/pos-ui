import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, of, switchMap, throwError } from 'rxjs';
import { PosAuthService } from './pos-auth.service';

const withBearer = (req: HttpRequest<unknown>, token: string): HttpRequest<unknown> =>
  req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });

export const posAuthInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(PosAuthService);
  const t = auth.accessToken();

  if (req.url.includes('/api/v1/auth/refresh')) {
    return next(req);
  }

  if (!t) {
    return next(req);
  }

  const request$ =
    auth.shouldRefreshSoon(t) && auth.refreshToken()
      ? auth.refreshSession().pipe(
          catchError(() => of(t)),
          switchMap((fresh) => next(withBearer(req, fresh))),
        )
      : next(withBearer(req, t));

  return request$.pipe(
    catchError((err: unknown) => {
      if (err instanceof HttpErrorResponse && err.status === 401 && auth.refreshToken()) {
        return auth.refreshSession().pipe(switchMap((fresh) => next(withBearer(req, fresh))));
      }
      return throwError(() => err);
    }),
  );
};
