# Contexto del proyecto

Actualizado el 26 de octubre de 2026. Este documento describe lo implementado en el repositorio y las decisiones vigentes. Las migraciones de Supabase y la publicación de cada versión en Vercel se realizan por separado; este documento no confirma su estado remoto.

El estado vigente incluye filtros de recetas compartidos y siempre visibles, búsqueda por ingredientes ordenada por coincidencias, selección de componentes de elaboraciones, planificación diaria y semanal, lista de la compra personal, inventario privado de varios congeladores y gestión segura de fotografías. También incluye búsqueda y normalización compartidas, catálogos e índices reutilizables, cachés de navegación y de intervalos de compra, cancelación de consultas y protección frente a respuestas antiguas. Las secciones siguientes describen el resultado actual y separan las mejoras pendientes de las ya aplicadas.

## Propósito y estado actual

**Laurel** es un recetario personal para consultar y organizar recetas preparadas y recetas pendientes de probar, junto con sus ingredientes y elaboraciones.

La aplicación incluye consulta pública, creación, edición y eliminación autorizadas, fotografías, valoraciones, búsqueda por nombre e ingredientes, enlaces para compartir y navegación adaptada a escritorio, tablet y móvil. Los editores comparten el catálogo de recetas e ingredientes; las comidas planificadas y las listas de compra pertenecen a cada usuario. La integración utiliza datos de Supabase.

## Tecnologías y decisiones de arquitectura

- **Frontend:** Angular 22, componentes standalone, formularios reactivos, signals y RxJS.
- **Persistencia:** PostgreSQL en Supabase, consultado directamente desde Angular mediante `supabase-js` y la API PostgREST.
- **Autenticación:** Supabase Auth, con Google y correo/contraseña.
- **Fotografías:** Supabase Storage, bucket público `recipe-photos`.
- **Alojamiento configurado:** Vercel, con salida estática en `dist/recetario/browser` y reescritura SPA en `vercel.json`.
- **Comprobaciones:** Angular CLI, ESLint y pruebas de servicios con `node:test`.

**Decisión vigente:** mantener Angular conectado directamente a Supabase. No se ha añadido una API intermedia de datos, Spring Boot, Redis ni una pasarela con límites por IP o usuario. Vercel incorpora únicamente una función de lectura pública para entregar los metadatos de las recetas compartidas en el HTML inicial. La API propia queda como una posible evolución, aplazada por decisión del usuario.

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
| `/planner` | Consulta de las comidas de hoy con tarjetas completas y accesos Planificar Semana y Editar; si no hay comidas, muestra un contenedor independiente con Planificar Día y Planificar Semana. Exclusiva de editores autenticados. |
| `/planner/day` | Editor de las comidas de hoy, con breadcrumb Planificación / Día. Exclusiva de editores autenticados. |
| `/planner/week` | Calendario de siete días desde hoy, navegación por bloques de siete días y guardado por día. Exclusiva de editores autenticados. |
| `/shopping` | Lista de la compra personal, ingredientes manuales o calculados desde el planning, guardado y texto para compartir. Exclusiva de editores autenticados. |
| `/freezer` | Inventario personal de varios congeladores, ingredientes y productos libres con cantidades y fecha de entrada, lotes independientes y guardado automático por operación. Exclusiva de editores autenticados. |
| `/login` | Acceso con Google o correo/contraseña y comprobación de permisos. |
| Cualquier ruta desconocida | Página 404, conservando la URL introducida. |

El componente raíz compone el navbar, el breadcrumb, el `router-outlet`, las notificaciones y el formulario cuando se abre.

- En escritorio, el navbar se presenta como una barra lateral.
- En tablet y móvil, hasta 1120 px, un botón hamburguesa abre el menú sobre el contenido y ocupa la pantalla completa. Abrirlo no empuja el detalle hacia abajo y bloquea el scroll del fondo.
- El menú se cierra al navegar o pulsar Escape y contiene el foco del teclado mientras está abierto en estas resoluciones.
- Las acciones **Editar** y **Eliminar** aparecen en el navbar, en filas separadas bajo las opciones principales, con iconos y solo para editores autorizados cuando hay un detalle cargado. Forman un grupo de edición separado por otra línea horizontal. En el detalle de receta, **Puntuar** aparece encima de ese grupo y abre el formulario de estrellas en el encabezado; en móvil cierra el menú y lleva el foco al formulario.
- El navbar muestra el usuario conectado y **Cerrar sesión**. En escritorio están en filas diferentes; en tablet y móvil comparten fila.
- Se mantienen el breadcrumb y los accesos contextuales entre recetas e ingredientes. Hay accesos flotantes de creación en resoluciones pequeñas para los editores.
- El acceso del menú se llama **Planificación** y apunta a `/planner`. El calendario semanal está en `/planner/week`, con título **Planificación semanal** y breadcrumb **Planificación / Semanal**. El editor diario está en `/planner/day`, con título **Planificación del día** y breadcrumb **Planificación / Día**. La antigua ruta `/planner/new` no tiene un alias ni redirección configurados y se resuelve como ruta desconocida.
- **Compra** enlaza con `/shopping` para editores autorizados y tiene su propio breadcrumb. Planificación y Compra son secciones privadas; sus datos y borradores no se comparten con otros editores.

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
- La dificultad **Fácil** se muestra con fondo azul claro y texto azul en las tarjetas y el detalle, mediante las variables compartidas `--color-info-soft` y `--color-info`.
- Los colores de dificultad se definen una sola vez en `src/styles.css` para las tarjetas y el detalle: **Fácil** azul, **Media** amarillo y **Difícil** rojo, con fondos suaves y texto del mismo tono. Los componentes solo ajustan el tamaño y el espaciado de las etiquetas.
- La etiqueta **Fitness** incluye un icono de músculo 💪 en las tarjetas y el detalle. Es decorativo (`aria-hidden`) y adapta su tamaño al texto de la etiqueta.
- Las cocinas disponibles son española, italiana, mexicana, japonesa, china, india, francesa, peruana, árabe y otra; se muestran con sus etiquetas y banderas.
- Las cantidades permiten no indicar cantidad, una cucharada, un vaso o una cantidad específica positiva en `ml`, `g` o `pieza`. La cantidad pertenece a la relación receta–ingrediente.

### Listado y búsqueda

