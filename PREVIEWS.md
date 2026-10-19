# Tarjeta genérica y favicon

Todas las URLs comparten la misma tarjeta de Laurel: título, descripción e imagen fija de 1200 × 630. Los metadatos Open Graph y Twitter están en `src/index.html` y la imagen en `src/assets/brand/social-preview.png`.

Los enlaces compartidos siguen apuntando al detalle concreto de la receta. El HTML inicial no fija `og:url` ni una URL canónica común para todas las recetas; los lectores del enlace pueden utilizar la URL solicitada. En el navegador, `PageMetadataService` actualiza únicamente la URL pública y evita la indexación de `/login`. No consulta recetas ni fotos para generar metadatos.

`vercel.json` sirve directamente `index.html` para las rutas de recetas, ingredientes y login. La preview no necesita funciones de Vercel, llamadas a Supabase, variables adicionales ni migraciones. Angular mantiene sus consultas habituales para mostrar la aplicación.

El favicon está disponible en SVG, PNG de 32 px e ICO, con un icono Apple de 180 px. Los recursos están en `src/assets/brand/`. Para regenerar los PNG e ICO en Windows: `powershell -File scripts/create-brand-assets.ps1`.

## Despliegue y comprobaciones

Despliega todos los cambios, incluida la eliminación de la función anterior y la nueva configuración de Vercel. El dominio público debe ser accesible sin cuenta de Vercel.

- `npm run build`
- `npm run lint`
- `npm run test:assets`

Después de desplegar, comprueba una URL de receta y su código fuente: debe incluir el título y la imagen genérica de Laurel, y abrir el detalle solicitado. Comprueba también `/favicon.ico` y `/assets/brand/social-preview.png`. Las aplicaciones sociales pueden conservar tarjetas anteriores en caché y tardar en reflejar el cambio.

Si cambia el dominio público, actualiza `publicSiteUrl` en los entornos, las URLs de imagen de `src/index.html` y el texto de la imagen de marca.
