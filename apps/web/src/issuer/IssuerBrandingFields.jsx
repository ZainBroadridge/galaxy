import { useEffect, useState } from 'react';
import { ISSUER_PRESETS, issuerPreset, TOKEN_PLATFORMS } from '@pv/shared';

export default function IssuerBrandingFields({ form, setForm, file, setFile, disabled }) {
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [failedPreset, setFailedPreset] = useState(null);
  const selectedIssuer = issuerPreset(form.issuerName);
  useEffect(() => {
    if (!file) { setPreview(null); return undefined; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function changeIssuer(value) {
    setForm((current) => {
      const previous = issuerPreset(current.issuerName);
      const next = issuerPreset(value);
      const sameIssuer = previous && next && previous.id === next.id;
      const security = next?.securities.length === 1 ? next.securities[0] : null;
      return { ...current, issuerName: value,
        securityName: sameIssuer ? current.securityName : security?.name ?? '',
        securityTicker: sameIssuer ? current.securityTicker : security?.ticker ?? '' };
    });
  }
  function chooseSecurity(ticker) {
    const security = selectedIssuer?.securities.find((item) => item.ticker === ticker);
    setForm((current) => ({ ...current, securityTicker: security?.ticker ?? '', securityName: security?.name ?? '' }));
  }
  function chooseLogo(event) {
    const selected = event.target.files?.[0];
    setError('');
    if (!selected) { setFile(null); return; }
    if (!['image/png', 'image/jpeg'].includes(selected.type) || selected.size > 512 * 1024) {
      setError('Choose a PNG or JPEG no larger than 512 KB.');
      event.target.value = ''; setFile(null); return;
    }
    setFile(selected);
  }
  const presetUrl = selectedIssuer ? `/issuer-logos/${selectedIssuer.logoFile}` : null;
  const logoUrl = preview || (failedPreset !== presetUrl ? presetUrl : null);
  return <section className="create-event-section issuer-branding-fields">
    <header className="create-event-section-heading"><h2>Issuer and listed security</h2>
      <p>The issuer brands the ballot, confirmation, voting receipt and results report. The platform remains an informational tag.</p></header>
    <div className="field-grid">
      <label>Official issuer name<input list="issuer-presets" value={form.issuerName} required maxLength={160} disabled={disabled}
        onChange={(event) => changeIssuer(event.target.value)}
        onBlur={() => { if (selectedIssuer) setForm((current) => ({ ...current, issuerName: selectedIssuer.name })); }}
        placeholder="Apple Inc., NVIDIA Corporation, or another issuer" />
        <datalist id="issuer-presets">{ISSUER_PRESETS.map((item) => <option key={item.id} value={item.name} />)}</datalist></label>
      <label>Tokenization platform<input list="token-platforms" value={form.platform} maxLength={80} disabled={disabled}
        onChange={(event) => setForm((current) => ({ ...current, platform: event.target.value }))} placeholder="Ondo, Dinari, or leave blank" />
        <datalist id="token-platforms">{TOKEN_PLATFORMS.map((item) => <option key={item} value={item} />)}</datalist></label>
      <label>Listed security{selectedIssuer ? <select value={form.securityTicker || ''} onChange={(event) => chooseSecurity(event.target.value)} required disabled={disabled}>
        <option value="">Select the security / share class</option>
        {selectedIssuer.securities.map((item) => <option key={item.ticker} value={item.ticker}>{item.name}</option>)}
      </select> : <input value={form.securityName || ''} maxLength={240} disabled={disabled}
        onChange={(event) => setForm((current) => ({ ...current, securityName: event.target.value }))}
        placeholder="Official security title, including share class if applicable" />}</label>
      <label>Trading symbol<input value={form.securityTicker || ''} readOnly={Boolean(selectedIssuer)} maxLength={24} disabled={disabled}
        onChange={(event) => setForm((current) => ({ ...current, securityTicker: event.target.value.toUpperCase() }))}
        placeholder="For the underlying security, not the token symbol" /></label>
      <label>Issuer logo (optional override)<input type="file" accept="image/png,image/jpeg" onChange={chooseLogo} disabled={disabled} />
        <small>PNG/JPEG, maximum 512 KB and 2048 x 2048 pixels. Supported issuers use sourced brand artwork, not generated wordmarks. A custom upload takes precedence.</small></label>
      <div className="issuer-logo-preview" aria-live="polite">
        {logoUrl ? <img src={logoUrl} alt={`${selectedIssuer?.name || form.issuerName || 'Issuer'} preview`}
          onError={() => { if (!preview) setFailedPreset(presetUrl); }} /> : <span>{selectedIssuer ? 'Preset artwork is not installed. Upload an image or run the artwork sync before deployment.' : 'Issuer logo preview'}</span>}
        {file && <button type="button" className="button tertiary compact" onClick={() => setFile(null)} disabled={disabled}>Use preset instead</button>}
        {error && <p role="alert">{error}</p>}
      </div>
    </div>
  </section>;
}
