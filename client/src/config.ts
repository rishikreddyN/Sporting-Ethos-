/**
 * Central API configuration
 * 
 * Dynamically resolves the backend host:
 * - If VITE_API_URL is set (e.g. production Vercel -> Render): use VITE_API_URL
 * - If accessing via local IP (e.g. 192.168.1.40 from mobile): use http://192.168.1.40:3001
 * - Default fallback for local desktop browser: http://localhost:3001
 */
const getBackendUrl = (): string => {
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }
  
  if (typeof window !== 'undefined' && window.location.hostname) {
    return `http://${window.location.hostname}:3001`;
  }
  
  return 'http://localhost:3001';
};

export const API_BASE = getBackendUrl();
export const WS_URL   = getBackendUrl();
