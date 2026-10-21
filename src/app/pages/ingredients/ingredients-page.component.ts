import { AuthService } from '../../services/auth.service';
﻿import { ingredientCategoryLabel } from '../../utils/recipe-display.utils';
import { AsyncPipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { combineLatest, map, startWith } from 'rxjs';
import { INGREDIENT_CATEGORIES, Ingredient, IngredientCategory } from '../../models/recipe.model';
import { IngredientService } from '../../services/ingredient.service';
import { ButtonComponent } from '../../components/shared/button/button.component';
import { FormService } from '../../services/form.service';
import { FilterContainerComponent } from '../../components/shared/filters/filter-container/filter-container.component';
import { SelectFilterComponent } from '../../components/shared/filters/select-filter/select-filter.component';
import { SearchFilterComponent } from '../../components/shared/filters/search-filter/search-filter.component';
import { SelectFilterOption } from '../../components/shared/filters/select-filter-options';
import { IngredientCardComponent } from '../../components/ingredient-card/ingredient-card.component';
import { IconComponent } from '../../components/shared/icon/icon.component';
import { searchTerms } from '../../utils/search.utils';
import { groupIngredients } from '../../utils/ingredients.utils';
import { SkeletonComponent } from '../../components/shared/skeleton/skeleton.component';
import { findIngredients } from '../../utils/ingredient-search.utils';


@Component({
  selector: 'app-ingredients-page', standalone: true, imports: [AsyncPipe, ReactiveFormsModule, ButtonComponent, FilterContainerComponent, SelectFilterComponent, SearchFilterComponent, IngredientCardComponent, IconComponent, SkeletonComponent],
  templateUrl: './ingredients-page.component.html',
  styleUrl: './ingredients-page.component.css'
})
export class IngredientsPageComponent {
  readonly auth = inject(AuthService);
  readonly forms = inject(FormService);
  readonly ingredientService = inject(IngredientService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  readonly search = this.fb.nonNullable.control('');
  readonly category = this.fb.nonNullable.control<IngredientCategory | ''>('');
  readonly categories: IngredientCategory[] = [...INGREDIENT_CATEGORIES];
  readonly categoryOptions: SelectFilterOption[] = [
    { value: '', label: 'Todos los tipos' },
    ...this.categories.map((itemCategory) => ({ value: itemCategory, label: ingredientCategoryLabel(itemCategory) })),
  ];
  readonly filteredIngredients$ = combineLatest([
    this.ingredientService.ingredientIndex$,
    this.search.valueChanges.pipe(searchTerms(), startWith('')),
    this.category.valueChanges.pipe(startWith(this.category.value)),
  ]).pipe(
    map(([index, query, category]) => findIngredients(index, query, { category })
      .sort((a, b) => a.name.localeCompare(b.name)))
  );

  readonly ingredientGroups$ = this.filteredIngredients$.pipe(map((items) => groupIngredients(items, this.categories)
    .map((group) => ({ category: group.category, items: group.ingredients }))));

  constructor() { void this.ingredientService.ensureLoaded().catch(() => undefined); }

  retry(): void { void this.ingredientService.refresh().catch(() => undefined); }

  categoryLabel(category: IngredientCategory): string { return ingredientCategoryLabel(category); }

  openIngredient(ingredient: Ingredient): void {
    void this.router.navigate(['/ingredients', ingredient.id]);
  }
}




