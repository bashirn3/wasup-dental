"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

/** Free vector tiles, no API key required. Positron = muted, lets the UI pop. */
const MAP_STYLE = "https://tiles.openfreemap.org/styles/positron";

/** UK-wide overview used before a garage is chosen. */
export const UK_OVERVIEW = { lng: -2.6, lat: 54.1, zoom: 4.9, pitch: 0 };

export type MapTarget = {
  lng: number;
  lat: number;
  zoom: number;
  pitch?: number;
};

type Props = {
  target: MapTarget;
  marker?: { lng: number; lat: number } | null;
  className?: string;
};

export default function GarageMap({ target, marker, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    mapRef.current = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: [target.lng, target.lat],
      zoom: target.zoom,
      pitch: target.pitch ?? 0,
      attributionControl: false,
      interactive: false,
    });
    mapRef.current.on("load", () => setLoaded(true));
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cinematic fly whenever the target changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.flyTo({
      center: [target.lng, target.lat],
      zoom: target.zoom,
      pitch: target.pitch ?? 0,
      duration: 4200,
      curve: 1.6,
      essential: true,
    });
  }, [target.lng, target.lat, target.zoom, target.pitch]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markerRef.current?.remove();
    markerRef.current = null;
    if (marker) {
      const el = document.createElement("div");
      el.style.cssText =
        "width:18px;height:18px;border-radius:9999px;background:#cdf463;border:3px solid #0e3b2e;box-shadow:0 0 0 6px rgba(205,244,99,.35)";
      markerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat([marker.lng, marker.lat])
        .addTo(map);
    }
  }, [marker]);

  // Fades in over the pine background once tiles are ready, so raw tiles never flash.
  return (
    <div
      ref={containerRef}
      className={`${className ?? ""} transition-opacity duration-1000 ease-out ${
        loaded ? "opacity-100" : "opacity-0"
      }`}
    />
  );
}
