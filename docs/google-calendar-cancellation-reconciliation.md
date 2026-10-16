# Cancellazioni Google Calendar: preparazione locale, fase 2

Stato: **non applicato**. Nessuna scrittura Supabase, migration remota, modifica
Make, richiesta/replay Google, deployment, commit o push autorizzati in questa fase.

## Decisione e dati conservati

Un unico campo nuovo su `google_calendar_events`,
`cancellation_reconciliation_history jsonb`, contiene un registro append-only:
approvazione, eventuale riapertura, eventuale revoca. Nessuna nuova tabella.
Ogni approvazione ha ID idempotente, autore, motivazione, istante della decisione,
ID operativi e snapshot completi di booking, staging, canonico e alias verificati.
I trigger impediscono sostituzione/rimozione del registro e cancellazione delle
righe che lo conservano. Il registro e gli snapshot sono leggibili solo lato server.

I tre fatti rimangono distinti:

| Fatto | Fonte | Effetto della correzione |
| --- | --- | --- |
| Stato osservato su Google | `gcal_event_status`, verifica e timestamp Google | Nessuna modifica artificiale |
| Annullamento operativo | `bookings.is_cancelled` e dati già registrati | Nessuna scrittura sulle booking o sui pagamenti |
| Decisione approvata | Registro della riconciliazione | Chiude l'avviso, conserva lo storico ed esclude dai conteggi |

Per Kimberly: collegamento **563 → 2051**, riferimento `TOD-T144976349`, canonico
1242, alias verificati 1579/1580. Staging conserva `gcal_cancelled`, note, titolo,
date e timestamp; il canonico conserva `unknown`, verifica falsa, quantità e
campi `historical_*`. Booking 2322 rimane distinta e attiva. Nessuna correzione
su Francesco 2300. Il nome non è una condizione di collegamento: la procedura
richiede riferimento univoco, token esatto e alias UID verificati nello stesso
namespace/occorrenza, rifiutando collegamenti concorrenti o ambigui.

Il riepilogo dell'indagine non contiene snapshot completi, UID, data e presenze
del 1242: **non sono stati inventati**. Le fixture dei test sono sintetiche;
non costituiscono evidenza utilizzabile per la correzione reale.

## Comportamento applicativo

- `google_calendar_import_review` mantiene tutte le righe e aggiunge decisione,
  storico, stato Google effettivamente memorizzato e richiesta di revisione.
  La schermata giornaliera mostra «Cancellazione riconciliata», booking collegata,
  osservazione Google non verificata e audit. Ignora/reset sono disabilitati e
  protetti anche nel database per decisioni attive.
- La dashboard esclude solo gli avvisi riconciliati. Una revisione riaperta è
  visibile anche per date passate e non viene soppressa da corrispondenze di nome.
  Restano i limiti preesistenti della dashboard (origine Make, massimo 200 righe).
- `google_calendar_operational_events` esclude le decisioni approvate/riaperte.
  La dashboard mantiene su questa vista i filtri preesistenti su cancellazioni
  Google, blocchi/test e periodo. Anche la vista di controllo mensile applica
  l'esclusione, mantenendo separati totale storico, stati Google e riconciliazioni.
- Un'osservazione autenticata incompatibile (`confirmed`, `tentative`, cambio
  di titolo/data/ora/calendario) aggiunge una riapertura **prima** dei blocchi
  del planner sulla cronologia legacy. Non cambia la booking. Il relativo
  payload normalizzato resta nell'audit, con timestamp di ricezione della
  decisione separato dal timestamp Google.
- Una cancellazione identica, anche minima o ricevuta più tardi, non riapre.
  Una cancellazione successiva con gli stessi dati è compatibile. Un replay
  del conflitto già registrato non aggiunge duplicati e non chiude la revisione.
  Si scartano osservazioni più vecchie solo quando la cronologia è verificata;
  un timestamp legacy non basta. Conflitti a parità di versione riaprono.
