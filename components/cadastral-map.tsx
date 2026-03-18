"use client";

import React, { useEffect, useRef } from "react";
import { MapContainer, TileLayer, GeoJSON, useMap } from "react-leaflet";
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

  return (
    <MapContainer
      center={[lat, lng]}
      zoom={17}
      scrollWheelZoom={false}
      className="h-[320px] lg:h-[400px] w-full rounded-lg z-0"
      attributionControl={true}
    >
      {/* OSM fallback */}
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution="&copy; OSM contributors"
        zIndex={0}
      />

      {/* Esri World Imagery satelitska podlaga — zanesljivi XYZ tiles, EPSG:3857, ujema se z GURS koordinatami */}
      <TileLayer
        url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        attribution="&copy; Esri, Maxar, Earthstar Geographics"
        maxZoom={19}
        zIndex={1}
      />

      {/* Parcelna meja — modra tanka črtkana */}
      {validParcele.map((p, i) => (
        <GeoJSON
          key={`parcela-${i}`}
          data={p.geometry as unknown as GeoJSON.Geometry}
          style={{
            color: "#2563eb",
            weight: 1.5,
            fillOpacity: 0,
            dashArray: "6 4",
          }}
        />
      ))}

      {/* Tloris stavbe — rdeča tanka kontura + svetla polnitev */}
      {obrisGeom && (
        <GeoJSON
          key={JSON.stringify(obrisGeom.coordinates[0][0])}
          data={obrisGeom as GeoJSON.Polygon}
          style={{
            color: "#dc2626",
            weight: 1.5,
            fillColor: "#ef4444",
            fillOpacity: 0.3,
          }}
        />
      )}

      <FitBounds obrisGeom={obrisGeom} lat={lat} lng={lng} />
    </MapContainer>
  );
}
