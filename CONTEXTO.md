# Contexto del proyecto

## Propósito

La aplicación será un recetario personal para guardar recetas que ya he preparado y recetas que me gustaría probar. Permitirá consultar y organizar recetas e ingredientes desde una página web.

## Tecnologías previstas

- **Frontend:** Angular 22.
- **Base de datos:** Firebase.
- **Backend:** servicios de Firebase.

El producto o servicio concreto de Firebase que se usará para persistencia y las decisiones de autenticación quedan pendientes de definir durante el desarrollo.

## Diseño y arquitectura de frontend

- **Estilo visual:** la interfaz debe ser clara, sencilla y coherente, y facilitar la consulta y gestión de recetas e ingredientes. Los detalles visuales (paleta, tipografía, espaciado y adaptación a distintos tamaños de pantalla) se concretarán al diseñar el MVP.
- **Variables visuales:** los colores y otros valores visuales compartidos se centralizarán en `src/styles/root.css` bajo `:root`; las hojas de estilos de los componentes consumirán estas variables para reutilizar la paleta.
- **Componentes independientes:** los componentes Angular se crearán como componentes standalone, organizados por funcionalidad y con responsabilidades acotadas.
- **Archivos de componentes:** cada componente tendrá su plantilla HTML y su hoja de estilos CSS en archivos independientes (`templateUrl` y `styleUrl`); no se incluirá el HTML ni el CSS en el archivo TypeScript del componente.
- **Componentes reutilizables de interfaz:** los elementos comunes, como botones, navegación/navbar y otros controles compartidos, se implementarán como componentes reutilizables para mantener una experiencia coherente y evitar duplicar estructura y estilos.
- **Organización de carpetas:** los componentes compartidos vivirán en `components/shared/`, cada componente específico tendrá su propia carpeta dentro de `components/` y las pantallas enrutables se organizarán dentro de `pages/`, también en carpetas por página.
- **Enrutado y composición de la aplicación:** el componente raíz será el marco común de la web e incluirá el navbar, el `router-outlet` para mostrar la página activa y el centro global de notificaciones. El archivo de rutas registrará las páginas disponibles.
- **Servicios reutilizables:** cuando una funcionalidad o lógica de negocio vaya a reutilizarse, se encapsulará en un servicio y se inyectará en los componentes o servicios que la necesiten. Los componentes evitarán concentrar lógica de acceso a datos.
- **Formularios reactivos:** los formularios usarán formularios reactivos de Angular y observables para gestionar los datos y los cambios de estado de forma reactiva.
- **Formulario base reutilizable:** habrá un componente reutilizable para presentar formularios. Este componente seleccionará mediante un `switch` entre distintas plantillas de formulario, según el tipo de formulario que se necesite.
- **Notificaciones:** habrá un servicio de notificaciones que centralice los mensajes de la aplicación y un componente que los muestre en la interfaz.
- **Acceso a Firebase:** durante la segunda evolución se añadirá un servicio de conexión con Firebase, que centralizará el acceso a los servicios de Firebase usados por la aplicación.
- **Lint:** se configurará lint para aplicar y verificar convenciones de código y controlar la coherencia de los estilos. Las reglas concretas se definirán al configurar el proyecto Angular.

Estas pautas orientan la estructura del frontend desde el primer evolutivo. La conexión efectiva con Firebase corresponde al segundo evolutivo.

## Plan de evolución

1. **MVP del frontend:** desarrollar la interfaz y los flujos principales con datos de ejemplo o estado local. El MVP se detalla en este documento.
2. **Integración con Firebase:** conectar la aplicación con Firebase e implementar la lógica de backend necesaria para el MVP.
3. **Despliegue:** publicar la aplicación para que se pueda usar desde la web.

## Alcance del MVP

### Recetas

La persona usuaria podrá:

- Crear una receta con:
  - nombre;
  - lista de ingredientes, seleccionando ingredientes existentes o creando uno nuevo desde el propio formulario;
  - tiempo aproximado de preparación expresado en minutos;
  - pasos de preparación;
  - estado pendiente, para indicar si quiere probarla;
  - uno o varios tipos de comida: desayuno, entrante, plato o postre;
  - valoración numérica del 1 al 10;
  - URL del sitio donde encontró la receta.
- Consultar un listado de recetas.
- Abrir una receta del listado y consultar su información completa.
- Mostrar la receta seleccionada en una página dedicada, identificada por su ID en la URL (`/recipes/:id`).
- Buscar recetas por nombre, por estado pendiente (pendiente o no pendiente) y por ingredientes.

### Ingredientes

La persona usuaria podrá:

- Consultar el listado de ingredientes.
- Añadir ingredientes.
- Eliminar ingredientes.
- Asignar una categoría a cada ingrediente, por ejemplo: legumbre, pescado o fruta.
- No eliminar un ingrediente mientras esté asociado a una receta.

Cada ingrediente tendrá estos campos:

- **Nombre** (obligatorio).
- **Categoría** (obligatoria), por ejemplo: legumbre, pescado o fruta.

## Modelo conceptual inicial

- **Receta:** nombre, ingredientes asociados, tiempo aproximado, pasos, indicador de pendiente, tipo de comida, valoración y URL de origen.
- **Ingrediente:** nombre y categoría.
- **Categoría de ingrediente:** clasificación del ingrediente (por ejemplo, legumbre, pescado o fruta). La lista definitiva de categorías está por definir.

La receta relaciona varios ingredientes. Al crear una receta se podrán seleccionar ingredientes existentes y también introducir ingredientes nuevos desde el formulario.

## Reglas y validaciones del MVP

- Son obligatorios el nombre de la receta, la lista de ingredientes y el estado pendiente (sí o no).
- El tiempo aproximado se expresa en minutos.
- La valoración, cuando se indique, es un número entero del 1 al 10.
- Una receta puede pertenecer a más de un tipo de comida.
- Un ingrediente asociado a una o más recetas no se puede eliminar.
- El MVP no incluirá autenticación.

## Funcionalidades futuras

Las siguientes ideas quedan fuera del MVP y podrán abordarse en evoluciones posteriores:

- **Planificación semanal:** organizar las comidas de la semana asignando una receta a cada día.
- **Lista de la compra automática:** generar una lista a partir de los ingredientes de las recetas planificadas, agrupando los ingredientes que se repitan cuando sea posible.
- **Fotografías:** añadir y consultar fotografías asociadas a las recetas.
- **Exportación de recetas:** exportar o compartir una receta en un formato que se definirá más adelante.
- **Información nutricional:** calcular los valores nutricionales de una receta a partir de sus ingredientes.

El alcance y los detalles de estas funcionalidades se definirán cuando se planifiquen sus respectivas evoluciones.

## Criterios y decisiones pendientes

Este documento recoge el contexto inicial. Antes o durante la implementación se concretarán, entre otros, estos puntos:

- edición de recetas e ingredientes, además de los flujos de creación y eliminación descritos;
- detalles de presentación y combinación de los criterios de búsqueda;
- servicios concretos de Firebase y reglas de seguridad;
- alojamiento y configuración del despliegue.

Las funcionalidades no descritas en el alcance del MVP no se consideran comprometidas para la primera evolución.
