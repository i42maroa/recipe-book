import { Pipe, PipeTransform } from '@angular/core';
import { RecipeDifficulty } from '../models/recipe.model';

@Pipe({ name: 'difficultyTone', standalone: true })
export class DifficultyTonePipe implements PipeTransform {
  transform(difficulty: RecipeDifficulty | null | undefined): 'easy' | 'medium' | 'hard' {
    if (difficulty === 'Fácil') return 'easy';
    if (difficulty === 'Difícil') return 'hard';
    return 'medium';
  }
}
