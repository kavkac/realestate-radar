"use client";

import React, { useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, GeoJSON, useMap, CircleMarker } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

interface ParcelaGeom {
  geometry?: Record<string, unknown> | null;
  parcelnaStevila?: string;
}

interface CadastralMapProps {
  lat: number;
  lng: number;
  naslov: string;
  koId?: number;
  stStavbe?: number;
  obrisGeom?: { type: "Polygon"; coordinates: number[][][] } | null;
  parcelGeoms?: ParcelaGeom[] | null;
}

/** Zoom to fit building polygon; fallback to lat/lng */
function FitBounds({ obrisGeom, lat, lng }: { obrisGeom: CadastralMapProps["obrisGeom"]; lat: number; lng: number }) {
  const map = useMap();
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current) return;
    if (obrisGeom?.coordinates?.[0]?.length) {
      const latlngs = obrisGeom.coordinates[0].map(([lng, lat]) => [lat, lng] as [number, number]);
      const bounds = L.latLngBounds(latlngs);
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 19 });
      fitted.current = true;
    } else {
      map.setView([lat, lng], 18);
    }
  }, [obrisGeom, lat, lng, map]);
  return null;
}

export default function CadastralMap({ lat, lng, naslov, obrisGeom, parcelGeoms }: CadastralMapProps) {
  const validParcele = (parcelGeoms ?? []).filter((p) => p.geometry != null);
  const [satellite, setSatellite] = useState(false);

  return (
    <div className="relative">
      <MapContainer
        center={[lat, lng]}
        zoom={17}
        scrollWheelZoom={false}
        className="h-[320px] lg:h-[400px] w-full rounded-lg z-0"
        attributionControl={true}
      >
        {/* OSM base — always present */}
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution="&copy; OSM contributors"
          zIndex={0}
        />

        {/* Esri World Imagery — samo v satelitskem modu */}
        {satellite && (
          <TileLayer
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            attribution="&copy; Esri, Maxar, Earthstar Geographics"
            maxZoom={19}
            zIndex={1}
          />
        )}

        {/* Parcelna meja — modra tanka črtkana */}
        {validParcele.map((p, i) => (
          <GeoJSON
            key={`parcela-${i}-${satellite}`}
            data={p.geometry as unknown as GeoJSON.Geometry}
            style={
              satellite
                ? { color: "#3399ff", weight: 2.5, fillOpacity: 0, dashArray: "6 4" }
                : { color: "#2563eb", weight: 1.5, fillOpacity: 0, dashArray: "6 4" }
            }
          />
        ))}

        {/* Tloris stavbe */}
        {obrisGeom ? (
          <GeoJSON
            key={`obris-${JSON.stringify(obrisGeom.coordinates[0][0])}-${satellite}`}
            data={obrisGeom as GeoJSON.Polygon}
            style={
              satellite
                ? { color: "#ff3333", weight: 3, fillOpacity: 0 }
                : { color: "#dc2626", weight: 2, fillColor: "#ef4444", fillOpacity: 0.35 }
            }
          />
        ) : (
          /* Fallback marker ko ni tlorisa (podeželske stavbe brez OBRIS_GEOM) */
          <CircleMarker center={[lat, lng]} radius={8} pathOptions={{ color: "#dc2626", fillColor: "#ef4444", fillOpacity: 0.8, weight: 2 }} />
        )}

        <FitBounds obrisGeom={obrisGeom} lat={lat} lng={lng} />
      </MapContainer>

      {/* Toggle gumb — Karta / Satelit */}
      <div className="absolute top-2 right-2 z-[1000] flex rounded overflow-hidden shadow-sm text-xs">
        <button
          onClick={() => setSatellite(false)}
          className={`px-2 py-1 ${!satellite ? "bg-[#2d6a4f] text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
        >
          Karta
        </button>
        <button
          onClick={() => setSatellite(true)}
          className={`px-2 py-1 ${satellite ? "bg-[#2d6a4f] text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
        >
          Satelit
        </button>
      </div>
    </div>
  );
}
