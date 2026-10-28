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
14. `supabase/migrations/20261026000100_freezer_inventories.sql`
15. `supabase/migrations/20261026000200_freezer_entries.sql`
16. `supabase/migrations/20261026000300_add_scheduled_recipe.sql`
17. `supabase/migrations/20261027000100_inventory_places.sql`
18. `supabase/migrations/20261027000200_ingredient_measures.sql`
19. `supabase/migrations/20261027000300_inventory_empty_amounts.sql`

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

## Añadir una receta a Planificación desde su detalle

Antes de publicar esta acción, ejecuta [20261026000300_add_scheduled_recipe.sql](supabase/migrations/20261026000300_add_scheduled_recipe.sql) en un proyecto con las migraciones anteriores aplicadas. No se ha ejecutado contra Supabase remoto desde este cambio. No necesita nuevas tablas ni modifica las comidas existentes al instalarse.

La RPC `add_scheduled_recipe(date,text,integer,uuid,text)` recibe fecha, comida, comensales, receta y modo de preparación. Usa `SECURITY INVOKER`, las políticas existentes de `scheduled_meals` y el mismo bloqueo por propietario/fecha de `save_scheduled_day`. El propietario se obtiene de `auth.uid()`; exige pertenecer al grupo de editores y comprueba que la receta exista.

Si la comida está vacía, la crea. Si existe, conserva sus comensales, recetas y preparaciones y añade únicamente la nueva receta. Comprueba el máximo de cinco recetas y los duplicados sin distinguir mayúsculas del UUID. Si una petición se repite después de haberse aplicado, devuelve la comida existente sin duplicar ni cambiar la preparación. Si los comensales de una comida existente difieren de los mostrados al confirmar, devuelve un conflicto para actualizar la vista previa. La respuesta indica si se añadió la receta e incluye el hueco guardado, no el día entero.

`npm run test:planner:sql` ejecuta nueve pruebas de las migraciones reales en PostgreSQL/WASM local. Comprueba conservación de otras recetas, comidas y fechas, reintentos, límites, validación, conflictos y aislamiento entre usuarios. No confirma los permisos ni el estado del proyecto remoto.

## Categorías Líquidos y Frutos secos

Ejecuta [20261021000100_ingredient_categories.sql](supabase/migrations/20261021000100_ingredient_categories.sql) en **SQL Editor → New query**, después de las anteriores y antes de publicar este frontend. En una instalación ya actualizada solo necesitas esta nueva migración. No se ha aplicado al proyecto remoto desde el repositorio.

Permite los valores internos `Liquidos` y `FrutosSecos` en `ingredients.category` y en las listas de compra guardadas. Las etiquetas visibles son **Líquidos** y **Frutos secos**. Actualiza `ingredients_category_check` y `valid_shopping_items(jsonb)` dentro de una transacción; conserva los ingredientes, las listas existentes, RLS y la ejecución restringida de la validación. Puede ejecutarse de nuevo. No basta con ampliar únicamente el CHECK de ingredientes: también debe actualizarse la función para poder guardar las categorías nuevas en Compra.

## Congelador: guardado por lote

Esta sección describe la versión anterior a Inventario; la migración de lugares indicada a continuación reemplaza su acceso desde el frontend.

Antes de publicar el frontend con guardado parcial, aplica [20261026000200_freezer_entries.sql](supabase/migrations/20261026000200_freezer_entries.sql) después de [20261026000100_freezer_inventories.sql](supabase/migrations/20261026000100_freezer_inventories.sql). Si ya utilizas Congelador y tienes aplicada la primera migración, solo necesitas la segunda. No se han ejecutado contra Supabase remoto desde este cambio.

La nueva migración crea `freezers` y `freezer_entries`, con RLS privada por propietario y permiso de editor. Copia todos los congeladores y lotes existentes, manteniendo nombres, cantidades, fechas y orden. Conserva la tabla antigua como archivo y revoca su acceso y la ejecución de `save_freezer_inventory`, para evitar que clientes antiguos escriban en una copia diferente. Las pestañas abiertas con el frontend anterior deben recargarse después de publicar la nueva versión.

