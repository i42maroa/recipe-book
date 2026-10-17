# Fotos de recetas

La aplicación guarda los archivos en Supabase Storage y sus rutas y posiciones en `public.recipe_photos`. Se permiten hasta tres fotos por receta, de 5 MB cada una.

## Aplicar la consulta

En el panel de Supabase, abre **SQL Editor → New query**, pega y ejecuta el contenido de [`supabase/migrations/20261016000100_recipe_photos.sql`](supabase/migrations/20261016000100_recipe_photos.sql). La consulta crea la tabla, el bucket público `recipe-photos` y las políticas de acceso que necesita la aplicación.

Después, recarga la aplicación. No hacen falta nuevas claves ni cambios de configuración de Angular.

## Acceso público

El bucket sirve las imágenes públicamente. Como este proyecto no tiene autenticación y permite cambios anónimos, sus políticas también permiten a cualquier visitante con acceso a la aplicación subir y borrar archivos del bucket. Antes de usar fotos privadas o limitar quién puede modificar datos, configura autenticación y políticas por usuario.
