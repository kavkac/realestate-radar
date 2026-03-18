"use client";

import React, { useEffect } from "react";
import { MapContainer, TileLayer, WMSTileLayer, CircleMarker, GeoJSON, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";

interface CadastralMapProps {
  lat: number;
  lng: number;
  naslov: string;
  koId?: number;
  stStavbe?: number;
  obrisGeom?: { type: "Polygon"; coordinates: number[][][] } | null;
}

/** Recenter map when coords change */
function RecenterMap({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView([lat, lng], map.getZoom());
  }, [lat, lng, map]);
  return null;
}

export default function CadastralMap({ lat, lng, naslov, koId, stStavbe, obrisGeom }: CadastralMapProps) {
  return (
    <MapContainer
      center={[lat, lng]}
      zoom={17}
      scrollWheelZoom={false}
      className="h-[240px] lg:h-[320px] w-full rounded-lg z-0"
      attributionControl={true}
    >
      {/* Base layer: GURS ortofoto, fallback to OSM */}
      <WMSTileLayer
        url="https://storitve.eprostor.gov.si/ows-pub-wms/wms"
        layers="SI.GURS.DOF"
        format="image/png"
        transparent={false}
        attribution="&copy; GURS &middot; Geodetska uprava RS"
        // @ts-expect-error react-leaflet v4 WMS typing
        srs="EPSG:3857"
        eventHandlers={{
          tileerror: (e: unknown) => {
            // On WMS failure, the tiles just stay blank — OSM layer below provides fallback
          },
        }}
      />
      {/* OSM fallback underneath (renders if WMS tiles fail to load) */}
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution="&copy; OSM contributors"
        zIndex={-1}
      />

      {/* Cadastral parcels overlay */}
      <WMSTileLayer
        url="https://ipi.eprostor.gov.si/wms-si-gurs-kn/wms"
        layers="SI.GURS.KN:PARCELE_H"
        format="image/png"
        transparent={true}
        opacity={0.7}
        // @ts-expect-error react-leaflet v4 WMS typing
        srs="EPSG:3857"
      />

      {/* Buildings overlay */}
      <WMSTileLayer
        url="https://ipi.eprostor.gov.si/wms-si-gurs-kn/wms"
        layers="SI.GURS.KN:STAVBE_H"
        format="image/png"
        transparent={true}
        opacity={0.8}
        // @ts-expect-error react-leaflet v4 WMS typing
        srs="EPSG:3857"
      />

      {/* Property marker */}
      {/* Tloris stavbe */}
      {obrisGeom && (
        <GeoJSON
          key={JSON.stringify(obrisGeom.coordinates[0][0])}
          data={obrisGeom as GeoJSON.Polygon}
          style={{ color: "#2d6a4f", weight: 2.5, fillColor: "#2d6a4f", fillOpacity: 0.15 }}
        />
      )}
      <CircleMarker
        center={[lat, lng]}
        radius={6}
        pathOptions={{ color: "#2d6a4f", fillColor: "#2d6a4f", fillOpacity: 0.9, weight: 2 }}
      />

      <RecenterMap lat={lat} lng={lng} />
    </MapContainer>
  );
}
