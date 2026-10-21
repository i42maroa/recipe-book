# Previsualización de recetas y favicon

Las URLs `/recipes/:id` entregan el nombre y un resumen de la receta, con tiempo, comensales y dificultad cuando existen. La imagen es la primera foto según su posición; sin fotos se utiliza `src/assets/brand/social-preview.png`, de 1200 × 630. Las demás rutas conservan la tarjeta genérica de Laurel.

Los enlaces compartidos siguen apuntando al detalle concreto. `api/recipe-preview.js` inserta Open Graph, Twitter y la URL canónica en el HTML compilado, conservando los scripts de Angular. Los lectores de enlaces obtienen los metadatos sin ejecutar JavaScript. En el navegador, `PageMetadataService` actualiza la URL pública y los permisos de indexación.

`vercel.json` reescribe las rutas de receta a la función antes del fallback de la SPA. `includeFiles` incorpora el HTML compilado y `src/environments/environment.production.ts` a la función. La consulta selecciona solo datos públicos de un UUID validado, con la clave publishable, sin cookies ni tokens de usuario. No requiere variables adicionales ni migraciones. Angular mantiene sus consultas habituales.

Los éxitos se cachean en Vercel durante 60 segundos. Tras cuatro segundos de espera, un error de Supabase, una receta ausente o un ID inválido, se entrega el HTML genérico sin caché compartida para que Angular gestione el detalle. `ng serve` ejecuta la SPA local sin la función de Vercel.

El favicon está disponible en SVG, PNG de 32 px e ICO, con un icono Apple de 180 px. Los recursos están en `src/assets/brand/`. Para regenerar los PNG e ICO en Windows: `powershell -File scripts/create-brand-assets.ps1`.

## Despliegue y comprobaciones

Despliega conjuntamente la función, la configuración de Vercel y la aplicación. El dominio público debe ser accesible sin cuenta de Vercel.

- `npm run build`
- `npm run lint`
- `npm run test:assets`
- `node --test tests/recipe-preview.test.cjs tests/shopping-list.test.cjs`

Después de desplegar, comprueba una URL de receta y su código fuente: debe incluir su nombre, su primera foto y su URL pública sin parámetros del planner, y abrir el detalle solicitado. Comprueba una receta sin fotos, una inexistente, `/favicon.ico` y `/assets/brand/social-preview.png`. Las pruebas locales simulan Supabase y no confirman el despliegue. Las aplicaciones sociales pueden conservar tarjetas anteriores en caché y decidir si muestran la tarjeta.

Si cambia el dominio público, actualiza `publicSiteUrl` en los entornos, las URLs de imagen de `src/index.html` y el texto de la imagen de marca.
