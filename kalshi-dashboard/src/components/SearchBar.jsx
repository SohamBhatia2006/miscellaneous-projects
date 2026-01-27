import { useState } from 'react';

export default function SearchBar({ onSearch, placeholder = '> filter...' }) {
  const [value, setValue] = useState('');

  function handleSubmit(e) {
    e.preventDefault();
    onSearch(value.trim());
  }

  function handleChange(e) {
    setValue(e.target.value);
    if (e.target.value === '') onSearch('');
  }

  return (
    <form className="search-bar" onSubmit={handleSubmit}>
      <span className="search-prompt">$</span>
      <input
        type="text"
        value={value}
        onChange={handleChange}
        placeholder={placeholder}
        spellCheck={false}
      />
    </form>
  );
}
