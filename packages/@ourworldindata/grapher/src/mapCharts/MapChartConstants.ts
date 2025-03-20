import { ColorScaleBin } from "../color/ColorScaleBin"
import { Bounds, PointVector, ColumnSlug } from "@ourworldindata/utils"
import {
    MapProjectionName,
    Color,
    Time,
    GrapherChartType,
    GrapherTabOption,
    SeriesName,
} from "@ourworldindata/types"
import { ChartManager } from "../chart/ChartManager"
import { MapConfig } from "./MapConfig"
import { ChartSeries } from "../chart/ChartInterface"
import { SelectionArray } from "../selection/SelectionArray"
import { CoreColumn } from "@ourworldindata/core-table"

export type GeoFeature = GeoJSON.Feature<GeoJSON.GeometryObject>
export type MapBracket = ColorScaleBin
export const MAP_HOVER_TARGET_RANGE = 20

export interface MapEntity {
    id: string | number | undefined
    series:
        | ChoroplethSeries
        | {
              value: string
          }
}

export interface ChoroplethSeries extends ChartSeries {
    value: number | string
    time: number
    isSelected?: boolean
    highlightFillColor: Color
}

export interface ChoroplethMapManager {
    choroplethData: Map<SeriesName, ChoroplethSeries>
    choroplethMapBounds: Bounds
    projection: MapProjectionName
    noDataColor: string
    focusBracket?: MapBracket
    focusEntity?: MapEntity
    onClick: (d: GeoFeature, ev: React.MouseEvent<SVGElement>) => void
    onMapMouseOver: (d: GeoFeature) => void
    onMapMouseLeave: () => void
    isStatic?: boolean
    zoomCountry?: string
    selectionArray: SelectionArray
    mapColumn?: CoreColumn
    highlightCountries?: string[]
}

export interface RenderFeature {
    id: string
    geo: GeoFeature
    path: string
    bounds: Bounds
    center: PointVector
}

export interface MapChartManager extends ChartManager {
    mapColumnSlug?: ColumnSlug
    tab?: GrapherTabOption // Used to switch to chart tab on map click
    type?: GrapherChartType // Used to determine the "Click to select" text in MapTooltip
    isLineChartThatTurnedIntoDiscreteBar?: boolean // Used to determine whether to reset the timeline on map click
    hasTimeline?: boolean // Used to determine whether to reset the timeline on map click
    resetHandleTimeBounds?: () => void // Used to reset the timeline on map click
    mapConfig?: MapConfig
    endTime?: Time
    title?: string
}
