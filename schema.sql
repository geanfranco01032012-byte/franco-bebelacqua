-- Esquema para el Buzón de quejas inteligente de Gean Franco
-- Ejecutar una sola vez en la consola de la base D1 (binding: DB).

CREATE TABLE IF NOT EXISTS quejas (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  texto     TEXT    NOT NULL,
  categoria TEXT    NOT NULL DEFAULT 'Otro',
  prioridad TEXT    NOT NULL DEFAULT 'media'
            CHECK (prioridad IN ('alta', 'media', 'baja')),
  creada    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Acelera el listado del panel: prioridad + fecha.
CREATE INDEX IF NOT EXISTS idx_quejas_prioridad_fecha
  ON quejas (prioridad, creada DESC);
