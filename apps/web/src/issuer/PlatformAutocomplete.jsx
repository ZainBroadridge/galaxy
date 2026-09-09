import { TOKEN_PLATFORMS } from '@pv/shared';
import FuzzyCombobox from '../components/FuzzyCombobox.jsx';
import { searchPlatforms } from './issuer-search.js';

export default function PlatformAutocomplete({ value, onChange, disabled }) {
  const options = searchPlatforms(TOKEN_PLATFORMS, value).map((platform) => ({ id: platform, label: platform }));
  return <FuzzyCombobox label="Tokenization platform (optional)" value={value} onChange={onChange}
    disabled={disabled} options={options} maxLength={80} placeholder="Search or enter a tokenization platform"
    onBlur={() => {
      const exact = TOKEN_PLATFORMS.find((platform) => platform.toLowerCase() === value.trim().toLowerCase());
      if (exact) onChange(exact);
    }} />;
}
