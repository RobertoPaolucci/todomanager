# Prezzo concordato sulla prenotazione

## Attivazione manuale

La migration `supabase/migrations/202609290001_booking_agreed_unit_price.sql`
è preparata, non applicata. Applicarla tramite il normale intervento manuale
Supabase prima di utilizzare o distribuire il codice aggiornato. Non contiene
backfill: le prenotazioni esistenti mantengono `agreed_unit_price = NULL`.
Anche il webhook aggiornato richiede la nuova colonna per il controllo delle
modifiche concorrenti. Nessuna prenotazione reale viene aggiornata dai test.

## Regole

- Campo vuoto: percorso prezzi automatico invariato.
- Zero: accordo valido, distinto dal campo vuoto.
- Accordo: `(adulti + bambini) × agreed_unit_price`; infant e guide/autisti
  separati non partecipano al prezzo. Non ammesso per gruppi/quad.
- Il ricavo cambia sulla sola prenotazione; il lordo pubblico resta automatico.
- Anche costo e fatturazione usano l'accordo quando la business unit ha codice
  `fmdq`, il fornitore è interno secondo `business_unit_internal_suppliers` e il
  canale ha `fattura_mensile_fmdq = true`. Il salvataggio verifica inoltre che
  le tariffe ordinarie adulto/bambino di ricavo, costo e fattura coincidano;
  in caso contrario rifiuta l'accordo per evitare di cancellare un margine reale.
- Negli altri contesti cambia solo il ricavo, mantenendo il costo ordinario.
- Cambiare esperienza/canale svuota il campo con avviso; reinserirlo costituisce
  la conferma del nuovo accordo. Il server rifiuta il trascinamento non confermato.
- I campi pagamento assenti sono omessi dall'UPDATE e non producono movimenti
  nello storico. I pagamenti continuano a essere gestiti nelle pagine dedicate.
- Il report corregge il conteggio dei paganti solo dove `total_people` conferma
  che i non paganti sono aggiunti separatamente. Per le altre righe conserva il
  conteggio precedente, senza modificare dati storici.
- Il webhook conserva l'accordo, ricalcola al cambio partecipanti e rifiuta
  cambi di contesto. Il backfill esclude gli accordi, incluso zero; anche la
  scrittura condizionale protegge da accordi inseriti dopo la lettura.

## Verifica locale

`node --test tests/booking-pricing.test.mjs` esegue le vere azioni, il form,
il report e i calcoli delle route PDF con database e confini framework simulati.
Se disponibile, usa PGlite in `.tmp/bokun-sql` per verificare la migration su un
database temporaneo locale. Non usa credenziali né connessioni Supabase.

Fixture #2010 con accordo 30: 25 paganti, 27 posti, ricavo 750, costo 750,
fatturazione FMDQ 750, margine zero. Listino e altre prenotazioni restano invariati.

Dopo l'applicazione manuale della migration verificare nel browser desktop/mobile
inserimento, svuotamento del prezzo, cambio canale/esperienza e stampa PDF.
Non salvare cambi su #2010 finché non si intende applicare realmente l'accordo.
