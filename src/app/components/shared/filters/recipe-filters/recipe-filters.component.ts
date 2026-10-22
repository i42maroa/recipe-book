import { Component, input, viewChild } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MealType, RecipeDifficulty } from '../../../../models/recipe.model';
import { IngredientFilterComponent } from '../ingredient-filter/ingredient-filter.component';
import { SearchFilterComponent } from '../search-filter/search-filter.component';
import { SelectFilterComponent } from '../select-filter/select-filter.component';
import { RECIPE_DIFFICULTY_OPTIONS, RECIPE_MEAL_TYPE_OPTIONS, RECIPE_SORT_OPTIONS, RECIPE_STATUS_OPTIONS } from '../recipe-filter-options';

@Component({
  selector: 'app-recipe-filters',
  standalone: true,
  imports: [ReactiveFormsModule, SearchFilterComponent, SelectFilterComponent, IngredientFilterComponent],
  templateUrl: './recipe-filters.component.html',
  styleUrl: './recipe-filters.component.css',
})
export class RecipeFiltersComponent {
  readonly search = input.required<FormControl<string>>();
  readonly sort = input.required<FormControl<string>>();
  readonly mealType = input.required<FormControl<MealType | ''>>();
  readonly difficulty = input.required<FormControl<RecipeDifficulty | ''>>();
  readonly status = input.required<FormControl<string>>();
  readonly ingredientIds = input.required<FormControl<string[]>>();
  readonly sortOptions = RECIPE_SORT_OPTIONS;
  readonly mealTypeOptions = RECIPE_MEAL_TYPE_OPTIONS;
  readonly difficultyOptions = RECIPE_DIFFICULTY_OPTIONS;
  readonly statusOptions = RECIPE_STATUS_OPTIONS;
  private readonly ingredientPicker = viewChild(IngredientFilterComponent);

  clearIngredientSearch(): void { this.ingredientPicker()?.search.setValue(''); }
}
