# Projects-duarcas · Project OS

Gestor personal de proyectos, tareas, reuniones, contexto y memoria. Mantiene el alojamiento actual en Sites y añade una versión Node/Next standalone para Docker.

## Fusionar tareas y organizar subtareas

En **Tareas → Seleccionar tareas**, marca entre 2 y 20 tareas del mismo proyecto y pulsa **Fusionar**. OpenAI prepara automáticamente una propuesta editable: una tarea consolidada o una principal con subtareas. Revisa los títulos, descripciones, criterios, responsables, fechas y estados; marca la confirmación y pulsa **Aprobar y fusionar**. Analizar, editar o cancelar no modifica las tareas. La consulta utiliza la clave, el modelo y la cuota compartida existentes. Para fusionar trabajo que ya tiene subtareas, despliega sus principales y selecciona las subtareas; solo se admite un nivel.

Las principales se muestran con sus subtareas plegadas en Lista, Kanban y Gantt. **Añadir subtarea** abre el formulario con la principal elegida; **Editar tarea → Tarea principal** permite organizar una tarea existente. Cada subtarea conserva seguimiento propio. Al terminar todas las subtareas activas se completa la principal; reabrir una subtarea reabre la principal. Las subtareas canceladas quedan fuera del trabajo necesario; si se cancelan todas, se cancela la principal. El avance, las recomendaciones y la planificación cuentan únicamente el trabajo de las subtareas y las tareas independientes. Gantt resume las fechas de las subtareas en la principal. Copiar una principal incluye sus subtareas con la relación indicada.

La fusión conserva los originales en el historial y permite verlos desde **Fuentes y tareas originales**. Los comentarios, entregables y versiones de archivos permanecen accesibles desde la tarea resultante. Las dependencias y los bloques de calendario se vinculan al resultado; los ciclos y los cambios concurrentes bloquean la aplicación y requieren una nueva revisión. No se borran originales ni se hace una limpieza masiva automática.

Los análisis de reuniones y documentos comparan acción, resultado, contexto, responsables y fechas con tareas y propuestas pendientes; incluyen el trabajo detectado en fragmentos anteriores. **Aprobaciones → Revisar coincidencias** permite actualizar una tarea existente, crear una subtarea, mantener una tarea separada o consolidar dos propuestas pendientes antes de aprobar. La similitud de palabras solo señala candidatos para revisión; no decide una fusión. El bloc puede proponer una principal nueva y subtareas asociadas: aprueba primero la principal. Los duplicados sin información nueva se omiten en la generación; las diferencias de contexto se conservan para revisión.

`npm run test:task-organization` y `npm run test:task-merge:http` verifican jerarquía, fusiones, conservación de fuentes, decisiones sobre coincidencias, transacciones, aprobación, reintentos y cuotas con datos ficticios y sin consultas externas. `node scripts/preview-task-organization.mjs` abre la aplicación en localhost:3110 con datos sintéticos y una respuesta de fusión simulada; no utiliza credenciales ni tareas reales. No requiere nuevas migraciones ni credenciales.

## Copiar tareas para WhatsApp

En cada proyecto, abre **Tareas → Seleccionar tareas**, marca las que quieras o pulsa **Seleccionar todas** y después **Copiar**. Funciona en Lista, Kanban y Gantt. En el celular, la barra de selección permanece visible al desplazarse y tiene controles táctiles amplios. Seleccionar todas incluye las tareas del filtro de persona actual; cambiar de persona o proyecto limpia la selección.

El texto contiene el nombre del proyecto y tareas numeradas separadas por líneas en blanco, con descripción, estado, responsable, colaboradores, fechas y bloqueos registrados. Conserva el orden de la lista. Pégalo en WhatsApp y envíalo. Si el navegador impide copiar automáticamente, se abre el texto para seleccionarlo y copiarlo manualmente. `npm run test:task-copy` verifica formato, aislamiento entre proyectos y alternativas del portapapeles.

## Bloc de notas

El menú **Bloc de notas** contiene una caja de texto y un historial de envíos. Escribe encabezados con el nombre o código exacto de cada proyecto, por ejemplo `Alfa:` y `Beta:`, y debajo sus pendientes. **Enviar** guarda primero el texto original en el espacio existente, vacía el editor y solicita una primera ronda de preguntas. Si falla la IA, la nota se recupera desde el historial. Las notas del bloc se separan de la captura antigua de Inbox.

