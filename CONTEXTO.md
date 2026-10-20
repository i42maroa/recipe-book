# Contexto del proyecto

Actualizado el 20 de octubre de 2026. Este documento describe lo implementado en el repositorio y las decisiones vigentes. Las migraciones de Supabase y la publicación de cada versión en Vercel se realizan por separado; este documento no confirma su estado remoto.

El comportamiento vigente incluye la separación entre consulta, edición diaria y edición semanal, la caché de navegación del planner, la precarga visual de listados y detalles y la última reorganización de filtros de recetas. Las secciones siguientes describen el resultado actual, sin recuperar los diseños anteriores de planes o favoritos.

## Propósito y estado actual

**Laurel** es un recetario personal para consultar y organizar recetas preparadas y recetas pendientes de probar, junto con sus ingredientes y elaboraciones.

La aplicación incluye consulta pública, creación, edición y eliminación autorizadas, fotografías, valoraciones, búsqueda por nombre, filtros, enlaces para compartir y navegación adaptada a escritorio, tablet y móvil. La integración utiliza datos de Supabase.

## Tecnologías y decisiones de arquitectura

- **Frontend:** Angular 22, componentes standalone, formularios reactivos, signals y RxJS.
- **Persistencia:** PostgreSQL en Supabase, consultado directamente desde Angular mediante `supabase-js` y la API PostgREST.
- **Autenticación:** Supabase Auth, con Google y correo/contraseña.
- **Fotografías:** Supabase Storage, bucket público `recipe-photos`.
- **Alojamiento configurado:** Vercel, con salida estática en `dist/recetario/browser` y reescritura SPA en `vercel.json`.
- **Comprobaciones:** Angular CLI, ESLint y pruebas de servicios con `node:test`.

**Decisión vigente:** mantener Angular conectado directamente a Supabase. No se ha añadido una API intermedia propia, funciones de backend en Vercel, Spring Boot, Redis ni una pasarela con límites por IP o usuario. La API propia queda como una posible evolución, aplazada por decisión del usuario.

## Convenciones de desarrollo

- Los componentes son standalone y tienen responsabilidades acotadas.
- Cada componente mantiene su plantilla HTML y sus estilos CSS en archivos separados, mediante `templateUrl` y `styleUrl`. No introducir plantillas ni estilos inline en TypeScript.
- Los colores, tipografías y valores visuales compartidos se centralizan en `src/styles/root.css`; los componentes consumen esas variables. Los estilos globales están en `src/styles.css`.
- Los controles comunes, iconos, navegación, formularios y notificaciones se reutilizan mediante componentes compartidos.
- `SearchFilterComponent` y `SelectFilterComponent` se integran con los formularios mediante `ControlValueAccessor`; `writeValue` y `setDisabledState` notifican la actualización visual con `markForCheck`. Esto permite limpiar los filtros desde los contadores sin dejar textos antiguos en pantalla. El select admite `compact` para ajustar su ancho al valor seleccionado; los demás selects mantienen su tamaño habitual.
- Los componentes compartidos viven en `src/app/components/shared/`; las tarjetas específicas, en `components/`; las pantallas enrutables, en `pages/`; los servicios de dominio y estado, en `services/`.
- El acceso a datos y la lógica reutilizable se mantienen en servicios; los componentes presentan datos y gestionan la interacción.
- Los formularios son reactivos. `BaseFormComponent` presenta el formulario de receta o ingrediente según su tipo, y `FormService` coordina los diálogos y el guardado de recetas.
- `NotificationService` y el centro de notificaciones unifican los avisos de éxito y error.
- Las imágenes tienen textos alternativos; los controles mantienen etiquetas accesibles, estados de carga y navegación por teclado donde está implementada.
- Las comprobaciones de permisos del frontend acompañan a RLS, que es la protección de las escrituras en la base de datos.

## Rutas, navegación y diseño adaptable

| Ruta | Comportamiento |
| --- | --- |
| `/` | Redirige a `/recipes`. |
| `/recipes` | Colección, búsqueda, filtros, contadores y paginación de recetas. |
| `/recipes/:id` | Detalle de una receta. |
| `/ingredients` | Catálogo de ingredientes y elaboraciones. |
| `/ingredients/:id` | Detalle, componentes y recetas relacionadas con un ingrediente. |
| `/planner` | Consulta de las comidas de hoy con tarjetas completas y enlace Editar; si no hay comidas, muestra un mensaje con Planificar Día. Exclusiva de editores autenticados. |
| `/planner/day` | Editor de las comidas de hoy, con breadcrumb Planificación / Día. Exclusiva de editores autenticados. |
| `/planner/week` | Calendario de siete días desde hoy, navegación por bloques de siete días y guardado por día. Exclusiva de editores autenticados. |
| `/login` | Acceso con Google o correo/contraseña y comprobación de permisos. |
| Cualquier ruta desconocida | Página 404, conservando la URL introducida. |

El componente raíz compone el navbar, el breadcrumb, el `router-outlet`, las notificaciones y el formulario cuando se abre.

- En escritorio, el navbar se presenta como una barra lateral.
- En tablet y móvil, hasta 1120 px, un botón hamburguesa abre el menú sobre el contenido y ocupa la pantalla completa. Abrirlo no empuja el detalle hacia abajo y bloquea el scroll del fondo.
- El menú se cierra al navegar o pulsar Escape y contiene el foco del teclado mientras está abierto en estas resoluciones.
- Las acciones **Editar** y **Eliminar** aparecen en el navbar, en filas separadas bajo las opciones principales, con iconos y solo para editores autorizados cuando hay un detalle cargado.
- El navbar muestra el usuario conectado y **Cerrar sesión**. En escritorio están en filas diferentes; en tablet y móvil comparten fila.
- Se mantienen el breadcrumb y los accesos contextuales entre recetas e ingredientes. Hay accesos flotantes de creación en resoluciones pequeñas para los editores.
- El acceso del menú se llama **Planificación** y apunta a `/planner`. El calendario semanal está en `/planner/week`, con título **Planificación semanal** y breadcrumb **Planificación / Semanal**. El editor diario está en `/planner/day`, con título **Planificación del día** y breadcrumb **Planificación / Día**. La antigua ruta `/planner/new` no tiene un alias ni redirección configurados y se resuelve como ruta desconocida.

