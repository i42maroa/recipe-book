import { Component, input, output } from '@angular/core';
import { CuisineType, Recipe, RecipePhoto } from '../../models/recipe.model';
import { MealIconComponent } from '../shared/meal-icon/meal-icon.component';
import { IconComponent } from '../shared/icon/icon.component';
import { DifficultyTonePipe } from '../../pipes/difficulty-tone.pipe';

@Component({
  selector: 'app-recipe-card', standalone: true, imports: [MealIconComponent, IconComponent, DifficultyTonePipe],
  templateUrl: './recipe-card.component.html',
  styleUrl: './recipe-card.component.css'
})
export class RecipeCardComponent {
  readonly recipe = input.required<Recipe>();
  readonly selected = output<Recipe>();
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
    this.selected.emit(this.recipe());
  }
  cuisineFlag(cuisine: CuisineType): string {
    const flags: Record<CuisineType, string> = {
      ['Española']: '🇪🇸', Italiana: '🇮🇹', Mexicana: '🇲🇽', Japonesa: '🇯🇵', China: '🇨🇳',
      India: '🇮🇳', Francesa: '🇫🇷', Peruana: '🇵🇪', ['Árabe']: '🇸🇦', Otra: '🌐',
    };
    return flags[cuisine];
  }
  photoClass(): string {
    const mealType = this.recipe().mealTypes[0];
    const photoByMealType: Record<string, string> = {
      Desayuno: 'photo-breakfast', Entrante: 'photo-starter', Plato: 'photo-main', Postre: 'photo-dessert',
    };
    return photoByMealType[mealType] ?? 'photo-neutral';
  }
}

