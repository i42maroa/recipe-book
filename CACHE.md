# Caché local y restauración de sesión

`CacheService` centraliza `localStorage`. Guarda cada valor con una fecha de caducidad y elimina entradas caducadas o corruptas al leerlas. Las claves se guardan con el prefijo `laurel:cache:`; no se borra el resto del almacenamiento del navegador.

```typescript
const cache = inject(CacheService);
cache.set('filtros', { pending: true }, 15 * 60 * 1000); // 15 minutos
const filtros = cache.get<{ pending: boolean }>('filtros');
cache.remove('filtros');
```

El tiempo se expresa en milisegundos. Cero elimina la entrada. Leer no prolonga su duración; volver a guardar sí. Si el navegador bloquea `localStorage` o no tiene espacio, el servicio usa memoria para que la pestaña pueda seguir funcionando, pero en ese caso los datos no sobreviven al cierre de la página.

## Sesión de Supabase

`SupabaseService` utiliza `cache.createStorage(environment.sessionCacheTtlMs)` como almacenamiento del SDK, con `persistSession`, `autoRefreshToken` y detección del retorno OAuth activados. La caducidad es de **30 días desde el último guardado o renovación**. Cambia `sessionCacheTtlMs` en los dos archivos de entorno para ajustarla.

Supabase sigue gestionando la sesión, el token de acceso y la rotación del token de renovación. La caché no prolonga la validez de los tokens ni evita una revocación o las restricciones de sesión configuradas en Supabase. El plazo de 30 días corresponde a la persistencia local, no a una garantía de acceso durante 30 días. La sesión anterior se migra al nuevo formato al leerla, sin pedir un login nuevo solo por el despliegue.

Al arrancar, volver del segundo plano, recuperar el foco o la conexión, `AuthService` lee la sesión a través del SDK y comprueba de nuevo la pertenencia al grupo. Las solicitudes simultáneas de restauración se agrupan. Una pérdida temporal de conexión no borra por sí sola la información del usuario; los permisos se revalidan cuando vuelve la conexión. No se guarda `canEdit` en caché. RLS sigue siendo la garantía de autorización y se comprueban permisos antes de escribir.

Cerrar sesión elimina el valor guardado y el formato anterior. Una respuesta de permisos que llegue después de cerrar sesión no puede volver a habilitar la edición.

## Uso en móvil

Usa siempre el mismo navegador y el dominio público `https://recipe-book-neon-two.vercel.app`. `localStorage` está separado por origen: una sesión de localhost o de otra URL de Vercel no aparece automáticamente en el dominio público. Los navegadores integrados en otras aplicaciones también pueden tener su propio almacenamiento. Si el navegador borra los datos del sitio, usa navegación privada sin persistencia o el servidor revoca la sesión, hará falta iniciar sesión de nuevo.

Prueba en el móvil: iniciar sesión, apagar la pantalla, volver a la pestaña, cerrar y reabrir la web en el mismo navegador y dominio y, finalmente, cerrar sesión y recargar. Las pruebas automatizadas cubren caducidad, migración, persistencia con el SDK real, renovación de tokens, cierre de sesión y eventos de reanudación con red simulada.

Ejecuta `npm run test:session`, `npm run lint` y `npm run build`. No hacen falta queries SQL nuevas.