### Página 404

`NotFoundPageComponent` se reutiliza para rutas desconocidas, recetas inexistentes e ingredientes inexistentes, con mensajes adecuados a cada caso y enlaces para volver a los listados.

La URL original se conserva. Los UUID mal formados se detectan antes de consultar el detalle de receta o las recetas relacionadas con un ingrediente. Durante la carga no se muestra un falso resultado inexistente: los errores de conexión conservan su mensaje y la opción de reintentar.

La página 404 adapta su diseño a móvil, cambia el título del documento y establece `noindex, nofollow`. Al salir restaura los metadatos anteriores. `vercel.json` permite cargar Angular también al abrir directamente una ruta desconocida.

## Funcionalidades de recetas

### Datos y validaciones

El modelo completo `Recipe` contiene identificador, nombre, ingredientes y cantidades, minutos, comensales, pasos ordenados, estado pendiente, tipos de plato, cocinas, valoración, URL de origen, anotaciones, indicador fitness, dificultad y fotografías.

- Son obligatorios el nombre sin espacios vacíos, al menos un ingrediente y el estado pendiente o elaborada.
- El formulario valida un tiempo positivo cuando se indica, comensales enteros mayores que cero y valoración entera del 1 al 10.
- Una receta pendiente se guarda sin valoración. Puntuar desde el detalle la marca como preparada.
- Los tipos de plato son `Desayuno`, `Entrante`, `Plato` y `Postre`; se puede seleccionar más de uno.
- Las dificultades son `Fácil`, `Media` y `Difícil`.
- Las cocinas disponibles son española, italiana, mexicana, japonesa, china, india, francesa, peruana, árabe y otra; se muestran con sus etiquetas y banderas.
- Las cantidades permiten no indicar cantidad, una cucharada, un vaso o una cantidad específica positiva en `ml`, `g` o `pieza`. La cantidad pertenece a la relación receta–ingrediente.

### Listado y búsqueda

- La carga inicial muestra 20 recetas; **Cargar más recetas** añade lotes de 10.
- El buscador consulta únicamente el nombre de la receta, sin distinguir mayúsculas y minúsculas. No busca dentro de los ingredientes.
- Un filtro independiente permite buscar ingredientes por nombre (mínimo dos caracteres, sin distinguir acentos ni mayúsculas), seleccionarlos como etiquetas y quitarlos individualmente. Las recetas deben contener al menos uno de los ingredientes seleccionados directamente en su lista; no se expanden componentes de elaboraciones. Primero aparecen las que contienen más ingredientes seleccionados y los empates usan el orden elegido. La RPC `search_recipes_by_ingredients` ordena antes de paginar y conserva RLS, los filtros restantes y los campos resumidos de las tarjetas. El selector del planner reutiliza este mismo filtro de ingredientes.
- Las etiquetas se conservan al navegar al detalle y volver, y **Recetas guardadas** limpia también la selección y el texto del buscador de ingredientes.
- Se mantiene un mínimo de dos caracteres, una espera de 300 ms y el escape de comodines. Vaciar el buscador elimina la búsqueda.
- El buscador, **Orden** y el botón **Filtros** comparten una fila en escritorio, tablet y móvil. El select **Orden** adapta su ancho al texto seleccionado, sin reservar el ancho de la opción más larga. **Filtros** abre y cierra el panel de tipo de plato, dificultad y búsqueda por ingredientes con sus etiquetas. El panel empieza cerrado y conserva su estado al navegar.
- Un único contenedor con fondo verde suave, borde y esquinas redondeadas reúne el buscador por nombre, el orden, el botón **Filtros** y su panel desplegable. Los contadores **Recetas guardadas** y **Por probar** presentan número y texto en la misma fila, alineados por su línea base. **Por probar** mantiene `aria-pressed` para accesibilidad sin resaltado visual de selección.
- No hay etiqueta de pendientes, casilla ni selector de estado en la barra. El contador **Por probar** activa solo recetas pendientes, manteniendo el resto de criterios. **Recetas guardadas** vuelve a todas: limpia búsqueda, estado pendiente, tipo de plato y dificultad, y conserva el orden elegido. Ambos contadores admiten clic, Enter y Espacio.
- El restablecimiento de filtros se procesa en una sola actualización de `RecipeListService`. Se reinician las suscripciones de controles mediante `filtersReset` para cancelar búsquedas que aún estuvieran esperando los 300 ms y evitar consultas intermedias o que reaparezcan filtros antiguos. Si los criterios ya son los mismos, no se fuerza otra consulta.
- `RecipeFiltersComponent`, en `components/shared/filters/recipe-filters/`, reúne el buscador por nombre, orden compacto, botón **Filtros**, tipo de plato, dificultad e ingredientes en un único contenedor verde adaptable. Se reutiliza en el listado principal y al añadir recetas a la planificación diaria o semanal. Recibe controles reactivos de cada pantalla y conserva sus respectivas suscripciones, cancelación y restablecimiento. El selector del planner utiliza `pending: 'all'`; sus criterios, etiquetas, estado desplegado y resultados se conservan independientemente del listado principal. La caché del selector distingue los conjuntos de ingredientes sin depender del orden de selección y se limpia al cambiar de cuenta.
- La ordenación permite más recientes, nombre A–Z, mejor puntuación o menor tiempo.
- Los contadores muestran el total de recetas guardadas y pendientes del recetario, no el número de resultados de la búsqueda actual. Son acciones de filtrado y se cargan independientemente de las tarjetas.
- `RecipeCard` es un modelo resumido para tarjetas: incluye los campos visibles, el número de ingredientes y los metadatos de fotos. El listado no descarga pasos, cantidades, anotaciones ni URL de origen y no guarda tarjetas como si fueran detalles completos.

