export const environment = {
  production: false,
  /** Fallback si /api/v1/pos/config aún no respondió. */
  authModeFallback: 'NATIVE' as 'NATIVE' | 'SUITE_SSO',
  /** Identity Gateway: emite y renueva tokens SSO compartidos por Suite/POS. */
  identityBaseUrl: 'http://localhost:8092',
  /** API POS (Spring pos-app). */
  posApiOrigin: 'http://localhost:8094',
  /** Suite Shell — login y SSO. */
  suiteShellOrigin: 'http://localhost:4300',
  /** eFactura (opcional): enlaces desde Conexiones / futuras integraciones. */
  efacturaUiOrigin: 'http://localhost:4200',
  /** Cartera (opcional). */
  carteraUiOrigin: 'http://localhost:4301',
};
