import { RecipeListService } from '../../services/recipe-list.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RecipeCard } from '../../models/recipe-card.model';
import { LoadingService } from '../../services/loading.service';
import { AuthService } from '../../services/auth.service';
﻿import { AsyncPipe, DOCUMENT, ViewportScroller } from '@angular/common';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { NavigationStart, Router, Scroll } from '@angular/router';
import { combineLatest, debounceTime, distinctUntilChanged, map, startWith, tap } from 'rxjs';
import { RecipeCardComponent } from '../../components/recipe-card/recipe-card.component';
import { ButtonComponent } from '../../components/shared/button/button.component';
import { SelectFilterComponent } from '../../components/shared/filters/select-filter/select-filter.component';
import { SearchFilterComponent } from '../../components/shared/filters/search-filter/search-filter.component';
import { MealType, RecipeDifficulty } from '../../models/recipe.model';
import { RecipeService } from '../../services/recipe.service';
import { FormService } from '../../services/form.service';
import { SelectFilterOption } from '../../components/shared/filters/select-filter-options';
import { IconComponent } from '../../components/shared/icon/icon.component';
import { MIN_SEARCH_LENGTH, searchTerms } from '../../utils/search.utils';

@Component({
  selector: 'app-recipes-page',
  standalone: true,
  imports: [AsyncPipe, ReactiveFormsModule, RecipeCardComponent, ButtonComponent, SelectFilterComponent, SearchFilterComponent, IconComponent],
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
  get filtersExpanded(): boolean { return this.list.filtersExpanded; }
  set filtersExpanded(value: boolean) { this.list.filtersExpanded = value; }
  readonly pageSize = this.recipeService.pageSize;

  readonly search = this.fb.nonNullable.control(this.list.searchInput);
  readonly pendingFilter = this.fb.nonNullable.control(this.list.filters.pending);
  readonly sortFilter = this.fb.nonNullable.control(this.list.filters.sort);
  readonly mealTypeFilter = this.fb.nonNullable.control<MealType | ''>(this.list.filters.mealType);
  readonly difficultyFilter = this.fb.nonNullable.control<RecipeDifficulty | ''>(this.list.filters.difficulty);
  
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
    this.search.valueChanges.pipe(
      tap((value) => { this.list.searchInput = value; }), debounceTime(300), searchTerms(),
      startWith(this.search.value.trim().length === 0 || this.search.value.trim().length >= MIN_SEARCH_LENGTH ? this.search.value.trim() : this.list.filters.search),
    ),
    this.pendingFilter.valueChanges.pipe(startWith(this.pendingFilter.value)),
    this.sortFilter.valueChanges.pipe(startWith(this.sortFilter.value)),
    this.mealTypeFilter.valueChanges.pipe(startWith(this.mealTypeFilter.value)),
    this.difficultyFilter.valueChanges.pipe(startWith(this.difficultyFilter.value)),
  ]).pipe(
    map(([search, pending, sort, mealType, difficulty]) => ({ search: search.trim(), pending, sort, mealType, difficulty })),
    distinctUntilChanged((previous, current) => JSON.stringify(previous) === JSON.stringify(current)),
  );
  readonly page$ = this.list.page$.pipe(tap((page) => {
    this.pageReady = !page.loading && (!page.error || page.items.length > 0);
    this.restoreScroll();
  }));

  constructor() {
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
    this.pendingFilter.setValue('pending');
  }

  showRecipe(recipe: RecipeCard): void {
    void this.router.navigate(['/recipes', recipe.id]);
  }
}




