# Contexto del proyecto

Actualizado el 19 de octubre de 2026. Este documento describe lo implementado en el repositorio y las decisiones vigentes. Las migraciones de Supabase y la publicación de cada versión en Vercel se realizan por separado; este documento no confirma su estado remoto.

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
| `/login` | Acceso con Google o correo/contraseña y comprobación de permisos. |
| Cualquier ruta desconocida | Página 404, conservando la URL introducida. |

El componente raíz compone el navbar, el breadcrumb, el `router-outlet`, las notificaciones y el formulario cuando se abre.

- En escritorio, el navbar se presenta como una barra lateral.
- En tablet y móvil, hasta 1120 px, un botón hamburguesa abre el menú sobre el contenido y ocupa la pantalla completa. Abrirlo no empuja el detalle hacia abajo y bloquea el scroll del fondo.
- El menú se cierra al navegar o pulsar Escape y contiene el foco del teclado mientras está abierto en estas resoluciones.
- Las acciones **Editar** y **Eliminar** aparecen en el navbar, en filas separadas bajo las opciones principales, con iconos y solo para editores autorizados cuando hay un detalle cargado.
- El navbar muestra el usuario conectado y **Cerrar sesión**. En escritorio están en filas diferentes; en tablet y móvil comparten fila.
- Se mantienen el breadcrumb y los accesos contextuales entre recetas e ingredientes. Hay accesos flotantes de creación en resoluciones pequeñas para los editores.

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
- Se mantiene un mínimo de dos caracteres, una espera de 300 ms y el escape de comodines. Vaciar el buscador elimina la búsqueda.
- Los filtros permiten seleccionar pendientes o preparadas, tipo de plato y dificultad.
- La ordenación permite más recientes, nombre A–Z, mejor puntuación o menor tiempo.
- Se muestran contadores de recetas guardadas y pendientes; el contador de pendientes permite activar ese filtro.
- `RecipeCard` es un modelo resumido para tarjetas: incluye los campos visibles, el número de ingredientes y los metadatos de fotos. El listado no descarga pasos, cantidades, anotaciones ni URL de origen y no guarda tarjetas como si fueran detalles completos.

### Conservación del listado al navegar

`RecipeListService` conserva en memoria una colección con búsqueda, filtros, orden, estado desplegado de los controles, tarjetas cargadas y posición de paginación. El componente guarda el scroll antes de salir y lo restaura tras renderizar el listado, al volver con Atrás, breadcrumb o navbar, también en móvil.

Volver sin cambios reutiliza las tarjetas sin consultar de nuevo las recetas. Si en esta aplicación se ha creado, editado, puntuado o eliminado una receta, se refresca toda la ventana previamente cargada, manteniendo filtros y scroll. Las ventanas grandes se recuperan por lotes y los cambios de filtro reinician la paginación.

Este estado no se guarda en `localStorage` y se pierde al recargar la web. No recibe actualizaciones en tiempo real de otras pestañas o usuarios. Las cargas interrumpidas y las respuestas antiguas no sustituyen la colección actual.

### Detalle, formularios y acciones

- El detalle presenta fotos, datos generales, ingredientes agrupados por categoría y cantidades, comensales, pasos, anotaciones, valoración y enlace de origen cuando existe.
- La fila del título reúne el nombre, los tipos de plato y el botón de compartir a la derecha, con su icono.
- El editor de recetas se organiza en cuatro secciones: **Datos**, **Ingredientes**, **Preparación** y **Fotos**. Permite crear ingredientes desde el propio formulario.
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

## Funcionalidades de ingredientes y elaboraciones

- Listado con búsqueda, filtro de categoría, agrupación por categorías y número de resultados.
- Creación, edición y eliminación para editores autorizados.
- Las categorías del modelo son `Verdura`, `Fruta`, `Legumbre`, `Pescado`, `Carne`, `Lacteo`, `Cereal`, `Especia`, `Elaboracion` y `Otro`; las etiquetas visibles pueden llevar acentos.
- Una elaboración tiene componentes y cantidades propias y se puede utilizar en recetas como otro ingrediente.
- El detalle muestra los componentes de la elaboración y las recetas donde se utiliza el ingrediente. Las recetas relacionadas tienen carga, error y reintento independientes del detalle del ingrediente.
- Las claves foráneas impiden eliminar ingredientes referenciados por recetas o elaboraciones.
- Actualmente se carga el catálogo con sus composiciones y se refresca entero después de crear o modificar un ingrediente. La carga selectiva y la paginación de ese catálogo siguen pendientes de optimización.

## Autenticación, permisos y sesión

La consulta de recetas, ingredientes y fotos es pública, tanto sin sesión como con una cuenta que no tenga permisos de edición. Todos los editores autorizados gestionan el mismo recetario.

