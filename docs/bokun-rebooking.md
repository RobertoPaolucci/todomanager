# Bókun / GetYourGuide: identità e rebooking

## Evidenze e limiti dell'analisi

Lettura Supabase del 6 settembre 2026, senza scritture: per i cinque riferimenti
del caso è presente soltanto `bookings.id = 1999`, con `booking_reference =
GYGBLHFXQZ7B`, data `2026-10-24`, ora `10:00`, `is_cancelled = true`,
`channel_id = 1`, `booking_source = Direct`, `experience_id = 1`.
La riga risulta creata il 26 agosto 2026. La tabella canali conferma
`1 = Direct`, `3 = GetYourGuide`. Lo schema OpenAPI non espone una colonna
per il Booking ref Bókun e NON consente di certificare gli indici UNIQUE,
i trigger e le loro dipendenze.

Nel repository:

- `app/api/webhooks/prenotazioni/route.ts`: riceve JSON già normalizzato.
  Non analizza email né un payload Bókun annidato completo. L'automazione
  a monte deve trasferire esplicitamente i riferimenti. Non è presente qui
  un parser di email Bókun o la configurazione dello scenario esterno.
- Prima della correzione, `incomingBookingReferences` elencava nell'ordine
  `externalBookingReference`, `external_booking_reference`, `booking_reference`,
  `productConfirmationCode`, `product_confirmation_code`. Il primo riferimento
  non vuoto diventava `booking_reference` sui nuovi inserimenti.
- `findExistingBooking` / `getLatestBookingByReference` cercavano per quel campo,
  scegliendo la riga con ID maggiore. Per modifiche/cancellazioni esisteva anche
  un fallback euristico su data, esperienza, cliente, canale e persone.
- Il webhook NON eseguiva un upsert: faceva SELECT, poi UPDATE per `id` oppure
  INSERT. CONFIRMED con riferimento già presente aggiornava la stessa riga,
  anche riattivandola; MODIFIED/CANCELLED senza match erano saltati; una
  cancellazione preservava gli importi. I prezzi mancanti bloccavano la conferma.
- `app/prenotazioni/import/page.tsx` legge Excel/CSV con SheetJS;
  `app/prenotazioni/import/actions.ts` sceglieva l'Ext. booking ref per i cart
  non TOD, faceva INSERT e contava **qualsiasi 23505** come duplicato saltato.
  Quindi un vincolo UNIQUE sul riferimento esterno può scartare la seconda riga.
  La presenza e il nome di tale vincolo nel DB live restano da verificare.
- L'import Excel usava `Booking channel`: con `Direct` sceglieva il canale 1
  anche quando Ext. booking ref iniziava con GYG. Il webhook attuale e la versione
  Git del 24 agosto riconoscono invece GYG prima di `channel_id`: il dato Direct
  non dimostra che la riga sia stata creata dal webhook in quella versione.
- Anche elenco, dashboard, calendario e fatturazione raggruppavano per il solo
  riferimento esterno: due righe distinte sarebbero state trattate come versioni.

**Causa tecnica accertata:** identità esterna OTA confusa con identità Bókun.
**Causa puntuale dello scarto GET-103074524 non certificata:** servono il payload
effettivamente ricevuto, la risposta HTTP/log dello scenario e il preflight SQL.
Non è corretto affermare che quel CONFIRMED sia stato sicuramente scartato dal
webhook: con i dati dichiarati il vecchio handler avrebbe aggiornato la riga.

## Contratto e comportamento nuovo

