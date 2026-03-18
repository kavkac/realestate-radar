"use client";

import React, { useEffect, useRef } from "react";
import { MapContainer, TileLayer, WMSTileLayer, GeoJSON, useMap } from "react-leaflet";
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
      {/* OSM base */}
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution="&copy; OSM contributors"
        zIndex={0}
      />

      {/* GURS ortofoto (satellite) */}
      <WMSTileLayer
        url="https://storitve.eprostor.gov.si/ows-pub-wms/wms"
        layers="SI.GURS.DOF"
        format="image/png"
        transparent={false}
        attribution="&copy; GURS"
        // @ts-expect-error react-leaflet v4 WMS typing
        srs="EPSG:3857"
        zIndex={1}
        opacity={0.7}
      />

      {/* Cadastral parcels WMS overlay */}
      <WMSTileLayer
        url="https://ipi.eprostor.gov.si/wms-si-gurs-kn/wms"
        layers="SI.GURS.KN:PARCELE_H"
        format="image/png"
        transparent={true}
        opacity={0.5}
        // @ts-expect-error react-leaflet v4 WMS typing
        srs="EPSG:3857"
        zIndex={2}
      />

      {/* Buildings WMS overlay */}
      <WMSTileLayer
        url="https://ipi.eprostor.gov.si/wms-si-gurs-kn/wms"
        layers="SI.GURS.KN:STAVBE_H"
        format="image/png"
        transparent={true}
        opacity={0.7}
        // @ts-expect-error react-leaflet v4 WMS typing
        srs="EPSG:3857"
        zIndex={3}
      />

      {/* Parcel boundaries — modra pikčasta kontura */}
      {validParcele.map((p, i) => (
        <GeoJSON
          key={`parcela-${i}`}
          data={p.geometry as unknown as GeoJSON.Geometry}
          style={{
            color: "#1d4ed8",
            weight: 2.5,
            fillColor: "#3b82f6",
            fillOpacity: 0.08,
            dashArray: "6 4",
          }}
        />
      ))}

      {/* Building footprint — krepka rdeča kontura, zapolnjena */}
      {obrisGeom && (
        <GeoJSON
          key={JSON.stringify(obrisGeom.coordinates[0][0])}
          data={obrisGeom as GeoJSON.Polygon}
          style={{
            color: "#dc2626",
            weight: 3,
            fillColor: "#ef4444",
            fillOpacity: 0.25,
          }}
        />
      )}

      <FitBounds obrisGeom={obrisGeom} lat={lat} lng={lng} />
    </MapContainer>
  );
}