### Conservación del listado al navegar

`RecipeListService` conserva en memoria una colección con búsqueda, filtros, orden, estado desplegado de los controles, tarjetas cargadas y posición de paginación. El componente guarda el scroll antes de salir y lo restaura tras renderizar el listado, al volver con Atrás, breadcrumb o navbar, también en móvil.

Volver sin cambios reutiliza las tarjetas sin consultar de nuevo las recetas. Si en esta aplicación se ha creado, editado, puntuado o eliminado una receta, se refresca toda la ventana previamente cargada, manteniendo filtros y scroll. Las ventanas grandes se recuperan por lotes y los cambios de filtro reinician la paginación.

Este estado no se guarda en `localStorage` y se pierde al recargar la web. No recibe actualizaciones en tiempo real de otras pestañas o usuarios. Las cargas interrumpidas y las respuestas antiguas no sustituyen la colección actual.

### Detalle, formularios y acciones

- El detalle presenta fotos, datos generales, ingredientes agrupados por categoría y cantidades, comensales, pasos, anotaciones, valoración y enlace de origen cuando existe.
- La fila del título reúne el nombre, los tipos de plato y el botón de compartir a la derecha, con su icono.
- El editor de recetas se organiza en cuatro secciones: **Datos**, **Ingredientes**, **Preparación** y **Fotos**. Permite crear ingredientes desde el propio formulario.
- Hacer clic fuera del modal de receta no lo cierra ni descarta el borrador. Para salir se usan las acciones explícitas **Cerrar** o **Cancelar**; el fondo conserva su comportamiento anterior en el formulario de ingredientes.
- Se pueden crear, editar, puntuar y eliminar recetas con los permisos adecuados. El borrado desde el navbar solicita confirmación.
- Durante el guardado se deshabilitan los controles y el cierre del formulario, se indica el progreso y se impiden envíos repetidos. Los fallos permiten reintentar.

### Compartir recetas

Se comparte la URL del detalle mediante `navigator.share` cuando está disponible, con copia al portapapeles como alternativa y una opción manual si la copia falla.

El enlace se construye siempre con `publicSiteUrl`, actualmente `https://recipe-book-neon-two.vercel.app`, y el ID de la receta. No utiliza el origen de localhost ni las URLs alternativas de preview de Vercel. El dominio público debe permitir la consulta sin autenticación de Vercel.

### Fotografías

- Se admiten hasta tres fotos por receta, con orden y texto alternativo. Hay carrusel en tarjetas y detalle, y visor ampliado con flechas de teclado y cierre con Escape.
- El formulario permite seleccionar o arrastrar archivos, previsualizarlos y quitar fotos. Los formatos son JPG, PNG, WebP, GIF y AVIF, con un máximo de 5 MiB por archivo. El bucket configura también tamaño y tipos MIME permitidos.
- Las fotos nuevas JPG/PNG se procesan en el navegador: lado máximo de 1600 píxeles y WebP con calidad 0,82, conservando el resultado solo si ocupa menos. Si la conversión no está disponible o falla, se usa el original. GIF, WebP y AVIF no se recomprimen.
- Las fotos ya almacenadas mantienen su tamaño. No se han generado miniaturas independientes para las tarjetas ni añadido transformaciones de imagen en el servidor.
- Las dos primeras tarjetas priorizan sus imágenes; el resto usa carga diferida. El detalle prioriza su foto principal. Se usa decodificación asíncrona y se declaran dimensiones en tarjetas, detalle y previsualizaciones.
- Las subidas utilizan nombres únicos y caché HTTP de un año. Los metadatos viven en PostgreSQL y los archivos en Storage.

## Planificación

