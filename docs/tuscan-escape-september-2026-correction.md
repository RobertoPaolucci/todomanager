# Correzione Tuscan Escape settembre 2026 — preparata, non applicata

## Ambito

Regola permanente nella fatturazione FMDQ per il canale 7: 8 paganti + una guida verificata → EUR 36 a cliente; altrimenti EUR 38. Gli accordi per booking mantengono la precedenza esistente. Gli altri canali e le esperienze con prezzo a gruppi restano invariati.

L'helper server legge soltanto Google staging/canonical/alias, con paginazione senza filtro mensile per individuare collisioni. Risolve il riferimento GCAL usando la stessa codifica/troncamento del webhook, richiede un'unica identità completa e un canonical univoco tramite il matcher già esistente. Usa il parser esistente su tutte le osservazioni della stessa identità, non gli adulti staging o le presenze canonical salvate. Queste ultime contengono ancora vecchi blocchi e conteggi non sincronizzati (incluso 1214); non vengono corrette.

Sconto soltanto se ogni osservazione concorda su 8 clienti, excluded_staff=1 e quality=parsed; data/canale/booking collegata devono essere coerenti. Cancellazioni, identità mancanti, alias non verificati, collisioni o titoli utilizzabili discordanti impediscono lo sconto. I vecchi titoli canonical privi di presenze non sono una seconda prova di quantità. Una lettura fallita interrompe la generazione invece di produrre una fattura con evidenza incompleta.

## Strategia migration

Il file 202610060001_tuscan_escape_september_booking_adults.sql sostituisce il precedente draft non applicato. Nessuna seconda migration automatica. Blocca e valida 18 booking; aggiorna 15 righe sullo snapshot originale: 13 con adulti diversi e le booking 2061/1985 con sole variazioni economiche. Le booking 2056, 2012, 2079 restano invariate.

Aggiorna esclusivamente adults, non_paying_adults, total_people, your_unit_price, supplier_unit_cost, total_to_you, total_supplier_cost, margin_total. La guida è provata dai titoli di tutti i 18 pranzi: si registra 1 non pagante; totale persone = clienti + 1. Ricavo e costo delle booking dirette FMDQ vengono allineati alla tariffa commerciale autorizzata, senza alterare i listini. Totale ricavo/costo/fattura previsto EUR 4530, margine zero.

Preserva pax: le fonti dimostrano convenzioni diverse, quindi non c'è un nuovo valore univoco autorizzabile. Preserva public_unit_price, total_customer e total_amount: manca la prova di un nuovo accordo lato cliente. Non modifica esperienza, canale, note, pagamenti, stati, fattura, canonical o staging. Margin_total resta zero.

Transazione, FOR UPDATE sulle booking e FOR SHARE sulle fonti staging (nessuna scrittura Google). Tutti i controlli precedono il primo UPDATE. Accetta soltanto l'intero snapshot originale oppure finale di ciascuna riga. Campi parzialmente corretti o modifiche manuali successive provocano errore. Verifica identità, data, canale, non cancellazione, adulti/bambini/neonati e gli snapshot quantitativi/economici, pubblici e di pagamento. Le fonti devono conservare UID, titolo, data, canale e collegamento/stato di import. Trigger/regole UPDATE sconosciuti bloccano l'esecuzione. Controllo finale di ogni colonna non autorizzata; errore → rollback completo.

## Variazioni per booking

