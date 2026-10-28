import { Component, DestroyRef, HostListener, Injector, afterNextRender, computed, effect, inject, signal } from '@angular/core';
import { FormControl } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { RecipePickerComponent } from '../../components/recipe-picker/recipe-picker.component';
import { PlannerDayComponent } from '../../components/planner-day/planner-day.component';
import { RecipeCard } from '../../models/recipe-card.model';
import { InventoryPlanningSource, InventoryRecipeSelection } from '../../models/inventory-planning.model';
import { MEAL_SLOTS, MealSlot, PortionMode, RecipeSummary, ScheduledRecipe } from '../../models/scheduled-meal.model';
import { AuthService } from '../../services/auth.service';
import { NotificationService } from '../../services/notification.service';
import { ScheduledMealService } from '../../services/scheduled-meal.service';
import { PlannerStateService } from '../../services/planner-state.service';
import { calendarPeriodLabel, calendarWeek, dateNumber, dayFingerprint, localDate, shiftDate } from '../../utils/scheduled-meal.utils';

interface EditableRecipe extends ScheduledRecipe { date: string; slot: MealSlot; key: number; control: FormControl<PortionMode> }

@Component({
  selector: 'app-planner-editor-page', standalone: true,
  imports: [RecipePickerComponent, PlannerDayComponent],
  templateUrl: './planner-editor-page.component.html', styleUrl: './planner-editor-page.component.css',
})
export class PlannerEditorPageComponent {
  private readonly auth = inject(AuthService);
  private readonly meals = inject(ScheduledMealService);
  private readonly state = inject(PlannerStateService);
  private readonly notifications = inject(NotificationService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly todayOnly = this.route.snapshot.data['todayOnly'] === true;
  readonly recipeQueryParams = computed(() => ({ fromPlanner: this.todayOnly ? 'day' : 'week', plannerStart: this.todayOnly ? null : this.start() }));
  private readonly injector = inject(Injector);
  private readonly owner = this.auth.user()?.id;
  private alive = true;
  private key = 0;
  private revision = 0;
  private request: AbortController | undefined;
  private readonly savedDays = new Map<string, string>();
  private readonly requestedStart = this.route.snapshot.queryParamMap.get('start');
  readonly today = localDate();
  readonly start = signal(!this.todayOnly && this.requestedStart && Number.isFinite(dateNumber(this.requestedStart)) ? this.requestedStart : this.today);
  readonly end = computed(() => shiftDate(this.start(), this.todayOnly ? 0 : 6));
  readonly periodLabel = computed(() => calendarPeriodLabel(this.start(), this.end()));
  readonly days = computed(() => calendarWeek(this.start()).slice(0, this.todayOnly ? 1 : 7));
  readonly slots = MEAL_SLOTS;
  readonly entries = signal<EditableRecipe[]>([]);
  private readonly groupedEntries = computed(() => {
    const slots: Record<string, EditableRecipe[]> = {};
    const counts: Record<string, number> = {};
    const ids: Record<string, string[]> = {};
    for (const entry of this.entries()) {
      const key = `${entry.date}:${entry.slot}`;
      (slots[key] ??= []).push(entry);
      (ids[key] ??= []).push(entry.recipeId);
      counts[entry.date] = (counts[entry.date] ?? 0) + 1;
    }
    return { slots, counts, ids };
  });
  readonly summaries = signal<Record<string, RecipeSummary>>({});
  private readonly servings = signal<Record<string, number>>({});
  readonly dayViews = computed(() => this.days().map(day => ({ ...day,
    meals: this.slots.map(slot => ({ slot: slot.id, servings: this.mealServings(day.date, slot.id), recipes: this.forSlot(day.date, slot.id) })),
  })));
  readonly loading = signal(true);
  readonly error = signal(false);
  readonly savingDate = signal<string | null>(null);
  readonly busy = computed(() => this.savingDate() !== null);
  readonly dirtyDates = signal(new Set<string>());
  readonly dirty = computed(() => this.dirtyDates().size > 0);
  readonly activeDay = signal(0);
  readonly picker = signal<{ date: string; slot: MealSlot; label: string } | null>(null);

  constructor() {
    inject(DestroyRef).onDestroy(() => { this.alive = false; this.revision++; this.request?.abort(); });
    effect(() => {
      if (!this.auth.canEdit() || this.auth.user()?.id !== this.owner) {
        this.entries.set([]); this.summaries.set({}); this.servings.set({}); this.dirtyDates.set(new Set()); this.picker.set(null);
        void this.router.navigate(['/login']);
      }
    });
    void this.load();
  }

  private active(): boolean { return this.alive && this.auth.user()?.id === this.owner && this.auth.canEdit(); }
  private discard(): boolean { return !this.dirty() || window.confirm('Hay comidas sin guardar. ¿Quieres descartar esos cambios?'); }
  canLeave(): boolean { return !this.active() || (!this.busy() && this.discard()); }
  @HostListener('window:beforeunload', ['$event'])
  beforeUnload(event: BeforeUnloadEvent): void { if (this.dirty() || this.busy()) event.preventDefault(); }
  @HostListener('document:click', ['$event'])
  closeMenusOutside(event: MouseEvent): void {
    document.querySelectorAll<HTMLDetailsElement>('.meal-actions[open]').forEach(menu => { if (!menu.contains(event.target as Node)) menu.open = false; });
  }
  @HostListener('document:keydown.escape')
  closeMenus(): void {
    document.querySelectorAll<HTMLDetailsElement>('.meal-actions[open]').forEach(menu => { menu.open = false; menu.querySelector('summary')?.focus(); });
  }

  async load(): Promise<void> {
    const revision = ++this.revision;
    this.request?.abort();
    const request = this.request = new AbortController();
    this.loading.set(true); this.error.set(false); this.picker.set(null);
    try {
      const rows = await (this.todayOnly ? this.meals.getDay(this.start(), request.signal) : this.meals.getWeek(this.start(), request.signal));
      if (!this.active() || revision !== this.revision) return;
      const ids = [...new Set(rows.flatMap(row => row.recipes.map(recipe => recipe.recipeId)))];
      const { summaries } = await this.state.recipeData(ids, false, request.signal);
      if (!this.active() || revision !== this.revision) return;
      this.summaries.set(summaries);
      this.servings.set(Object.fromEntries(rows.map(row => [`${row.date}:${row.slot}`, row.servings])));
      this.entries.set(rows.flatMap(row => row.recipes.map(recipe => ({ ...recipe, date: row.date, slot: row.slot, key: this.key++, control: new FormControl(recipe.mode, { nonNullable: true }) }))));
      this.savedDays.clear();
      for (const day of this.days()) this.savedDays.set(day.date, dayFingerprint(this.dayMeals(day.date)));
      this.dirtyDates.set(new Set());
    } catch { if (this.active() && revision === this.revision) this.error.set(true); }
    finally { if (this.active() && revision === this.revision) this.loading.set(false); }
  }

  async moveWeek(direction: number): Promise<void> {
    if (this.todayOnly || this.busy() || this.loading() || !this.discard()) return;
    this.loading.set(true);
    this.start.set(shiftDate(this.start(), direction * 7)); this.activeDay.set(0);
    await this.router.navigate([], { relativeTo: this.route, queryParams: { start: this.start() }, queryParamsHandling: 'merge', replaceUrl: true });
    this.entries.set([]); this.summaries.set({}); this.servings.set({}); this.dirtyDates.set(new Set());
    await this.load();
  }
  goToDay(offset: number): void { this.activeDay.set(offset); document.getElementById(`scheduled-day-${offset}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  forSlot(date: string, slot: MealSlot): EditableRecipe[] { return this.groupedEntries().slots[`${date}:${slot}`] ?? []; }
  dayRecipeCount(date: string): number { return this.groupedEntries().counts[date] ?? 0; }
  recipeIdsForSlot(date: string, slot: MealSlot): string[] { return this.groupedEntries().ids[`${date}:${slot}`] ?? []; }
  mealServings(date: string, slot: MealSlot): number { return this.servings()[`${date}:${slot}`] ?? 2; }
  private dayMeals(date: string) {
    return this.slots.map(slot => ({ slot: slot.id, servings: this.mealServings(date, slot.id), recipes: this.forSlot(date, slot.id).map(entry => ({ recipeId: entry.recipeId, mode: entry.control.value,
      ...(entry.inventory ? { inventory: entry.inventory } : {}) })) }));
  }
  markDirty(date: string): void {
    const changed = dayFingerprint(this.dayMeals(date)) !== this.savedDays.get(date);
    this.dirtyDates.update(dates => { const next = new Set(dates); if (changed) next.add(date); else next.delete(date); return next; });
  }
  slotLabel(slot: MealSlot): string { return this.slots.find(item => item.id === slot)!.label; }
  choose(date: string, slot: MealSlot): void {
    if (this.busy() || this.loading() || this.forSlot(date, slot).length >= 5) return;
    const day = this.days().find(item => item.date === date);
    if (!day) return;
    document.querySelectorAll<HTMLDetailsElement>('.meal-actions[open]').forEach(menu => { menu.open = false; });
    this.activeDay.set(day.offset); this.picker.set({ date, slot, label: day.label });
  }
  closePicker(): void {
    const target = this.picker(); this.picker.set(null);
    if (target) afterNextRender(() => document.getElementById(`day-add-${target.date}`)?.focus({ preventScroll: true }), { injector: this.injector });
  }
  addFromInventory(selection: InventoryRecipeSelection): void { this.add(selection.recipe, selection.inventory); }

  add(recipe: RecipeCard, inventory?: InventoryPlanningSource): void {
    const target = this.picker();
    if (!target || this.busy() || this.forSlot(target.date, target.slot).length >= 5 || this.forSlot(target.date, target.slot).some(entry => entry.recipeId.toLowerCase() === recipe.id.toLowerCase())) return;
    this.summaries.update(rows => ({ ...rows, [recipe.id]: recipe }));
    this.state.rememberCard(recipe);
    this.entries.update(rows => [...rows, { date: target.date, slot: target.slot, recipeId: recipe.id, mode: 'scale', key: this.key++, control: new FormControl<PortionMode>('scale', { nonNullable: true }),
      ...(inventory ? { inventory: structuredClone(inventory) } : {}) }]);
    this.markDirty(target.date); this.closePicker();
    void this.saveDay(target.date);
  }
  removeEntry(entry: { key: string | number }): void {
    if (this.busy()) return;
    const current = this.entries().find(row => row.key === entry.key);
    if (!current) return;
    this.entries.update(rows => rows.filter(row => row.key !== entry.key)); this.markDirty(current.date);
  }
  async saveDay(date: string): Promise<void> {
    if (this.busy() || this.loading() || !this.dirtyDates().has(date)) return;
    let saved = false;
    this.savingDate.set(date);
    try {
      const meals = this.dayMeals(date);
      await this.meals.saveDay(date, meals);
      if (!this.active()) return;
      this.dirtyDates.update(dates => new Set([...dates].filter(day => day !== date)));
      this.savedDays.set(date, dayFingerprint(meals));
      this.notifications.success('Comidas del día guardadas.');
      saved = true;
    } catch { if (this.active()) this.notifications.error('No se pudieron guardar las comidas. Tus cambios siguen aquí para reintentar.'); }
    finally { if (this.active()) this.savingDate.set(null); }
    if (saved && this.todayOnly && this.active()) void this.router.navigate(['/planner']);
  }
}
