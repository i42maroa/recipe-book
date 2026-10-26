import { Component, computed, input, output } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MEAL_SLOTS, MealSlot, PortionMode, RecipeSummary, ScheduledRecipe } from '../../models/scheduled-meal.model';
import { portionSummary } from '../../utils/scheduled-meal.utils';
import { IconComponent } from '../shared/icon/icon.component';

export interface PlannerDayRecipe extends ScheduledRecipe {
  key: number | string;
  control?: FormControl<PortionMode>;
}
export interface PlannerDayMeal { slot: MealSlot; servings: number; recipes: PlannerDayRecipe[] }

@Component({
  selector: 'app-planner-day', standalone: true,
  imports: [ReactiveFormsModule, RouterLink, IconComponent],
  templateUrl: './planner-day.component.html',
  styleUrl: './planner-day.component.css',
})
export class PlannerDayComponent {
  readonly date = input.required<string>();
  readonly label = input.required<string>();
  readonly dayId = input('');
  readonly meals = input<PlannerDayMeal[]>([]);
  readonly summaries = input<Record<string, RecipeSummary>>({});
  readonly loading = input(false);
  readonly disabled = input(false);
  readonly mode = input<'edit' | 'select'>('edit');
  readonly selectedSlot = input<MealSlot | ''>('');
  readonly targetRecipeId = input<string | null>(null);
  readonly recipeQueryParams = input<Record<string, string | null>>({});
  readonly addRecipe = output<MealSlot>();
  readonly removeRecipe = output<PlannerDayRecipe>();
  readonly modeChanged = output<void>();
  readonly sections = computed(() => MEAL_SLOTS.map(slot => {
    const meal = this.meals().find(meal => meal.slot === slot.id);
    const recipes = meal?.recipes ?? [];
    return { ...slot, servings: meal?.servings ?? 2, recipes,
      duplicate: recipes.some(entry => entry.recipeId.toLowerCase() === this.targetRecipeId()?.toLowerCase()) };
  }));

  choose(slot: MealSlot): void {
    const meal = this.sections().find(meal => meal.id === slot);
    if (!this.disabled() && !this.loading() && meal && meal.recipes.length < 5 && !meal.duplicate) this.addRecipe.emit(slot);
  }

  recipe(entry: ScheduledRecipe): RecipeSummary | undefined {
    return this.summaries()[entry.recipeId.toLowerCase()] ?? this.summaries()[entry.recipeId];
  }

  summary(entry: PlannerDayRecipe, servings: number): string {
    return portionSummary(this.recipe(entry)?.servings ?? null, servings, entry.control?.value ?? entry.mode);
  }

  remove(entry: PlannerDayRecipe): void {
    if (this.mode() === 'edit' && !this.disabled() && !this.loading()) this.removeRecipe.emit(entry);
  }
}
