# Google Calendar: piano puro e ispezione read-only

## Ambito e contratto

Implementazione isolata: nessun collegamento a webhook, azioni di importazione,
dashboard o conteggio eventi. Nessuna migration, SQL generato o modalità apply.
Le librerie non fanno I/O. La CLI effettua soltanto GET PostgREST con SELECT su
google_calendar_import_staging, google_calendar_events e google_calendar_event_aliases.
Credenziali lette solo nel processo CLI dal normale ambiente server, mai stampate.

- `parseGoogleCalendarAttendance(titolo | evento)`: usa original_title/title/summary;
  non usa adulti, experience_id, note o default staging come presenze.
  observed_total_guests comprende le persone esplicitamente contate, incluso
  personale; effective_total_guests esclude guide/autisti. Bambini/neonati inclusi.
  N pranzo Tuscan Escape include una guida: clienti N-1. Le parentesi alimentari
  non cambiano la classificazione. I soli tre titoli di blocco previsti producono
  operational_block, osservati NULL ed effettivi 0.
- Un titolo di e-bike con noleggio esplicito e senza attività contrastanti produce
  customer_event, effective 0, motivo offsite_rental_only. Non cambia il conteggio
  eventi della dashboard. E-bike senza prova di guida/noleggio resta NULL/review.
- Parsing prudente: attività non dimostrata, aritmetica ambigua e notazioni non
  supportate restano NULL; nessuna correzione automatica dei refusi.
- `matchGoogleCalendarIdentity(observation, events, aliases)`: match/new/ambiguous/
  insufficient_identity. Namespace predefinito legacy_unscoped; UID normalizzati
  dal modulo esistente, alias solo verificati. Alias conflittuali, non verificati
  o con destinazione incoerente richiedono revisione. Data, titolo, booking_reference
  e staging_id non partecipano all'identità. Un iCalUID richiede uno scope di
  occorrenza esplicito, mai ricavato dalla data corrente.
- `planGoogleCalendarObservation` produce una proiezione ipotetica e differenze,
  NON un payload pronto da applicare. Tutti i campi historical_* del canonico
  vengono conservati; metadati non osservati non vengono cancellati. Negli input
  normalizzati, id indica l'ID staging, non il resource ID Google.
  Un payload minimo di cancellazione senza titolo conserva anche le presenze
  e la classificazione precedenti: manca una nuova osservazione su quei campi.
- `planGoogleCalendarSync` mantiene tutte le osservazioni dello stesso canonico
  e le segnala: non sceglie vincitori, non somma righe duplicate.
- Lo stato Google esplicito gcal_event_status è accettato per futuri payload
  normalizzati. ignored/imported/needs_review non dimostrano lo stato Google.
  gcal_cancelled o la nota iniziale esatta prodotta dal webhook sono evidenza
  di cancellazione persistita (anche dopo Ignora/Reset). Uno stato esplicito
  fornito dal chiamante prevale sulla vecchia nota.
- certainty=certain significa evidenza esplicita nella fonte, non verifica
  attuale tramite Google. Quando lo staging non dimostra lo stato, status.value
  resta NULL e la proiezione conserva lo stato canonico preesistente, separatamente
  mostrato come retained_status; per un nuovo evento resta unknown.
  La cancellazione resta un attributo distinto dalle presenze lette dal titolo.
  Quindi Kurt mantiene 4 persone descritte, ma sarebbe escluso dalle presenze
  effettivamente realizzate in quanto cancellato.
- Le proiezioni non definiscono ancora una policy live per ordine temporale,
  riattivazioni, riconciliazioni multiple o override manuali.

## Comandi

```powershell
node scripts/inspect-google-calendar-sync.mjs --from-db --month 2026-09
node scripts/inspect-google-calendar-sync.mjs --from-db --month 2026-09 --details
node scripts/inspect-google-calendar-sync.mjs --input snapshot.json --year 2026
node --test tests/google-calendar-attendance.test.mjs tests/google-calendar-canonical-plan.test.mjs tests/google-calendar-sync-inspection.test.mjs
```

Input offline: { staging: [...], events: [...], aliases: [...] }.
Senza argomenti: solo help, senza rete. Default: output aggregato; --details
include titoli e differenze, quindi dati personali da conservare localmente.
Non sono accettati --apply o --output. Tutte le identità vengono lette prima del
filtro temporale, per trovare anche eventi spostati da/verso un altro mese.
Paginazione per ID fino a pagina vuota, anche con limiti server inferiori a 500.
SELECT sequenziali: non costituiscono uno snapshot transazionale.

## Dry-run settembre 2026

Eseguito il 30 settembre 2026 su HEAD iniziale 33b26f0.
Letti 631 staging, 1314 canonici e 1724 alias.
Nessun canonico di settembre è privo di una osservazione staging corrispondente.

