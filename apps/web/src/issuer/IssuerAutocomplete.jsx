import { ISSUER_PRESETS } from '@pv/shared';
import FuzzyCombobox from '../components/FuzzyCombobox.jsx';
import { searchIssuerSecurities } from './issuer-search.js';

export default function IssuerAutocomplete({ value, onChange, onBlur, onSelect, disabled, issuers = ISSUER_PRESETS }) {
  const options = searchIssuerSecurities(issuers, value);
  return <FuzzyCombobox label="Official issuer name" required value={value} onChange={onChange}
    onSelect={(option) => onSelect ? onSelect(option) : onChange(option.issuerName)}
    onBlur={onBlur} disabled={disabled} options={options} maxLength={160}
    placeholder="Search and select an issuer" />;
}
