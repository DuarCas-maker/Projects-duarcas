# Projects-duarcas · Project OS

Gestor personal de proyectos, tareas, reuniones, contexto y memoria. Mantiene el alojamiento actual en Sites y añade una versión Node/Next standalone para Docker.

## Acceso privado con Supabase

Correo y contraseña se validan contra **el Supabase ya conectado a Project OS**. No se requiere una cuenta de ChatGPT. Solo el correo configurado en `PROJECT_OS_OWNER_EMAIL` puede acceder; opcionalmente `PROJECT_OS_OWNER_ID` fija su UUID de Supabase.

- No hay registro público ni creación automática de usuarios.
- El usuario debe existir en Supabase Auth, con correo confirmado y contraseña. En Studio: Authentication → Users → Add user → Create user; el propietario introduce la contraseña directamente allí, sin guardarla en el código.
- El servidor verifica cada solicitud protegida con Supabase Auth, no con un JWT decodificado ni datos enviados por el navegador.
- Sesiones con cookies HttpOnly, SameSite=Strict y Secure en HTTPS; renovación y cierre de sesión disponibles.
- Pantallas privadas, API y documentos no se almacenan en la caché offline.
- No se cambian las claves, la configuración global de Auth ni las políticas de otros proyectos. Conservar claves previamente expuestas sigue siendo un riesgo: añadir login no las vuelve seguras.

La identidad del usuario **autoriza el espacio existente**; no reemplaza `PROJECT_OS_WORKSPACE_ID` por el UUID del nuevo usuario. Así se mantienen los proyectos y las rutas de documentos actuales. Las tablas siguen con RLS, sin permisos directos para anon/authenticated; el acceso a los datos se realiza únicamente desde el servidor.

## Vista local en Windows

Requiere Node >=22.13 y dependencias instaladas. Copia las variables de `.env.example` a un archivo ignorado `.env.local` y configura URL, clave **pública** de Supabase, correo autorizado y `PROJECT_OS_APP_URL=http://127.0.0.1:3001`.

```powershell
.\scripts\start-local-preview.ps1
```

Abre http://127.0.0.1:3001/login. La vista local usa login real de Supabase, pero conserva los datos de desarrollo `local_seedy` en D1/R2 locales: no se sincronizan con producción. El iniciador comprueba la disponibilidad del puerto y no detiene otros procesos.

## Datos existentes y configuración de producción

Variables solo del servidor:

- `PROJECT_OS_BACKEND=supabase`
- `SUPABASE_URL`: el origen HTTPS de la instancia actual.
- `SUPABASE_PUBLISHABLE_KEY` (o `SUPABASE_ANON_KEY`): clave pública para Auth.
- `SUPABASE_SECRET_KEY`: clave de servicio existente, nunca en el navegador o el repositorio.
- `PROJECT_OS_OWNER_EMAIL`: el único correo permitido.
- `PROJECT_OS_OWNER_ID`: UUID opcional para reforzar la vinculación.
- `PROJECT_OS_APP_URL`: origen exacto del alojamiento. En el futuro VPS: `https://projects-duarcas.brant--co.com`. Para Sites debe ser su URL actual; no la del VPS.
- `PROJECT_OS_WORKSPACE_ID`: **el identificador existente**, no uno nuevo.
- `PROJECT_OS_REQUIRE_EXISTING_WORKSPACE=true` para Docker: si falta el espacio ya migrado, se muestra un error en vez de importar datos de demostración.

Las migraciones Supabase de `supabase/migrations/` ya forman parte de la aplicación actual. Este cambio de login no requiere repetirlas, borrar datos ni cambiar las políticas del servidor. Los originales permanecen en el bucket privado `project-documents`.

## Docker / Dokploy (preparado, despliegue separado)

La imagen ejecuta **Next/Node en producción**, no Vite ni Wrangler. Escucha en el puerto interno **3000**, con usuario no root y comprobación de salud. No utiliza la cuenta de ChatGPT ni el alojamiento de Sites.

