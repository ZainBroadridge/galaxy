import { TOKEN_PLATFORMS } from '@pv/shared';
import FuzzyCombobox from '../components/FuzzyCombobox.jsx';
import { searchPlatforms } from './issuer-search.js';

export default function PlatformAutocomplete({ value, onChange, disabled, platforms = TOKEN_PLATFORMS }) {
  const options = searchPlatforms(platforms, value).map((platform) => ({ id: platform, label: platform }));
  return <FuzzyCombobox label="Tokenization platform (optional)" value={value} onChange={onChange}
    disabled={disabled} options={options} maxLength={80} placeholder="Leave blank for issuer-sponsored tokens"
    onBlur={() => {
      const exact = platforms.find((platform) => platform.toLowerCase() === value.trim().toLowerCase());
      if (exact) onChange(exact);
    }} />;
}