`get_freezer_inventory()` obtiene la colección privada. `apply_freezer_changes(jsonb)` recibe únicamente las filas modificadas y compara sus valores anteriores dentro de una transacción. Modificar otro lote o congelador no invalida el guardado por una versión global; un cambio concurrente sobre la misma fila se rechaza sin sobrescribirlo. Repetir una operación cuyo resultado ya existe no duplica entradas ni repite retiradas. Ambas RPC utilizan `SECURITY INVOKER` y obtienen el propietario de la sesión.

`npm run test:freezer:sql` comprueba las dos migraciones reales en PostgreSQL/WASM local, incluida la conservación del inventario anterior, privacidad, validaciones, conflictos, atomicidad y reintentos. No confirma el estado del proyecto remoto.

## Inventario por lugares: alacena, congelador y recetas preparadas

Antes de publicar esta versión, aplica [20261027000100_inventory_places.sql](supabase/migrations/20261027000100_inventory_places.sql) después de las migraciones anteriores. No se ha aplicado al proyecto remoto desde esta tarea.

La migración convierte cada congelador existente en un lugar con el mismo ID y nombre. Sus lotes se conservan en el espacio Congelador, con las cantidades, nombres, fechas y orden existentes; Alacena empieza vacía. Crea `inventory_places` e `inventory_entries`, protegidas por propietario y permiso de editor mediante RLS. Archiva las tablas anteriores sin acceso de navegador y revoca `get_freezer_inventory` y `apply_freezer_changes`, por lo que las pestañas antiguas deben recargarse tras publicar.

`get_inventory()` recupera la colección privada. `apply_inventory_changes(jsonb)` compara solo las filas afectadas y guarda cada operación en una transacción; los reintentos no duplican lotes ni repiten retiradas. `valid_inventory_entry(jsonb)` valida los dos espacios fijos, cantidades, fechas y raciones enteras positivas. Las RPC utilizan `SECURITY INVOKER` y obtienen el propietario de la sesión. `inventory_recipe_ids(uuid[])` devuelve los IDs de las recetas todavía disponibles; borrar una receta no elimina las raciones ni sus nombres guardados. La aplicación ha eliminado la operativa Mover; conserva los lotes y fechas históricos sin cambios de esquema ni migración adicional.

`npm run test:inventory` ejecuta cincuenta y cuatro pruebas de servicio, formularios, agrupación por elemento y categoría y SQL, incluidas diecisiete de esta migración real con PGlite local. No verifica las migraciones, permisos ni datos del proyecto remoto.

## Medidas de ingredientes y equivalencias

Después de la migración de medidas, aplica también [20261027000300_inventory_empty_amounts.sql](supabase/migrations/20261027000300_inventory_empty_amounts.sql). Corrige un error `cannot delete from scalar` al comparar cantidades JSON nulas en altas o modificaciones de entradas sin cantidad. Sustituye únicamente `apply_inventory_changes`, conservando permisos, privacidad y guardado atómico; no modifica datos existentes. Se verificó mediante once pruebas SQL de medidas y una comprobación de retirada directa en navegador con PostgreSQL/WASM local. No se ha aplicado a Supabase remoto desde esta tarea. El cambio de interfaz para retirar el lote completo no necesita cambios de esquema.

Antes de publicar el frontend con las medidas configurables, aplica [20261027000200_ingredient_measures.sql](supabase/migrations/20261027000200_ingredient_measures.sql), después de todas las anteriores, incluida Inventario. Se ha validado en PostgreSQL/WASM local; no se ha aplicado a Supabase remoto desde esta tarea.

Añade `ingredients.base_unit` (`g` o `ml`, obligatorio) y `unit_quantity` (contenido positivo de una unidad, opcional). Los ingredientes actuales reciben `g`, salvo la categoría `Liquidos`, que recibe `ml`; no se modifican cantidades existentes ni se inventan equivalencias. Estas se completan manualmente mediante la edición del ingrediente. Las especias requieren base `g` y admiten cucharadas de 5 g; sus cantidades pueden ser fraccionarias.

Añade `amount_base_unit` y `amount_unit_quantity` a `recipe_ingredients` e `ingredient_components` para conservar la equivalencia usada al guardar unidades. El inventario conserva esos valores dentro del JSON de cada lote. Actualiza el guardado de recetas e inventario y sustituye la firma de ingredientes por `save_ingredient(uuid,text,text,jsonb,text,numeric)`; la firma anterior deja de estar disponible para el navegador. Los vasos y cantidades históricas incompatibles se conservan y pueden reducirse o trasladarse. Las pestañas con la versión anterior deben recargarse tras publicar el frontend.

