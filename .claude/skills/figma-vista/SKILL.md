---
name: figma-vista
description: Lee diseños de Figma (cualquier archivo de diseño) usando figma-bridge en modo web - Figma web en el navegador integrado más un servidor local - sin app de escritorio, sin MCP de Figma y sin pedirle clics al usuario. Lista las páginas, arma el flujo de una página, exporta sus vistas (JSON compacto + PNG) a figma-bridge/exports/<coleccion>/ y las evalúa. Úsalo cuando el usuario pase un enlace de Figma o pida "trae este diseño", "exporta esta vista", "revisa el flujo de este Figma" o "evalúa este diseño antes de maquetar". English - read any Figma design file through the figma-bridge web mode (Figma web in the built-in browser plus a local server), export views and evaluate them.
---

# figma-vista (figma-bridge en modo web, genérica)

Permite pedir diseños por prompt: *"trae esta pantalla: <enlace>"*. Yo recorro Figma web, saco el flujo, exporto las vistas necesarias y las evalúo, sin que el usuario exporte nada a mano. Funciona igual en Windows, Mac y Linux (Node + navegador). **Solo lee** el archivo de Figma: nunca modifica diseño ni crea nada en él (`node build.js --check` de figma-bridge falla si el script gana alguna operación de escritura). Escribir en Figma sería otra herramienta aparte.

Detalle técnico y API del script: `README.md` de figma-bridge, sección "Modo web para un agente". Esta skill es genérica: no asume proyecto, sistema de diseño ni nombres de página. Las reglas de un proyecto concreto viven en la skill de ese proyecto y se aplican encima de esta.

## Requisitos

- La herramienta es este repo (`figma-bridge`, donde está `server.js`); si la skill se usa desde otro proyecto, la carpeta de figma-bridge es la que el usuario indique (pregúntala si no se sabe). Los exports quedan en `figma-bridge/exports/<coleccion>/` (carpeta ignorada por git: pueden ser confidenciales).
- Un **archivo de diseño** de Figma (no FigJam ni presentaciones) donde el usuario tenga permiso de edición: una copia en sus Borradores o un proyecto propio. En archivos de solo vista `figma` no aparece. Si solo hay enlace a un archivo ajeno, pídele que lo duplique ("Duplicate to your drafts").
- Navegador integrado con la sesión de Figma del usuario (queda guardada en su perfil: no pidas ni toques credenciales; si falta sesión, que inicie sesión en el panel).

## Procedimiento

1. **Servidor.** `curl http://127.0.0.1:3855/estado`. Si no responde, arrancarlo desde el repo de figma-bridge con `node server.js` en segundo plano. Si el puerto está ocupado por un proceso que no es el servidor de figma-bridge, no lo cierres: usa otro puerto con `PORT` y `configurar({ servidor })`, y avisa al usuario. Anota qué proceso arrancaste tú.
2. **Abrir el archivo** con `preview_start` y la URL (no hace falta `?node-id`). Antes de pedirle algo al usuario en el panel, `tabs_context` (si el panel está oculto: `Ctrl+Shift+B`). No abras URLs que creen archivos (`/board/new`, `/design/new`): crean archivos en la cuenta del usuario.
3. **Esperar a `figma`.** No existe al cargar: aparece unos segundos después (entre 4 y 12 s en las pruebas) y no hace falta correr ningún plugin. Con `javascript_tool`: inyectar `(0, eval)(await (await fetch("http://127.0.0.1:3855/web.js")).text())`, luego `window.figmaBridge.configurar({ prefijoColeccion: "auto" })` y `await window.figmaBridge.esperarFigma(30000)`. Si `listo` es falso tras 30 s, el `motivo` lista las causas probables: sin permiso de edición (solo vista), archivo sin cargar o falta de sesión; como último recurso, pedirle al usuario que corra un plugin de Community una vez. Si el archivo no es de diseño, el script lo rechaza.
   - `prefijoColeccion: "auto"` antepone el nombre del archivo a cada colección (`<archivo>-<pagina>`): así dos archivos con una página del mismo nombre no se pisan en `exports/`. Es el valor por defecto de esta skill; una skill de proyecto puede usar otro.
