# Base de datos del recetario con Supabase

## Objetivo

Este documento define una propuesta para persistir la aplicación de recetas usando **Supabase Database (PostgreSQL)**. El modelo cubre el MVP actual y deja preparada la estructura para planificación semanal, listas de la compra, fotografías, exportación y cálculo nutricional.

La aplicación gestiona recetas e ingredientes con relaciones de muchos a muchos: una receta contiene varios ingredientes y un ingrediente puede aparecer en varias recetas. La cantidad pertenece a la relación receta–ingrediente, porque el mismo ingrediente puede usarse en cantidades distintas según la receta.

## Decisión tecnológica

Se recomienda PostgreSQL en Supabase frente a una base documental para este dominio. Las relaciones, claves foráneas, restricciones y consultas `JOIN` encajan con los casos de uso, especialmente con la consulta inversa «¿en qué recetas se utiliza este ingrediente?». Supabase proporciona una base de datos PostgreSQL y su API puede consultar relaciones basadas en claves foráneas.

Firestore también podría resolver el caso, pero exigiría planificar cómo mantener las referencias entre recetas e ingredientes y cómo construir las vistas relacionadas. La documentación de Firestore describe su modelo documental, las consultas por pertenencia a arrays y los índices necesarios para consultas compuestas. Para esta aplicación, el modelo relacional mantiene estas relaciones más explícitas.

Referencias oficiales:

