import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Meta } from '@angular/platform-browser';
import { NavigationEnd, Router } from '@angular/router';
import { filter, startWith } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class PageMetadataService {
  constructor() {
    const router = inject(Router);
    const meta = inject(Meta);
    const document = inject(DOCUMENT);
    router.events.pipe(
      filter((event) => event instanceof NavigationEnd), startWith(null), takeUntilDestroyed(),
    ).subscribe(() => {
      const segments = router.parseUrl(router.url).root.children['primary']?.segments ?? [];
      const path = segments.length ? `/${segments.map((segment) => encodeURIComponent(segment.path)).join('/')}` : '/recipes';
      const url = new URL(path, environment.publicSiteUrl).href;
      // Only the URL changes: the shared title, description and image stay static.
      meta.updateTag({ property: 'og:url', content: url });
      const notFound = router.routerState.snapshot.root.firstChild?.routeConfig?.path === '**';
      meta.updateTag({ name: 'robots', content: path === '/login' || path === '/shopping' || path === '/planner' || path.startsWith('/planner/') || notFound ? 'noindex, nofollow' : 'index, follow' });
      let canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
      if (!canonical) {
        canonical = document.createElement('link');
        canonical.rel = 'canonical';
        document.head.appendChild(canonical);
      }
      canonical.href = url;
    });
  }
}