- La riapertura **non reinserisce automaticamente le presenze**: la booking è
  ancora annullata. Serve una nuova decisione esplicita (revoca o nuova
  approvazione con un altro ID e snapshot correnti). Anche ripristino/rimozione
  della booking rende la proiezione da rivedere senza annullare l'audit.
- Errore/assenza della RPC di osservazione su un evento riconciliato: HTTP 503,
  senza procedere alla scrittura staging. Nessuna modifica a Make: prima del
  rilascio verificarne la gestione già configurata dei tentativi successivi.

Il writer confronta anche la revisione del registro durante il compare-and-swap:
dato il vincolo append-only, verifica che l'indice successivo sia assente, senza
trasmettere snapshot completi nell'URL. Riferimento per i filtri JSON:
[PostgREST, Tables and Views](https://docs.postgrest.org/en/v13/references/api/tables_views.html).

## SQL e ordine di rilascio, previa autorizzazione

1. Rivedere `202610120001_google_calendar_cancellation_reconciliation.sql`.
   La migration è transazionale e ripetibile; aggiunge campo, funzioni, trigger e
   viste, senza riconciliare dati. Le funzioni di approvazione/revoca sono
   riservate al proprietario database; il webhook service-role può solo osservare.
   Le viste richiedono PostgreSQL 15+ come lo schema canonico esistente.
   Se la RPC Tuscan è presente, la migration conserva il suo corpo e aggiunge
   esclusivamente il nuovo trigger alla sua policy sugli hook UPDATE; rifiuta
   versioni non riconosciute. I test della RPC Tuscan eseguono anche questa
   migration e verificano che gli aggiornamenti precedentemente consentiti
   continuino a funzionare e che le protezioni preesistenti restino attive.
2. Prima di applicare qualsiasi SQL, ottenere autorizzazione separata. Rileggere
   snapshot completi tramite `to_jsonb(row)` delle tre righe target, dei **tutti**
   gli alias del 1242 ordinati per ID e delle booking 2300/2322. Rivedere eventuali
   trigger/rule UPDATE preesistenti: la procedura rifiuta hook non riconosciuti.
   L'assenza di pagamenti/rimborsi riferita dall'indagine non autorizza interventi
   economici e non viene trasformata in valori zero nella correzione.
3. Compilare localmente `scripts/sql/reconcile-kimberly-2051.sql`: sostituire
   esclusivamente `REVIEWED_SNAPSHOT` e `REVIEWED_APPROVER` con evidenza e autore
   approvati. Struttura dello snapshot:

   ```json
   {
     "booking": "oggetto completo booking 2051",
     "staging": "oggetto completo staging 563, imported_booking_id null",
     "canonical": "oggetto completo canonico 1242, registro vuoto",
     "aliases": ["oggetti completi alias 1579 e 1580, ordinati per ID"],
     "protected_2300": "oggetto completo booking 2300",
     "protected_2322": "oggetto completo booking 2322"
   }
   ```

   Questo esempio descrive la struttura, non è uno snapshot eseguibile. Uno
   snapshot precedente alla migration deve essere riesaminato dopo l'aggiunta
   del solo campo vuoto: non accettare automaticamente altri cambiamenti.
   Non usare SELECT dinamiche dentro la procedura per creare gli *expected*.
4. La procedura fornita termina con `ROLLBACK`: una prova autorizzata non persiste
   cambiamenti. Qualsiasi divergenza abortisce tutto; lock con timeout prevengono
   modifiche concorrenti e nuovi riferimenti/alias. Soltanto dopo approvazione
   esplicita della scrittura utilizzare `COMMIT`. L'identico replay con gli stessi
   snapshot e autore restituisce `unchanged`; uno stato nel frattempo mutato viene
   rifiutato, mai riportato implicitamente a quello approvato.
5. Il codice dipende dalle nuove viste/RPC: installare prima la migration
   autorizzata, poi rilasciare il codice con autorizzazione separata, infine
   eseguire l'eventuale correzione approvata. Non chiudere avvisi con il vecchio
   writer, che non registra riaperture. Nessun replay è necessario per questa
   correzione. In questa fase nessuno di questi passi è stato eseguito.

## Rollback e conteggi

`scripts/sql/rollback-kimberly-2051.sql` richiede snapshot **correnti** e autore,
ha guardie sugli ID e termina con `ROLLBACK`. La revoca compensativa aggiunge un
evento di audit, ripristina soltanto il collegamento precedente dello staging e
disattiva l'esclusione. Non cancella decisioni, non riattiva booking, non modifica
Google o pagamenti. Se lo staging è cambiato dall'approvazione, si ferma: occorre
valutare manualmente gli aggiornamenti prima di un rollback. Un secondo tentativo
identico è idempotente. Dopo una decisione reale non eliminare la colonna per
annullare il rilascio: si perderebbe l'audit. È possibile ripristinare il codice
precedente lasciando schema e audit, ma andrebbe persa la gestione delle riaperture;
richiede pertanto una decisione operativa esplicita.

Effetto atteso, se il 1242 rientra oggi nei filtri delle presenze: **−1 evento**
nel suo mese/anno e **−`effective_total_guests` del 1242** presenze (zero variazione
della somma se NULL). Identica variazione per il cumulato alla data se il giorno
dell'evento rientra nel periodo. Nessuna variazione ai conteggi derivati dalle
booking, agli importi o agli altri canonici. Numero preciso e mese sono un blocco
di verifica dello snapshot, non una stima dal nome. Storico totale e numero di
Google `unknown` restano invariati; le cancellazioni Google non aumentano.

## Verifica locale riproducibile

I test SQL usano PGlite 0.5.8 già disponibile localmente, senza rete o credenziali.
Su una macchina priva del motore, i test SQL vengono segnalati come saltati:
per il rilascio devono essere eseguiti, non saltati. Installazione isolata possibile
con `npm install --prefix .tmp/bokun-sql --no-save --package-lock=false @electric-sql/pglite@0.5.8`.

```powershell
$env:GCAL_TEST_PGLITE_MODULE = (Resolve-Path '.tmp/bokun-sql/node_modules/@electric-sql/pglite/dist/index.js').Path
$env:VIATOR_TEST_PGLITE_MODULE = $env:GCAL_TEST_PGLITE_MODULE
$env:PGLITE_TEST_MODULE = $env:GCAL_TEST_PGLITE_MODULE
node --test tests/google-calendar-cancellation-reconciliation.test.mjs tests/google-calendar-cancellation-ui.test.mjs tests/google-calendar-canonical-sync.test.mjs
npm test -- --test-concurrency=2
npx tsc --noEmit --incremental false
npx eslint app/page.tsx app/import/google-calendar/page.tsx app/api/webhooks/google-calendar/route.ts lib/google-calendar-canonical-sync.mjs tests/google-calendar-cancellation-reconciliation.test.mjs tests/google-calendar-cancellation-ui.test.mjs tests/google-calendar-canonical-sync.test.mjs tests/dashboard-agenda.test.mjs
npm run build
git diff --check
```

Da verificare manualmente dopo un futuro rilascio autorizzato: schermata giornaliera
su desktop/mobile, avviso chiuso e storico visibile, collegamento esclusivamente
alla 2051, conteggi del mese corretto, RPC e permessi PostgREST/schema cache.
I test di rendering sono locali: non equivalgono a una prova browser in produzione.

## Compatibilit? Tuscan verificata localmente

La correzione storica di ottobre riconosce esclusivamente il trigger audit BEFORE ROW
UPDATE tramite tabella, nome, funzione, tipo e assenza di argomenti/condizioni.
Il trigger resta attivo. Gli snapshot precedenti alla colonna audit richiedono
ora esplicitamente un registro vuoto: uno storico gi? presente blocca la riparazione.
La stessa identificazione stretta protegge le eccezioni della RPC Tuscan e
della procedura di approvazione Kimberly; il solo nome non ? sufficiente.
I test PGlite verificano hook sconosciuti, funzioni sostituite e nomi su tabelle
diverse, atomicit?, idempotenza e conservazione dei dati economici.
Il generatore offline e lo script SQL storico restano identici.
