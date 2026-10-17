import { AsyncPipe } from '@angular/common';
import { FormBuilder } from '@angular/forms';
import { Component, inject } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { combineLatest, map } from 'rxjs';
import { ButtonComponent } from '../../components/shared/button/button.component';
import { CuisineType, Ingredient, Recipe, RecipePhoto } from '../../models/recipe.model';
import { IngredientService } from '../../services/ingredient.service';
import { RecipeService } from '../../services/recipe.service';
import { NotificationService } from '../../services/notification.service';
import { FormService } from '../../services/form.service';
import { MealIconComponent } from '../../components/shared/meal-icon/meal-icon.component';
import { IconComponent } from '../../components/shared/icon/icon.component';
import { DifficultyTonePipe } from '../../pipes/difficulty-tone.pipe';
import { PhotoLightboxComponent } from '../../components/shared/photo-lightbox/photo-lightbox.component';

@Component({
  selector: 'app-recipe-detail-page',
  standalone: true,
  imports: [AsyncPipe, RouterLink, ButtonComponent, MealIconComponent, IconComponent, DifficultyTonePipe, PhotoLightboxComponent],
  templateUrl: './recipe-detail-page.component.html',
  styleUrl: './recipe-detail-page.component.css',
})
export class RecipeDetailPageComponent {
  activePhotoIndex = 0;
  lightboxOpen = false;
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly recipeService = inject(RecipeService);
  private readonly ingredientService = inject(IngredientService);
  private readonly notifications = inject(NotificationService);
  readonly forms = inject(FormService);
  isRating = false;
  private readonly fb = inject(FormBuilder);
  readonly ratingControl = this.fb.nonNullable.control(0);
  readonly ratingOptions = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  readonly ingredients$ = this.ingredientService.ingredients$;
  readonly recipe$ = combineLatest([this.route.paramMap, this.recipeService.recipes$]).pipe(
    map(([params, recipes]) => recipes.find((recipe) => recipe.id === params.get('id')) ?? null),
  );

  backToRecipes(): void {
    void this.router.navigate(['/recipes']);
  }

  openRating(recipe: Recipe): void {
    this.ratingControl.setValue(recipe.rating ?? 0);
    this.isRating = true;
  }

  setRating(value: number): void { this.ratingControl.setValue(value); }

  async saveRating(recipe: Recipe): Promise<void> {
    const rating = this.ratingControl.value;
    if (!Number.isInteger(rating) || rating < 1 || rating > 10) {
      this.notifications.error('Selecciona de una a diez estrellas.');
      return;
    }
    await this.recipeService.update(recipe.id, { ...recipe, pending: false, rating });
    this.isRating = false;
    this.notifications.success('Valoración guardada.');
  }
  async deleteRecipe(recipe: Recipe): Promise<void> {
    if (!window.confirm(`¿Quieres eliminar la receta «${recipe.name}»?`)) return;
    await this.recipeService.remove(recipe.id);
    this.notifications.success('Receta eliminada.');
    this.backToRecipes();
  }

  ingredientsFor(recipe: Recipe, ingredients: Ingredient[] | null): Ingredient[] {
    return (ingredients ?? [])
      .filter((ingredient) => recipe.ingredientIds.includes(ingredient.id))
      .sort((a, b) => a.category.localeCompare(b.category, 'es') || a.name.localeCompare(b.name, 'es'));
  }

  ingredientGroupsFor(ingredients: Ingredient[]): Array<{ category: string; ingredients: Ingredient[] }> {
    const categories = [...new Set(ingredients.map((ingredient) => ingredient.category))];
    return categories.map((category) => ({
      category,
      ingredients: ingredients.filter((ingredient) => ingredient.category === category),
    }));
  }

  amountLabel(recipe: Recipe, ingredientId: string): string | null {
    const amount = recipe.ingredientAmounts?.[ingredientId];
    if (!amount) return null;
    if (amount.kind === 'spoon') return '1 cucharada';
    if (amount.kind === 'glass') return '1 vaso';
    return amount.value ? `${amount.value} ${amount.unit}` : null;
  }

  durationLabel(minutes: number | null): string {
    if (minutes === null) return '—';
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    if (hours === 0) return `${minutes} min`;
    return remainingMinutes === 0 ? `${hours} h` : `${hours} h ${remainingMinutes} min`;
  }

  photoClass(recipe: Recipe): string {
    const photoByMealType: Record<string, string> = {
      Desayuno: 'photo-breakfast', Entrante: 'photo-starter', Plato: 'photo-main', Postre: 'photo-dessert',
    };
    return photoByMealType[recipe.mealTypes[0]] ?? 'photo-neutral';
  }

  currentPhoto(recipe: Recipe): RecipePhoto | undefined {
    const photos = recipe.photos ?? [];
    return photos.length ? photos[this.activePhotoIndex % photos.length] : undefined;
  }

  changePhoto(recipe: Recipe, direction: number, event: Event): void {
    event.stopPropagation();
    if (event instanceof KeyboardEvent) event.preventDefault();
    const count = recipe.photos?.length ?? 0;
    if (count) this.activePhotoIndex = (this.activePhotoIndex + direction + count) % count;
  }

  openLightbox(event: Event): void {
    event.stopPropagation();
    if (event instanceof KeyboardEvent) event.preventDefault();
    this.lightboxOpen = true;
  }

  cuisineFlag(cuisine: CuisineType): string {
    const flags: Record<CuisineType, string> = {
      Española: '🇪🇸', Italiana: '🇮🇹', Mexicana: '🇲🇽', Japonesa: '🇯🇵', China: '🇨🇳',
      India: '🇮🇳', Francesa: '🇫🇷', Peruana: '🇵🇪', Árabe: '🇸🇦', Otra: '🌐',
    };
    return flags[cuisine];
  }


}

