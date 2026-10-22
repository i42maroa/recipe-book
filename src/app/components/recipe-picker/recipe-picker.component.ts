import { DOCUMENT } from '@angular/common';
import { Component, DestroyRef, ElementRef, afterNextRender, inject, input, output, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl } from '@angular/forms';
import { skip } from 'rxjs';
import { RecipeCard } from '../../models/recipe-card.model';
import { MealType, RecipeDifficulty } from '../../models/recipe.model';
import { RecipeFilters, RecipeService } from '../../services/recipe.service';
import { controlValues, isCompleteSearch } from '../../utils/search.utils';
import { recipeFilterChanges } from '../../utils/recipe-filters.utils';
import { PlannerStateService } from '../../services/planner-state.service';
import { RecipeCardComponent } from '../recipe-card/recipe-card.component';
import { RecipeFiltersComponent } from '../shared/filters/recipe-filters/recipe-filters.component';

@Component({
  selector: 'app-recipe-picker',
  standalone: true,
  imports: [RecipeCardComponent, RecipeFiltersComponent],
  templateUrl: './recipe-picker.component.html',
  styleUrl: './recipe-picker.component.css',
})
export class RecipePickerComponent {
  readonly dayLabel = input.required<string>();
  readonly slotLabel = input.required<string>();
  readonly excludedRecipeIds = input<string[]>([]);
  readonly selected = output<RecipeCard>();
  readonly closed = output<void>();
  private readonly recipes = inject(RecipeService);
  private readonly state = inject(PlannerStateService);
  private readonly initialFilters = this.state.pickerFilters;
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  readonly search = new FormControl(this.initialFilters.search, { nonNullable: true });
  readonly sort = new FormControl(this.initialFilters.sort, { nonNullable: true });
  readonly mealType = new FormControl<MealType | ''>(this.initialFilters.mealType, { nonNullable: true });
  readonly difficulty = new FormControl<RecipeDifficulty | ''>(this.initialFilters.difficulty, { nonNullable: true });
  readonly status = new FormControl(this.initialFilters.pending, { nonNullable: true });
  readonly ingredientIds = new FormControl<string[]>(this.initialFilters.ingredientIds ?? [], { nonNullable: true });
  readonly results = signal<RecipeCard[]>([]);
  readonly loading = signal(false);
  readonly error = signal(false);
  readonly total = signal(0);
  private filters: RecipeFilters = this.initialFilters;
  private request: AbortController | undefined;
  private revision = 0;
  private offset = 0;
  private selectedOnce = false;
  private readonly previousFocus = this.document.activeElement as HTMLElement | null;

  constructor() {
    const previousOverflow = this.document.body.style.overflow;
    this.document.body.style.overflow = 'hidden';
    afterNextRender(() => this.dialog().nativeElement.showModal());
    this.destroyRef.onDestroy(() => {
      this.revision++;
      this.request?.abort();
      this.dialog().nativeElement.close();
      this.document.body.style.overflow = previousOverflow;
      if (this.previousFocus?.isConnected) this.previousFocus.focus({ preventScroll: true });
    });
    // Clear stale selectable results immediately, before the debounced search completes.
    this.search.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      this.revision++; this.request?.abort(); this.results.set([]); this.total.set(0); this.loading.set(true);
      this.state.pickerFilters = { ...this.filters, search: this.search.value.trim() };
      if (!isCompleteSearch(this.search.value)) this.loading.set(false);
    });
    recipeFilterChanges({ search: this.search, sort: this.sort, mealType: this.mealType,
      difficulty: this.difficulty, ingredientIds: this.ingredientIds,
    }, { pending: controlValues(this.status), deduplicate: false }).pipe(takeUntilDestroyed()).subscribe(filters => {
      if (this.search.value.trim() !== filters.search) return;
      this.filters = filters;
      this.state.pickerFilters = filters;
      if (!isCompleteSearch(filters.search)) { this.revision++; this.results.set([]); this.total.set(0); this.loading.set(false); return; }
      void this.load();
    });
    this.recipes.changes$.pipe(skip(1), takeUntilDestroyed()).subscribe(() => { void this.load(); });
  }

  async load(more = false): Promise<void> {
    if (!isCompleteSearch(this.search.value) || this.search.value.trim() !== this.filters.search) return;
    const revision = ++this.revision;
    this.request?.abort();
    const request = this.request = new AbortController();
    this.loading.set(true); this.error.set(false);
    if (!more) { this.offset = 0; this.results.set([]); this.total.set(0); }
    const cached = !more ? this.state.pickerPage(this.filters) : undefined;
    if (cached) {
      this.offset = cached.offset; this.results.set(cached.items); this.total.set(cached.total); this.loading.set(false);
      return;
    }
    try {
      const page = await this.recipes.getBatch(this.filters, more ? this.offset : 0, 20, request.signal);
      if (this.destroyRef.destroyed || revision !== this.revision) return;
      this.offset = page.offset + page.items.length;
      this.results.update(rows => more ? [...rows, ...page.items] : page.items);
      this.total.set(page.total);
      this.state.rememberPicker(this.filters, { items: this.results(), total: page.total, offset: this.offset });
    } catch { if (!this.destroyRef.destroyed && revision === this.revision) this.error.set(true); }
    finally { if (!this.destroyRef.destroyed && revision === this.revision) this.loading.set(false); }
  }

  select(recipe: RecipeCard): void {
    if (this.selectedOnce || this.loading() || this.isAdded(recipe.id)) return;
    this.selectedOnce = true;
    this.selected.emit(recipe);
  }

  isAdded(id: string): boolean { return this.excludedRecipeIds().some(existing => existing.toLowerCase() === id.toLowerCase()); }

  backdrop(event: MouseEvent): void {
    if (event.target !== this.dialog().nativeElement) return;
    const rect = this.dialog().nativeElement.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) this.closed.emit();
  }
}
