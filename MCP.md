# MCP de Laurel

Primera implementación, 23 de noviembre de 2026. El código y las migraciones están preparados para consulta de recetas, creación y planificación diaria desde ChatGPT web u otro cliente MCP. La activación de OAuth, las migraciones en Supabase, el despliegue y la conexión real con ChatGPT se realizan por separado: las comprobaciones locales no confirman su estado remoto.

## Arquitectura

Angular continúa conectado directamente a Supabase. El endpoint `/mcp` añade una vía de acceso con el SDK oficial de MCP para TypeScript, Streamable HTTP y compatibilidad con clientes de protocolo 2025 y 2026. Se crea un cliente de Supabase por petición; los clientes autenticados envían el JWT del usuario a la API de datos y conservan RLS. No se usa `service_role`.

El servidor está en `server/mcp/`, los puntos de entrada de Vercel en `api/mcp.ts` y `api/mcp-metadata.ts`, y la autorización del usuario en `/oauth/consent`. `vercel.json` dirige `/mcp` y el descubrimiento OAuth a las funciones antes de la ruta comodín de Angular. Las herramientas se descubren sin iniciar sesión.

Las funciones usan `api/tsconfig.json`, que hereda la configuración NodeNext de `tsconfig.mcp.json`. Vercel busca la configuración desde el directorio del punto de entrada; sin este archivo utilizaría el `module: preserve` de Angular y dejaría instrucciones `export` en archivos que el runtime carga como CommonJS. `build:mcp` usa la misma configuración que Vercel y una prueba comprueba la carga de ambos puntos de entrada con el cargador CommonJS.

`module`, `moduleResolution`, `strict` y `strictNullChecks` también se declaran directamente en `api/tsconfig.json`: el empaquetador de Vercel puede introducir `strict: false` antes de resolver `extends` si falta `module` en el archivo inicial. Las pruebas reproducen ese paso previo y comprueban los tipos de ambas funciones; los UUID de las recetas siguen siendo obligatorios en el esquema de planificación.

| Herramienta | Acceso | Comportamiento |
| --- | --- | --- |
| `search_recipes` | Público | Nombre, ingredientes, estado, dificultad y tipo. Paginación de hasta 50 resultados. |
| `get_recipe` | Público | Ingredientes, cantidades, pasos ordenados y enlace a la receta. |
| `search_ingredients` | Público | Ingredientes existentes con ID, categoría, medida base y equivalencia por unidad. |
| `create_recipe` | Editor autenticado | Crea una receta compartida mediante `save_recipe_optimized`, con `p_id = null`. |
| `get_daily_plan` | Editor autenticado | Devuelve fecha, comidas y una versión del día privado del usuario. |
| `save_daily_plan` | Editor autenticado | Reemplaza el día completo en una transacción y comprueba la versión anterior. |

Las escrituras y los datos privados requieren OAuth. Las herramientas indican su esquema de autorización y sus efectos; las llamadas privadas sin sesión devuelven el desafío `mcp/www_authenticate` que permite al cliente iniciar la conexión. Un token incorrecto recibe HTTP 401 con `WWW-Authenticate`.

## Configuración en Supabase y Vercel

1. Aplica, después de las migraciones existentes, `supabase/migrations/20261123000100_mcp_daily_planning.sql` y `supabase/migrations/20261123000200_mcp_oauth.sql`. La primera añade lectura y guardado de días con control de versión. La segunda prepara un registro privado de clientes OAuth y un hook de tokens; no habilita OAuth automáticamente ni añade clientes.
2. En Supabase, activa **Authentication > OAuth Server**. Configura **Site URL** con la dirección de Laurel y el authorization path con `/oauth/consent`. Para esta primera versión usa un cliente previamente registrado y mantén desactivado el registro dinámico.
3. **Antes de iniciar el registro en ChatGPT**, configura las variables de servidor en **Vercel > proyecto > Settings > Environment Variables**, selecciona **Production** y realiza un nuevo despliegue:

   | Variable | Valor para el despliegue actual |
   | --- | --- |
   | `SUPABASE_URL` | `https://jglujthjuvahsvplquxd.supabase.co` |
   | `SUPABASE_PUBLISHABLE_KEY` | Clave pública `sb_publishable_...` del proyecto, o usa `SUPABASE_ANON_KEY` para la clave anon anterior. |
   | `PUBLIC_SITE_URL` | `https://recipe-book-neon-two.vercel.app` |
   | `MCP_RESOURCE_URL` | `https://recipe-book-neon-two.vercel.app/mcp` |

   Los valores del frontend en `environment.production.ts` no configuran las variables de las funciones de Vercel. `MCP_OAUTH_CLIENT_IDS` se completa después de registrar el cliente. En este punto funcionan el descubrimiento OAuth y las consultas públicas. Abre `https://recipe-book-neon-two.vercel.app/.well-known/oauth-protected-resource`: debe responder HTTP 200 con un JSON que contenga `resource` y `authorization_servers`. Si devuelve HTTP 503 con «El MCP de Laurel todavía no está configurado», falta alguna de las cuatro variables o tiene un valor no válido. Revisa también que estén aplicadas a Production y que el despliegue sea posterior al cambio de variables.