`npm run test:measures` comprueba la migración real, la configuración obligatoria, instantáneas, cucharadas, conservación de cantidades anteriores, traslados parciales, validaciones y permisos. Los totales del inventario se calculan en la interfaz por medida, sin fusionar lotes ni convertir unidades a peso.

### Query opcional para completar las equivalencias del catálogo actual

[20261027_ingredient_unit_equivalences.sql](supabase/queries/20261027_ingredient_unit_equivalences.sql) contiene una única sentencia preparada a partir de los 127 ingredientes consultados en Supabase el 27/10/2026. Propone equivalencias para 43 ingredientes y devuelve los registros actualizados con la definición de cada unidad. Los pesos son estimaciones netas listas para usar; Ajo significa un diente y Nueces una nuez pelada completa. Los yogures y bolas de queso utilizan formatos de referencia de 125 g. Leche pasa a ml con un envase de referencia de 1000 ml y Nata para cocinar a ml con uno de 200 ml; no convierte cantidades históricas.

La query identifica cada ingrediente por UUID, nombre exacto y medida base anterior, y solo completa `unit_quantity` cuando está vacío. Conserva equivalencias configuradas, incluida Dorada a 250 g. No modifica recetas, componentes ni lotes. Es específica de este catálogo y queda fuera de las migraciones automáticas. Se comprobó con PostgreSQL/WASM local, incluida la repetición sin sobrescribir datos. No se ha ejecutado en Supabase remoto.

## Vincular recetas preparadas a comidas planificadas

Antes de publicar esta funcionalidad, aplica [20261027000400_inventory_planning.sql](supabase/migrations/20261027000400_inventory_planning.sql) después de las anteriores. No se ha aplicado al proyecto remoto desde esta tarea.

Actualiza `valid_scheduled_recipes` y `save_scheduled_day` para aceptar y validar el origen opcional del inventario, comprobando el lote y la receta del propietario antes de guardar. Mantiene fuentes históricas previamente guardadas si se retira un lote. No modifica tablas ni datos de existencias: planificar conserva todas las raciones y no las reserva.

Añade `get_inventory_planning_links(date)`, con `SECURITY INVOKER`, autenticación, permiso de editor y RLS. Devuelve un array JSON de los vínculos a lotes existentes desde la fecha solicitada, evitando el límite de filas de PostgREST. La interfaz consulta desde hoy para mostrar **En planificación** y el día/comida correspondientes. Al quitar una receta del plan y guardar se actualiza el indicador.

`npm run test:planner` ejecuta 78 pruebas de dominio, servicios, selectores y editor; `npm run test:planner:sql` ejecuta 23 pruebas SQL, incluidas nueve de esta migración y cinco de la API de búsqueda con todos los ingredientes. Comprueban stock sin cambios, persistencia del lote elegido, eliminación de vínculos, fechas, fuentes históricas, marcas de ingredientes planificados, búsqueda automática OR por ingredientes libres, privacidad y validaciones. No verifican la configuración del proyecto remoto.

## Buscar recetas con ingredientes del inventario

[20261027000500_inventory_ingredient_search.sql](supabase/migrations/20261027000500_inventory_ingredient_search.sql), aplicada después de las anteriores, añade `search_recipes_with_all_ingredients(uuid[],text)` para exigir todos los ingredientes seleccionados antes de contar y paginar en SQL, conservando RLS, tarjetas, filtros y orden. Las selecciones vacías o con referencias nulas no devuelven todas las recetas. No modifica datos ni la RPC general de coincidencias; se ha probado en PostgreSQL/WASM local y no se ha ejecutado en Supabase remoto.

La interfaz también funciona cuando esa función no está instalada: una selección de un ingrediente usa directamente la RPC anterior; con varios, un error de función ausente (`PGRST202` o `42883`) activa un recorrido completo de candidatos, manteniendo únicamente las recetas que contienen todos los ingredientes antes de entregar la página y el total. Mantiene filtros, orden y cancelación; no convierte errores de conexión o permisos en listas vacías. Instalar la migración evita ese recorrido adicional. Una comprobación pública de solo lectura confirmó que Boquerones sí corresponde a «Rollitos de boquerón» y detectó la ausencia de la RPC nueva. No se realizaron cambios remotos.