- Las comidas se guardan directamente por usuario, fecha y hueco (desayuno, comida o cena), sin nombres, identificadores de plan, favoritos, listados de planes ni precarga de menús favoritos. No hay botón de nuevo plan ni selector global de fecha o comensales.
- `/planner` es una vista de consulta de hoy mediante `PlannerPageComponent`. Presenta las comidas en orden desayuno, comida y cena con `RecipeCardComponent`, fotos, metadatos y acceso al detalle. **Editar**, a la derecha de la fecha, abre `/planner/day`; no hay controles de modificación en la vista principal. Si hoy está vacío, oculta **Editar** y muestra un contenedor verde suave, del mismo color que los filtros de recetas, con **Todavía no has añadido comidas para hoy.** y los botones **Planificar Día** (`/planner/day`) y **Planificar Semana** (`/planner/week`). Durante la carga no se muestran esas acciones. Se ha retirado el enlace **Ver planificación semanal** del encabezado de esta vista.
- `/planner/day` reutiliza `PlannerEditorPageComponent` para editar solo hoy, siempre en modo de planificación, incluso con comidas guardadas. Su título es **Planificación del día** y el breadcrumb **Planificación / Día**. Conserva selector, filtros, duplicados, límite de cinco recetas por comida, ajustes de proporción/sobras, eliminación y guardado diario. Entrar no genera cambios pendientes. Guardar correctamente actualiza la caché de hoy y vuelve automáticamente a `/planner`, con las tarjetas actualizadas. Los fallos mantienen el borrador y salir con cambios pendientes solicita confirmación.
- Las tarjetas completas de hoy se consultan por los UUID elegidos mediante `RecipeService.getCardsByIds`, usando la misma selección y conversión que el listado. Se incluyen recuentos y fotos sin descargar pasos, cantidades, anotaciones ni URL de origen, y sin poblar la caché de detalles con tarjetas incompletas. Una receta eliminada muestra «Receta no disponible» sin abrir un falso modo vacío.
- `/planner/week` muestra siete fechas consecutivas desde hoy, sin ajustar el inicio al lunes: el martes 20 de octubre muestra del martes 20 al lunes 26. Dos botones con solo flechas, etiquetados para accesibilidad, desplazan la ventana siete días atrás o adelante (13–19 o 27–2 en ese ejemplo).
- `localDate()` toma el día local del navegador al crear la página. `dateNumber` valida fechas reales y `shiftDate` desplaza días de calendario usando UTC, con pruebas de cambios de hora, años bisiestos y cambios de año. La fecha semanal elegida queda en la URL; el editor diario siempre corresponde a hoy, no a una fecha arbitraria recibida por parámetros.
- Durante la carga semanal se mantienen visibles el mes, la fila de días y los siete encabezados con sus fechas. Los contadores y el contenido de desayuno, comida y cena muestran bloques de precarga animados, sin presentar ceros ni recetas antiguas como datos actuales. Los controles se deshabilitan hasta terminar, se anuncia la carga a lectores de pantalla y se respeta la preferencia de movimiento reducido. También se aplica al cambiar de semana y al reintentar una carga fallida.
- `/planner` y `/planner/day` mantienen la fecha y los huecos de desayuno, comida y cena con bloques animados durante la carga, también al reintentar tras un error. Al terminar, la vista principal muestra tarjetas completas o el mensaje vacío; `/planner/day` muestra el editor.
- El encabezado del calendario muestra mes y año: **Octubre 2026** en un mes, **Octubre - Noviembre 2026** si cruza meses del mismo año, o **Diciembre 2026 - Enero 2027** cuando cruza años. Los días muestran un único título con el formato **Miércoles, 21 Oct**.
- En los editores diario y semanal, el mensaje **Cambios sin guardar** y el botón **Guardar** solo aparecen en los días modificados y desaparecen tras guardarlos. Se guardan los tres huecos del día de forma atómica, sin modificar otras fechas. El editor semanal permanece abierto; el diario vuelve a `/planner` tras guardar. Quitar la última receta y guardar vacía ese día. Ambas rutas protegen los cambios pendientes al navegar.
- Se mantienen los botones **+** del encabezado y de cada comida ya creada, el modal de recetas con buscador, filtros, paginación y reintento, y el límite de cinco recetas distintas por hueco. No aparece **+ Añadir comida** bajo el día. La misma receta puede usarse en otros días o comidas, pero nunca dos veces en un mismo hueco, tampoco con otro modo de preparación ni variando mayúsculas del UUID. Se valida en la interfaz, en el servicio y en SQL.
- El modal usa `dialog` nativo: bloquea el scroll de fondo y restaura el foco al cerrarse; permite cerrar con Escape o pulsando fuera. Carga 20 recetas por lote, excluye de la selección las ya añadidas a ese hueco y conserva las tarjetas anteriores al reintentar una página adicional.
- Las recetas muestran el nombre enlazado al detalle en la misma pestaña, comensales con su icono y tipos de plato a la izquierda, y una **×** para quitarlas en el editor. Se pueden abrir en otra pestaña mediante los controles habituales del navegador. No se muestran cantidades de ingredientes. El selector de proporción o sobras aparece solo cuando los comensales originales no coinciden con los de esa comida.
- Los enlaces al detalle llevan `fromPlanner=today` desde la vista principal, `fromPlanner=day` desde el editor diario o `fromPlanner=week` desde el semanal; los semanales incluyen `plannerStart`. El calendario conserva su fecha inicial en `?start=AAAA-MM-DD`. El breadcrumb comienza en **Planificación** y añade **Día** o **Semanal** cuando procede, permitiendo volver a la página de origen. El origen y la fecha se conservan al recargar y consultar ingredientes desde la receta; las recetas abiertas desde el recetario mantienen su breadcrumb habitual.
- En modo de planificación, las recetas pendientes muestran **Nueva** a la derecha de la fila de comensales y tipo de plato, tanto al añadirlas como al recuperar comidas guardadas. El resumen consulta `pending` sin cargar ingredientes ni cantidades. Las tarjetas completas de hoy mantienen las etiquetas propias del listado.
- Cada comida conserva sus comensales y el modo elegido por receta. Las comidas nuevas usan dos comensales por defecto; no hay selector global de fecha ni comensales. La migración conserva los valores existentes.
- Los cambios pendientes se registran por fecha: guardar un día no marca como guardados los demás. Se pide confirmación al salir o cambiar de semana con cambios pendientes; los errores conservan el borrador para reintentar.
- Durante un guardado se bloquean los controles y la salida para evitar escrituras repetidas. En `/planner/day`, la navegación de vuelta solo se inicia después del éxito, de limpiar los cambios pendientes y de liberar el estado de guardado; por eso no aparece una confirmación de descarte tras guardar. Al eliminar la última receta también vuelve a `/planner`, mostrando el estado vacío y **Planificar Día**.
- Los borradores editables viven en el componente: no se persisten ni se recuperan después de descartar o recargar. La caché de comidas contiene selecciones guardadas, no cambios pendientes.
- Se compara el contenido actual con una copia del día guardado, ignorando huecos vacíos: deshacer una modificación o añadir y quitar la misma receta elimina el aviso y evita guardados innecesarios. Las entradas, identificadores y contadores por comida/fecha se derivan mediante un único `computed`.
- Las tres rutas requieren un editor autenticado, usan `noindex, nofollow` y permiten volver mediante el breadcrumb. Cerrar sesión o cambiar de usuario limpia el estado privado. No hay caché local persistente de comidas.
- `ScheduledMealService` consulta solo la fecha actual en `/planner` y `/planner/day`, y las siete fechas visibles en `/planner/week`, siempre restringidas al propietario. Usa `save_scheduled_day(date,jsonb)` para guardar un día. `scheduled_meals` tiene clave `(owner_id, meal_date, slot)`, RLS de propietario/editor y validaciones de comensales, tipos, modos, UUID, duplicados y límite de recetas. No hay una entidad que agrupe la semana.
- `ScheduledMealService` conserva hasta 56 fechas, incluidas las vacías, durante cinco minutos en memoria. Volver desde una receta reutiliza esas comidas sin consultarlas de nuevo; guardar sustituye la fecha afectada e invalida respuestas anteriores al guardado. Se comprueban permisos incluso al reutilizar comidas. No hay persistencia de comidas en `localStorage` ni se comparte la caché entre pestañas.
- `PlannerStateService` conserva durante cinco minutos hasta 300 tarjetas y 300 resúmenes, además de los filtros y hasta ocho resultados del selector con un máximo de 200 recetas cada uno. Reabrir el selector o volver del detalle reutiliza estos datos. Crear, editar, puntuar o eliminar una receta en esta aplicación invalida metadatos y resultados del selector, conservando las comidas. Ambas cachés se limpian al cambiar de usuario, cerrar sesión o revocarse permisos.
- Las cachés del planner están limitadas y separadas por usuario; devuelven copias para que la edición no modifique lo guardado en memoria. No se comparten entre pestañas ni sobreviven a recargar. La caducidad no inicia una consulta por sí sola mientras la pantalla permanece abierta: los cambios externos se recuperan en una consulta posterior con la entrada caducada o al recargar la web. Los resultados del selector de más de 200 recetas siguen siendo utilizables, pero esa ventana no se conserva para reabrirla.
- Las consultas de lectura del planner y selector reciben `AbortSignal`: cambiar filtros, cambiar de carga o abandonar/cerrar la vista cancela las peticiones que ya no sirven. Los guardados no se cancelan. Las respuestas tardías no repueblan cachés invalidadas.
- La migración `20261020000100_daily_meals.sql` transfiere las comidas antiguas a sus fechas. En rangos solapados gana el registro actualizado más recientemente por usuario y fecha, incluidos huecos vacíos; se quitan duplicados del mismo hueco conservando la primera entrada. Los favoritos no se convierten en comidas fechadas. Los datos antiguos se conservan como archivo sin acceso de navegador.
- No incluye lista de la compra, texto libre, generación automática, menús individuales por persona ni sincronización en tiempo real.

