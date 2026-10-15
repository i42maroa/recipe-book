import { AsyncPipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { combineLatest, map, startWith } from 'rxjs';
import { Ingredient, IngredientCategory } from '../../models/recipe.model';
import { IngredientService } from '../../services/ingredient.service';
import { ButtonComponent } from '../../components/shared/button/button.component';
import { FormService } from '../../services/form.service';
import { FilterContainerComponent } from '../../components/shared/filters/filter-container/filter-container.component';
import { SelectFilterComponent } from '../../components/shared/filters/select-filter/select-filter.component';
import { SearchFilterComponent } from '../../components/shared/filters/search-filter/search-filter.component';
import { SelectFilterOption } from '../../components/shared/filters/select-filter-options';
import { IngredientCardComponent } from '../../components/ingredient-card/ingredient-card.component';


@Component({
  selector: 'app-ingredients-page', standalone: true, imports: [AsyncPipe, ReactiveFormsModule, ButtonComponent, FilterContainerComponent, SelectFilterComponent, SearchFilterComponent, IngredientCardComponent],
  templateUrl: './ingredients-page.component.html',
  styleUrl: './ingredients-page.component.css'
})
export class IngredientsPageComponent {
  readonly forms = inject(FormService);
  private readonly ingredientService = inject(IngredientService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  readonly search = this.fb.nonNullable.control('');
  readonly category = this.fb.nonNullable.control<IngredientCategory | ''>('');
  readonly categories: IngredientCategory[] = ['Verdura', 'Fruta', 'Legumbre', 'Pescado', 'Carne', 'Lacteo', 'Cereal', 'Especia', 'Elaboracion', 'Otro'];
  readonly categoryOptions: SelectFilterOption[] = [
    { value: '', label: 'Todos los tipos' },
    ...this.categories.map((itemCategory) => ({ value: itemCategory, label: itemCategory })),
  ];
  readonly filteredIngredients$ = combineLatest([
    this.ingredientService.ingredients$,
    this.search.valueChanges.pipe(startWith('')),
    this.category.valueChanges.pipe(startWith('')),
  ]).pipe(
    map(([items, query, category]) => [...items]
      .filter((item) => item.name.toLowerCase().includes(query.toLowerCase().trim()) && (!category || item.category === category))
      .sort((a, b) => a.name.localeCompare(b.name)))
  );

  readonly ingredientGroups$ = this.filteredIngredients$.pipe(map((items) => this.categories
    .map((category) => ({ category, items: items.filter((ingredient) => ingredient.category === category) }))
    .filter((group) => group.items.length > 0)));

  categoryLabel(category: IngredientCategory): string {
    if (category === 'Lacteo') return 'Lácteo';
    if (category === 'Elaboracion') return 'Elaboración';
    return category;
  }

  openIngredient(ingredient: Ingredient): void {
    void this.router.navigate(['/ingredients', ingredient.id]);
  }
}




