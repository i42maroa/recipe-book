# Fotos de recetas

La aplicación guarda los archivos en Supabase Storage y sus rutas y posiciones en `public.recipe_photos`. Se permiten hasta tres fotos por receta, de 5 MB cada una.

## Aplicar la consulta

En el panel de Supabase, abre **SQL Editor → New query**, pega y ejecuta el contenido de [`supabase/migrations/20261016000100_recipe_photos.sql`](supabase/migrations/20261016000100_recipe_photos.sql). La consulta crea la tabla, el bucket público `recipe-photos` y las políticas de acceso que necesita la aplicación.

Después, aplica [20261018000100_editor_access.sql](supabase/migrations/20261018000100_editor_access.sql) para sustituir los permisos anónimos antiguos. El orden completo está en [SUPABASE.md](SUPABASE.md). No vuelvas a aplicar la migración antigua de fotos por separado después de la de seguridad.

Para la versión actual, aplica también [20261020000300_atomic_recipe_photos.sql](supabase/migrations/20261020000300_atomic_recipe_photos.sql), después de las migraciones anteriores y antes de desplegar el frontend. Añade sincronización transaccional de metadatos, borrado de recetas sin eliminar antes sus archivos y una cola de limpieza privada para editores. Un fallo de Storage deja la limpieza pendiente para otra modificación de fotos o borrado de receta; no elimina fotos de una receta cuyo borrado haya fallado. Detalles y pruebas: [OPTIMIZACION.md](OPTIMIZACION.md).

## Acceso público

El bucket sirve las imágenes públicamente. Subir, sustituir o eliminar fotos requiere una sesión de Supabase Auth y pertenecer a `private.recipe_editors`. Los visitantes y las cuentas sin permiso pueden consultar todas las fotos y no ven los formularios de edición.

## Error 404 en `sync_recipe_photos`

La versión actual necesita la función de [20261020000300_atomic_recipe_photos.sql](supabase/migrations/20261020000300_atomic_recipe_photos.sql). Si PostgREST devuelve `PGRST202` al llamarla, la migración puede faltar en el proyecto al que apunta el frontend o su caché de esquema puede no estar actualizada.

En el proyecto correspondiente de Supabase, ejecuta el archivo completo desde **SQL Editor**. Para comprobar si ya está aplicada, consulta:

```sql
select to_regprocedure('public.sync_recipe_photos(uuid,jsonb,jsonb)');
```

Si devuelve `null`, falta la función. Si existe pero la API sigue sin encontrarla, recarga su esquema:

```sql
notify pgrst, 'reload schema';
```

Si la receta ya se creó, edita esa misma receta, selecciona de nuevo la imagen y guarda. Si el formulario sigue abierto, puedes reintentar sin cerrarlo: conserva el ID guardado y las imágenes seleccionadas. El frontend indica que la receta ya existe y explica la migración pendiente. Para un rechazo explícito `PGRST202`, limpia las subidas nuevas de ese intento, que no llegaron a asociarse. Ante un error de red ambiguo continúa conservándolas para no destruir una foto cuyo guardado pudiera haberse confirmado.