- La carga inicial muestra 20 recetas; **Cargar más recetas** añade lotes de 10.
- El listado principal inicia con **Estado: Hechas** (`pending: 'done'`). Se puede cambiar a Todas o Pendientes y se conserva la selección al volver de un detalle, junto con el resto de filtros. El selector para añadir recetas al planning mantiene **Todas** como estado inicial y sus filtros independientes. El contador **Recetas guardadas** sigue restableciendo el listado a Todas.
- El buscador consulta únicamente el nombre de la receta, sin distinguir mayúsculas y minúsculas. No busca dentro de los ingredientes.
- Un filtro independiente permite buscar ingredientes por nombre (mínimo dos caracteres, sin distinguir acentos ni mayúsculas), seleccionarlos como etiquetas y quitarlos individualmente. Las recetas deben contener al menos uno de los ingredientes seleccionados directamente en su lista; no se expanden componentes de elaboraciones. Primero aparecen las que contienen más ingredientes seleccionados y los empates usan el orden elegido. La RPC `search_recipes_by_ingredients` ordena antes de paginar y conserva RLS, los filtros restantes y los campos resumidos de las tarjetas. El selector del planner reutiliza este mismo filtro de ingredientes.
- Las etiquetas de ingredientes tienen fondo blanco dentro del contenedor verde. Se conservan al navegar al detalle y volver, y **Recetas guardadas** limpia también la selección y el texto del buscador de ingredientes.
- Al filtrar por ingredientes, cada tarjeta muestra etiquetas con los ingredientes seleccionados que contiene esa receta, en el orden del filtro y sin duplicados. Se utiliza `IngredientTagComponent` tanto en el filtro (con botón para quitar) como en las tarjetas (solo lectura). Se aplica al listado y al selector del planner; al limpiar el filtro o mostrar tarjetas del día no aparecen etiquetas de coincidencias antiguas.
- Dentro de las tarjetas, las etiquetas usan la variante `card-tag`: tamaño de letra de 10 px, relleno de 3 × 8 px, fondo verde principal y texto blanco. Conservan el ajuste de línea para nombres largos; las etiquetas del filtro mantienen su presentación habitual.
- La consulta filtrada incluye `matched_ingredients:recipe_ingredients(ingredient_id,ingredients(name))` y selecciona en Angular las coincidencias con los IDs del filtro. La RPC mantiene la búsqueda, el orden y la paginación de las recetas en el servidor; solo las etiquetas se calculan en el cliente. No aplicar `.in('matched_ingredients.ingredient_id', ...)`: el proyecto remoto devuelve HTTP 400 / PostgreSQL `42703` (`column pgrst_call.ingredient_id does not exist`) con ese filtro embebido en la RPC. La selección sin ese filtro fue comprobada mediante una consulta pública real y devuelve HTTP 200. Se conserva independiente `recipe_ingredients(count)` para el total de ingredientes, sin cantidades ni detalles completos y sin migración nueva. Las consultas sin filtro de ingredientes mantienen la selección resumida anterior.
- Se mantiene un mínimo de dos caracteres, una espera de 300 ms y el escape de comodines. Vaciar el buscador elimina la búsqueda.
- El buscador y **Orden** comparten una fila en escritorio, tablet y móvil. El select **Orden** adapta su ancho al texto seleccionado. Tipo de plato, dificultad y búsqueda por ingredientes con sus etiquetas aparecen siempre debajo, sin botón Filtros ni panel plegable.
- Un único contenedor con fondo verde suave, borde y esquinas redondeadas reúne el buscador por nombre, el orden y el resto de filtros siempre visibles. Los contadores **Recetas guardadas** y **Por probar** presentan número y texto en la misma fila, alineados por su línea base. **Por probar** mantiene `aria-pressed` para accesibilidad sin resaltado visual de selección.
- La fila de **Tipo de plato** y **Dificultad** incluye un selector **Estado** con **Todas**, **Hechas** y **Pendientes**. Filtra por `pending` en Supabase y se combina con nombre, ingredientes y los demás criterios. El contador **Por probar** selecciona Pendientes en el mismo control, manteniendo el resto de criterios. **Recetas guardadas** vuelve a Todas: limpia búsqueda, estado, tipo de plato, dificultad e ingredientes, y conserva el orden elegido. Ambos contadores admiten clic, Enter y Espacio.
- El restablecimiento de filtros se procesa en una sola actualización de `RecipeListService`. Se reinician las suscripciones de controles mediante `filtersReset` para cancelar búsquedas que aún estuvieran esperando los 300 ms y evitar consultas intermedias o que reaparezcan filtros antiguos. Si los criterios ya son los mismos, no se fuerza otra consulta.
- `RecipeFiltersComponent`, en `components/shared/filters/recipe-filters/`, reúne el buscador por nombre, orden compacto, tipo de plato, dificultad, estado e ingredientes en un único contenedor verde adaptable. Los tres selects Tipo de plato, Dificultad y Estado comparten fila. Se reutiliza en el listado principal y al añadir recetas a la planificación diaria o semanal. Recibe controles reactivos de cada pantalla y conserva sus respectivas suscripciones, cancelación y restablecimiento. El selector del planner permite también Todas, Hechas y Pendientes, conserva el estado al reabrirse y mantiene sus criterios, etiquetas y resultados independientes del listado principal. La caché distingue estado y conjuntos de ingredientes sin depender del orden de selección y se limpia al cambiar de cuenta.
- La ordenación permite más recientes, nombre A–Z, mejor puntuación o menor tiempo.
- Los contadores muestran el total de recetas guardadas y pendientes del recetario, no el número de resultados de la búsqueda actual. Son acciones de filtrado y se cargan independientemente de las tarjetas.
- `RecipeCard` es un modelo resumido para tarjetas: incluye los campos visibles, el número de ingredientes y los metadatos de fotos. El listado no descarga pasos, cantidades, anotaciones ni URL de origen y no guarda tarjetas como si fueran detalles completos.

### Conservación del listado al navegar

`RecipeListService` conserva en memoria una colección con búsqueda, filtros, orden, tarjetas cargadas y posición de paginación. El componente guarda el scroll antes de salir y lo restaura tras renderizar el listado, al volver con Atrás, breadcrumb o navbar, también en móvil.

Volver sin cambios reutiliza las tarjetas sin consultar de nuevo las recetas. Si en esta aplicación se ha creado, editado, puntuado o eliminado una receta, se refresca toda la ventana previamente cargada, manteniendo filtros y scroll. Las ventanas grandes se recuperan por lotes y los cambios de filtro reinician la paginación.

Este estado no se guarda en `localStorage` y se pierde al recargar la web. No recibe actualizaciones en tiempo real de otras pestañas o usuarios. Las cargas interrumpidas y las respuestas antiguas no sustituyen la colección actual.

### Detalle, formularios y acciones

- El detalle presenta fotos, datos generales, ingredientes agrupados por categoría y cantidades, comensales, pasos, anotaciones, valoración y enlace de origen cuando existe.
- En móvil y tablet (hasta 1120 px), el detalle usa texto principal de 16 px, datos secundarios de 14 px y títulos de sección de 22 px. El detalle de ingredientes aplica también los tamaños mayores en componentes y recetas relacionadas. En móvil (hasta 760 px), Ingredientes y Preparación se apilan en una sola columna, también durante la precarga. Las cabeceras y etiquetas admiten varias filas para conservar la lectura con el texto ampliado.
- El encabezado del detalle reúne la puntuación y los metadatos antes de Ingredientes y Preparación, también en escritorio. La puntuación está centrada horizontalmente en su fila, con 8 px de padding superior, y ya no aparece al final de la receta. Las recetas sin puntuación muestran **Sin valorar**.
- Si no hay pasos con contenido, no se muestra la sección Preparación ni el texto Sin pasos. Ingredientes ocupa entonces una sola columna a todo el ancho, sin reservar una columna vacía. Los pasos vacíos o compuestos solo por espacios se omiten; los demás mantienen su orden y se numeran consecutivamente.
- En móvil (hasta 760 px), el encabezado tiene cuatro filas: nombre y tipos de plato a la derecha; dificultad ampliada a 16 px, tiempo y Compartir a la derecha; cocinas, Fitness y Por probar cuando correspondan; y puntuación con estrella o Sin valorar. Los nombres largos y las etiquetas admiten varias líneas dentro de su fila sin desbordar. Las categorías de ingredientes mantienen el color verde.
- **Puntuar** se encuentra exclusivamente en el navbar para editores, encima de Editar y del separador del grupo de edición. Abre el formulario de estrellas justo bajo la puntuación del encabezado y lo enfoca. Durante el guardado se bloquean las estrellas, Puntuar, Editar y Eliminar; un error conserva la selección para reintentar. Se mantiene `rate_recipe` como escritura parcial de puntuación y estado pendiente, sin reescribir el resto de la receta. La precarga también presenta las filas del encabezado sin una puntuación ficticia.
- El editor de recetas se organiza en cuatro secciones: **Datos**, **Ingredientes**, **Preparación** y **Fotos**. Permite crear ingredientes desde el propio formulario.
- Al añadir un ingrediente a la receta desde los resultados, se vacía el texto del buscador para facilitar la siguiente búsqueda. Se conserva la categoría seleccionada. La creación rápida también limpia la búsqueda al completar el alta; quitar un ingrediente no cambia el texto.
- Los campos numéricos del formulario (minutos, comensales y cantidades) declaran `autocomplete="off"` para desactivar las sugerencias de valores guardados del navegador; también se aplica a cantidades de componentes en el formulario compartido.
- Hacer clic fuera del modal de receta no lo cierra ni descarta el borrador. Para salir se usan las acciones explícitas **Cerrar** o **Cancelar**; el fondo conserva su comportamiento anterior en el formulario de ingredientes.
- Se pueden crear, editar, puntuar y eliminar recetas con los permisos adecuados. El borrado desde el navbar solicita confirmación.
- Durante el guardado se deshabilitan los controles y el cierre del formulario, se indica el progreso y se impiden envíos repetidos. Los fallos permiten reintentar.

