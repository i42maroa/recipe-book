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
7. `supabase/migrations/20261019000300_meal_plans.sql`
8. `supabase/migrations/20261019000400_unique_meal_plan_recipes.sql`
9. `supabase/migrations/20261020000100_daily_meals.sql`
10. `supabase/migrations/20261020000200_recipe_ingredient_search.sql`
11. `supabase/migrations/20261020000300_atomic_recipe_photos.sql`
12. `supabase/migrations/20261020000400_shopping_lists.sql`
13. `supabase/migrations/20261021000100_ingredient_categories.sql`

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

## Comidas privadas por fecha

Aplica [20261020000100_daily_meals.sql](supabase/migrations/20261020000100_daily_meals.sql) después de las migraciones anteriores y antes de desplegar esta versión. Crea `scheduled_meals` y la RPC `save_scheduled_day(date,jsonb)`, sin entidad de plan ni favoritos.

Cada registro pertenece a un usuario, fecha y desayuno/comida/cena. La clave primaria impide más de un registro por hueco; las validaciones impiden más de cinco recetas o repetir una receta en el mismo hueco. Los comensales deben ser enteros entre 1 y 100. Lecturas y escrituras requieren `owner_id = auth.uid()` y pertenencia al grupo de editores. No hay acceso anónimo.

La RPC guarda un día de forma atómica y conserva las demás fechas. Recibe solo fecha y comidas: el propietario se obtiene de la sesión del servidor. Una lista vacía elimina las comidas de ese día. El bloqueo transaccional por usuario/fecha serializa guardados del mismo día; entre dos pestañas prevalece el último guardado completo.

La migración bloquea las escrituras antiguas mientras transfiere los datos. Para cada propietario y fecha elige el registro anterior actualizado más recientemente, incluidos los huecos vacíos, mantiene comensales y preparación y quita duplicados del mismo hueco. Los favoritos no se convierten en comidas fechadas. `meal_plans` se conserva como archivo, pero se revocan sus permisos de navegador. No se borran los datos antiguos ni se necesitan claves nuevas.

Comprueba con sesiones reales de dos editores que puedan consultar y guardar sus propias comidas, sin acceder a las del otro. Verifica que anónimos y cuentas sin permiso no puedan leer o escribir, que la RPC no permita elegir otro propietario, que guardar un día no cambie el siguiente, que quitar la última receta lo vacíe y que se rechacen duplicados, seis recetas por hueco y modos no válidos. Comprueba también que la antigua API `meal_plans` ya no permita lecturas desde el navegador. Usa la clave pública y las sesiones correspondientes: SQL Editor como administrador omite RLS.

## Lista de la compra

Antes de desplegar la página **Compra**, ejecuta [20261020000400_shopping_lists.sql](supabase/migrations/20261020000400_shopping_lists.sql) en **SQL Editor → New query**, después de las anteriores. Si ya están aplicadas, solo necesitas esta nueva migración. No se ha ejecutado contra Supabase remoto desde el repositorio.

Crea `shopping_lists`, con una fila privada por usuario, y las RPC `save_shopping_list(jsonb,bigint)` y `shopping_ingredients_from_plan(date,date)`. Ambas requieren sesión y permiso de editor y usan `SECURITY INVOKER`; no reciben un propietario arbitrario. RLS impide consultar o modificar listas ajenas. El guardado valida los elementos y compara la versión esperada para evitar reemplazar cambios de otra pestaña o dispositivo.

El cálculo usa únicamente las comidas guardadas del usuario entre ambas fechas incluidas. Cuenta ingredientes directos por aparición de receta, sin calcular cantidades ni expandir elaboraciones. La lista guardada conserva una instantánea de nombres y categorías. Compartir envía texto desde el navegador, sin hacer pública la tabla.

Las diez pruebas SQL locales validan las migraciones reales de compra y categorías en PostgreSQL/WASM con identidades de prueba. Tras aplicarlas, comprueba con dos sesiones reales que cada editor conserva su propia lista y que anónimos o usuarios sin permiso no pueden acceder. Si falta la migración inicial de compra, la página mostrará el archivo que debe aplicarse.

## Categorías Líquidos y Frutos secos

Ejecuta [20261021000100_ingredient_categories.sql](supabase/migrations/20261021000100_ingredient_categories.sql) en **SQL Editor → New query**, después de las anteriores y antes de publicar este frontend. En una instalación ya actualizada solo necesitas esta nueva migración. No se ha aplicado al proyecto remoto desde el repositorio.

Permite los valores internos `Liquidos` y `FrutosSecos` en `ingredients.category` y en las listas de compra guardadas. Las etiquetas visibles son **Líquidos** y **Frutos secos**. Actualiza `ingredients_category_check` y `valid_shopping_items(jsonb)` dentro de una transacción; conserva los ingredientes, las listas existentes, RLS y la ejecución restringida de la validación. Puede ejecutarse de nuevo. No basta con ampliar únicamente el CHECK de ingredientes: también debe actualizarse la función para poder guardar las categorías nuevas en Compra.
