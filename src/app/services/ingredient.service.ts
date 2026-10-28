import { LoadingService } from './loading.service';
import { AuthService } from './auth.service';
import { Injectable, inject, signal } from '@angular/core';
import { BehaviorSubject, map } from 'rxjs';
import { Ingredient, IngredientCategory, IngredientMeasures } from '../models/recipe.model';
import { validIngredientMeasures } from '../utils/ingredient-measures.utils';
import { NotificationService } from './notification.service';
import { IngredientRow } from '../models/database.model';
import { mapIngredientAmounts } from '../utils/ingredient-amount.utils';
import { SupabaseService } from './supabase.service';
import { indexIngredients } from '../utils/ingredient-search.utils';

const CATALOG_SELECT = 'id,name,category,base_unit,unit_quantity';
const DETAIL_SELECT = `${CATALOG_SELECT},ingredient_components!ingredient_components_parent_ingredient_id_fkey(component_ingredient_id,amount_kind,amount_value,amount_unit,amount_base_unit,amount_unit_quantity)`;
type CatalogRow = Pick<IngredientRow, 'id' | 'name' | 'category' | 'base_unit' | 'unit_quantity'>;
const mapMeasures = (row: CatalogRow): IngredientMeasures => ({ baseUnit: row.base_unit ?? (row.category === 'Liquidos' ? 'ml' : 'g'), unitQuantity: row.unit_quantity == null ? null : Number(row.unit_quantity) });

@Injectable({ providedIn: 'root' })
export class IngredientService {
  readonly loading = inject(LoadingService);
  readonly error = signal(false);
  readonly loaded = signal(false);
  private readonly auth = inject(AuthService);
  private readonly indexSubject = new BehaviorSubject(indexIngredients([]));
  readonly ingredientIndex$ = this.indexSubject.asObservable();
  readonly ingredients$ = this.ingredientIndex$.pipe(map(index => index.ingredients));
  private revision = 0;
  private catalogRequest: Promise<void> | undefined;
  private readonly catalogWrites = new Map<string, Ingredient>();
  private readonly detailRequests = new Map<string, { revision: number; promise: Promise<Ingredient | null> }>();
  constructor(private readonly supabase: SupabaseService, private readonly notifications: NotificationService) {}

  ensureLoaded(): Promise<void> {
    if (this.catalogRequest) return this.catalogRequest;
    return this.loaded() && !this.error() ? Promise.resolve() : this.refresh();
  }

  refresh(): Promise<void> {
    if (this.catalogRequest) return this.catalogRequest;
    this.revision++;
    this.error.set(false);
    const promise = this.loading.run(() => this.fetchCatalog(), 'ingredients')
      .then(() => { this.loaded.set(true); })
      .catch(error => { this.error.set(true); throw error; })
      .finally(() => {
        if (this.catalogRequest === promise) { this.catalogRequest = undefined; this.catalogWrites.clear(); }
      });
    this.catalogRequest = promise;
    return promise;
  }

  private async fetchCatalog(): Promise<void> {
    // Publish only complete catalogs, so forms never prune IDs from partial pages.
    for (;;) {
      const revision = this.revision;
      const items = new Map<string, Ingredient>();
      let offset = 0;
      let total: number | null = null;
      for (;;) {
        const { data, count, error } = await this.supabase.requireClient().from('ingredients')
          .select(CATALOG_SELECT, offset === 0 ? { count: 'exact' } : undefined)
          .order('id').range(offset, offset + 199).returns<CatalogRow[]>();
        if (revision !== this.revision) break;
        if (error) throw error;
        if (offset === 0) total = count;
        const rows = data ?? [];
        for (const row of rows) items.set(row.id, { id: row.id, name: row.name, category: row.category, ...mapMeasures(row) });
        offset += rows.length;
        if (!rows.length && total !== null && offset < total) throw new Error('Los ingredientes han cambiado durante la consulta. Reintenta.');
        // Use the actual response size: project limits can be smaller than 200.
        if (!rows.length || (total !== null && offset >= total)) break;
      }
      if (revision !== this.revision) continue;
      for (const [id, ingredient] of this.catalogWrites) items.set(id, ingredient);
      this.catalogWrites.clear();
      this.publish([...items.values()]);
      return;
    }
  }

