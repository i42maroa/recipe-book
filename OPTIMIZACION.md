# Optimización de carga y llamadas

## Aplicación en Supabase

Ejecuta [20261019000100_recipe_query_optimization.sql](supabase/migrations/20261019000100_recipe_query_optimization.sql) en SQL Editor después de las migraciones anteriores y antes de desplegar este frontend. La migración conserva los datos, los miembros y las políticas existentes.

- `get_recipe_stats()` devuelve total y pendientes en una sola consulta agregada. Se permite su ejecución pública para mantener la lectura pública.
- `save_recipe_optimized(uuid,jsonb)` llama a `save_recipe` dentro de la misma transacción y compara el estado pendiente anterior con el nuevo. Solo los usuarios autenticados pueden ejecutarla y todas sus escrituras siguen sujetas a RLS. El estado anterior se lee y bloquea en el servidor para no decidir el refresco de contadores con una caché local obsoleta.

La función anterior `save_recipe` se conserva para mantener compatibles los frontends ya desplegados. Esta nueva migración puede ejecutarse de nuevo: usa `create or replace` y vuelve a fijar los permisos. No se ha aplicado contra el proyecto remoto desde esta tarea.

Para las valoraciones parciales, ejecuta también [20261019000200_partial_recipe_rating.sql](supabase/migrations/20261019000200_partial_recipe_rating.sql), después de las anteriores y antes de desplegar. Añade `rate_recipe(uuid,integer)` con `SECURITY INVOKER`, comprobación de editor y ejecución restringida a `authenticated`.

## Cambios en el frontend

- El guardado completo, incluidas las fotos, se coordina en `RecipeService`. Solo consulta el detalle una vez, al terminar, y emite un único aviso de cambio para que el listado se recargue una vez.
- Todas las modificaciones de metadatos de fotos, también al añadirlas, pasan por `sync_recipe_photos`: sustitución transaccional y comprobación de versión, sin borrado/restauración desde el navegador.
- Si no cambian fotos, orden o textos alternativos, no se consulta `recipe_photos`, no se comprueban permisos adicionales para fotos y no se escribe en Storage. Para los cambios reales se conserva la comprobación de permisos y la sincronización.
- Los contadores solo se consultan al cargar el listado con caché caducada o después de crear, borrar o cambiar el estado pendiente. Cambiar un nombre, una valoración o las fotos no requiere recalcularlos si el estado pendiente no cambia.
- Detalles completos y contadores se guardan en `CacheService` con claves separadas por proyecto y una caducidad de 60 segundos. `recipeDetailCacheTtlMs` y `recipeStatsCacheTtlMs`, en ambos entornos, permiten ajustar los plazos. Leer la caché no prolonga el plazo.
- El listado usa `RecipeCard`, con campos visibles, número de ingredientes y metadatos de fotos. No descarga pasos, cantidades, anotaciones ni URL de origen. Las tarjetas nunca alimentan la caché de detalles: el detalle completo se pide al abrir la receta. Se conservan filtros, paginación y carrusel.
- Se comparten peticiones simultáneas al mismo detalle o a los contadores. Un guardado o borrado invalida la caché correspondiente; una respuesta antigua no puede sobrescribir una versión nueva ni recuperar una receta borrada.
- Si falla una foto o la lectura final después de guardar la receta, el formulario conserva el ID y permite reintentar como edición, evitando crear una receta duplicada. Un fallo al actualizar contadores no convierte un guardado ya confirmado en un guardado fallido.

La caché de datos públicos no contiene autorizaciones. La sesión y las comprobaciones de permisos mantienen su comportamiento. Los cambios de otros usuarios se ven en la siguiente carga con caché vencida o al refrescar explícitamente; no se ha añadido sincronización en tiempo real.

## Listado, búsqueda y valoraciones

- `RecipeListService` mantiene en memoria una sola colección con los filtros, búsqueda, tarjetas y paginación. El componente guarda el scroll antes de salir y lo restaura cuando el listado está renderizado, tanto con Atrás como con el breadcrumb o navbar.
- Volver del detalle sin cambios reutiliza las tarjetas y no repite su consulta. Si se ha guardado, puntuado o eliminado una receta en esta aplicación, se refresca toda la ventana que estaba cargada, conservando filtros y scroll. Las listas grandes se recuperan por lotes y se respetan los límites de respuesta de la API. Cambiar filtros reinicia la paginación.
- Este estado de navegación no usa `localStorage`, se pierde al recargar la web y no recibe cambios de otras pestañas o usuarios en tiempo real. Los fallos y las cargas interrumpidas no sustituyen una página ya cargada por una respuesta antigua.
- El buscador consulta únicamente `recipes.name`, sin distinguir mayúsculas y minúsculas. Se mantienen el mínimo de dos caracteres, la espera de 300 ms y el escape de comodines. No consulta relaciones para buscar por ingredientes.
- Puntuar envía únicamente ID y valoración. La RPC valida el valor, bloquea la receta y actualiza valoración, pendiente y fecha; no reescribe los demás campos ni relaciones. Devuelve si ha cambiado el contador de pendientes. El detalle visible se actualiza en memoria y se invalida su caché persistente para no prolongar datos ajenos a la escritura parcial.
- El formulario completo continúa utilizando el guardado transaccional para editar el conjunto de la receta.

