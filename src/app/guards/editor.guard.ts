import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const editorGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  try {
    if (await auth.refreshPermission() && auth.user()) return true;
  } catch { /* Access remains closed when session validation fails. */ }
  return router.createUrlTree(['/login']);
};
