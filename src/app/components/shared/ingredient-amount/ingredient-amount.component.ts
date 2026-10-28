import { ChangeDetectorRef, Component, forwardRef, inject, input, signal } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { Ingredient, RecipeIngredientAmount } from '../../../models/recipe.model';
import { ingredientAmountLabel, ingredientBaseUnit, measuredAmount, positiveQuantity } from '../../../utils/ingredient-measures.utils';

@Component({
  selector: 'app-ingredient-amount', standalone: true,
  templateUrl: './ingredient-amount.component.html', styleUrl: './ingredient-amount.component.css',
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => IngredientAmountComponent), multi: true }],
})
export class IngredientAmountComponent implements ControlValueAccessor {
  readonly ingredient = input<Ingredient | undefined>();
  readonly amount = signal<RecipeIngredientAmount | null>(null);
  readonly disabled = signal(false);
  readonly baseUnit = ingredientBaseUnit;
  private readonly changes = inject(ChangeDetectorRef);
  private onChange: (amount: RecipeIngredientAmount | null) => void = () => undefined;
  private onTouched: () => void = () => undefined;
  writeValue(value: RecipeIngredientAmount | null): void { this.amount.set(value); this.changes.markForCheck(); }
  registerOnChange(fn: (amount: RecipeIngredientAmount | null) => void): void { this.onChange = fn; }
  registerOnTouched(fn: () => void): void { this.onTouched = fn; }
  setDisabledState(value: boolean): void { this.disabled.set(value); this.changes.markForCheck(); }
  touch(): void { this.onTouched(); }
  choice(): string { const amount = this.amount(); return amount?.kind === 'specific' ? amount.unit : amount?.kind ?? 'none'; }
  value(): number | null { const amount = this.amount(); return amount?.kind === 'specific' ? amount.value : amount?.kind === 'spoon' ? amount.value === undefined ? 1 : amount.value : null; }
  units(): { value: string; label: string; legacy?: boolean }[] {
    const ingredient = this.ingredient();
    const options = [{ value: 'none', label: 'Sin cantidad' }, ...(ingredient
      ? [{ value: ingredientBaseUnit(ingredient), label: ingredientBaseUnit(ingredient) === 'g' ? 'Gramos (g)' : 'Mililitros (ml)' }]
      : [{ value: 'g', label: 'Gramos (g)' }, { value: 'ml', label: 'Mililitros (ml)' }])];
    if (!ingredient || positiveQuantity(ingredient.unitQuantity)) options.push({ value: 'pieza', label: 'Unidades' });
    if (ingredient?.category === 'Especia') options.push({ value: 'spoon', label: 'Cucharadas (5 g)' });
    if (!options.some(option => option.value === this.choice())) return [...options, { value: this.choice(), label: `${this.choice() === 'glass' ? 'Vaso' : this.choice() === 'spoon' ? 'Cucharada' : this.choice() === 'pieza' ? 'Unidades' : this.choice()} (guardado)`, legacy: true }];
    return options;
  }
  select(unit: string): void {
    if (this.disabled()) return;
    const amount = unit === 'none' ? null : measuredAmount(unit as 'g' | 'ml' | 'pieza' | 'spoon', this.value(), this.ingredient(), this.amount());
    this.publish(amount);
  }
  changeValue(raw: string): void {
    if (this.disabled()) return;
    const value = raw === '' ? null : Number(raw);
    this.publish(measuredAmount(this.choice() as 'g' | 'ml' | 'pieza' | 'spoon', value, this.ingredient(), this.amount()));
  }
  equivalent(): string | null { return ingredientAmountLabel(this.amount(), true, this.ingredient()); }
  private publish(amount: RecipeIngredientAmount | null): void { this.amount.set(amount); this.onChange(amount); this.onTouched(); }
}
