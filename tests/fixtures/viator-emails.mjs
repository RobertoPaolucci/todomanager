// Real field values supplied for Phase 1; layout/headlines reconstructed.
// These are NOT copies of the complete original emails (not supplied).
export const confirmed = `Prenotazione confermata
Riferimento prenotazione: BR-1449799117
Codice prodotto: 200401P10
Tour grade: TG1~12:00
Data: Wed, Sep 23, 2026
Cliente: Amber De Clercq
Viaggiatori: 2 Adulti
Tariffa netta Viator: EUR €40,32`;

export const cancelled = `Prenotazione cancellata
Riferimento prenotazione: BR-1446150053
Esperienza: Noleggio E-bike tour Montepulciano e Val d’Orcia con guida
Opzione: E-bike tour Montepulciano and Val d’Orcia with Guide 09:00
Data: Thu, Oct 15, 2026
Viaggiatori: 2 Adulti
Cliente: Autumn Cronin`;

export const changeText = `Beth Scott weight 72.1 kg
nome secondo traveller modificato in Timothy Stout
Timothy Stout weight 77.1 kg`;
export const modified = `Prenotazione modificata
Riferimento prenotazione: BR-1436713371
Codice prodotto: 200401P8
Cliente: Beth Scott
Data: Fri, Sep 04, 2026
Modifiche:
${changeText}`;

// Reconstructed HTML layout: structured table followed by a flattened/linkified
// rendition of the same fields. Only reference, codes, adults and amount are real;
// the other values are synthetic. No original customer/contact data is included.
export const duplicatedHtml = `<html><body>
<h1>Prenotazione confermata</h1>
<table>
<tr><td>Riferimento prenotazione:</td><td>BR-1447626735</td></tr>
<tr><td>Nome del tour:</td><td>Passeggiata in fattoria</td></tr>
<tr><td>Codice prodotto:</td><td>200401P1</td></tr>
<tr><td>Codice livello del tour:</td><td>TG1</td></tr>
<tr><td>Data:</td><td>Wed, Sep 23, 2026</td></tr>
<tr><td>Ora:</td><td>10:30</td></tr>
<tr><td>Cliente:</td><td>Alex Example</td></tr>
<tr><td>Viaggiatori:</td><td>1 Adulto</td></tr>
<tr><td>Telefono:</td><td><a href="tel:+390000000001">+39 000 000 0001</a></td></tr>
<tr><td>Tariffa netta Viator:</td><td>EUR &euro;33,30</td></tr>
</table>
<div>Nome del tour: [Passeggiata in fattoria](https://example.test/tour) Codice prodotto: 200401P1 Codice livello del tour: TG1 Riferimento prenotazione: BR-1447626735</div>
<div>Viaggiatori: 1 Adulto Cliente: Alex Example Data: Wed, Sep 23, 2026 Ora: 10:30</div>
<div>Telefono: +39 000 000 0001 [tel:+390000000001] Tariffa netta Viator: EUR &euro;33,30</div>
</body></html>`;
