from pathlib import Path
import shutil
import re
import sys

ROOT = Path.cwd()
ROUTE = ROOT / "app" / "api" / "webhooks" / "google-calendar" / "route.ts"

if not ROUTE.exists():
    print(f"ERRORE: file non trovato: {ROUTE}")
    sys.exit(1)

backup = ROUTE.with_suffix(ROUTE.suffix + ".bak-before-customer-name-fallback")
shutil.copy2(ROUTE, backup)
print(f"Backup creato: {backup}")

text = ROUTE.read_text(encoding="utf-8")

helper = r'''
function extractGenericCustomerName(title: string) {
  const text = cleanSpaces(title);

  // Cerchiamo un punto di aggancio affidabile:
  // - riferimento prenotazione conosciuto
  // - riferimento breve tipo T141231047
  // - numero di telefono internazionale
  //
  // Il nome cliente viene preso da ciò che segue l'ULTIMO aggancio trovato.
  // Esempi:
  // "4 tagliere GYG2Q9FHYWV9 Ismail Alzaeim" -> "Ismail Alzaeim"
  // "2 pranzo cavallo T141231047 Paul Messiter" -> "Paul Messiter"
  // "4+3 bambini +49 15168805671 Antje" -> "Antje"

  const anchorPatterns = [
    /\bTOD[-\s]?[A-Z0-9]+\b/gi,
    /\bVIA-[A-Z0-9]+\b/gi,
    /\bBR-[A-Z0-9]+\b/gi,
    /\bGYG[A-Z0-9]+\b/gi,
    /\bT\d{6,}\b/gi,
    /(?:\+\d{1,3}|00\d{1,3})(?:[\s().-]*\d){6,15}/g,
  ];

  let lastAnchorEnd = -1;

  for (const pattern of anchorPatterns) {
    for (const match of text.matchAll(pattern)) {
      const start = match.index ?? -1;
      if (start < 0) continue;

      const end = start + String(match[0] || "").length;
      if (end > lastAnchorEnd) {
        lastAnchorEnd = end;
      }
    }
  }

  if (lastAnchorEnd < 0) return null;

  const candidate = cleanSpaces(text.slice(lastAnchorEnd))
    .replace(/^[,;:|/\\\-–—]+/, "")
    .trim();

  if (!candidate) return null;

  // Evita di salvare come nome un altro codice o solo numeri/simboli.
  if (!/[A-Za-zÀ-ÖØ-öø-ÿ]/.test(candidate)) return null;

  return candidate.slice(0, 120);
}

'''

if "function extractGenericCustomerName(" not in text:
    marker = "function extractCustomerName(title: string, channelLabel: string) {"
    if marker not in text:
        print("ERRORE: non trovo extractCustomerName().")
        sys.exit(1)
    text = text.replace(marker, helper + marker, 1)
else:
    print("Helper generico già presente, salto inserimento.")

pattern = re.compile(
    r"function extractCustomerName\(title: string, channelLabel: string\) \{.*?\n\}",
    re.S,
)

replacement = r'''function extractCustomerName(title: string, channelLabel: string) {
  const channelKey = normalizeChannelKey(channelLabel);

  if (channelKey === "curioseety") {
    const customerName = extractCurioseetyCustomer(title);
    if (customerName) return customerName;
  }

  if (channelKey === "anastasiya") {
    const customerName = extractAnastasiyaPranzoCustomer(title);
    if (customerName) return customerName;
  }

  if (channelKey === "airbnb") {
    const customerName = extractAirbnbBookingData(title).customerName;
    if (customerName) return customerName;
  }

  if (channelKey === "italyonabudgettours") {
    return "Italy";
  }

  if (channelKey === "tuscanescape") {
    return "Tuscan";
  }

  return extractGenericCustomerName(title);
}'''

match = pattern.search(text)
if not match:
    print("ERRORE: non riesco a individuare il blocco extractCustomerName().")
    sys.exit(1)

current_block = match.group(0)

if "return extractGenericCustomerName(title);" not in current_block:
    text = text[:match.start()] + replacement + text[match.end():]
else:
    print("extractCustomerName() usa già il fallback generico.")

ROUTE.write_text(text, encoding="utf-8")

print(f"Corretto: {ROUTE}")
print("")
print("Nuova logica nome cliente:")
print("  4+3 bambini +49 15168805671 Antje -> Antje")
print("  2 pranzo cavallo T141231047 Paul Messiter -> Paul Messiter")
print("  4 tagliere GYG2Q9FHYWV9 Ismail Alzaeim -> Ismail Alzaeim")
print("")
print("Le regole speciali Curioseety, Anastasiya, Airbnb, Italy on a Budget e Tuscan Escape restano attive.")
print("Ora esegui: npm run build")