Cada pregunta admite varias opciones A/B/C y una respuesta D abierta. Siempre hay una primera ronda; la IA sigue preguntando si faltan detalles. Usa las respuestas, tareas, responsables, hitos, decisiones, memoria disponible y hasta seis documentos recientes de los proyectos identificados. Se muestra la cobertura y se indican los fragmentos o fuentes que no se pudieron leer. Los encabezados desconocidos requieren aclaración. El texto admite 12 000 caracteres; cada análisis puede preparar hasta 16 propuestas y cada nota admite hasta 20 rondas.

Las propuestas pueden crear o actualizar tareas e hitos, modificar fechas, estados, bloqueos, resumen y próximos pasos del proyecto, o registrar decisiones. **Enviar propuestas a Aprobaciones** conserva el origen y no aplica los cambios. Allí puedes editar, aprobar o rechazar cada propuesta y ver sus campos. Si un registro cambió después del análisis, debe revisarse y guardarse antes de aprobar. Las tareas nuevas conservan criterios de finalización en su descripción. Los cambios financieros quedan fuera de este módulo. Los siguientes envíos conservan las aprobaciones anteriores; no se reescribe la nota original.

**Dictar** permite grabar hasta cinco minutos, transcribir con `gpt-4o-mini-transcribe` y revisar el texto antes de enviarlo. Necesita HTTPS o localhost, permiso de micrófono y un navegador con MediaRecorder/Web Audio. La misma clave de OpenAI se usa únicamente en el servidor. Se valida la duración a partir de WAV PCM mono de 16 kHz; no se confía en una duración enviada por el cliente. El audio no se sube al almacenamiento del proyecto: se conserva temporalmente en la pantalla para reintentar o descartarlo, y el proveedor recibe el audio al transcribir.

El límite mensual de dictado se configura desde el bloc (USD 0–50; 0 desactiva nuevos dictados). El valor inicial es USD 1 o `PROJECT_OS_NOTEBOOK_VOICE_MONTHLY_USD`, si está definido. El presupuesto es **estimado** usando USD 0,003/min, no un límite exacto de la factura de OpenAI. Una reserva SQL atómica evita superar ese presupuesto con solicitudes simultáneas; los intentos fallidos conservan su reserva por si el proveedor los procesó. El mes se determina en Bogotá. Los análisis usan la cuota diaria de IA existente; dictados y ajustes de presupuesto no consumen esa cuota de texto.

Los originales y las aprobaciones usan las tablas operativas existentes; preguntas, respuestas, configuración y reservas de voz usan `ai_runs` en el volumen auxiliar del alojamiento. No se necesitan migraciones ni nuevas credenciales. El respaldo auxiliar existente incluye ese historial. `npm run test:notebook` verifica el flujo con almacenamiento y respuestas sintéticas, sin llamadas externas. Para revisar la interfaz con esos datos: `node --experimental-vm-modules scripts/preview-notebook-fixture.mjs` (localhost:3102).

## Recursos del proyecto

En Contexto → Recursos del proyecto, las pestañas **Reuniones** y **Otros archivos** separan las transcripciones/notas de los documentos de contexto. Otros archivos incluye los documentos y notas ya guardados y permite **Subir archivo de contexto** para briefs, requisitos, planes y documentación. Admite TXT/Markdown hasta 256 KiB y PDF con texto/Word .docx hasta 10 MiB; conserva y permite descargar el original. La fecha de referencia del documento es opcional: sin ella no se usa la fecha de subida para interpretar plazos relativos.

Después de guardar, pulsa **Analizar y proponer tareas**. Se lee el contenido completo por fragmentos (hasta 100 páginas por PDF y 512 KiB de texto), se guarda el avance y se generan resúmenes y propuestas con citas del documento. Envía los hallazgos a Aprobaciones y aprueba las tareas que quieras crear; subir o analizar no crea tareas directamente. Comparte la configuración, cuota y correcciones de IA con las reuniones. Las propuestas conservan el documento de origen y no se vinculan como si fueran una reunión. No requiere migraciones ni nuevas credenciales.

Prueba aislada del recorrido de carga, descarga, análisis de varios fragmentos, correcciones y aprobación: `npm run test:context`. Usa almacenamiento y documentos ficticios, sin llamadas externas.

## Paleta institucional

Los colores base están centralizados en `app/globals.css`: negro `#000000`, blanco `#FFFFFF`, vino tinto `#722F37` y morado `#2A0D3A`. Negro/blanco organizan navegación y lectura; vino tinto identifica acciones principales y alertas, y morado resalta navegación activa, foco y contexto. Grises y tintes suaves derivados completan bordes y fondos sin añadir otra identidad visual.

