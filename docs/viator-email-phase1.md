# Viator FMDQ email — fase 1

Implementazione preparata, non attivata. Migration **NON applicata**:
`supabase/migrations/202609220001_viator_email_phase1.sql`.
Nessuna modifica a dati esistenti, Make, Integration Email, NotificationCenter,
mapping, file `.env` o logica economica delle bookings.

## Contratto endpoint

`POST /api/webhooks/viator-email`, runtime Node.js. Autenticazione direttamente
nella route: `Authorization: Bearer <VIATOR_EMAIL_WEBHOOK_SECRET>`.
Secret assente/vuoto: 503; credenziale errata: 401. Nessun segreto hardcoded,
nessun affidamento sul login applicativo (il proxy esclude `/api`).

`Content-Type: application/json`; corpo massimo 2 MiB, controllato anche durante
la lettura dello stream. Payload Make previsto:

```json
{
  "message_id": "identificativo-email-originale",
  "received_at": "2026-09-22T10:00:00Z",
  "subject": "Prenotazione confermata",
  "sender": "mittente-originale",
  "body": "corpo originale plain text oppure HTML"
}
```

`body` deve essere una stringa non vuota. Metadati assenti sono nullable;
`received_at` non valido viene conservato in `raw_payload`, segnalato in
`parsed_data.transport_warnings`, e non valorizza la colonna timestamptz.
`created_at` rappresenta la ricezione server. Metadati di tipo errato o JSON
malformato: 400; content type errato: 415; limite superato: 413.
L'archiviazione riguarda gli envelope autenticati e validi, inclusi corpi email
non riconosciuti o incompleti. Nessun parsing prima dell'INSERT archivio.

Campi extra restano solo nel payload originale: non possono cambiare lo scope
server **business_unit_id=1, channel_id=2, booking_source=Viator**.

`VIATOR_EMAIL_PROCESS_BOOKINGS=false` (anche quando assente) significa dry-run.
In questa fase il flag viene registrato ma **anche `true` non abilita scritture**:
il codice non contiene insert/update/delete su bookings. L'attivazione richiederà
una fase successiva dopo verifica della transizione storica e degli importi.
Nessuna funzione applicativa di creazione è esposta: `proposed_booking` è solo
un piano serializzato, con l'economia deliberatamente esclusa.

## Archivio, retry e classificazione

Prima operazione DB: INSERT di `raw_body`, `raw_payload`, hash SHA-256,
versione parser e metadati. Solo dopo il salvataggio avvengono parsing e letture
di bookings/mapping. `raw_body` resta invariato anche per email HTML.

`message_id` valorizzato è UNIQUE. Una riconsegna con stesso contenuto restituisce
lo stesso import, senza ripetere una classificazione completata. Lo stesso ID con
corpo/subject/sender differenti restituisce 409 `message_id_content_conflict`:
l'archivio originale non viene sovrascritto; il conflitto va esaminato dal mittente.
L'hash esclude `received_at`, non è UNIQUE e non sostituisce l'identità email.
Senza message ID non si garantisce deduplicazione delle consegne: Make dovrà
trasmettere l'identificativo originale stabile.

Stati tecnici: `archived`, `processing`, `processing_failed`. Il claim tramite
compare-and-set rende un solo tentativo proprietario dell'elaborazione.
`attempts` conta i tentativi acquisiti, non tutte le consegne HTTP. Una lease di
cinque minuti (`processing_started_at`) consente il recupero dopo un crash con
la successiva riconsegna. Una lease ancora attiva risponde 503 con `Retry-After`.
Una classificazione fallita risponde 503 e conserva raw e dati già parsati;
un errore di persistenza non produce un falso successo. Nessun worker o replay
automatico è attivato in questa fase. Senza una riconsegna, un import interrotto
resta visibile nell'archivio per la futura revisione.

| Stato funzionale | Significato in dry-run |
| --- | --- |
| `ready` | Conferma completa, mapping esatto attivo, nessuna booking candidata; piano di creazione soltanto |
| `needs_mapping` | Mapping prodotto + tour grade assente, inattivo o non della BU FMDQ |
| `duplicate_candidate` | Conferma con BR già presente o variante numerica storica nella BU FMDQ; creazione bloccata |
| `needs_review` | Email sconosciuta, dati ambigui/incompleti, più booking canoniche o mapping ambiguo |
| `modified` | Modifica con una sola booking canonica; solo segnalazione e testo integrale |
| `cancelled` | Cancellazione con una sola booking canonica; solo piano di cancellazione |
| `modification_unmatched` | Nessuna booking FMDQ con riferimento BR esatto |
| `cancellation_unmatched` | Nessuna booking FMDQ con riferimento BR esatto |

