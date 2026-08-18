# Istruzioni permanenti per TodoManager

## Contesto e ambito

- TodoManager è un gestionale operativo reale per prenotazioni turistiche. Evitare modifiche speculative, ampliamenti non richiesti e refactoring non necessari alla richiesta corrente.
- Prima di modificare una funzionalità, leggere integralmente i file coinvolti e comprendere il comportamento esistente, incluse dipendenze, Server Actions, route API e componenti collegati.
- Conservare tutte le funzionalità esistenti, salvo esplicita richiesta di modificarle.
- Non risolvere problemi preesistenti non correlati alla richiesta senza prima segnalarli. Distinguere chiaramente eventuali problemi preesistenti da quelli introdotti dalla modifica corrente.
- Fare modifiche piccole, mirate e facilmente verificabili. Evitare di riscrivere interi file quando non è necessario.
- Riutilizzare componenti, funzioni, query e convenzioni esistenti quando possibile.
- Mantenere la compatibilità e il comportamento dell'interfaccia sia su desktop sia su dispositivi mobili.

## Supabase e segreti

- Non modificare lo schema o i dati Supabase senza esplicita autorizzazione.
- `SUPABASE_SERVICE_ROLE_KEY` deve essere utilizzata esclusivamente lato server e non deve mai essere importata, inclusa o esposta nel codice client, nelle risposte API o nei log.
- Non modificare file `.env`, `.env.local` o altri file contenenti configurazioni riservate o segreti.
- Non modificare mapping di esperienze, canali o business unit senza una richiesta specifica.

## Funzionalità operative critiche

- Prestare particolare attenzione a webhook, import Google Calendar, prenotazioni, canali, fornitori e pagamenti: sono funzionalità operative e ogni cambiamento deve preservarne il comportamento esistente salvo richiesta contraria.
- Le regole di parsing e mapping dell'import Google Calendar non devono essere semplificate, aggregate, sostituite o rimosse incidentalmente.
- Prima di intervenire su webhook o importazioni, verificare i flussi di inserimento, aggiornamento, cancellazione, deduplicazione, riconciliazione e gestione degli errori già presenti.

## Verifica delle modifiche

- Prima di considerare completata una modifica, eseguire `npm run build`.
- Se esiste lo script `npm run lint`, eseguirlo quando appropriato alla modifica effettuata.
- Se il build fallisce a causa della modifica effettuata, correggere gli errori prima di terminare il lavoro.
- Se una verifica fallisce per un problema preesistente o ambientale, segnalarlo chiaramente senza modificarlo se non rientra nella richiesta.
- Prima di eseguire `npm run dev` su Windows, verificare se è già attiva una precedente istanza del server Next.js e terminarla in modo controllato, così da evitare che il nuovo server venga avviato sulla porta 3001 o successive.

## Git e sicurezza operativa

- Non eseguire `git push`, `git merge`, `git reset --hard` o altre operazioni Git distruttive senza esplicita richiesta dell'utente.
- Preservare le modifiche locali dell'utente e non sovrascrivere o annullare cambiamenti non collegati al lavoro richiesto.

## Resoconto finale obbligatorio

Al termine di ogni lavoro indicare chiaramente:

1. i file modificati;
2. cosa è stato cambiato;
3. il risultato di `npm run build`;
4. eventuali problemi o aspetti da verificare manualmente.
