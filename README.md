# figma-bridge

Plugin de desarrollo de Figma + servidor local que exporta frames de diseño a JSON compacto y PNG, pensado para que un
agente de IA (o cualquier herramienta) lea un diseño sin necesitar un MCP de Figma. Todo corre en tu máquina, sin
dependencias (solo Node); el servidor solo escucha en `127.0.0.1` y nada sale de tu equipo.

## Requisitos

- Node instalado (sin `npm install`, no hay dependencias).
- Figma de escritorio y permiso de **edición** en el archivo (en archivos view-only el menú Plugins está bloqueado:
  trabajar sobre una copia, p. ej. en Borradores). Sin app de escritorio (Linux) ver
  [Sin app de escritorio](#sin-app-de-escritorio-linux-o-navegador).
- Puerto `3855` libre en `127.0.0.1`.
- `exports/` está en `.gitignore`: los diseños exportados pueden ser confidenciales y no se suben al repo.

## Instalación (solo la primera vez)

1. Clonar el repo y entrar a la carpeta:
   ```bash
   git clone <url-del-repo> figma-bridge
   cd figma-bridge
   ```
2. Comprobar que Node está instalado (`node --version`; se recomienda una versión LTS reciente).
3. Abrir **Figma de escritorio** (el navegador no permite importar plugins de desarrollo) y abrir un archivo donde
   tengas permiso de edición.
4. Importar el plugin: menú principal de Figma -> Plugins -> Desarrollo -> **Importar plugin desde manifiesto...**
   (en inglés: Plugins -> Development -> Import plugin from manifest...) y elegir el archivo `plugin/manifest.json`
   de la carpeta clonada.
5. Comprobar que quedó instalado: Plugins -> Desarrollo debe listar **"Exponer diseño (local)"**.

## Uso

1. Arrancar el servidor (dejar la terminal abierta; reiniciarlo si se cambia `server.js` o `compact.js`):
   `node server.js`
   Debe imprimir `Escuchando en http://localhost:3855 -> ...`.
2. En Figma, seleccionar uno o varios frames -> clic derecho -> Plugins -> Desarrollo -> "Exponer diseño (local)".
3. Aparece una ventana con el nombre de la **colección** (por defecto, la página de Figma sin emojis ni acentos:
   "🟡 Módulo checkout" -> `modulo-checkout`). Enter para exportar, o cambiar el nombre antes. Lo cambiado se
   recuerda por página.

## Sin app de escritorio (Linux o navegador)

Figma no tiene app de escritorio para Linux y el navegador no permite importar plugins de desarrollo (`figma-linux`
tampoco sirve: Figma lo bloquea por versión vieja de Chrome). Para esos casos, `consola/export-consola.js` corre la
misma lectura del plugin desde la consola de DevTools de Figma web y descarga un JSON por página; `consola/cargar.js`
los manda al mismo `server.js`. El resultado en `exports/` es el mismo que con el plugin.

Funciona con asiento View, sin llamadas a la API de Figma y sin límite de uso, siempre que el archivo deje copiar a
los visores.

1. Abrir el archivo en Figma web (Chrome) -> clic en el nombre del archivo -> **Duplicate to your drafts**. Trabajar
   solo en la copia ("<nombre> (Copy)"): ahí tienes edición.
2. En la copia, correr una vez cualquier plugin de Community que no modifique el diseño y cerrarlo. Eso habilita el
   objeto `figma` en la consola. Comprobar: F12 -> Consola -> `figma.root.name` debe responder el nombre de la copia.
3. Revisar las opciones al inicio de `consola/export-consola.js` (`SOLO_PAGINA_ACTUAL` para re-exportar solo la
   página abierta, `PNG_SCALE`, `MAX_DEPTH`, `EXIGIR_COPIA`). Pegar el script en la consola (si Chrome lo bloquea,
   escribir antes `allow pasting`) y Enter. Toma los frames de primer nivel de cada página y los que están dentro de
   secciones. Al terminar muestra `[export] listo` con las vistas por página.
4. Arrancar el servidor (`node server.js`) y cargar los JSON descargados:
   `node consola/cargar.js ~/Downloads/<pagina>.json ...`
5. Apagar el servidor al terminar.

Notas:

- Chrome pide permiso para descargar varios archivos a la vez: aceptar, o habilitar las descargas automáticas para
  `figma.com`. Si guarda un archivo con otro nombre da igual: la colección sale del contenido, no del nombre.
- `figma is not defined`: no se corrió ningún plugin en ese archivo todavía (paso 2).
- La copia conserva los `nodeId` del original: los enlaces `?node-id=` armados con el export abren la misma vista en
  el archivo original.
- La copia no se actualiza sola: si el diseño cambia, borrar la copia, duplicar otra vez y re-exportar.
- Diferencias con el plugin: PNG a 1x por defecto (el plugin usa 2x) y, si un árbol pasa `MAX_DEPTH`, el nodo queda
  con la marca `_truncado` en vez de cortarse sin aviso.

## Resultado

```
exports/
  <coleccion>/                  # un módulo
    index.json                  # vistas de la colección (alcance completo del módulo)
    <vista>/
      design.json               # completo (referencia, pesado)
      design.compact.json       # liviano, para que lo lea el modelo
      preview.png               # imagen del frame a 2x, fondo blanco
```

- Re-exportar la misma vista (mismo id de Figma) reemplaza su carpeta; otra vista con el mismo nombre queda como `<vista>-2`.
- Si `design.compact.json` no alcanza o algo no cuadra, consultar `design.json`.
- Los colores van en hex a propósito (el plugin sirve para cualquier app): quien consuma los exports los compara con los tokens de su proyecto.

## Problemas frecuentes

- **No aparece el menú Desarrollo o el plugin:** estás en el navegador o en un archivo view-only. Usa la app de
  escritorio y una copia del archivo donde tengas edición.
- **La ventana del plugin da error al exportar:** el servidor no está corriendo. Arráncalo con `node server.js`.
- **`EADDRINUSE` al arrancar el servidor:** el puerto 3855 está ocupado por otro proceso. Ciérralo o cambia `PORT` en
  `server.js` y en la URL de `plugin/ui.html`, y el dominio permitido en `plugin/manifest.json` (`devAllowedDomains`).
- **No se ven los cambios al editar `server.js` o `compact.js`:** reinicia el servidor. El plugin se recarga solo.

## Regla para el agente (copiar al `AGENTS.md` / `CLAUDE.md` del proyecto que use los exports)

```md
## Figma (figma-bridge)
Al maquetar un módulo, leer SOLO `figma-bridge/exports/<coleccion>/`:
1. `index.json` (alcance completo del módulo).
2. Por vista: `design.compact.json` + `preview.png`. `design.json` solo si algo no cuadra.
No mezclar otras colecciones. Los colores vienen en hex: mapearlos a los tokens del proyecto.
Figma es guía visual; ante una diferencia con el backend, manda el backend.
```

## Licencia

[MIT](LICENSE)