Le query di identità usano soltanto BU=1 + riferimento BR canonico. Per le nuove
conferme si cerca anche la variante numerica, **esclusivamente per bloccare**.
Nessun fallback per titolo, nome cliente, data o riferimenti Bókun. Nessuna scelta
della riga più recente tra duplicati. Anche le bookings cancellate restano nel
controllo duplicati. Le altre business unit non vengono collegate o modificate.
`booking_id` resta NULL; gli eventuali ID candidati sono soltanto diagnostici in
`parsed_data.classification.candidate_booking_ids`.

Una conferma è `ready` quando dispone di riferimento, mapping esatto attivo,
data valida, ora (esplicita/opzione/tour grade o default del mapping), lead traveller
e almeno un partecipante. Il parser conserva i campi mancanti come NULL, mai prezzi
o persone inventati. I nomi esperienza sono descrittivi e non scelgono il mapping.
Il netto `EUR €40,32` con due adulti resta **40.32 per l'intera prenotazione** in
`parsed_data.net_amount`, con `net_amount_basis=booking_total`; nessun calcolo
economico sulle bookings.

Risposta 200: `import_id`, `status`, `duplicate`, `retryable=false`,
`booking_writes_enabled=false`. Errori operativi temporanei: 503, `retryable=true`.
Le risposte non includono corpo email, clienti, credenziali o errori grezzi DB.

## Migration e futura revisione

Due nuove tabelle con RLS attiva e accesso revocato a `anon`/`authenticated`:
`viator_email_imports` e `viator_product_mappings`. Accesso tramite service role
solo lato server; nessun permesso DELETE all'archivio. Indici non univoci per
revisione, riferimento e hash. Nessun UNIQUE globale sul riferimento booking.

Per garantire la stessa BU anche quando cambia un'esperienza, la migration aggiunge
una chiave UNIQUE di supporto `(id, business_unit_id)` su `experiences` e una FK
composta dal mapping. Non modifica righe esistenti. Dopo l'eventuale applicazione,
lo spostamento/eliminazione di un'esperienza referenziata da mapping sarà impedito
finché il mapping non viene gestito esplicitamente. Nessun trigger o vincolo nuovo
su bookings. `booking_id` è un riferimento logico riservato per la fase successiva.
`viator_tour_grade_code` è obbligatorio: nessun mapping wildcard implicito.
Non esistono seed; **200401P10 / TG1~12:00 → esperienza 16 non è approvato**.
`updated_at` dei mapping andrà aggiornato esplicitamente dai futuri writer.
Non sono introdotti acknowledged/resolved_at prima di definire il workflow umano.

API interna in `lib/viator-email-imports.ts`, protetta da `server-only`:

- `listViatorEmailImports(db, {status, beforeId, limit})`: lista metadati per FMDQ,
  paginazione per ID, massimo 100; nessun corpo originale nella lista.
- `getViatorEmailImport(db, id)`: dettaglio completo per FMDQ, inclusi raw e diagnosi.

La futura pagina dovrà verificare sessione e autorizzazione dell'operatore prima
di usare queste funzioni. Non è esposto un GET pubblico e il secret Make non dà
accesso alla lettura delle email. NotificationCenter e bookings.notes invariati.

## Verifiche e limiti

```powershell
node --test tests/viator-email.test.mjs
# Solo PostgreSQL/WASM locale in memoria, mai Supabase:
$env:VIATOR_TEST_PGLITE_MODULE = '<percorso-locale>/@electric-sql/pglite/dist/index.js'
node --test tests/viator-email-migration.test.mjs
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js app/api/webhooks/viator-email/route.ts lib/viator-email-parser.ts lib/viator-email-classification.ts lib/viator-email-imports.ts tests/viator-email.test.mjs tests/viator-email-migration.test.mjs tests/fixtures/viator-emails.mjs
```

Le fixture contengono i dati reali forniti di Amber, Autumn e Beth; intestazioni
e disposizione sono ricostruite perché i corpi integrali non sono stati forniti.
Le varianti HTML e i dati aggiuntivi sono sintetici. Prima dell'attivazione servirà
verificare i corpi originali completi (etichette, formattazione, firme e sezioni
delle modifiche). Il parser è conservativo: campi non riconosciuti rimangono nel
raw e nel testo normalizzato e possono richiedere revisione.

Una classificazione completata fotografa mapping e storico al momento della
ricezione; riconsegnare lo stesso message ID non la ricalcola. Replay dopo la
configurazione dei mapping e applicazione delle operazioni appartengono alla
fase successiva, con nuova validazione di identità e transizione storica.