### Compartir recetas

Se comparte la URL del detalle mediante `navigator.share` cuando está disponible, con copia al portapapeles como alternativa y una opción manual si la copia falla.

El enlace se construye siempre con `publicSiteUrl`, actualmente `https://recipe-book-neon-two.vercel.app`, y el ID de la receta. No utiliza el origen de localhost ni las URLs alternativas de preview de Vercel. El dominio público debe permitir la consulta sin autenticación de Vercel.

En Vercel, las URLs `/recipes/:id` entregan el HTML compilado de Angular con metadatos Open Graph y Twitter específicos: nombre, tiempo, comensales y dificultad cuando existen, y primera foto según su posición. Sin foto se utiliza la imagen de Laurel. `api/recipe-preview.js` consulta datos públicos con la clave publishable de producción, sin sesión de usuario, y conserva los scripts de Angular. Los éxitos se cachean 60 segundos en Vercel; errores, recetas ausentes o IDs inválidos sirven la aplicación sin caché compartida. No requiere migraciones ni variables adicionales. Requiere desplegar; los clientes de mensajería pueden conservar sus propias tarjetas en caché. Véase [PREVIEWS.md](PREVIEWS.md).

### Fotografías

- Se admiten hasta tres fotos por receta, con orden y texto alternativo. Hay carrusel en tarjetas y detalle, y visor ampliado con flechas de teclado y cierre con Escape.
- El formulario permite seleccionar o arrastrar archivos, previsualizarlos y quitar fotos. Los formatos son JPG, PNG, WebP, GIF y AVIF, con un máximo de 5 MiB por archivo. El bucket configura también tamaño y tipos MIME permitidos.
- Las fotos nuevas JPG/PNG se procesan en el navegador: lado máximo de 1600 píxeles y WebP con calidad 0,82, conservando el resultado solo si ocupa menos. Si la conversión no está disponible o falla, se usa el original. GIF, WebP y AVIF no se recomprimen.
- Las fotos ya almacenadas mantienen su tamaño. No se han generado miniaturas independientes para las tarjetas ni añadido transformaciones de imagen en el servidor.
- Las dos primeras tarjetas priorizan sus imágenes; el resto usa carga diferida. El detalle prioriza su foto principal. Se usa decodificación asíncrona y se declaran dimensiones en tarjetas, detalle y previsualizaciones.
- Las subidas utilizan nombres únicos y caché HTTP de un año. Los metadatos viven en PostgreSQL y los archivos en Storage.
- Añadir, eliminar o reorganizar fotos utiliza `sync_recipe_photos`: los metadatos se sustituyen de forma transaccional, se conservan los IDs retenidos y se comprueba la versión anterior. Un conflicto no borra fotos de otra edición. Borrar una receta confirma primero la operación en PostgreSQL y después limpia Storage; los archivos pendientes quedan en una cola para reintentar sin dejar una receta existente sin foto por un fallo de borrado.
- Si falta `sync_recipe_photos` y Supabase devuelve `PGRST202`/404, se informa de que la receta ya se ha guardado y de la migración `20261020000300_atomic_recipe_photos.sql` pendiente. Se conserva el ID para reintentar como edición, evitando recetas duplicadas. El frontend requiere esa RPC para guardar las fotos; la compilación local no la instala en Supabase.

## Planificación

- Las comidas se guardan directamente por usuario, fecha y hueco (desayuno, comida o cena), sin nombres, identificadores de plan, favoritos, listados de planes ni precarga de menús favoritos. No hay botón de nuevo plan ni selector global de fecha o comensales.
- `/planner` es una vista de consulta de hoy mediante `PlannerPageComponent`. Presenta las comidas en orden desayuno, comida y cena con `RecipeCardComponent`, fotos, metadatos y acceso al detalle. Cuando hay comidas guardadas, muestra **Planificar Semana** (`/planner/week`) junto a **Editar** (`/planner/day`), a la derecha de la fecha, con ajuste de filas para pantallas pequeñas. No hay controles de modificación en la vista principal. Si hoy está vacío, oculta la tarjeta del día, su fecha y **Editar** y muestra un contenedor independiente verde suave, del mismo color que los filtros de recetas, con **Todavía no has añadido comidas para hoy.** y los botones **Planificar Día** y **Planificar Semana**. Durante la carga no se muestran esas acciones.
- `/planner/day` reutiliza `PlannerEditorPageComponent` para editar solo hoy, siempre en modo de planificación, incluso con comidas guardadas. Su título es **Planificación del día** y el breadcrumb **Planificación / Día**; no muestra el enlace Ver planificación semanal ni la antigua frase de invitación a añadir los platos de hoy. Conserva selector, filtros, duplicados, límite de cinco recetas por comida, ajustes de proporción/sobras, eliminación y guardado diario. Entrar no genera cambios pendientes. Guardar correctamente actualiza la caché de hoy y vuelve automáticamente a `/planner`, con las tarjetas actualizadas. Los fallos mantienen el borrador y salir con cambios pendientes solicita confirmación.
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
- No incluye texto libre en las comidas, generación automática de menús, menús individuales por persona ni sincronización en tiempo real. La lista de la compra usa las comidas guardadas mediante `/shopping`.

La nueva migración debe aplicarse después de las anteriores y antes de desplegar este frontend. Las pruebas locales no ejecutan migraciones ni confirman RLS en el proyecto remoto.

## Compra

### Acceso y presentación

- **Compra** aparece en el menú para editores y abre `/shopping`. Cada usuario tiene una lista personal en `shopping_lists`, protegida mediante RLS por propietario y permiso de edición. No se puede acceder a listas de otros editores.
- El contenedor **Tu lista de la compra** permanece visible aunque esté vacío. Tras cargar una lista sin elementos muestra «Todavía no has añadido ingredientes a tu lista de la compra»; durante la lectura inicial mantiene la precarga. Con datos muestra el número de ingredientes diferentes y los agrupa por categoría y nombre.
- **Compartir** y **Limpiar** están dentro del encabezado de la lista, en ese orden, con Limpiar a la derecha. Solo aparecen cuando hay ingredientes. No se muestran el antiguo subtítulo, «Tu lista está al día», «Cambios sin guardar», un total de apariciones ni la explicación de pulsar el contador en la lista principal.
- **+ Añadir ingredientes** aparece en el encabezado en escritorio, por encima de 1024 px; en móvil y tablet se utiliza el mismo + flotante y circular de Recetas y Congelador. Ambos abren un modal nativo y se bloquean durante cargas o guardados. Ya no hay un desplegable de adición dentro de la página.
- El modal contiene el panel verde con las pestañas **Manual** y **Según planning**, con navegación mediante flechas, Inicio y Fin. Su contenido se crea en la primera apertura; cerrar y reabrir conserva la búsqueda manual, la pestaña y las fechas del calendario. Cada nueva entrada en Según planning desde Manual crea el calendario sin fechas seleccionadas. Abrir Compra no inicia por sí solo la descarga del catálogo.
- El modal muestra el número de ingredientes de la lista, permite terminar con **Listo** o cerrar mediante × y Escape, contiene el foco y bloquea el scroll del fondo. Cerrar conserva los ingredientes añadidos al borrador; sigue siendo necesario guardar la lista después. Durante la creación de un ingrediente se impide cerrar el modal. Los controles y el calendario se adaptan a móvil sin desbordamiento.

### Adición manual y creación de ingredientes