`booking_reference` mantiene il suo uso commerciale, compreso il riferimento GYG.
La nuova colonna nullable `bokun_booking_reference` contiene il riferimento
booking/cart Bókun, NON `bokun_id` (che identifica l'esperienza), il product code
TOD-T... o il GET... citato nella nota "rebooked from".

L'automazione deve inviare, oltre ai campi completi già utilizzati:

```json
{
  "bokun_booking_reference": "GET-103074524",
  "externalBookingReference": "GYGBLHFXQZ7B",
  "productConfirmationCode": "TOD-T145243238",
  "status": "CONFIRMED",
  "booking_date": "2026-10-24",
  "booking_time": "17:00",
  "channel_id": 3,
  "booking_source": "GetYourGuide"
}
```

Questo è un frammento del contratto, NON un payload da inviare da solo: conservare
`bokun_id`, cliente, partecipanti e tutti gli altri dati della conferma originale.
Non inventare prezzi o partecipanti per recuperare la prenotazione.
Gli alias espliciti accettati sono elencati in `getBokunBookingReference`.
Per Excel sono supportati `Cart confirmation code`, `Booking ref` e
`Bókun Booking ref`. Per un recupero Bókun usare l'export Bókun, non quello GYG
che contiene soltanto il riferimento esterno.

| Evento | Comportamento |
| --- | --- |
| CONFIRMED, nuovo Booking ref | Inserisce una nuova riga, anche se GYG è condiviso con un altro Booking ref già identificato. |
| Stesso evento ripetuto | Aggiorna solo se cambia qualcosa; altrimenti `unchanged`. |
| Consegne simultanee | L'indice UNIQUE Bókun impedisce duplicati; un conflitto restituisce HTTP 409, da ritentare. |
| MODIFIED (action o status) | Aggiorna soltanto il Booking ref corrispondente. |
| CANCELLED | Cancella soltanto il Booking ref corrispondente, senza cambiare gli importi. |
| MODIFIED/CANCELLED Bókun senza originale | HTTP 409, `skipped: true`; recuperare prima la conferma corretta. |
| GYG senza Booking ref Bókun | HTTP 409 esplicito, nessun abbinamento per il solo GYG. |
| Riferimento esterno presente su righe legacy senza identità | HTTP 409 con ID da riconciliare; niente associazioni automatiche. |
| CSV Bókun | Inserisce cart nuovi; per cart già presenti mantiene il comportamento storico di sola importazione, senza sovrascriverli. |

Il matching euristico resta disponibile per gli altri flussi legacy, ma esclude
le righe con identità Bókun. I mapping di Viator, TodoInTheWorld, Freedome e FMDQ
restano invariati. Il prefisso GYG identifica GetYourGuide anche nel CSV.
L'import ora passa anche la business unit già configurata sull'esperienza:
la colonna è obbligatoria nello schema live e non veniva inviata dal CSV.
Non cambia la configurazione delle business unit.

La chiave Bókun è univoca per booking/cart nel modello attuale: un evento per
un'altra esperienza sullo stesso cart viene segnalato, non sovrascrive la riga.
I cart con più prodotti richiedono una verifica dedicata del contratto a monte;
non sono trasformati automaticamente in una nuova struttura multiprodotto.

La ricerca nell'elenco trova sia GYG sia Booking ref Bókun; desktop e mobile
mostrano entrambi. Dashboard, calendario e fatturazione mantengono le identità
distinte. La riconciliazione pagamenti continua a cercare GYG, esclude i
predecessori Bókun cancellati e si ferma se trova due cart identificati attivi
con lo stesso riferimento, evitando di marcarli entrambi come pagati.
Parsing e mapping Google Calendar non sono stati modificati; lo staging GCal
non è la via da usare per recuperare questo rebooking Bókun.

## Migration e attivazione

File: `supabase/migrations/202609060001_bokun_booking_identity.sql`.
**Preparata e testata localmente, non applicata a Supabase.**

1. Eseguire in sola lettura `supabase/diagnostics/bokun-preflight.sql` e verificare
   indici, constraint, foreign key e trigger: nessun automatismo deve continuare
   a deduplicare/cancellare le nuove righe per il solo GYG.
2. Sospendere/accodare le consegne dell'automazione durante l'attivazione.
3. Dopo approvazione del risultato del preflight, applicare la migration e
   distribuire il codice insieme al nuovo campo nell'automazione. Il codice
   aggiornato richiede la colonna; non distribuirlo sul vecchio schema.
4. Configurare la gestione degli errori dello scenario affinché 409/500 restino
   visibili e ritentabili; non considerarli importazioni riuscite.
5. Riconciliare esplicitamente soltanto le righe legacy documentate, quindi
   riprocessare gli eventi accodati. Non è previsto alcun backfill massivo.

La migration aggiunge la colonna senza assegnarla alle righe esistenti, crea
UNIQUE sul Booking ref e limita eventuali UNIQUE semplici su booking_reference
alle righe legacy (`bokun_booking_reference IS NULL`). Mantiene nome e definizione
dell'indice preesistente. Non inventa un vincolo legacy se prima non esisteva.
Con indici composti, parziali, espressioni non supportate o dipendenze FK,
la transazione si ferma senza CASCADE; il preflight va riesaminato.
La conversione da constraint a indice parziale va verificata anche rispetto a
integrazioni esterne che usino `ON CONFLICT (booking_reference)`.
Riferimento: [indici parziali PostgreSQL](https://www.postgresql.org/docs/current/indexes-partial.html).

## Recupero del caso reale, solo dopo approvazione

`supabase/diagnostics/bokun-jake-recovery-preview.sql` prepara una modifica
circoscritta alla riga 1999: assegna `GET-101955189` e corregge `channel_id = 3`,
`booking_source = GetYourGuide`. Mantiene GYG, cancellazione, data/ora e importi.
Verifica i valori prima dell'UPDATE e termina con ROLLBACK. Non è stato eseguito.
Non basta applicare la migration: la riga legacy deve prima essere identificata.

Dopo verifica documentale e autorizzazione, applicare quell'intervento mirato
con COMMIT. Poi reinviare il payload CONFIRMED completo di GET-103074524 oppure
importare un export Bókun contenente **soltanto quella nuova riga** con Cart
confirmation code GET-103074524 e Start date 2026-10-24 17:00.
Verificare prezzi canale per esperienza 1 / canale 3 e business unit configurata.
Non riattivare la riga 1999 per simulare il rebooking.

Risultato atteso:

| Booking Bókun | Riferimento GYG | Ora | Stato |
| --- | --- | --- | --- |
| GET-101955189 | GYGBLHFXQZ7B | 10:00 | cancellata |
| GET-103074524 | GYGBLHFXQZ7B | 17:00 | confermata |

## Verifica riproducibile

`node --test tests/bokun-import.test.mjs` esegue route e Server Actions reali,
con I/O Supabase e Next simulato; non usa dati live o credenziali.
Risultato finale: 25 regressioni applicative e 7 regressioni SQL superate.

Per verificare SQL in un PostgreSQL isolato in memoria, senza aggiungere
dipendenze all'applicazione:

```powershell
npm install --prefix .tmp/bokun-sql --no-save --package-lock=false @electric-sql/pglite
node --test tests/bokun-migration.test.mjs
```

Verificati anche TypeScript (`--noEmit --incremental false`), diff e ESLint
mirato confrontato con HEAD. I file esistenti hanno segnalazioni pregresse
(`no-explicit-any`, `static-components`, `no-unused-vars`), non corrette fuori
ambito. `npm run build` non eseguito secondo il flusso locale di AGENTS.md;
nessun commit, push, deploy o test di scrittura sul DB reale.

## File interessati

- `lib/bokun-booking-identity.ts`: parsing e matching dell'identità, chiave storico.
- `app/api/webhooks/prenotazioni/route.ts`: gestione eventi e isolamento matching.
- `app/prenotazioni/import/actions.ts`: identità CSV, canale GYG, errori UNIQUE.
- `app/prenotazioni/riconciliazione/actions.ts`: selezione pagamento nel rebooking.
- `app/prenotazioni/page.tsx`, `components/MobileBookingCard.tsx`: riferimenti e ricerca.
- `app/page.tsx`, `app/calendario-fattoria/page.tsx`: conteggi per identità Bókun.
- `app/fatturazione-fmdq/page.tsx`, `app/fatturazione-fmdq/pdf/route.ts`,
  `app/fatturazione-fmdq/pdf-riepilogo/route.ts`: raggruppamento per identità Bókun.
- `supabase/migrations/202609060001_bokun_booking_identity.sql`: schema preparato.
- `supabase/diagnostics/bokun-preflight.sql`,
  `supabase/diagnostics/bokun-jake-recovery-preview.sql`: verifiche e recupero preparato.
- `scripts/audit-bokun-readonly.cjs`: diagnostica live limitata e senza scritture.
- `tests/bokun-import.test.mjs`, `tests/bokun-migration.test.mjs`: regressioni.
- `docs/bokun-rebooking.md`: analisi, limiti, attivazione e recupero.
- `.gitignore`: esclude le dipendenze temporanee dei soli test SQL.