La nueva migración debe aplicarse después de las anteriores y antes de desplegar este frontend. Las pruebas locales no ejecutan migraciones ni confirman RLS en el proyecto remoto.

## Funcionalidades de ingredientes y elaboraciones

- Listado con búsqueda, filtro de categoría, agrupación por categorías y número de resultados.
- Creación, edición y eliminación para editores autorizados.
- Las categorías del modelo son `Verdura`, `Fruta`, `Legumbre`, `Pescado`, `Carne`, `Lacteo`, `Cereal`, `Especia`, `Elaboracion` y `Otro`; las etiquetas visibles pueden llevar acentos.
- Una elaboración tiene componentes y cantidades propias y se puede utilizar en recetas como otro ingrediente.
- El detalle muestra los componentes de la elaboración y las recetas donde se utiliza el ingrediente. Las recetas relacionadas tienen carga, error y reintento independientes del detalle del ingrediente.
- Las claves foráneas impiden eliminar ingredientes referenciados por recetas o elaboraciones.
- El catálogo se solicita bajo demanda, solo con `id,name,category`, por páginas de hasta 200 filas ordenadas por ID. La siguiente página parte del número real de filas recibidas, para respetar límites de respuesta menores; solo la primera consulta pide recuento exacto. Se publica el catálogo completo al terminar, sin emitir páginas parciales que puedan borrar selecciones de formularios. Las cargas simultáneas se comparten y una carga fallida permite reintentar conservando el catálogo anterior.
- Los filtros cerrados no crean el selector de ingredientes hasta la primera apertura (`@defer`). Abrir el catálogo, un formulario o un detalle de receta pide únicamente el resumen del catálogo. La composición y cantidades se consultan por ingrediente con `ensureDetails`, al abrir su detalle o editarlo; esas peticiones también se comparten y no se presentan resúmenes como detalles completos. Los formularios de edición esperan a recibir esa información. Después de crear o modificar un ingrediente se refresca el catálogo resumido y se conserva el detalle del elemento guardado; reducir esos refrescos completos queda pendiente.

## Autenticación, permisos y sesión

La consulta de recetas, ingredientes y fotos es pública, tanto sin sesión como con una cuenta que no tenga permisos de edición. Todos los editores autorizados gestionan el mismo recetario.

- `/login` permite acceder con Google o correo y contraseña, comprobar permisos y cerrar sesión. No hay botones ni enlaces hacia esa ruta en el resto de la web: se accede escribiendo el path.
- No hay formularios de registro ni recuperación de contraseña en la aplicación.
- Google OAuth se configura en Google Cloud y en el proveedor de Supabase. El retorno apunta al origen actual más `/login`; las URLs deben estar autorizadas en Supabase. Los secretos del proveedor no se guardan en Angular.
- La autorización depende del UUID de Supabase Auth y de su pertenencia a `private.recipe_editors`, administrada desde SQL Editor o un backend de confianza. Entrar con Google no concede permisos de edición automáticamente.
- `AuthService` consulta `is_recipe_editor()` al restaurar o cambiar la sesión y antes de las escrituras. Las autorizaciones no se guardan como una concesión local en caché.
- Un fallo temporal al consultar permisos bloquea la operación y permite reintentar sin borrar el usuario verificado ni el borrador del planner. Una respuesta que deniega permisos, el cierre de sesión o el cambio de usuario sí limpian el estado privado y cierran el acceso.
- Las migraciones aplican lectura pública y escritura restringida mediante permisos PostgreSQL, RLS y políticas de Storage. Las RPC de escritura usan `SECURITY INVOKER`.
- Angular utiliza la clave pública publishable/anon. Nunca debe incluir claves `secret`, `service_role` ni el secreto OAuth.

La sesión se persiste mediante el adaptador de `CacheService` para Supabase, con renovación automática y `sessionCacheTtlMs` configurado en 30 días desde el último guardado o renovación. Se restaura al abrir la aplicación, volver del segundo plano, recuperar el foco, mostrar una página restaurada o recuperar la conexión. Se agrupan restauraciones simultáneas y una pérdida temporal de conexión no borra por sí sola al usuario.