- Se reutiliza `IngredientFilterComponent` y el índice normalizado de `IngredientService`: búsqueda desde dos caracteres sin distinguir acentos ni mayúsculas, categoría sola o combinada con el nombre y opción **Todas las categorías**. El modo de compra oculta las etiquetas que duplicarían el contenido de la lista.
- Añadir un ingrediente manualmente crea una entrada con contador uno. Seleccionar uno ya presente no lo duplica ni altera su contador; la identidad se compara por UUID sin distinguir mayúsculas. La lista permite quitar cada ingrediente mediante su botón de eliminación.
- Si el nombre no existe en el catálogo normalizado, se puede elegir categoría y pulsar **Crear y añadir ingrediente**. La creación rápida admite ingredientes simples; excluye la categoría Elaboración. Una elaboración existente sí puede seleccionarse del catálogo y se trata como un ingrediente directo.
- El alta usa `save_ingredient` e incorpora inmediatamente el resultado confirmado al índice local y a la lista, sin descargar de nuevo todo el catálogo. Si había una carga anterior en curso, se invalida su revisión y se conserva la información completa del ingrediente creado al publicar el resultado.
- Un error en una recarga independiente del catálogo no convierte un alta confirmada en un error de creación. Un fallo de la escritura conserva nombre y categoría para reintentar. Se impiden envíos repetidos y no se aplican respuestas a una lista de otro usuario o a un selector destruido.
- Mientras se crea un ingrediente se bloquean Guardar, cargar la lista guardada, cambiar de pestaña y reemplazar la lista desde el planning. Durante un guardado tampoco puede iniciarse un alta. Si el selector deja de permitir la adición tras un alta confirmada, se informa de que el ingrediente está creado y disponible en el buscador, sin anunciar que se ha añadido a la lista.

### Contadores, limpieza y guardado

- Una entrada por ingrediente muestra un contador **×N**. Pulsarlo lo aumenta en uno, también con teclado. Se bloquea durante carga y guardado y al alcanzar `2147483647`, el máximo admitido. El valor modificado forma parte del borrador, el guardado y el texto compartido.
- **Limpiar** vacía el borrador completo y no elimina ingredientes del catálogo. El vaciado solo se conserva después de guardar. Los errores de guardado mantienen el borrador vacío para reintentar. La acción se deshabilita durante carga y guardado.
- **Guardar lista de la compra** solo aparece con cambios pendientes o durante un guardado. Una lista inicialmente vacía y sin cambios no muestra el botón; vaciar una lista guardada sí lo muestra para poder persistir la eliminación.
- `save_shopping_list` guarda la lista completa en una transacción y compara la versión esperada. Una escritura basada en una versión antigua se rechaza sin sobrescribir cambios de otra pestaña o dispositivo. Los errores conservan el borrador y ofrecen reintento o carga de la versión guardada; cargarla con cambios pendientes pide confirmación.
- Nombres y categorías se guardan como instantánea: las modificaciones o eliminaciones posteriores del catálogo no destruyen la lista guardada. La validación compartida comprueba UUID, categoría, nombres, contadores y ausencia de duplicados.
- `ShoppingListService` comparte las cargas simultáneas, conserva el borrador al navegar por la aplicación y limpia su estado al cambiar de cuenta o perder permisos. Las respuestas tardías de cargas y guardados no restauran datos de otra sesión.
- Mientras Compra está montada, cerrar o recargar con cambios pendientes, un guardado o un alta en curso activa el aviso del navegador. El aviso pertenece a esa página: después de navegar a otra ruta ya no protege el borrador de compra. El borrador solo vive en memoria y únicamente el guardado explícito garantiza recuperarlo tras recargar o reabrir la web.

### Selección de fechas y cálculo desde el planning

- El calendario está integrado en Según planning, dentro del panel verde del modal de adición. Presenta siete días desde hoy, contadores de recetas y navegación por bloques de siete días. Hasta 460 px distribuye los siete días en dos filas para que sus etiquetas y contadores se lean dentro del modal. No hay otro diálogo independiente para elegir fechas.
- **Desde** y **Hasta** aparecen encima de los días, inicialmente con «Elige un día». No se consultan ingredientes hasta elegir ambos extremos. Para un intervalo de un solo día hay que seleccionar esa fecha dos veces.
- Un borde y un fondo claro, junto con `aria-pressed` e instrucciones accesibles, indican el extremo que se está editando; no hay una etiqueta «Seleccionado». Al elegir Desde se activa Hasta, que permanece activo hasta volver a pulsar Desde. Hasta no puede elegirse sin Desde. Si un nuevo inicio supera el final anterior, se vacía Hasta; si el final elegido precede al inicio, se ajusta el inicio para mantener el intervalo ordenado.
- No se puede navegar a bloques anteriores a hoy ni seleccionar fechas pasadas respecto al día calculado al montar el calendario. Hoy tiene un fondo dorado suave y borde cálido, incluso si es un extremo seleccionado. Los extremos y el interior del intervalo tienen sus propios estilos verdes. La actualización de hoy tras medianoche sigue pendiente.
- El intervalo incluye ambas fechas y puede cruzar semanas, meses y años. La vista previa agrupa ingredientes por categoría y muestra **×N**, con una explicación del número de apariciones.
- `shopping_ingredients_from_plan` cuenta los ingredientes directos de cada aparición de una receta en las comidas guardadas del usuario. La misma receta en dos comidas cuenta dos veces. No calcula gramos, comensales, proporciones ni sobras, ni expande componentes de elaboraciones. Las referencias a recetas eliminadas se omiten.
- El cálculo se pagina con orden por nombre e ID, un recuento exacto inicial y avance según las filas recibidas para respetar límites de respuesta inferiores al tamaño pedido. Solo se entrega un resultado completo y validado; los errores de páginas posteriores no presentan listas parciales.
- Si el intervalo completo no contiene ingredientes, no aparece **Añadir**. Se muestra **Hacer plan semanal**, que abre `/planner/week?start=<Desde>`. El enlace no aparece antes de seleccionar ambas fechas, durante una carga ni tras un error de cálculo.

### Confirmación del reemplazo

- **Añadir** solo aparece con una vista previa completa, válida y con ingredientes. No hay un aviso permanente de reemplazo dentro del calendario: el botón abre un `dialog` que advierte de que se sobrescribirá la lista actual.
- Solo **Sí, sobrescribir** sustituye todo el borrador por los ingredientes del intervalo; no se mezclan con la lista anterior. El reemplazo requiere guardar después para persistirlo.
- Al confirmar se vuelve a **Manual**, se enfoca su pestaña y el modal de adición permanece abierto. Cancelar o Escape en la confirmación conservan el borrador y las fechas del calendario. Cambiar a Manual sin confirmar tampoco modifica la lista.
- El diálogo de confirmación se abre sobre el modal de adición, contiene el foco y enfoca inicialmente Cancelar. Al cerrarlo, el modal de adición sigue abierto y el scroll del fondo continúa bloqueado hasta cerrarlo también. Pulsar fuera no confirma el reemplazo.

### Reutilización y cancelación de consultas

- Los intervalos idénticos comparten cálculos simultáneos y reutilizan resultados completos durante cinco minutos. Se conservan como máximo veinte intervalos por sesión, incluidos los resultados vacíos. Leer una entrada no prolonga su caducidad y cada consumidor recibe una copia independiente.
- Pulsar de nuevo un extremo sin cambiar las fechas no reinicia el cálculo, tampoco si sigue cargando. Volver a elegir un intervalo ya calculado o reabrir Según planning lo reutiliza mientras siga válido.
- La caché se invalida al cambiar de usuario o perder permisos y ante cambios locales de recetas, publicaciones del catálogo o guardados del planning. Guardar un día invalida antes y después de la escritura para impedir que una lectura intermedia mantenga un resultado antiguo en caché.
- Cambiar de intervalo, volver a Manual o salir de la página cancela al consumidor anterior. El transporte compartido solo se aborta cuando no quedan consumidores. Cerrar el modal de adición conserva su contenido y no destruye el selector activo.
- Errores, cálculos cancelados y respuestas anteriores a una invalidación no repueblan la caché. Los cambios de otras pestañas o dispositivos se reflejan en una consulta posterior con la entrada caducada; no hay actualización automática ni sincronización en tiempo real.

### Compartir y requisitos de base de datos

