import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { Ingredient, IngredientCategory } from '../models/recipe.model';
import { NotificationService } from './notification.service';
import { RecipeService } from './recipe.service';

const initialIngredients: Ingredient[] = [
  { id: 'i1', name: 'Aguacate', category: 'Fruta' }, { id: 'i2', name: 'Huevo', category: 'Otro' }, { id: 'i3', name: 'Pan de masa madre', category: 'Cereal' }, { id: 'i4', name: 'Limón', category: 'Fruta' },
  { id: 'i5', name: 'Pasta', category: 'Cereal' }, { id: 'i6', name: 'Nata', category: 'Lacteo' }, { id: 'i7', name: 'Parmesano', category: 'Lacteo' }, { id: 'i8', name: 'Pimienta', category: 'Especia' },
  { id: 'i9', name: 'Garbanzos', category: 'Legumbre' }, { id: 'i10', name: 'Tomate', category: 'Verdura' }, { id: 'i11', name: 'Pepino', category: 'Verdura' }, { id: 'i12', name: 'Plátano', category: 'Fruta' },
  { id: 'i13', name: 'Avena', category: 'Cereal' }, { id: 'i15', name: 'Calabaza', category: 'Verdura' }, { id: 'i16', name: 'Cebolla', category: 'Verdura' }, { id: 'i17', name: 'Caldo', category: 'Otro' },
  { id: 'i18', name: 'Salmón', category: 'Pescado' }, { id: 'i19', name: 'Miel', category: 'Otro' }, { id: 'i20', name: 'Salsa de soja', category: 'Otro' },
  { id: 'i21', name: 'Harina', category: 'Cereal' }, { id: 'i22', name: 'Mantequilla', category: 'Lacteo' }, { id: 'i23', name: 'Leche', category: 'Lacteo' },
  { id: 'i24', name: 'Bechamel', category: 'Elaboracion', derivedFromIds: ['i21', 'i22', 'i23'], derivedFromAmounts: { i21: { kind: 'specific', value: 50, unit: 'g' }, i22: { kind: 'specific', value: 50, unit: 'g' }, i23: { kind: 'specific', value: 500, unit: 'ml' } } }
];

@Injectable({ providedIn: 'root' })
export class IngredientService {
  private readonly ingredientsSubject = new BehaviorSubject<Ingredient[]>(initialIngredients);
  readonly ingredients$ = this.ingredientsSubject.asObservable();

  constructor(private readonly recipes: RecipeService, private readonly notifications: NotificationService) {}

  add(name: string, category: IngredientCategory, derivedFromIds: string[] = [], derivedFromAmounts: Ingredient['derivedFromAmounts'] = {}): Ingredient {
    const ingredient = { id: crypto.randomUUID(), name: name.trim(), category, derivedFromIds, derivedFromAmounts };
    this.ingredientsSubject.next([...this.ingredientsSubject.value, ingredient]);
    return ingredient;
  }

  getById(id: string): Ingredient | undefined {
    return this.ingredientsSubject.value.find((ingredient) => ingredient.id === id);
  }

  update(id: string, changes: Pick<Ingredient, 'name' | 'category' | 'derivedFromIds' | 'derivedFromAmounts'>): void {
    this.ingredientsSubject.next(this.ingredientsSubject.value.map((ingredient) => ingredient.id === id ? { ...ingredient, ...changes, name: changes.name.trim() } : ingredient));
  }

  isUsed(id: string): boolean {
    return this.recipes.usesIngredient(id)
      || this.ingredientsSubject.value.some((ingredient) => ingredient.derivedFromIds?.includes(id));
  }

  remove(id: string): boolean {
    if (this.isUsed(id)) {
      this.notifications.error('Este ingrediente est\u00e1 en uso en una receta o elaboraci\u00f3n y no se puede eliminar.');
      return false;
    }
    this.ingredientsSubject.next(this.ingredientsSubject.value.filter((item) => item.id !== id));
    this.notifications.success('Ingrediente eliminado.');
    return true;
  }
}

