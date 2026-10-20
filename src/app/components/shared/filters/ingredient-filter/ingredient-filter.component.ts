import { Component, computed, inject, input, output } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { IngredientService } from '../../../../services/ingredient.service';
import { SearchFilterComponent } from '../search-filter/search-filter.component';
import { IconComponent } from '../../icon/icon.component';
import { MIN_SEARCH_LENGTH, normalizeSearch } from '../../../../utils/search.utils';
import { findIngredients, indexIngredients } from '../../../../utils/ingredient-search.utils';

@Component({
  selector: 'app-ingredient-filter',
  standalone: true,
  imports: [ReactiveFormsModule, SearchFilterComponent, IconComponent],
  templateUrl: './ingredient-filter.component.html',
  styleUrl: './ingredient-filter.component.css',
})
export class IngredientFilterComponent {
  readonly ingredients = inject(IngredientService);
  readonly selectedIds = input<string[]>([]);
  readonly selectedIdsChange = output<string[]>();
  readonly search = new FormControl('', { nonNullable: true });
  private readonly query = toSignal(this.search.valueChanges, { initialValue: '' });
  private readonly catalog = toSignal(this.ingredients.ingredientIndex$, { initialValue: indexIngredients([]) });
  private readonly selectedSet = computed(() => new Set(this.selectedIds()));
  readonly searching = computed(() => normalizeSearch(this.query()).length >= MIN_SEARCH_LENGTH);
  readonly selected = computed(() => this.selectedIds().map(id => ({ id, name: this.catalog().byId.get(id)?.name ?? 'Ingrediente' })));
  readonly results = computed(() => this.searching() ? findIngredients(this.catalog(), this.query(), { excludedIds: this.selectedSet() }) : []);

  constructor() { void this.ingredients.ensureLoaded().catch(() => undefined); }

  add(id: string): void {
    if (!this.selectedSet().has(id)) this.selectedIdsChange.emit([...this.selectedIds(), id]);
    this.search.setValue('');
  }

  remove(id: string): void { this.selectedIdsChange.emit(this.selectedIds().filter(value => value !== id)); }

  retry(): void { void this.ingredients.refresh().catch(() => undefined); }

}
