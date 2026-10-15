import { Component, input, output } from '@angular/core';
import { Recipe } from '../../models/recipe.model';
import { MealIconComponent } from '../shared/meal-icon/meal-icon.component';
import { IconComponent } from '../shared/icon/icon.component';

@Component({
  selector: 'app-recipe-card', standalone: true, imports: [MealIconComponent, IconComponent],
  templateUrl: './recipe-card.component.html',
  styleUrl: './recipe-card.component.css'
})
export class RecipeCardComponent {
  readonly recipe = input.required<Recipe>();
  readonly selected = output<Recipe>();
  photoClass(): string {
    const mealType = this.recipe().mealTypes[0];
    const photoByMealType: Record<string, string> = {
      Desayuno: 'photo-breakfast', Entrante: 'photo-starter', Plato: 'photo-main', Postre: 'photo-dessert',
    };
    return photoByMealType[mealType] ?? 'photo-neutral';
  }
}

