# GitHub privado en Project OS (Dokploy)

Esta integración usa una App dedicada, separada de la que Dokploy utiliza para desplegar. No cambia proveedores ni permisos de otros servicios. El login del propietario de Project OS sigue siendo Supabase; instalar la App autoriza el acceso de servidor a GitHub, no el acceso de visitantes al gestor.

## Crear e instalar

1. En la cuenta `DuarCas-maker`, abrir [New GitHub App](https://github.com/settings/apps/new).
2. Nombre propuesto: `Project OS DuarCas` (GitHub exige un nombre único). Homepage URL: `https://projects-duarcas.brant--co.com`.
3. Desactivar **Webhook → Active**. Conservar vacías Callback URL y Setup URL; no seleccionar Request user authorization (OAuth) during installation. La sincronización es manual y el servidor utiliza autenticación de instalación.
4. Repository permissions: **Contents → Read-only**, **Metadata → Read-only** (obligatorio). No conceder otros permisos, especialmente escritura. Sin permisos de organización/cuenta ni eventos.
5. Where can this GitHub App be installed?: **Only on this account** para los repositorios de esta cuenta. Si en el futuro se conectan organizaciones distintas, permitir instalaciones en Any account y añadir sus logins a la lista autorizada del servidor; la App debe instalarse en cada propietario de repositorios.
6. Crear la App. Guardar el **App ID** (no el Client ID) y el slug de su URL `https://github.com/apps/<slug>`.
7. **Generate a private key** descarga un `.pem`. Mantenerlo privado; no pegarlo en chats, Git ni archivos de compilación.
8. **Install App → DuarCas-maker → Only select repositories**. Seleccionar `CLUB-LYN-FINAL` y los demás repositorios que se quiera autorizar. Instalar.

## Configurar en el servicio Project OS

App creada el 11 de octubre de 2026: **Project OS DuarCas**, App ID **5270960**, slug **project-os-duarcas**. Instalación **170174628** en `DuarCas-maker`, autorizada únicamente para `CLUB-LYN-FINAL`. La clave real se mantiene fuera de este documento y de Git.

Para importar un PEM descargado a un archivo privado ignorado (no imprime el secreto):

```powershell
node scripts/configure-github-app.mjs --key-file 'C:/ruta/privada/app.private-key.pem' --id 5270960 --slug project-os-duarcas --accounts DuarCas-maker --apply
node scripts/check-github-connection.mjs
```

El importador crea `.env.github-app.local` y rechaza sobrescribirlo. La comprobación carga ese archivo únicamente para su proceso. El servidor local sigue usando `.env.local`; Dokploy necesita los valores en su Environment runtime. No se cargan automáticamente secretos de esa copia local en producción.

Solo en **Environment → runtime** de Project OS en Dokploy:

```dotenv
GITHUB_APP_ID=<App ID numérico>
GITHUB_APP_SLUG=<slug real de la App>
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n<contenido real del PEM>\n-----END RSA PRIVATE KEY-----"
GITHUB_ALLOWED_ACCOUNTS=DuarCas-maker
```

El valor de PRIVATE_KEY debe incluir el PEM completo. Se admite el PEM multilinea o sus saltos codificados como `\n`; no se admite una ruta de archivo como valor. No enviar el secreto en Build Time Arguments. No cambiar el identificador de espacio ni las variables existentes.

Desplegar la versión que contiene esta integración. No requiere nuevas tablas ni migraciones. El backend comprueba el ID, el slug, la cuenta, la suspensión y los permisos de la instalación. `GITHUB_ALLOWED_ACCOUNTS` es una lista explícita separada por comas, no un comodín; las instalaciones de otras cuentas no se muestran ni dan acceso privado.

## Vincular al proyecto

1. Entrar en el gestor como propietario y abrir **Proyecto → Contexto**.
2. Pulsar **Actualizar conexión**: debe aparecer GitHub conectado y los repositorios autorizados.
3. Elegir `DuarCas-maker/CLUB-LYN-FINAL`; dejar Rama vacía para su predeterminada o escribir otra.
4. Pulsar **Vincular repositorio**, después **Sincronizar** y **Ver contexto guardado**. La copia debe mostrar un commit y la cobertura parcial.
5. Para añadir/quitar autorización, usar **Autorizar repositorios**. GitHub abre otra pestaña para conservar el proyecto actual; al volver, pulsar Actualizar conexión.

Los contenidos y commits solo se leen con GET. El único POST a GitHub crea un token de instalación, limitado a Contents/Metadata de lectura y, para cada vinculación/sincronización, al repositorio solicitado. Los tokens viven únicamente durante la solicitud y se generan nuevamente sin intervención del usuario; no se guardan ni se devuelven al navegador. Cada sincronización vuelve a verificar acceso. Retirar un repositorio o suspender/desinstalar la App impide nuevas lecturas privadas. Las copias ya guardadas permanecen en el contexto privado del proyecto.

Se mantienen los límites actuales: 10 repositorios por proyecto, hasta 10 archivos por sincronización, 8 KiB por archivo y 24 KiB de texto. No se ejecuta código, no se leen conversaciones de Codex, y se excluyen archivos de credenciales. El seguimiento y la IA usan las versiones guardadas del proyecto.

## Comprobar antes de desplegar

```powershell
npm run test:github
npm run test:github:app
node node_modules/typescript/bin/tsc --noEmit
$env:PROJECT_OS_NODE_DIST_DIR = '.next-node-qa'
npm run build:docker
npm run test:auth:http
```

Las pruebas emplean claves RSA efímeras, respuestas simuladas y espacios ficticios. No usan repositorios privados reales ni realizan llamadas de pago.

Referencias: [registro](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app), [autenticación de instalación](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation).
