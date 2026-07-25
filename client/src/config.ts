/**
 * Central API configuration
 * 
 * Production Render Backend: https://sporting-ethos.onrender.com
 * Fallback to local dev server when running on localhost
 */
const getBackendUrl = (): string => {
  // If explicitly set via environment variable
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }
  
  // If running in production (Vercel / web domain)
  if (typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    return 'https://sporting-ethos.onrender.com';
  }
  
  // Local development
  return 'http://localhost:3001';
};

export const API_BASE = getBackendUrl();
export const WS_URL   = getBackendUrl();
