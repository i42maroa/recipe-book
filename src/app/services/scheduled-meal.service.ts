import { Injectable, effect, inject } from '@angular/core';
import { Subject } from 'rxjs';
import { MealSelection, RecipeSummary, ScheduledMeal } from '../models/scheduled-meal.model';
import { calendarWeek, dateNumber, shiftDate, validateDay } from '../utils/scheduled-meal.utils';
import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class ScheduledMealService {
  private readonly changesSubject = new Subject<void>();
  readonly changes$ = this.changesSubject.asObservable();
  private readonly auth = inject(AuthService);
  private readonly supabase = inject(SupabaseService);
  private cacheOwner: string | undefined;
  private generation = 0;
  private readonly days = new Map<string, { meals: ScheduledMeal[]; expires: number }>();

  constructor() { effect(() => { this.syncOwner(); }); }

  private syncOwner(): string | undefined {
    const owner = this.auth.canEdit() ? this.auth.user()?.id : undefined;
    if (owner !== this.cacheOwner) { this.days.clear(); this.generation++; this.cacheOwner = owner; }
    return owner;
  }
  private remember(date: string, meals: ScheduledMeal[]): void {
    this.days.delete(date);
    this.days.set(date, { meals: structuredClone(meals), expires: Date.now() + 300_000 });
    while (this.days.size > 56) this.days.delete(this.days.keys().next().value!);
  }

  getWeek(start: string, signal?: AbortSignal): Promise<ScheduledMeal[]> {
    if (!Number.isFinite(dateNumber(start))) return Promise.reject(new Error('La fecha no es válida.'));
    return this.getRange(start, shiftDate(start, 6), signal);
  }

  getDay(date: string, signal?: AbortSignal): Promise<ScheduledMeal[]> { return this.getRange(date, date, signal); }

  private async getRange(start: string, end: string, signal?: AbortSignal): Promise<ScheduledMeal[]> {
    if (!Number.isFinite(dateNumber(start)) || !Number.isFinite(dateNumber(end))) throw new Error('La fecha no es válida.');
    await this.auth.requireEditor();
    const owner = this.auth.user()!.id;
    this.syncOwner();
    const generation = this.generation;
    signal?.throwIfAborted();
    const dates = calendarWeek(start).map(day => day.date).filter(date => date <= end);
    if (dates.every(date => (this.days.get(date)?.expires ?? 0) > Date.now())) {
      return structuredClone(dates.flatMap(date => this.days.get(date)!.meals));
    }
    let query = this.supabase.requireClient().from('scheduled_meals')
      .select('meal_date,slot,servings,recipes').eq('owner_id', owner).gte('meal_date', start).lte('meal_date', end)
      .order('meal_date').order('slot');
    if (signal) query = query.abortSignal(signal);
    const { data, error } = await query.returns<{ meal_date: string; slot: ScheduledMeal['slot']; servings: number; recipes: ScheduledMeal['recipes'] }[]>();
    if (error) throw error;
    if (this.auth.user()?.id !== owner || !this.auth.canEdit()) throw new Error('La sesión ha cambiado.');
    signal?.throwIfAborted();
    const meals = (data ?? []).map(row => ({ date: row.meal_date, slot: row.slot, servings: row.servings, recipes: row.recipes }));
    if (generation === this.generation) for (const date of dates) this.remember(date, meals.filter(meal => meal.date === date));
    return meals;
  }

  async saveDay(date: string, meals: MealSelection[]): Promise<void> {
    const validation = validateDay(date, meals);
    if (validation) throw new Error(validation);
    await this.auth.requireEditor();
    const owner = this.auth.user()!.id;
    this.syncOwner();
    // Discard in-flight reads from before this write as well as cached old data.
    this.generation++;
    this.days.delete(date);
    this.changesSubject.next();
    const { error } = await this.supabase.requireClient().rpc('save_scheduled_day', { p_date: date, p_meals: meals });
    if (error) throw error;
    if (this.auth.user()?.id !== owner || !this.auth.canEdit()) throw new Error('La sesión ha cambiado.');
    this.changesSubject.next();
    this.remember(date, meals.filter(meal => meal.recipes.length).map(meal => ({ ...meal, date })));
  }

  async recipeSummaries(ids: string[], signal?: AbortSignal): Promise<Record<string, RecipeSummary>> {
    const result: Record<string, RecipeSummary> = {};
    for (let offset = 0; offset < ids.length; offset += 100) {
      signal?.throwIfAborted();
      let query = this.supabase.requireClient().from('recipes').select('id,name,servings,meal_types,pending')
        .in('id', ids.slice(offset, offset + 100));
      if (signal) query = query.abortSignal(signal);
      const { data, error } = await query.returns<(Omit<RecipeSummary, 'mealTypes'> & { meal_types: RecipeSummary['mealTypes'] | null })[]>();
      if (error) throw error;
      for (const row of data ?? []) result[row.id] = { id: row.id, name: row.name, servings: row.servings, mealTypes: row.meal_types ?? [], pending: row.pending };
    }
    return result;
  }
}