```json
{
  "staging_analyzed": 126,
  "canonical_match": 107,
  "new_events": 19,
  "ambiguous": 0,
  "insufficient_identity": 0,
  "attendance_differences": 23,
  "classification_differences": 16,
  "date_title_differences": 12,
  "certain_cancellations": 15,
  "unproven_google_status": 111,
  "requires_review": 116,
  "attendance_requires_review": 5,
  "offsite_rentals": 6,
  "tuscan_escape": 19,
  "status_differences": 2,
  "multiple_observation_rows": 8,
  "stale_or_unproven_freshness": 3,
  "distinct_matched_events": 103
}
```

Le 107 corrispondenze riguardano **103 canonici distinti**. Quattro coppie di
staging richiedono riconciliazione. I contatori delle differenze contano righe
matched, non nuovi eventi né operazioni approvate. Le differenze di parser/source/
quality sono visibili nei dettagli ma non sono differenze nel totale presenze.
Non viene calcolato né forzato un totale finale di settembre.

### I 14 Tuscan Escape classificati come blocchi

Sono pranzi espliciti: la proiezione cambia operational_block in customer_event,
rimuove il motivo di esclusione da blocco e sostituisce NULL con i clienti sotto.
Lo stato Google resta non dimostrabile per tutti e 14.

| Staging | Canonico | Data | Presenze proposte |
| --- | --- | --- | --- |
| 565 | 1244 | 2026-09-07 | 8 |
| 566 | 1245 | 2026-09-08 | 6 |
| 576 | 1255 | 2026-09-12 | 8 |
| 541 | 1221 | 2026-09-14 | 8 |
| 542 | 1222 | 2026-09-14 | 6 |
| 598 | 1277 | 2026-09-15 | 7 |
| 577 | 1256 | 2026-09-17 | 5 |
| 578 | 1257 | 2026-09-18 | 8 |
| 620 | 1299 | 2026-09-20 | 5 |
| 581 | 1260 | 2026-09-21 | 8 |
| 582 | 1261 | 2026-09-22 | 8 |
| 583 | 1262 | 2026-09-24 | 8 |
| 584 | 1263 | 2026-09-26 | 7 |
| 585 | 1264 | 2026-09-27 | 4 |

Sono presenti 19 staging che nominano Tuscan Escape: questi 14, due pranzi già
corretti (564 e 567: 4 e 8 clienti), il caso con parentesi, il 535 cancellato
con titolo non sufficiente a provare un pranzo e il nuovo 656 (7 clienti).
Il caso **534 → 1214**, «9 pranzo (1 no glutine no latticini) Tuscan escape»,
passa da 9 a **8**, con aggiornamento del titolo da «9 Tuscan escape».
Non è un blocco.

### I 19 staging senza canonico

Sono 19 identità nuove, non 19 inserimenti autorizzati. Stato Google non
dimostrabile tranne 641, con cancellazione esplicita. Historical_* resterebbero
NULL, senza inventare collegamenti allo storico.

| Staging | Data | Osservati | Presenze proposte | Stato osservato |
| --- | --- | --- | --- | --- |
| 636 | 2026-09-27 | 2 | 2 | non dimostrabile |
| 639 | 2026-09-21 | 6 | 5 | non dimostrabile |
| 640 | 2026-09-27 | 6 | 5 | non dimostrabile |
| 641 | 2026-09-27 | 2 | 2 | cancelled |
| 642 | 2026-09-25 | 7 | 6 | non dimostrabile |
| 643 | 2026-09-22 | 4 | 0 | non dimostrabile |
| 645 | 2026-09-22 | 3 | 3 | non dimostrabile |
| 646 | 2026-09-26 | 2 | 2 | non dimostrabile |
| 649 | 2026-09-23 | 2 | 2 | non dimostrabile |
| 650 | 2026-09-23 | 2 | 2 | non dimostrabile |
| 652 | 2026-09-23 | 2 | 0 | non dimostrabile |
| 653 | 2026-09-27 | 2 | 2 | non dimostrabile |
| 654 | 2026-09-24 | 2 | 2 | non dimostrabile |
| 656 | 2026-09-29 | 8 | 7 | non dimostrabile |
| 661 | 2026-09-28 | 2 | 0 | non dimostrabile |
| 662 | 2026-09-28 | 5 | 4 | non dimostrabile |
| 664 | 2026-09-29 | 2 | 2 | non dimostrabile |
| 665 | 2026-09-30 | 2 | 2 | non dimostrabile |
| 666 | 2026-09-30 | 3 | 3 | non dimostrabile |

### Altre differenze di presenze

Oltre ai 14 pranzi sopra, le altre 9 righe con differenze sono:

