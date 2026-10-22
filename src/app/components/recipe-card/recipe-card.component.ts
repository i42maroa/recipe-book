import { cuisineFlag, mealPhotoClass } from '../../utils/recipe-display.utils';
import { Component, computed, input, output } from '@angular/core';
import { CuisineType, RecipePhoto } from '../../models/recipe.model';
import { RecipeCard } from '../../models/recipe-card.model';
import { MealIconComponent } from '../shared/meal-icon/meal-icon.component';
import { IconComponent } from '../shared/icon/icon.component';
import { DifficultyTonePipe } from '../../pipes/difficulty-tone.pipe';
import { IngredientTagComponent } from '../shared/ingredient-tag/ingredient-tag.component';

@Component({
  selector: 'app-recipe-card', standalone: true, imports: [MealIconComponent, IconComponent, DifficultyTonePipe, IngredientTagComponent],
  templateUrl: './recipe-card.component.html',
  styleUrl: './recipe-card.component.css'
})
export class RecipeCardComponent {
  readonly recipe = input.required<RecipeCard>();
  readonly selected = output<RecipeCard>();
  readonly priority = input(false);
  readonly disabled = input(false);
  readonly ingredientFilterIds = input<string[]>([]);
  readonly matchedIngredients = computed(() => {
    const ingredients = new Map((this.recipe().matchedIngredients ?? []).map(ingredient => [ingredient.id.toLowerCase(), ingredient]));
    return [...new Set(this.ingredientFilterIds().map(id => id.toLowerCase()))]
      .flatMap(id => ingredients.has(id) ? [ingredients.get(id)!] : []);
  });
  activePhotoIndex = 0;
  currentPhoto(): RecipePhoto | undefined {
    const photos = this.recipe().photos ?? [];
    return photos.length ? photos[this.activePhotoIndex % photos.length] : undefined;
  }
  changePhoto(direction: number, event: Event): void {
    event.stopPropagation();
    if (event instanceof KeyboardEvent) event.preventDefault();
    const count = this.recipe().photos?.length ?? 0;
    if (count) this.activePhotoIndex = (this.activePhotoIndex + direction + count) % count;
  }
  selectCard(event: Event): void {
    if (event instanceof KeyboardEvent) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (!this.disabled()) this.selected.emit(this.recipe());
  }
  cuisineFlag(cuisine: CuisineType): string { return cuisineFlag(cuisine); }
  photoClass(): string { return mealPhotoClass(this.recipe().mealTypes[0]); }
}

