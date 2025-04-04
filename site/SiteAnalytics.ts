import { GrapherAnalytics, EventCategory } from "@ourworldindata/grapher"
import { SearchCategoryFilter } from "./search/searchTypes.js"
import {
    CatalogFilterType,
    DataCatalogState,
} from "./DataCatalog/DataCatalogState.js"
import {
    getFiltersOfType,
    IDataCatalogHit,
} from "./DataCatalog/DataCatalogUtils.js"
import { set } from "lodash"

export class SiteAnalytics extends GrapherAnalytics {
    logPageNotFoundError(url: string) {
        this.logToGA({
            event: EventCategory.SiteError,
            eventAction: "not_found",
            eventContext: url,
        })
    }

    logCountryPageSearchQuery(query: string) {
        this.logToGA({
            event: EventCategory.Filter,
            eventAction: "country_page_search",
            eventContext: query,
        })
    }

    logSearchClick({
        query,
        position,
        url,
        positionInSection,
        cardPosition,
        positionWithinCard,
        filter,
    }: {
        query: string
        position: string
        positionInSection: string
        cardPosition?: string
        positionWithinCard?: string
        url: string
        filter: SearchCategoryFilter
    }) {
        this.logToGA({
            event: EventCategory.SiteSearchClick,
            eventAction: "click",
            eventContext: JSON.stringify({
                query,
                position,
                positionInSection,
                cardPosition,
                positionWithinCard,
                filter,
            }),
            eventTarget: url,
        })
    }

    logInstantSearchClick({
        query,
        url,
        position,
    }: {
        query: string
        url: string
        position: string
    }) {
        this.logToGA({
            event: EventCategory.SiteInstantSearchClick,
            eventAction: "click",
            eventContext: JSON.stringify({ query, position }),
            eventTarget: url,
        })
    }

    logSearchFilterClick({ key }: { key: string }) {
        this.logToGA({
            event: EventCategory.SiteSearchFilterClick,
            eventAction: "click",
            eventContext: key,
        })
    }

    logDodShown(id: string) {
        this.logToGA({
            event: EventCategory.DetailOnDemand,
            eventAction: "show",
            eventTarget: id,
        })
    }

    logDataCatalogSearch(state: DataCatalogState) {
        this.logToGA({
            event: EventCategory.DataCatalogSearch,
            eventAction: "search",
            eventContext: JSON.stringify({
                ...state,
                // TODO: fix ReferenceError: Cannot access 'SiteAnalytics' before initialization
                // topics: Array.from(
                //     getFiltersOfType(state, CatalogFilterType.TOPIC)
                // ),
                // selectedCountryNames: Array.from(
                //     getFiltersOfType(state, CatalogFilterType.COUNTRY)
                // ),
            }),
        })
    }

    logDataCatalogResultClick(
        hit: IDataCatalogHit,
        position: number,
        source: "ribbon" | "search",
        ribbonTag?: string
    ) {
        const eventContext = {
            position,
            source,
        }
        if (ribbonTag) set(eventContext, "ribbonTag", ribbonTag)
        this.logToGA({
            event: EventCategory.DataCatalogResultClick,
            eventAction: "click",
            eventContext: JSON.stringify(eventContext),
            eventTarget: hit.slug,
        })
    }
}