- **Compartir** usa la lista actual, incluidos cambios aún no guardados, con categorías y nombres. El texto omite **×1** y muestra el contador solo desde **×2**, tanto al compartir como al copiar o seleccionar manualmente. Los contadores visibles de la aplicación se conservan. Prueba `navigator.share`, después copia al portapapeles y ofrece un texto seleccionable si la copia falla. Compartir no guarda, publica una URL ni concede acceso a la tabla privada.
- Requiere `20261020000400_shopping_lists.sql` para tabla, permisos y RPC, y `20261021000100_ingredient_categories.sql` para admitir Líquidos y Frutos secos también en las instantáneas guardadas. Si faltan la tabla o las RPC, se identifica la migración inicial de compra sin permitir editar una lista cuya carga ha fallado. No se han aplicado al proyecto remoto desde estas tareas.

## Congelador

- **Congelador** aparece en el menú de editores y abre `/freezer`, con breadcrumb propio y `noindex, nofollow`. Los congeladores y sus inventarios son privados por usuario, como Compra y Planificación, y están protegidos por RLS de propietario/editor.
- Se pueden crear y renombrar varios congeladores, por ejemplo Casa y Casa alquilada, y elegir cuál consultar. **Cambiar de congelador**, **Nuevo congelador**, **Renombrar** y **Eliminar congelador** están en el navbar, en un bloque contextual bajo la navegación principal como las acciones de recetas e ingredientes. En móvil se cierra el menú al elegir una acción o cambiar de congelador. Solo se permite eliminar un congelador vacío. La selección se conserva al navegar y se limpia al cambiar de usuario. No se trasladan productos entre congeladores.
- El listado muestra nombre, categoría o **Producto libre**, cantidad y fecha de entrada. La búsqueda por nombre sin distinguir acentos ni mayúsculas comparte fila con **Orden**, usando los mismos controles que Recetas y un contenedor verde adaptable. Admite Más antiguos (inicial), Más recientes, Nombre A–Z y Nombre Z–A. Ordena por la fecha de entrada del lote, no por la fecha de modificación. Búsqueda y ordenación no guardan ni consultan de nuevo el inventario. No hay botón Limpiar ni × para quitar lotes en el listado. No hay caducidad, consumo preferente ni historial.
- **+ Añadir**, con icono blanco sobre fondo verde, se muestra en el encabezado únicamente por encima de 1024 px. En tablet y móvil, hasta 1024 px, se utiliza el mismo botón + flotante y circular de Recetas, con los estilos globales y un espacio inferior que evita tapar el contenido. Ambos abren el mismo modal y se bloquean durante cargas u otros diálogos; un guardado en curso permite seguir añadiendo y editando.
- **Añadir** abre un modal con selección múltiple de ingredientes mediante el buscador y categoría compartidos, alta rápida de ingredientes simples y una opción **Producto libre**. Los productos libres solo se incorporan al inventario; no crean ingredientes en el catálogo. Se pueden combinar ingredientes y productos en una misma apertura.
- En **Producto libre**, el botón se llama **Añadir**, sin icono +, y comparte fila con el campo Nombre del producto incluso en móvil. Las filas de productos no muestran la etiqueta Producto libre y sus inputs de nombre, cantidad, valor, unidad y fecha quedan alineados en escritorio. La × que quita una selección del modal se presenta sin borde ni fondo en la esquina superior derecha de la fila, manteniendo control de teclado y etiqueta accesible.
- Cada entrada tiene identificador de lote propio y fecha de entrada obligatoria, inicialmente hoy y editable. Añadir de nuevo el mismo ingrediente crea otro lote, sin sumar ni reemplazar sus entradas anteriores, aunque coincidan las fechas. Nombres y categorías se guardan como instantáneas: una modificación o eliminación posterior del catálogo no destruye el inventario.
- Las cantidades siguen el formato de las recetas: Sin cantidad, 1 cucharada, 1 vaso o Cantidad específica positiva en g, ml o pieza. El formulario valida que una cantidad específica esté informada, sea finita y mayor que cero, y comprueba todos los formularios de fila antes de confirmar. No se impone un mínimo de 0,01; los valores positivos pequeños se muestran con cifras significativas para evitar que aparezcan como cero por redondeo. Se pueden editar las entradas y el nombre de un producto libre. En los modales de añadir y editar, ingrediente, tipo de cantidad, valor, unidad y fecha comparten una fila compacta en escritorio; se distribuyen en varias filas en móvil conservando valor y unidad juntos. Un nombre escrito en Producto libre se conserva al cambiar de pestaña, pero solo exige pulsar Añadir cuando esa pestaña está activa; no bloquea confirmar los ingredientes seleccionados.
- **Retirar** aparece en todas las entradas con fondo verde y texto blanco. En lotes con cantidad específica permite descontar una cantidad o seleccionar **Retirar todo el lote**; en las demás entradas confirma la retirada completa. Una retirada parcial conserva la fecha y el lote desaparece al agotarse. No se conserva historial de lotes agotados.
- En móvil, hasta 760 px, cada entrada del congelador mantiene en una misma fila la información del producto, la cantidad y las acciones Editar/Retirar. Se ajustan espacios, tipografía y ancho del icono de edición; los nombres y cantidades largos pueden partirse dentro de su columna, sin ocultarlos ni llevar las acciones a una fila inferior. Se conserva la altura de 44 px de los controles.
- La parte derecha de esas filas móviles dispone de más espacio: la cantidad puede ocupar hasta 88 px, el control de edición tiene 36 px de ancho y Retirar amplía su padding horizontal a 10 px. Los márgenes laterales de la página y el relleno del listado se reducen a 12 px para aprovechar la anchura disponible.
- Confirmar un alta, edición o retirada inicia inmediatamente el guardado automático del inventario; crear, renombrar o eliminar un congelador también se guarda automáticamente. No existe el botón Guardar congeladores. Editar campos del modal no escribe hasta confirmar; una confirmación múltiple guarda todos sus lotes en una sola operación. Las ediciones sin cambios no generan escrituras.
- Mientras se guarda se muestra **Guardando cambios…**, pero se pueden seguir modificando lotes y usando las acciones del navbar. Una cola conserva el orden de las operaciones y envía únicamente los nombres o lotes afectados, sin clonar, validar ni enviar todo el inventario por cada edición. La salida de la ruta permanece bloqueada mientras se procesa la cola. Las solicitudes de guardado comparten su resultado hasta terminar las operaciones pendientes. Si falla, se conserva el borrador y la cola con aviso de cambios pendientes y las acciones **Reintentar guardado** y **Cargar versión guardada**; esta última pide confirmar el descarte. Los reintentos de operaciones ya aplicadas, por ejemplo tras perder una respuesta, no duplican lotes ni descuentan cantidades dos veces. Mientras está montada la página, cerrar o recargar con datos pendientes, un guardado o un formulario abierto activa el aviso del navegador. El borrador pendiente solo vive en memoria, separado de los datos confirmados en Supabase.
- El modal usa `dialog` nativo, contiene el foco, bloquea el scroll de fondo y permite cerrar explícitamente o con Escape; si hay cambios pide confirmar el descarte. No se cierra al pulsar fuera. Se protege la salida de la ruta con un formulario modificado y se impide mientras se crea un ingrediente o se guarda.
- `FreezerService` comparte lecturas simultáneas, mantiene el borrador entre rutas, valida los datos y limpia el estado al cambiar de cuenta o perder permisos. Las lecturas se cancelan al cambiar de propietario; respuestas antiguas no restauran datos de otra sesión. No hay sincronización en tiempo real ni conexión automática con Compra o Planificación.
- `freezers` almacena una fila por congelador y `freezer_entries` una fila por lote, con RLS de propietario/editor en ambas tablas. `get_freezer_inventory` recupera la colección y `apply_freezer_changes` aplica cada operación de forma atómica, comparando el valor anterior únicamente de las filas afectadas. Las modificaciones de lotes o congeladores diferentes no generan conflictos por una versión global. Un conflicto sobre la misma fila conserva el borrador y ofrece **Cargar versión guardada**, con confirmación para descartarlo. Las validaciones SQL comprueban UUID, duplicados, nombres, fechas reales, categorías y cantidades.
- Requiere aplicar `20261026000100_freezer_inventories.sql` y después `20261026000200_freezer_entries.sql` antes de desplegar el frontend. La segunda conserva todos los nombres, lotes, cantidades, fechas y orden del documento anterior, y mantiene `freezer_inventories` como archivo sin acceso desde el navegador. Revoca también la RPC antigua para impedir escrituras en un inventario paralelo; las pestañas con el frontend anterior deben recargarse. Si falta una RPC se identifican las migraciones y se bloquea la edición tras una carga fallida. No se han aplicado al proyecto remoto desde esta tarea.

