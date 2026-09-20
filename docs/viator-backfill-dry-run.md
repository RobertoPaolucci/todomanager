# Viator: preparazione, non applicazione

La migration `202609200001_booking_total_source.sql` e il webhook sono preparati,
non applicati/deployati. Applicare la migration prima di distribuire il webhook:
senza colonna, le scritture Viator del nuovo codice fallirebbero.

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

Supabase viene interrogato esclusivamente con GET; due letture consecutive devono
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

## Verifiche

`node --test tests/bokun-import.test.mjs tests/viator-backfill.test.mjs` testa
webhook e preparazione senza database remoto. Il test SQL usa esclusivamente
PGlite in memoria quando `PGLITE_TEST_MODULE` indica il modulo locale installato.
