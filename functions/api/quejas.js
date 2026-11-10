/**
 * Cloudflare Pages Function — /api/quejas
 *
 * POST: guarda una queja en D1 (binding env.DB).
 *       Antes la clasifica con Workers AI (binding env.AI,
 *       modelo @cf/meta/llama-3.1-8b-instruct) en alta | media | baja.
 *       Si la IA falla o el binding no existe, clasifica por palabras clave.
 * GET:  devuelve las quejas en JSON, ordenadas por prioridad y fecha.
 *
 * Si falta env.DB se devuelve un error claro en JSON (HTTP 503).
 */

const MODELO = "@cf/meta/llama-3.1-8b-instruct";
const MAX_TEXTO = 500;
const PRIORIDADES = ["alta", "media", "baja"];
const CATEGORIAS_VALIDAS = [
  "Mantenimiento",
  "Limpieza",
  "Seguridad",
  "Ruidos",
  "Administración",
  "Otro"
];

/* Frases en minúsculas y sin tildes: el texto se normaliza antes de comparar. */
const PALABRAS_CLAVE = {
  alta: [
    "urgente", "urgencia", "peligro", "peligroso", "riesgo", "inseguridad",
    "robo", "robaron", "hurto", "violencia", "amenaza", "acoso", "abuso",
    "discriminacion", "emergencia", "incendio", "inundacion", "fuga",
    "cortocircuito", "chispa", "electrocut", "desprendimiento", "derrumbe",
    "intoxicacion", "veneno", "humo", "perdida de gas", "olor a gas",
    "sin agua", "corte de agua", "plaga", "ratas", "cucarachas",
    "vidrio roto", "caida", "lastimado", "herido", "no funciona el ascensor",
    "atrapado", "rotura de cano"
  ],
  media: [
    "ruido", "ruidos", "limpieza", "sucio", "suciedad", "basura", "olor",
    "olores", "ascensor", "filtracion", "gotera", "gotea", "humedad",
    "pintura", "demora", "tardanza", "reparacion", "mantenimiento", "cloaca",
    "mosquito", "mosquitos", "lampara", "luz quemada", "porton", "cerradura",
    "perdida de agua", "calefaccion", "timbre", "interfonos", "portero"
  ],
  baja: [
    "sugerencia", "consulta", "duda", "felicitacion", "aviso", "cartel",
    "mejora", "idea", "pintar", "decoracion", "jardin", "propuesta",
    "informacion", "pregunta", "nota"
  ]
};

const INSTRUCCION_IA =
  "Sos un clasificador de quejas de un edificio. " +
  "Respondé ÚNICAMENTE con una palabra: alta, media o baja. Nada más. " +
  "alta = riesgo para personas, seguridad, salud, inundación, incendio, robo, violencia. " +
  "media = ruidos, limpieza, mantenimiento, filtraciones, demoras. " +
  "baja = sugerencias, consultas, felicitaciones, mejoras estéticas.";

/* ---------- utilidades ---------- */

