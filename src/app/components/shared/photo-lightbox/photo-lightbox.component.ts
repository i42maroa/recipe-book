import { Component, EventEmitter, HostListener, Input, OnChanges, Output } from '@angular/core';
import { RecipePhoto } from '../../../models/recipe.model';

@Component({
  selector: 'app-photo-lightbox',
  standalone: true,
  templateUrl: './photo-lightbox.component.html',
  styleUrl: './photo-lightbox.component.css',
})
export class PhotoLightboxComponent implements OnChanges {
  @Input() photos: RecipePhoto[] = [];
  @Input() recipeName = 'la receta';
  @Input() initialIndex = 0;
  @Output() closed = new EventEmitter<void>();
  activeIndex = 0;

  ngOnChanges(): void {
    this.activeIndex = this.photos.length ? this.initialIndex % this.photos.length : 0;
  }

  changePhoto(direction: number): void {
    if (this.photos.length) this.activeIndex = (this.activeIndex + direction + this.photos.length) % this.photos.length;
  }

  @HostListener('document:keydown.escape')
  closeOnEscape(): void { this.closed.emit(); }

  @HostListener('document:keydown.arrowleft')
  previousOnArrow(): void { this.changePhoto(-1); }

  @HostListener('document:keydown.arrowright')
  nextOnArrow(): void { this.changePhoto(1); }
}
