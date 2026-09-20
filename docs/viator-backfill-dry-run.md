# Viator: dry-run ed esecuzione controllata

La migration `202609200001_booking_total_source.sql` deve precedere il webhook:
senza colonna, le scritture Viator del nuovo codice fallirebbero.
Il 20 settembre 2026 l'operatore ha confermato migration applicata e deployment
Production del commit `8b358b2bcfd7a049364140ea92d4a8b8afeb2eeb`.

`total_to_you_source` e nullable, senza default. Valori consentiti:
`configured_price`, `bokun_webhook`, `bokun_api_backfill`. Nessuna etichetta viene
dedotta per le righe esistenti. Il webhook scrive la fonte solo per Viator;
cancellazioni e altri canali conservano il comportamento precedente.
La provenienza viene confrontata anche quando l'importo non cambia.
Questa modifica non aggiunge tracciamento agli altri percorsi di modifica manuale/import CSV.

## Dry-run

```powershell
node scripts/prepare-viator-backfill.mjs --audit-dir "$env:TEMP\todomanager-viator-full-audit-20260920" --output "$env:TEMP\viator-backfill-dry-run.json"
```

Lo script accetta soltanto i file AUTO_FIX, REVIEW e snapshot gia verificati
(SHA-256 fissati nel codice). Esclude le 17 righe gia corrette; considera soltanto
le 246 con importo diverso e controlla che nessun ID sia presente nelle 153 REVIEW.

Lo script `prepare-viator-backfill.mjs` interroga Supabase esclusivamente con GET; due letture consecutive devono
coincidere. Non esiste modalita apply e nessun SQL viene eseguito. Il report nuovo
non puo sovrascrivere un file esistente. Non contiene credenziali o contatti cliente.

PASS richiede ID, riferimento, importi esatti, stato attivo, canale/business unit,
prodotto, data e partecipanti coerenti con l'audit. Una variazione del costo
fornitore o del margine causa SKIP, per non cambiare implicitamente la base della
simulazione. Nessun valore viene arrotondato per far passare il controllo.
Si verificano anche riferimenti Bókun gia occupati (incluse righe cancellate) e
riferimenti Viator attivi condivisi. Solo un riferimento Bókun attualmente NULL
viene proposto per popolamento; un riferimento diverso causa SKIP.

Ogni PASS propone soltanto `total_to_you`, `margin_total`, `total_to_you_source`
e, se NULL, `bokun_booking_reference`. Le righe SKIPPED hanno motivi espliciti e
nessuna proposta. Costi fornitore, partecipanti, esperienza, data e cancellazione
non vengono mai proposti per modifica.

PASS fotografa il momento della lettura, non autorizza l'esecuzione futura:
gli stessi controlli dovranno essere ripetuti atomicamente prima di un eventuale
UPDATE futuro. Questo script non esegue tale fase e non richiama Bókun.

## Esecuzione esplicita

L'esecuzione del 20 settembre 2026 e conclusa e verificata: 246 aggiornate,
0 SKIPPED, entrate da 35.485,20 a 35.749,22 EUR, margine da 10.710,00 a
10.974,02 EUR, 235 riferimenti aggiunti e 246 fonti `bokun_api_backfill`.
Le 17 righe gia corrette, le 153 REVIEW e i costi fornitore sono invariati.
Snapshot, journal e report restano nella directory locale
`todomanager-viator-full-audit-20260920/execution-20260920`, fuori dal repository.
Questo backfill non deve essere rieseguito; mantenere il lock di esecuzione.

Solo dopo autorizzazione dell'operatore:

```powershell
node scripts/execute-viator-backfill.mjs --execute --audit-dir "$env:TEMP\todomanager-viator-full-audit-20260920" --output-dir "$env:TEMP\todomanager-viator-full-audit-20260920\execution-NEW"
```

Riutilizza gli input verificati per SHA-256 e tutti i controlli del dry-run.
Prima di scrivere salva `before.json` con tutte le colonne originali delle righe
interessate e delle 170 escluse, oltre alle impronte delle altre prenotazioni.
Un lock persistente nella directory audit impedisce la ripetizione automatica.

Per ogni candidata rilegge riga, prodotto e possibili riferimenti duplicati;
qualunque variazione rispetto allo snapshot causa SKIP. L'UPDATE usa un PATCH
con ID e condizioni su importi, identita, stato, partecipanti e `updated_at`.
Se una condizione non coincide piu, nessuna riga viene aggiornata.
Sono richieste sequenziali, ciascuna atomica: non una transazione unica di 246 righe.
La ricerca dei duplicati e del mapping prodotto precede il PATCH; i controlli
sulla riga stessa sono anche condizioni dell'UPDATE.

Il journal viene sincronizzato su disco prima e dopo ogni PATCH. Non vengono
eseguiti retry delle scritture. Errori HTTP/rete o verifiche inattese interrompono
il resto del lavoro senza rollback o correzioni automatiche. Un esito incerto
richiede ispezione del journal e lettura del database prima di ogni altra azione.
`result.json` confronta tutte le colonne delle righe protette, importi e costi.
Il campo `updated_at` delle righe aggiornate puo essere gestito da trigger gia
esistenti, ma non viene impostato dallo script. Nessun dato cliente o segreto
viene stampato nei log; gli snapshot locali contengono i valori originali.

## Verifiche

`node --test tests/bokun-import.test.mjs tests/viator-backfill.test.mjs tests/viator-backfill-execution.test.mjs`
testa webhook, preparazione ed esecuzione simulata senza database remoto. Il test SQL usa esclusivamente
PGlite in memoria quando `PGLITE_TEST_MODULE` indica il modulo locale installato.
