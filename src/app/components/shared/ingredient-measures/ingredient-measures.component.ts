import { Component, Input, OnChanges } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { IngredientCategory } from '../../../models/recipe.model';
import { IngredientMeasuresForm } from '../../../utils/ingredient-measures-form.utils';

@Component({
  selector: 'app-ingredient-measures', standalone: true, imports: [ReactiveFormsModule],
  templateUrl: './ingredient-measures.component.html', styleUrl: './ingredient-measures.component.css',
})
export class IngredientMeasuresComponent implements OnChanges {
  @Input({ required: true }) form!: IngredientMeasuresForm;
  @Input() category: IngredientCategory | '' = '';
  ngOnChanges(): void {
    if (this.category === 'Especia') this.form.controls.baseUnit.setValue('g');
  }
}
