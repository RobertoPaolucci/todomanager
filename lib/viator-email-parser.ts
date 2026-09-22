// Pure parser: no database, product mapping, environment or Bókun dependency.
export const VIATOR_EMAIL_PARSER_VERSION = "viator-email/1.0.0";
export type ViatorEventType = "confirmed" | "modified" | "cancelled" | "unknown";

const labels = {
  booking_reference: "(?:riferimento(?: della)? prenotazione|numero(?: di)? prenotazione|booking(?: reference)?|booking ref)",
  product_code: "(?:codice(?: del)? prodotto|product(?: code)?)",
  tour_grade: "(?:codice(?: del)? tour grade|tour grade(?: code)?|codice opzione)",
  tour_name: "(?:nome(?: del)? tour|nome esperienza|esperienza|tour name|product name)",
  option_name: "(?:nome (?:dell[’'])?opzione|opzione|option(?: name)?)",
  activity_date: "(?:data(?: dell[’']attività| del tour| di viaggio)?|activity date|travel date|date)",
  activity_time: "(?:ora(?:rio)?(?: di inizio| del tour)?|activity time|start time|time)",
  lead_traveller: "(?:viaggiatore principale|nome(?: del)? viaggiatore principale|cliente|lead traveller|lead traveler|customer)",
  travellers: "(?:viaggiatori|partecipanti|pax|travellers|travelers|participants)",
  adults: "(?:adulti|adults)",
  children: "(?:bambini|children)",
  infants: "(?:neonati|infants)",
  phone: "(?:numero di telefono|telefono(?: del cliente)?|phone(?: number)?)",
  language: "(?:lingua(?: del tour)?|language)",
  meeting_point: "(?:punto d[’']incontro|punto di incontro|luogo di incontro|meeting point|pickup point)",
  special_requests: "(?:richieste speciali|special requests)",
  net_amount: "(?:tariffa netta(?: Viator)?|importo netto|net(?: amount| rate| price)?)",
  currency: "(?:valuta|currency)",
  change_text: "(?:modifiche(?: alla prenotazione)?|dettagli delle modifiche|changes|change text|amendments)",
} as const;

export function normalizeViatorBody(body: string): string {
  const isHtml = /<\/?(?:html|body|div|p|br|table|tr|td|span|a|h[1-6])\b/i.test(body);
  if (!isHtml) return body.replace(/\r\n?/g, "\n");
  const entities: Record<string, string> = {
    nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", euro: "€",
    rsquo: "’", lsquo: "‘", ndash: "–", mdash: "—", egrave: "è", agrave: "à",
    igrave: "ì", ograve: "ò", ugrave: "ù", eacute: "é",
  };
  return body.replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<\/?(?:p|div|tr|table|h[1-6]|li|br)\b[^>]*>/gi, "\n")
    .replace(/<\/(?:td|th)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
      if (!entity.startsWith("#")) return entities[entity.toLowerCase()] ?? whole;
      const n = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : whole;
    })
    .replace(/\r\n?/g, "\n").replace(/[\t ]+\n/g, "\n").replace(/\n[\t ]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n").trim();
}

function fields(text: string) {
  const result: Partial<Record<keyof typeof labels, string>> = {};
  const warnings: string[] = [];
  const lines = text.split("\n");
  const patterns = Object.entries(labels).map(([key, pattern]) => [key, new RegExp(`^\\s*${pattern}(?:\\s*[:：]\\s*(.*)|\\s*)$`, "i")] as const);
  let key: keyof typeof labels | null = null;
  for (const line of lines) {
    const found = patterns.map(([name, pattern]) => ({ name, match: line.match(pattern) })).find(item => item.match);
    if (found) {
      key = found.name as keyof typeof labels;
      if (result[key]) warnings.push(`repeated_field:${key}`);
      result[key] = found.match![1] ?? "";
    } else if (key) {
      result[key] += `\n${line}`;
    }
  }
  return { values: result, warnings };
}

