import { faSearch } from "@fortawesome/free-solid-svg-icons"
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome"
import { Region } from "@ourworldindata/utils"
import { useState, useEffect } from "react"
import {} from "./DataCatalog.js"
import { SelectedCountriesPills } from "./SelectedCountriesPills.js"
import { DataCatalogSearchInput } from "./DataCatalogSearchInput.js"
import { DataCatalogCountrySelector } from "./DataCatalogCountrySelector.js"

export const DataCatalogSearchbar = ({
    selectedCountries,
    query,
    setQuery,
    removeCountry,
    addCountry,
    requireAllCountries,
    selectedCountryNames,
    toggleRequireAllCountries,
}: {
    selectedCountries: Region[]
    selectedCountryNames: Set<string>
    query: string
    setQuery: (query: string) => void
    removeCountry: (country: string) => void
    addCountry: (country: string) => void
    requireAllCountries: boolean
    toggleRequireAllCountries: () => void
}) => {
    // Storing this in local state so that query params don't update during typing
    const [localQuery, setLocalQuery] = useState(query)
    // sync local query with global query when browser navigation occurs
    useEffect(() => {
        setLocalQuery(query)
    }, [query])

    // Uses CSS to fake an input bar that will highlight correctly using :focus-within
    // without highlighting when the country selector is focused
    return (
        <>
            <div className="data-catalog-pseudo-input">
                <button
                    className="data-catalog-pseudo-input__submit-button"
                    aria-label="Submit search"
                    onClick={() => setQuery(localQuery)}
                >
                    <FontAwesomeIcon icon={faSearch} />
                </button>
                <SelectedCountriesPills
                    selectedCountries={selectedCountries}
                    removeCountry={removeCountry}
                />
                <DataCatalogSearchInput
                    value={localQuery}
                    setLocalQuery={setLocalQuery}
                    setGlobalQuery={setQuery}
                />
            </div>
            <DataCatalogCountrySelector
                requireAllCountries={requireAllCountries}
                toggleRequireAllCountries={toggleRequireAllCountries}
                selectedCountryNames={selectedCountryNames}
                addCountry={addCountry}
                removeCountry={removeCountry}
            />
        </>
    )
}