  async ensureDetails(id: string): Promise<Ingredient | null> {
    await this.ensureLoaded();
    const cached = this.getById(id);
    if (cached?.derivedFromIds !== undefined) return cached;
    const revision = this.revision;
    const existing = this.detailRequests.get(id);
    if (existing?.revision === revision) return existing.promise;
    const promise = this.loading.run(async () => {
      const { data, error } = await this.supabase.requireClient().from('ingredients')
        .select(DETAIL_SELECT).eq('id', id).returns<IngredientRow[]>().maybeSingle();
      if (revision !== this.revision) return this.ensureDetails(id);
      if (error) { this.error.set(true); throw error; }
      const components = data?.ingredient_components ?? [];
      const ingredient: Ingredient | null = data ? { id: data.id, name: data.name, category: data.category, ...mapMeasures(data),
        derivedFromIds: components.map(component => component.component_ingredient_id),
        derivedFromAmounts: mapIngredientAmounts(components, component => component.component_ingredient_id),
      } : null;
      const others = this.indexSubject.value.ingredients.filter(item => item.id !== id);
      this.publish(ingredient ? [...others, ingredient] : others);
      return ingredient;
    }, 'ingredients');
    this.detailRequests.set(id, { revision, promise });
    try { return await promise; }
    finally { if (this.detailRequests.get(id)?.promise === promise) this.detailRequests.delete(id); }
  }

  private publish(ingredients: Ingredient[]): void {
    this.indexSubject.next(indexIngredients(ingredients.sort((a, b) => a.name.localeCompare(b.name, 'es'))));
  }

  private remember(ingredient: Ingredient): void {
    if (this.catalogRequest) this.catalogWrites.set(ingredient.id, ingredient);
    this.publish([...this.indexSubject.value.ingredients.filter(item => item.id !== ingredient.id), ingredient]);
  }
  async add(name: string, category: IngredientCategory, derivedFromIds: string[] = [], derivedFromAmounts: Ingredient['derivedFromAmounts'] = {}, measures?: IngredientMeasures): Promise<Ingredient> {
    this.validateMeasures(measures, category);
    await this.auth.requireEditor();
    const id = crypto.randomUUID();
    const ingredient: Ingredient = { id, name: name.trim(), category, derivedFromIds, derivedFromAmounts, ...measures };
    const { error } = await this.supabase.requireClient().rpc('save_ingredient', { p_id: id, p_name: ingredient.name, p_category: category, p_components: this.components(ingredient), p_base_unit: measures!.baseUnit, p_unit_quantity: measures!.unitQuantity });
    if (error) throw error;
    this.revision++;
    this.remember(ingredient);
    return ingredient;
  }
  getById(id: string): Ingredient | undefined { return this.indexSubject.value.byId.get(id); }
  async update(id: string, changes: Pick<Ingredient, 'name' | 'category' | 'derivedFromIds' | 'derivedFromAmounts' | 'baseUnit' | 'unitQuantity'>): Promise<void> {
    const ingredient = structuredClone({ id, ...changes, name: changes.name.trim() });
    this.validateMeasures(ingredient, ingredient.category);
    await this.auth.requireEditor();
    const { error } = await this.supabase.requireClient().rpc('save_ingredient', { p_id: id, p_name: ingredient.name, p_category: ingredient.category, p_components: this.components(ingredient), p_base_unit: ingredient.baseUnit, p_unit_quantity: ingredient.unitQuantity });
    if (error) throw error;
    this.revision++;
    this.remember(ingredient);
  }
  private components(ingredient: Ingredient): object[] { return (ingredient.derivedFromIds ?? []).map((componentId) => ({ ingredient_id: componentId, ...(ingredient.derivedFromAmounts?.[componentId] ?? { kind: 'none' }) })); }
  private validateMeasures(measures: unknown, category: IngredientCategory): void {
    if (!validIngredientMeasures(measures) || (category === 'Especia' && measures.baseUnit !== 'g')) throw new Error('Selecciona gramos o mililitros e indica una equivalencia positiva si permites unidades. Las especias utilizan gramos.');
  }
  async remove(id: string): Promise<boolean> {
    try {
      await this.auth.requireEditor();
      const { error } = await this.supabase.requireClient().from('ingredients').delete().eq('id', id);
      if (error) throw error;
      this.revision++;
      this.catalogWrites.delete(id);
      this.publish(this.indexSubject.value.ingredients.filter((item) => item.id !== id));
      this.notifications.success('Ingrediente eliminado.'); return true;
    } catch (error) {
      this.notifications.error(error instanceof Error ? error.message : 'No se pudo eliminar: puede estar asociado a una receta o elaboración.'); return false;
    }
  }
}
