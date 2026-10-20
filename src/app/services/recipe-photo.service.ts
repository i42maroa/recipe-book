import { AuthService } from './auth.service';
import { Injectable, inject } from '@angular/core';
import { RecipePhoto } from '../models/recipe.model';
import { SupabaseService } from './supabase.service';
import { NotificationService } from './notification.service';

const BUCKET = 'recipe-photos';
const MAX_PHOTOS = 3;

export interface RecipePhotoChanges {
  originalPhotos: RecipePhoto[];
  retainedPhotos: RecipePhoto[];
  files: File[];
}

@Injectable({ providedIn: 'root' })
export class RecipePhotoService {
  private readonly auth = inject(AuthService);
  private readonly notifications = inject(NotificationService);
  private cleanupRequest: Promise<boolean> | undefined;
  constructor(private readonly supabase: SupabaseService) {}

  publicUrl(storagePath: string): string {
    return this.supabase.requireClient().storage.from(BUCKET).getPublicUrl(storagePath).data.publicUrl;
  }

  async sync(recipeId: string, retainedPhotos: RecipePhoto[], files: File[], recipeName = 'la receta', originalPhotos?: RecipePhoto[]): Promise<void> {
    if (retainedPhotos.length + files.length > MAX_PHOTOS) {
      throw new Error('Puedes guardar como máximo 3 fotos por receta.');
    }
    if (originalPhotos && files.length === 0) {
      const original = [...originalPhotos].sort((a, b) => a.position - b.position);
      if (original.length === retainedPhotos.length && original.every((photo, index) => {
        const retained = retainedPhotos[index];
        return photo.id === retained.id && photo.storagePath === retained.storagePath && photo.altText === retained.altText;
      })) return;
    }
    await this.auth.requireEditor();
    const client = this.supabase.requireClient();
    const { data: currentRows, error: readError } = await client
      .from('recipe_photos').select('id,storage_path,position,alt_text').eq('recipe_id', recipeId).order('position');
    if (readError) throw readError;
    const current = currentRows ?? [];
    const unchanged = current.length === retainedPhotos.length && current.every((row, index) => {
      const retained = retainedPhotos[index];
      return row.id === retained.id && row.storage_path === retained.storagePath && row.alt_text === retained.altText && row.position === index + 1;
    });
    if (unchanged && files.length === 0) return;
    const newlyUploaded: string[] = [];
    let metadataSubmitted = false;
    try {
      const addedRows: { recipe_id: string; storage_path: string; position: number; alt_text: string }[] = [];
      for (const [index, original] of files.entries()) {
        const { optimizePhoto } = await import('../utils/photo-upload.utils');
        const file = await optimizePhoto(original);
        const extension = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
        const path = `${recipeId}/${crypto.randomUUID()}.${extension}`;
        const { error } = await client.storage.from(BUCKET).upload(path, file, { contentType: file.type, cacheControl: '31536000', upsert: false });
        if (error) throw error;
        newlyUploaded.push(path);
        addedRows.push({ recipe_id: recipeId, storage_path: path, position: retainedPhotos.length + index + 1, alt_text: `Foto de ${recipeName}` });
      }

      const retainedRows = retainedPhotos.map((photo, index) => ({
        id: photo.id,
        recipe_id: recipeId,
        storage_path: photo.storagePath,
        position: index + 1,
        alt_text: photo.altText,
      }));
      metadataSubmitted = true;
      const { error } = await client.rpc('sync_recipe_photos', {
        p_recipe_id: recipeId, p_expected: current, p_photos: [...retainedRows, ...addedRows],
      });
      if (error?.code === 'PGRST202') {
        // PostgREST explicitly rejected the missing RPC, so these new uploads
        // cannot have become referenced. This is not an ambiguous network error.
        metadataSubmitted = false;
        throw new Error('No se han guardado las fotos: Supabase no encuentra sync_recipe_photos. Aplica la migración 20261020000300_atomic_recipe_photos.sql y vuelve a guardar esta receta.');
      }
      if (error) throw error;
    } catch (error) {
      // A lost response can hide a committed transaction. Never remove uploaded
      // files after submitting metadata: the database may already reference them.
      if (!metadataSubmitted && newlyUploaded.length) {
        try { await client.storage.from(BUCKET).remove(newlyUploaded); } catch { /* Preserve the original upload error. */ }
      }
      throw error;
    }
    if (!await this.cleanupPending()) this.notifications.error('Las fotos se han guardado. Quedan archivos antiguos pendientes de limpieza; se reintentará en la próxima operación de fotos.');
  }

  /** Cleanup is retryable and cannot turn an already committed save into a failure. */
  cleanupPending(): Promise<boolean> {
    if (!this.cleanupRequest) {
      this.cleanupRequest = this.cleanFiles().catch(() => false).finally(() => { this.cleanupRequest = undefined; });
    }
    return this.cleanupRequest;
  }

  private async cleanFiles(): Promise<boolean> {
    const client = this.supabase.requireClient();
    const { data, error } = await client.from('recipe_photo_cleanup').select('storage_path').order('created_at').order('storage_path').limit(101);
    if (error) throw error;
    const paths = (data ?? []).slice(0, 100).map((row: { storage_path: string }) => row.storage_path);
    if (!paths.length) return true;
    const { data: referenced, error: referenceError } = await client.from('recipe_photos').select('storage_path').in('storage_path', paths);
    if (referenceError) throw referenceError;
    const protectedPaths = new Set((referenced ?? []).map((row: { storage_path: string }) => row.storage_path));
    const unused = paths.filter((path: string) => !protectedPaths.has(path));
    if (unused.length) {
      const { error: removeError } = await client.storage.from(BUCKET).remove(unused);
      if (removeError) throw removeError;
      const { error: clearError } = await client.from('recipe_photo_cleanup').delete().in('storage_path', unused);
      if (clearError) throw clearError;
    }
    return protectedPaths.size === 0 && (data ?? []).length <= 100;
  }
}
