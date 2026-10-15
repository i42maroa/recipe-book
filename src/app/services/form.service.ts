import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { Ingredient, Recipe } from '../models/recipe.model';
import { BaseFormType, RecipeFormValue } from '../models/form.model';
import { NotificationService } from './notification.service';
import { RecipeService } from './recipe.service';

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

  saveRecipe(value: RecipeFormValue): void {
    const state = this.dialogSubject.value;
    const recipe = { ...value, pending: value.pending === 'yes' };
    if (state?.recipeToEdit) {
      this.recipes.update(state.recipeToEdit.id, recipe);
      this.notifications.success('Receta actualizada.');
    } else {
      this.recipes.create(recipe);
      this.notifications.success('Tu receta ya está guardada. ¡Que aproveche!');
    }
    this.close();
  }
}

