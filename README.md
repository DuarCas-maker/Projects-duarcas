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