- `/login` permite acceder con Google o correo y contraseña, comprobar permisos y cerrar sesión. No hay botones ni enlaces hacia esa ruta en el resto de la web: se accede escribiendo el path.
- No hay formularios de registro ni recuperación de contraseña en la aplicación.
- Google OAuth se configura en Google Cloud y en el proveedor de Supabase. El retorno apunta al origen actual más `/login`; las URLs deben estar autorizadas en Supabase. Los secretos del proveedor no se guardan en Angular.
- La autorización depende del UUID de Supabase Auth y de su pertenencia a `private.recipe_editors`, administrada desde SQL Editor o un backend de confianza. Entrar con Google no concede permisos de edición automáticamente.
- `AuthService` consulta `is_recipe_editor()` al restaurar o cambiar la sesión y antes de las escrituras. Las autorizaciones no se guardan como una concesión local en caché.
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
- Se diferencian carga, vacío, elemento inexistente y error recuperable. Cargar más mantiene las tarjetas anteriores; los errores permiten reintentar.
- Las rutas de detalle, ingredientes, login y 404 se cargan con `loadComponent`. El formulario y el visor usan `@defer`, y el optimizador de imágenes se importa al subir fotos nuevas.

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
- Si la receta se guarda pero falla una foto o la lectura final, se conserva el ID para reintentar como edición y evitar duplicados. Un fallo al refrescar contadores no se presenta como un fallo de un guardado ya confirmado.
- `rate_recipe(uuid,integer)` realiza la escritura parcial de valoración: valida el valor, comprueba el editor y actualiza únicamente `rating`, `pending` y `updated_at`, sin reescribir ingredientes, pasos, cocinas, fotos ni otros campos.
- Puntuar actualiza el detalle visible en memoria e invalida su caché persistente para no prolongar datos ajenos al cambio. Los contadores se refrescan solo si la receta estaba pendiente. El formulario completo conserva su guardado transaccional.

Los cambios de otros usuarios no se sincronizan en tiempo real. El detalle y los contadores se revalidan conforme a sus cargas y TTL; el estado de navegación del listado tiene el comportamiento descrito en su sección.

Detalles de implementación, llamadas esperadas y pruebas: [OPTIMIZACION.md](OPTIMIZACION.md).

## Identidad visual, metadatos y despliegue

- La identidad visible es **Laurel**, con variables visuales compartidas, tipografías y componentes adaptados a las distintas resoluciones.
- Se incluyen favicon SVG, PNG e ICO y un icono para dispositivos Apple.
- Las previsualizaciones compartidas utilizan una **tarjeta genérica estática** con imagen, título y descripción comunes para toda la web. No se genera una tarjeta por receta ni hay funciones de servidor que consulten Supabase para las previsualizaciones.
- `PageMetadataService` actualiza la URL canónica y `og:url` usando el dominio público. `/login` y las páginas 404 utilizan `noindex, nofollow`.
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

La última validación de los cambios funcionales pasó compilación, lint y 53 pruebas automatizadas. Se realizaron también comprobaciones en Chrome con transporte Supabase simulado para navegación, formularios, scroll, móvil y 404. Estas pruebas no ejecutan las migraciones ni verifican por sí solas las políticas del proyecto remoto: la comprobación de lectura pública y escrituras autorizadas en Supabase forma parte del despliegue.

## Mejoras y funcionalidades pendientes

Estas propuestas se han comentado, pero no deben describirse como implementadas:

- **Protección frente a abuso:** límites de peticiones por IP y usuario, cuotas adicionales, límites de trabajo por petición y revisión de límites de autenticación y consumo en Supabase. La caché y los bloqueos del frontend no constituyen una defensa frente a llamadas directas. No se han configurado desde el repositorio reglas de rate limiting en Vercel ni límites personalizados de peticiones en Supabase. El firewall de Vercel no limita las consultas que el navegador envía directamente a Supabase.
- **API propia aplazada:** una capa intermedia, en Vercel Functions o Spring Boot, con contadores compartidos y restricciones de acceso directo se valorará solo en desarrollos posteriores. Actualmente no forma parte del trabajo autorizado ni de la arquitectura desplegable del repositorio.
- **Ingredientes:** carga selectiva, peticiones compartidas, actualización local de elementos modificados y paginación del catálogo y de recetas relacionadas.
- **Consultas:** cancelación efectiva de peticiones obsoletas, reducción de recuentos exactos repetidos y revisión de índices y planes de ejecución con datos reales antes de añadirlos.
- **Imágenes:** miniaturas para tarjetas y optimización de fotos antiguas.
- **Interfaz:** reducir cálculos repetidos de filtrado, agrupación y ordenación en las plantillas cuando las mediciones lo justifiquen.
- **Evolución funcional:** planificación semanal, lista de la compra, exportación a otros formatos, información nutricional y ampliación de roles si se necesitan permisos distintos del grupo único de editores.

Las fotos, la edición de recetas e ingredientes, el enlace para compartir y la página 404 ya están implementados y no forman parte de esa lista de pendientes.