- [Supabase: base de datos](https://supabase.com/docs/guides/database/overview)
- [Supabase: tablas y relaciones](https://supabase.com/docs/guides/database/tables?database-method=sql&queryGroups=database-method)
- [Supabase: consultas con relaciones](https://supabase.com/docs/guides/database/joins-and-nesting)
- [Firebase: modelo de datos de Firestore](https://firebase.google.com/docs/firestore/data-model)
- [Firebase: consultas de Firestore](https://firebase.google.com/docs/firestore/query-data/queries)

## Requisitos de datos del MVP

### Receta

- Identificador estable.
- Nombre obligatorio.
- Uno o varios ingredientes obligatorios.
- Estado pendiente o elaborada obligatorio.
- Tiempo aproximado en minutos.
- Número opcional de comensales (entero mayor que cero).
- Pasos de preparación ordenados.
- Tipo o tipos de comida: desayuno, entrante, plato o postre. Una receta puede pertenecer a más de uno.
- Valoración opcional de 1 a 10.
- URL de origen opcional.
- Anotaciones opcionales.
- Indicador fitness.
- Dificultad opcional.
- Uno o varios estilos/cocinas opcionales: española, mexicana, italiana, japonesa, etc.

### Ingrediente

- Identificador estable.
- Nombre.
- Categoría, por ejemplo verdura, fruta, legumbre, pescado, carne, lácteo, cereal, especia, elaboración u otro.
- Una elaboración puede componerse de otros ingredientes y se puede usar en recetas igual que cualquier otro ingrediente.

### Cantidades

La cantidad se guarda en la relación con la receta (o con la elaboración que la contiene). Debe poder representar:

- Sin cantidad indicada.
- Una cucharada.
- Un vaso.
- Una pieza.
- Una cantidad numérica con unidad: ml, g.

## Modelo relacional

| Tabla | Responsabilidad |
| --- | --- |
| `recipes` | Datos generales de la receta. |
| `ingredients` | Catálogo de ingredientes y su categoría. |
| `recipe_ingredients` | Relación receta–ingrediente, con su cantidad. |
| `recipe_steps` | Pasos ordenados de cada receta. |
| `ingredient_components` | Componentes y cantidades de una elaboración. |
| `cuisine_types` | Catálogo de estilos/cocinas. |
| `recipe_cuisine_types` | Relación muchos-a-muchos entre recetas y estilos. |
| `scheduled_meals` | Comidas privadas por usuario, fecha y hueco, sin entidad de plan. |
| `shopping_lists` | Lista de la compra guardada, si se necesita persistirla. |
| `shopping_list_items` | Ingredientes y estado de compra de una lista. |
| `recipe_photos` | Metadatos y ruta de fotos almacenadas en Supabase Storage. |
| `ingredient_nutrients` | Datos nutricionales por ingrediente y base de medida. |

## Esquema SQL inicial

Este SQL es una base de partida. Debe guardarse y aplicarse mediante migraciones de Supabase para que los cambios del esquema sean reproducibles entre entornos.

```sql
create extension if not exists pgcrypto;

create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  minutes integer check (minutes is null or minutes >= 0),
  servings integer check (servings is null or servings >= 1),
  pending boolean not null,
  meal_types text[] not null default '{}',
  rating smallint check (rating is null or rating between 1 and 10),
  source_url text,
  annotations text,
  fitness boolean not null default false,
  difficulty text check (
    difficulty is null or difficulty in ('Fácil', 'Media', 'Difícil')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ingredients (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  category text not null check (
    category in (
      'Verdura', 'Fruta', 'Legumbre', 'Pescado', 'Carne',
      'Lácteo', 'Cereal', 'Especia', 'Elaboración', 'Otro'
    )
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.recipe_ingredients (
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  ingredient_id uuid not null references public.ingredients(id) on delete restrict,
  amount_kind text not null check (
    amount_kind in ('none', 'spoon', 'glass', 'specific')
  ),
  amount_value numeric check (amount_value is null or amount_value > 0),
  amount_unit text check (
    amount_unit is null or amount_unit in ('ml', 'g', 'pieza')
  ),
  primary key (recipe_id, ingredient_id),
  check (
    (amount_kind = 'specific' and amount_value is not null and amount_unit is not null)
    or
    (amount_kind <> 'specific' and amount_value is null and amount_unit is null)
  )
);

create table public.recipe_steps (
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  position integer not null check (position > 0),
  description text not null,
  primary key (recipe_id, position)
);

create table public.ingredient_components (
  parent_ingredient_id uuid not null
    references public.ingredients(id) on delete restrict,
  component_ingredient_id uuid not null
    references public.ingredients(id) on delete restrict,
  amount_kind text not null check (
    amount_kind in ('none', 'spoon', 'glass', 'specific')
  ),
  amount_value numeric check (amount_value is null or amount_value > 0),
  amount_unit text check (
    amount_unit is null or amount_unit in ('ml', 'g', 'pieza')
  ),
  primary key (parent_ingredient_id, component_ingredient_id),
  check (parent_ingredient_id <> component_ingredient_id),
  check (
    (amount_kind = 'specific' and amount_value is not null and amount_unit is not null)
    or
    (amount_kind <> 'specific' and amount_value is null and amount_unit is null)
  )
);

create table public.cuisine_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique
);

create table public.recipe_cuisine_types (
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  cuisine_type_id uuid not null
    references public.cuisine_types(id) on delete restrict,
  primary key (recipe_id, cuisine_type_id)
);
```

### Notas de esquema

- `meal_types` se guarda como array porque el conjunto es pequeño y una receta puede tener varios tipos. Si esos tipos necesitan administración dinámica, se puede cambiar a `meal_types` y `recipe_meal_types` como tablas de catálogo y unión.
- `cuisine_types` usa catálogo más tabla de unión para evitar variaciones de escritura y permitir varias cocinas por receta.
- Los valores de dificultad y categoría están restringidos en SQL como ejemplo. En una implementación con valores dinámicos, conviene modelarlos como catálogos.
- `recipe_ingredients` usa una clave primaria compuesta para evitar repetir el mismo ingrediente en una receta. Si en el futuro una receta necesita el mismo ingrediente en momentos distintos (por ejemplo, separado entre salsa y masa), usar un `id` propio y permitir varias filas.
- La base de datos no puede comprobar con una restricción sencilla que toda receta tenga al menos un ingrediente. Esa regla debe validarse en el servicio transaccional que crea/actualiza la receta; si se requiere garantía estricta en BD, usar una función/trigger cuidadosamente diseñado.
- `updated_at` debe actualizarse mediante trigger o desde el servicio en cada modificación.
- Evita usar nombres como identificadores. Usa UUID y conserva el nombre como dato editable.

## Consultas principales

### Obtener una receta con sus ingredientes y cantidades

```sql
select
  i.id,
  i.name,
  i.category,
  ri.amount_kind,
  ri.amount_value,
  ri.amount_unit
from public.recipe_ingredients ri
join public.ingredients i on i.id = ri.ingredient_id
where ri.recipe_id = :recipe_id
order by i.category, i.name;
```

Los pasos se obtienen ordenados por `position`; los estilos se obtienen uniendo `recipe_cuisine_types` y `cuisine_types`.

### Listar las recetas que usan un ingrediente

```sql
select r.id, r.name, r.pending, r.minutes, r.rating
from public.recipe_ingredients ri
join public.recipes r on r.id = ri.recipe_id
where ri.ingredient_id = :ingredient_id
order by r.name;
```

Esta es la consulta inversa usada en el detalle del ingrediente. La tabla de unión permite llegar a todas las recetas relacionadas sin guardar una lista duplicada de recetas en cada ingrediente.

### Filtrar recetas pendientes que contienen un ingrediente

```sql
select distinct r.id, r.name, r.pending, r.minutes
from public.recipes r
join public.recipe_ingredients ri on ri.recipe_id = r.id
where r.pending = true
  and ri.ingredient_id = :ingredient_id
order by r.name;
```

### Búsqueda por nombre

Para un MVP pequeño, puede usarse `ilike`:

```sql
select id, name, pending, minutes, rating
from public.recipes
where name ilike '%' || :search_text || '%'
order by name;
```

Si la colección crece, revisar búsqueda de texto completo o índices trigram para mantener búsquedas parciales eficientes.

## Índices sugeridos

Las claves primarias ya crean índices. Para las consultas anteriores, añadir índices en las columnas de relación y en los filtros frecuentes:

```sql
create index recipe_ingredients_by_ingredient
  on public.recipe_ingredients (ingredient_id, recipe_id);

create index recipe_ingredients_by_recipe
  on public.recipe_ingredients (recipe_id, ingredient_id);

create index recipes_by_pending
  on public.recipes (pending);

create index recipes_by_rating
  on public.recipes (rating desc);

create index recipes_by_minutes
  on public.recipes (minutes);
```

Los índices deben responder a consultas reales: cada índice adicional ocupa espacio y añade trabajo a las escrituras. Revisar el plan de ejecución cuando haya suficientes datos.

## Integridad y reglas de borrado

- Una receta se puede borrar y sus pasos, ingredientes relacionados y estilos asociados se borran en cascada (`on delete cascade`). Esto borra las filas de relación, no los ingredientes compartidos.
- Un ingrediente que se use en una receta no se puede borrar (`on delete restrict`). La base de datos rechazará la operación mientras exista una referencia.
- Un ingrediente componente de una elaboración tampoco se puede borrar mientras exista una referencia en `ingredient_components`.
- Antes de borrar desde la interfaz, consultar y mostrar al usuario las recetas/elaboraciones que lo usan. La restricción de la base de datos sigue siendo la garantía final ante concurrencia o errores de interfaz.
- No usar `on delete cascade` desde una receta hacia ingredientes: borraría datos del catálogo que pueden ser compartidos por otras recetas.
- Si se necesita conservar historial en lugar de borrar, considerar `archived_at` o `is_active` para baja lógica.

## Funcionalidades futuras

### Organización semanal implementada

La planificación utiliza `scheduled_meals`, con clave primaria `(owner_id, meal_date, slot)`. Cada registro guarda comensales y un array JSON de hasta cinco recetas con `recipeId` y `mode` (`scale` o `leftovers`). No existe un nombre ni identificador de plan ni favoritos en el modelo activo.

La RPC `save_scheduled_day(date,jsonb)` guarda los huecos de un día en una transacción, incluyendo borrados, y no modifica otras fechas. RLS restringe lecturas y escrituras al propietario que pertenezca al grupo de editores. La tabla y conversión de datos previos están en [20261020000100_daily_meals.sql](supabase/migrations/20261020000100_daily_meals.sql); los datos históricos quedan como archivo sin acceso de navegador.

### Lista de la compra

Puede generarse al vuelo a partir de las recetas planificadas y sus ingredientes. Si se necesita marcar artículos como comprados, guardar una lista y sus líneas:

```sql
create table public.shopping_lists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.shopping_list_items (
  id uuid primary key default gen_random_uuid(),
  shopping_list_id uuid not null
    references public.shopping_lists(id) on delete cascade,
  ingredient_id uuid not null
    references public.ingredients(id) on delete restrict,
  amount_value numeric,
  amount_unit text,
  checked boolean not null default false,
  notes text
);
```

Solo sumar cantidades que tengan unidades compatibles. No mezclar automáticamente gramos, mililitros, piezas, vasos y cucharadas. Las cantidades sin unidad convertible deben agruparse o mostrarse por separado.

### Fotografías

Guardar los ficheros en **Supabase Storage** y no como datos binarios en `recipes`. En PostgreSQL conservar la ruta, orden y metadatos:

```sql
create table public.recipe_photos (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  storage_path text not null unique,
  position integer not null default 1 check (position between 1 and 3),
  alt_text text,
  created_at timestamptz not null default now(),
  unique (recipe_id, position)
);
```

Configurar las políticas de Storage junto con las políticas de base de datos.

### Exportación

La exportación se puede construir a partir de la receta consultada y sus relaciones, generando el formato elegido (por ejemplo, impresión o PDF). No hace falta duplicar todos los campos de la receta en una tabla de exportaciones salvo que se necesite guardar un historial de documentos generados.

### Cálculo nutricional

```sql
create table public.ingredient_nutrients (
  ingredient_id uuid primary key
    references public.ingredients(id) on delete cascade,
  basis_amount numeric not null default 100,
  basis_unit text not null default 'g',
  calories_kcal numeric,
  protein_g numeric,
  carbohydrates_g numeric,
  fat_g numeric,
  fiber_g numeric,
  source text,
  updated_at timestamptz not null default now()
);
```

Registrar la base de cálculo y la fuente de los valores. El resultado por receta dependerá de poder convertir las cantidades a unidades comparables; vasos y cucharadas necesitan una equivalencia por ingrediente o una estimación explícita. Conviene indicar cuándo el valor nutricional es aproximado.

## Seguridad: lectura pública y escritura autorizada

La migración vigente es [20261018000100_editor_access.sql](supabase/migrations/20261018000100_editor_access.sql). Se aplica después del esquema y las migraciones de fotos y comensales y sustituye la escritura anónima anterior. Los pasos completos, configuración de Google y queries para gestionar miembros están en [SUPABASE.md](SUPABASE.md).

- Todas las tablas del recetario enumeradas en la migración permiten lectura pública a `anon` y `authenticated`, incluidas relaciones, pasos y metadatos de fotos.
- Insertar, actualizar y borrar exige sesión y pertenencia a `private.recipe_editors`. No hay propietarios por receta: los editores comparten la gestión del catálogo.
- Los miembros referencian `auth.users(id)` y se administran desde SQL Editor. La tabla privada no es accesible desde el navegador; ni siquiera un editor puede conceder permisos desde la API.
- `public.is_recipe_editor()` es una función `SECURITY DEFINER` con `search_path` vacío. Solo devuelve si el usuario actual es miembro; no acepta IDs de terceros.
- `save_recipe` y `save_ingredient` mantienen `SECURITY INVOKER` y permisos de ejecución solo para `authenticated`; sus escrituras están sujetas a RLS.
- Se reemplazan todas las políticas de las tablas enumeradas y se revocan los privilegios anteriores, incluido `TRUNCATE`. Revisa la lista si has personalizado el esquema.
- Las fotos siguen siendo públicas. Las escrituras del bucket requieren pertenecer al grupo; políticas restrictivas adicionales impiden que otras políticas permisivas de Storage habiliten escrituras no autorizadas en ese bucket.
- Al retirar un miembro, la siguiente escritura queda bloqueada aunque su sesión siga siendo válida. El front comprueba permisos al restaurar/cambiar sesión y antes de escribir; `/login` permite comprobarlos manualmente.
- Las tablas, vistas, RPC o buckets futuros necesitan sus propios permisos. Las tablas opcionales de este documento solo quedan cubiertas si existen al ejecutar la migración.
- Nunca incluir una clave `secret` o `service_role` en Angular. Esas claves pueden eludir RLS y deben permanecer en un entorno controlado del servidor.
- Ocultar botones y no enlazar `/login` define la interfaz; RLS y los permisos de base de datos son la protección efectiva. Los administradores y servicios con privilegios elevados conservan su acceso de administración.

Documentación oficial: [seguridad de datos en Supabase](https://supabase.com/docs/guides/database/secure-data) y [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security).

## Organización de la lógica en Angular

Mantener la base de datos detrás de una capa de acceso para no acoplar componentes a las consultas SQL/API:

1. **Modelos de dominio:** `Recipe`, `Ingredient`, cantidades y tipos usados por la interfaz.
2. **Servicio de conexión:** inicializa el cliente Supabase con URL y clave publicable desde configuración de entorno.
3. **Repositorios/servicios de datos:** `RecipeService`, `IngredientService`, `WeeklyPlanService`, etc.; encapsulan consultas, escrituras y traducción entre filas relacionadas y modelos de dominio.
4. **Componentes/páginas:** consumen servicios y muestran estado, formularios y notificaciones; no construyen consultas de base de datos.
5. **Validación:** validar en formularios para dar respuesta rápida y en la base de datos/servicio para garantizar integridad.

Las claves públicas configuradas en el frontend no son secretos. La seguridad efectiva debe proceder de RLS, permisos y políticas correctamente configuradas.

## Inventario de congeladores implementado

La migración `supabase/migrations/20261026000100_freezer_inventories.sql` añade `freezer_inventories`: una fila por `owner_id`, con `freezers` JSONB, `version` y `updated_at`. Cada congelador contiene `id`, `name` e `items`; cada lote contiene `id`, `ingredientId` opcional representado como null, nombre y categoría como instantánea, cantidad en el formato de recetas y `enteredOn` como fecha de calendario.

Los productos libres llevan `ingredientId: null` y `category: null`, sin escribir en el catálogo. Cada alta conserva su propio lote, aunque repita ingrediente. Los identificadores de ingredientes son referencias informativas sin clave foránea: cambiar o eliminar el ingrediente no elimina un lote guardado. No se conservan movimientos ni historial de lotes consumidos.

RLS limita lecturas y escrituras al propietario autenticado con permiso de editor. `valid_freezer_inventory(jsonb)` valida la estructura completa y `save_freezer_inventory(jsonb,bigint)` guarda atómicamente, comparando la versión anterior para rechazar sobrescrituras desde borradores antiguos. El frontend guarda automáticamente el conjunto de congeladores del usuario al confirmar cada alta, edición, retirada o cambio de congelador. Se bloquean las modificaciones durante la escritura y los cambios fallidos se conservan en memoria para reintentar o cargar la versión guardada. Búsqueda y ordenación no escriben en la base de datos. Esta descripción corresponde al código del repositorio, sin confirmar la aplicación de la migración remota.

## Buenas prácticas de evolución

1. Crear migraciones SQL para todo cambio de esquema y conservarlas en el repositorio.
2. Mantener datos de ejemplo separados de las migraciones del esquema.
3. Usar transacciones cuando una operación cree/actualice una receta junto con sus ingredientes, pasos y estilos; evitar que quede guardada a medias.
4. Definir consultas e índices a partir de las pantallas: listado, filtros, detalle de receta y detalle de ingrediente.
5. No duplicar arrays de relaciones en varias tablas salvo que exista una necesidad medida de rendimiento y un plan para mantenerlos sincronizados.
6. Probar las restricciones de borrado y las políticas RLS antes de publicar.
7. Revisar las relaciones y el modelo cuando se implemente planificación y cálculo de compra, sobre todo conversiones de unidades.

## Conclusión

Para este recetario, **Supabase con PostgreSQL** es la opción recomendada: representa claramente la relación muchos-a-muchos entre recetas e ingredientes, permite consultar desde ambos lados y protege las reglas de integridad en la propia base de datos. El esquema puede crecer con las funciones futuras sin almacenar listas duplicadas de referencias.
