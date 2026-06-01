import { Routes } from '@angular/router';
import { posAuthGuard } from './core/auth/pos-auth.guard';

export const routes: Routes = [
  {
    path: 'auth/callback',
    loadComponent: () =>
      import('./pages/auth-callback/auth-callback.page').then((m) => m.AuthCallbackPage),
  },
  {
    path: '',
    loadComponent: () => import('./layout/pos-shell.component').then((m) => m.PosShellComponent),
    canActivate: [posAuthGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'venta' },
      {
        path: 'venta',
        loadComponent: () => import('./pages/pos-venta/pos-venta.page').then((m) => m.PosVentaPage),
      },
      {
        path: 'catalogo',
        loadComponent: () => import('./pages/pos-catalogo/pos-catalogo.page').then((m) => m.PosCatalogoPage),
      },
      {
        path: 'historial',
        loadComponent: () => import('./pages/pos-historial/pos-historial.page').then((m) => m.PosHistorialPage),
      },
      {
        path: 'sincronizacion',
        loadComponent: () =>
          import('./pages/pos-sincronizacion/pos-sincronizacion.page').then((m) => m.PosSincronizacionPage),
      },
      {
        path: 'conexiones',
        loadComponent: () =>
          import('./pages/pos-conexiones/pos-conexiones.page').then((m) => m.PosConexionesPage),
      },
      {
        path: 'ajustes',
        loadComponent: () => import('./pages/pos-ajustes/pos-ajustes.page').then((m) => m.PosAjustesPage),
      },
    ],
  },
  { path: 'dashboard', redirectTo: '/venta', pathMatch: 'full' },
  { path: '**', redirectTo: '/venta' },
];
