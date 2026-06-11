import { Routes } from '@angular/router';
import { posAuthGuard } from './core/auth/pos-auth.guard';
import { AuthCallbackPage } from './pages/auth-callback/auth-callback.page';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./pages/pos-login/pos-login.page').then((m) => m.PosLoginPage),
  },
  {
    path: 'auth/callback',
    component: AuthCallbackPage,
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
        path: 'categorias',
        loadComponent: () => import('./pages/pos-categorias/pos-categorias.page').then((m) => m.PosCategoriasPage),
      },
      {
        path: 'clientes',
        loadComponent: () => import('./pages/pos-clientes/pos-clientes.page').then((m) => m.PosClientesPage),
      },
      {
        path: 'migracion',
        loadComponent: () => import('./pages/pos-migracion/pos-migracion.page').then((m) => m.PosMigracionPage),
      },
      {
        path: 'reportes',
        loadComponent: () => import('./pages/pos-reportes/pos-reportes.page').then((m) => m.PosReportesPage),
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
