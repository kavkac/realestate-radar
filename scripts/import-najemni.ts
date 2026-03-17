// TODO: Najemni posli (rental transactions) import script
//
// Data source investigation (March 2026):
// - e-prostor.gov.si ETN portal is a web viewer only (no public CSV/API)
// - podatki.gov.si has no "najemni posli" datasets
// - GURS JGP endpoints (ipi.eprostor.gov.si/jgp/) serve HTML web apps, not WFS
//
// When a public data source becomes available, this script should:
// 1. Download najemni posli CSV/data
// 2. Parse rental transaction records
// 3. Upsert into NajemniPosel model:
//    - koId, stStavbe, stDelaStavbe
//    - datum (date of transaction)
//    - najemninaMesecna (monthly rent in EUR)
//    - povrsina (area in m²)
//    - namen ("stanovanjsko" | "poslovno")
//
// Alternative approaches to investigate:
// - GURS data may be available via formal request (zahteva za podatke)
// - Portal energetskih izkaznic might link rental data
// - Check ETN-JV web viewer for export functionality

console.log("Najemni posli import not yet implemented — no public data source available.");
console.log("See comments in this file for implementation plan.");
