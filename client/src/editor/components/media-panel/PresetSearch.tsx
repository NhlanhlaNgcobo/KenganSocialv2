export function PresetSearch({ query, onQuery, collection, onCollection, count }: {
    query: string; onQuery: (value: string) => void;
    collection: string; onCollection: (value: string) => void; count: number;
}) {
    return <div className="ke-preset-search">
        <input className="ke-input" type="search" aria-label="Search presets" placeholder="Search by name or style…" value={query} onChange={(e) => onQuery(e.target.value)} />
        <div className="ke-preset-search__row">
            <div className="ke-seg ke-seg--text">
                <button className={collection === 'all' ? 'is-active' : ''} onClick={() => onCollection('all')}>All</button>
                <button className={collection === 'kengan' ? 'is-active' : ''} onClick={() => onCollection('kengan')}>Kengan collection</button>
            </div>
            <small aria-live="polite">{count} presets</small>
        </div>
        {!count ? <p className="ke-note">No matching presets. Try another name or clear the search.</p> : null}
    </div>;
}

export function matchesPreset(id: string, label: string, query: string, collection: string) {
    return (collection !== 'kengan' || id.startsWith('ks-')) && label.toLowerCase().includes(query.trim().toLowerCase());
}
