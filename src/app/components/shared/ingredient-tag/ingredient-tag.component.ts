import { Component, input, output } from '@angular/core';
import { IconComponent } from '../icon/icon.component';

@Component({
  selector: 'app-ingredient-tag',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './ingredient-tag.component.html',
  styleUrl: './ingredient-tag.component.css',
})
export class IngredientTagComponent {
  readonly name = input.required<string>();
  readonly removable = input(false);
  readonly removed = output<void>();
}
