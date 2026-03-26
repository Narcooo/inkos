/**
 * [R6] Cron Expression Parser
 *
 * Calcula ms hasta la proxima ejecucion de una expresion cron de 5 campos:
 * minute hour day-of-month month day-of-week
 *
 * Patrones soportados: wildcard (*), valor fijo (N), step (star-slash-N),
 * lista (N,M), rango (N-M).
 */

export interface CronField {
  type: "any" | "fixed" | "step" | "list" | "range";
  values: number[];
  step?: number;
}

/**
 * Parsea una expresion cron de 5 campos.
 * Retorna un array de 5 CronField: [minute, hour, dayOfMonth, month, dayOfWeek]
 */
export function parseCron(expr: string): CronField[] {
  const parts = expr.trim().split(/\s+/);
  if (parts.length < 5) {
    throw new Error(`Invalid cron expression (need 5 fields): "${expr}"`);
  }

  const ranges = [
    { min: 0, max: 59 }, // minute
    { min: 0, max: 23 }, // hour
    { min: 1, max: 31 }, // day of month
    { min: 1, max: 12 }, // month
    { min: 0, max: 6 },  // day of week (0=Sunday)
  ];

  return parts.slice(0, 5).map((part, i) => parseField(part!, ranges[i]!));
}

function parseField(part: string, range: { min: number; max: number }): CronField {
  // Wildcard: *
  if (part === "*") {
    return { type: "any", values: [] };
  }

  // Step: */N or N/M
  if (part.includes("/")) {
    const [base, stepStr] = part.split("/");
    const step = parseInt(stepStr!, 10);
    if (base === "*") {
      // Genera todos los valores que coinciden con el step
      const values: number[] = [];
      for (let v = range.min; v <= range.max; v += step) {
        values.push(v);
      }
      return { type: "step", values, step };
    }
    // N/M — desde N, cada M
    const start = parseInt(base!, 10);
    const values: number[] = [];
    for (let v = start; v <= range.max; v += step) {
      values.push(v);
    }
    return { type: "step", values, step };
  }

  // List: N,M,...
  if (part.includes(",")) {
    const values = part.split(",").map((s) => parseInt(s, 10));
    return { type: "list", values };
  }

  // Range: N-M
  if (part.includes("-")) {
    const [startStr, endStr] = part.split("-");
    const start = parseInt(startStr!, 10);
    const end = parseInt(endStr!, 10);
    const values: number[] = [];
    for (let v = start; v <= end; v++) {
      values.push(v);
    }
    return { type: "range", values };
  }

  // Fixed value: N
  const value = parseInt(part, 10);
  return { type: "fixed", values: [value] };
}

/**
 * Verifica si un campo cron coincide con un valor dado.
 */
function fieldMatches(field: CronField, value: number): boolean {
  if (field.type === "any") return true;
  return field.values.includes(value);
}

/**
 * Calcula los milisegundos desde `now` hasta la proxima ejecucion del cron.
 * Busca en las proximas 48 horas (2 dias) para cubrir cualquier patron diario.
 *
 * Para patrones de intervalo simples (step), retorna el intervalo directamente.
 */
export function cronNextRunMs(expr: string, now?: Date): number {
  const fields = parseCron(expr);
  const [minuteField, hourField, domField, monthField, dowField] = fields;

  // Optimizacion: para patrones puramente de intervalo, retorna el intervalo fijo
  if (isSimpleInterval(fields)) {
    return computeSimpleInterval(minuteField!, hourField!);
  }

  // Para expresiones con campos fijos, calcula el proximo momento de disparo
  const reference = now ?? new Date();
  const candidate = new Date(reference.getTime());

  // Avanza al menos 1 minuto para evitar re-disparo inmediato
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  // Buscar en las proximas 48 horas (2880 minutos)
  const maxIterations = 2880;
  for (let i = 0; i < maxIterations; i++) {
    const m = candidate.getMinutes();
    const h = candidate.getHours();
    const dom = candidate.getDate();
    const month = candidate.getMonth() + 1; // Date months are 0-indexed
    const dow = candidate.getDay();

    if (
      fieldMatches(minuteField!, m) &&
      fieldMatches(hourField!, h) &&
      fieldMatches(domField!, dom) &&
      fieldMatches(monthField!, month) &&
      fieldMatches(dowField!, dow)
    ) {
      return candidate.getTime() - reference.getTime();
    }

    // Avanzar 1 minuto
    candidate.setMinutes(candidate.getMinutes() + 1);
  }

  // Fallback: 24 horas si no encuentra coincidencia en 48h
  return 24 * 60 * 60 * 1000;
}

/**
 * Determina si la expresion cron es un simple intervalo (solo usa step patterns).
 */
function isSimpleInterval(fields: CronField[]): boolean {
  const [minute, hour, dom, month, dow] = fields;
  // Solo es simple si minute o hour usan step y el resto es wildcard
  const restAreAny = dom!.type === "any" && month!.type === "any" && dow!.type === "any";
  if (!restAreAny) return false;

  // */N * * * * → intervalo de minutos
  if (minute!.type === "step" && hour!.type === "any") return true;
  // 0 */N * * * → intervalo de horas (o cualquier minute fijo con hour step)
  if (hour!.type === "step") return true;

  return false;
}

/**
 * Calcula el intervalo en ms para patrones simples de tipo step.
 */
function computeSimpleInterval(minute: CronField, hour: CronField): number {
  if (minute.type === "step" && minute.step) {
    return minute.step * 60 * 1000;
  }
  if (hour.type === "step" && hour.step) {
    return hour.step * 60 * 60 * 1000;
  }
  return 24 * 60 * 60 * 1000;
}
