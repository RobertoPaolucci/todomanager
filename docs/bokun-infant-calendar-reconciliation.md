# Bókun: infant e riconciliazione Calendar

## Evidenze e limiti (1 novembre 2026)

Indagine sul codice e SELECT di produzione, senza scritture. Confermati:

- 2415: BU 1, canale 6, esperienza 7, cart `TOD-108037806`, data 23/11,
  adulti 3, bambini 0, infant 0, totale persone 3, ricavo 114, lordo 135,
  costo fornitore 114. Nessun accordo o snapshot a fasce.
- 2419: stessi BU/canale/esperienza, data 24/11, adulti 2, infant 1,
  ricavo/costo 76 e lordo 90. Staging 724 collegato a questa riga.
- Canonical 1373 conserva titolo con `T151827070`, data 24/11,
  stato Google confirmed, presenze 3. Nessun historical_booking_id/staging_id
  e cronologia riconciliazioni cancellazione vuota.
- Non risultano altri staging collegati alle due booking, collegamenti storici
  canonical/alias, import Viator collegati o fattura novembre emessa sul canale 6.
  Queste verifiche vanno ripetute prima di una correzione autorizzata.
- Lo schema live non ha una colonna dedicata al riferimento item.
  I riferimenti staging/historical sono anche collegamenti applicativi:
  l'assenza di foreign key NON autorizza a cancellare la riga.

### Infant: causa locale accertata, origine del dato ancora da certificare

Il webhook `prenotazioni` riceve un **contratto JSON normalizzato**, non interpreta
automaticamente il payload nativo Bókun. Legge soltanto `adults`, `children`,
`infants`; se una categoria manca conserva il valore precedente o usa zero.
Il calcolo già esistente moltiplica prezzi e costi per adulti/bambini, non per
infant. Anche selezione delle fasce e prezzo concordato escludono gli infant.
Con input `2/0/1` il codice produce 76/90 e tre presenze; con input `3/0/0`
produce 114/135. Il dato in produzione da solo non prova quale body sia arrivato.

`import_logs` contiene contatori/errori, non il body originale. Non abbiamo il
log Make, il payload della consegna del 31 ottobre né la configurazione dello
scenario. Non è quindi accertato se l'errore sia nella trasformazione Make,
in un campo/categoria omesso o in una consegna successiva. **La correzione
definitiva della classificazione infant resta subordinata a questa evidenza.**
Nessuna sottrazione euristica di infant dagli adulti è stata introdotta.

La documentazione ufficiale distingue le notifiche native, che possono contenere
soltanto bookingId/experienceBookingId, dai dettagli della prenotazione e dal
`productConfirmationCode`:

