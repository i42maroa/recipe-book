import { Component, input, model, viewChild } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MealType, RecipeDifficulty } from '../../../../models/recipe.model';
import { IconComponent } from '../../icon/icon.component';
import { IngredientFilterComponent } from '../ingredient-filter/ingredient-filter.component';
import { SearchFilterComponent } from '../search-filter/search-filter.component';
import { SelectFilterComponent } from '../select-filter/select-filter.component';
import { RECIPE_DIFFICULTY_OPTIONS, RECIPE_MEAL_TYPE_OPTIONS, RECIPE_SORT_OPTIONS } from '../recipe-filter-options';

let nextFilterId = 0;

@Component({
  selector: 'app-recipe-filters',
  standalone: true,
  imports: [ReactiveFormsModule, SearchFilterComponent, SelectFilterComponent, IngredientFilterComponent, IconComponent],
  templateUrl: './recipe-filters.component.html',
  styleUrl: './recipe-filters.component.css',
})
export class RecipeFiltersComponent {
  readonly panelId = `recipe-extra-filters-${++nextFilterId}`;
  readonly search = input.required<FormControl<string>>();
  readonly sort = input.required<FormControl<string>>();
  readonly mealType = input.required<FormControl<MealType | ''>>();
  readonly difficulty = input.required<FormControl<RecipeDifficulty | ''>>();
  readonly ingredientIds = input.required<FormControl<string[]>>();
  readonly expanded = model(false);
  readonly sortOptions = RECIPE_SORT_OPTIONS;
  readonly mealTypeOptions = RECIPE_MEAL_TYPE_OPTIONS;
  readonly difficultyOptions = RECIPE_DIFFICULTY_OPTIONS;
  private readonly ingredientPicker = viewChild(IngredientFilterComponent);

  clearIngredientSearch(): void { this.ingredientPicker()?.search.setValue(''); }
}
