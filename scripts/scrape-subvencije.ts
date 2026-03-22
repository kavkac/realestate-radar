import { Pool } from "pg";
import crypto from "crypto";
import * as https from "https";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function fetchPage(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "RealEstateRadar/1.0 research@realestate-radar.si" } }, res => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => resolve(data));
    }).on("error", reject);
  });
}

// Hardcoded program data scraped from official sources
// We also fetch the page to detect changes via hash
const PROGRAMS = [
  // EKO SKLAD — Nepovratne spodbude za naravne osebe
  {
    naziv: "Toplotna izolacija fasade",
    kratek_opis: "Nepovratna finančna spodbuda za vgradnjo toplotne izolacije fasade starejših stavb.",
    vir: "ekosklad",
    tip: "nepovratna",
    namen: "fasada",
    pogoji: { letoGradnje_max: 2013, namembnost: ["stanovanje", "stavba"] },
    max_znesek: 12000,
    max_delez: 50,
    url: "https://www.ekosklad.si/programi/za-gospodinjstva/nepovratne-financne-spodbude/naravne-osebe/seznam-programov/produkt/EN-EKO-07"
  },
  {
    naziv: "Toplotna izolacija strehe ali stropa",
    kratek_opis: "Nepovratna spodbuda za toplotno izolacijo strehe, podstrešja ali stropa nad neogrevanim prostorom.",
    vir: "ekosklad",
    tip: "nepovratna",
    namen: "streha",
    pogoji: { letoGradnje_max: 2013, namembnost: ["stanovanje", "stavba"] },
    max_znesek: 6000,
    max_delez: 50,
    url: "https://www.ekosklad.si/programi/za-gospodinjstva/nepovratne-financne-spodbude/naravne-osebe/seznam-programov/produkt/EN-EKO-06"
  },
  {
    naziv: "Menjava oken in balkonskih vrat",
    kratek_opis: "Nepovratna spodbuda za vgradnjo energijsko učinkovitih oken in balkonskih vrat.",
    vir: "ekosklad",
    tip: "nepovratna",
    namen: "okna",
    pogoji: { letoGradnje_max: 2013, namembnost: ["stanovanje", "stavba"] },
    max_znesek: 4000,
    max_delez: 30,
    url: "https://www.ekosklad.si/programi/za-gospodinjstva/nepovratne-financne-spodbude/naravne-osebe/seznam-programov/produkt/EN-EKO-05"
  },
  {
    naziv: "Toplotna črpalka za ogrevanje",
    kratek_opis: "Nepovratna spodbuda za vgradnjo toplotne črpalke za ogrevanje prostorov ali sanitarne vode.",
    vir: "ekosklad",
    tip: "nepovratna",
    namen: "toplotna_crpalka",
    pogoji: { letoGradnje_max: 2023, namembnost: ["stanovanje", "stavba"], energijskiRazred_max: "D" },
    max_znesek: 10000,
    max_delez: 50,
    url: "https://www.ekosklad.si/programi/za-gospodinjstva/nepovratne-financne-spodbude/naravne-osebe/seznam-programov/produkt/EN-EKO-02"
  },
  {
    naziv: "Solarni fotovoltaični sistem",
    kratek_opis: "Nepovratna spodbuda za vgradnjo solarnih fotovoltaičnih panelov za lastno rabo električne energije.",
    vir: "ekosklad",
    tip: "nepovratna",
    namen: "fotovoltaika",
    pogoji: { namembnost: ["stanovanje", "stavba"] },
    max_znesek: 7500,
    max_delez: 50,
    url: "https://www.ekosklad.si/programi/za-gospodinjstva/nepovratne-financne-spodbude/naravne-osebe/seznam-programov/produkt/EN-EKO-01"
  },
  {
    naziv: "Prezračevanje z rekuperacijo",
    kratek_opis: "Spodbuda za vgradnjo sistema prezračevanja z vračanjem toplote odpadnega zraka.",
    vir: "ekosklad",
    tip: "nepovratna",
    namen: "prezracevanje",
    pogoji: { letoGradnje_max: 2013, namembnost: ["stanovanje", "stavba"] },
    max_znesek: 3000,
    max_delez: 50,
    url: "https://www.ekosklad.si/programi/za-gospodinjstva/nepovratne-financne-spodbude/naravne-osebe/seznam-programov"
  },
  // STANOVANJSKI SKLAD RS
  {
    naziv: "Ugodni kredit za mlade — prvo stanovanje",
    kratek_opis: "Ugodni dolgoročni kredit Stanovanjskega sklada RS za nakup ali gradnjo prvega stanovanja za mlade do 35 let.",
    vir: "stanovanjski_sklad",
    tip: "kredit",
    namen: "nakup",
    pogoji: { namembnost: ["stanovanje"] },
    max_znesek: 100000,
    max_delez: null,
    url: "https://www.ssrs.si/ugodni-krediti/"
  },
  {
    naziv: "Kredit za energetsko prenovo",
    kratek_opis: "Ugodni kredit za celovito ali delno energetsko prenovo obstoječe stavbe.",
    vir: "stanovanjski_sklad",
    tip: "kredit",
    namen: "energetska_prenova",
    pogoji: { letoGradnje_max: 2013, namembnost: ["stanovanje", "stavba"] },
    max_znesek: 25000,
    max_delez: null,
    url: "https://www.ssrs.si/ugodni-krediti/"
  },
  // SID BANKA
  {
    naziv: "SID — zeleni kredit za energetsko učinkovitost",
    kratek_opis: "Ugodni kredit SID banke za naložbe v energetsko učinkovitost in obnovljive vire energije.",
    vir: "sid",
    tip: "kredit",
    namen: "energetska_prenova",
    pogoji: { namembnost: ["stanovanje", "stavba"], energijskiRazred_max: "C" },
    max_znesek: 50000,
    max_delez: null,
    url: "https://www.sid.si/posojila/za-podjetnike-in-obrtnike/energetska-ucinkovitost"
  },
];

async function run() {
  const client = await pool.connect();
  try {
    for (const p of PROGRAMS) {
      // Try to fetch live page to check for changes
      let liveHash: string | null = null;
      try {
        const html = await fetchPage(p.url);
        liveHash = crypto.createHash("md5").update(html).digest("hex");
      } catch { /* ignore fetch errors */ }

      const dataHash = crypto.createHash("md5").update(JSON.stringify(p)).digest("hex");

      await client.query(
        `INSERT INTO subvencije (naziv, kratek_opis, vir, tip, namen, pogoji, max_znesek, max_delez, url, aktivna, zadnja_osvezitev, vsebina_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,NOW(),$10)
         ON CONFLICT (naziv) DO UPDATE SET
           kratek_opis=EXCLUDED.kratek_opis, pogoji=EXCLUDED.pogoji,
           max_znesek=EXCLUDED.max_znesek, max_delez=EXCLUDED.max_delez,
           url=EXCLUDED.url, zadnja_osvezitev=NOW(), vsebina_hash=EXCLUDED.vsebina_hash,
           aktivna=true`,
        [p.naziv, p.kratek_opis, p.vir, p.tip, p.namen,
         JSON.stringify(p.pogoji), p.max_znesek ?? null, p.max_delez ?? null,
         p.url, liveHash ?? dataHash]
      );
      console.log(`✓ ${p.naziv}`);
    }
    console.log("Done.");
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(console.error);
