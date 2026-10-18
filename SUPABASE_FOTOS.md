# Fotos de recetas

La aplicación guarda los archivos en Supabase Storage y sus rutas y posiciones en `public.recipe_photos`. Se permiten hasta tres fotos por receta, de 5 MB cada una.

## Aplicar la consulta

En el panel de Supabase, abre **SQL Editor → New query**, pega y ejecuta el contenido de [`supabase/migrations/20261016000100_recipe_photos.sql`](supabase/migrations/20261016000100_recipe_photos.sql). La consulta crea la tabla, el bucket público `recipe-photos` y las políticas de acceso que necesita la aplicación.

Después, aplica [20261018000100_editor_access.sql](supabase/migrations/20261018000100_editor_access.sql) para sustituir los permisos anónimos antiguos. El orden completo está en [SUPABASE.md](SUPABASE.md). No vuelvas a aplicar la migración antigua de fotos por separado después de la de seguridad.

## Acceso público

El bucket sirve las imágenes públicamente. Subir, sustituir o eliminar fotos requiere una sesión de Supabase Auth y pertenecer a `private.recipe_editors`. Los visitantes y las cuentas sin permiso pueden consultar todas las fotos y no ven los formularios de edición.
