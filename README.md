# Project OS

Aplicación personal de gestión de proyectos, tareas, calendario, bandeja de entrada y documentos. Implementada con React, Vinext y un Worker de Sites.

## Acceso sin login

La aplicación no usa autenticación de ChatGPT ni de Supabase. Todas las visitas comparten el espacio indicado por `PROJECT_OS_WORKSPACE_ID`, una variable exclusivamente del servidor. El identificador no se obtiene de cookies, encabezados de identidad ni parámetros del visitante.

La publicación de Sites debe tener acceso **público**. Cualquiera con el enlace puede consultar y editar los datos del espacio compartido. Esto es deliberado; no es un modo privado ni un sistema multiusuario. Las claves de Supabase siguen exclusivamente en el servidor, y las tablas mantienen RLS para impedir el acceso directo con las claves de cliente.

## Vista local en Windows

Requiere Node.js >=22.13.0 y las dependencias instaladas.

Para iniciar el servidor en segundo plano y conservarlo abierto mientras revisas:

```powershell
.\scripts\start-local-preview.ps1
```

Abre http://127.0.0.1:3001/. El servidor escucha únicamente en este equipo. El iniciador comprueba que el puerto esté disponible y espera a que la aplicación responda. Los registros se guardan en la carpeta ignorada `outputs/`.

También puedes ejecutarlo en una terminal que debes mantener abierta:

```sh
node scripts/run-framework.mjs preview --port 3001
```

La vista local no pide login y utiliza el espacio de desarrollo `local_seedy` en D1 y R2 locales. Sus cambios **no** se sincronizan con Supabase ni con el enlace público. El middleware de desarrollo rechaza conexiones no locales y solicitudes de origen cruzado.

## Producción con Supabase

La publicación actual conserva el espacio existente de Supabase. Variables de ejecución en Sites:

- `PROJECT_OS_BACKEND=supabase`
- `PROJECT_OS_WORKSPACE_ID`: identificador del espacio existente, no un identificador nuevo.
- `SUPABASE_URL`: origen HTTPS del servidor.
- `SUPABASE_SECRET_KEY`: secreto solo del servidor, nunca del navegador ni del repositorio.

Las variables de producción son independientes del archivo local `.env`. No cambies el identificador del espacio para evitar abrir un conjunto de datos diferente.

La migración `supabase/migrations/20261005_0001_project_os.sql` crea las tablas, RLS, la función de creación atómica de tareas y el bucket privado `project-documents` con límite de 25 MB. Ya fue aplicada a la instancia actual; no debe repetirse para este cambio de acceso.

D1/R2 conserva la fuente original de la migración. Al activar Supabase, el servidor copia el espacio una vez y escribe un marcador de finalización al terminar. Las importaciones interrumpidas pueden reanudarse. Después, los cambios se guardan en Supabase y no se replican a D1/R2; los errores se muestran en vez de escribir silenciosamente en otro backend.

## Desarrollo y publicación

- `node node_modules/typescript/bin/tsc --noEmit`: comprobar TypeScript.
- `node --experimental-vm-modules scripts/check-supabase.mjs`: pruebas del adaptador de Supabase.
- `node --experimental-vm-modules scripts/check-workspace-context.mjs`: comprobar selección del espacio sin login.
- `node scripts/run-framework.mjs build`: construir el Worker y los archivos estáticos.
- `npm run db:generate`: generar migraciones D1 solo después de cambiar el esquema.

El perfil de ejecución se encuentra en el archivo ignorado `.sites-runtime/execution-profile.json`. En este equipo se utiliza el perfil portable. No es necesario Bash ni reinstalar dependencias para este cambio.

Para publicar, reutiliza el proyecto identificado en `.openai/hosting.json`, guarda y sube el código exacto, construye desde ese estado y despliega una versión guardada siguiendo el flujo de Sites. No incluyas `.env`, secretos, bases locales, registros, `node_modules` ni `.sites-runtime` en el artefacto.
