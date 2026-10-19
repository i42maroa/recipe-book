import { Injectable, inject } from '@angular/core';
import { EMPTY, BehaviorSubject, Subject, catchError, combineLatest, exhaustMap, from, map, of, shareReplay, startWith, switchMap, tap } from 'rxjs';
import { RecipeCard } from '../models/recipe-card.model';
import { RecipeBatch, RecipeFilters, RecipeService } from './recipe.service';
import { NotificationService } from './notification.service';

export interface RecipeListPage {
  items: RecipeCard[];
  total: number;
  nextOffset: number;
  loading: boolean;
  error: boolean;
}

interface Snapshot {
  filters: RecipeFilters;
  revision: number;
  page: RecipeListPage;
}

/** Keep a single list in memory while navigating, independently of detail caches. */
@Injectable({ providedIn: 'root' })
export class RecipeListService {
  private readonly recipes = inject(RecipeService);
  private readonly notifications = inject(NotificationService);
  private readonly filtersSubject = new BehaviorSubject<RecipeFilters>({
    search: '', pending: 'all', sort: 'recent', mealType: '', difficulty: '',
  });
  private readonly requests = new Subject<void>();
  private snapshot: Snapshot | null = null;
  searchInput = '';
  filtersExpanded = false;
  scrollPosition: [number, number] = [0, 0];

  get filters(): RecipeFilters { return { ...this.filtersSubject.value }; }

  setFilters(filters: RecipeFilters): void {
    if (this.sameFilters(this.filtersSubject.value, filters)) return;
    this.scrollPosition = [0, 0];
    this.filtersSubject.next({ ...filters });
  }

  loadMore(): void { this.requests.next(); }

  readonly page$ = combineLatest([this.filtersSubject, this.recipes.changes$]).pipe(
    switchMap(([filters, revision]) => {
      const previous = this.snapshot && this.sameFilters(this.snapshot.filters, filters) ? this.snapshot : null;
      let state: RecipeListPage = previous ? { ...previous.page } : { items: [], total: 0, nextOffset: 0, error: false, loading: false };
      let reuse = !!previous && previous.revision === revision && !previous.page.error;
      let refresh = !reuse;
      // If an edit changes order/filter membership, refresh the entire visible window.
      const windowSize = Math.max(this.recipes.pageSize, state.nextOffset);
      return this.requests.pipe(
        startWith(undefined),
        exhaustMap(() => {
          if (reuse) { reuse = false; return of(state); }
          if (!refresh && state.nextOffset >= state.total) return EMPTY;
          const replacing = refresh;
          const request = replacing ? this.loadWindow(filters, windowSize) : this.recipes.getBatch(filters, state.nextOffset, 10);
          return from(request).pipe(
            map((result) => {
              const items = new Map((replacing ? [] : state.items).map((recipe) => [recipe.id, recipe]));
              for (const recipe of result.items) items.set(recipe.id, recipe);
              state = { items: [...items.values()], total: result.total, nextOffset: result.offset + result.items.length, loading: false, error: false };
              refresh = false;
              return state;
            }),
            catchError(() => {
              this.notifications.error('No se pudieron cargar las recetas. Vuelve a intentarlo.');
              state = { ...state, loading: false, error: true };
              return of(state);
            }),
            startWith({ ...state, loading: true, error: false }),
          );
        }),
        tap((page) => {
          if (!page.loading) this.snapshot = { filters: { ...filters }, revision, page };
        }),
      );
    }),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  private sameFilters(a: RecipeFilters, b: RecipeFilters): boolean {
    return a.search === b.search && a.pending === b.pending && a.sort === b.sort && a.mealType === b.mealType && a.difficulty === b.difficulty;
  }

  private async loadWindow(filters: RecipeFilters, target: number): Promise<RecipeBatch> {
    const items: RecipeCard[] = [];
    let total = target;
    // Small windows use one call; larger ones respect the API's response limits.
    do {
      const batch = await this.recipes.getBatch(filters, items.length, Math.min(100, target - items.length));
      total = batch.total;
      items.push(...batch.items);
      if (!batch.items.length) break;
    } while (items.length < target && items.length < total);
    return { items, total, offset: 0 };
  }
}
