import { DOCUMENT } from '@angular/common';
import { Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { distinctUntilChanged } from 'rxjs';
import { MEAL_SLOTS, MealSlot, PortionMode, RecipeSummary, ScheduledMeal, ScheduledRecipeAddition } from '../../models/scheduled-meal.model';
import { AuthService } from '../../services/auth.service';
import { ScheduledMealService } from '../../services/scheduled-meal.service';
import { calendarWeek, dateNumber, localDate, portionSummary } from '../../utils/scheduled-meal.utils';
import { IconComponent } from '../shared/icon/icon.component';
import { PlannerDayComponent, PlannerDayMeal } from '../planner-day/planner-day.component';

@Component({
  selector: 'app-recipe-planning-dialog', standalone: true,
  imports: [ReactiveFormsModule, IconComponent, PlannerDayComponent],
  templateUrl: './recipe-planning-dialog.component.html',
  styleUrl: './recipe-planning-dialog.component.css',
})
export class RecipePlanningDialogComponent {
  readonly recipe = input.required<RecipeSummary>();
  readonly closed = output<void>();
  readonly saved = output<ScheduledRecipeAddition>();
  private readonly planning = inject(ScheduledMealService);
  private readonly auth = inject(AuthService);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('dialog');
  private readonly owner = this.auth.user()?.id;
  private request: AbortController | undefined;
  private revision = 0;
  readonly today = localDate();
  readonly date = new FormControl('', { nonNullable: true, validators: [Validators.required] });
  readonly slot = new FormControl<MealSlot | ''>('', { nonNullable: true, validators: [Validators.required] });
  readonly servings = new FormControl<number | null>(2, [Validators.required, Validators.min(1), Validators.max(100), Validators.pattern(/^\d+$/)]);
  readonly mode = new FormControl<PortionMode>('scale', { nonNullable: true });
  readonly slots = MEAL_SLOTS;
  private readonly selectedDate = toSignal(this.date.valueChanges, { initialValue: this.date.value });
  readonly selectedSlot = toSignal(this.slot.valueChanges, { initialValue: this.slot.value });
  private readonly guestCount = toSignal(this.servings.valueChanges, { initialValue: this.servings.value });
  private readonly portionMode = toSignal(this.mode.valueChanges, { initialValue: this.mode.value });
  readonly meals = signal<ScheduledMeal[]>([]);
  readonly summaries = signal<Record<string, RecipeSummary>>({});
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly loadError = signal('');
  readonly saveError = signal('');
  readonly existingMeal = computed(() => this.meals().find(meal => meal.slot === this.selectedSlot()) ?? null);
  readonly existingRecipes = computed(() => this.existingMeal()?.recipes ?? []);
  readonly alreadyPlanned = computed(() => this.existingRecipes().some(item => item.recipeId.toLowerCase() === this.recipe().id.toLowerCase()));
  readonly full = computed(() => this.existingRecipes().length >= 5);
  readonly effectiveServings = computed(() => this.existingMeal()?.servings ?? this.guestCount());
  readonly validDate = computed(() => Number.isFinite(dateNumber(this.selectedDate())) && this.selectedDate() >= this.today && this.selectedDate() >= '0001-01-01');
  readonly dayLabel = computed(() => this.validDate() ? calendarWeek(this.selectedDate())[0].label : '');
  readonly dayMeals = computed<PlannerDayMeal[]>(() => this.slots.map(slot => {
    const meal = this.meals().find(meal => meal.slot === slot.id);
    return { slot: slot.id, servings: meal?.servings ?? 2, recipes: (meal?.recipes ?? []).map(entry => ({ ...entry, key: entry.recipeId })) };
  }));
  readonly showPreparation = computed(() => this.recipe().servings !== this.effectiveServings());
  readonly portion = computed(() => portionSummary(this.recipe().servings, this.effectiveServings() ?? 0, this.portionMode()));
  readonly canAdd = computed(() => !!this.selectedSlot() && this.validDate() && !this.loading() && !this.loadError()
    && !this.saving() && !this.alreadyPlanned() && !this.full()
    && Number.isInteger(this.effectiveServings()) && (this.effectiveServings() ?? 0) >= 1 && (this.effectiveServings() ?? 0) <= 100);

  constructor() {
    const previousFocus = this.document.activeElement as HTMLElement | null;
    const previousOverflow = this.document.body.style.overflow;
    this.document.body.style.overflow = 'hidden';
    afterNextRender(() => this.dialog()?.nativeElement.showModal());
    this.destroyRef.onDestroy(() => {
      this.request?.abort(); this.dialog()?.nativeElement.close();
      this.document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    });
    effect(() => {
      if (!this.auth.canEdit() || this.auth.user()?.id !== this.owner) this.closed.emit();
    });
    effect(() => {
      const meal = this.existingMeal();
      if (meal) this.servings.setValue(meal.servings);
      this.mode.setValue('scale');
    });
    this.date.valueChanges.pipe(distinctUntilChanged(), takeUntilDestroyed())
      .subscribe(() => { this.slot.setValue(''); void this.loadDay(); });
  }

  private active(controller?: AbortController): boolean {
    return !this.destroyRef.destroyed && this.auth.canEdit() && this.auth.user()?.id === this.owner
      && (!controller || (this.request === controller && !controller.signal.aborted));
  }

  async loadDay(): Promise<void> {
    if (this.saving()) return;
    this.request?.abort(); const controller = new AbortController(); this.request = controller;
    const revision = ++this.revision;
    this.meals.set([]); this.summaries.set({}); this.loadError.set(''); this.saveError.set('');
    const date = this.date.value;
    if (!date) { this.loading.set(false); return; }
    if (!Number.isFinite(dateNumber(date)) || date < this.today || date < '0001-01-01') {
      this.loading.set(false); this.loadError.set('Elige una fecha válida a partir de hoy.'); return;
    }
    this.loading.set(true);
    try {
      const meals = await this.planning.getDay(date, controller.signal, true);
      const ids = [...new Set(meals.flatMap(meal => meal.recipes.map(item => item.recipeId)))];
      const summaries = await this.planning.recipeSummaries(ids, controller.signal);
      if (!this.active(controller) || revision !== this.revision) return;
      this.summaries.set(summaries); this.meals.set(meals);
    } catch (error) {
      if (this.active(controller)) this.loadError.set(error instanceof Error ? error.message : 'No se pudieron cargar las comidas.');
    } finally { if (this.active(controller)) this.loading.set(false); }
  }

  close(event?: Event): void {
    event?.preventDefault();
    if (!this.saving()) this.closed.emit();
  }

  chooseMeal(slot: MealSlot): void {
    if (this.loading() || this.saving() || this.loadError() || !this.validDate()) return;
    const meal = this.meals().find(meal => meal.slot === slot);
    if ((meal?.recipes.length ?? 0) >= 5 || meal?.recipes.some(entry => entry.recipeId.toLowerCase() === this.recipe().id.toLowerCase())) return;
    if (this.slot.value !== slot) {
      this.slot.setValue(slot);
      if (meal) this.servings.setValue(meal.servings);
      this.mode.setValue('scale');
    }
    this.saveError.set('');
  }

  async submit(event: Event): Promise<void> {
    event.preventDefault();
    this.servings.markAsTouched(); this.date.markAsTouched(); this.slot.markAsTouched();
    const slot = this.slot.value;
    if (!slot || !this.canAdd()) return;
    this.saving.set(true); this.saveError.set('');
    try {
      const result = await this.planning.addRecipe(this.date.value, slot, this.effectiveServings()!, this.recipe().id,
        this.showPreparation() ? this.mode.value : 'scale');
      if (this.active()) this.saved.emit(result);
    } catch (error) {
      if (this.active()) this.saveError.set(error instanceof Error ? error.message : (error as { message?: string })?.message || 'No se pudo añadir la receta. Vuelve a intentarlo.');
    } finally { if (this.active()) this.saving.set(false); }
  }
}
