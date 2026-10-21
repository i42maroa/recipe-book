import { Component, input } from '@angular/core';
import { IngredientCategory } from '../../../models/recipe.model';

@Component({
  selector: 'app-ingredient-icon',
  standalone: true,
  templateUrl: './ingredient-icon.component.html',
  styleUrl: './ingredient-icon.component.css',
})
export class IngredientIconComponent {
  readonly category = input.required<IngredientCategory>();

  iconUrl(): string {
    const iconByCategory: Record<IngredientCategory, string> = {
      Verdura: 'vegetable',
      Fruta: 'fruit',
      Legumbre: 'legume',
      Pescado: 'fish',
      Carne: 'meat',
      Lacteo: 'dairy',
      Cereal: 'grain',
      Liquidos: 'liquid',
      FrutosSecos: 'nuts',
      Especia: 'spice',
      Elaboracion: 'preparation',
      Otro: 'other',
    };
    return `/assets/icons/ingredients/${iconByCategory[this.category()]}.svg`;
  }
}