1. Crea un archivo privado `.env.production` (o variables runtime en Dokploy), con las variables anteriores y las credenciales existentes de OpenAI/GBrain si vas a usar esas funciones. No envíes secretos como argumentos de compilación.
2. Usa el mismo Supabase y el mismo identificador del espacio. No inicialices otra base ni crees un espacio vacío.
3. Conserva un volumen persistente en `/data` (`PROJECT_OS_DATA_DIR`). Guarda el historial auxiliar de IA, análisis, puente de GBrain e índice de búsqueda en SQLite. Las migraciones D1 existentes se aplican al arrancar, fuera de las solicitudes, y comprueban su integridad.
4. **Antes del cambio definitivo desde Sites**, exporta y migra su D1 auxiliar: no se copia automáticamente a Docker. Aunque proyectos y documentos siguen en Supabase, perder ese historial auxiliar puede afectar los análisis previos y el seguimiento de la memoria. Respáldalo junto con Supabase y el volumen.
5. En Dokploy usa este repositorio, rama `main`, Dockerfile en la raíz y puerto del contenedor 3000. Adjunta el volumen y las variables antes del primer arranque.
6. Solo cuando se autorice el despliegue, configura DNS/HTTPS del dominio y comprueba ingreso, cierre de sesión, datos, descargas y bloqueo anónimo. No cambies servicios de otros proyectos.

Para una prueba Docker local:

```sh
docker compose build
docker compose up -d
```

El compose expone solo `127.0.0.1:3001`; Dokploy debe enrutar su dominio al puerto interno 3000. No combines este puerto con la vista de desarrollo si ya está ocupado. El contenedor reinicia sin perder el volumen. Si restauras archivos de otro despliegue, conserva las migraciones originales y realiza un respaldo antes.

**Verificación:** la compilación standalone y las pruebas de Node se pueden ejecutar sin Docker. La construcción/ejecución real de la imagen requiere un Docker Engine disponible; una compilación Node exitosa no sustituye esa prueba.

### Preparación específica de Dokploy

Crear **una aplicación nueva** `Project OS` dentro de `Project / production`, sin editar el servicio Supabase, GBrain o variables compartidas. Fuente Git pública: `https://github.com/DuarCas-maker/Projects-duarcas.git`, rama `main`, Build Path `/`. Build Type **Dockerfile**, Docker File `Dockerfile`, Context `.`, Stage `runner`. Mantener **Autodeploy desactivado** hasta completar el cambio de alojamiento.

En Advanced → Volumes: volumen nombrado **`project-os-data`** montado en **`/data`**, de uso exclusivo de esta aplicación, con permisos de escritura para UID/GID `1000:1000`. Una sola réplica, anclada al mismo VPS, y actualizaciones `stop-first`: SQLite local no debe compartirse entre réplicas ni coexistir con dos versiones activas. No añadir puertos del host; Traefik usa el puerto interno `3000`. No tocar la configuración global del clúster.

La plantilla sin secretos está en `deploy/dokploy.env.example`. Rellenar sus campos vacíos **solo en Environment del servicio nuevo**, no en Git ni Build Time Arguments. Usar las credenciales existentes de esta aplicación, no tokens owner/admin de GBrain. Sites oculta los secretos existentes y no permite recuperarlos con su herramienta de lectura: trasladarlos desde el lugar privado donde el propietario los conserva, sin publicarlos ni rotarlos.

Dominio previsto: `projects-duarcas.brant--co.com`, Path `/`, Internal Path `/`, Strip Path desactivado, puerto `3000`, HTTPS y Let's Encrypt. Antes de añadirlo, comprobar que **ese registro A específico** apunta a `72.60.168.172`. Si hay un AAAA para ese mismo nombre, debe apuntar al servidor correcto. No cambiar el DNS del dominio raíz, del correo, de GBrain ni de otras aplicaciones. En Sites conservar su `PROJECT_OS_APP_URL` actual; solo Dokploy usa el origen nuevo.

