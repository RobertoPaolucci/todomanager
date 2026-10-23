# Conferma lettura delle cancellazioni in Dashboard

Implementazione locale. Migration preparata, **non applicata a Supabase**:
[`20261023181507_booking_cancellation_dashboard_acknowledgements.sql`](../supabase/migrations/20261023181507_booking_cancellation_dashboard_acknowledgements.sql).

## Origine e ambito

`NotificationCenter` legge gli avvisi da `bookings.notes`. Le regole esistenti
restano valide: rosso solo con `is_cancelled = true`, verde solo con
`is_cancelled = false`, giallo secondo il filtro originale.
Il webhook prenotazioni genera l'intestazione `🔴 Prenotazione cancellata`,
eventualmente seguita dalle note della prenotazione. Il webhook non viene modificato.

Solo questa intestazione, in una prenotazione effettivamente cancellata, abilita
la presa visione. Avvisi rossi diversi o note contenenti più segnalazioni colorate
restano visibili senza il nuovo pulsante. Nessuna estensione automatica agli avvisi
gialli o verdi. I componenti, le azioni e le migration Google Calendar non cambiano.

## Persistenza e versione

- `booking_cancellation_dashboard_acknowledgements` conserva ID della prenotazione,
  versione, snapshot significativo, data e UUID dell'utente verificato lato server.
  La chiave composta rende la conferma idempotente e conserva primo utente e data.
- La presa visione è condivisa tra gli operatori, come quella Google Calendar;
  non dipende da cookie o stato locale del browser per la persistenza.
- La versione comprende data/ora esperienza, persone, cliente, esperienza e canale.
  Spazi e maiuscole dei nomi sono normalizzati. Timestamp, note libere, riferimenti,
  importi, pagamenti, commissioni e fornitori non determinano la versione.
- `booking_cancellation_alert_revisions` conserva un contatore per prenotazione.
  Il trigger `AFTER` incrementa solo quando la prenotazione passa a cancellata
  oppure cambia uno dei contenuti significativi mentre è cancellata.
  Ripristino e successiva cancellazione producono quindi un nuovo avviso anche
  con contenuto identico e senza visite intermedie alla Dashboard. Un replay
  identico non incrementa il contatore. Anche il ritorno a una precedente data
  dopo una modifica è una nuova versione.
- Le due viste leggono prenotazioni e ricevute nello stesso snapshot. La RPC
  confronta la versione vista dall'utente prima di inserire la ricevuta;
  una pagina obsoleta non può nascondere una nuova situazione.

La lettura scrive esclusivamente una ricevuta. Non aggiorna `bookings`,
non modifica `is_cancelled` e non cancella righe. Il trigger scrive solo nella
nuova tabella delle revisioni, senza cambiare la riga operativa ricevuta.
Nessuna nuova foreign key o cascata sulle tabelle esistenti.

## Sicurezza e interfaccia

La Server Action verifica `tm-auth-token` tramite `auth.getUser`, rifiuta sessioni
scadute, utenti anonimi e ruoli diversi da `authenticated`, secondo il modello
di accesso operativo già usato da Google Calendar. L'utente non può scegliere
l'UUID da registrare. Le tabelle hanno RLS abilitata; viste, funzioni e tabelle
sono inaccessibili ai ruoli browser `anon` e `authenticated`. L'accesso avviene
solo sul server con `service_role`; nessuna funzione usa `SECURITY DEFINER`.

Il collegamento «Apri prenotazione» e il pulsante di lettura sono separati.
La rimozione locale della sola versione e l'aggiornamento del contatore avvengono
dopo la risposta di salvataggio riuscito, seguiti dal refresh della Dashboard.
Errori e sessioni scadute mantengono riga e contatore e mostrano un messaggio.

Senza migration, o con errore di lettura delle ricevute, la Dashboard usa la query
precedente, mostra gli avvisi e segnala che la presa visione non è disponibile.
Il nuovo pulsante in questo caso non viene mostrato.

## Verifiche e limiti

I test dedicati eseguono la migration su PostgreSQL in memoria (PGlite), con
fixture sintetiche e anche le migration Google Calendar esistenti. Coprono
persistenza delle ricevute, indipendenza, idempotenza, versioni significative,
replay, ripristino/nuova cancellazione, permessi SQL, invariabilità delle righe
operative e coesistenza con Google Calendar. I test componenti/Server Action
coprono pulsanti, contatore, errori, autorizzazione e nuove letture dal server.

La migration aggiunge un trigger alle scritture di `bookings`: è necessario
per rilevare transizioni avvenute senza accessi alla Dashboard. Usa i permessi
`service_role` già impiegati dai writer applicativi. Prima di una futura
applicazione verificare eventuali writer esterni con ruoli personalizzati:
potrebbero richiedere i permessi sul registro delle revisioni. La creazione
del trigger acquisisce un lock con timeout di 5 secondi e inizializza il registro
per le cancellazioni già presenti, senza segnare alcun avviso come letto.

Non è stata effettuata una verifica end-to-end contro Supabase reale, perché
la migration non è stata applicata. Dopo una futura applicazione autorizzata,
verificare su desktop e mobile il clic, il refresh, il logout/nuovo accesso e
la permanenza delle altre notifiche, comprese quelle Google Calendar.