`app/project-os.css` aplica estos tokens al login, proyectos, reuniones, memoria, búsqueda, calendario y formularios. Los identificadores históricos de los acentos de proyectos se conservan: cambia su apariencia, no los registros. La paleta no depende del modo claro/oscuro del sistema. El icono y el manifiesto PWA siguen los mismos colores.

`npm run test:palette` comprueba valores exactos, CSS y tokens válidos, compatibilidad de acentos y contraste mínimo 4.5:1 en las combinaciones de texto principales.

## Acceso privado con Supabase

Correo y contraseña se validan contra **el Supabase ya conectado a Project OS**. No se requiere una cuenta de ChatGPT. Solo el correo configurado en `PROJECT_OS_OWNER_EMAIL` puede acceder; opcionalmente `PROJECT_OS_OWNER_ID` fija su UUID de Supabase.

- No hay registro público ni creación automática de usuarios.
- El usuario debe existir en Supabase Auth, con correo confirmado y contraseña. En Studio: Authentication → Users → Add user → Create user; el propietario introduce la contraseña directamente allí, sin guardarla en el código.
- El servidor verifica cada solicitud protegida con Supabase Auth, no con un JWT decodificado ni datos enviados por el navegador.
- Sesiones con cookies HttpOnly, SameSite=Strict y Secure en HTTPS; renovación y cierre de sesión disponibles.
- Pantallas privadas, API y documentos no se almacenan en la caché offline.
- No se cambian las claves, la configuración global de Auth ni las políticas de otros proyectos. Conservar claves previamente expuestas sigue siendo un riesgo: añadir login no las vuelve seguras.

La identidad del usuario **autoriza el espacio configurado**; no reemplaza `PROJECT_OS_WORKSPACE_ID` por el UUID del usuario. Sites conserva su espacio existente. Para el VPS se ha elegido expresamente un espacio nuevo con solo los nombres de proyectos. Las tablas siguen con RLS, sin permisos directos para anon/authenticated; el acceso a los datos se realiza únicamente desde el servidor.

## Vista local en Windows

Requiere Node >=22.13 y dependencias instaladas. Copia las variables de `.env.example` a un archivo ignorado `.env.local` y configura URL, clave **pública** de Supabase, correo autorizado y `PROJECT_OS_APP_URL=http://127.0.0.1:3001`.

```powershell
.\scripts\start-local-preview.ps1
```

Abre http://127.0.0.1:3001/login. La vista local usa login real de Supabase, pero conserva los datos de desarrollo `local_seedy` en D1/R2 locales: no se sincronizan con producción. El iniciador comprueba la disponibilidad del puerto y no detiene otros procesos.

Para revisar la aplicación completa con los proyectos y originales de producción, usa `node scripts/start-production-preview.mjs` después de `node scripts/build-node.mjs`. Reutiliza las credenciales de servidor de `.env.local` y necesita un archivo privado `.env.production-preview.local` con `PROJECT_OS_WORKSPACE_ID` igual al alojamiento de producción, `PROJECT_OS_DATA_DIR=.node-runtime/production-preview` y `PORT=3002`. No cambia la configuración del preview de desarrollo. La vista abre **http://127.0.0.1:3002/**, verifica que el espacio ya exista y nunca importa datos ficticios. Los cambios en proyectos y archivos afectan al mismo Supabase de producción.

Los análisis de reuniones, cuotas e índice local viven en SQLite del alojamiento. Para incluirlos en la revisión local, descarga una copia autenticada desde **/deployment** en producción e impórtala con `scripts/import-auxiliary.mjs` en el directorio local nuevo, antes de consultar o generar análisis. Esta copia refleja la fecha de descarga; no comparte en vivo el volumen del servidor. Conserva el login real en localhost.

## Datos existentes y configuración de producción

Variables solo del servidor:

- `PROJECT_OS_BACKEND=supabase`
- `SUPABASE_URL`: el origen HTTPS de la instancia actual.
- `SUPABASE_PUBLISHABLE_KEY` (o `SUPABASE_ANON_KEY`): clave pública para Auth.
- `SUPABASE_SECRET_KEY`: clave de servicio existente, nunca en el navegador o el repositorio.
- `PROJECT_OS_OWNER_EMAIL`: el único correo permitido.
- `PROJECT_OS_OWNER_ID`: UUID opcional para reforzar la vinculación.
- `PROJECT_OS_APP_URL`: origen exacto del alojamiento. En el futuro VPS: `https://projects-duarcas.brant--co.com`. Para Sites debe ser su URL actual; no la del VPS.
- `PROJECT_OS_WORKSPACE_ID`: el espacio elegido para **ese alojamiento**. No cambiar el de Sites. En el VPS de inicio limpio, usar un identificador nuevo `clean_` seguido de 32 caracteres hexadecimales en minúscula.
- `PROJECT_OS_REQUIRE_EXISTING_WORKSPACE=true` para Docker: las solicitudes nunca importan datos de demostración. El inicio limpio se realiza una única vez antes de escuchar conexiones.

