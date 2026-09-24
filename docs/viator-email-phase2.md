# Viator FMDQ email — Phase 2, sola creazione

Implementazione preparata, non attivata su Supabase. Applicare separatamente
`supabase/migrations/202609240001_viator_email_create_booking.sql` prima di
impostare `VIATOR_EMAIL_PROCESS_BOOKINGS=true`. Nessuna modifica a `.env`,
mapping o dati reali è inclusa. La migration aggiunge solo una funzione RPC,
eseguibile da `service_role`, senza nuovi campi, stati o vincoli sulle bookings.
Le istruzioni Phase 1 restano valide per parser, autenticazione e dry-run.

## Condizioni e risultato

Solo il valore esatto `true` abilita la creazione per le nuove email confirmed
classificate `ready` / `confirmation_ready_dry_run` / `create_booking`.
Lo scope resta BU 1, canale 2. Un envelope che dichiara BU/canale diversi va
in `needs_review`. Pending, modified, cancelled e le classificazioni non pronte
non invocano la creazione. Parser e flussi Bókun restano invariati.

La funzione ricontrolla sotto lock la lease dell'import, il mapping esatto
attivo, l'esperienza FMDQ attiva e i prezzi esperienza/canale. Richiede netto
non negativo in EUR, espresso come totale booking, e conteggi adulti/bambini/
infant coerenti con il totale. Le categorie assenti valgono zero solo quando
il totale coincide con la somma delle categorie note: nessun adulto inventato.

Il risultato completato usa lo stato esistente `ready` con `booking_id`
valorizzato e `parsed_data.classification.reason=booking_created`,
`action=create_booking`, `would_do=none`, `booking_writes_enabled=true`.
La risposta HTTP include `booking_id` e `action`. `ready` senza questi metadati
resta un piano dry-run. Nessun replay automatico degli import già classificati:
attivare la env non rielabora retroattivamente un vecchio message_id.

## Campi e importi

Si usano i campi verificati tramite OpenAPI del database reale:

- Identità: `business_unit_id`, `channel_id`, `booking_source=Viator`,
  `booking_reference`, `experience_id`, `experience_name`, `supplier_id`.
- Cliente/attività: `customer_name`, `customer_phone`, `booking_date`,
  `booking_time`, `booking_created_at`, `adults`, `children`, `infants`,
  `total_people`, `pax`.
- Economia: `your_unit_price`, `public_unit_price`, `supplier_unit_cost`,
  `total_to_you`, `total_customer`, `total_amount`, `total_supplier_cost`,
  `margin_total`.
- Operatività: `notes`, `customer_payment_status=pending`,
  `supplier_payment_status=pending`, `is_cancelled=false`, `was_modified=false`.

Il netto email è assegnato direttamente a `total_to_you`, mai moltiplicato
per i partecipanti. Prezzo pubblico e costi seguono le convenzioni del webhook
esistente, con prezzi adulti/bambini o di gruppo; il margine è netto meno costi.
`total_amount` rispecchia `total_customer` come nell'inserimento manuale.
La conferma non prova l'incasso: nessun pagamento viene marcato come effettuato.

`total_to_you_source` resta NULL: i valori attualmente previsti sono
`configured_price`, `bokun_webhook`, `bokun_api_backfill`, tutti inappropriati
per il netto email. Provenienza esplicita `Viator email FMDQ`, ID import e base
economica sono nelle note; email e dettaglio completo restano nell'archivio.
`bokun_booking_reference` non viene valorizzato; `experiences.bokun_id` non è usato.
`created_at`/`updated_at` mantengono i default DB. `booking_created_at` usa la
data UTC di ricezione, oppure quella di archiviazione (non la data attività).

## Atomicità e limiti

Il vincolo UNIQUE esistente su `message_id` e il claim condizionale proteggono
le riconsegne. La RPC ricontrolla riferimenti BR e numerici nella BU 1, comprese
prenotazioni cancellate, senza normalizzare o aggiornare righe storiche.
Il collegamento all'import e l'INSERT sono una sola transazione. Errori SQL
annullano solo il nuovo lavoro della transazione e salvano `processing_failed`
con codice diagnostico controllato, mai messaggi DB contenenti dati personali.
Un retry dopo una risposta persa ritrova il collegamento già completato.
RPC assente/irraggiungibile: 503 e nessun fallback INSERT.

OpenAPI non espone gli indici UNIQUE/check completi. Non viene quindi assunto
un vincolo univoco sul riferimento OTA. Un breve lock `SHARE ROW EXCLUSIVE`
sulle bookings serializza controllo finale e inserimento, lasciando le letture
disponibili; il timeout di 5 secondi rende il tentativo ripetibile.
Questo può ritardare brevemente altre scritture. Le chiamate a questa RPC sono
idempotenti anche fra messaggi diversi con la stessa BR. Un altro flusso che
inserisca successivamente senza ricontrollare i duplicati non acquisisce una
garanzia globale di unicità: non sono stati imposti vincoli nuovi ai flussi Bókun.

Test: `tests/viator-email-phase2.test.mjs` usa la route reale e PostgreSQL/WASM
locale, con schema booking ricostruito dai tipi/default reali. Copre chiamate
concorrenti, ricontrolli dopo race simulate, rollback e perdita della risposta.
PGlite esegue le query su una singola connessione: non simula la contesa tra
sessioni di un server PostgreSQL. Non sono stati inviati webhook live o creati
dati di prova su Supabase.
