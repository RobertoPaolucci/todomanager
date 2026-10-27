# Viator FMDQ e Google Calendar — Anita Dreise

Preparazione locale su `main`, 27 ottobre 2026. Nessuna scrittura in produzione,
nessun replay, modifica di variabili d'ambiente, commit, push o deploy.
Le verifiche remote sono state esclusivamente SELECT.

## Causa verificata

Il titolo `1 e-bike noleggio 1460201663 Anita Dreise` non contiene `Viator` o
`VIA-…`: il parser Google esistente sceglie il fallback FMDQ (canale 6).
Il numero senza prefisso non è un riferimento riconosciuto dal parser: genera
il riferimento GCAL e non estrae il nome. L'importazione manuale usa quindi
il listino FMDQ, creando 2402 e collegandolo allo staging 716.

L'email 61 era già arrivata: `processing_requested=true`,
`classification.reason=exact_product_mapping_missing`, `status=needs_mapping`,
`booking_id=NULL`. `processing_mode=dry_run` è il valore iniziale memorizzato
quando non si entra nella RPC di creazione; **non era il flag di scrittura
disabilitato**. Il motivo `phase_1_historical_transition_pending` era una
costante fuorviante. Le email successive idonee entrano in `create_confirmed`.
Ora il motivo di blocco registra la classificazione effettiva oppure
`processing_disabled`. Nessun flag è stato cambiato.

La deduplicazione email cercava solo `BR-…` e la variante numerica nella
colonna `bookings.booking_reference`: non vedeva un numero nel titolo Google.
Inoltre una riconsegna di un'email terminale `needs_mapping` non la rielabora:
aggiungere il mapping non autorizza né avvia automaticamente un replay.

## Correzione preparata

`scripts/sql/reconcile-viator-anita-2402.sql` prepara insieme:

- mapping BU 1, `200401P11 / TG1`, esperienza 15, attivo, **default_time NULL**;
- cambio di cliente a Anita Dreise, canale 2, sorgente Viator e riferimento
  commerciale `BR-1460201663`, conservando l'ID 2402;
- allineamento dell'identità nello staging 716, senza cambiare UID, titolo,
  orario, data, partecipanti, link o cronologia Google;
- collegamento dell'email 61 e audit dei record prima/dopo nel suo
  `parsed_data.google_reconciliation`, preservando corpo, payload, parsing,
  motivo iniziale e modalità storica nell'istantanea precedente;
- riferimento GCAL originale anche nelle note della prenotazione;
- stato email `needs_review` e `economics_pending=true`: nessun importo viene
  silenziosamente reinterpretato come prezzo Viator.

BU 1, esperienza 15, 28/10/2026, 09:30, un adulto, supplier 3 e pagamenti
restano invariati. Le 09:30 sono verificate contro staging ed evento canonico,
non diventano una regola del prodotto. Nessun riferimento Bókun viene creato;
il `bokun_id` eventualmente presente sull'esperienza non viene consultato.

L'evento canonico **1363** non è scritto. Resta `observed_total_guests=1`,
`effective_total_guests=0`, `exclusion_reason=offsite_rental_only`: il noleggio
esterno non deve aumentare le presenze in fattoria. Alias e storico delle
cancellazioni restano invariati.

La funzione transazionale richiede istantanee complete e attuali dei quattro
record. Verifica identità, mapping attivo, BU, data, orario, partecipanti,
stato Google verificato e assenza di altri candidati. Rifiuta prenotazioni
pagate, cancellate, modificate, accordi manuali, fatture del mese, riferimenti
Bókun, email discordanti e hook UPDATE sconosciuti. Non esegue INSERT bookings.
Il replay della stessa correzione è un no-op. Un cambiamento successivo impone
una nuova revisione, non sovrascrive dati.

## Economia: dati certi e decisioni aperte

| Dato | Evidenza e trattamento |
| --- | --- |
| Pagato dal cliente | Sconosciuto. Né 65 né 50,70 costituiscono prova. |
| Netto Viator | **50,70 EUR**, totale prenotazione, certificato dall'email; la convenzione email lo assegna a `total_to_you`. Non prova che sia stato incassato. |
| Ricavo FMDQ | Per il flusso diretto BU 1 il netto dovuto da Viator è 50,70. Non va confuso con il listino `your_unit_price=60` né con un trasferimento tramite Bókun. |
| Prezzo pubblico configurato Viator | **0**, da `experience_channel_prices` id 158. Il webhook esistente lo copierebbe in `public_unit_price`, `total_customer`, `total_amount`. Non è evidenza di vendita gratuita. |
| Costo fornitore configurato | **60**, sia sul listino Viator sia sull'esperienza, supplier 3. Occorre confermare se è il costo/allocazione corretto per questo noleggio FMDQ. |
| Margine con le regole attuali | **-9,30 = 50,70 - 60**. Non azzerarlo né sostituire il costo con il netto senza una decisione esplicita. |

