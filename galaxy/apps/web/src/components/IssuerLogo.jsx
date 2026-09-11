import { useState } from 'react';
import { eventIssuerBranding } from '@pv/shared';
import { API_BASE_URL } from '../api.js';

export function issuerLogoSource(value) {
  if (/^\/v1\/issuer-logos\/[0-9a-f-]{36}$/iu.test(value ?? '')) return `${API_BASE_URL}${value}`;
  if (/^\/issuer-logos\/[a-z]+-brand-v2\.png$/u.test(value ?? '')) return value;
  return null;
}

export default function IssuerLogo({ event, className = '', showNameFallback = false }) {
  const [failed, setFailed] = useState(null);
  const branding = eventIssuerBranding(event);
  const src = issuerLogoSource(branding.issuerLogoUrl);
  if (!src || failed === src) return showNameFallback
    ? <span className="issuer-name-fallback">{branding.issuerName || event?.tokenName || 'Issuer'}</span> : null;
  return <img className={`issuer-logo ${className}`} src={src}
    alt={`${branding.issuerName || 'Issuer'} logo`} onError={() => setFailed(src)} />;
}