Cerrar sesión elimina la persistencia, incluida la compatibilidad con el formato anterior. Los tokens siguen sujetos a caducidad y revocación de Supabase. La persistencia depende del navegador y del origen: cambiar de dominio, usar otro navegador o borrar los datos del sitio puede requerir iniciar sesión de nuevo.

Configuración y administración del grupo: [SUPABASE.md](SUPABASE.md). Comportamiento de sesión y caché: [CACHE.md](CACHE.md).

## Carga, caché y optimizaciones de acceso a datos

### Carga por sección y código bajo demanda

- `SupabaseService` centraliza el cliente y utiliza el transporte normal de Supabase. Se eliminó la cola global que serializaba peticiones y la clonación completa de respuestas.
- `LoadingService.run(operation, section)` registra operaciones concurrentes por sección. El estado continúa activo hasta finalizar todas las operaciones de esa sección, también si fallan.
- Listados, detalles, ingredientes, contadores, recetas relacionadas y formularios muestran sus propios estados. No hay un overlay global que bloquee toda la aplicación durante cualquier petición.
- Los listados de recetas e ingredientes mantienen visibles encabezados y filtros durante la carga y muestran tarjetas de precarga animadas con sus cuadrículas habituales; los contadores también usan bloques de precarga. Cargar más recetas conserva las tarjetas anteriores y añade bloques al final hasta recibir el siguiente lote. Los errores, resultados vacíos y reintentos conservan sus estados propios.
- Los detalles de receta e ingrediente muestran su estructura de imagen/icono, título, metadatos y secciones mientras esperan los datos. Los ingredientes de la receta y las recetas relacionadas del ingrediente cargan por separado, con precarga solo en su sección. Las páginas 404 no aparecen antes de resolver la consulta.
- `SkeletonComponent`, en `components/shared/skeleton/`, reutiliza bloques, tarjetas, filas y párrafos de precarga. Usa las variables visuales existentes y respeta `prefers-reduced-motion`. Los bloques son decorativos (`aria-hidden`); los contenedores usan `aria-busy` y los mensajes de carga para lectores de pantalla se presentan aparte. No genera datos ficticios ni cambia consultas o cachés.
- Se diferencian carga, vacío, elemento inexistente y error recuperable. Cargar más mantiene las tarjetas anteriores; los errores permiten reintentar.
- Las rutas de detalle, ingredientes, las tres páginas del planner, login y 404 se cargan con `loadComponent`. `PlannerPageComponent` contiene solo consulta y navegación; `PlannerEditorPageComponent` comparte la modificación entre `/planner/day` y `/planner/week` mediante los datos de la ruta. El formulario y el visor usan `@defer`, y el optimizador de imágenes se importa al subir fotos nuevas.

### Caché de datos

- `CacheService` centraliza `localStorage` con el prefijo `laurel:cache:`, formato versionado y TTL en milisegundos. Leer una entrada no prolonga su caducidad.
- Los detalles completos y contadores tienen un TTL de 60 segundos, configurable por separado mediante `recipeDetailCacheTtlMs` y `recipeStatsCacheTtlMs` en ambos entornos, con claves separadas por proyecto Supabase.
- Se limpian datos caducados o corruptos, con un máximo de 80 entradas y unos 2 MiB de texto serializado. La colección de detalles completos en memoria se limita a 40 recetas.
- Si el almacenamiento está bloqueado o lleno se usa respaldo en memoria, sujeto también a límites. Ante un error de cuota se liberan datos propios y se reintenta persistir.
- `clearData()` elimina la caché de datos sin borrar la sesión ni claves ajenas. La sesión tiene su TTL independiente y queda fuera de los límites de datos.
- Se comparten peticiones simultáneas al mismo detalle y a los contadores. Guardar, borrar o puntuar invalida las entradas correspondientes, y una respuesta antigua no puede sobrescribir una versión nueva o recuperar una receta borrada.

### Guardado y contadores

- `get_recipe_stats()` obtiene total y pendientes en una consulta agregada. Los contadores se consultan cuando vence su caché o cuando una operación cambia los totales.
- `save_recipe_optimized(uuid,jsonb)` coordina el guardado completo de recetas e indica desde el servidor si ha cambiado el contador de pendientes. Reutiliza `save_recipe`, que se conserva por compatibilidad.
- El guardado completo sincroniza fotos solo si hay cambios reales y realiza una lectura final del detalle y un aviso de cambio. Si no cambian fotos, orden ni textos alternativos, se omite su sincronización.
- `sync_recipe_photos(uuid,jsonb,jsonb)` sustituye los metadatos de fotos en una sola transacción, conserva sus IDs y comprueba que la versión leída no haya cambiado. `delete_recipe_with_photos(uuid)` borra la receta y registra los archivos por limpiar en la misma transacción. Solo tras confirmar el cambio se limpia Storage; un fallo de limpieza no revierte ni presenta como fallido un cambio ya confirmado. La cola `recipe_photo_cleanup`, restringida a editores, conserva los pendientes y se reintenta en posteriores modificaciones de fotos o borrados de recetas. Los archivos todavía referenciados no se borran. Si se pierde la respuesta de una sincronización, las subidas nuevas se conservan por precaución; algunas pueden quedar huérfanas si la transacción no llegó a confirmarse.
- `recipeFilterChanges` centraliza el mínimo de búsqueda, espera de 300 ms, controles y normalización de criterios del listado y selector del planner. `recipeFilterKey` comparte las comparaciones y claves de caché, ignorando el orden y duplicados de ingredientes. `IngredientService` normaliza los nombres una vez por actualización del catálogo y mantiene mapas por ID y nombre normalizado; filtros, formularios y catálogo reutilizan ese índice y conjuntos de IDs seleccionados.
- Si la receta se guarda pero falla una foto o la lectura final, se conserva el ID para reintentar como edición y evitar duplicados. Un fallo al refrescar contadores no se presenta como un fallo de un guardado ya confirmado.
- `rate_recipe(uuid,integer)` realiza la escritura parcial de valoración: valida el valor, comprueba el editor y actualiza únicamente `rating`, `pending` y `updated_at`, sin reescribir ingredientes, pasos, cocinas, fotos ni otros campos.
- Puntuar actualiza el detalle visible en memoria e invalida su caché persistente para no prolongar datos ajenos al cambio. Los contadores se refrescan solo si la receta estaba pendiente. El formulario completo conserva su guardado transaccional.