4. **Índice.** `window.figmaBridge.indice()`: páginas con `estado` (🟢 finalizado, 🟡 en_proceso, `sin_estado`) y `separador` (ignora los separadores). Resuelve la frase del usuario a una página; si hay varias candidatas, pregunta.
5. **Mapa del flujo.** `await window.figmaBridge.mapa("<pagina>")`: vistas en orden de lectura con sección, posición y conexiones de prototipo. Revisa `avisos`: si una página no devuelve vistas (o casi ninguna), `tiposPrimerNivel` explica por qué (grupos, secciones anidadas, conjuntos de componentes, elementos sueltos) y se lo cuentas al usuario en vez de seguir. El flujo sale de, en este orden: conexiones de prototipo (si las hay), secciones numeradas, posición izquierda→derecha / arriba→abajo y nombres de las vistas (los estados repetidos de una pantalla comparten nombre base).
6. **Exportar.** Primero todas las vistas a `escala: 1` en tandas (`exportar({ pagina, escala: 1, desde, cuantas })`, hasta que `siguiente` sea `null`; ~3 s por vista). Las vistas que se van a **maquetar** se re-exportan a `escala: 2` con `vistas: [ids]`. Una llamada de `javascript_tool` no debe pasar de ~30 s: usa tandas de 6 o menos. Una vista muy alta (p. ej. 1440x8356) se exporta bien en una sola llamada (~4 s a 1x).
   - **Recursos sueltos** (logos, íconos, ilustraciones, fotos) de una vista que se va a maquetar: `await window.figmaBridge.recursos({ pagina, vista })` lista los candidatos (id, nombre, tamaño, formato sugerido: `svg` si es vectorial, `png` si tiene imagen de relleno). Revísalos contra `preview.png`: una fila de logos en un mismo contenedor sale como un solo recurso, y los nombres genéricos ("frame-9", "recurso") conviene renombrarlos. Luego `exportarRecursos({ pagina, nodos: [{ id, nombre, formato, escala }], cuantas })` (tandas de ~8) los guarda en `exports/<coleccion>/recursos/` con su `index.json`.
7. **Evaluar** (neutral; una skill de proyecto añade sus reglas). Leer `exports/<coleccion>/index.json` y, por vista, `design.compact.json` + `preview.png` (`design.json` solo si algo no cuadra). Entregar:
   - mapa del flujo (pantallas y estados) y secciones de cada pantalla;
   - componentes y patrones repetidos;
   - colores (hex), tipografías, tamaños y espaciados que se usan;
   - **imágenes e ilustraciones**: `exportar` solo trae el PNG de la vista completa y el árbol; los recursos sueltos salen con `recursos` + `exportarRecursos` (paso 6). Dilo si algún gráfico no se detectó como recurso (p. ej. dentro de un grupo con texto) y propón exportarlo por su id;
   - vistas o estados sin definir y dudas;
   - un plan por pantalla.
8. **Parar para confirmar** antes de programar. Pregunta dónde va el código (proyecto, ruta) y con qué sistema de diseño, y no inventes tokens ni componentes: si algo no está en el diseño, dilo.
9. **Cierre.** Cierra la pestaña del navegador y detén el servidor **solo si lo arrancaste tú y con una forma que el entorno permita** (si no puedes, dile al usuario qué proceso queda abierto). No cierres la sesión de Figma del usuario.

## Si algo falla

- `figma` no aparece: ver paso 3. `exportar` devuelve `fallidas`: reintenta esas vistas por separado y, si persiste, revisa la consola del servidor.
- "no es un archivo de diseño": el archivo abierto es de otro tipo (FigJam, presentaciones); pide el enlace del archivo de diseño.
- Página muy grande: baja `cuantas` o `maxDepth` (`configurar`); un árbol cortado queda con `_truncado` en `design.compact.json`.
- Sin navegador o sin sesión de Figma: alternativa manual con el plugin de escritorio o el script de consola (README de figma-bridge).
- Pruebas: para no tocar el servidor real, `PORT=3856 timeout 900 node server.js` desde una carpeta con copias de `server.js`, `compact.js` y `web/figma-bridge-web.js`, y `configurar({ servidor: "http://127.0.0.1:3856" })`.

## Límites que conviene recordar

- Las vistas son los frames de primer nivel de la página y los frames dentro de secciones de primer nivel. Grupos, secciones anidadas y conjuntos de componentes no se detectan como vistas.
- La copia no se actualiza sola: si el diseño original cambió, el usuario debe volver a duplicarlo y yo re-exportar.
- Las descargas del navegador requieren permiso del usuario cada vez; este modo no descarga nada (envía directo al servidor local).