Proposta economica condizionata: `total_to_you=50.70`; costo totale 60 e
`margin_total=-9.30` soltanto dopo conferma del costo; prezzo pubblico e
`total_customer/total_amount` soltanto dopo conferma del pagato oppure
approvazione esplicita della convenzione “0 = non disponibile”. La procedura
non applica questa proposta. Mantiene i valori storici 65/60/60/0, marcati
come da verificare: **non considerarli importi Viator validati**.

Discrepanza preesistente rilevata: il report fornitori per esperienze a persona
calcola il ricavo da `your_unit_price × adulti` (e tariffa bambini), mentre il
webhook email mette il netto in `total_to_you` mantenendo `your_unit_price` di
listino. Con le regole attuali mostrerebbe 60 anche dopo un aggiornamento del
solo totale a 50,70. Non è stata modificata questa logica generale. Prima di
chiudere la parte economica occorre decidere anche come rappresentare il netto
email nei report; non impostare un accordo manuale o una provenienza Bókun per
aggirare il problema. `total_to_you_source` resta NULL, come nelle altre email.

Il report costi usa `total_supplier_cost` se presente. La fatturazione mensile
FMDQ include solo canali con `fattura_mensile_fmdq=true`: sia 2 sia 6 risultano
false, e non risultavano fatture di ottobre per questi due canali. Nessuna
fattura o stato pagamento viene modificato. I controlli vengono ripetuti nella
transazione per non assumere che queste condizioni restino vere.

## Prevenzione e limiti intenzionali

Il webhook email cerca il numero completo nel titolo degli staging dei canali
2/6, anche su date diverse per non perdere possibili spostamenti. Un match è
**da riconciliare**, non autorizza un'associazione automatica. Un nome da solo,
un prefisso/suffisso numerico o un codice alfanumerico diverso non fanno match.
Errori o risultati oltre il limite chiudono il percorso di creazione.

L'importazione Google verifica l'evidenza email/Viator prima della creazione,
anche con “forza importazione”. Un trigger INSERT è la protezione finale contro
letture precedenti e race: blocca sia un nuovo Viator con staging corrispondente,
sia un GCAL per cui esiste evidenza Viator. Riconosce l'alias GCAL originale
anche dopo il cambio del riferimento nello staging. Non interpreta un numero
senza evidenza email/prenotazione Viator come un canale verificato.

L'associazione e il cambio identità avvengono tramite la RPC revisionata e gli
script, **non tramite auto-merge o una nuova UI**. In particolare staging non
ancora importati ma con evidenza email restano in revisione: nessun fallback
crea una prenotazione per aggirare il blocco. Questa scelta evita anche di
inventare prezzi/orari durante l'associazione.

I successivi webhook Google preservano una precedente identità Viator FMDQ
verificata sullo stesso UID. Cambi di data, ora, partecipanti o titolo richiedono
revisione e conservano il link. Le scritture staging usano confronto sul record
letto per non sovrascrivere una riconciliazione concorrente. Reset/ignora non
azzerano i link; l'import non crea nuovamente le righe Viator già collegate.

Il trigger esce immediatamente per BU 2 o per riferimenti Bókun. Non sono stati
modificati parser, webhook o regole Viator → Bókun di ToDoInTheWorld. Il lock
breve su bookings può comunque ritardare altre scritture: timeout 5 secondi,
errore chiuso e nuovo tentativo, mai un INSERT alternativo.

## Applicazione futura e rollback

Tutto richiede autorizzazione separata per la produzione:

1. Verificare la migration e autorizzarne l'installazione; pubblicare i caller
   solo dopo le funzioni DB. Nessuna configurazione va abilitata globalmente.
2. Rileggere i dati e rieseguire la prova della correzione: lo script termina
   intenzionalmente con **ROLLBACK**. Il mapping è idempotente; eventuali valori
   già presenti ma discordanti provocano errore, non vengono sovrascritti.
3. Autorizzare specificamente la correzione dell'identità e sostituire l'ultimo
   ROLLBACK con COMMIT soltanto nella copia approvata. Esportare l'audit in una
   destinazione riservata. Nessun replay dell'email è necessario.