## Carga por sección y código bajo demanda

- Supabase utiliza su transporte normal: se ha eliminado la cola global y la copia completa de cada respuesta. Las consultas independientes pueden ejecutarse a la vez.
- `LoadingService.run(operation, section)` cuenta operaciones simultáneas por sección; `isLoading(section)` solo termina cuando finalizan todas las de esa sección, también si fallan. Las peticiones compartidas de detalles/contadores cuentan como una operación.
- Los listados, el detalle y las recetas relacionadas diferencian carga, error recuperable, vacío y elemento inexistente. Cargar más mantiene las tarjetas ya visibles. El catálogo de ingredientes y las estadísticas tienen estados independientes. Se ha eliminado el overlay global que bloqueaba la aplicación.
- Los detalles de receta/ingrediente y el listado de ingredientes se cargan mediante rutas `loadComponent`. El formulario y el visor de fotos usan `@defer`; el optimizador de imágenes se importa únicamente al subir fotos nuevas.
- Mientras se guarda un formulario se deshabilitan sus controles y el cierre. Se evitan envíos repetidos, y una operación fallida vuelve a habilitarlo.

## Imágenes

Las dos primeras tarjetas dan prioridad a sus fotos; las demás usan `loading="lazy"`. El detalle prioriza su foto principal. Las imágenes se decodifican de forma asíncrona, y tarjetas, detalle y previsualizaciones declaran dimensiones.

Las fotos nuevas JPG/PNG se convierten a WebP con calidad 0,82 y un lado máximo de 1600 píxeles, solo si el resultado ocupa menos. Si el navegador no puede convertirlas se conserva el original. GIF, WebP y AVIF no se recomprimen. Las subidas tienen nombres únicos y una duración de caché HTTP de un año. Las fotos ya existentes no se modifican ni se generan miniaturas en el servidor; esta mejora no añade llamadas a servicios de transformación.

## Caché acotada

La caché de datos se limpia al iniciar y guardar: caducados/corruptos, máximo 80 entradas y unos 2 MiB de texto serializado, descartando las más antiguas. La memoria de detalles completos se limita a 40 recetas. La sesión queda fuera de esos límites y mantiene su plazo independiente. Ver [CACHE.md](CACHE.md).

## Llamadas esperadas

Sin contar renovación de tokens, eventos de autenticación independientes ni recargas adicionales del listado:

| Operación | Llamadas |
| --- | --- |
| Editar texto sin cambiar fotos ni pendiente | 3: permiso, guardado, detalle final |
| Crear una receta sin fotos | 4: permiso, guardado, detalle final, contadores |
| Cambiar pendiente sin cambiar fotos | 4 |
| Puntuar una receta ya probada | 2: permiso y valoración parcial |
| Puntuar una receta pendiente | 3: permiso, valoración parcial y contadores |
| Volver al listado sin cambios | 0 consultas de recetas; los contadores conservan su TTL independiente |
| Abrir un detalle aún en caché | 0 |
| Cargar ambos contadores sin caché | 1 |
| Volver a pedir contadores aún en caché | 0 |

Los cambios de fotos añaden las lecturas, escrituras y subidas necesarias. Los `SELECT` y escrituras dentro de las funciones SQL siguen teniendo coste de base de datos: reducir peticiones HTTP no elimina ese trabajo.

## Validación

`npm run test:optimization` verifica los flujos reales de los servicios con transporte Supabase simulado: número de llamadas, caché, caducidad, deduplicación, guardado, fotos, borrado y reintentos. `npm run build` y `npm run lint` comprueban el frontend. Las pruebas no ejecutan SQL contra Supabase; después de aplicar la migración, confirma la lectura con un visitante y el guardado con un editor autorizado.

## Fotos: borrado y sincronización seguros

Aplica [20261020000300_atomic_recipe_photos.sql](supabase/migrations/20261020000300_atomic_recipe_photos.sql) después de las anteriores y antes de desplegar este frontend. `sync_recipe_photos` bloquea la receta, compara los metadatos actuales con la versión leída y aplica todos los cambios o ninguno. Una edición antigua recibe un conflicto en lugar de sustituir fotos nuevas. Conserva los identificadores de las fotos retenidas. Las funciones usan `SECURITY INVOKER`, RLS y comprobación de editor.

