import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { Ingredient, Recipe } from '../models/recipe.model';
import { BaseFormType, RecipeFormValue } from '../models/form.model';
import { NotificationService } from './notification.service';
import { RecipeService } from './recipe.service';
import { RecipePhotoService } from './recipe-photo.service';

export interface FormDialogState {
  formType: BaseFormType;
  recipeToEdit: Recipe | null;
  ingredientToEdit: Ingredient | null;
}

@Injectable({ providedIn: 'root' })
export class FormService {
  private readonly dialogSubject = new BehaviorSubject<FormDialogState | null>(null);
  readonly dialog$ = this.dialogSubject.asObservable();

  constructor(
    private readonly recipes: RecipeService,
    private readonly notifications: NotificationService,
    private readonly recipePhotos: RecipePhotoService,
  ) {}

  openForm(formType: BaseFormType, item?: Recipe | Ingredient): void {
    this.dialogSubject.next({
      formType,
      recipeToEdit: formType === 'recipe' && item && 'ingredientIds' in item ? item : null,
      ingredientToEdit: formType === 'ingredient' && item && 'category' in item ? item : null,
    });
  }

  close(): void {
    this.dialogSubject.next(null);
  }

  async saveRecipe(value: RecipeFormValue): Promise<void> {
    const state = this.dialogSubject.value;
    const wasEditing = !!state?.recipeToEdit;
    const { photos, photoFiles, ...recipeValue } = value;
    const pending = value.pending === 'yes';
    const recipe = { ...recipeValue, pending, rating: pending ? null : value.rating };
    let recipeId: string | null = null;
    try {
    if (state?.recipeToEdit) {
      recipeId = await this.recipes.update(state.recipeToEdit.id, recipe);
    } else {
      recipeId = await this.recipes.create(recipe);
    }
    await this.recipePhotos.sync(recipeId, photos, photoFiles);
    await this.recipes.refreshRecipe(recipeId);
    this.notifications.success(wasEditing ? 'Receta actualizada.' : 'Tu receta ya está guardada. ¡Que aproveche!');
    this.close();
    } catch (error) {
      if (!wasEditing && recipeId) {
        const savedRecipe = this.recipes.getById(recipeId);
        if (savedRecipe) this.dialogSubject.next({ formType: 'recipe', recipeToEdit: savedRecipe, ingredientToEdit: null });
      }
      this.notifications.error(error instanceof Error ? error.message : 'No se pudo guardar la receta.');
    }
  }
}