| Booking | Campi che cambierebbero |
|---:|---|
| 1985 | `your_unit_price` 38 → 36; `supplier_unit_cost` 38 → 36; `total_to_you` 304 → 288; `total_supplier_cost` 304 → 288 |
| 2011 | `adults` 6 → 8; `total_people` 7 → 9; `your_unit_price` 38 → 36; `supplier_unit_cost` 38 → 36; `total_to_you` 228 → 288; `total_supplier_cost` 228 → 288 |
| 2061 | `your_unit_price` 38 → 36; `supplier_unit_cost` 38 → 36; `total_to_you` 304 → 288; `total_supplier_cost` 304 → 288 |
| 2062 | `adults` 7 → 6; `total_people` 8 → 7; `total_to_you` 266 → 228; `total_supplier_cost` 266 → 228 |
| 2063 | `adults` 6 → 8; `total_people` 7 → 9; `your_unit_price` 38 → 36; `supplier_unit_cost` 38 → 36; `total_to_you` 228 → 288; `total_supplier_cost` 228 → 288 |
| 2073 | `adults` 1 → 8; `non_paying_adults` 0 → 1; `total_people` 1 → 9; `your_unit_price` 38 → 36; `supplier_unit_cost` 38 → 36; `total_to_you` 38 → 288; `total_supplier_cost` 38 → 288 |
| 2074 | `adults` 1 → 8; `non_paying_adults` 0 → 1; `total_people` 1 → 9; `your_unit_price` 38 → 36; `supplier_unit_cost` 38 → 36; `total_to_you` 38 → 288; `total_supplier_cost` 38 → 288 |
| 2075 | `adults` 1 → 5; `non_paying_adults` 0 → 1; `total_people` 1 → 6; `total_to_you` 38 → 190; `total_supplier_cost` 38 → 190 |
| 2078 | `adults` 1 → 4; `non_paying_adults` 0 → 1; `total_people` 1 → 5; `total_to_you` 38 → 152; `total_supplier_cost` 38 → 152 |
| 2080 | `adults` 1 → 8; `non_paying_adults` 0 → 1; `total_people` 1 → 9; `your_unit_price` 38 → 36; `supplier_unit_cost` 38 → 36; `total_to_you` 38 → 288; `total_supplier_cost` 38 → 288 |
| 2081 | `adults` 1 → 8; `non_paying_adults` 0 → 1; `total_people` 1 → 9; `your_unit_price` 38 → 36; `supplier_unit_cost` 38 → 36; `total_to_you` 38 → 288; `total_supplier_cost` 38 → 288 |
| 2082 | `adults` 1 → 8; `non_paying_adults` 0 → 1; `total_people` 1 → 9; `your_unit_price` 38 → 36; `supplier_unit_cost` 38 → 36; `total_to_you` 38 → 288; `total_supplier_cost` 38 → 288 |
| 2115 | `adults` 8 → 7; `total_people` 9 → 8; `total_to_you` 304 → 266; `total_supplier_cost` 304 → 266 |
| 2146 | `adults` 1 → 5; `non_paying_adults` 0 → 1; `total_people` 1 → 6; `your_unit_price` 0 → 38; `supplier_unit_cost` 0 → 38; `total_to_you` 0 → 190; `total_supplier_cost` 0 → 190 |
| 2227 | `adults` 1 → 7; `non_paying_adults` 0 → 1; `total_people` 1 → 8; `your_unit_price` 0 → 38; `supplier_unit_cost` 0 → 38; `total_to_you` 0 → 266; `total_supplier_cost` 0 → 266 |

## Totali simulati

- 18 esperienze, adulti 69 → 123 (+54), bambini 0, neonati 0.
- 18 guide, totale persone finale 141. La fatturazione mostra 123 clienti, senza guide.
- 9 esperienze × 8 clienti × EUR 36 = EUR 2592.
- Altri 51 clienti × EUR 38 = EUR 1938.
- Fattura settembre EUR 4530; ricavo/costo salvati 2546 → 4530.

## Fattura esistente e aspetti sospesi

FPR 54/26 del 06/10/2026 rimane fatturata. Pagina e PDF ricalcolano il totale: dopo l'eventuale applicazione mostreranno EUR 4530 anche come già fatturato, senza congelare o conservare il vecchio importo EUR 2622. I test controllano stato, numero, data e assenza di scritture.

Prima della migration, con il solo nuovo codice, le quantità restano 69 e lo sconto scatta soltanto su 2061/1985: totale EUR 2590, non EUR 4530. Per ottenere il totale definitivo servono entrambe le preparazioni. Nessuna modifica dei dati è stata eseguita.

Pax rimane storico e può mantenere conteggi errati nei report che lo leggono. Gli importi pubblici persistiti rimangono storici; il report fornitore può ricalcolare il lordo da quantità/prezzo pubblico, mostrando un valore diverso dal database. Le esperienze ancora nominate “Blocco data” non vengono rimappate. Questi aspetti richiedono una decisione separata.

La regola permanente richiesta è centralizzata nei tre output di fatturazione. I salvataggi ordinari delle booking continuano a usare i listini esistenti: un successivo salvataggio può ricalcolare gli snapshot economici a 38, pur mantenendo la fattura dinamica a 36. Estendere la regola agli altri writer richiederebbe un intervento separato sui flussi operativi.

## Promemoria UI

Promemoria Tuscan Escape: per gruppi di 8 clienti + 1 guida, la tariffa è €36 per cliente. Negli altri casi resta €38 per cliente. La guida non viene fatturata.

Visibile nel gruppo canale 7, in un riquadro ambra, su desktop/mobile e in qualunque mese.
