import { ISSUER_PRESETS } from '@pv/shared';
import FuzzyCombobox from '../components/FuzzyCombobox.jsx';
import { searchIssuers } from './issuer-search.js';

export default function IssuerAutocomplete({ value, onChange, onBlur, disabled }) {
  const options = searchIssuers(ISSUER_PRESETS, value).map((issuer) => ({
    id: issuer.id, label: issuer.name, detail: issuer.securities.map((security) => security.ticker).join(' / '),
  }));
  return <FuzzyCombobox label="Official issuer name" required value={value} onChange={onChange}
    onBlur={onBlur} disabled={disabled} options={options} maxLength={160}
    placeholder="Search an issuer or enter another official name" />;
}
