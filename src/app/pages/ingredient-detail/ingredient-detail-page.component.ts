import { AsyncPipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { catchError, combineLatest, distinctUntilChanged, from, map, of, shareReplay, startWith, Subject, switchMap } from 'rxjs';
import { Ingredient, Recipe, RecipeIngredientUsage } from '../../models/recipe.model';
import { IngredientService } from '../../services/ingredient.service';
import { RecipeService } from '../../services/recipe.service';
import { IngredientIconComponent } from '../../components/shared/ingredient-icon/ingredient-icon.component';
import { groupIngredients, selectedIngredients } from '../../utils/ingredients.utils';
import { NotFoundPageComponent } from '../not-found/not-found-page.component';
import { isUuid } from '../../utils/uuid.utils';
import { SkeletonComponent } from '../../components/shared/skeleton/skeleton.component';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ingredientAmountLabel, ingredientBaseUnit, positiveQuantity } from '../../utils/ingredient-measures.utils';

@Component({
  selector: 'app-ingredient-detail-page',
  standalone: true,
  imports: [AsyncPipe, RouterLink, IngredientIconComponent, NotFoundPageComponent, SkeletonComponent],
  templateUrl: './ingredient-detail-page.component.html',
  styleUrl: './ingredient-detail-page.component.css',
})
export class IngredientDetailPageComponent {
  private readonly route = inject(ActivatedRoute);
  readonly ingredientService = inject(IngredientService);
  private readonly recipeService = inject(RecipeService);
  private readonly retries = new Subject<void>();

  private readonly ingredientId$ = this.route.paramMap.pipe(
    map((params) => params.get('id') ?? ''),
    distinctUntilChanged(),
  );
  private readonly recipesForIngredient$ = combineLatest([this.ingredientId$, this.recipeService.changes$, this.retries.pipe(startWith(undefined))]).pipe(
    switchMap(([id]) => isUuid(id) ? from(this.recipeService.getForIngredient(id)).pipe(
      map((recipes) => ({ id, recipes, loading: false, error: false })),
      catchError(() => {
        return of({ id, recipes: [], loading: false, error: true });
      }),
      startWith({ id, recipes: [], loading: true, error: false }),
    ) : of({ id, recipes: [], loading: false, error: false })),
  );
  readonly details$ = combineLatest([this.recipesForIngredient$, this.ingredientService.ingredients$]).pipe(
    map(([{ id, recipes, loading, error }, ingredients]) => {
      const ingredient = ingredients.find((item) => item.id === id) ?? null;
      const usedIn = ingredient ? recipes : [];
      const components = selectedIngredients(ingredients, ingredient?.derivedFromIds ?? [])
        .sort((a, b) => a.category.localeCompare(b.category, 'es') || a.name.localeCompare(b.name, 'es'));
      const madeFrom = groupIngredients(components).map((group) => ({ category: group.category, components: group.ingredients }));
      return { ingredient, usedIn, madeFrom, loading, error, validId: isUuid(id) };
    }),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  constructor() {
    this.ingredientId$.pipe(takeUntilDestroyed()).subscribe(id => {
      if (isUuid(id)) void this.ingredientService.ensureDetails(id).catch(() => undefined);
    });
  }

  retry(): void { this.retries.next(); }
  retryIngredients(): void {
    void this.ingredientService.refresh().then(() => this.ingredientService.ensureDetails(this.route.snapshot.paramMap.get('id') ?? '')).catch(() => undefined);
  }

  recipeCountLabel(recipes: Pick<Recipe, 'id'>[]): string {
    return recipes.length === 1 ? '1 receta' : `${recipes.length} recetas`;
  }

  amountLabel(ingredient: Ingredient, componentId: string): string | null {
    const amount = ingredient.derivedFromAmounts?.[componentId];
    if (!amount) return null;
    return ingredientAmountLabel(amount, true, this.ingredientService.getById(componentId));
  }

  recipeAmountLabel(recipe: RecipeIngredientUsage, ingredient: Ingredient): string | null {
    return ingredientAmountLabel(recipe.ingredientAmount, true, ingredient);
  }

  unitEquivalent(ingredient: Ingredient): string | null {
    return positiveQuantity(ingredient.unitQuantity)
      ? ingredientAmountLabel({ kind: 'specific', value: ingredient.unitQuantity, unit: ingredientBaseUnit(ingredient) }) : null;
  }
}


