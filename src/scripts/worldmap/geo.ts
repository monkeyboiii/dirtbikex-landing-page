/**
 * China publishes maps in GCJ-02 ("Mars"), offset from WGS-84 by roughly 500 m. Our
 * catalog is WGS-84 and the basemap renders it directly, but every consumer map app —
 * Apple, Google and Amap inside the mainland — takes GCJ-02 display coordinates. A
 * handoff built from stored coordinates therefore navigates a rider to the wrong side
 * of the village, which is the same two-datum trap the iOS Directions button already hit.
 *
 * Only the forward direction is needed here: we hold WGS-84 and hand out GCJ-02.
 */
const A = 6378245.0;
const EE = 0.006_693_421_622_965_943;

const rad = (d: number) => (d * Math.PI) / 180;

function lagLat(x: number, y: number): number {
  let r = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  r += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
  r += ((20 * Math.sin(y * Math.PI) + 40 * Math.sin((y / 3) * Math.PI)) * 2) / 3;
  r += ((160 * Math.sin((y / 12) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30)) * 2) / 3;
  return r;
}

function lagLng(x: number, y: number): number {
  let r = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  r += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
  r += ((20 * Math.sin(x * Math.PI) + 40 * Math.sin((x / 3) * Math.PI)) * 2) / 3;
  r += ((150 * Math.sin((x / 12) * Math.PI) + 300 * Math.sin((x / 30) * Math.PI)) * 2) / 3;
  return r;
}

/** Rough mainland bounding box. Hong Kong, Macau and Taiwan publish WGS-84, so the
    country code decides — this box only guards against nonsense coordinates. */
function outsideChina(lat: number, lng: number): boolean {
  return lng < 72.004 || lng > 137.847 || lat < 0.834 || lat > 55.841;
}

export function wgsToGcj(lat: number, lng: number): [number, number] {
  if (outsideChina(lat, lng)) return [lat, lng];
  const dLat = lagLat(lng - 105, lat - 35);
  const dLng = lagLng(lng - 105, lat - 35);
  const magic = 1 - EE * Math.sin(rad(lat)) ** 2;
  const sqrtMagic = Math.sqrt(magic);
  return [
    lat + (dLat * 180) / (((A * (1 - EE)) / (magic * sqrtMagic)) * Math.PI),
    lng + (dLng * 180) / ((A / sqrtMagic) * Math.cos(rad(lat)) * Math.PI),
  ];
}