## Funcionalidades de ingredientes y elaboraciones

- Listado con búsqueda, filtro de categoría, agrupación por categorías y número de resultados.
- Creación, edición y eliminación para editores autorizados.
- Las categorías del modelo son `Verdura`, `Fruta`, `Legumbre`, `Pescado`, `Carne`, `Lacteo`, `Cereal`, `Liquidos`, `FrutosSecos`, `Especia`, `Elaboracion` y `Otro`. `Liquidos` se muestra como **Líquidos** y `FrutosSecos` como **Frutos secos**. `INGREDIENT_CATEGORIES` centraliza la lista utilizada por formularios, filtros y validación de compra. Ambas categorías tienen iconos y están disponibles en la creación rápida desde recetas y compra. Requieren aplicar `20261021000100_ingredient_categories.sql`, que amplía el CHECK de ingredientes y la validación de listas guardadas sin modificar datos ni RLS.
- Una elaboración tiene componentes y cantidades propias y se puede utilizar en recetas como otro ingrediente.
- El editor de componentes usa el mismo formato de selección que los ingredientes de una receta: búsqueda por nombre desde dos caracteres o filtro por categoría, resultados agrupados con botón **+** y lista de seleccionados con categoría, botón de quitar y cantidades. No muestra todo el catálogo al entrar ni usa casillas. Excluye los componentes ya seleccionados, otras elaboraciones y el propio ingrediente editado. Quitar un componente borra su cantidad del borrador; volver a añadirlo empieza sin cantidad. Las cantidades de los demás componentes y las recuperadas al editar se conservan.
- Si no hay resultados se puede crear un componente simple desde el mismo editor, con nombre y categoría, sin cerrar la elaboración. Recetas y elaboraciones comparten la lógica de creación rápida: reutilizan el índice normalizado para evitar duplicados, bloquean envíos repetidos y conservan los datos tras errores. No se permite crear o seleccionar otra elaboración como componente mediante esta vía. Los controles de cantidad usan la misma cuadrícula adaptable en ambos formularios, con selector en una fila y valor/unidad debajo en móvil.
- El detalle muestra los componentes de la elaboración y las recetas donde se utiliza el ingrediente. Las recetas relacionadas tienen carga, error y reintento independientes del detalle del ingrediente.
- Las claves foráneas impiden eliminar ingredientes referenciados por recetas o elaboraciones.
- El catálogo se solicita bajo demanda, solo con `id,name,category`, por páginas de hasta 200 filas ordenadas por ID. La siguiente página parte del número real de filas recibidas, para respetar límites de respuesta menores; solo la primera consulta pide recuento exacto. Se publica el catálogo completo al terminar, sin emitir páginas parciales que puedan borrar selecciones de formularios. Las cargas simultáneas se comparten y una carga fallida permite reintentar conservando el catálogo anterior.
- Los filtros de recetas crean su selector de ingredientes al mostrarse, ya que todos los controles están siempre visibles, también en el selector del planner. El catálogo resumido se comparte y se reutiliza entre pantallas. Abrir el catálogo, un formulario o un detalle de receta pide únicamente el resumen del catálogo. La composición y cantidades se consultan por ingrediente con `ensureDetails`, al abrir su detalle o editarlo; esas peticiones también se comparten y no se presentan resúmenes como detalles completos. Los formularios de edición esperan a recibir esa información. Crear un ingrediente incorpora el resultado confirmado al índice local sin refrescar todo el catálogo; una carga que ya estuviera en curso se reinicia para evitar datos antiguos y conserva el detalle recién creado. Modificar un ingrediente mantiene el refresco del catálogo resumido y conserva el detalle guardado.

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
- Las rutas de detalle, ingredientes, las tres páginas del planner, Compra, login y 404 se cargan con `loadComponent`. `PlannerPageComponent` contiene solo consulta y navegación; `PlannerEditorPageComponent` comparte la modificación entre `/planner/day` y `/planner/week` mediante los datos de la ruta. El formulario, el visor y el contenido plegable Añadir ingredientes de Compra usan `@defer`, y el optimizador de imágenes se importa al subir fotos nuevas.

### Caché de datos

- `CacheService` centraliza `localStorage` con el prefijo `laurel:cache:`, formato versionado y TTL en milisegundos. Leer una entrada no prolonga su caducidad.
- Los detalles completos y contadores tienen un TTL de 60 segundos, configurable por separado mediante `recipeDetailCacheTtlMs` y `recipeStatsCacheTtlMs` en ambos entornos, con claves separadas por proyecto Supabase.
- Se limpian datos caducados o corruptos, con un máximo de 80 entradas y unos 2 MiB de texto serializado. La colección de detalles completos en memoria se limita a 40 recetas.
- Si el almacenamiento está bloqueado o lleno se usa respaldo en memoria, sujeto también a límites. Ante un error de cuota se liberan datos propios y se reintenta persistir.
- `clearData()` elimina la caché de datos sin borrar la sesión ni claves ajenas. La sesión tiene su TTL independiente y queda fuera de los límites de datos.
- Se comparten peticiones simultáneas al mismo detalle y a los contadores. Guardar, borrar o puntuar invalida las entradas correspondientes, y una respuesta antigua no puede sobrescribir una versión nueva o recuperar una receta borrada.
- Los resultados de intervalos de Compra usan una caché independiente en memoria, privada por sesión, de cinco minutos y hasta veinte entradas. No se escriben en `localStorage`. Comparten peticiones, devuelven copias y se invalidan por cambios de recetas, catálogo o comidas, como se detalla en Compra. La caché de comidas y el estado de navegación del planner mantienen sus límites propios.

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
- Las recetas compartidas utilizan metadatos específicos entregados por `api/recipe-preview.js` en el HTML inicial. Las demás rutas conservan la tarjeta genérica estática de `src/index.html`.
- `PageMetadataService` actualiza la URL canónica y `og:url` usando el dominio público, sin parámetros de navegación como `fromPlanner` o `plannerStart`. `/login`, `/shopping`, `/freezer`, las tres rutas del planner y las páginas 404 utilizan `noindex, nofollow`.
- `vercel.json` conserva el framework Angular, la carpeta de salida y una reescritura general a `index.html`, precedida por la ruta `/recipes/:id` a la función de previsualización. La función incluye el HTML compilado y el entorno público de producción. Las rutas de detalle, login y desconocidas pueden abrirse directamente en el navegador.
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
12. [20261020000400_shopping_lists.sql](supabase/migrations/20261020000400_shopping_lists.sql): lista de compra personal con RLS, guardado con versión y cálculo de apariciones desde las comidas planificadas.
13. [20261021000100_ingredient_categories.sql](supabase/migrations/20261021000100_ingredient_categories.sql): añade Líquidos y Frutos secos a ingredientes y a las instantáneas de compra; conserva datos y permisos.
14. [20261026000100_freezer_inventories.sql](supabase/migrations/20261026000100_freezer_inventories.sql): inventarios privados de congeladores, lotes y productos libres, validación y guardado con versión.
15. [20261026000200_freezer_entries.sql](supabase/migrations/20261026000200_freezer_entries.sql): migra el inventario existente a filas por congelador y lote, con guardado parcial atómico, comparación de cambios por fila y reintentos sin duplicados; archiva y bloquea la API anterior.

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
| `node --test tests/recipe-preview.test.cjs` | Metadatos por receta, foto ordenada, imagen alternativa, escape HTML, errores de lectura, IDs inválidos y configuración de rutas de Vercel. |
| `npm run test:photos:sql` | Nueve pruebas SQL en PostgreSQL/WASM local de atomicidad, conflictos, borrado y permisos de fotos. Requiere instalar PGlite temporalmente como indica `OPTIMIZACION.md`. |
| `npm run test:shopping` | Veintiséis pruebas de la lista, categorías, limpieza, incrementos y límites, fechas, agrupación, guardado, borradores, paginación y caché de intervalos, concurrencia, cancelación e invalidación por cambios de cuenta o datos. |
| `npm run test:shopping:sql` | Diez pruebas de las migraciones reales de compra y categorías en PostgreSQL/WASM local: categorías nuevas, recuentos, límites inclusivos, privacidad, validación, reejecución y conflictos. Requiere PGlite temporal. |
| `npm run test:freezer` | Veinticinco pruebas de lotes, cantidades, formularios reales del modal, retiradas, ordenación, selección, escrituras parciales, cola de guardado, reintentos y aislamiento de cuentas. |
| `npm run test:freezer:sql` | Diecisiete pruebas de las migraciones reales en PostgreSQL/WASM local: conservación de datos, escrituras por fila, validación, privacidad, permisos, conflictos, atomicidad y reintentos. Requiere PGlite temporal. |
| `npm run test:planner` | Fechas, límites y duplicados por comida, guardado diario, permisos, cachés, caducidad, cancelación e aislamiento entre cuentas (`scheduled-meals.test.cjs` y `planner-state.test.cjs`). |
| `node --test tests/*.test.cjs` | Todas las pruebas del repositorio, incluidas las SQL locales cuando está disponible PGlite. |