4. Registra un cliente OAuth para ChatGPT con la dirección de retorno **exacta que muestre ChatGPT** al configurar la conexión. Los callbacks pueden variar por conexión y configuración: no deduzcas la URI de un ejemplo. Guarda su ID y, si se utiliza un cliente confidencial, su secreto en la configuración OAuth de ChatGPT. Ese secreto no va al frontend ni al repositorio.
5. Asocia ese ID al recurso MCP desde SQL Editor, sustituyendo ambos valores:

   ```sql
   insert into private.mcp_oauth_clients(client_id, resource)
   values ('ID_DEL_CLIENTE_OAUTH', 'https://recipe-book-neon-two.vercel.app/mcp')
   on conflict (client_id) do update set resource = excluded.resource;
   ```

6. En **Authentication > Hooks**, habilita el hook de acceso `public.laurel_mcp_access_token_hook`. Si ya existe otro hook, integra esta función en el existente y conserva sus reglas. El hook solo modifica los tokens de los clientes registrados: añade la audiencia del MCP, conserva `authenticated` para la API de datos e identifica el cliente y el scope `openid`. Las sesiones normales de Laurel conservan sus claims.
7. Para Google, añade a **Authentication > URL Configuration > Redirect URLs** la vuelta a la pantalla de consentimiento con su identificador: `https://recipe-book-neon-two.vercel.app/oauth/consent?authorization_id=*`. Conserva el retorno `/login` existente. El callback configurado en Google sigue siendo el de Supabase; no es el callback OAuth de ChatGPT.
8. Añade a Vercel la variable `MCP_OAUTH_CLIENT_IDS` con el ID registrado en el paso 4 y realiza un nuevo despliegue. Admite varios IDs separados por comas. El recurso debe coincidir exactamente en `MCP_RESOURCE_URL`, la tabla privada y la URL configurada en ChatGPT. El servidor rechaza claves secretas, tokens sin esa audiencia, clientes no autorizados, sesiones caducadas y usuarios sin permisos.
9. Completa la conexión MCP en ChatGPT web con la URL `/mcp` y OAuth. Indica en sus ajustes avanzados el Client ID y el Client Secret del mismo cliente confidencial. El método de autenticación del endpoint de tokens registrado en Supabase debe coincidir con el que utilice la conexión. Los registros del 24 de noviembre de 2026 confirman que la conexión actual envía `client_secret_post`: registra ese método en Supabase para ese cliente. No supongas que ChatGPT utiliza `client_secret_basic` porque sea el valor predeterminado de Supabase. Guarda los ajustes, inicia otro intento de conexión y completa el acceso en Laurel. Revisa el nombre del cliente, la cuenta y el destino antes de permitir la conexión. Si cambian las herramientas, actualiza su definición en ChatGPT.

La disponibilidad de conexiones MCP, herramientas de escritura y modo de desarrollo depende del producto, el plan y las políticas del espacio. El despliegue y esta guía no habilitan esas opciones en la cuenta de ChatGPT.

### Diagnóstico del consentimiento

Supabase envía `authorization_id` en la URL de `/oauth/consent`. Es un token opaco (actualmente alfanumérico de 32 caracteres), distinto del UUID del cliente o del usuario. Laurel conserva su valor y mayúsculas, valida que sea un segmento de ruta seguro y consulta a Supabase para comprobar su existencia, propietario y caducidad. El retorno desde Google conserva ese mismo token.

Configura **Authentication > URL Configuration > Site URL** con `https://recipe-book-neon-two.vercel.app` y el authorization path con `/oauth/consent`. La autorización debe abrirse en el dominio público; las URL de Preview protegidas por Vercel requieren un acceso adicional y mantienen una sesión de navegador distinta. Mantén `PUBLIC_SITE_URL`, `MCP_RESOURCE_URL` y los Redirect URLs de Google coherentes con ese dominio. Tras cambiar Site URL, inicia una conexión nueva desde ChatGPT.

Si ChatGPT muestra un HTTP 400 genérico al finalizar, consulta el evento del mismo intento en **Supabase > Logs > Log Type: Auth** para `/oauth/token`. El evento de API Gateway (`edge`) informa del estado y de `x_sb_error_code`, pero el mensaje del servicio Auth permite distinguir el motivo. `invalid_credentials` por sí solo no demuestra que el secreto sea incorrecto.

