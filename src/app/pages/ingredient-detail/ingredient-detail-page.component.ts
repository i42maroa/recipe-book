import { AsyncPipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { combineLatest, map } from 'rxjs';
import { ButtonComponent } from '../../components/shared/button/button.component';
import { Ingredient, Recipe } from '../../models/recipe.model';
import { IngredientService } from '../../services/ingredient.service';
import { RecipeService } from '../../services/recipe.service';
import { FormService } from '../../services/form.service';
import { IngredientIconComponent } from '../../components/shared/ingredient-icon/ingredient-icon.component';

@Component({
  selector: 'app-ingredient-detail-page',
  standalone: true,
  imports: [AsyncPipe, RouterLink, ButtonComponent, IngredientIconComponent],
  templateUrl: './ingredient-detail-page.component.html',
  styleUrl: './ingredient-detail-page.component.css',
})
export class IngredientDetailPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly ingredientService = inject(IngredientService);
  private readonly recipeService = inject(RecipeService);
  readonly forms = inject(FormService);

  readonly details$ = combineLatest([
    this.route.paramMap,
    this.ingredientService.ingredients$,
    this.recipeService.recipes$,
  ]).pipe(
    map(([params, ingredients, recipes]) => {
      const ingredient = ingredients.find((item) => item.id === params.get('id')) ?? null;
      const usedIn = ingredient
        ? recipes.filter((recipe) => recipe.ingredientIds.includes(ingredient.id))
        : [];
      const components = ingredient?.derivedFromIds
        ?.map((id) => ingredients.find((item) => item.id === id))
        .filter((item): item is Ingredient => item !== undefined) ?? [];
      const categories = [...new Set(components.map((component) => component.category))]
        .sort((a, b) => a.localeCompare(b, 'es'));
      const madeFrom = categories.map((category) => ({
        category,
        components: components
          .filter((component) => component.category === category)
          .sort((a, b) => a.name.localeCompare(b.name, 'es')),
      }));
      return { ingredient, usedIn, madeFrom };
    }),
  );

  backToIngredients(): void {
    void this.router.navigate(['/ingredients']);
  }

  deleteIngredient(ingredient: Ingredient): void {
    if (!window.confirm(`¿Quieres eliminar el ingrediente «${ingredient.name}»?`)) return;
    if (this.ingredientService.remove(ingredient.id)) this.backToIngredients();
  }

  recipeCountLabel(recipes: Recipe[]): string {
    return recipes.length === 1 ? '1 receta' : `${recipes.length} recetas`;
  }

  amountLabel(ingredient: Ingredient, componentId: string): string | null {
    const amount = ingredient.derivedFromAmounts?.[componentId];
    if (!amount) return null;
    if (amount.kind === 'spoon') return '1 cucharada';
    if (amount.kind === 'glass') return '1 vaso';
    if (amount.value === null) return null;
    const unit = amount.unit === 'pieza' && amount.value !== 1 ? 'piezas' : amount.unit;
    return `${amount.value} ${unit}`;
  }
}