Los cambios de otros usuarios no se sincronizan en tiempo real. El detalle y los contadores se revalidan conforme a sus cargas y TTL; el estado de navegación del listado tiene el comportamiento descrito en su sección.

Detalles de implementación, llamadas esperadas y pruebas: [OPTIMIZACION.md](OPTIMIZACION.md).

## Identidad visual, metadatos y despliegue

- La identidad visible es **Laurel**, con variables visuales compartidas, tipografías y componentes adaptados a las distintas resoluciones.
- Se incluyen favicon SVG, PNG e ICO y un icono para dispositivos Apple.
- Las previsualizaciones compartidas utilizan una **tarjeta genérica estática** con imagen, título y descripción comunes para toda la web. No se genera una tarjeta por receta ni hay funciones de servidor que consulten Supabase para las previsualizaciones.
- `PageMetadataService` actualiza la URL canónica y `og:url` usando el dominio público, sin parámetros de navegación como `fromPlanner` o `plannerStart`. `/login`, las tres rutas del planner y las páginas 404 utilizan `noindex, nofollow`.
- `vercel.json` conserva el framework Angular, la carpeta de salida y una reescritura general a `index.html`. Las rutas de detalle, login y desconocidas pueden abrirse directamente en el navegador.
- El dominio público configurado es `https://recipe-book-neon-two.vercel.app`. Las URLs de preview pueden tener protección de Vercel, pero esa autenticación no debe exigirse a visitantes del dominio público.

## Base de datos y migraciones

El esquema usa relaciones explícitas para ingredientes de receta, cantidades, pasos, cocinas, componentes de elaboraciones y fotos. La propuesta ampliada y el modelo relacional están documentados en [DB.md](DB.md); ese documento también incluye posibilidades futuras que no implican funcionalidades implementadas en la interfaz.

Para una instalación nueva, el orden de migraciones del repositorio es:

1. [20261015000100_initial_schema.sql](supabase/migrations/20261015000100_initial_schema.sql): esquema y guardados iniciales.
2. [20261016000100_recipe_photos.sql](supabase/migrations/20261016000100_recipe_photos.sql): fotos y bucket.
3. [20261016000100_recipe_servings.sql](supabase/migrations/20261016000100_recipe_servings.sql): comensales y guardado actualizado.
4. [20261018000100_editor_access.sql](supabase/migrations/20261018000100_editor_access.sql): grupo de editores, RLS y permisos de datos, RPC y Storage.
5. [20261019000100_recipe_query_optimization.sql](supabase/migrations/20261019000100_recipe_query_optimization.sql): contadores agregados y guardado optimizado.
6. [20261019000200_partial_recipe_rating.sql](supabase/migrations/20261019000200_partial_recipe_rating.sql): valoración parcial.
7. [20261019000300_meal_plans.sql](supabase/migrations/20261019000300_meal_plans.sql): planes y favoritos privados, validaciones y RLS de propietario/editor.
8. [20261019000400_unique_meal_plan_recipes.sql](supabase/migrations/20261019000400_unique_meal_plan_recipes.sql): impide recetas duplicadas en el mismo día y comida en nuevas escrituras.
9. [20261020000100_daily_meals.sql](supabase/migrations/20261020000100_daily_meals.sql): comidas privadas por fecha y hueco, migración de datos previos y retirada del acceso a los antiguos planes.
10. [20261020000200_recipe_ingredient_search.sql](supabase/migrations/20261020000200_recipe_ingredient_search.sql): búsqueda pública por ingredientes con orden por número de coincidencias antes de paginar.
11. [20261020000300_atomic_recipe_photos.sql](supabase/migrations/20261020000300_atomic_recipe_photos.sql): sincronización y borrado transaccionales, comprobación de versión de las fotos y cola privada de limpieza de archivos.

Las migraciones necesarias deben aplicarse antes de desplegar la versión correspondiente del frontend. No volver a ejecutar las migraciones iniciales de forma aislada después de configurar la seguridad: contienen permisos antiguos de escritura anónima que la migración de editores reemplaza. La gestión de proyectos existentes, OAuth y miembros se explica en [SUPABASE.md](SUPABASE.md).

## Comprobaciones y ejecución

| Comando | Propósito |
| --- | --- |
| `npm start` | Servidor de desarrollo Angular. |
| `npm run build` | Compilación de producción. |
| `npm run lint` | Reglas TypeScript y plantillas. |
| `npm run test:session` | Caché, sesión, renovación, reanudación y permisos. |
| `npm run test:optimization` | Consultas, listado conservado, concurrencia, guardados, valoraciones parciales e imágenes. |
| `npm run test:assets` | Textos alternativos y dimensiones de los recursos de marca. |
| `npm run test:photos:sql` | Nueve pruebas SQL en PostgreSQL/WASM local de atomicidad, conflictos, borrado y permisos de fotos. Requiere instalar PGlite temporalmente como indica `OPTIMIZACION.md`. |
| `npm run test:planner` | Fechas, límites y duplicados por comida, guardado diario, permisos, cachés, caducidad, cancelación e aislamiento entre cuentas (`scheduled-meals.test.cjs` y `planner-state.test.cjs`). |

