import { AuthService } from '../../services/auth.service';
import { environment } from '../../../environments/environment';
﻿import { cuisineFlag, mealPhotoClass } from '../../utils/recipe-display.utils';
import { AsyncPipe } from '@angular/common';
import { FormBuilder } from '@angular/forms';
import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { catchError, combineLatest, distinctUntilChanged, from, map, of, shareReplay, startWith, Subject, switchMap } from 'rxjs';
import { ButtonComponent } from '../../components/shared/button/button.component';
import { CuisineType, Ingredient, Recipe, RecipePhoto } from '../../models/recipe.model';
import { IngredientService } from '../../services/ingredient.service';
import { RecipeService } from '../../services/recipe.service';
import { NotificationService } from '../../services/notification.service';
import { MealIconComponent } from '../../components/shared/meal-icon/meal-icon.component';
import { IconComponent } from '../../components/shared/icon/icon.component';
import { DifficultyTonePipe } from '../../pipes/difficulty-tone.pipe';
import { PhotoLightboxComponent } from '../../components/shared/photo-lightbox/photo-lightbox.component';
import { groupIngredients } from '../../utils/ingredients.utils';
import { NotFoundPageComponent } from '../not-found/not-found-page.component';
import { isUuid } from '../../utils/uuid.utils';

@Component({
  selector: 'app-recipe-detail-page',
  standalone: true,
  imports: [AsyncPipe, RouterLink, ButtonComponent, MealIconComponent, IconComponent, DifficultyTonePipe, PhotoLightboxComponent, NotFoundPageComponent],
  templateUrl: './recipe-detail-page.component.html',
  styleUrl: './recipe-detail-page.component.css',
})
export class RecipeDetailPageComponent {
  activePhotoIndex = 0;
  lightboxOpen = false;
  readonly sharing = signal(false);
  readonly savingRating = signal(false);
  private readonly route = inject(ActivatedRoute);
  private readonly recipeService = inject(RecipeService);
  readonly ingredientService = inject(IngredientService);
  private readonly notifications = inject(NotificationService);
  readonly auth = inject(AuthService);
  isRating = false;
  private readonly fb = inject(FormBuilder);
  readonly ratingControl = this.fb.nonNullable.control(0);
  readonly ratingOptions = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  readonly ingredients$ = this.ingredientService.ingredients$;
  private readonly retries = new Subject<void>();
  private readonly loadedRecipe$ = combineLatest([
    this.route.paramMap.pipe(map((params) => params.get('id')), distinctUntilChanged()),
    this.retries.pipe(startWith(undefined)),
  ]).pipe(
    switchMap(([id]) => {
      this.activePhotoIndex = 0;
      this.lightboxOpen = false;
      this.isRating = false;
      return isUuid(id) ? from(this.recipeService.loadRecipe(id)).pipe(
        map(() => ({ id, loading: false, error: false })),
        catchError(() => of({ id, loading: false, error: true })),
        startWith({ id, loading: true, error: false }),
      ) : of({ id, loading: false, error: false });
    }),
  );
  readonly view$ = combineLatest([this.loadedRecipe$, this.recipeService.recipes$]).pipe(
    map(([state, recipes]) => ({ ...state, recipe: recipes.find((recipe) => recipe.id === state.id) ?? null })),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  retry(): void { this.retries.next(); }
  retryIngredients(): void { void this.ingredientService.refresh().catch(() => undefined); }

  async shareRecipe(recipe: Recipe): Promise<void> {
    if (this.sharing()) return;
    this.sharing.set(true);
    const url = new URL(`/recipes/${encodeURIComponent(recipe.id)}`, environment.publicSiteUrl);
    try {
      if (navigator.share) {
        try {
          await navigator.share({ title: recipe.name, url: url.href });
          return;
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') return;
        }
      }
      try {
        await navigator.clipboard.writeText(url.href);
        this.notifications.success('Enlace de la receta copiado.');
      } catch {
        window.prompt('Copia este enlace para compartir la receta:', url.href);
      }
    } finally {
      this.sharing.set(false);
    }
  }

  openRating(recipe: Recipe): void {
    this.ratingControl.setValue(recipe.rating ?? 0);
    this.isRating = true;
  }

  setRating(value: number): void { this.ratingControl.setValue(value); }

  async saveRating(recipe: Recipe): Promise<void> {
    if (this.savingRating()) return;
    const rating = this.ratingControl.value;
    if (!Number.isInteger(rating) || rating < 1 || rating > 10) {
      this.notifications.error('Selecciona de una a diez estrellas.');
      return;
    }
    this.savingRating.set(true);
    try {
      await this.recipeService.rate(recipe.id, rating);
      this.isRating = false;
      this.notifications.success('Valoración guardada.');
    } catch (error) {
      this.notifications.error(error instanceof Error ? error.message : 'No se pudo guardar la valoración.');
    } finally { this.savingRating.set(false); }
  }
  ingredientsFor(recipe: Recipe, ingredients: Ingredient[] | null): Ingredient[] {
    const selectedIds = new Set(recipe.ingredientIds);
    return (ingredients ?? [])
      .filter((ingredient) => selectedIds.has(ingredient.id))
      .sort((a, b) => a.category.localeCompare(b.category, 'es') || a.name.localeCompare(b.name, 'es'));
  }

  ingredientGroupsFor(ingredients: Ingredient[]): Array<{ category: string; ingredients: Ingredient[] }> {
    return groupIngredients(ingredients);
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

  photoClass(recipe: Recipe): string { return mealPhotoClass(recipe.mealTypes[0]); }

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

  cuisineFlag(cuisine: CuisineType): string { return cuisineFlag(cuisine); }


}

