import { Injectable, signal } from '@angular/core';
import { Subject } from 'rxjs';

export type InventoryNavigationAction = { kind: 'places' };

/** Coordinates the contextual navbar with the mounted inventory page. */
@Injectable({ providedIn: 'root' })
export class InventoryNavigationService {
  readonly blocked = signal(true);
  private readonly actions = new Subject<InventoryNavigationAction>();
  readonly actions$ = this.actions.asObservable();

  request(action: InventoryNavigationAction): void {
    if (!this.blocked()) this.actions.next(action);
  }
}
