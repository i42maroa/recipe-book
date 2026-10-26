import { Injectable, signal } from '@angular/core';
import { Subject } from 'rxjs';

export type FreezerNavigationAction = { kind: 'create' | 'rename' | 'remove' } | { kind: 'select'; id: string };

/** Coordinates the contextual navbar with the mounted inventory page. */
@Injectable({ providedIn: 'root' })
export class FreezerNavigationService {
  readonly blocked = signal(true);
  private readonly actions = new Subject<FreezerNavigationAction>();
  readonly actions$ = this.actions.asObservable();

  request(action: FreezerNavigationAction): void {
    if (!this.blocked()) this.actions.next(action);
  }
}
