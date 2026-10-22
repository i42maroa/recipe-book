import { RecipeListService } from '../../services/recipe-list.service';
import { RecipeFiltersComponent } from '../../components/shared/filters/recipe-filters/recipe-filters.component';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RecipeCard } from '../../models/recipe-card.model';
import { LoadingService } from '../../services/loading.service';
import { AuthService } from '../../services/auth.service';
﻿import { AsyncPipe, DOCUMENT, ViewportScroller } from '@angular/common';
import { Component, DestroyRef, inject, signal, viewChild } from '@angular/core';
import { FormBuilder } from '@angular/forms';
import { NavigationStart, Router, Scroll } from '@angular/router';
import { Subject, map, startWith, switchMap, tap } from 'rxjs';
import { RecipeCardComponent } from '../../components/recipe-card/recipe-card.component';
import { ButtonComponent } from '../../components/shared/button/button.component';
import { MealType, RecipeDifficulty } from '../../models/recipe.model';
import { RecipeService } from '../../services/recipe.service';
import { FormService } from '../../services/form.service';
import { IconComponent } from '../../components/shared/icon/icon.component';
import { controlValues, isCompleteSearch } from '../../utils/search.utils';
import { recipeFilterChanges } from '../../utils/recipe-filters.utils';
import { SkeletonComponent } from '../../components/shared/skeleton/skeleton.component';

@Component({
  selector: 'app-recipes-page',
  standalone: true,
  imports: [AsyncPipe, RecipeCardComponent, ButtonComponent, IconComponent, SkeletonComponent, RecipeFiltersComponent],
  templateUrl: './recipes-page.component.html',
  styleUrl: './recipes-page.component.css',
})
export class RecipesPageComponent {
  private readonly recipeService = inject(RecipeService);
  readonly list = inject(RecipeListService);
  private readonly viewport = inject(ViewportScroller);
  private readonly view = inject(DOCUMENT).defaultView;
  private readonly destroyRef = inject(DestroyRef);
  private navigationReady = false;
  private pageReady = false;
  private restored = false;
  private scrollFrame: number | null = null;
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  readonly auth = inject(AuthService);
  readonly forms = inject(FormService);
  readonly loading = inject(LoadingService);
  readonly statsError = signal(false);
  readonly pageSize = this.recipeService.pageSize;

  readonly search = this.fb.nonNullable.control(this.list.searchInput);
  readonly ingredientFilter = this.fb.nonNullable.control<string[]>(this.list.filters.ingredientIds ?? []);
  private readonly filterPanel = viewChild(RecipeFiltersComponent);
  get hasFilters(): boolean {
    const filters = this.list.filters;
    return !!(filters.search || filters.pending !== 'all' || filters.mealType || filters.difficulty || filters.ingredientIds?.length);
  }
  readonly statusFilter = this.fb.nonNullable.control(this.list.filters.pending);
  readonly sortFilter = this.fb.nonNullable.control(this.list.filters.sort);
  readonly mealTypeFilter = this.fb.nonNullable.control<MealType | ''>(this.list.filters.mealType);
  readonly difficultyFilter = this.fb.nonNullable.control<RecipeDifficulty | ''>(this.list.filters.difficulty);
  
  readonly recipeCount$ = this.recipeService.stats$.pipe(map((stats) => stats.total));
  readonly pendingCount$ = this.recipeService.stats$.pipe(map((stats) => stats.pending));
  private readonly filtersReset = new Subject<void>();
  private readonly filters$ = this.filtersReset.pipe(
    startWith(undefined),
    switchMap(() => recipeFilterChanges({
      search: this.search, sort: this.sortFilter, mealType: this.mealTypeFilter,
      difficulty: this.difficultyFilter, ingredientIds: this.ingredientFilter,
    }, {
      pending: controlValues(this.statusFilter),
      initialSearch: isCompleteSearch(this.search.value) ? this.search.value.trim() : this.list.filters.search,
      ignoreIncomplete: true,
    })),
  );
  readonly page$ = this.list.page$.pipe(tap((page) => {
    this.pageReady = !page.loading && (!page.error || page.items.length > 0);
    this.restoreScroll();
  }));

  constructor() {
    this.search.valueChanges.pipe(takeUntilDestroyed()).subscribe(value => { this.list.searchInput = value; });
    this.filters$.pipe(takeUntilDestroyed()).subscribe((filters) => this.list.setFilters(filters));
    this.router.events.pipe(takeUntilDestroyed()).subscribe((event) => {
      if (event instanceof NavigationStart) this.list.scrollPosition = this.viewport.getScrollPosition();
      if (event instanceof Scroll) { this.navigationReady = true; this.restoreScroll(); }
    });
    this.destroyRef.onDestroy(() => {
      if (this.scrollFrame !== null) this.view?.cancelAnimationFrame(this.scrollFrame);
    });
    this.retryStats();
  }

  private restoreScroll(): void {
    if (this.restored || this.scrollFrame !== null || !this.navigationReady || !this.pageReady) return;
    this.scrollFrame = this.view?.requestAnimationFrame(() => {
      this.scrollFrame = null;
      if (this.destroyRef.destroyed || !this.pageReady) return;
      this.viewport.scrollToPosition(this.list.scrollPosition);
      this.restored = true;
    }) ?? null;
  }

  retryStats(): void {
    this.statsError.set(false);
    void this.recipeService.loadStats().catch(() => this.statsError.set(true));
  }

  loadMore(): void {
    this.list.loadMore();
  }

  showPendingRecipes(): void {
    this.statusFilter.setValue('pending');
  }

  showAllRecipes(): void {
    this.search.setValue('', { emitEvent: false });
    this.list.searchInput = '';
    this.statusFilter.setValue('all', { emitEvent: false });
    this.mealTypeFilter.setValue('', { emitEvent: false });
    this.difficultyFilter.setValue('', { emitEvent: false });
    this.ingredientFilter.setValue([], { emitEvent: false });
    this.filterPanel()?.clearIngredientSearch();
    // Restart once to avoid intermediate requests and stale search debounces.
    this.filtersReset.next();
  }

  showRecipe(recipe: RecipeCard): void {
    void this.router.navigate(['/recipes', recipe.id]);
  }
}




