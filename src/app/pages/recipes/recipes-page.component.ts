import { AsyncPipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { combineLatest, map, startWith } from 'rxjs';
import { RecipeCardComponent } from '../../components/recipe-card/recipe-card.component';
import { ButtonComponent } from '../../components/shared/button/button.component';
import { FilterContainerComponent } from '../../components/shared/filters/filter-container/filter-container.component';
import { SelectFilterComponent } from '../../components/shared/filters/select-filter/select-filter.component';
import { SearchFilterComponent } from '../../components/shared/filters/search-filter/search-filter.component';
import { CountLabelPipe } from '../../pipes/count-label.pipe';
import { MealType, Recipe, RecipeDifficulty } from '../../models/recipe.model';
import { IngredientService } from '../../services/ingredient.service';
import { RecipeService } from '../../services/recipe.service';
import { FormService } from '../../services/form.service';
import { SelectFilterOption } from '../../components/shared/filters/select-filter-options';
import { IconComponent } from '../../components/shared/icon/icon.component';

@Component({
  selector: 'app-recipes-page',
  standalone: true,
  imports: [AsyncPipe, ReactiveFormsModule, RecipeCardComponent, ButtonComponent, FilterContainerComponent, SelectFilterComponent, SearchFilterComponent, IconComponent],
  templateUrl: './recipes-page.component.html',
  styleUrl: './recipes-page.component.css',
})
export class RecipesPageComponent {
  private readonly recipeService = inject(RecipeService);
  private readonly ingredientService = inject(IngredientService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  readonly forms = inject(FormService);

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
  readonly ingredients$ = this.ingredientService.ingredients$;
  readonly recipeCount$ = this.recipeService.recipes$.pipe(map((recipes) => recipes.length));
  readonly pendingCount$ = this.recipeService.recipes$.pipe(map((recipes) => recipes.filter((recipe) => recipe.pending).length));
  readonly filteredRecipes$ = combineLatest([
    this.recipeService.recipes$,
    this.ingredients$,
    this.search.valueChanges.pipe(startWith('')),
    this.pendingFilter.valueChanges.pipe(startWith('all')),
    this.sortFilter.valueChanges.pipe(startWith('recent')),
    this.mealTypeFilter.valueChanges.pipe(startWith('' as const)),
    this.difficultyFilter.valueChanges.pipe(startWith('' as const)),
  ]).pipe(map(([recipes, ingredients, query, pending, sort, mealType, difficulty]) => {
    const normalizedQuery = query.toLowerCase().trim();
    const filtered = recipes.filter((recipe) => {
      const ingredientNames = ingredients
        .filter((item) => recipe.ingredientIds.includes(item.id))
        .map((item) => item.name.toLowerCase());
      const matchesQuery = !normalizedQuery
        || recipe.name.toLowerCase().includes(normalizedQuery)
        || ingredientNames.some((name) => name.includes(normalizedQuery));
      const matchesPending = pending === 'all' || (pending === 'pending' ? recipe.pending : !recipe.pending);
      const matchesMealType = !mealType || recipe.mealTypes.includes(mealType);
      const matchesDifficulty = !difficulty || recipe.difficulty === difficulty;
      return matchesQuery && matchesPending && matchesMealType && matchesDifficulty;
    });
    if (sort === 'name') return [...filtered].sort((a, b) => a.name.localeCompare(b.name));
    if (sort === 'rating') return [...filtered].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
    if (sort === 'time') return [...filtered].sort((a, b) => (a.minutes ?? Number.MAX_SAFE_INTEGER) - (b.minutes ?? Number.MAX_SAFE_INTEGER));
    return filtered;
  }));

  showPendingRecipes(): void {
    this.pendingFilter.setValue('pending');
  }

  showRecipe(recipe: Recipe): void {
    void this.router.navigate(['/recipes', recipe.id]);
  }
}




