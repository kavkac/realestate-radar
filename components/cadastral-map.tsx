"use client";

import React, { useEffect } from "react";
import { MapContainer, TileLayer, WMSTileLayer, CircleMarker, GeoJSON, useMap } from "react-leaflet";
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

function RecenterMap({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView([lat, lng], map.getZoom());
  }, [lat, lng, map]);
  return null;
}

export default function CadastralMap({ lat, lng, naslov, obrisGeom, parcelGeoms }: CadastralMapProps) {
  // Collect valid parcel geometries
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

      {/* Highlighted parcel boundaries (uradne meje parcel iz GURS WFS) */}
      {validParcele.map((p, i) => (
        <GeoJSON
          key={`parcela-${i}`}
          data={p.geometry as unknown as GeoJSON.Geometry}
          style={{
            color: "#1a56a0",
            weight: 2,
            fillColor: "#3b82f6",
            fillOpacity: 0.12,
            dashArray: "4 3",
          }}
        />
      ))}

      {/* Building footprint (tloris stavbe) */}
      {obrisGeom && (
        <GeoJSON
          key={JSON.stringify(obrisGeom.coordinates[0][0])}
          data={obrisGeom as GeoJSON.Polygon}
          style={{ color: "#2d6a4f", weight: 2.5, fillColor: "#2d6a4f", fillOpacity: 0.2 }}
        />
      )}

      {/* Location marker */}
      <CircleMarker
        center={[lat, lng]}
        radius={5}
        pathOptions={{ color: "#2d6a4f", fillColor: "#2d6a4f", fillOpacity: 1, weight: 2 }}
      />

      <RecenterMap lat={lat} lng={lng} />
    </MapContainer>
  );
}