Los registros aportados el 24 de noviembre confirman el rechazo `invalid authentication method: client is registered for 'client_secret_basic' but 'client_secret_post' was used`. Las autorizaciones de esos intentos identifican al cliente `960a00d7-aba4-4201-a1b1-e0855ae1c677`. Para esta conexión, cambia en **Authentication > OAuth Apps** su método de autenticación a `client_secret_post`. Si la interfaz no permite editarlo, [la reparación manual de ese cliente](supabase/queries/20261124_mcp_client_secret_post.sql) cambia solo el método desde SQL Editor con origen Database y devuelve únicamente el ID y el método. Conserva el cliente confidencial, su secreto y sus retornos. La consulta está limitada al cliente observado y al valor anterior Basic; no es una migración automática. Reintenta la conexión desde ChatGPT después del cambio. Comprueba también que el mismo ID figure en `private.mcp_oauth_clients` y en `MCP_OAUTH_CLIENT_IDS`; configurar otro cliente no afecta a estos intentos. La coincidencia de métodos está documentada en [la configuración del servidor OAuth de Supabase](https://supabase.com/docs/guides/auth/oauth-server/getting-started).

Para obtener ese detalle con SQL, abre **Explorer > Run SQL**, selecciona **Logs** como origen y el intervalo de los últimos 15 minutos. Reintenta la conexión y ejecuta [la consulta de registros de Auth](supabase/queries/20261124_mcp_auth_logs.sql). Usa ClickHouse y la tabla `logs` filtrada por `source = 'auth_logs'`; no se ejecuta contra la base de datos PostgreSQL. Devuelve los últimos 50 eventos con su mensaje, error, ruta, estado e identificador de petición. Revisa `/oauth/token` y los errores cercanos aunque no incluyan ruta. Si no devuelve filas, comprueba el intervalo y la retención antes de interpretar el resultado. No crea clientes ni modifica su configuración. Referencias: [consultar registros con SQL](https://supabase.com/docs/guides/observability/advanced-log-filtering) y [campos de los registros](https://supabase.com/docs/guides/observability/log-field-reference).

### Cuenta conectada pero sin herramientas

Que ChatGPT muestre una cuenta OAuth conectada confirma la vinculación de esa cuenta, pero no demuestra que haya importado la lista de herramientas ni que el MCP acepte el token emitido. En el despliegue público se han comprobado `initialize`, `notifications/initialized`, `tools/list` y consultas de recetas sin credenciales. La ficha del complemento debe mostrar las seis herramientas.

El servidor registra en Vercel una línea JSON `laurel_mcp_request` por petición a `/mcp` o `/api/mcp`. Incluye el método MCP reconocido, el estado HTTP y `authorization` (`absent`, `not_checked`, `accepted` o `rejected`). No incluye cabeceras, tokens, claims, argumentos, nombres de recetas ni mensajes de error de Supabase. `not_checked` significa que había una cabecera de autorización pero se devolvió una respuesta antes de verificarla, por ejemplo al rechazar el origen o el formato.

Tras desplegar esta versión, intenta usar el complemento y busca `laurel_mcp_request` en **Vercel > proyecto > Logs**. Para `tools/list`:

- `200`: el MCP ha entregado la respuesta con la lista; comprueba su importación y la versión del complemento en ChatGPT.
- `401` con `audience_mismatch`: comprueba el hook, el recurso registrado para el cliente activo y la URL canónica; después obtén un token nuevo mediante la reconexión.
- `401` con `client_not_allowed`: comprueba `MCP_OAUTH_CLIENT_IDS` en Production para el cliente OAuth activo y vuelve a desplegar si lo cambias.
- `401` con `missing_scope`: comprueba que el token emitido incluya `openid` y que el hook esté habilitado para el cliente activo.
- `401` con `token_verification_failed`: el SDK no ha podido verificar el token; revisa la configuración del proyecto y los registros de Auth sin compartir el token.
- Ausencia de peticiones en ese intervalo: no permite atribuir el fallo al validador del MCP; comprueba si ChatGPT está iniciando otra importación o utilizando una lista guardada.

Los restantes motivos son `issuer_mismatch`, `invalid_identity`, `expired_token`, `token_not_active` y `malformed_authorization`. Las etiquetas se registran solo en el servidor: el cliente sigue recibiendo el mismo error genérico y desafío OAuth. No reduzcas las comprobaciones del token para forzar la importación. Algunas interfaces muestran un control Refresh y otras no; usa solo los controles disponibles en la ficha actual. Referencia: [conectar y probar un MCP en ChatGPT](https://developers.openai.com/plugins/deploy/connect-chatgpt).

Para revisar el registro del cliente, ejecuta en SQL Editor [la consulta de diagnóstico](supabase/queries/20261124_mcp_oauth_diagnostics.sql). Solo devuelve el ID, nombre, tipo, método de autenticación, retornos registrados y recurso autorizado; no modifica datos ni devuelve secretos. Compara el Client ID con el de los ajustes OAuth de ChatGPT y `MCP_OAUTH_CLIENT_IDS` en Vercel. Un `connector_id` que empieza por `asdk_app_` pertenece a ChatGPT y es distinto del Client ID emitido por Supabase. Si se crea otra conexión, comprueba también la URI de retorno exacta que utilice esa conexión. El método registrado debe coincidir con el utilizado en el intercambio: `client_secret_basic` usa la cabecera HTTP Basic y `client_secret_post` los campos del formulario.

## Desarrollo y comprobaciones

Utiliza una versión de Node compatible con Angular 22: `^22.22.3`, `^24.15.0` o `>=26`. Las dependencias del MCP no se incorporan al bundle de Angular.

```powershell
npm install
npm run test:mcp
npm test
npm run lint
npm run build
```

Para arrancar el MCP local, copia `.env.mcp.example` a `.env.mcp`, configura las variables y ejecuta `npm run start:mcp`. La copia local está ignorada por Git. Para clientes locales puedes usar `MCP_RESOURCE_URL=http://127.0.0.1:3001/mcp`; la configuración OAuth de producción utiliza HTTPS y su audiencia pública. El servidor de desarrollo escucha solo en `127.0.0.1` y no sirve la web Angular. ChatGPT web necesita alcanzar el endpoint mediante hosting o un túnel compatible; un servidor local sin conexión accesible no basta.

Prueba pública del protocolo:

```powershell
$body = '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
Invoke-WebRequest -Uri http://127.0.0.1:3001/mcp -Method Post `
  -ContentType application/json -Headers @{ Accept = 'application/json, text/event-stream' } -Body $body
```

Las pruebas ejecutan llamadas reales al SDK MCP, verifican una firma JWT con JWKS de prueba, prueban aislamiento de los clientes y ejecutan las migraciones nuevas en PostgreSQL embebido (PGlite). La prueba SQL monta las tablas y los roles necesarios y reutiliza las funciones de validación y guardado de la migración vigente. Comprueba RLS entre usuarios, conflictos, rollback, protección del inventario y el hook. No sustituye la prueba del login completo en el proyecto alojado ni simula varias sesiones PostgreSQL concurrentes.

## Reglas de esta primera versión

- La creación acepta ingredientes ya existentes, cantidades válidas y pasos; no crea ingredientes ni sube fotografías. El estado predeterminado es pendiente y los comensales predeterminados son 2. Las cantidades reutilizan las reglas de medidas de la aplicación; Supabase vuelve a validarlas al guardar.
- Las búsquedas por nombre usan `ilike`: ignoran mayúsculas, pero no eliminan acentos. La búsqueda por ingredientes de recetas coincide con al menos uno de los IDs seleccionados y conserva la clasificación de la RPC existente.
- Las fechas son explícitas `YYYY-MM-DD`. El asistente debe resolver «hoy» o «mañana» según la zona del usuario y aclarar ambigüedades.
- El guardado diario recibe `expectedVersion` de `get_daily_plan`, comparte el bloqueo por usuario y fecha con la web y rechaza cambios si el día ya no coincide. Si hay conflicto, se consulta otra vez y se conserva lo que el usuario no pidió modificar. Las comidas omitidas se eliminan y `meals: []` vacía el día.
- Los días con referencias a inventario se consultan, pero su modificación desde el MCP se rechaza para conservar las asociaciones. Su gestión sigue disponible en Laurel.
- No hay reintentos automáticos de escrituras. Si se pierde una respuesta, hay que consultar antes de repetir una creación: aún no hay claves de idempotencia persistentes.
- El consentimiento autoriza al cliente OAuth con la identidad y los permisos del usuario. Esta primera versión limita las operaciones expuestas por el MCP; no introduce nuevos scopes de negocio ni convierte el token de Supabase en una credencial limitada exclusivamente a estas seis herramientas.
- Planificación semanal, edición y borrado de recetas, compra e inventario no se exponen como herramientas.

## Referencias

- [SDK MCP para TypeScript v2](https://ts.sdk.modelcontextprotocol.io/v2/).
- [Autorización MCP](https://modelcontextprotocol.io/specification/latest/basic/authorization).
- [OAuth y MCP con Supabase](https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication).
- [Configuración del servidor OAuth de Supabase](https://supabase.com/docs/guides/auth/oauth-server/getting-started).
- [Autenticación de apps MCP en ChatGPT](https://developers.openai.com/plugins/build/auth).
