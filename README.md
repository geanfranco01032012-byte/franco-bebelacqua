# Buzón de quejas inteligente · Gean Franco

Sitio estático para **Cloudflare Pages** con una Pages Function que guarda las quejas
en **D1** y las clasifica automáticamente con **Workers AI**
(`@cf/meta/llama-3.1-8b-instruct`) en prioridad **alta**, **media** o **baja**.

Sin build, sin npm, sin dependencias. Se sube a GitHub y Cloudflare hace el resto.

---

## Estructura

```

.
├── index.html              → formulario público (sin pedir nombre)
├── panel.html              → panel de quejas ordenadas por prioridad
├── functions/
│   └── api/
│       └── quejas.js       → GET (listar) y POST (crear + clasificar)
└── schema.sql              → tabla `quejas` para D1

```

Endpoints generados automáticamente por Pages Functions:

| Método | Ruta           | Qué hace                                                   |
|--------|----------------|------------------------------------------------------------|
| GET    | `/api/quejas`  | Devuelve las quejas en JSON, por prioridad y fecha         |
| POST   | `/api/quejas`  | Clasifica y guarda una queja. Body: `{ texto, categoria }` |

---

## Pasos de despliegue

### 1. Subir el proyecto a GitHub

```bash
git init
git add .
git commit -m "Buzón de quejas · Gean Franco"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/buzon-quejas.git
git push -u origin main
```

### 2. Crear la base de datos D1

1. Entrá al panel de Cloudflare → **Storage & Databases → D1 SQL Database**.
2. **Create database** → nombre: `buzon-quejas` → Create.
3. Abrí la base recién creada → pestaña **Console**.
4. Pegá **todo** el contenido de `schema.sql` y presioná **Execute**.
Deberías ver `quejas` en la lista de tablas.

> Si preferís la terminal (opcional, requiere Node):
> `npx wrangler d1 execute buzon-quejas --remote --file=./schema.sql`

### 3. Crear el proyecto en Cloudflare Pages

1. **Workers & Pages → Create → Pages → Connect to Git**.
2. Elegí el repositorio `buzon-quejas` y la rama `main`.
3. En la configuración de build:

- **Framework preset:** `None`
- **Build command:** *(dejar vacío)*
- **Build output directory:** `/`
4. **Save and Deploy**. La primera vez puede fallar porque faltan los bindings: es normal.

### 4. Configurar los bindings

En el proyecto de Pages → **Settings → Functions**:

| Tipo ↕▾ | Variable name ↕▾ | Valor ↕▾ |
|---|---|---|
| −D1 database | `DB` | `buzon-quejas` |
| Workers AI | `AI` | *(sin valor, solo el nombre)* |
⚙

Guardá y volvé a **Deployments → Retry deployment** (o hacé un push nuevo).

> El binding de Workers AI requiere que Workers AI esté habilitado en la cuenta
> (el plan gratuito incluye una cuota diaria de neuronas).

### 5. Probar

- `https://TU-PROYECTO.pages.dev/` → enviá una queja de prueba.
- `https://TU-PROYECTO.pages.dev/panel.html` → debería aparecer con su prioridad.
- `https://TU-PROYECTO.pages.dev/api/quejas` → JSON crudo.

---

## Cómo funciona la clasificación

1. Si existe `env.AI`, se le pide al modelo `@cf/meta/llama-3.1-8b-instruct`
que responda **solo** una palabra: `alta`, `media` o `baja` (timeout de 8 s).
2. La respuesta se normaliza (minúsculas, sin tildes) y se busca la palabra válida.
3. Si el binding no existe, la IA falla, se cuelga o responde algo raro,
se clasifica por **palabras clave**:

- **alta**: urgente, peligro, riesgo, robo, violencia, incendio, inundación,
fuga, gas, sin agua, plaga, caída, herido, ascensor atrapado…
- **media**: ruido, limpieza, basura, olor, filtraciones, goteras, humedad,
ascensor, demoras, mantenimiento, cerraduras, calefacción…
- **baja**: sugerencia, consulta, felicitación, mejora, cartel, jardín…
- Si no coincide nada, se usa **media** por defecto.
4. La queja se guarda con `creada` en ISO 8601 UTC.

La respuesta del POST incluye `clasificacion: "ia"` o `"palabras-clave"`,
así se puede auditar de dónde salió la prioridad.

---

## Seguridad y validación

- **Máximo 500 caracteres** por queja, validado en el navegador y en el servidor.
- Las categorías se validan contra una lista blanca; si no coincide, se guarda `Otro`.
- **Todo el HTML se escapa** al mostrarlo (`escaparHtml` en ambas páginas):
el contenido de la queja nunca se inyecta como HTML.
- No se piden ni se guardan datos personales: solo texto, categoría, prioridad y fecha.
- Las respuestas de la API van con `Cache-Control: no-store`.
- Si falta el binding `DB`, la API responde **HTTP 503** con un JSON explicativo
en lugar de romperse.

### Endpoint: ejemplos

```
# Crear una queja
curl -X POST https://TU-PROYECTO.pages.dev/api/
```

Respuesta del POST:

```
{
  "ok": true,
  "queja": {
    "id": 1,
    "texto": "Hay una pérdida de gas en el pasillo",
    "categoria": "Seguridad",
    "prioridad": "alta",
    "creada": "2026-11-10T15:04
```

Error típico sin binding D1:

```
{
  "ok": false,
  "error": "Falta el binding D1 (env.DB). Configuralo en Cloudflare Pages → Settings → Functions → D1 database bindings con el nombre de variable DB."
}
```

---

## Notas

- El panel trae hasta **500 quejas**. Para más volumen, agregá paginación en el `GET`.
- No hay autenticación en el panel: si necesitás restringirlo, usá
**Cloudflare Access** sobre la ruta `/panel.html`.
- El `id` de D1 es autoincremental y la fecha se guarda como texto ISO
para que el orden lexicográfico coincida con el cronológico.

