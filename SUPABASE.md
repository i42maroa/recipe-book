# Configurar Supabase

## Acceso

Las recetas, ingredientes, relaciones, pasos y fotos son públicos para consultar. Crear, modificar o eliminar exige una sesión de Supabase Auth y pertenecer a `private.recipe_editors`. Todos los editores gestionan el mismo recetario.

La página `/login` permite entrar con Google o correo y contraseña, comprobar permisos y cerrar sesión. No hay enlaces ni botones hacia `/login` en el resto de la aplicación: escribe el path en el navegador. La protección está en las políticas de la base de datos y Storage.

## 1. Aplicar las queries

En un proyecto ya configurado con el esquema, fotos y comensales, abre **SQL Editor → New query**, pega y ejecuta el contenido de [20261018000100_editor_access.sql](supabase/migrations/20261018000100_editor_access.sql).

Si ya tienes aplicada la seguridad, ejecuta [20261019000100_recipe_query_optimization.sql](supabase/migrations/20261019000100_recipe_query_optimization.sql) **antes de desplegar el frontend optimizado**. Añade `get_recipe_stats()` (ambos contadores en una petición) y `save_recipe_optimized(uuid,jsonb)` (reutiliza el guardado transaccional e indica si han cambiado los contadores). Conserva `SECURITY INVOKER` y RLS. No vuelve a crear tablas ni modifica los miembros autorizados. Detalles: [OPTIMIZACION.md](OPTIMIZACION.md).

Para la escritura parcial de valoraciones, ejecuta después [20261019000200_partial_recipe_rating.sql](supabase/migrations/20261019000200_partial_recipe_rating.sql). Si las anteriores ya están aplicadas, basta con esta nueva migración. Añade `rate_recipe(uuid,integer)`, que actualiza solo `rating`, `pending` y `updated_at`, comprueba pertenencia al grupo y mantiene RLS. No modifica pasos, ingredientes, cocinas ni fotos. La migración debe estar aplicada antes de desplegar esta versión del frontend. No se ha ejecutado desde el repositorio contra Supabase remoto.

Para instalar desde cero, aplica una vez estos archivos, en este orden:

1. `supabase/migrations/20261015000100_initial_schema.sql`
2. `supabase/migrations/20261016000100_recipe_photos.sql`
3. `supabase/migrations/20261016000100_recipe_servings.sql`
4. `supabase/migrations/20261018000100_editor_access.sql`
5. `supabase/migrations/20261019000100_recipe_query_optimization.sql`
6. `supabase/migrations/20261019000200_partial_recipe_rating.sql`

La migración de seguridad conserva los datos y reemplaza todas las políticas de las tablas del recetario enumeradas en ella. Crea el grupo privado de editores, configura lectura pública y escritura autorizada, restringe las RPC de guardado y protege las escrituras de fotos. El grupo empieza vacío: nadie podrá editar hasta que añadas al primer miembro. No vuelvas a aplicar las migraciones antiguas por separado después de configurar la seguridad, porque contienen permisos de escritura anónima.

Si usas CLI y las migraciones anteriores ya están correctamente registradas en el proyecto remoto, puedes usar `supabase db push`. No se ha ejecutado SQL contra tu proyecto desde este cambio.

## 2. Configurar Google

### En Google Cloud

