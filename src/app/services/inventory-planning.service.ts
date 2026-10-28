import { DestroyRef, Injectable, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { InventoryPlanningLink } from '../models/inventory-planning.model';
import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';
import { ScheduledMealService } from './scheduled-meal.service';
import { dateNumber, localDate } from '../utils/scheduled-meal.utils';
import { isUuid } from '../utils/uuid.utils';

@Injectable({ providedIn: 'root' })
export class InventoryPlanningService {
  private readonly auth = inject(AuthService);
  private readonly supabase = inject(SupabaseService);
  private owner: string | undefined;
  private revision = 0;
  private request: AbortController | undefined;
  private loaded = false;
  private from = '';
  readonly links = signal<InventoryPlanningLink[]>([]);
  readonly loading = signal(false);
  readonly error = signal('');

  constructor() {
    effect(() => this.syncOwner());
    inject(ScheduledMealService).changes$.pipe(takeUntilDestroyed()).subscribe(() => {
      if (this.loaded || this.loading()) void this.load(true);
    });
    inject(DestroyRef).onDestroy(() => this.request?.abort());
  }

  private syncOwner(): string | undefined {
    const owner = this.auth.canEdit() ? this.auth.user()?.id : undefined;
    if (owner !== this.owner) {
      this.owner = owner; this.revision++; this.request?.abort(); this.request = undefined;
      this.loaded = false; this.links.set([]); this.loading.set(false); this.error.set(''); this.from = '';
    }
    return owner;
  }

  async load(force = false): Promise<void> {
    const owner = this.syncOwner(); const from = localDate();
    if (!owner || (!force && (this.loading() || (this.loaded && this.from === from)))) return;
    this.request?.abort(); const request = this.request = new AbortController(); const revision = ++this.revision;
    this.loading.set(true); this.error.set('');
    const active = (): boolean => owner === this.auth.user()?.id && this.auth.canEdit() && revision === this.revision && !request.signal.aborted;
    try {
      await this.auth.requireEditor(); if (!active()) return;
      const { data, error } = await this.supabase.requireClient().rpc('get_inventory_planning_links', { p_from: from }).abortSignal(request.signal);
      if (!active()) return;
      if (error) {
        if (['PGRST202', '42883'].includes(error.code)) throw new Error('Falta actualizar el vínculo entre Inventario y Planificación en Supabase. Aplica 20261027000400_inventory_planning.sql.');
        throw error;
      }
      if (!Array.isArray(data) || data.some(link => !link || typeof link.placeId !== 'string' || !isUuid(link.placeId)
        || typeof link.itemId !== 'string' || !isUuid(link.itemId) || typeof link.recipeId !== 'string' || !isUuid(link.recipeId)
        || typeof link.date !== 'string' || !Number.isFinite(dateNumber(link.date)) || !['breakfast', 'lunch', 'dinner'].includes(link.slot))) throw new Error('La planificación del inventario no es válida.');
      this.links.set(data); this.loaded = true; this.from = from;
    } catch (error) {
      if (active()) this.error.set(error instanceof Error ? error.message : 'No se pudo comprobar qué recetas están planificadas.');
    } finally { if (active()) this.loading.set(false); }
  }

  forItem(placeId: string, itemId: string): InventoryPlanningLink[] {
    return this.links().filter(link => link.placeId.toLowerCase() === placeId.toLowerCase() && link.itemId.toLowerCase() === itemId.toLowerCase());
  }
  isPlanned(placeId: string, itemIds: string[]): boolean {
    const ids = new Set(itemIds.map(id => id.toLowerCase()));
    return this.links().some(link => link.placeId.toLowerCase() === placeId.toLowerCase() && ids.has(link.itemId.toLowerCase()));
  }
  label(link: InventoryPlanningLink): string {
    return `${link.date.split('-').reverse().join('/')} · ${{ breakfast: 'Desayuno', lunch: 'Comida', dinner: 'Cena' }[link.slot]}`;
  }
}
