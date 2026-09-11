const PLATFORM_LOGOS = Object.freeze({
  coinbase: { name: 'Coinbase', src: '/investor/coinbase-logo.svg' },
  ondo: { name: 'Ondo', src: '/investor/ondo-logo.png' },
  'ondo finance': { name: 'Ondo', src: '/investor/ondo-logo.png' },
  kraken: { name: 'Kraken', src: '/investor/kraken-logo.png' },
  dinari: { name: 'Dinari', src: '/investor/dinari-logo.png' },
});

/** Platform identity is explicit event metadata, never inferred from token symbols. */
export function meetingPresentation(event) {
  if (!event) return { header: 'proxyvote', platform: '', platformLogo: null, showIssuerByTitle: false };
  const platform = String(event.platform ?? event.token_platform ?? '').trim();
  const selected = PLATFORM_LOGOS[platform.toLowerCase()];
  return {
    header: platform ? 'platform' : 'issuer',
    platform,
    platformLogo: selected?.src ?? null,
    showIssuerByTitle: Boolean(platform),
  };
}
