import { Component, input, output } from '@angular/core';
import { IngredientIconComponent } from '../shared/ingredient-icon/ingredient-icon.component';
import { Ingredient } from '../../models/recipe.model';

@Component({
  selector: 'app-ingredient-card',
  standalone: true,
  imports: [IngredientIconComponent],
  templateUrl: './ingredient-card.component.html',
  styleUrl: './ingredient-card.component.css',
})
export class IngredientCardComponent {
  readonly ingredient = input.required<Ingredient>();
  readonly selected = output<Ingredient>();

}