4. Verificare prenotazione, storico import, replay Google, report e invarianti
   delle presenze. Tenere l'economia aperta fino alle decisioni sopra elencate.

`rollback-viator-anita-2402.sql` ripristina i soli campi cambiati, verificando
che non vi siano successive modifiche, email collegate o fatture. Conserva
l'audit della revoca nell'email; non elimina la prenotazione o l'evento. Il
mapping corretto viene mantenuto, essendo indipendente dalla riconciliazione.
Anche questo script termina con ROLLBACK. Un secondo rollback senza audit
attivo è rifiutato, senza scritture.

`rollback-viator-google-schema.sql` rimuove solo le nuove funzioni e il trigger,
senza cancellare gli audit. Ripristinare prima i caller applicativi; la rimozione
della protezione riapre il rischio originario. Non disinstallare le precedenti
migration Viator/Google.

## Verifica locale

I test estendono la route reale, il parser e l'adapter SQL dei test Viator
esistenti. PostgreSQL/WASM PGlite esegue migration e script in memoria, senza
accesso a Supabase. Coperti mapping senza default, caso 2402/716/1363,
conservazione di ogni campo economico, RPC idempotente, rollback, fallimento
atomico del link, aggiornamenti concorrenti simulati, duplicati numerici/BR,
BU2/Bókun esclusi, prezzi concordati, fatture, cancellazioni e privilegi.
Sono installati anche i trigger reali di cancellazione e dashboard per verificare
la compatibilità. PGlite usa una connessione: non simula contesa fra vere
sessioni PostgreSQL; questa verifica resta necessaria prima della pubblicazione.

Comandi PowerShell (nessuna lettura di `.env` nei test):

```powershell
$env:VIATOR_TEST_PGLITE_MODULE=(Resolve-Path '.tmp/bokun-sql/node_modules/@electric-sql/pglite/dist/index.js').Path
$env:GCAL_TEST_PGLITE_MODULE=$env:VIATOR_TEST_PGLITE_MODULE
$env:PGLITE_TEST_MODULE=$env:VIATOR_TEST_PGLITE_MODULE
node --test --test-concurrency=4
npx tsc --noEmit --incremental false
```

`npm run build` non eseguito: sviluppo locale, nessuna chiusura/commit o
richiesta esplicita di build, secondo AGENTS.md.

Esito finale: **637 test superati, 0 falliti, 0 saltati**; TypeScript superato;
`git diff --check` superato. ESLint superato su tutti gli altri file modificati;
il webhook Google presenta 7 errori `no-explicit-any` preesistenti, verificati
eseguendo lo stesso controllo sulla versione `HEAD` del file. Nessuno introdotto
da questa modifica. Nessun server dev avviato o arrestato.

## File della modifica

| File | Intervento |
| --- | --- |
| `lib/viator-email-imports.ts` | Ricerca candidati Google, motivi dry-run, risposta al replay riconciliato. |
| `lib/google-calendar-booking-link.mjs` | Conservazione dell'identità Viator già verificata. |
| `app/api/webhooks/google-calendar/route.ts` | Integrazione del link, confronto ottimistico e risposta con canale risolto. |
| `app/import/google-calendar/actions.ts` | Blocco della reimportazione e controllo dell'evidenza Viator. |
| `supabase/migrations/20261027174815_viator_google_reconciliation.sql` | Funzioni di verifica, guardia INSERT e RPC di riconciliazione revisionata. |
| `scripts/sql/reconcile-viator-anita-2402.sql` | Mapping e correzione identità, con ROLLBACK predefinito. |
| `scripts/sql/rollback-viator-anita-2402.sql` | Rollback dei dati con conservazione audit. |
| `scripts/sql/rollback-viator-google-schema.sql` | Rollback delle sole nuove funzioni/trigger. |
| `tests/viator-email.test.mjs` | Classificazione, normalizzazione e diagnosi modalità. |
| `tests/viator-email-phase2.test.mjs` | PostgreSQL isolato, script reali, invarianti e casi avversi. |
| `tests/google-calendar-booking-link.test.mjs` | Identità e incompatibilità delle osservazioni. |
| `tests/google-calendar-tuscan-escape.test.mjs` | Route/Server Action reali, replay Viator e blocco della forzatura. |
| `docs/viator-google-fmdq-reconciliation.md` | Evidenze, decisioni economiche, procedura e limiti. |