- [Bókun Webhook Events](https://bokun.dev/webhooks/g3YWZ24sADsceKK5vqrMzZ/webhook-events/migR39DGTnTr3qaRryEr7k)
- [Bókun Checkout](https://bokun.dev/booking-api-rest/vU6sCfxwYdJWd1QAcLt12i/checkout/qfxwephtAWaRgPt22kpyLF)

`TOD-T151827070` è il riferimento prodotto dichiarato nel caso verificato
dall'utente, coerente con il product booking confirmation code, non con
`experiences.bokun_id`. Non possiamo certificare che fosse presente nel body
effettivamente ricevuto. Il numero `151827070` non viene interpretato come
catalogue ID né come experienceBookingId opaco.

### Duplicato Calendar: causa accertata

L'estrazione commerciale di Calendar non riconosce il codice breve `T...`:
usa il fallback `GCAL-<uid>`. L'import cerca quel booking_reference e poi
un possibile duplicato sulla stessa data e con stessi conteggi e nome.
Nel caso reale differiscono data, conteggi infant/adulti e nome completo.
Il webhook Bókun scarta il riferimento TOD-T dal riferimento commerciale per
il canale 6; non esisteva una persistenza dedicata per riconciliarlo.
Il doppione è pertanto compatibile con tutti i controlli precedenti.
Il 24 novembre è un dato errato nell'evento; nessuna conversione data è cambiata.

## Correzione locale

- Validazione dei conteggi normalizzati come interi non negativi; controllo
  facoltativo `total_people = adults + children + infants`. Numeri contraddittori
  restituiscono 409 senza scritture. Un body errato ma coerente `3/0/0` non è
  distinguibile da tre adulti reali: va corretto a monte, non indovinato.
- Persistenza separata `bookings.bokun_item_reference` per i codici TOD-T,
  estratti dai campi già supportati `productConfirmationCode`,
  `product_confirmation_code`, `booking_reference` (solo se TOD-T), oppure
  dal nuovo alias esplicito `bokun_item_reference`. Riferimenti discordanti
  richiedono revisione. Altri namespace prodotto mantengono il comportamento precedente.
- Vincolo UNIQUE su `(business_unit_id, bokun_item_reference)`; identità non
  modificabile dopo assegnazione. Un item non può essere assegnato a due cart
  della stessa BU, neppure se uno è cancellato. Un rebooking con nuovo cart e
  nuovo item resta una prenotazione distinta. Nessun backfill storico automatico.
  Il modello esistente conserva un solo cart per BU: più item dello stesso cart
  richiedono revisione e non vengono sovrascritti l'uno con l'altro.
- Webhook Calendar e import manuale risolvono il codice breve `T...`/completo
  `TOD-T...` solo nella BU 1, già usata dal flusso Calendar FMDQ.
  Il lookup NON filtra la data e NON usa nome, esperienza o conteggi come identità.
- Un solo match affidabile collega lo staging. Differenze di data/ora,
  esperienza/canale/conteggi o stato cancellato danno `needs_review`, mantenendo
  il collegamento. In assenza di differenze lo stato è `already_exists`.
  Nome incompleto e contatti mancanti non sostituiscono mai i dati Bókun.
- Codici assenti su eventi esplicitamente Bókun o già collegati a Bókun,
  più codici, lookup vuoto/ambiguo o cambio di target richiedono revisione.
  Un evento privo di qualsiasi indicazione Bókun conserva il flusso Calendar
  precedente: non è possibile attribuirgli una provenienza non ricevuta.
- Anche force-import si ferma sulla riconciliazione Bókun. Calendar prima di
  Bókun resta in revisione; dopo la consegna Bókun si può ripetere l'import
  selezionato per risolvere il collegamento. Non è stato aggiunto un job autonomo.
- Controlli staging con confronto dello snapshot impediscono di sovrascrivere
  un collegamento riconciliato mentre il webhook/import era in esecuzione.
- Un trigger impedisce INSERT Calendar con riferimenti item nel perimetro
  FMDQ anche a vecchi writer o a consegne concorrenti.
- `superseded_by_booking_id` e `duplicate_reconciliation_audit` conservano il
  duplicato inattivo e le evidenze; il trigger ne impedisce riattivazione,
  eliminazione o perdita dell'audit, anche dai percorsi di ripristino esistenti.

Gli importi delle booking non coinvolte non vengono aggiornati. Calcolo bambino,
fasce, accordi e regole di parsing/mapping Calendar restano quelli esistenti.
Calendar aggiorna osservazioni/staging, mai il booking Bókun. Una cancellazione
Google conserva il collegamento e non cancella automaticamente Bókun; una
riattivazione Google riapre la revisione. La cancellazione Bókun preserva gli
importi e la sua ripetizione è idempotente. Non essendoci nel contratto attuale
una versione Bókun affidabile, un vecchio CONFIRMED arrivato dopo CANCELLED
non può essere distinto da una vera riconferma: il comportamento precedente
non è stato alterato e l'ordinamento upstream va verificato separatamente.

## Migration e attivazione futura

Preparata con Supabase CLI, **non applicata**:
`supabase/migrations/20261101135751_bokun_item_calendar_identity.sql`.
Non contiene UPDATE storici, seed, nuove tabelle o modifiche alle policy RLS.
Usa funzioni SECURITY INVOKER e indici parziali.

Prima dell'eventuale attivazione autorizzata: validare in ambiente isolato con
schema completo/trigger/RLS correnti, verificare privilegi e advisor, applicare
la migration e poi il codice. Con codice nuovo e schema vecchio la ricerca item
fallisce in modo conservativo; non costituisce un rilascio utilizzabile.
Non applicare altre migration pendenti incidentalmente.

## Recupero 2415 / 2419, da autorizzare separatamente

1. Acquisire body inviato, dati Bókun e mapping Make. Verificare esplicitamente
   la coppia cart `TOD-108037806` / item `TOD-T151827070`, categorie 2/0/1,
   data 23/11 ore 12 e listino 38/45. Correggere prima l'origine dei conteggi:
   un replay errato `3/0/0` annullerebbe la correzione economica.
2. Esportare snapshot completi di 2415, 2419, staging 724, canonical 1373 e
   collegamenti/alias. Ripetere inventario delle dipendenze, verifiche pagamenti
   e fatturazione. Fermare/riprogrammare eventuali consegne obsolete a monte.
3. Dopo migration e codice autorizzati, provare
   `supabase/diagnostics/bokun-2415-2419-repair-preview.sql` con evidenza verificata.
   Il file richiede un riferimento esplicito all'evidenza e termina con ROLLBACK.
   Rifiuta stato cambiato, pagamenti, accordi/fasce, fatture o ulteriori link.
4. Controllare il risultato: 2415 conserva cart, data e cliente; riceve 2/0/1,
   totale persone 3, ricavo/costo 76, lordo 90, margine 0 e item persistente.
   Sono allineati anche pax 2 e total_amount 90, prima rispettivamente 1 e 0.
   2419 conserva importi/riga e snapshot completi, diventa inattiva e riferisce
   2415. Staging 724 punta a 2415 con `needs_review`. Canonical 1373 non cambia.
5. Solo dopo approvazione della preview, eseguire la stessa transazione con
   COMMIT autorizzato. Non eliminare 2419 e non ripristinarla per fare il match.
   Il file è deliberatamente monouso: una seconda esecuzione richiede rilettura.
6. Verificare Dashboard, agenda, calendario fattoria, report e fatturazione:
   una sola booking attiva, il 23/11, da 76/90. L'archivio duplicato non deve
   generare un falso alert di cancellazione cliente (la nota non usa tale heading).
   Le statistiche presenze canonical sono una fonte separata: restano tre
   presenze Google sul 24 finché l'utente corregge la data su Google.
   Non modificare l'osservazione storica per nascondere la discordanza.
7. Correggere il vero evento Google al 23/11, preservandone l'event ID;
   verificare il nuovo webhook, i replay e il link alla 2415. L'osservazione
   aggiornata può diventare `already_exists`, senza riattivare 2419.

Le UI esistenti possono ancora mostrare un comando di ripristino per una riga
archiviata: il database lo rifiuta. Il recupero non è reversibile con quel
comando; richiede un nuovo intervento amministrativo esplicito e auditato.

## Make: verifica e modifica necessaria a monte

Nessuna modifica eseguita. Individuare i campi reali di categorie partecipanti
nel dettaglio dell'item e il loro mapping. Trasmettere conteggi separati,
inclusi gli zeri; non mappare il totale ospiti in `adults`. Non dedurre infant
dal prezzo zero o da categorie arbitrarie. Servono una consegna reale e le
definizioni delle categorie dell'esperienza per confermare i percorsi.

Frammento del **contratto normalizzato** da ottenere dopo verifica, non
esempio di payload nativo né richiesta completa:

```json
{
  "bokun_booking_reference": "TOD-108037806",
  "productConfirmationCode": "TOD-T151827070",
  "adults": 2,
  "children": 0,
  "infants": 1,
  "total_people": 3
}
```

Conservare tutti gli altri campi esistenti, contatti, canali, date, importi
sorgente e percorsi cancellazione. Se il productConfirmationCode è già inviato,
nessun nuovo mapping item serve. Il flusso Google non richiede modifiche per il
codice breve già presente; mantenere UID, updated e status originali e correggere
manualmente la data del caso. Non inferire versioni o timestamps Bókun dalla
data di creazione booking.

## Verifiche locali

Test eseguono le route e le Server Actions reali con I/O sostituito, e PostgreSQL
isolato PGlite per migration/recupero. Nessun test scrive in Supabase.
PGlite è già disponibile nel workspace in `.tmp/bokun-sql`; per replicare in
un checkout pulito usare la procedura documentata in `bokun-rebooking.md`.
I test non certificano il mapping Make né la cronologia di una consegna nativa
non disponibile. Verificare manualmente il flusso reale in un ambiente separato
prima di un futuro rilascio autorizzato.

Controlli eseguiti: suite completa iniziale 629 test, 613 passati e 16 saltati
per configurazione opzionale dell'engine SQL; test aggiuntivo sul conflitto
staging passato separatamente. Rieseguiti i quattro gruppi opzionali con engine
PGlite esplicito: 123 test passati, zero fallimenti e zero saltati.
I nuovi test sono 12 (10 applicativi e 2 SQL), tutti passati.
TypeScript e build passati. ESLint mirato
trova soltanto i 16 `no-explicit-any` già presenti in HEAD nelle due route,
zero nuovi rilievi; gli altri file modificati passano ESLint.
