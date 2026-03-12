export const stats = [
  { title: "Incassato mese", value: "€ 4.250" },
  { title: "Da incassare", value: "€ 1.180" },
  { title: "Da pagare", value: "€ 2.040" },
  { title: "Margine mese", value: "€ 1.030" },
];

export const upcomingBookings = [
  {
    id: 1,
    experience: "Farm Tour & Lunch",
    customer: "John Smith",
    pax: 4,
    date: "14 Mar",
    status: "Cliente: parziale",
  },
  {
    id: 2,
    experience: "Wine Tasting",
    customer: "Emily Brown",
    pax: 2,
    date: "15 Mar",
    status: "Cliente: pagato",
  },
  {
    id: 3,
    experience: "E-bike Tour",
    customer: "Lucas Martin",
    pax: 2,
    date: "16 Mar",
    status: "Fornitore: da pagare",
  },
];

export const alerts = [
  "3 clienti non saldati",
  "2 fornitori da pagare",
  "1 prenotazione incompleta",
];

export const bookings = [
  {
    id: "BK001",
    customer: "John Smith",
    experience: "Farm Tour & Lunch",
    date: "2026-03-14",
    pax: 4,
    total: "€ 240",
    customerPayment: "Parziale",
    supplierPayment: "Da pagare",
  },
  {
    id: "BK002",
    customer: "Emily Brown",
    experience: "Wine Tasting",
    date: "2026-03-15",
    pax: 2,
    total: "€ 90",
    customerPayment: "Pagato",
    supplierPayment: "Pagato",
  },
];

export const customers = [
  {
    id: "CL001",
    name: "John Smith",
    email: "john@example.com",
    phone: "+1 555 123456",
    totalBookings: 3,
  },
  {
    id: "CL002",
    name: "Emily Brown",
    email: "emily@example.com",
    phone: "+44 777 123456",
    totalBookings: 1,
  },
];

export const suppliers = [
  {
    id: "FO001",
    name: "Cantina Poggio",
    service: "Wine tasting",
    email: "info@cantina.com",
    phone: "+39 333 000000",
    status: "Attivo",
  },
  {
    id: "FO002",
    name: "E-bike Rental Montepulciano",
    service: "Noleggio e-bike",
    email: "booking@ebike.com",
    phone: "+39 334 000000",
    status: "Attivo",
  },
];

export const payments = [
  {
    id: "PM001",
    type: "Incasso cliente",
    subject: "John Smith",
    amount: "€ 120",
    date: "2026-03-10",
    status: "Ricevuto",
  },
  {
    id: "PM002",
    type: "Pagamento fornitore",
    subject: "Cantina Poggio",
    amount: "€ 80",
    date: "2026-03-11",
    status: "Da pagare",
  },
];