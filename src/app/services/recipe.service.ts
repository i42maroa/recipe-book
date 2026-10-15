import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { Recipe } from '../models/recipe.model';

const initialRecipes: Recipe[] = [
  { id: 'r1', name: 'Tostada de aguacate y huevo', ingredientIds: ['i1', 'i2', 'i3', 'i4'], ingredientAmounts: { i1: { kind: 'specific', value: 75, unit: 'g' }, i2: { kind: 'specific', value: 1, unit: 'pieza' }, i3: { kind: 'specific', value: 40, unit: 'g' }, i4: { kind: 'specific', value: 5, unit: 'ml' } }, minutes: 15, steps: ['Tuesta el pan hasta que quede dorado.', 'Machaca el aguacate con unas gotas de limón.', 'Prepara el huevo a tu gusto y monta la tostada.'], pending: false, mealTypes: ['Desayuno'], cuisineTypes: ['Espa\u00f1ola'], rating: 9, sourceUrl: '', difficulty: 'F\u00e1cil' },
  { id: 'r2', name: 'Pasta cremosa de limón', ingredientIds: ['i5', 'i6', 'i7', 'i8'], ingredientAmounts: { i5: { kind: 'specific', value: 200, unit: 'g' }, i6: { kind: 'glass' }, i7: { kind: 'specific', value: 30, unit: 'ml' }, i8: { kind: 'spoon' } }, minutes: 25, steps: ['Cuece la pasta en agua con sal.', 'Mezcla la nata con ralladura y zumo de limón.', 'Añade parmesano y sirve con pimienta.'], pending: false, mealTypes: ['Plato'], cuisineTypes: ['Italiana'], rating: 8, sourceUrl: '', difficulty: 'Media' },
  { id: 'r3', name: 'Ensalada de garbanzos', ingredientIds: ['i9', 'i10', 'i11'], ingredientAmounts: { i9: { kind: 'specific', value: 240, unit: 'g' }, i10: { kind: 'specific', value: 100, unit: 'g' }, i11: { kind: 'specific', value: 80, unit: 'g' } }, minutes: 12, steps: ['Enjuaga y escurre los garbanzos.', 'Corta el tomate y el pepino en dados.', 'Aliña y mezcla todos los ingredientes.'], pending: true, mealTypes: ['Entrante', 'Plato'], cuisineTypes: ['Mediterr\u00e1nea'], rating: null, sourceUrl: '', fitness: true, difficulty: 'F\u00e1cil' },
  { id: 'r4', name: 'Tortitas de plátano', ingredientIds: ['i12', 'i13', 'i2'], ingredientAmounts: { i12: { kind: 'specific', value: 120, unit: 'g' }, i13: { kind: 'specific', value: 80, unit: 'g' }, i2: { kind: 'specific', value: 1, unit: 'pieza' } }, minutes: 20, steps: ['Tritura el plátano con el huevo.', 'Incorpora la avena hasta tener una masa suave.', 'Cocina pequeñas tortitas en una sartén.'], pending: true, mealTypes: ['Desayuno', 'Postre'], cuisineTypes: ['Americana'], rating: null, sourceUrl: '', difficulty: 'F\u00e1cil' },
  { id: 'r5', name: 'Crema de calabaza', ingredientIds: ['i15', 'i16', 'i17'], ingredientAmounts: { i15: { kind: 'specific', value: 500, unit: 'g' }, i16: { kind: 'specific', value: 1, unit: 'g' }, i17: { kind: 'glass' } }, minutes: 35, steps: ['Trocea la calabaza y la cebolla.', 'Cuece con caldo hasta que esté tierna.', 'Tritura y termina con un chorrito de aceite.'], pending: false, mealTypes: ['Entrante'], cuisineTypes: ['Espa\u00f1ola', 'Mediterr\u00e1nea'], rating: 10, sourceUrl: '', difficulty: 'Media' },
  { id: 'r6', name: 'Salmón con miel y soja', ingredientIds: ['i18', 'i19', 'i20'], ingredientAmounts: { i18: { kind: 'specific', value: 2, unit: 'g' }, i19: { kind: 'spoon' }, i20: { kind: 'spoon' } }, minutes: 22, steps: ['Mezcla la miel con la salsa de soja.', 'Pinta el salmón con la mezcla.', 'Hornea hasta que quede jugoso.'], pending: true, mealTypes: ['Plato'], cuisineTypes: ['Japonesa'], rating: null, sourceUrl: '', difficulty: 'F\u00e1cil' }
];

@Injectable({ providedIn: 'root' })
export class RecipeService {
  private readonly recipesSubject = new BehaviorSubject<Recipe[]>(initialRecipes);
  readonly recipes$ = this.recipesSubject.asObservable();

  create(recipe: Omit<Recipe, 'id'>): void {
    this.recipesSubject.next([{ ...recipe, id: crypto.randomUUID() }, ...this.recipesSubject.value]);
  }

  update(id: string, recipe: Omit<Recipe, 'id'>): void {
    this.recipesSubject.next(this.recipesSubject.value.map((item) => item.id === id ? { ...recipe, id } : item));
  }

  remove(id: string): void {
    this.recipesSubject.next(this.recipesSubject.value.filter((recipe) => recipe.id !== id));
  }

  getById(id: string): Recipe | undefined {
    return this.recipesSubject.value.find((recipe) => recipe.id === id);
  }

  usesIngredient(id: string): boolean {
    return this.recipesSubject.value.some((recipe) => recipe.ingredientIds.includes(id));
  }
}