`delete_recipe_with_photos` elimina la receta y registra sus rutas en `recipe_photo_cleanup` dentro de una misma transacción. El cliente solo toca Storage después de recibir la confirmación. La cola conserva los archivos pendientes si Storage falla; `cleanupPending` comparte peticiones simultáneas, comprueba que no existan referencias activas y procesa hasta 100 archivos. Se reintenta en posteriores modificaciones de fotos o borrados de recetas. Los fallos de limpieza se notifican sin presentar el guardado o borrado confirmado como fallido. No se ha añadido una tarea programada de limpieza.

Una respuesta de red perdida puede ocultar una sincronización confirmada. Por ello, después de enviar la RPC no se borran automáticamente las subidas nuevas en caso de error. Esto evita destruir fotos ya referenciadas, aunque pueda dejar archivos huérfanos si la transacción no llegó a confirmarse. Las subidas incompletas anteriores al envío de metadatos sí intentan limpiar sus archivos.

Para ejecutar las nueve pruebas SQL aisladas, instala la dependencia temporal fuera de `package.json` y del lockfile del proyecto:

```powershell
npm install --prefix .angular/sql-validation --no-save --package-lock=false @electric-sql/pglite
npm run test:photos:sql
```

Las pruebas usan las definiciones reales de las tablas y la nueva migración en PostgreSQL/WASM, con identidades y políticas de prueba. Comprueban rollback, reordenación, conflictos, permisos y la cola; no acceden a Supabase remoto ni prueban el servicio Storage real.

## Búsqueda compartida e índice de ingredientes

`search.utils.ts` centraliza la normalización de texto y la espera de búsquedas. `recipe-filters.utils.ts` reúne el flujo de controles y la clave normalizada usada en el listado y en la caché del planner. Se conserva la diferencia de presentación para términos incompletos: el listado mantiene su último criterio válido y el selector retira resultados seleccionables. El selector también evita volver a cargar resultados antiguos durante una búsqueda pendiente.

`IngredientService` reconstruye el índice solo al cambiar el catálogo. `ingredient-search.utils.ts` mantiene los nombres ya normalizados y mapas por ID y nombre; el buscador, los formularios de receta/ingrediente y el catálogo reutilizan ese índice. La exclusión de ingredientes seleccionados utiliza `Set`. `tests/search.test.cjs` verifica los casos con acentos, mayúsculas, términos incompletos, debounces, restablecimiento y selección de etiquetas sin repetir la normalización de cada nombre.

## Catálogo bajo demanda y cancelación del listado

Inyectar `IngredientService` o suscribirse a sus observables no inicia consultas. Los consumidores llaman a `ensureLoaded` cuando necesitan ingredientes; el selector de ingredientes de recetas se crea al mostrar los filtros, que ahora permanecen siempre visibles tanto en el listado como en el selector del planner. Compra conserva la carga diferida de su panel Añadir ingredientes. El catálogo resumido incluye solo ID, nombre y categoría y se reutiliza entre filtros, páginas y formularios.

La lectura del catálogo usa lotes de hasta 200 filas con orden estable por ID y un recuento exacto en la primera petición. El offset avanza según las filas recibidas, incluso si la API limita cada respuesta a menos filas. Se publica el conjunto completo una vez terminado. Si falla una página, se conserva el catálogo anterior y se puede reintentar sin validar formularios contra datos parciales. Las cargas concurrentes comparten una promesa; una escritura durante una lectura invalida la respuesta antigua y reinicia la carga.

`ensureDetails(id)` solicita composición y cantidades solo para ese ingrediente, conserva su distinción respecto al catálogo y comparte solicitudes simultáneas. Los detalles y formularios de edición cargan esos datos antes de presentarlos como completos; los formularios conservan cantidades, selecciones y borradores. Los resultados anteriores a una actualización o borrado no pueden recuperar versiones antiguas del ingrediente.

Crear o editar un ingrediente usa la RPC de escritura e incorpora los datos confirmados al índice local, sin otra descarga del catálogo. Los fallos de una recarga independiente no convierten una escritura persistida en un error. Si había una carga en curso, se descarta su revisión antigua y se conserva el detalle guardado al publicar el catálogo completo. Una página vacía antes de alcanzar el total esperado tampoco publica un catálogo parcial.

## Mantenimiento del código

La lógica del antiguo congelador está integrada en `inventory.model.ts` e `inventory.utils.ts`: alacena y congelador comparten validación, ordenación, cantidades y retiradas, conservando las medidas históricas. Las tarjetas y los detalles de recetas comparten la transformación de sus campos comunes. Los fondos sin foto se definen en `root.css` y las clases comunes en `styles.css`; se han retirado los estilos de controles sustituidos y de las antiguas páginas de error.