function parseDate(value: string | null) {
  if (!value) return null;
  let year: number, month: number, day: number;
  const iso = value.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  const numeric = value.match(/\b(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b/);
  const months = ["jan|january|gen|gennaio", "feb|february|febbraio", "mar|march|marzo", "apr|april|aprile", "may|mag|maggio", "jun|june|giu|giugno", "jul|july|lug|luglio", "aug|august|ago|agosto", "sep|sept|september|set|settembre", "oct|october|ott|ottobre", "nov|november|novembre", "dec|december|dic|dicembre"];
  const named = value.match(new RegExp(`\\b(${months.join("|")})\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`, "i"));
  const italian = value.match(new RegExp(`\\b(\\d{1,2})\\s+(${months.join("|")})\\s+(\\d{4})\\b`, "i"));
  if (iso) [, year, month, day] = iso.map(Number);
  else if (numeric) [, day, month, year] = numeric.map(Number);
  else if (named || italian) {
    const m = named ?? italian!;
    year = Number(m[3]); day = Number(m[named ? 2 : 1]);
    month = months.findIndex(names => names.split("|").includes(m[named ? 1 : 2].toLowerCase())) + 1;
  } else return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` : null;
}

export function parseViatorTime(value: string | null) {
  const match = value?.match(/(?:^|[^\d])(\d{1,2}):([0-5]\d)(?::[0-5]\d)?\s*(AM|PM)?\b/i);
  if (!match) return null;
  let hours = Number(match[1]);
  if (match[3]) {
    if (hours < 1 || hours > 12) return null;
    hours = hours % 12 + (match[3].toUpperCase() === "PM" ? 12 : 0);
  }
  return hours < 24 ? `${String(hours).padStart(2, "0")}:${match[2]}` : null;
}

export function parseViatorNetAmount(value: string | null) {
  if (!value) return null;
  const amount = value.replace(/\b[A-Z]{3}\b/g, "").replace(/[€$£\s]/g, "");
  // Accept explicit decimal formats, reject ambiguous grouping or trailing prose.
  let normalized: string;
  if (/^\d+(?:[,.]\d{1,2})?$/.test(amount)) normalized = amount.replace(",", ".");
  else if (/^\d{1,3}(?:\.\d{3})+,\d{2}$/.test(amount)) normalized = amount.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(?:,\d{3})+\.\d{2}$/.test(amount)) normalized = amount.replace(/,/g, "");
  else return null;
  const n = Number(normalized);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function eventFromText(text: string): ViatorEventType {
  const matches = new Set<ViatorEventType>();
  // Status headlines only; cancellation policies and requests are not events.
  for (const line of text.split("\n")) {
    if (/^\s*(?:cancelled|canceled)\s*$/i.test(line) || /(?:prenotazione.{0,25}(?:cancellata|annullata)|(?:cancellazione|annullamento)\s+(?:della\s+)?prenotazione|booking.{0,15}cancelled|cancelled booking)/i.test(line)) matches.add("cancelled");
    if (/^\s*modified\s*$/i.test(line) || /(?:prenotazione.{0,25}(?:modificata|aggiornata)|modifica\s+(?:della\s+|alla\s+)?prenotazione|booking.{0,15}(?:modified|amended)|(?:modified|amended) booking)/i.test(line)) matches.add("modified");
    if (/^\s*confirmed\s*$/i.test(line) || /(?:prenotazione.{0,25}confermata|conferma\s+(?:della\s+|di\s+)?prenotazione|nuova prenotazione|booking.{0,15}confirmed|confirmed booking|new booking)/i.test(line)) matches.add("confirmed");
  }
  return matches.size === 1 ? [...matches][0] : "unknown";
}

export function parseViatorEmail(rawBody: string, subject = "") {
  const normalized_text = normalizeViatorBody(rawBody);
  const { values, warnings } = fields(normalized_text);
  const first = (key: keyof typeof labels) => values[key]?.trim().split("\n")[0]?.trim() || null;
  const full = (key: keyof typeof labels) => values[key]?.trim() || null;
  const subjectEvent = eventFromText(subject);
  // Avoid interpreting policy/footer text as the event type.
  const bodyEvent = eventFromText(normalized_text.split("\n").slice(0, 12).join("\n"));
  const event_type = subjectEvent !== "unknown" ? subjectEvent : bodyEvent;
  if (subjectEvent !== "unknown" && bodyEvent !== "unknown" && subjectEvent !== bodyEvent) warnings.push("conflicting_event_type");
  const references = [...new Set((`${subject}\n${normalized_text}`).match(/\bBR-\d+\b/gi)?.map(ref => ref.toUpperCase()) ?? [])];
  if (references.length > 1) warnings.push("multiple_booking_references");
  const product = first("product_code");
  const grade = first("tour_grade");
  const product_code = product?.match(/^\d+P\d+$/i)?.[0].toUpperCase() ?? null;
  const tour_grade = grade?.match(/^TG\d+(?:~[^\s]+)?$/i)?.[0].toUpperCase() ?? null;
  if (product && !product_code) warnings.push("invalid_product_code");
  if (grade && !tour_grade) warnings.push("invalid_tour_grade");
  const activity_date = parseDate(first("activity_date"));
  const activity_time = parseViatorTime(first("activity_time")) ?? parseViatorTime(first("option_name")) ?? parseViatorTime(tour_grade);
  if (first("activity_date") && !activity_date) warnings.push("invalid_activity_date");
  if (first("activity_time") && !parseViatorTime(first("activity_time"))) warnings.push("invalid_activity_time");
  const pax = full("travellers") ?? "";
  function count(key: "adults" | "children" | "infants", pattern: string) {
    const explicit = first(key)?.match(/^\d+$/)?.[0];
    const match = pax.match(new RegExp(`\\b(\\d+)\\s*(?:${pattern})\\b|\\b(?:${pattern})\\s*:\\s*(\\d+)`, "i"));
    return explicit !== undefined ? Number(explicit) : match ? Number(match[1] ?? match[2]) : null;
  }
  const adults = count("adults", "adult[io]|adults?");
  const children = count("children", "bambin[io]|children|child");
  const infants = count("infants", "neonat[io]|infants?");
  const totalMatch = first("travellers")?.match(/^(\d+)(?:\s*(?:viaggiatori|partecipanti|travellers|travelers|people))?$/i);
  const total_travellers = totalMatch ? Number(totalMatch[1]) : [adults, children, infants].some(n => n !== null) ? (adults ?? 0) + (children ?? 0) + (infants ?? 0) : null;
  const net_amount_text = first("net_amount");
  const net_amount = parseViatorNetAmount(net_amount_text);
  if (net_amount_text && net_amount === null) warnings.push("invalid_net_amount");
  const currency = net_amount_text?.match(/\b[A-Z]{3}\b/)?.[0] ?? first("currency")?.match(/^[A-Z]{3}$/)?.[0] ?? null;
  // Preserve the entire change section (including subsequent labelled fields).
  const changeHeading = new RegExp(`^\\s*${labels.change_text}(?:\\s*[:：]\\s*|\\s*$)`, "im").exec(normalized_text);
  const change_text = event_type === "modified"
    ? changeHeading ? normalized_text.slice(changeHeading.index + changeHeading[0].length).trim() : normalized_text
    : null;
  return {
    parser_version: VIATOR_EMAIL_PARSER_VERSION, event_type,
    booking_reference: references.length === 1 ? references[0] : null,
    product_code, tour_grade, tour_name: first("tour_name"), option_name: first("option_name"),
    activity_date, activity_time, lead_traveller: first("lead_traveller"),
    travellers: full("travellers"), adults, children, infants, total_travellers,
    phone: first("phone"), language: first("language"), meeting_point: full("meeting_point"),
    special_requests: full("special_requests"), currency, net_amount, net_amount_text,
    net_amount_basis: "booking_total" as const, change_text, normalized_text, warnings,
  };
}

export type ParsedViatorEmail = ReturnType<typeof parseViatorEmail>;
