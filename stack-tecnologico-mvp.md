# Stack Tecnológico Mínimo para Presentar a Clientes

Stack completo que cumple dos requisitos clave: **backend en la base de datos** y **UX bonita y fácil de editar**. Todo vive dentro del tier gratis.

---

## Frontend (Vercel)

- **Next.js 15** con App Router + TypeScript
- **Tailwind CSS** para estilos
- **shadcn/ui** para componentes — clave para el requisito de UX. No es una librería npm, son componentes que se copian a tu proyecto, así que los editas y extiendes libremente. Ya vienen accesibles, con dark mode, y hay bloques pre-hechos (dashboards, landings, forms).
- **Lucide** para iconos

---

## Backend en la DB (Supabase)

- **PostgreSQL** como base de datos
- **Row Level Security (RLS)** para reglas de negocio: defines en cada tabla quién puede leer/escribir qué. Esto reemplaza casi todo el backend tradicional.
- **Funciones de Postgres + triggers** para lógica más compleja (validaciones, cálculos derivados, side-effects).
- **Auth integrado** (email/password, Google, GitHub) sin escribir endpoints.
- **Storage** para imágenes y archivos.
- **Realtime** si necesitas live updates.
- Las APIs REST/GraphQL se autogeneran del esquema — no escribes endpoints.

El flujo termina siendo: diseñas tablas en Supabase Studio → defines RLS → desde Next.js llamas `supabase.from('tabla').select()` y la policy decide qué devuelve. Cero servidor propio.

---

## Por qué resuelve "UX fácil de editar"

- **shadcn/ui** te da componentes editables localmente.
- **v0.dev** (de Vercel) genera componentes nuevos desde prompts en texto, ya compatibles con shadcn.
- Para agregar un elemento nuevo: lo describes en v0, pegas el código, ajustas. Iteración muy rápida para demos.

---

## Tips para presentar a clientes

- Conecta el repo a Vercel desde el día 1 — cada push te da una URL para mostrar.
- Usa **Preview Deployments** para mostrar variantes A/B al cliente sin tocar producción.
- Empieza con un bloque de shadcn (ej. un dashboard template) y modifícalo; tienes algo presentable en horas, no semanas.
- En Supabase, llena datos de seed para que la demo se sienta real.

---

## Tier gratis te alcanza

- **Vercel**: 100 GB bandwidth + deploys ilimitados.
- **Supabase**: 500 MB DB, 1 GB storage, 50k usuarios activos/mes.

Más que suficiente para demos y primeros clientes pagos.

---

## Resumen del stack

| Capa | Tecnología |
|------|------------|
| Hosting / CI-CD | Vercel |
| Framework web | Next.js 15 (App Router) + TypeScript |
| Estilos | Tailwind CSS |
| Componentes UI | shadcn/ui + Lucide |
| Generación de UI | v0.dev |
| Base de datos | Supabase (PostgreSQL) |
| Lógica de negocio | RLS + funciones/triggers de Postgres |
| Autenticación | Supabase Auth |
| Archivos | Supabase Storage |
| Tiempo real | Supabase Realtime |

---

## Próximo paso

Si la app necesita mobile nativo, el frontend cambia a **Expo + React Native** y el backend Supabase queda idéntico.