function json(datos, estado = 200) {
  return new Response(JSON.stringify(datos), {
    status: estado,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function normalizar(texto) {
  return String(texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function clasificarPorPalabras(texto) {
  const t = normalizar(texto);
  if (PALABRAS_CLAVE.alta.some((p) => t.includes(p))) return "alta";
  if (PALABRAS_CLAVE.media.some((p) => t.includes(p))) return "media";
  if (PALABRAS_CLAVE.baja.some((p) => t.includes(p))) return "baja";
  return "media";
}

function extraerTextoRespuesta(respuesta) {
  if (!respuesta) return "";
  if (typeof respuesta === "string") return respuesta;
  if (typeof respuesta.response === "string") return respuesta.response;
  if (typeof respuesta.result === "string") return respuesta.result;
  if (respuesta.result && typeof respuesta.result.response === "string") {
    return respuesta.result.response;
  }
  return "";
}

function normalizarPrioridad(salida) {
  const limpio = normalizar(salida).trim();
  if (!limpio) return null;
  const palabras = limpio.split(/[^a-z]+/).filter(Boolean);
  for (const p of PRIORIDADES) {
    if (palabras.indexOf(p) !== -1) return p;
  }
  for (const p of PRIORIDADES) {
    if (limpio.indexOf(p) !== -1) return p;
  }
  return null;
}

async function clasificarConIA(env, texto) {
  try {
    if (!env || !env.AI || typeof env.AI.run !== "function") return null;

    const llamada = env.AI.run(MODELO, {
      messages: [
        { role: "system", content: INSTRUCCION_IA },
        { role: "user", content: `Queja: "${texto}"\nPrioridad:` }
      ],
      max_tokens: 6,
      temperature: 0
    });

    const timeout = new Promise((resolver) => setTimeout(() => resolver(null), 8000));
    const respuesta = await Promise.race([llamada, timeout]);

    return normalizarPrioridad(extraerTextoRespuesta(respuesta));
  } catch (error) {
    console.error("Workers AI falló, se usa clasificación por palabras clave:", error);
    return null;
  }
}

async function clasificar(env, texto) {
  const porIA = await clasificarConIA(env, texto);
  if (porIA) return { prioridad: porIA, origen: "ia" };
  return { prioridad: clasificarPorPalabras(texto), origen: "palabras-clave" };
}

/* ---------- handlers ---------- */

export async function onRequestGet(context) {
  const { env } = context;

  if (!env || !env.DB) {
    return json(
      {
        ok: false,
        error:
          "Falta el binding D1 (env.DB). Configuralo en Cloudflare Pages → Settings → " +
          "Functions → D1 database bindings con el nombre de variable DB."
      },
      503
    );
  }

  try {
    const consulta = await env.DB.prepare(
      `SELECT id, texto, categoria, prioridad, creada
         FROM quejas
        ORDER BY CASE prioridad
                   WHEN 'alta'  THEN 0
                   WHEN 'media' THEN 1
                   WHEN 'baja'  THEN 2
                   ELSE 3
                 END,
                 creada DESC
        LIMIT 500`
    ).all();

    const quejas = (consulta && consulta.results) || [];

    return json({ ok: true, total: quejas.length, quejas });
  } catch (error) {
    console.error("Error leyendo D1:", error);
    return json(
      {
        ok: false,
        error:
          "No pudimos leer la base de datos. Verificá que la tabla 'quejas' exista " +
          "(ejecutá schema.sql en la consola de D1). Detalle: " +
          (error && error.message ? error.message : "desconocido")
      },
      500
    );
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env || !env.DB) {
    return json(
      {
        ok: false,
        error:
          "Falta el binding D1 (env.DB). Configuralo en Cloudflare Pages → Settings → " +
          "Functions → D1 database bindings con el nombre de variable DB."
      },
      503
    );
  }

  let cuerpo;
  try {
    cuerpo = await request.json();
  } catch (error) {
    return json({ ok: false, error: "El cuerpo de la petición no es JSON válido." }, 400);
  }

  const texto = typeof cuerpo.texto === "string" ? cuerpo.texto.trim() : "";

  if (!texto) {
    return json({ ok: false, error: "El campo 'texto' es obligatorio." }, 400);
  }
  if (texto.length > MAX_TEXTO) {
    return json(
      { ok: false, error: `La queja no puede superar los ${MAX_TEXTO} caracteres.` },
      400
    );
  }

  const categoria =
    typeof cuerpo.categoria === "string" && CATEGORIAS_VALIDAS.indexOf(cuerpo.categoria.trim()) !== -1
      ? cuerpo.categoria.trim()
      : "Otro";

  try {
    const { prioridad, origen } = await clasificar(env, texto);
    const creada = new Date().toISOString();

    const resultado = await env.DB.prepare(
      `INSERT INTO quejas (texto, categoria, prioridad, creada) VALUES (?, ?, ?, ?)`
    )
      .bind(texto, categoria, prioridad, creada)
      .run();

    const id =
      resultado && resultado.meta && resultado.meta.last_row_id
        ? resultado.meta.last_row_id
        : null;

    return json(
      {
        ok: true,
        queja: { id, texto, categoria, prioridad, creada },
        clasificacion: origen
      },
      201
    );
  } catch (error) {
    console.error("Error guardando en D1:", error);
    return json(
      {
        ok: false,
        error:
          "No pudimos guardar la queja en la base de datos. Verificá la tabla 'quejas'. " +
          "Detalle: " + (error && error.message ? error.message : "desconocido")
      },
      500
    );
  }
}

export async function onRequest(context) {
  switch (context.request.method) {
    case "GET":
      return onRequestGet(context);
    case "POST":
      return onRequestPost(context);
    default:
      return json({ ok: false, error: "Método no permitido. Usá GET o POST." }, 405);
  }
}
