import { Component, input, output } from '@angular/core';
import { Ingredient, Recipe } from '../../models/recipe.model';
import { MealIconComponent } from '../shared/meal-icon/meal-icon.component';
import { IconComponent } from '../shared/icon/icon.component';

@Component({
  selector: 'app-recipe-detail', standalone: true, imports: [MealIconComponent, IconComponent],
  templateUrl: './recipe-detail.component.html',
  styleUrl: './recipe-detail.component.css'
})
export class RecipeDetailComponent {
  readonly recipe = input.required<Recipe>();
  readonly ingredients = input<Ingredient[]>([]);
  readonly close = output<void>();
  recipeIngredients(): Ingredient[] { return this.ingredients().filter((item) => this.recipe().ingredientIds.includes(item.id)); }
}