1. Selecciona o crea un proyecto en [Google Cloud Console](https://console.cloud.google.com/).
2. En **Google Auth Platform**, configura el consentimiento OAuth: nombre de aplicación, correo de soporte y audiencia. Si está en modo de pruebas con audiencia externa, añade las cuentas que vayan a entrar a **Test users**.
3. En **Clients**, crea un cliente OAuth de tipo **Web application**.
4. En **Authorized JavaScript origins**, añade el origen de tu web (por ejemplo `https://tu-dominio.es`) y, para desarrollo, `http://localhost:4200`. Sin path.
5. En **Authorized redirect URIs**, pega la **Callback URL** que muestra Supabase al configurar Google. Habitualmente es `https://<project-ref>.supabase.co/auth/v1/callback`. Usa el valor exacto del panel; si hay un dominio de Auth personalizado será diferente. Esta URL corresponde a Supabase, no a `/login`.
6. Guarda el **Client ID** y el **Client Secret** para el paso siguiente.

### En Supabase

1. En **Authentication → Sign In / Providers → Google** (la etiqueta puede variar según el panel), activa Google y pega el **Client ID** y el **Client Secret** de Google Cloud. Guarda los cambios. El secreto solo se configura en Supabase, nunca en Angular.
2. En **Authentication → URL Configuration**, configura **Site URL** con la URL pública de tu web.
3. En **Redirect URLs**, añade las URLs exactas de vuelta al front: `http://localhost:4200/login` y `https://tu-dominio.es/login`. Añade otras solo si realmente usas esos entornos. El front utiliza el origen actual más `/login` como `redirectTo`.
4. Si la cuenta de Google todavía no existe en Supabase Auth, permite el alta de usuarios para que el primer login OAuth cree su cuenta. No se concede acceso de edición automáticamente. Si has desactivado los nuevos registros, la cuenta debe existir previamente y poder vincularse al proveedor; comprueba esa configuración antes de probar.

Al pulsar **Continuar con Google** se abre el acceso de Google y, tras completar el flujo, Supabase devuelve al usuario a `/login` y el front consulta sus permisos. Una cuenta que acaba de entrar puede ver las recetas sin estar autorizada para cambiarlas.

La lista de cuentas de prueba de Google y la lista de editores de la base de datos son distintas: estar en la primera permite probar OAuth; estar en la segunda permite editar.

Referencias oficiales: [Login con Google](https://supabase.com/docs/guides/auth/social-login/auth-google) y [URLs de redirección](https://supabase.com/docs/guides/auth/redirect-urls).

## 3. Crear cuentas y autorizar editores

Para Google, entra una primera vez desde `/login` y localiza el usuario creado en **Authentication → Users**. Para correo y contraseña, puedes crear la cuenta desde **Authentication → Users → Add user**, con correo confirmado y contraseña, y habilitar el proveedor Email. El front no tiene formulario de registro ni de recuperación de contraseña.

Desde SQL Editor, busca el UUID del usuario:

```sql
select id, email, created_at
from auth.users
order by created_at desc;
```

Añade ese UUID al grupo (sustituye el valor del ejemplo):

```sql
insert into private.recipe_editors (user_id)
values ('00000000-0000-0000-0000-000000000000'::uuid)
on conflict (user_id) do nothing;
```

Usa el UUID de la cuenta que aparece realmente al entrar. Después pulsa **Comprobar permisos** en `/login` o recarga la página. No necesitas añadir roles a JWT, `user_metadata` ni listas de correos al código Angular. Ni los usuarios autorizados pueden gestionar miembros desde la API pública.

Para ver los miembros:

```sql
select e.user_id, u.email, e.created_at
from private.recipe_editors e
join auth.users u on u.id = e.user_id
order by u.email;
```

Para revocar acceso:

```sql
delete from private.recipe_editors
where user_id = '00000000-0000-0000-0000-000000000000'::uuid;
```

La siguiente escritura en BD queda denegada aunque el usuario mantenga una sesión válida. El front consulta permisos antes de cada operación de escritura y al restaurar/cambiar la sesión. Las acciones pueden seguir visibles hasta la siguiente comprobación; RLS ya impide escribir.

## 4. Configurar Angular y alojamiento

La sesión se persiste mediante `CacheService`, con `sessionCacheTtlMs` configurable en los entornos (30 días desde el último guardado o renovación). Se restaura al abrir la web y al volver del segundo plano, recuperar el foco o la conexión. Los permisos se vuelven a consultar; no se guardan como autorización local. Detalles y limitaciones por dominio o navegador: [CACHE.md](CACHE.md).

Los enlaces de compartir usan `publicSiteUrl` de los dos archivos de entorno, configurado como `https://recipe-book-neon-two.vercel.app`. Se construyen con el ID de la receta y ese dominio público, incluso al navegar desde otra URL de despliegue o desde localhost. Si cambia el dominio público, actualiza ese valor y vuelve a desplegar. El dominio público debe permitir acceso anónimo en Vercel; las URLs de preview pueden mantener su protección.

Pon **Project URL** y la clave **publishable** (o `anon` legacy) en `supabaseUrl` y `supabaseAnonKey` de `src/environments/environment.ts` y `src/environments/environment.production.ts`. Son claves públicas; nunca uses `secret` ni `service_role` en el navegador. No hacen falta variables nuevas para Google.

El alojamiento debe servir `index.html` para las rutas Angular, incluido `/login`, para poder abrirlas directamente y recibir el retorno de OAuth. Configura la reescritura SPA si el alojamiento no la incluye.

Ejecuta `npm install` si faltan dependencias y `npm start`. La CLI instalada requiere Node.js 22.22.3+, 24.15.0+ o 26+ en las ramas compatibles que indica al arrancar.

## 5. Comprobar el resultado

| Caso | Consulta de recetas y fotos | Crear, editar, puntuar, borrar o subir fotos |
| --- | --- | --- |
| Sin sesión | Permitida | Denegado |
| Con sesión, fuera del grupo | Permitida | Denegado |
| Con sesión y dentro del grupo | Permitida | Permitido |

Comprueba que abrir `/login` directamente funciona y que no existe ningún enlace hacia esa ruta. Prueba Google con una cuenta permitida por el consentimiento OAuth. Autoriza su UUID en SQL y comprueba la edición. Retira el UUID y comprueba que la siguiente escritura falla. Prueba también las RPC `save_recipe` y `save_ingredient`, relaciones de receta y operaciones de Storage; no basta con comprobar que los botones están ocultos.

Una actualización o borrado rechazado por RLS puede afectar cero filas sin devolver error. Confirma que no cambió el dato. Las inserciones no autorizadas deben fallar. No compruebes RLS con el rol administrador de SQL Editor ni con `service_role`: tienen privilegios elevados. Usa peticiones de navegador con la clave pública y las sesiones de cada caso.

Al añadir tablas, vistas, RPC o buckets, configura sus permisos expresamente. La migración cubre las tablas listadas que existan al ejecutarla; no aplica políticas automáticamente a futuras tablas.
