import { Injectable, signal } from '@angular/core';
import { Subject } from 'rxjs';

/** Only the mounted, loaded recipe detail can receive navbar rating actions. */
@Injectable({ providedIn: 'root' })
export class RecipeDetailActionsService {
  readonly recipeId = signal<string | null>(null);
  readonly busy = signal(false);
  private readonly ratings = new Subject<string>();
  readonly ratings$ = this.ratings.asObservable();

  requestRating(id: string): void {
    if (this.recipeId() === id && !this.busy()) this.ratings.next(id);
  }
}
