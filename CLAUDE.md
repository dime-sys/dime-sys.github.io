# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Qué es este proyecto

Landing page estática de **D.I.M.E.** (Data Intake Management Ecosystem), un SaaS B2B para digitalizar la entrega de datos manuales. Se publica en GitHub Pages en `https://dime-sys.github.io/` — **cada push a `main` publica directamente a producción**. No hay build, dependencias ni framework: solo `index.html`, `styles.css` y `script.js`.

Todo el copy está en español (locale `es_CL`). Los commits se escriben en español con prefijos convencionales (`feat:`, `chore:`, `fix:`). **Nunca añadir trailer de co-autoría de Claude en los commits.**

## Desarrollo

```bash
python3 -m http.server 8000   # servir en local; abrir http://localhost:8000
node --check script.js        # verificación de sintaxis del JS
```

No hay tests ni linter. Verificar cambios visuales en el navegador en ambos temas (toggle sol/luna en la nav) y con navegación por teclado.

## Arquitectura

### Sistema de temas (claro/oscuro)

- Todos los colores del CSS son **tokens semánticos** definidos en `:root` (tema oscuro, el default) con overrides en `:root[data-theme="light"]` al inicio de `styles.css`: superficies (`--dark`, `--card`, `--card2`, `--surface`, `--surface-2`), textos (`--text-strong/body/soft/muted/faint`), bordes y acentos (`--red/--amber/--green/--blue` + variantes `-l`). **Nunca introducir colores fijos fuera de los mockups** — usar tokens para que ambos temas funcionen.
- En tema claro los acentos usan versiones oscurecidas para cumplir contraste WCAG 4.5:1 sobre blanco; las variantes `-l` (texto sobre tintes) también se invierten a tonos oscuros.
- Un script inline en el `<head>` de `index.html` aplica `data-theme` (localStorage → preferencia del sistema) **antes del primer paint** para evitar destello; `script.js` gestiona el toggle, persiste la elección y sigue los cambios del sistema si el usuario no eligió manualmente.
- **Los mockups del producto (`.mock-browser`) se mantienen siempre oscuros**: al final de `styles.css` hay un bloque que re-ancla todos los tokens a sus valores oscuros dentro de ese scope. Son "capturas" de la app (que es oscura); no deben adaptarse al tema claro.

### Iconos

Sprite SVG inline al inicio del `<body>` (símbolos `i-*`, trazos estilo Lucide 24×24). Se usan con `<svg class="icon" aria-hidden="true"><use href="#i-nombre"/></svg>` y se colorean vía `currentColor`. **No usar emojis como iconos** en secciones de marketing (los emojis que quedan viven solo dentro de los mockups, que están `aria-hidden`).

### Identidad visual (no cambiar sin pedirlo)

Logo "D.I.M.E." multicolor en Fredoka One con los 4 colores semafóricos (rojo/ámbar/verde/azul) ligados semánticamente a los estados de datos del producto (cumplido/tardío/incumplido). Tipografía de cuerpo: Inter. Tema oscuro como identidad primaria.

### Convenciones de accesibilidad a preservar

- Estados `:focus-visible` globales, skip-link, landmark `<main id="contenido">`, jerarquía de headings h1→h2→h3 sin saltos.
- Carrusel con roles `tablist/tab/tabpanel`, flechas del teclado y autoplay que se pausa con hover/foco y se detiene al interactuar.
- Modal de demo con focus-trap, retorno de foco al disparador y errores de formulario inline (`aria-invalid` + mensajes junto al campo, foco al primer error) — nunca `alert()`.
- Contraste mínimo 4.5:1: para metadatos usar `--text-faint`, nunca grises más oscuros.
- Respetar `prefers-reduced-motion` (bloque al final del CSS + guards en `script.js`); transiciones con propiedades explícitas (nunca `transition: all`) y easing `var(--ease-out)`.

### Formulario de demo

Envía a Formspree (`https://formspree.io/f/mrewrlbn`) vía fetch con fallback de estado inline. El campo `_gotcha` es el honeypot anti-spam — no eliminarlo.
