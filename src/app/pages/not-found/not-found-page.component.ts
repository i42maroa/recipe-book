import { Component, DestroyRef, OnInit, inject, input } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { IconComponent } from '../../components/shared/icon/icon.component';

@Component({
  selector: 'app-not-found-page',
  standalone: true,
  imports: [RouterLink, IconComponent],
  templateUrl: './not-found-page.component.html',
  styleUrl: './not-found-page.component.css',
})
export class NotFoundPageComponent implements OnInit {
  readonly resource = input<'page' | 'recipe' | 'ingredient'>('page');
  private readonly meta = inject(Meta);
  private readonly title = inject(Title);
  private readonly destroyRef = inject(DestroyRef);

  get heading(): string {
    if (this.resource() === 'recipe') return 'No encontramos esa receta';
    if (this.resource() === 'ingredient') return 'No encontramos ese ingrediente';
    return 'Esta página no está en el recetario';
  }

  get description(): string {
    if (this.resource() === 'recipe') return 'Puede que se haya eliminado o que el enlace no sea correcto. Hay más recetas esperando por ti.';
    if (this.resource() === 'ingredient') return 'Puede que se haya eliminado o que el enlace no sea correcto. Puedes consultar el resto de tu despensa.';
    return 'El enlace puede estar incompleto o la página ya no existe. Volvamos a la colección para encontrar algo rico.';
  }

  ngOnInit(): void {
    const previous = this.meta.getTag('name="robots"')?.content ?? 'index, follow';
    const previousTitle = this.title.getTitle();
    this.title.setTitle('Página no encontrada | Laurel');
    this.meta.updateTag({ name: 'robots', content: 'noindex, nofollow' });
    this.destroyRef.onDestroy(() => {
      this.meta.updateTag({ name: 'robots', content: previous });
      this.title.setTitle(previousTitle);
    });
  }
}
