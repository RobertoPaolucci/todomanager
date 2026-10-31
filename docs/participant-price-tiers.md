# Prezzi per numero di partecipanti

`experience_channel_prices.pricing_mode` vale `fixed` (default) oppure `tiered`.
`price_tiers` contiene righe con estremi inclusivi `min_participants` /
`max_participants` e tre importi indipendenti: `your_unit_price`,
`public_unit_price`, `supplier_adult_unit_cost`. Salvataggio atomico nella stessa
riga esperienza/canale; un vincolo PostgreSQL respinge fasce sovrapposte,
intervalli non interi e prezzi negativi o con più di due decimali.

Si contano gli adulti paganti e i bambini con tariffa non gratuita (incasso o
pubblico); se entrambi i prezzi bambino sono zero, i bambini non determinano la
fascia. Infanti e guide/autisti sono esclusi. I prezzi bambino rimangono quelli
del canale: NULL segue il prezzo adulto della fascia, zero rimane zero.
Le esperienze a gruppi/quad conservano il loro calcolo esistente e non possono
attivare fasce dall'interfaccia. Se manca una fascia, la prenotazione non viene
salvata: errore nel form/webhook/CSV, `needs_review` nello staging Google.

Gli importi vengono salvati nella prenotazione. Le modifiche al listino non
aggiornano prenotazioni esistenti. Modificare una nota, un recapito o i non
paganti conserva gli importi; cambiare adulti/bambini, esperienza, canale o accordo
richiede un nuovo calcolo. Gli accordi manuali mantengono la precedenza.
`bookings.price_tier_snapshot` conserva la tariffa scelta anche per la fatturazione
FMDQ e i PDF dopo successive modifiche/disattivazioni delle fasce.
Il report fornitori preferisce i totali salvati; usa il vecchio calcolo solo se
il relativo totale non è disponibile.

Per i canali con fasce, il webhook accetta `source_total_price` finito e non
negativo come totale effettivo della prenotazione (mai moltiplicato per i pax):
conserva incasso e lordo ricevuti e calcola separatamente il costo fornitore.
I successivi eventi senza un totale valido conservano il totale effettivo.
La gestione dei canali in modalità fissa rimane quella precedente, compresa
la regola già esistente di Viator per `source_total_price`.
In modalità a fasce il webhook protegge le prenotazioni storiche/manuali senza
provenienza automatica: mantiene gli importi salvati e richiede revisione con
HTTP 409 se cambiano i paganti. Cancellazioni e ripristini conservano gli importi.
L'import CSV rimane insert-only e non aggiorna prenotazioni già presenti.

La migrazione `20261031142312_experience_channel_price_tiers.sql` aggiunge le
colonne senza modificare prenotazioni storiche e configura esclusivamente
esperienza 12 (Bókun 1052970), canale 4: 2×110, 3×95, 4×85, 5×80, 6×76 EUR.
I prezzi fissi esistenti restano memorizzati per un eventuale ritorno alla modalità
fissa. RLS resta attiva sulla tabella esistente, senza nuove policy per anon o
authenticated; accesso tramite il client server/service_role già utilizzato.
La funzione di validazione è SECURITY INVOKER, senza privilegi di scrittura,
eseguibile dal solo service_role oltre al proprietario.

Ordine di rilascio: controlli locali, migrazione Supabase, verifica tariffe e
prenotazione 2000 ancora a 400 EUR, poi eventuale deploy dell'applicazione.
Non inviare eventi di prova ai webhook di produzione: i test usano database
simulati; il test SQL usa PGlite locale quando disponibile nella directory già
usata dai test del progetto.

Controlli manuali: apertura prezzi e aggiunta/rimozione fasce su desktop/mobile,
ritorno a prezzo fisso, messaggio di sovrapposizione, nuova prenotazione con fascia
mancante, modifica di sole note della prenotazione 2000 e report fornitore.

## Verifica del 31 ottobre 2026

- Migrazione applicata a Todo Manager e allineata alla versione remota
  `20261031142312`.
- Query Supabase: 2=220, 3=285, 4=340, 5=400, 6=456 per tutti e tre i totali.
- Impronte dei dati confrontate prima/dopo: tutte le prenotazioni e tutti gli
  altri listini invariati (escluse le nuove colonne con default). Prenotazione
  2000 ancora a 400 EUR per incasso, lordo e costo fornitore.
- RLS attiva, funzione di validazione non eseguibile da anon/authenticated,
  eseguibile dal service_role; advisor senza nuove segnalazioni.
- `npm test`: 585 test, 569 passati, 16 saltati, zero errori. I 20 casi dedicati
  alle fasce, compreso il test SQL locale con PGlite, passano tutti.
- `npx tsc --noEmit --incremental false`, `npm run build`, `git diff --check`:
  passati. La prima build aveva rilevato il tentativo di leggere il nuovo schema
  durante la generazione statica: le pagine Esperienze e Nuova prenotazione
  ora caricano i prezzi a ogni richiesta; la build successiva è passata prima
  dell'applicazione della migrazione.
- ESLint sui file modificati: 79 segnalazioni già presenti, zero nuove,
  confrontando ogni diagnostica con il contenuto di `HEAD`. Nessuna modifica
  a codice estraneo per risolverle.
- Advisor Supabase preesistente: 6 view SECURITY DEFINER, 2 tabelle senza RLS,
  protezione password compromesse disabilitata e 23 informazioni RLS senza
  policy (coerenti con l'accesso server delle relative tabelle). Non modificati.
- Interazione reale del browser desktop/mobile ancora da verificare.
- Branch `main`: nessun commit, push o deploy dell'applicazione. Directory
  `supabase/.temp/` già presente e lasciata intatta.

## File coinvolti

- Prezzi: `app/esperienze/[id]/prezzi/actions.ts`,
  `app/esperienze/[id]/prezzi/page.tsx`, `components/PriceTierEditor.tsx`,
  `app/esperienze/page.tsx`.
- Calcolo e prenotazioni: `lib/booking-pricing.ts`, `lib/queries.ts`,
  `app/prenotazioni/actions.ts`, `components/BookingForm.tsx`,
  `app/prenotazioni/nuova/page.tsx`.
- Ingressi: `app/api/webhooks/prenotazioni/route.ts`,
  `app/prenotazioni/import/actions.ts`, `app/import/google-calendar/actions.ts`.
- Report: `app/fornitori/[id]/report/page.tsx`,
  `app/fatturazione-fmdq/page.tsx`, `app/fatturazione-fmdq/pdf/route.ts`,
  `app/fatturazione-fmdq/pdf-riepilogo/route.ts`.
- Test: `tests/participant-price-tiers.test.mjs`,
  `tests/booking-pricing.test.mjs`, `tests/helpers/booking-pricing-harness.mjs`.
- Database: `supabase/migrations/20261031142312_experience_channel_price_tiers.sql`.
- Documentazione: `docs/participant-price-tiers.md`.

Messaggio di commit proposto: `feat: add participant price tiers per experience and channel`.