### Última validación registrada

Para el modal de adición de Compra pasaron compilación, lint y las **26 pruebas de Compra**. Chrome con Supabase simulado verificó la eliminación del desplegable, el botón de escritorio y el + flotante compartido, carga del catálogo solo al abrir, selección manual, alta con error y reintento, bloqueo del cierre durante el alta, conservación de búsqueda y fechas al reabrir, confirmación de planning con Cancelar/Escape/aceptar sobre el modal, vuelta a Manual, restauración del foco y del scroll y guardado explícito. Se revisaron capturas del modal y el calendario, sin excepciones ni desbordamiento a 320, 390, 768, 1024, 1025 y 1440 px. No requiere migración nueva ni se ha desplegado desde esta tarea.

Para las correcciones de Congelador (guardado parcial, validación y cambio de pestaña del modal) pasaron compilación, lint y las **216 pruebas** del repositorio, incluidas 25 del servicio/modal y 17 SQL de las dos migraciones. Se comprobaron cola de guardado sin bloqueo de edición, conservación de cambios posteriores a un fallo, reintentos tras perder la respuesta, escritura exclusiva del lote afectado y conservación de inventarios existentes. Chrome con Supabase interceptado y las migraciones ejecutadas en PostgreSQL/WASM local verificó el producto pendiente oculto, cantidades vacías/cero/negativas, valores pequeños sin redondear a cero, cambio de tipo de cantidad, ediciones durante un guardado lento, reintento y recuperación tras recarga a 320, 390, 768 y 1440 px, sin excepciones ni desbordamiento. Requiere aplicar `20261026000200_freezer_entries.sql` antes de publicar el frontend; no se ha aplicado al proyecto remoto ni desplegado desde esta tarea.

Para el centrado de la puntuación, Preparación condicional y filas móviles del congelador pasaron compilación y lint. Chrome con Supabase simulado verificó puntuación centrada con 8 px superiores, ocultación de Preparación con arrays vacíos o pasos en blanco, columna única de ingredientes y conservación de pasos válidos. También comprobó información, cantidad y acciones en la misma fila móvil, nombres y cantidades largos, edición y retirada con guardado automático, sin desbordamiento entre 320 y 1440 px. Se revisaron capturas de recetas y congelador. No se requiere migración ni se ha desplegado desde esta tarea.

Para la redistribución del detalle de recetas pasaron compilación, lint y **37 pruebas** de recetas, valoraciones, tarjetas y recursos. Chrome con Supabase simulado verificó las cuatro filas, tamaño de dificultad, puntuación antes de ingredientes, Puntuar en el navbar y separación de las acciones de edición, cierre del menú y foco al formulario, guardado único sin nuevas lecturas del detalle, reintento tras error y valoración de pendientes. Se comprobaron nombres largos, varios tipos de plato, ausencia de metadatos opcionales y acceso de solo lectura. Sin desbordamientos a 320, 390, 520, 760, 768, 1120 y 1440 px; se revisaron capturas de escritorio y móvil. No se requiere una migración ni se ha desplegado desde esta tarea.

Para los ajustes visuales de Producto libre pasaron compilación y lint. Chrome con Supabase simulado verificó Añadir junto al campo de nombre, ausencia de la etiqueta en las filas, alineación de inputs al añadir y editar, × sin recuadro en la esquina superior derecha y activación mediante teclado. También se comprobaron el guardado automático tras alta y edición y la ausencia de desbordamiento a 320, 390, 700, 701, 768 y 1440 px. Se revisaron capturas de móvil y escritorio, sin excepciones de ejecución. No se han añadido pruebas unitarias ni repetido la suite completa para este cambio de presentación; no se ha desplegado desde esta tarea.

Para el guardado automático, ordenación y botón adaptable de Congelador pasaron compilación, lint y las **195 pruebas** del repositorio. Chrome con Supabase simulado verificó guardado inmediato de altas, ediciones, retiradas y cambios de congelador, conservación tras recarga, bloqueo de operaciones durante un guardado lento, conflicto con reintento y carga de la versión guardada, los cuatro órdenes combinados con búsqueda normalizada, Retirar verde y el cambio entre Añadir de escritorio y + flotante a 320, 390, 768, 1024, 1025, 1120 y 1440 px. Se revisaron capturas de escritorio y móvil, sin desbordamiento ni excepciones. No se requiere una migración adicional ni se ha desplegado desde esta tarea.

Tras los ajustes del navbar y la presentación de Congelador pasaron compilación, lint y **193 pruebas**. Chrome con Supabase simulado verificó acciones contextuales, cambio de congelador y cierre del menú móvil, retirada completa con y sin cantidad específica, ausencia de Limpiar y de × en el listado, + blanco y filas compactas de alta y edición. Se revisaron página, navbar y modal con contenido a 320, 390, 700, 701, 768 y 1440 px, sin desbordamiento ni excepciones de ejecución. Estos ajustes no requieren una migración adicional y no se han desplegado desde esta tarea.

Para Congelador (26 de octubre) pasaron compilación de producción, lint y las **192 pruebas** del repositorio, incluidas doce nuevas de inventario y seis SQL. Se verificó en Chrome con Supabase simulado: varios congeladores, alta conjunta de ingredientes y productos libres, lotes separados, edición, retiradas parciales y completas, guardado explícito, borrador entre rutas, conflicto con reintento, recuperación tras recarga y alta rápida sin refrescar el catálogo. No hubo excepciones de ejecución ni desbordamiento en página y modal a 320, 390, 768 y 1440 px. No se ha aplicado la migración remota ni desplegado desde esta tarea.

Para los cambios del 22 de octubre (acceso semanal con comidas guardadas, autocompletado numérico y etiquetas de coincidencias) pasaron compilación de producción, lint y **58 pruebas** de tarjetas, consultas de recetas, listado, estado del planner y búsqueda. Las regresiones comprueban coincidencias parciales y múltiples, conservación del total de ingredientes, orden, duplicados y ocultación de etiquetas al limpiar o reutilizar tarjetas fuera de la búsqueda. No se ha desplegado desde esta tarea.

Tras reproducir el HTTP 400 de la búsqueda por ingredientes, se retiró el filtro embebido incompatible de la RPC y se repitieron esas **58 pruebas**, compilación y lint. Se comprobó además `RecipeService.getBatch` con una lectura pública real del ingrediente que fallaba: devuelve la receta y únicamente la etiqueta coincidente, conservando el total de ingredientes. No se modificaron datos remotos. El aviso Angular `NG0751` corresponde a la carga anticipada de dependencias de `@defer` con HMR en desarrollo y es independiente de este fallo de consulta.

Para los cambios de compartir se verificaron compilación de producción, lint y **35 pruebas** de compra, recursos y previsualización, además de ejecutar la función con el HTML compilado y Supabase simulado. No se ha desplegado ni verificado la tarjeta en una aplicación de mensajería desde esta tarea.

