import { AuthService } from './auth.service';
import { Injectable, inject } from '@angular/core';
import { RecipePhoto } from '../models/recipe.model';
import { SupabaseService } from './supabase.service';

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
    const retainedPaths = new Set(retainedPhotos.map((photo) => photo.storagePath));
    const removedPaths = current.map((row) => row.storage_path).filter((path) => !retainedPaths.has(path));
    const appendOnly = removedPaths.length === 0 && current.length === retainedPhotos.length && current.every((row, index) => {
      const retained = retainedPhotos[index];
      return row.id === retained.id && row.storage_path === retained.storagePath && row.alt_text === retained.altText && row.position === index + 1;
    });
    if (appendOnly && files.length === 0) return;
    const newlyUploaded: string[] = [];
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

      // For the common case of adding photos, preserve existing metadata rows and append only new rows.
      // This avoids deleting/reinserting rows that may be referenced by an already-rendered recipe.
      if (appendOnly) {
        const { error } = await client.from('recipe_photos').insert(addedRows);
        if (error) throw error;
        return;
      }

      const retainedRows = retainedPhotos.map((photo, index) => ({
        id: photo.id,
        recipe_id: recipeId,
        storage_path: photo.storagePath,
        position: index + 1,
        alt_text: photo.altText,
      }));
      const { error: clearError } = await client.from('recipe_photos').delete().eq('recipe_id', recipeId);
      if (clearError) throw clearError;
      const { error: insertError } = await client.from('recipe_photos').insert([...retainedRows, ...addedRows]);
      if (insertError) {
        if (current.length) await client.from('recipe_photos').insert(current.map((row) => ({ ...row, recipe_id: recipeId })));
        throw insertError;
      }

      if (removedPaths.length) {
        const { error } = await client.storage.from(BUCKET).remove(removedPaths);
        if (error) console.error('No se pudieron eliminar algunas fotos sustituidas:', error);
      }
    } catch (error) {
      if (newlyUploaded.length) await client.storage.from(BUCKET).remove(newlyUploaded);
      throw error;
    }
  }

  async deleteFilesForRecipe(recipeId: string): Promise<void> {
    await this.auth.requireEditor();
    const { data, error } = await this.supabase.requireClient()
      .from('recipe_photos').select('storage_path').eq('recipe_id', recipeId);
    if (error) throw error;
    const paths = (data ?? []).map((row: { storage_path: string }) => row.storage_path);
    if (paths.length) {
      const { error: removeError } = await this.supabase.requireClient().storage.from(BUCKET).remove(paths);
      if (removeError) throw removeError;
    }
  }
}
