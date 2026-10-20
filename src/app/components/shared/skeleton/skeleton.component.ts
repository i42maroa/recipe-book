import { Component, input } from '@angular/core';

type SkeletonVariant = 'text' | 'title' | 'avatar' | 'hero' | 'recipe-card' | 'ingredient-card' | 'rows' | 'paragraph';

@Component({
  selector: 'app-skeleton',
  standalone: true,
  templateUrl: './skeleton.component.html',
  styleUrl: './skeleton.component.css',
  host: { 'aria-hidden': 'true' },
})
export class SkeletonComponent {
  readonly variant = input<SkeletonVariant>('text');
}