Referencias oficiales: [Dockerfile](https://docs.dokploy.com/docs/core/applications/build-type), [variables por servicio](https://docs.dokploy.com/docs/core/variables) y [dominios](https://docs.dokploy.com/docs/core/domains).

### Transferir el historial antes del primer arranque

1. Con el login del propietario, abrir `/deployment` en el sitio actual y descargar el historial. El endpoint `POST /api/deployment/backup` verifica sesión y origen. Exporta solo `ai_runs`, `project_brain_sources`, `brain_requests` y `knowledge_search` del espacio configurado, en una transacción consistente. No ejecuta IA, no modifica datos ni exporta las tablas operativas.
2. Conservar por separado un respaldo vigente de Supabase (base y originales) y de GBrain. La copia auxiliar **no es un respaldo completo** ni contiene archivos R2 antiguos de otros espacios. Los originales actuales siguen en Supabase. Confirmar descarga, tamaño y checksum mediante el importador, no a través de un chat o vista que pueda truncar textos.
3. Para el cambio definitivo, esperar a que terminen los análisis y suspender las ediciones manualmente en el sitio anterior; descargar **una copia final nueva**. No activar ambos alojamientos a la vez: comparten Supabase, pero sus historias y cuotas auxiliares serían distintas. Las reservas pendientes se conservan y se informan en el resumen; no se ejecutan ni reanudan automáticamente durante la importación.
4. Subir la copia por un canal privado al VPS, fuera del repositorio y de rutas públicas. Construir la imagen en un checkout dedicado, sin alterar carpetas de otros servicios: `docker build --target runner -t project-os:prepare .`. Todavía no iniciar la aplicación. Usar el mismo volumen nombrado que está configurado en Dokploy.
5. Ejecutar el importador primero sin `--apply`. Valida versión, columnas exactas, checksum SHA-256, espacio, Supabase, tipos, límites y destino vacío. El checksum detecta corrupción, **no autentica al remitente**: usar únicamente la copia obtenida del sitio propio por HTTPS. La prueba no escribe el historial. Después de revisar los recuentos, repetir con `--apply`; la inserción es atómica. Una repetición idéntica no duplica registros, pero se rechaza otra copia o un destino que ya tenga actividad. No borrar ni sobrescribir un volumen para forzar una importación.

Ejemplo en el VPS, **tras confirmar** la ubicación privada `/opt/project-os-transfer/project-os-history.json`, la imagen y el volumen específicos:

```sh
docker run --rm --network none \
  --mount type=volume,source=project-os-data,target=/data \
  --mount type=bind,source=/opt/project-os-transfer,target=/transfer,readonly \
  --env PROJECT_OS_DATA_DIR=/data \
  --env PROJECT_OS_WORKSPACE_ID=BacSiECnJK0jd3eP2gEDSd9XlM32FGQThAZiEpczNdpVn17Wt9TUg3 \
  --env SUPABASE_URL=https://projects-duarcas.northbridge-finance.com \
  --entrypoint node project-os:prepare \
  scripts/import-auxiliary.mjs /transfer/project-os-history.json
```

Añadir `--apply` **al final** para la importación efectiva. No requiere credenciales de OpenAI, GBrain ni servicio de Supabase; el contenedor de importación no tiene red. En un host Node >=22.13 también puede ejecutarse `node scripts/import-auxiliary.mjs /ruta/privada/copia.json [--apply]` con esas tres variables de destino.

La imagen Docker exige `PROJECT_OS_REQUIRE_AUXILIARY_IMPORT=true`: no inicia el servidor hasta que el volumen contenga el recibo de importación para este mismo espacio. No desactivar esta protección para eludir el traslado. Los límites actuales son 10.000 filas por tabla y 8 MiB de contenido auxiliar total (máximo 32 MiB del JSON). Si se exceden, la descarga falla expresamente y se debe preparar una transferencia por partes; **no entrega un respaldo truncado**.

### Comprobaciones y cambio de alojamiento

Tras autorización de despliegue, confirmar variables, volumen importado y DNS antes de pulsar Deploy. Verificar certificado HTTPS, salud del contenedor y ausencia de errores de permisos. Probar sin sesión: `/` y `/deployment` redirigen a `/login`; las API y documentos no devuelven contenido privado. Con el propietario: login/logout, proyectos/tareas existentes, descarga de una transcripción, análisis anteriores, vínculos de GBrain y búsqueda en contenido. Evitar llamadas de IA de pago durante estas comprobaciones.

Reiniciar solo la aplicación nueva y confirmar que el historial sigue disponible. Respaldar el volumen completo con la aplicación detenida, incluyendo SQLite y WAL/SHM; no copiar solo el `.sqlite` mientras está escribiendo. Mantener el alojamiento anterior sin uso hasta validar el nuevo. No eliminarlo ni alternar escrituras entre ambos; si el VPS ya recibió actividad, cualquier vuelta atrás requiere conservar/reconciliar primero su historia auxiliar.

Pruebas adicionales: `npm run test:transfer` y `npm run test:auth:http` (esta última requiere `npm run build:docker`). Usan datos ficticios, validan importación/exportación y protección HTTP, y no hacen llamadas reales de IA.

## Desarrollo y publicación

- `node node_modules/typescript/bin/tsc --noEmit`: tipos.
- `npm run test:auth`: autorización, propietario, cookies, renovación, cierre y rechazo de origen cruzado, con datos ficticios.
- `npm run test:node`: persistencia, migraciones, transacciones y originales privados.
- `node --experimental-vm-modules scripts/check-core.mjs` y `scripts/check-daily.mjs`: núcleo y planificación.
- `node --experimental-vm-modules scripts/check-project-update.mjs`: estado posterior a reuniones y búsqueda en contenido.
- `npm run build:docker`: compilación standalone en `.next-node`, independiente de los archivos del preview.
- `npm run start:docker`: arranque Node con configuración de producción.
- `node scripts/run-framework.mjs build`: compilación Workers para el alojamiento existente en Sites.
- `npm run db:generate`: migraciones D1 nuevas, solo tras un cambio de esquema.

La publicación de Sites mantiene el mismo proyecto de `.openai/hosting.json`. Su audiencia de plataforma puede seguir pública, pero la aplicación exige la sesión de Supabase antes de devolver contenido privado. El repositorio público contiene código, no credenciales, bases, registros, archivos de reuniones ni originales. `.env*`, `.wrangler`, `.node-runtime`, `outputs` y archivos de ejecución están excluidos de Git/Docker.

## Núcleo de gestión

- **Nuevo proyecto / Editar proyecto:** objetivo, tipo, estados, prioridades, fecha, resumen y siguiente acción. Archivar es reversible desde el mismo formulario; no elimina datos.
- **Tareas:** edición de descripción, estado, duración, fecha, hito y dependencias del mismo proyecto. Se rechazan ciclos. Una tarea dependiente se desbloquea al completar sus requisitos.
- **Hitos:** entregables ordenados con fecha y estado. No se puede completar un hito o proyecto con tareas pendientes.
- **Pagos:** valor y moneda del proyecto, condiciones y registro de dinero recibido. Son importes enteros; no se transfieren fondos. El saldo no puede ser negativo ni cambiar de moneda después de recibir un pago.
- **Historial:** cada operación se guarda atómicamente con su evento. Reintentar la misma operación no duplica el registro ni el pago. Los formularios solo se cierran después de confirmar el guardado y conservan los campos ante un error.

La vista Hoy calcula sus prioridades, bloqueos y fechas con los datos guardados y la zona horaria de Bogotá. No se presentan números ficticios de progreso.

## Daily OS e IA

- Inbox: captura real, coincidencias por nombre claramente indicadas como reglas y propuestas manuales. Analizar con IA separa hechos, inferencias y sugerencias.
- Aprobaciones: editar conserva el estado pendiente; aprobar crea la tarea con su origen y evidencia; rechazar no crea tareas. Operaciones atómicas con historial.
- Calendario interno: disponibilidad editable, pausas, planificación por prioridad/vencimiento/dependencias, revisión previa, edición, aprobación y cancelación recuperable. Se conservan los compromisos aprobados y se rechazan solapamientos. Google Calendar todavía no está conectado.
- Chat global y por proyecto: API real del servidor, sin respuestas simuladas. El contexto por proyecto excluye otros proyectos. Se incluyen registros acotados, no archivos completos, credenciales ni acceso de ejecución. GBrain y ejecución de Codex siguen pendientes.

Variables exclusivamente del servidor: `OPENAI_API_KEY`, `OPENAI_MODEL` (inicialmente `gpt-4.1-mini`), `PROJECT_OS_AI_DAILY_LIMIT` (40 compartidas por día de Bogotá) y `PROJECT_OS_AI_CONTEXT_ENABLED=true` después de autorizar enviar el contexto a OpenAI. Sin esta última autorización, la conexión queda preparada pero las consultas se rechazan sin enviar datos. Localhost carga el archivo ignorado `.env.local`; producción recibe secretos mediante Sites.

La API usa [Responses con salida estructurada](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses), `store:false`, límites de contexto/salida, 3 consultas por minuto y reservas duraderas atómicas. El límite cuenta intentos incluso fallidos, no es un límite monetario de la cuenta OpenAI. El historial, consumo y respuestas de IA se guardan en D1 del sitio; los proyectos y propuestas de producción permanecen en Supabase. El acceso público también comparte el historial y la cuota. Las sugerencias solo llegan a aprobaciones mediante una acción explícita y no pueden ejecutar SQL ni herramientas.

La migración aditiva `20261006_0004_daily_os.sql` fue aplicada a Supabase. La migración D1 `0001_empty_blade.sql` incorpora el historial/cuota de IA. Para comprobar reglas y separación de contexto: `node --experimental-vm-modules scripts/check-daily.mjs`. Las pruebas SQL usan una transacción revertida y no dejan proyectos temporales.
