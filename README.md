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
- Tamaño de las vistas previas: `PNG_SCALE = null` es automático: **2x** (igual que el plugin) con
  `SOLO_PAGINA_ACTUAL = true` y **1x** al exportar el archivo completo, que a 2x pesa demasiado. Se puede fijar un
  número. Para evaluar detalles finos de un módulo, re-exportarlo con `SOLO_PAGINA_ACTUAL = true`.
- Si un árbol pasa `MAX_DEPTH`, el nodo queda con la marca `_truncado` (en el plugin y en la consola, y también en
  `design.compact.json`) en vez de cortarse sin aviso.

## Modo web para un agente (sin app de escritorio, Windows/Mac/Linux)

Para que un agente de IA con navegador (p. ej. Claude) pida los diseños por su cuenta, sin que nadie haga clic en Figma.
Funciona con cualquier **archivo de diseño** abierto en Figma web, con la sesión iniciada y permiso de edición sobre él
(una copia en Borradores, o un proyecto propio); el diseño solo se lee.

1. Arrancar el servidor: `node server.js`. Comprobar con `GET /estado`.
2. El agente inyecta el script desde el propio servidor, en la pestaña de Figma web:
   `(0, eval)(await (await fetch("http://127.0.0.1:3855/web.js")).text())` → queda `window.figmaBridge`.
3. Funciones (todas devuelven JSON):
   - `esperarFigma(ms)`: `figma` aparece unos segundos después de abrir el archivo; espera en vez de fallar.
   - `indice()`: páginas con id, nombre, `coleccion`, `estado` (🟢 `finalizado`, 🟡 `en_proceso`) y `separador`.
   - `mapa(pagina)`: vistas en **orden de lectura** (secciones numeradas primero, luego por posición; las sueltas al
     final) con sección, posición, tamaño y conexiones de prototipo. Es la base para reconstruir el flujo.
   - `exportar({ pagina, vistas, escala, desde, cuantas })`: cada vista viaja en su propia petición a `server.js` y
     queda en `exports/<coleccion>/<vista>/` como siempre. `vistas` es `"todas"` o una lista de ids/nombres; se exporta
     en tandas (`cuantas`, 6 por defecto) y la respuesta trae `siguiente` para continuar.
   - `configurar({ servidor, prefijoColeccion, maxDepth })`. `prefijoColeccion: "auto"` antepone el nombre del archivo
     a la colección (`<archivo>-modulo-tramites`) para que dos archivos con una página del mismo nombre no se pisen en
     `exports/`; sin prefijo (por defecto) la colección es solo la página.
   - `recursos({ pagina, vista })`: candidatos a **recurso suelto** dentro de una vista (logos, iconos, ilustraciones,
     fotos): el nodo más alto que es solo dibujo (sin texto) con vectores o imágenes. Devuelve `id`, `nombre` sugerido
     (único), tamaño, `formato` sugerido (`png` si tiene imagen de relleno, `svg` si es vectorial) y su `ruta` en el
     árbol. Es una sugerencia: una fila de logos en un mismo contenedor sale como un solo recurso.
   - `exportarRecursos({ pagina, nodos, coleccion, desde, cuantas })`: `nodos` es una lista de `{ id, nombre, formato,
     escala }` (sirven tal cual los de `recursos().candidatos`). El SVG se exporta como texto y el PNG a `escala` (2 por
     defecto). Quedan en `exports/<coleccion>/recursos/<nombre>.<ext>` con un `recursos/index.json` (nodo de Figma, tamaño,
     bytes). El servidor solo acepta `svg` y `png` y sanea el nombre.
   - `mapa()` devuelve `avisos` y `tiposPrimerNivel`: si una página no tiene vistas (o casi ninguna) explica qué hay en
     su primer nivel (grupos, secciones anidadas, conjuntos de componentes), que hoy no se detectan como vistas.
4. Escala: `escala: 1` para el mapa del flujo y `2` para las vistas que se van a maquetar (una vista a 2x pesa ~1,4 MB).
5. Seguridad: **solo lee**. Eso lo garantiza el código, no el nombre del archivo: `node build.js --check` falla si en los
   scripts aparece cualquier operación que modifique el documento (`figma.create*`, `remove()`, `setPluginData()`…). El
   script rechaza archivos que no son de diseño (FigJam, presentaciones). Sin permiso de edición, `figma` no aparece y
   `esperarFigma()` lo explica. El servidor solo escucha en `127.0.0.1`. `PORT=3856 node server.js` levanta una segunda instancia (p. ej. para pruebas).

El script se genera desde `src/web.js` (ver "Desarrollo").

Skill para agentes con este flujo (servidor, navegador, mapa, exportación y evaluación): [`.claude/skills/figma-vista/SKILL.md`](.claude/skills/figma-vista/SKILL.md). Es genérica; las reglas de un proyecto concreto van en su propia skill encima de esta.

## Desarrollo (editar el plugin o la consola)

`plugin/code.js`, `consola/export-consola.js` y `web/figma-bridge-web.js` son **archivos generados**: la lectura del diseño vive una sola vez en
`src/compartido/serializar.js` y se incluye en las plantillas `src/plugin.js`, `src/consola.js` y `src/web.js`. Se suben al repo
generados porque ni el plugin ni la consola pueden leer otros archivos.

- Cambiar cómo se lee el diseño: editar `src/compartido/serializar.js`, luego `node build.js`.
- Cambiar solo el plugin (colecciones, ventana) o solo la consola (opciones, descargas): editar su plantilla en `src/`,
  luego `node build.js`.
- `node build.js --check` no escribe nada y sale con código 1 si algún archivo generado no coincide con `src/` (úsalo
  antes de subir un cambio, o en CI). Nunca editar a mano los archivos generados.

## Resultado

```
exports/
  <coleccion>/                  # un módulo
    index.json                  # vistas de la colección (alcance completo del módulo)
    <vista>/
      design.json               # completo (referencia, pesado)
      design.compact.json       # liviano, para que lo lea el modelo
      preview.png               # imagen del frame a 2x, fondo blanco
    recursos/                   # solo con exportarRecursos (modo web)
      index.json                # metadatos de cada recurso
      <nombre>.svg | <nombre>.png
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
