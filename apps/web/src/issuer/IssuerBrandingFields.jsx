import { useEffect, useState } from 'react';
import { issuerPreset } from '@pv/shared';
import FuzzyCombobox from '../components/FuzzyCombobox.jsx';
import PlatformAutocomplete from './PlatformAutocomplete.jsx';
import IssuerAutocomplete from './IssuerAutocomplete.jsx';
import { searchCusips } from './issuer-search.js';
import { applyCatalogueEntry, catalogueEntry, catalogueIssuers, clearCatalogueEntry, exactCatalogueIssuer } from './catalogue-form.js';

export default function IssuerBrandingFields({ form, setForm, file, setFile, disabled, catalogue }) {
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [failedPreset, setFailedPreset] = useState(null);
  const selectedIssuer = issuerPreset(form.issuerName);
  const entries = catalogue?.entries ?? [];
  const locked = disabled || !entries.length;
  useEffect(() => {
    if (!file) { setPreview(null); return undefined; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function selectEntry(entry) {
    if (!entry) return;
    if (exactCatalogueIssuer(catalogue, form.issuerName)?.id !== entry.issuerId) setFile(null);
    setForm((current) => applyCatalogueEntry(current, entry));
  }
  function changeIssuer(value) {
    const previous = exactCatalogueIssuer(catalogue, form.issuerName);
    const next = exactCatalogueIssuer(catalogue, value);
    if (previous?.id !== next?.id) setFile(null);
    setForm((current) => {
      const entry = catalogueEntry(catalogue, value, current.platform);
      return entry ? applyCatalogueEntry(current, entry) : clearCatalogueEntry(current, { issuerName: value });
    });
  }
  function changePlatform(value) {
    setForm((current) => {
      const entry = catalogueEntry(catalogue, current.issuerName, value);
      return entry ? applyCatalogueEntry(current, entry) : clearCatalogueEntry(current, { platform: value });
    });
  }
  function changeCusip(value) {
    const exact = entries.find((entry) => entry.cusip === value.trim().toUpperCase());
    if (exact) { selectEntry(exact); return; }
    setForm((current) => clearCatalogueEntry(current, { cusip: value }));
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
  const cusipOptions = searchCusips(entries, form.cusip).map((entry) => ({
    id: entry.id, label: entry.cusip, detail: `${entry.issuerName} / ${entry.platform || 'Issuer sponsored'}`,
  }));
  return <section className="create-event-section issuer-branding-fields">
    <header className="create-event-section-heading"><h2>Issuer and tokenised security</h2>
      <p>Select the issuer and platform, or search a demo CUSIP. No platform means issuer-sponsored tokens.</p></header>
    <div className="field-grid">
      <IssuerAutocomplete value={form.issuerName} disabled={locked} onChange={changeIssuer}
        issuers={catalogueIssuers(catalogue)} />
      <PlatformAutocomplete value={form.platform} disabled={locked} onChange={changePlatform}
        platforms={catalogue?.platforms ?? []} />
      <FuzzyCombobox label="Demo CUSIP" required value={form.cusip || ''} onChange={changeCusip}
        onSelect={(option) => selectEntry(entries.find((entry) => entry.id === option.id))}
        disabled={locked} options={cusipOptions} maxLength={80} placeholder="Search a CUSIP or issuer" />
      <label>Underlying security<input value={form.securityName || ''} readOnly disabled={locked} placeholder="Filled from the selected mapping" /></label>
      <label>Trading symbol<input value={form.securityTicker || ''} readOnly disabled={locked} placeholder="Filled where applicable" /></label>
      <label className="issuer-logo-field">Issuer logo (optional override)<input type="file" accept="image/png,image/jpeg" onChange={chooseLogo} disabled={disabled} />
        <small>PNG/JPEG, maximum 512 KB and 2048 x 2048 pixels. A custom upload takes precedence over the preset.</small></label>
      <div className="issuer-logo-preview" aria-live="polite">
        {logoUrl ? <img src={logoUrl} alt={`${selectedIssuer?.name || form.issuerName || 'Issuer'} preview`}
          onError={() => { if (!preview) setFailedPreset(presetUrl); }} /> : <span>{selectedIssuer ? 'Preset artwork is not installed. Upload an approved image.' : 'Issuer logo preview'}</span>}
        {file && <button type="button" className="button tertiary compact" onClick={() => setFile(null)} disabled={disabled}>Use preset instead</button>}
        {error && <p role="alert">{error}</p>}
      </div>
    </div>
  </section>;
}
