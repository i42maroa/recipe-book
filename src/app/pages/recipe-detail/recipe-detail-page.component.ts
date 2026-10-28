import { AuthService } from '../../services/auth.service';
import { ingredientAmountLabel } from '../../utils/ingredient-measures.utils';
import { environment } from '../../../environments/environment';
﻿import { cuisineFlag, mealPhotoClass } from '../../utils/recipe-display.utils';
import { AsyncPipe } from '@angular/common';
import { FormBuilder } from '@angular/forms';
import { Component, DestroyRef, ElementRef, Injector, afterNextRender, computed, effect, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { catchError, combineLatest, distinctUntilChanged, from, map, of, shareReplay, startWith, Subject, switchMap } from 'rxjs';
import { ButtonComponent } from '../../components/shared/button/button.component';
import { CuisineType, Ingredient, Recipe, RecipePhoto } from '../../models/recipe.model';
import { IngredientService } from '../../services/ingredient.service';
import { RecipeService } from '../../services/recipe.service';
import { RecipeDetailActionsService } from '../../services/recipe-detail-actions.service';
import { NotificationService } from '../../services/notification.service';
import { MealIconComponent } from '../../components/shared/meal-icon/meal-icon.component';
import { IconComponent } from '../../components/shared/icon/icon.component';
import { DifficultyTonePipe } from '../../pipes/difficulty-tone.pipe';
import { PhotoLightboxComponent } from '../../components/shared/photo-lightbox/photo-lightbox.component';
import { groupIngredients } from '../../utils/ingredients.utils';
import { NotFoundPageComponent } from '../not-found/not-found-page.component';
import { isUuid } from '../../utils/uuid.utils';
import { SkeletonComponent } from '../../components/shared/skeleton/skeleton.component';
import { RecipePlanningDialogComponent } from '../../components/recipe-planning-dialog/recipe-planning-dialog.component';
import { MEAL_SLOTS, ScheduledRecipeAddition } from '../../models/scheduled-meal.model';

@Component({
  selector: 'app-recipe-detail-page',
  standalone: true,
  imports: [AsyncPipe, RouterLink, ButtonComponent, MealIconComponent, IconComponent, DifficultyTonePipe, PhotoLightboxComponent, NotFoundPageComponent, SkeletonComponent, RecipePlanningDialogComponent],
  templateUrl: './recipe-detail-page.component.html',
  styleUrl: './recipe-detail-page.component.css',
})
export class RecipeDetailPageComponent {
  activePhotoIndex = 0;
  lightboxOpen = false;
  readonly sharing = signal(false);
  readonly savingRating = signal(false);
  readonly planningOpen = signal(false);
  readonly lastPlanned = signal<ScheduledRecipeAddition | null>(null);
  readonly planningMessage = computed(() => {
    const result = this.lastPlanned();
    if (!result) return '';
    const slot = MEAL_SLOTS.find(item => item.id === result.meal.slot)?.label.toLowerCase();
    const date = new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
      .format(new Date(`${result.meal.date}T00:00:00Z`));
    return `${result.added ? 'Receta añadida' : 'La receta ya estaba añadida'} ${slot === 'desayuno' ? 'al desayuno' : `a la ${slot}`} del ${date}.`;
  });
  private readonly route = inject(ActivatedRoute);
  private readonly recipeService = inject(RecipeService);
  private readonly actions = inject(RecipeDetailActionsService);
  private readonly injector = inject(Injector);
  private readonly ratingForm = viewChild<ElementRef<HTMLElement>>('ratingForm');
  readonly ingredientService = inject(IngredientService);
  private readonly notifications = inject(NotificationService);
  readonly auth = inject(AuthService);
  readonly isRating = signal(false);
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
      this.isRating.set(false);
      this.planningOpen.set(false); this.lastPlanned.set(null);
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
  readonly view = toSignal(this.view$, { initialValue: null });
  readonly preparationSteps = computed(() => this.view()?.recipe?.steps.filter(step => step.trim()) ?? []);

  constructor() {
    const destroyRef = inject(DestroyRef);
    let planningOwner = this.auth.user()?.id;
    effect(() => {
      const view = this.view();
      const owner = this.auth.user()?.id;
      if (owner !== planningOwner) { planningOwner = owner; this.planningOpen.set(false); this.lastPlanned.set(null); }
      this.actions.recipeId.set(view && !view.loading && !view.error ? view.recipe?.id ?? null : null);
      this.actions.busy.set(this.savingRating() || this.planningOpen());
      if (!this.auth.canEdit()) { this.isRating.set(false); this.planningOpen.set(false); this.lastPlanned.set(null); }
    });
    this.actions.ratings$.pipe(takeUntilDestroyed()).subscribe(id => {
      const view = this.view();
      if (view?.recipe?.id === id && !view.loading && !view.error) this.openRating(view.recipe);
    });
    this.actions.planning$.pipe(takeUntilDestroyed()).subscribe(id => {
      const view = this.view();
      if (this.auth.canEdit() && view?.recipe?.id === id && !view.loading && !view.error && !this.savingRating()) {
        this.isRating.set(false); this.planningOpen.set(true);
      }
    });
    destroyRef.onDestroy(() => { this.actions.recipeId.set(null); this.actions.busy.set(false); });
    void this.ingredientService.ensureLoaded().catch(() => undefined);
  }

  retry(): void { this.retries.next(); }
  retryIngredients(): void { void this.ingredientService.refresh().catch(() => undefined); }

  recipePlanned(result: ScheduledRecipeAddition): void {
    this.lastPlanned.set(result); this.planningOpen.set(false);
    this.notifications.success(this.planningMessage());
  }

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
    if (!this.auth.canEdit() || this.savingRating()) return;
    this.ratingControl.setValue(recipe.rating ?? 0);
    this.isRating.set(true);
    afterNextRender(() => {
      const form = this.ratingForm()?.nativeElement;
      form?.focus({ preventScroll: true });
      form?.scrollIntoView({ block: 'center' });
    }, { injector: this.injector });
  }

  setRating(value: number): void { if (!this.savingRating()) this.ratingControl.setValue(value); }

  async saveRating(recipe: Recipe): Promise<void> {
    if (this.savingRating() || !this.auth.canEdit()) return;
    const rating = this.ratingControl.value;
    if (!Number.isInteger(rating) || rating < 1 || rating > 10) {
      this.notifications.error('Selecciona de una a diez estrellas.');
      return;
    }
    this.savingRating.set(true);
    try {
      await this.recipeService.rate(recipe.id, rating);
      this.isRating.set(false);
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
    return ingredientAmountLabel(amount, true, this.ingredientService.getById(ingredientId));
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