Las migraciones Supabase de `supabase/migrations/` ya forman parte de la aplicación actual. Este cambio de login no requiere repetirlas, borrar datos ni cambiar las políticas del servidor. Los originales permanecen en el bucket privado `project-documents`.

## Docker / Dokploy (preparado, despliegue separado)

La imagen ejecuta **Next/Node en producción**, no Vite ni Wrangler. Escucha en el puerto interno **3000**, con usuario no root y comprobación de salud. No utiliza la cuenta de ChatGPT ni el alojamiento de Sites.

1. Crea un archivo privado `.env.production` (o variables runtime en Dokploy), con las variables anteriores y las credenciales existentes de OpenAI/GBrain si vas a usar esas funciones. No envíes secretos como argumentos de compilación.
2. Usa el mismo Supabase. Para el inicio limpio elegido por el propietario, configura **un espacio nuevo**; no cambies el espacio de Sites ni de localhost. No crees otra instancia de Supabase.
3. Conserva un volumen persistente en `/data` (`PROJECT_OS_DATA_DIR`). Guarda el historial auxiliar de IA, análisis, puente de GBrain e índice de búsqueda en SQLite. Las migraciones D1 existentes se aplican al arrancar, fuera de las solicitudes, y comprueban su integridad.
4. El modo elegido para este despliegue es **solo nombres**, sin trasladar el historial de pruebas ni el del Site. Sigue la sección de inicio limpio. La transferencia de D1 descrita más abajo es únicamente la alternativa para quien elija conservar el historial; no se necesita para este inicio limpio.
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

La aplicación `Project OS` está en `Project / production`, separada de Supabase, GBrain y las variables compartidas. Su fuente es la integración **GitHub** de Dokploy con `DuarCas-maker/Projects-duarcas`, rama `main`, Build Path `/` y Trigger Type **On Push**. **Autodeploy está activado**: cada push a `main` solicita un despliegue de este servicio. Se reutiliza la GitHub App ya conectada; no se cambian permisos ni proveedores de otros servicios. Build Type **Dockerfile**, Docker File `Dockerfile`, Context `.`, Stage `runner`. No añadir un segundo disparador por webhook o GitHub Actions mientras esté activo este flujo.

En Advanced → Volumes: volumen nombrado **`project-os-data`** montado en **`/data`**, de uso exclusivo de esta aplicación, con permisos de escritura para UID/GID `1000:1000`. Una sola réplica, anclada al mismo VPS, y actualizaciones `stop-first`: SQLite local no debe compartirse entre réplicas ni coexistir con dos versiones activas. No añadir puertos del host; Traefik usa el puerto interno `3000`. No tocar la configuración global del clúster.

La plantilla sin secretos está en `deploy/dokploy.env.example`. Rellenar sus campos vacíos **solo en Environment del servicio nuevo**, no en Git ni Build Time Arguments. Usar las credenciales existentes de esta aplicación, no tokens owner/admin de GBrain. Sites oculta los secretos existentes y no permite recuperarlos con su herramienta de lectura: trasladarlos desde el lugar privado donde el propietario los conserva, sin publicarlos ni rotarlos.

Dominio previsto: `projects-duarcas.brant--co.com`, Path `/`, Internal Path `/`, Strip Path desactivado, puerto `3000`, HTTPS y Let's Encrypt. Antes de añadirlo, comprobar que **ese registro A específico** apunta a `72.60.168.172`. Si hay un AAAA para ese mismo nombre, debe apuntar al servidor correcto. No cambiar el DNS del dominio raíz, del correo, de GBrain ni de otras aplicaciones. En Sites conservar su `PROJECT_OS_APP_URL` actual; solo Dokploy usa el origen nuevo.

