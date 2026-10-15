import { Component, input } from '@angular/core';
import { MealType } from '../../../models/recipe.model';

@Component({
  selector: 'app-meal-icon',
  standalone: true,
  templateUrl: './meal-icon.component.html',
  styleUrl: './meal-icon.component.css',
})
export class MealIconComponent {
  readonly mealType = input.required<MealType>();

  iconUrl(): string {
    const iconByMealType: Record<MealType, string> = {
      Desayuno: 'breakfast',
      Entrante: 'starter',
      Plato: 'main-course',
      Postre: 'dessert',
    };
    return `/assets/icons/meals/${iconByMealType[this.mealType()]}.svg`;
  }
}