| Staging | Canonico | Attuale → proposto | Interpretazione |
| --- | --- | --- | --- |
| 174 | 1042 | 12 → 15 | osservazione obsoleta/non verificata: non scegliere automaticamente |
| 178 | 1051 | 25 → 18 | osservazione obsoleta/non verificata: non scegliere automaticamente |
| 354 | 1043 | 3 → 4 | include il neonato; storico 3 conservato |
| 533 | 1213 | 2 → 0 | noleggio esplicito |
| 534 | 1214 | 9 → 8 | pranzo Tuscan con parentesi |
| 538 | 1218 | 7 → 0 | noleggio esplicito |
| 594 | 1273 | 2 → NULL | e-bike ambiguo |
| 602 | 1281 | 1 → 0 | noleggio esplicito |
| 605 | 1284 | 2 → NULL | attività in fattoria non dimostrata |

Noleggi riconosciuti: 533 (2→0), 538 (7→0, cancellato), 602 (1→0, cancellato);
nuovi 643 (osservati 4), 652 (2), 661 (2), tutti con effettivi 0.
Il refuso 597 «2 e ike solo noleggio» resta NULL/review: non è stato corretto
automaticamente per ottenere un conteggio atteso.

### Stato Google e 30 settembre

- **Kurt Huntzinger**, staging 448 → canonico 1128: evidenza persistita di
  cancellazione; stato canonico unknown → cancelled. Titolo con 4 clienti
  conservato, esclusione dal conteggio degli eventi non cancellati.
- L'altra differenza di stato è 605 → 1284: unknown → cancelled.
  Delle 15 cancellazioni certe, 12 sono già cancelled, 2 cambierebbero stato,
  1 è il nuovo staging 641.
- **Christine**, staging 665 del 30/09: nuova identità, 2 presenze.
- **Kayla**, staging 666 del 30/09: nuova identità, 3 presenze (bambino incluso).
- **Paloma**, staging 179 e 658 del 30/09: stesso canonico 1052, sempre 8 presenze.
  Il 658 aggiunge le note alimentari al titolo. Due osservazioni dello stesso
  evento: nessun raddoppio e nessuna selezione arbitraria della provenienza.
- Lo stato Google di Christine, Kayla e Paloma non è dimostrabile dallo staging.

### Differenze data/titolo e osservazioni multiple

Le 12 righe con differenze data/titolo hanno staging ID:
174, 178, 385, 528, 534, 581, 582, 583, 584, 585, 620, 658.
Tra queste, 174 propone la vecchia data 06/09 al posto del 03/09 attualmente
canonico; è segnalato, non accettato automaticamente.

| Canonico | Staging | Decisione rimasta aperta |
| --- | --- | --- |
| 1042 | 174 / 415 | 15 clienti il 06/09 contro 12 il 03/09; osservazione 174 meno recente/non dimostrabile |
| 1051 | 178 / 545 | 18 contro 25 clienti; osservazione 178 meno recente/non dimostrabile |
| 1065 | 177 / 352 | 20 clienti; 352 conserva la cancellazione, 177 non prova lo stato attuale |
| 1052 | 179 / 658 | Paloma: stesso gruppo, titolo aggiornato con note alimentari |

### Cinque parsing ancora incerti

| Staging | Evidenza | Esito |
| --- | --- | --- |
| 465 | 4+2 bambini, nessuna attività esplicita | osservati 6, presenze NULL; cancellato |
| 535 | 5 Tuscan escape senza pranzo | osservati 5, presenze NULL; cancellato |
| 594 | 2 ebike villa svetoni | osservati 2, presenze NULL; guida/noleggio non dimostrati |
| 597 | 2 e ike solo noleggio | osservati 2, presenze NULL; refuso non normalizzato, cancellato |
| 605 | 2 tour a piedi Montepulciano | osservati 2, presenze NULL; presenza in fattoria non dimostrata, cancellato |

### Prima della sincronizzazione live

Occorre definire come ottenere uno stato Google esplicito e la sua freschezza,
quale osservazione prevale nelle quattro coppie, come proteggere gli override
manuali già presenti e come gestire le cinque attività incerte (oppure lasciarle
NULL). La conservazione dei campi storici è già coperta dai test. Calendar/ricorrenza
devono arrivare come evidenza verificata, senza inventare nuovi scope dal titolo
o dalla data. Questa fase non abilita alcuna scrittura.

## Verifiche

- Suite completa: 385 test, 369 passati, 0 falliti, 16 saltati
  (test SQL opzionali con motore PGlite non configurato).
- Nessun build: fase locale senza commit, secondo AGENTS.md.
- ESLint mirato sui sei file JavaScript superato; diff --check senza errori.
- Nessuna scrittura Supabase, migration, commit o push.
