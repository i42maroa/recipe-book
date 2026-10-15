import { Pipe, PipeTransform } from '@angular/core';
import { Recipe } from '../models/recipe.model';

@Pipe({ name: 'countLabel', standalone: true })
export class CountLabelPipe implements PipeTransform {
  transform(recipes: Recipe[] | null): string {
    const count = recipes?.length ?? 0;
    return `${count} ${count === 1 ? 'receta' : 'recetas'}`;
  }
}

