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
3. Registra un cliente OAuth para ChatGPT con la dirección de retorno **exacta que muestre ChatGPT** al configurar la conexión. Los callbacks pueden variar por conexión y configuración: no deduzcas la URI de un ejemplo. Guarda su ID y, si se utiliza un cliente confidencial, su secreto en la configuración OAuth de ChatGPT. Ese secreto no va al frontend ni al repositorio.
4. Asocia ese ID al recurso MCP desde SQL Editor, sustituyendo ambos valores:

   ```sql
   insert into private.mcp_oauth_clients(client_id, resource)
   values ('ID_DEL_CLIENTE_OAUTH', 'https://recipe-book-neon-two.vercel.app/mcp')
   on conflict (client_id) do update set resource = excluded.resource;
   ```

5. En **Authentication > Hooks**, habilita el hook de acceso `public.laurel_mcp_access_token_hook`. Si ya existe otro hook, integra esta función en el existente y conserva sus reglas. El hook solo modifica los tokens de los clientes registrados: añade la audiencia del MCP, conserva `authenticated` para la API de datos e identifica el cliente y el scope `openid`. Las sesiones normales de Laurel conservan sus claims.
6. Para Google, añade a **Authentication > URL Configuration > Redirect URLs** la vuelta a la pantalla de consentimiento con su identificador: `https://recipe-book-neon-two.vercel.app/oauth/consent?authorization_id=*`. Conserva el retorno `/login` existente. El callback configurado en Google sigue siendo el de Supabase; no es el callback OAuth de ChatGPT.
7. Configura las variables de servidor de Vercel y despliega:

   | Variable | Valor |
   | --- | --- |
   | `SUPABASE_URL` | URL del proyecto actual. |
   | `SUPABASE_PUBLISHABLE_KEY` | Clave pública `sb_publishable_...`, o usa `SUPABASE_ANON_KEY` para la clave anon anterior. |
   | `PUBLIC_SITE_URL` | Dirección pública de Laurel, sin `/` final. |
   | `MCP_RESOURCE_URL` | Dirección pública exacta del MCP, por ejemplo `https://recipe-book-neon-two.vercel.app/mcp`. |
   | `MCP_OAUTH_CLIENT_IDS` | ID registrado en el paso 4; admite varios separados por comas. |

   El recurso debe coincidir exactamente en la variable, la tabla privada y la URL configurada en ChatGPT. El servidor rechaza claves secretas, tokens sin esa audiencia, clientes no autorizados, sesiones caducadas y usuarios sin permisos. Sin variables de configuración devuelve 503; sin clientes autorizados solo funcionan las herramientas públicas.

8. En ChatGPT web, configura una app/conexión MCP con la URL `/mcp` y OAuth, usando el modo de desarrollo cuando esté disponible en tu cuenta. Completa el acceso en Laurel y revisa el nombre del cliente, la cuenta y el destino antes de permitir la conexión. Si cambian las herramientas, actualiza su definición en ChatGPT.

La disponibilidad de conexiones MCP, herramientas de escritura y modo de desarrollo depende del producto, el plan y las políticas del espacio. El despliegue y esta guía no habilitan esas opciones en la cuenta de ChatGPT.

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
