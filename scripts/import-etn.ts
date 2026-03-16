// TODO: ETN (Evidenca trga nepremičnin) import script
//
// ETN public data page (https://www.e-prostor.gov.si/zbirke-prostorskih-podatkov/nepremicnine/etn/)
// returned 404 as of March 2026. The data may require registration or have moved.
//
// When access becomes available, this script should:
// 1. Download ETN CSV/data from the public portal
// 2. Parse transaction records (price, area, date, municipality, property IDs)
// 3. Upsert into the Transaction model by (koId, stStavbe, stDelaStavbe, date)
// 4. Map columns: koId, stStavbe, stDelaStavbe, price, pricePerM2, area, date, type, municipality
//
// Alternative data source to investigate:
// - GURS WFS may have transaction layers (check GetCapabilities for ETN-related feature types)
// - e-Prostor REST API: https://storitve.eprostor.gov.si/

console.log("ETN import not yet implemented — data source not publicly available.");
console.log("See comments in this file for implementation plan.");