La última ejecución completa tras las correcciones de Compra pasó **163 pruebas**, con compilación y lint correctos. Incluye doce nuevas regresiones sobre el alta sin recarga del catálogo, la conservación de un ingrediente creado durante cargas anteriores y la caché de intervalos: reutilización, consultas simultáneas, cancelación de consumidores, caducidad, límites, invalidación y aislamiento de cuentas. Esta actualización del documento no implica una nueva ejecución de esas pruebas.

Las pruebas SQL ejecutan las migraciones reales de fotos, compra y categorías en PostgreSQL/WASM aislado con PGlite e identidades de prueba; comprueban atomicidad, privacidad, validaciones, conflictos y conservación de datos. No ejecutan SQL ni verifican el estado de permisos del proyecto Supabase remoto.

### Comprobaciones de navegador registradas

Se usó Chrome con Supabase simulado para verificar los siguientes comportamientos:

- **Recetas y filtros:** búsqueda normalizada de ingredientes y orden por coincidencias, filtros compartidos siempre visibles en listado y selector del planner, limpieza desde Recetas guardadas, conservación de criterios y reutilización de resultados al reabrir el selector.
- **Ingredientes y elaboraciones:** carga bajo demanda y paginada, filtros por nombre y categoría, exclusión de seleccionados y componentes no permitidos, alta rápida con reintento, bloqueo de envíos repetidos, cantidades conservadas al editar y limpieza de cantidades al quitar y volver a añadir un componente. La creación desde recetas sigue funcionando tras compartir su lógica con elaboraciones.
- **Planificación:** acceso directo al editor diario, breadcrumb y regreso desde recetas, estado vacío independiente con Planificar Día y Planificar Semana, vuelta tras guardar correctamente y conservación de ruta y borrador tras errores. Guardar en semanal mantiene esa vista; cancelar un descarte conserva los cambios.
- **Compra manual:** contenedor de lista siempre visible, acciones condicionadas por contenido o cambios, categoría sola o combinada con búsqueda, alta y adición con reintento, incrementos con clic y Enter, eliminación, limpieza y persistencia del vaciado, guardado, recuperación tras recarga y alternativas de compartir.
- **Compra desde planning:** calendario integrado en pestañas, extremos inicialmente vacíos, elección explícita de Desde y Hasta, intervalos inclusivos de uno o varios días y entre semanas, vista previa sin modificar la lista, enlace al plan semanal si no hay ingredientes, confirmación obligatoria de reemplazo y regreso a Manual después de aceptarlo. Cancelar conserva lista y fechas.
- **Coordinación y consultas de Compra:** Guardar permanece bloqueado durante un alta lenta; el ingrediente termina en la lista guardada sin volver a consultar el catálogo. Durante un guardado no puede iniciarse un alta. Repetir fechas durante una consulta, pulsar un extremo ya elegido y reabrir Según planning con el mismo intervalo no repiten el cálculo mientras es válido.
- **Cachés y precarga:** volver del detalle reutiliza comidas, tarjetas y resultados mientras son válidos. Las peticiones de recetas se cancelan al cambiar búsqueda o cerrar el selector. Los calendarios, listados y detalles muestran cargas y reintentos sin falsos estados vacíos ni páginas 404 durante una consulta.
- **Diseño adaptable y accesibilidad:** controles con teclado, estados de foco, diálogos y bloqueo de scroll, movimiento reducido y ausencia de desbordamiento en las comprobaciones de Compra, formularios y selectores a 320, 390 y 1440 px. Los filtros del listado se comprobaron también a 768 px y en otras anchuras intermedias.

Los scripts y capturas auxiliares están en `.angular/`, fuera de los comandos de `package.json`; no constituyen una suite de integración mantenida. Las comprobaciones locales no confirman la aplicación de migraciones ni un despliegue en Vercel.

## Mejoras y funcionalidades pendientes

Estas propuestas se han comentado, pero no deben describirse como implementadas:

- **Protección frente a abuso:** límites de peticiones por IP y usuario, cuotas adicionales, límites de trabajo por petición y revisión de límites de autenticación y consumo en Supabase. La caché y los bloqueos del frontend no constituyen una defensa frente a llamadas directas. No se han configurado desde el repositorio reglas de rate limiting en Vercel ni límites personalizados de peticiones en Supabase. El firewall de Vercel no limita las consultas que el navegador envía directamente a Supabase.
- **API propia aplazada:** una capa intermedia, en Vercel Functions o Spring Boot, con contadores compartidos y restricciones de acceso directo se valorará solo en desarrollos posteriores. Actualmente no forma parte del trabajo autorizado ni de la arquitectura desplegable del repositorio.
- **Ingredientes:** reducir el refresco completo del catálogo que todavía realiza la modificación de un ingrediente y paginar en la interfaz las recetas relacionadas. El alta ya actualiza el índice local sin descargar de nuevo el catálogo; la carga selectiva, las peticiones compartidas y la lectura paginada también están implementadas. La edición aún espera al refresco posterior: un fallo de esa lectura puede presentarse como error pese a haberse confirmado la escritura.
- **Consultas:** extender la cancelación efectiva a los flujos que todavía no reciben `AbortSignal`, como los detalles y el catálogo de ingredientes. El listado principal ya aborta las lecturas y los refrescos por lotes al cambiar filtros, invalidarse o perder su último suscriptor; el planner y su selector también cancelan sus lecturas. Siguen pendientes la reducción de recuentos exactos repetidos de recetas y la revisión de índices y planes de ejecución con datos reales antes de añadirlos.
- **Imágenes:** miniaturas para tarjetas y optimización de fotos antiguas.
- **Interfaz:** reducir cálculos repetidos en otras plantillas cuando las mediciones lo justifiquen. El editor del planner ya deriva entradas, identificadores y contadores por fecha/comida mediante `computed`.
- **Conflictos de planificación entre pestañas/dispositivos:** `save_scheduled_day` bloquea por usuario y fecha para serializar escrituras, pero no compara una versión esperada. Un guardado del día completo basado en datos antiguos puede reemplazar otro posterior a la carga; no hay detección ni resolución de conflictos.
- **Referencias a recetas eliminadas:** los UUID de las recetas planificadas viven en JSON, sin clave foránea a `recipes`. Se valida su formato y la ausencia de duplicados, pero no su existencia. El estado actual presenta **Receta no disponible** y permite quitarla desde el editor; no hay limpieza automática de esas referencias.
- **Cambio de día con la página abierta:** la fecha de hoy se fija al montar el componente. No hay actualización automática a medianoche ni al recuperar el foco para cambiar esa fecha; una nueva entrada a la página calcula de nuevo el día local. Cualquier mejora debe conservar los borradores y no cambiar silenciosamente el día que se está editando.
- **Protección global del borrador de Compra:** el borrador sobrevive a navegar a otra página, pero el aviso de cierre solo está instalado mientras Compra está montada. Falta llevar esa protección al ámbito global o persistir un borrador local por usuario para evitar perderlo si se cierra o recarga desde otra ruta.
- **Consistencia del cálculo paginado de Compra:** cada página de la RPC es una consulta independiente. Si las comidas o las recetas cambian entre páginas, puede mezclarse información de momentos distintos sin que la validación detecte todos los casos. La caché reduce cálculos idénticos, pero no aporta una instantánea transaccional única; una futura respuesta agregada del servidor permitiría resolverlo.
- **Cálculos de Compra:** los cambios de fechas que producen intervalos distintos siguen consultándose inmediatamente y los cambios de contador vuelven a agrupar y ordenar la lista. Debounce para selecciones rápidas y evitar reordenar cuando solo cambia un contador siguen pendientes; la deduplicación y caché de intervalos idénticos sí están implementadas.
- **Evolución funcional:** exportación a otros formatos, información nutricional y ampliación de roles si se necesitan permisos distintos del grupo único de editores.

Las fotos, la edición de recetas e ingredientes, el enlace para compartir y la página 404 ya están implementados y no forman parte de esa lista de pendientes.