Referencias oficiales: [Dockerfile](https://docs.dokploy.com/docs/core/applications/build-type), [variables por servicio](https://docs.dokploy.com/docs/core/variables) y [dominios](https://docs.dokploy.com/docs/core/domains).

### Transferir el historial antes del primer arranque

**Alternativa, no el modo elegido para este VPS:** estos pasos solo aplican a `PROJECT_OS_INITIALIZATION_MODE=preserve-history` con el identificador existente de Sites. No mezclar una importación con un volumen de inicio limpio.

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

En modo `preserve-history`, la imagen Docker exige `PROJECT_OS_REQUIRE_AUXILIARY_IMPORT=true`: no inicia el servidor hasta que el volumen contenga el recibo de importación para este mismo espacio. No desactivar esta protección para eludir el traslado. Los límites actuales son 10.000 filas por tabla y 8 MiB de contenido auxiliar total (máximo 32 MiB del JSON). Si se exceden, la descarga falla expresamente y se debe preparar una transferencia por partes; **no entrega un respaldo truncado**.

### Inicio limpio: únicamente nombres (elegido para el VPS)

Configurar solo en Environment del servicio nuevo de Project OS:

```dotenv
PROJECT_OS_WORKSPACE_ID=clean_<32 caracteres hexadecimales nuevos>
PROJECT_OS_INITIALIZATION_MODE=names-only
PROJECT_OS_INITIAL_PROJECT_NAMES=["Nombre del proyecto 1","Nombre del proyecto 2"]
PROJECT_OS_REQUIRE_EXISTING_WORKSPACE=true
PROJECT_OS_REQUIRE_AUXILIARY_IMPORT=true
```

El primer arranque verifica que tanto el espacio nuevo de Supabase como el volumen estén vacíos. Inserta únicamente proyectos con esos nombres y nuevos IDs. No consulta ni copia los proyectos de otro espacio, no descarga archivos, no llama a OpenAI/GBrain y no crea tareas, notas, reuniones, pagos, repositorios ni historial. Los campos obligatorios reciben valores iniciales: estado **Por iniciar**, comercial **Sin definir**, tipo **Por alcance** y prioridad neutral **3/5**; los textos, fechas y resúmenes quedan vacíos. Todo puede editarse desde la aplicación.

Una marca persistente `preparing → ready` permite reintentar un primer arranque interrumpido, sin sobrescribir datos ni duplicar proyectos. En posteriores arranques nunca se vuelven a insertar los nombres ni se modifica lo que el propietario haya completado. Si el espacio ya existe pero falta la marca local, se rechaza un volumen vacío nuevo: hay que recuperar el volumen original, no reiniciar el historial silenciosamente. Se rechazan espacios antiguos, destinos con contenido, volúmenes importados, datos de otro espacio y cambios en la lista inicial después de inicializarla.

No hace falta subir ni importar el respaldo descargado para este modo. Conservar los archivos locales y el Site anterior sin modificarlos. No apagar las comprobaciones del modo de transferencia: `names-only` tiene su propio control de inicialización y no es una omisión de la protección anterior.

Verificar con `npm run test:names-only` y, tras `npm run build:docker`, `npm run test:names-only:http`. Las pruebas usan Supabase ficticio y SQLite aislado; no crean datos reales ni consumen IA. La prueba HTTP ejecuta el iniciador real y comprueba un primer arranque, reinicio sin duplicados, protección de rutas y rechazo de un volumen perdido. La creación real ocurre solo al desplegar con las variables privadas correctas.

### Comprobaciones y cambio de alojamiento

Tras autorización de despliegue, confirmar variables, volumen exclusivo y DNS antes de pulsar Deploy. Verificar certificado HTTPS, salud del contenedor y ausencia de errores de permisos. Probar sin sesión: `/` y `/deployment` redirigen a `/login`; las API y documentos no devuelven contenido privado. En el inicio limpio, con el propietario verificar login/logout, la lista de nombres y ausencia de tareas, documentos e historial antiguos; completar un proyecto desde su formulario. Solo en modo de transferencia se verifican documentos/análisis previos. Evitar llamadas de IA de pago durante estas comprobaciones.

Reiniciar solo la aplicación nueva y confirmar que el historial sigue disponible. Respaldar el volumen completo con la aplicación detenida, incluyendo SQLite y WAL/SHM; no copiar solo el `.sqlite` mientras está escribiendo. Mantener el alojamiento anterior sin uso hasta validar el nuevo. No eliminarlo ni alternar escrituras entre ambos; si el VPS ya recibió actividad, cualquier vuelta atrás requiere conservar/reconciliar primero su historia auxiliar.

Pruebas adicionales: `npm run test:transfer` y `npm run test:auth:http` (esta última requiere `npm run build:docker`). Usan datos ficticios, validan importación/exportación y protección HTTP, y no hacen llamadas reales de IA.

## Desarrollo y publicación

### GitHub privado · solo lectura

El gestor admite una GitHub App dedicada para listar y vincular repositorios privados autorizados a cada proyecto. La configuración y los pasos de instalación en la cuenta `DuarCas-maker` y el servicio Project OS de Dokploy están en [deploy/github-app.md](deploy/github-app.md). Requiere `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY` y `GITHUB_ALLOWED_ACCOUNTS`, exclusivamente en el servidor. No reutiliza la App de despliegue de Dokploy y no requiere migraciones.

**Contexto → Actualizar conexión → seleccionar repositorio → Vincular → Sincronizar**. Los tokens de lectura se limitan al repositorio solicitado y la autorización se comprueba en cada sincronización. Se mantienen la lectura pública, las copias por commit, la exclusión de credenciales y la separación por proyecto. Pruebas sin servicios reales: `npm run test:github` y `npm run test:github:app`.

### Seguimiento unificado (fase 5)

En **Proyectos → proyecto → Resumen → Seguimiento unificado**, la lectura combina el estado operativo, tareas elegibles y prioridades, análisis de la reunión seleccionada, decisiones/resúmenes locales, memoria recuperada de GBrain y las versiones activas de los repositorios de **ese proyecto**. No incluye conversaciones de Codex ni cambios locales sin subir.

1. Vincular los repositorios desde **Contexto** y usar **Sincronizar** después de un push. La sincronización no consume OpenAI. Guarda el SHA, código permitido y, si hay una versión anterior diferente, una comparación acotada de archivos cambiados entre ambas versiones. No lee ni guarda los parches de esa comparación. La primera copia no tiene comparación; si GitHub la rechaza se informa sin inventar cambios. Las ramas que retroceden o divergen no se consideran avance lineal.
2. Analizar la reunión y revisar sus propuestas en Aprobaciones. Hallazgos sin aprobar, commits y requisitos del código no son tareas completadas ni cambios operativos.
3. En **Resumen**, revisar versiones/cobertura y pulsar **Generar actualización**. Se usa una consulta de la cuota compartida. La lectura muestra estado, actividad técnica separada, cambios confirmados, asuntos pendientes, riesgos/discrepancias y una siguiente acción con evidencia. GitHub usa la copia guardada, no una consulta en vivo.
4. Revisar y editar antes de **Confirmar y guardar**. Solo cambian el resumen y la siguiente acción; fechas, pagos, tareas y estados no se modifican automáticamente. Cambios en repositorios, fuentes, tareas, reunión o memoria invalidan la lectura anterior y bloquean aplicarla.

La lectura no promete 100% de cobertura: reparte hasta 12.000 caracteres de extractos entre los repositorios (hasta 6.000 por repositorio), conserva límites del contexto total, informa originales no disponibles/repositorios sin sincronizar y excluye memoria de versiones de GitHub reemplazadas. Consultar/ver la lectura guardada no genera otra consulta. No requiere nuevas tablas, secretos ni permisos de GitHub.

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

### Pagos y colaboración por proyecto

En **Pagos**, crea acuerdos separados de ingresos del cliente y gastos de personas/proveedores. Cada acuerdo tiene moneda, valor, modalidad y cuotas con nombres y porcentajes que deben sumar exactamente 100%. Puedes asociar vencimiento, hito, ambos o ninguno. **Registrar abono** acepta pagos parciales; **Completar cuota** prepara el saldo completo para registrarlo. Los movimientos conservan fecha y referencia. Las revisiones exigen motivo, conservan los pagos y no permiten eliminar cuotas con movimientos ni reducirlas por debajo de lo ya recibido/pagado. Los saldos anteriores se incorporan mediante **Configurar cuotas del saldo anterior**, conservando dinero e historial.

Las modalidades son total fijo, total contratado repartido en mensualidades y valor recurrente por período. Las mensualidades calculan los vencimientos vacíos desde el inicio; un recurrente permite **Emitir siguiente período** con la frecuencia elegida. La emisión es manual. Revisar un recurrente modifica los períodos futuros; los emitidos conservan sus importes. El presupuesto general se compara con los gastos acordados en la misma moneda; las monedas se muestran separadas.

En **Tareas → Personas del proyecto**, añade personas y marca tu ficha con **Soy yo**. Cada tarea acepta un responsable principal y colaboradores. Las subpestañas Todas, Mis tareas, personas y Sin asignar usan las mismas tareas en Lista, Kanban y Gantt. Kanban admite columnas propias y arrastre; sus estados respetan las dependencias e hitos existentes. Gantt mueve/ajusta únicamente inicio y fin planificados, también con las flechas del teclado. No cambia fecha límite, entrega tentativa, reunión ni otras tareas. Hoy y Calendario parten de Mis tareas, incluyendo las tareas antiguas sin asignar, y permiten filtrar personas.

La IA puede proponer nombres respaldados por evidencia de reuniones o documentos; aparecen para **Revisar y añadir**. La creación de fichas y la asignación siguen requiriendo tu confirmación. Se reutiliza la configuración existente de OpenAI; las pruebas no realizan llamadas de pago.

**Enlace** genera una vista personal de un proyecto, sin registro, para ver sus tareas, cambiar estados, comentar y subir documentos/imágenes de hasta 10 MB. Solo expone tareas asignadas como responsable o colaborador y sus recursos vigentes; excluye pagos, otros proyectos, correos y originales históricos. Quien tenga el enlace puede usarlo. Se muestra una vez, puede reemplazarse o desactivarse y deja de dar acceso cuando cambia la asignación. El servidor guarda únicamente su hash. Las acciones se atribuyen al enlace. **Actualizar datos** en la cabecera recarga los cambios de colaboradores; la vista compartida también tiene **Actualizar**.

Antes de desplegar esta versión o arrancar una vista previa conectada a Supabase real, aplicar **supabase/migrations/20261011_0006_project_operations.sql** desde el administrador autorizado. Es una transacción aditiva: crea las tablas privadas de operaciones/enlaces y amplía el RPC existente, sin reescribir proyectos ni pagos anteriores. A continuación compilar y desplegar el servidor. En SQLite/D1 se añade **drizzle/0005_acoustic_wallow.sql**; Node aplica las migraciones al iniciar. No se han aplicado estas migraciones a producción como parte de las pruebas locales.

Validación sin servicios reales: `npm run test:operations`, `npm run test:sharing:http` (requiere `npm run build:docker`), y las comprobaciones existentes de núcleo, planificación, reuniones, seguimiento, autenticación y paleta. Si Windows mantiene bloqueada `.next-node/standalone`, la carpeta alternativa permite compilar y comprobar sin detener procesos ajenos:

```powershell
$env:PROJECT_OS_NODE_DIST_DIR = '.next-node-qa'
node scripts/build-node.mjs
node scripts/check-project-sharing-http.mjs
node scripts/check-auth-http.mjs
```

`scripts/start-node.mjs` y `scripts/start-production-preview.mjs` admiten esa misma variable. La vista previa real sigue requiriendo aplicar primero la migración de Supabase. El entorno ficticio y sus archivos se eliminan al terminar las pruebas.

### Archivos y enlaces de tareas

En **Tareas → Archivos**, se pueden subir varios archivos o agregar enlaces HTTPS. El primer envío usa **Enviar a contexto**; después, **Actualizar archivo / enlace** guarda una nueva versión y actualiza Contexto automáticamente. Los recursos se agrupan por tarea y conservan el historial descargable. Las búsquedas y la IA usan la versión vigente; las anteriores permanecen en el historial.

Se guardan originales de hasta 25 MB. La lectura admite PDF con texto, Word .docx, Excel .xlsx, PowerPoint .pptx, texto UTF-8 e imágenes PNG/JPG/WebP/GIF. Los documentos Office/PDF y las imágenes tienen un límite de lectura de 10 MB; el texto de 256 KiB. Los formatos Office antiguos se pueden guardar y necesitan conversión para leerlos. Los PDF escaneados necesitan OCR previo. Las imágenes se describen/transcriben con OpenAI al enviarlas y consumen una consulta compartida; volver a consultar la lectura guardada no genera otra.

Los enlaces se leen cuando son públicos y accesibles, con una copia del texto por versión. Un recurso que necesita sesión, permisos o supera los límites queda guardado con una opción para reintentar; no se presenta su versión anterior como contenido vigente. El índice local permite búsqueda e IA sin exigir GBrain. No se necesitan tablas ni secretos nuevos.

Prueba del flujo con datos ficticios y sin llamadas externas: `node --experimental-vm-modules scripts/check-task-resources.mjs`.

- **Nuevo proyecto / Editar proyecto:** objetivo, tipo, estados, prioridades, fecha, resumen y siguiente acción. Archivar es reversible desde el mismo formulario; no elimina datos.
- **Tareas:** edición de descripción, estado, duración, fecha, hito y dependencias del mismo proyecto. Se rechazan ciclos. Una tarea dependiente se desbloquea al completar sus requisitos.
- **Hitos:** entregables ordenados con fecha y estado. No se puede completar un hito o proyecto con tareas pendientes.
- **Pagos:** valor y moneda del proyecto, condiciones y registro de dinero recibido. Son importes enteros; no se transfieren fondos. El saldo no puede ser negativo ni cambiar de moneda después de recibir un pago.
- **Historial:** cada operación se guarda atómicamente con su evento. Reintentar la misma operación no duplica el registro ni el pago. Los formularios solo se cierran después de confirmar el guardado y conservan los campos ante un error.

La vista Hoy calcula sus prioridades, bloqueos y fechas con los datos guardados y la zona horaria de Bogotá. No se presentan números ficticios de progreso.

Hoy abre con los proyectos activos y por iniciar y el filtro Mis tareas (conserva las tareas aún sin asignar). Sus KPI cuentan todas las fechas: total = pendientes + completadas, excluyendo canceladas. Cada tarjeta despliega el reparto por proyecto y filtra la agenda; la selección de proyecto y responsable se mantiene en las siguientes acciones, agenda, bloqueadores y calendario del día. La agenda ordena por fecha límite confirmada y agrupa al final las tareas sin fecha; una entrega tentativa nunca genera atraso.

El resumen de proyectos muestra el avance de todo el equipo: completadas / tareas no canceladas, con segmentos separados de completadas y canceladas sobre el total de registros. La barra de tiempo usa inicio real, o el planificado si aún no existe, y la fecha objetivo de finalización; se limita a 0–100 % y deja «Sin definir» cuando faltan fechas. Ambos inicios se editan desde «Fechas» y se guardan en `project_operations.data.schedule` junto con el proyecto y su evento, con control de conflictos. No requiere nuevas columnas ni una migración adicional. La línea de tiempo compara proyectos sobre una escala común e identifica los que aún no tienen fechas. En móvil la tabla se transforma en tarjetas y conserva las acciones de iniciar, completar y editar.

`node scripts/check-today-dashboard.mjs` verifica los totales, filtros, fechas de Bogotá, atrasos, cancelaciones, progreso y persistencia de los inicios con datos sintéticos. Después de una compilación en `.next-node-qa`, `node scripts/preview-today-fixture.mjs` abre una prueba aislada en `http://127.0.0.1:3101/`, sin leer variables privadas ni consultar servicios externos.

## Daily OS e IA

- Inbox: captura real, coincidencias por nombre claramente indicadas como reglas y propuestas manuales. Analizar con IA separa hechos, inferencias y sugerencias.
- Aprobaciones: editar conserva el estado pendiente; aprobar crea la tarea con su origen y evidencia; rechazar no crea tareas. Operaciones atómicas con historial.
- Calendario interno: disponibilidad editable, pausas, planificación por prioridad/vencimiento/dependencias, revisión previa, edición, aprobación y cancelación recuperable. Se conservan los compromisos aprobados y se rechazan solapamientos. Google Calendar todavía no está conectado.
- Chat global y por proyecto: API real del servidor, sin respuestas simuladas. El contexto por proyecto excluye otros proyectos. Se incluyen registros acotados, no archivos completos, credenciales ni acceso de ejecución. GBrain y ejecución de Codex siguen pendientes.

Variables exclusivamente del servidor: `OPENAI_API_KEY`, `OPENAI_MODEL` (inicialmente `gpt-4.1-mini`), `PROJECT_OS_AI_DAILY_LIMIT` (40 compartidas por día de Bogotá) y `PROJECT_OS_AI_CONTEXT_ENABLED=true` después de autorizar enviar el contexto a OpenAI. Sin esta última autorización, la conexión queda preparada pero las consultas se rechazan sin enviar datos. Localhost carga el archivo ignorado `.env.local`; producción recibe secretos mediante Sites.

La API usa [Responses con salida estructurada](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses), `store:false`, límites de contexto/salida, 3 consultas por minuto y reservas duraderas atómicas. El límite cuenta intentos incluso fallidos, no es un límite monetario de la cuenta OpenAI. El historial, consumo y respuestas de IA se guardan en D1 del sitio; los proyectos y propuestas de producción permanecen en Supabase. El acceso público también comparte el historial y la cuota. Las sugerencias solo llegan a aprobaciones mediante una acción explícita y no pueden ejecutar SQL ni herramientas.

La migración aditiva `20261006_0004_daily_os.sql` fue aplicada a Supabase. La migración D1 `0001_empty_blade.sql` incorpora el historial/cuota de IA. Para comprobar reglas y separación de contexto: `node --experimental-vm-modules scripts/check-daily.mjs`. Las pruebas SQL usan una transacción revertida y no dejan proyectos temporales.