Tras la carga paginada y bajo demanda de ingredientes, la cancelación del listado y el manejo de la migración de fotos ausente pasaron compilación, lint y **122 pruebas**: 66 de optimización/búsqueda/ingredientes, 27 de planner, 18 de sesión/caché, 2 de recursos y 9 SQL locales de fotos. Las pruebas SQL comprueban la migración de fotos en PostgreSQL/WASM aislado, con identidades de prueba. El rechazo explícito `PGRST202` de `sync_recipe_photos` muestra que la receta ya está guardada, identifica la migración pendiente y permite reintentar sin duplicarla; solo en ese rechazo confirmado se limpian las subidas nuevas no asociadas. No se han aplicado migraciones ni validado permisos en Supabase remoto, ni se ha realizado un despliegue.

Durante la sesión se hicieron comprobaciones de navegador en Chrome con Supabase simulado:

- **Planificación:** acceso directo a `/planner/day`, breadcrumb y regreso desde recetas, vista principal sin controles de edición, **Planificar Día** solo en el estado vacío y vuelta automática tras un guardado correcto, incluida la eliminación de la última receta. Un fallo conserva la ruta y el borrador; guardar en la vista semanal conserva esa página. Cancelar la confirmación de descarte mantiene los cambios.
- **Caché y consultas:** volver desde el detalle no añade consultas de comidas o tarjetas mientras la caché sigue válida; se conserva la semana elegida y el selector reutiliza resultados y filtros. Se comprobó la cancelación real de peticiones al cambiar la búsqueda o cerrar el modal. Los tests de servicios cubren caducidad, copias independientes, invalidación por cambios de recetas/usuario y respuestas tardías.
- **Precarga:** calendario semanal y día de hoy, listados y contadores, detalles de recetas e ingredientes, cargas parciales y paginación. Se comprobó que los datos ya disponibles siguen visibles cuando corresponde, que errores/reintentos salen y vuelven al estado de precarga y que una consulta pendiente no muestra un falso 404. Se revisaron móvil, escritorio y movimiento reducido.
- **Filtros vigentes:** ausencia de etiqueta de pendientes, clic y teclado en los contadores, restablecimiento completo en una sola consulta, cancelación de la búsqueda anterior, conservación del orden y vuelta al listado con su caché. La fila buscador/orden/filtros se comprobó en anchuras de **320, 390, 768, 1024 y 1112 px**, con todas las opciones de orden sin desbordamiento. El selector del planner busca entre todas las recetas y usa orden compacto.

Las comprobaciones visuales usaron scripts y capturas auxiliares locales en `.angular/`; no forman parte de los comandos de prueba de `package.json` ni deben tratarse como una suite de integración mantenida. No se ejecutaron migraciones ni se verificó RLS en Supabase remoto mediante estas pruebas.

## Mejoras y funcionalidades pendientes

Estas propuestas se han comentado, pero no deben describirse como implementadas:

- **Protección frente a abuso:** límites de peticiones por IP y usuario, cuotas adicionales, límites de trabajo por petición y revisión de límites de autenticación y consumo en Supabase. La caché y los bloqueos del frontend no constituyen una defensa frente a llamadas directas. No se han configurado desde el repositorio reglas de rate limiting en Vercel ni límites personalizados de peticiones en Supabase. El firewall de Vercel no limita las consultas que el navegador envía directamente a Supabase.
- **API propia aplazada:** una capa intermedia, en Vercel Functions o Spring Boot, con contadores compartidos y restricciones de acceso directo se valorará solo en desarrollos posteriores. Actualmente no forma parte del trabajo autorizado ni de la arquitectura desplegable del repositorio.
- **Ingredientes:** reducir los refrescos completos del catálogo resumido tras las escrituras y paginar en la interfaz las recetas relacionadas. La carga selectiva, las peticiones compartidas y la lectura paginada del catálogo ya están implementadas.
- **Consultas:** extender la cancelación efectiva a los flujos que todavía no reciben `AbortSignal`, como los detalles y el catálogo de ingredientes. El listado principal ya aborta las lecturas y los refrescos por lotes al cambiar filtros, invalidarse o perder su último suscriptor; el planner y su selector también cancelan sus lecturas. Siguen pendientes la reducción de recuentos exactos repetidos de recetas y la revisión de índices y planes de ejecución con datos reales antes de añadirlos.
- **Imágenes:** miniaturas para tarjetas y optimización de fotos antiguas.
- **Interfaz:** reducir cálculos repetidos en otras plantillas cuando las mediciones lo justifiquen. El editor del planner ya deriva entradas, identificadores y contadores por fecha/comida mediante `computed`.
- **Conflictos de planificación entre pestañas/dispositivos:** `save_scheduled_day` bloquea por usuario y fecha para serializar escrituras, pero no compara una versión esperada. Un guardado del día completo basado en datos antiguos puede reemplazar otro posterior a la carga; no hay detección ni resolución de conflictos.
- **Referencias a recetas eliminadas:** los UUID de las recetas planificadas viven en JSON, sin clave foránea a `recipes`. Se valida su formato y la ausencia de duplicados, pero no su existencia. El estado actual presenta **Receta no disponible** y permite quitarla desde el editor; no hay limpieza automática de esas referencias.
- **Cambio de día con la página abierta:** la fecha de hoy se fija al montar el componente. No hay actualización automática a medianoche ni al recuperar el foco para cambiar esa fecha; una nueva entrada a la página calcula de nuevo el día local. Cualquier mejora debe conservar los borradores y no cambiar silenciosamente el día que se está editando.
- **Evolución funcional:** lista de la compra, exportación a otros formatos, información nutricional y ampliación de roles si se necesitan permisos distintos del grupo único de editores.

Las fotos, la edición de recetas e ingredientes, el enlace para compartir y la página 404 ya están implementados y no forman parte de esa lista de pendientes.

La reutilizaci?n de `RecipeFiltersComponent` se comprob? en Chrome con Supabase simulado: b?squeda por ingredientes en listado y selector del planner, limpieza desde Recetas guardadas, conservaci?n de etiquetas y panel al reabrir el selector sin nuevas consultas y ausencia de desbordamiento en el di?logo a 320, 390 y 1440 px.