Los guardados diarios capturan una copia independiente y comprueban que sigue activa la misma cuenta después de verificar permisos. Invalidan las lecturas anteriores y las iniciadas durante la escritura, también cuando se pierde la respuesta. Compra reutiliza el bloqueo de scroll compartido para sus diálogos anidados.

`npm test` ejecuta todas las pruebas, incluidas las de SQL y las vistas previas. TypeScript rechaza variables y parámetros sin uso mediante `noUnusedLocals` y `noUnusedParameters`. La aplicación no carga Zone.js y ya no lo declara como dependencia directa.

`RecipeListService` crea un `AbortController` por carga. Al cambiar criterios o revisión, o al irse el último suscriptor, aborta la petición y detiene las páginas siguientes de un refresco grande. Las cancelaciones no producen avisos de error ni sustituyen el estado guardado. Una petición ya completada no se aborta. El transporte de `RecipeService.getBatch` recibe la señal tanto para búsquedas normales como por ingredientes.

`tests/ingredients.test.cjs` cubre catálogos mayores de mil elementos, límites de respuesta inferiores al lote solicitado, carga diferida, errores/reintentos, detalles selectivos, peticiones compartidas y escrituras concurrentes. Las pruebas del listado verifican las señales de cancelación, el último suscriptor y el abandono de refrescos por lotes. En Chrome con Supabase simulado se comprobaron cero lecturas de ingredientes con filtros cerrados, tres páginas para 205 ingredientes limitadas a 80 filas por respuesta, reutilización entre pantallas, cantidades al editar una elaboración y cancelación real de una consulta de recetas obsoleta. Estos cambios no requieren una migración nueva.

## Lista de la compra

`ShoppingListService` conserva el borrador al navegar, comparte lecturas simultáneas y limpia su estado al cambiar de cuenta. Las respuestas tardías no restauran datos de otra sesión. El selector manual reutiliza el catálogo resumido y su índice normalizado; las adiciones usan `Map` por UUID y las validaciones usan `Set` para detectar duplicados.

La RPC `shopping_ingredients_from_plan` agrega los ingredientes en PostgreSQL y devuelve únicamente identificador, nombre, categoría y apariciones. El navegador no descarga recetas completas ni sus pasos, fotos o cantidades. Las respuestas se paginan con orden estable, un recuento exacto inicial y avance por las filas recibidas; la vista previa solo se publica completa. El calendario está integrado en la pestaña Según planning; cambiar fechas, volver a Manual o salir de la página aborta el cálculo anterior.

El guardado personal usa una versión esperada y una sola transacción. Si otro dispositivo ha guardado desde la carga, se conserva el borrador y se informa del conflicto. Los ingredientes se almacenan como instantánea para que cambios del catálogo no destruyan una lista ya guardada.

Los resultados de intervalos idénticos se reutilizan durante cinco minutos, con un máximo de veinte entradas en memoria y copias independientes para cada consumidor. Las peticiones simultáneas comparten el cálculo; cancelar un consumidor solo aborta el transporte si era el último. Pulsar repetidamente el mismo extremo sin cambiar fechas no reinicia una consulta en curso. Guardar un día invalida antes y después de la escritura; los cambios de recetas y publicaciones del catálogo también invalidan estos resultados. Las respuestas anteriores a una invalidación, fallidas o canceladas no repueblan la caché. Cambiar de cuenta o perder permisos limpia los datos privados. Las escrituras de otros dispositivos se ven tras vencer la caché; no hay actualizaciones en tiempo real.

Guardar, recargar y sustituir la lista desde el planning esperan a que termine cualquier creación de ingredientes. Se impide iniciar un alta durante el guardado, y una creación confirmada no anuncia su adición si el selector ya no puede modificar la lista.

Ejecuta `npm run test:shopping` para las pruebas de servicios y utilidades, incluidas las de categorías, limpieza del borrador, incremento del contador, persistencia, límites, caché de intervalos y protección durante guardados y cambios de cuenta. `npm run test:shopping:sql` ejecuta diez pruebas con las migraciones reales de compra y categorías en PostgreSQL/WASM y usa la misma dependencia temporal PGlite de las pruebas SQL de fotos; no accede al proyecto remoto. La página requiere aplicar [20261020000400_shopping_lists.sql](supabase/migrations/20261020000400_shopping_lists.sql) y [20261021000100_ingredient_categories.sql](supabase/migrations/20261021000100_ingredient_categories.sql) antes de desplegar. Las categorías de los formularios, filtros y la validación local se derivan de `INGREDIENT_CATEGORIES`.
