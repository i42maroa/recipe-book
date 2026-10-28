import { FormControl, FormGroup, Validators } from '@angular/forms';
import { IngredientBaseUnit, IngredientMeasures } from '../models/recipe.model';
import { positiveQuantity, validIngredientMeasures } from './ingredient-measures.utils';

export type IngredientMeasuresForm = FormGroup<{
  baseUnit: FormControl<IngredientBaseUnit | ''>;
  unitsEnabled: FormControl<boolean>;
  unitQuantity: FormControl<number | null>;
}>;

export function ingredientMeasuresForm(): IngredientMeasuresForm {
  return new FormGroup({
    baseUnit: new FormControl<IngredientBaseUnit | ''>('', { nonNullable: true, validators: [Validators.required] }),
    unitsEnabled: new FormControl(false, { nonNullable: true }),
    unitQuantity: new FormControl<number | null>(null),
  }, { validators: control => {
    const form = control as IngredientMeasuresForm;
    const value = form.getRawValue();
    return validIngredientMeasures(measuresFormValue(form)) && (!value.unitsEnabled || positiveQuantity(value.unitQuantity)) ? null : { measures: true };
  } });
}

export function measuresFormValue(form: IngredientMeasuresForm): IngredientMeasures {
  const value = form.getRawValue();
  return { baseUnit: value.baseUnit as IngredientBaseUnit, unitQuantity: value.unitsEnabled ? value.unitQuantity : null };
}
