import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { PosLayoutPreferencesService } from './core/layout/pos-layout-preferences.service';

@Component({
  selector: 'pos-root',
  standalone: true,
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
export class AppComponent {
  /** Inicializa tema/densidad desde localStorage lo antes posible. */
  private readonly _layoutPrefs = inject(PosLayoutPreferencesService);
}