El modal del planner tiene tres pestañas: Inventario con platos preparados, Recetas por ingredientes del inventario y Recetario. La segunda recoge automáticamente los ingredientes libres que el propietario tiene en cualquier lugar/espacio y utiliza **OR** mediante la RPC anterior `search_recipes_by_ingredients`; basta con la presencia del ingrediente, sin exigir cantidad suficiente. Una receta con ingredientes planificados puede aparecer si coincide con algún otro ingrediente libre. Sus filtros son independientes del Recetario. El inventario vacío o completamente planificado no se convierte en una consulta sin filtro. El primer recorrido conserva el vínculo al lote; las recetas de las otras dos pestañas se planifican sin vincularlas a comida ya preparada. Las tres pestañas reutilizan las migraciones existentes.

`InventoryIngredientPlanningService` deriva las marcas de ingredientes consultando `scheduled_meals` del propietario desde la fecha local de hoy, con RLS y filtro explícito de propietario. Consulta `recipe_ingredients` y el nombre de las recetas en lotes de hasta 100 IDs únicos, con paginación de ambas lecturas. Omite los planes pasados y las recetas cuyo origen es un lote preparado. No escribe existencias ni duplica vínculos en otra tabla. Comparte lecturas simultáneas, reutiliza cinco minutos la comprobación e invalida al guardar planes o editar recetas; cambios de cuenta o permisos limpian los datos privados y cancelan lecturas anteriores. Un fallo bloquea las sugerencias por existencias hasta reintentar. No necesita una migración adicional.

## Cantidades de compra y registro en la alacena

Aplica [20261027000600_shopping_quantities_purchase.sql](supabase/migrations/20261027000600_shopping_quantities_purchase.sql) después de las anteriores y antes de publicar la versión correspondiente. No se ha ejecutado en el proyecto remoto desde esta tarea.

Amplía la validación de `shopping_lists.items` con `amounts`, `unquantified` y avisos opcionales, conservando las listas antiguas. Los contadores anteriores no se convierten en unidades ni pesos. `shopping_plan_amounts(date,date)` consulta solo las comidas propias y devuelve cantidades y factores de proporción o recetas completas con sobras. Excluye platos procedentes de inventario; si no hay comensales originales lo señala para revisión. Al generar la lista, la interfaz asigna 1 unidad a cada aparición sin cantidad indicada, suma apariciones y medidas compatibles y usa la equivalencia por unidad si existe; el valor por defecto no se escala por comensales. Permite descontar existencias mediante equivalencias compatibles, sin modificar stock. Este valor por defecto no requiere otra migración.

El botón Añadir del cálculo incorpora toda la vista previa al borrador existente: conserva ingredientes anteriores y suma cantidades compatibles de los repetidos. Cierra el modal directamente. La combinación se valida antes de modificar el borrador y conserva equivalencias, cantidades pendientes y avisos. El guardado explícito posterior utiliza la misma RPC y versión de `shopping_lists`; no requiere modificar SQL.

La lista presenta las cantidades ausentes como ×1, también en altas manuales y datos antiguos. `shoppingDefaultQuantity` utiliza una unidad al compartir o generar el payload de compra; incrementar por primera vez guarda dos unidades. El valor por defecto no se obtiene del contador histórico. Se conservan cantidades conocidas y equivalencias y se envían medidas explícitas a `complete_shopping_purchase`, sin cambiar el contrato SQL ni necesitar otra migración.

`complete_shopping_purchase(uuid,bigint,jsonb,uuid,date)` guarda el borrador comprado en la alacena del lugar elegido y vacía la lista en la misma transacción. Rechaza cantidades desconocidas, versiones antiguas o destinos ajenos sin efectos parciales. `shopping_purchases` almacena comprobantes privados por usuario/operación; los reintentos exactos no duplican existencias ni vacían una lista posterior. Todas las operaciones usan `SECURITY INVOKER`, RLS y el propietario de la sesión. Los permisos del historial se limitan a lectura e inserción propias para editores autenticados.

`npm run test:shopping` ejecuta 41 pruebas de dominio y servicios; `npm run test:shopping:sql` ejecuta 20 pruebas SQL, incluidas diez de esta migración. Se verificaron en PostgreSQL/WASM local, sin escrituras remotas.
