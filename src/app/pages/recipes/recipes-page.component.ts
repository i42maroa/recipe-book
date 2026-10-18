import { AuthService } from '../../services/auth.service';
﻿import { AsyncPipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { EMPTY, Subject, catchError, combineLatest, debounceTime, distinctUntilChanged, exhaustMap, from, map, of, shareReplay, startWith, switchMap } from 'rxjs';
import { RecipeCardComponent } from '../../components/recipe-card/recipe-card.component';
import { ButtonComponent } from '../../components/shared/button/button.component';
import { SelectFilterComponent } from '../../components/shared/filters/select-filter/select-filter.component';
import { SearchFilterComponent } from '../../components/shared/filters/search-filter/search-filter.component';
import { NotificationService } from '../../services/notification.service';
import { MealType, Recipe, RecipeDifficulty } from '../../models/recipe.model';
import { IngredientService } from '../../services/ingredient.service';
import { RecipeService } from '../../services/recipe.service';
import { FormService } from '../../services/form.service';
import { SelectFilterOption } from '../../components/shared/filters/select-filter-options';
import { IconComponent } from '../../components/shared/icon/icon.component';
import { searchTerms } from '../../utils/search.utils';

@Component({
  selector: 'app-recipes-page',
  standalone: true,
  imports: [AsyncPipe, ReactiveFormsModule, RecipeCardComponent, ButtonComponent, SelectFilterComponent, SearchFilterComponent, IconComponent],
  templateUrl: './recipes-page.component.html',
  styleUrl: './recipes-page.component.css',
})
export class RecipesPageComponent {
  private readonly recipeService = inject(RecipeService);
  private readonly ingredientService = inject(IngredientService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  readonly auth = inject(AuthService);
  readonly forms = inject(FormService);
  filtersExpanded = false;
  private readonly notifications = inject(NotificationService);
  private readonly loadRequests = new Subject<void>();
  readonly pageSize = this.recipeService.pageSize;

  readonly search = this.fb.nonNullable.control('');
  readonly pendingFilter = this.fb.nonNullable.control('all');
  readonly sortFilter = this.fb.nonNullable.control('recent');
  readonly mealTypeFilter = this.fb.nonNullable.control<MealType | ''>('');
  readonly difficultyFilter = this.fb.nonNullable.control<RecipeDifficulty | ''>('');
  
  readonly mealTypes: MealType[] = ['Desayuno', 'Entrante', 'Plato', 'Postre'];
  readonly difficulties: RecipeDifficulty[] = ['Fácil', 'Media', 'Difícil'];
  readonly statusOptions: SelectFilterOption[] = [
    { value: 'all', label: 'Todas' }, { value: 'pending', label: 'Por probar' }, { value: 'done', label: 'Ya preparadas' },
  ];
  readonly sortOptions: SelectFilterOption[] = [
    { value: 'recent', label: 'Más recientes' }, { value: 'name', label: 'Nombre A–Z' },
    { value: 'rating', label: 'Mejor puntuación' }, { value: 'time', label: 'Menor tiempo' },
  ];
  readonly mealTypeOptions: SelectFilterOption[] = [
    { value: '', label: 'Todos los tipos' }, ...this.mealTypes.map((type) => ({ value: type, label: type })),
  ];
  readonly difficultyOptions: SelectFilterOption[] = [
    { value: '', label: 'Todas' }, ...this.difficulties.map((difficulty) => ({ value: difficulty, label: difficulty })),
  ];
  readonly recipeCount$ = this.recipeService.stats$.pipe(map((stats) => stats.total));
  readonly pendingCount$ = this.recipeService.stats$.pipe(map((stats) => stats.pending));
  private readonly filters$ = combineLatest([
    this.ingredientService.ingredients$,
    this.search.valueChanges.pipe(debounceTime(300), searchTerms(), startWith('')),
    this.pendingFilter.valueChanges.pipe(startWith('all')),
    this.sortFilter.valueChanges.pipe(startWith('recent')),
    this.mealTypeFilter.valueChanges.pipe(startWith('' as const)),
    this.difficultyFilter.valueChanges.pipe(startWith('' as const)),
  ]).pipe(
    map(([ingredients, search, pending, sort, mealType, difficulty]) => ({
      search: search.trim(), pending, sort, mealType, difficulty,
      matchingIngredientIds: search.trim()
        ? ingredients.filter((item) => item.name.toLowerCase().includes(search.toLowerCase().trim())).map((item) => item.id)
        : [],
    })),
    distinctUntilChanged((previous, current) => JSON.stringify(previous) === JSON.stringify(current)),
  );
  readonly page$ = combineLatest([this.filters$, this.recipeService.changes$]).pipe(
    // Changing filters or saving/deleting starts a fresh list of twenty recipes.
    switchMap(([filters]) => {
      let state = { items: [] as Recipe[], total: 0, nextOffset: 0, error: false };
      return this.loadRequests.pipe(
        startWith(undefined),
        // Ignore repeat clicks until the current batch finishes.
        exhaustMap(() => {
          if (state.nextOffset > 0 && state.nextOffset >= state.total) return EMPTY;
          return from(this.recipeService.getBatch(filters, state.nextOffset, state.nextOffset === 0 ? this.pageSize : 10)).pipe(
          map((result) => {
            const items = new Map(state.items.map((recipe) => [recipe.id, recipe]));
            for (const recipe of result.items) items.set(recipe.id, recipe);
            state = {
              items: [...items.values()],
              total: result.total,
              nextOffset: result.offset + result.items.length,
              error: false,
            };
            return state;
          }),
          catchError((error: unknown) => {
            console.error('Error al cargar recetas:', error);
            this.notifications.error('No se pudieron cargar las recetas. Vuelve a intentarlo.');
            // Keep previously loaded recipes and the offset so retry loads the same batch.
            state = { ...state, error: true };
            return of(state);
          }),
          );
        }),
      );
    }),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  loadMore(): void {
    this.loadRequests.next();
  }

  showPendingRecipes(): void {
    this.pendingFilter.setValue('pending');
  }

  showRecipe(recipe: Recipe): void {
    void this.router.navigate(['/recipes', recipe.id]);
  }
}




