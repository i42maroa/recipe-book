# Configurar Supabase

## Datos que hacen falta

1. Configurar el **Project URL** y la clave **publishable** (o `anon` legacy) en los dos archivos de entorno Angular. La clave pública es visible en Angular; no usar una clave `secret` ni `service_role`.
2. Este proyecto está configurado como público, según la decisión del propietario. Las políticas permiten lectura y escritura anónimas: cualquier persona con la URL y la clave pública podría cambiar o borrar los datos.

## Aplicar esquema

Para habilitar las fotos, ejecuta despuÃ©s del esquema inicial `supabase/migrations/20261016000100_recipe_photos.sql` en el SQL Editor. Esta consulta crea `recipe_photos`, el bucket pÃºblico y sus polÃ­ticas. Pasos detallados en [SUPABASE_FOTOS.md](SUPABASE_FOTOS.md).

Con Supabase CLI, vincular el proyecto y ejecutar `supabase db push`. También se puede ejecutar el contenido de `supabase/migrations/20261015000100_initial_schema.sql` en el SQL Editor del proyecto. La migración crea las tablas MVP, relaciones, restricciones RLS y funciones transaccionales para guardar recetas y elaboraciones.

## Configurar Angular

Poner el Project URL y la clave pública en `src/environments/environment.ts` y `src/environments/environment.production.ts`, en `supabaseUrl` y `supabaseAnonKey`. Estos valores no son secretos. No usar nunca la clave `service_role` en el navegador. La configuración se compila dentro del bundle.

Luego ejecutar `npm install` y `npm start`. Las tablas empiezan vacías; no se cargan los antiguos datos de demostración.
