import {
    Bounds,
    DEFAULT_BOUNDS,
    getRelativeMouse,
    sortBy,
    guid,
    difference,
    exposeInstanceOnWindow,
    isPresent,
    PointVector,
    Color,
    HorizontalAlign,
    PrimitiveType,
    makeIdForHumanConsumption,
} from "@ourworldindata/utils"
import { observable, computed, action } from "mobx"
import { observer } from "mobx-react"
import {
    HorizontalCategoricalColorLegend,
    HorizontalColorLegendManager,
    HorizontalNumericColorLegend,
} from "../horizontalColorLegend/HorizontalColorLegends"
import { MapProjectionGeos } from "./MapProjections"
import { GeoPathRoundingContext } from "./GeoPathRoundingContext"
import { select } from "d3-selection"
import { easeCubic } from "d3-ease"
import { Quadtree, quadtree } from "d3-quadtree"
import { MapTooltip } from "./MapTooltip"
import { TooltipState } from "../tooltip/Tooltip.js"
import { isOnTheMap } from "./EntitiesOnTheMap"
import { OwidTable, CoreColumn } from "@ourworldindata/core-table"
import {
    GeoFeature,
    MapBracket,
    MapChartManager,
    MapEntity,
    ChoroplethMapManager,
    RenderFeature,
    ChoroplethSeries,
    MAP_HOVER_TARGET_RANGE,
} from "./MapChartConstants"
import { MapConfig } from "./MapConfig"
import { ColorScale, ColorScaleManager } from "../color/ColorScale"
import {
    BASE_FONT_SIZE,
    GRAPHER_FRAME_PADDING_HORIZONTAL,
    Patterns,
} from "../core/GrapherConstants"
import { ChartInterface } from "../chart/ChartInterface"
import {
    CategoricalBin,
    ColorScaleBin,
    NumericBin,
} from "../color/ColorScaleBin"
import * as topojson from "topojson-client"
import { MapTopology } from "./MapTopology"
import { getCountriesByProjection } from "./WorldRegionsToProjection"
import {
    ColorSchemeName,
    MapProjectionName,
    GRAPHER_TAB_OPTIONS,
    SeriesName,
    EntityName,
} from "@ourworldindata/types"
import {
    autoDetectYColumnSlugs,
    makeClipPath,
    makeSelectionArray,
} from "../chart/ChartUtils"
import { NoDataModal } from "../noDataModal/NoDataModal"
import { ColorScaleConfig } from "../color/ColorScaleConfig"
import { SelectionArray } from "../selection/SelectionArray"
import { Component, createRef } from "react"

const DEFAULT_STROKE_COLOR = "#333"
const CHOROPLETH_MAP_CLASSNAME = "ChoroplethMap"

// TODO refactor to use transform pattern, bit too much info for a pure component

interface MapChartProps {
    bounds?: Bounds
    manager: MapChartManager
    containerElement?: HTMLDivElement
}

// Get the underlying geographical topology elements we're going to display
const GeoFeatures: GeoFeature[] = (
    topojson.feature(
        MapTopology as any,
        MapTopology.objects.world as any
    ) as any
).features

// Get the svg path specification string for every feature
const geoPathCache = new Map<MapProjectionName, string[]>()
const geoPathsFor = (projectionName: MapProjectionName): string[] => {
    if (geoPathCache.has(projectionName))
        return geoPathCache.get(projectionName)!

    // Use this context to round the path coordinates to a set number of decimal places
    const ctx = new GeoPathRoundingContext()
    const projectionGeo = MapProjectionGeos[projectionName].context(ctx)
    const strs = GeoFeatures.map((feature) => {
        ctx.beginPath() // restart the path
        projectionGeo(feature)
        return ctx.result()
    })

    projectionGeo.context(null) // reset the context for future calls

    geoPathCache.set(projectionName, strs)
    return geoPathCache.get(projectionName)!
}

// Get the bounding box for every geographical feature
const geoBoundsCache = new Map<MapProjectionName, Bounds[]>()
const geoBoundsFor = (projectionName: MapProjectionName): Bounds[] => {
    if (geoBoundsCache.has(projectionName))
        return geoBoundsCache.get(projectionName)!
    const projectionGeo = MapProjectionGeos[projectionName]
    const bounds = GeoFeatures.map((feature) => {
        const corners = projectionGeo.bounds(feature)

        const bounds = Bounds.fromCorners(
            new PointVector(...corners[0]),
            new PointVector(...corners[1])
        )

        // HACK (Mispy): The path generator calculates weird bounds for Fiji (probably it wraps around the map)
        if (feature.id === "Fiji")
            return bounds.set({
                x: bounds.right - bounds.height,
                width: bounds.height,
            })
        return bounds
    })

    geoBoundsCache.set(projectionName, bounds)
    return geoBoundsCache.get(projectionName)!
}

// Bundle GeoFeatures with the calculated info needed to render them
const renderFeaturesCache = new Map<MapProjectionName, RenderFeature[]>()
const renderFeaturesFor = (
    projectionName: MapProjectionName
): RenderFeature[] => {
    if (renderFeaturesCache.has(projectionName))
        return renderFeaturesCache.get(projectionName)!
    const geoBounds = geoBoundsFor(projectionName)
    const geoPaths = geoPathsFor(projectionName)
    const feats = GeoFeatures.map((geo, index) => ({
        id: geo.id as string,
        geo: geo,
        path: geoPaths[index],
        bounds: geoBounds[index],
        center: geoBounds[index].centerPos,
    }))

    renderFeaturesCache.set(projectionName, feats)
    return renderFeaturesCache.get(projectionName)!
}

@observer
export class MapChart
    extends Component<MapChartProps>
    implements ChartInterface, HorizontalColorLegendManager, ColorScaleManager
{
    @observable focusEntity?: MapEntity
    @observable focusBracket?: MapBracket
    @observable tooltipState = new TooltipState<{
        featureId: string
        clickable: boolean
    }>()

    transformTable(table: OwidTable): OwidTable {
        if (!table.has(this.mapColumnSlug)) return table
        const transformedTable = this.dropNonMapEntities(table)
            .dropRowsWithErrorValuesForColumn(this.mapColumnSlug)
            .interpolateColumnWithTolerance(
                this.mapColumnSlug,
                this.mapConfig.timeTolerance,
                this.mapConfig.toleranceStrategy
            )
        return transformedTable
    }

    private dropNonMapEntities(table: OwidTable): OwidTable {
        const entityNamesToSelect =
            table.availableEntityNames.filter(isOnTheMap)
        return table.filterByEntityNames(entityNamesToSelect)
    }

    @computed get inputTable(): OwidTable {
        return this.manager.table
    }

    @computed get transformedTable(): OwidTable {
        return (
            this.manager.transformedTable ??
            this.transformTable(this.inputTable)
        )
    }

    @computed get failMessage(): string {
        if (this.mapColumn.isMissing) return "Missing map column"
        return ""
    }

    @computed get mapColumnSlug(): string {
        return (
            this.manager.mapColumnSlug ??
            autoDetectYColumnSlugs(this.manager)[0]!
        )
    }

    @computed private get mapColumn(): CoreColumn {
        return this.transformedTable.get(this.mapColumnSlug)
    }

    // The map column without tolerance and timeline filtering applied
    @computed private get mapColumnUntransformed(): CoreColumn {
        return this.dropNonMapEntities(this.inputTable).get(this.mapColumnSlug)
    }

    @computed private get targetTime(): number | undefined {
        return this.manager.endTime
    }

    @computed get bounds(): Bounds {
        return this.props.bounds ?? DEFAULT_BOUNDS
    }

    @computed get choroplethData(): Map<SeriesName, ChoroplethSeries> {
        return this.seriesMap
    }

    base: React.RefObject<SVGGElement> = createRef()
    @action.bound onMapMouseOver(feature: GeoFeature): void {
        const series =
            feature.id === undefined
                ? undefined
                : this.seriesMap.get(feature.id as string)
        this.focusEntity = {
            id: feature.id,
            series: series || { value: "No data" },
        }

        if (feature.id !== undefined) {
            const featureId = feature.id as string,
                clickable = this.isEntityClickable(featureId)
            this.tooltipState.target = { featureId, clickable }
        }
    }

    @action.bound onMapMouseMove(ev: React.MouseEvent): void {
        const ref = this.manager?.base?.current
        if (ref) {
            this.tooltipState.position = getRelativeMouse(ref, ev)
        }
    }

    @action.bound onMapMouseLeave(): void {
        this.focusEntity = undefined
        this.tooltipState.target = null
    }

    @computed get manager(): MapChartManager {
        return this.props.manager
    }

    @computed private get entityNamesWithData(): Set<EntityName> {
        // We intentionally use `inputTable` here instead of `transformedTable`, because of countries where there is no data
        // available in the map view for the current year, but data might still be available for other chart types
        return this.inputTable.entitiesWith([this.mapColumnSlug])
    }

    // Determine if we can go to line chart by clicking on a given map entity
    private isEntityClickable(entityName?: EntityName): boolean {
        if (!this.manager.mapIsClickable || !entityName) return false
        return this.entityNamesWithData.has(entityName)
    }

    @computed private get selectionArray(): SelectionArray {
        return makeSelectionArray(this.manager.selection)
    }

    @action.bound onClick(
        d: GeoFeature,
        ev: React.MouseEvent<SVGElement>
    ): void {
        const entityName = d.id as EntityName
        if (!this.isEntityClickable(entityName)) return

        if (!ev.shiftKey) {
            this.selectionArray.setSelectedEntities([entityName])
            this.manager.tab = GRAPHER_TAB_OPTIONS.chart
            if (
                this.manager.isLineChartThatTurnedIntoDiscreteBar &&
                this.manager.hasTimeline
            ) {
                this.manager.resetHandleTimeBounds?.()
            }
        } else this.selectionArray.toggleSelection(entityName)
    }

    componentWillUnmount(): void {
        this.onMapMouseLeave()
        this.onLegendMouseLeave()
    }

    @action.bound onLegendMouseOver(bracket: MapBracket): void {
        this.focusBracket = bracket
    }

    @action.bound onLegendMouseLeave(): void {
        this.focusBracket = undefined
    }

    @computed get mapConfig(): MapConfig {
        return this.manager.mapConfig || new MapConfig()
    }

    @action.bound onProjectionChange(value: MapProjectionName): void {
        this.mapConfig.projection = value
    }

    @computed private get formatTooltipValueIfCustom(): (
        d: PrimitiveType
    ) => string | undefined {
        const { mapConfig, colorScale } = this

        return (d: PrimitiveType): string | undefined => {
            if (!mapConfig.tooltipUseCustomLabels) return undefined
            // Find the bin (and its label) that this value belongs to
            const bin = colorScale.getBinForValue(d)
            const label = bin?.label
            if (label !== undefined && label !== "") return label
            else return undefined
        }
    }

    @computed get series(): ChoroplethSeries[] {
        const { mapColumn, selectionArray, targetTime } = this
        if (mapColumn.isMissing) return []
        if (targetTime === undefined) return []

        return mapColumn.owidRows
            .map((row) => {
                const { entityName, value, originalTime } = row
                const color = this.colorScale.getColor(value) || "red" // todo: color fix
                if (!color) return undefined
                return {
                    seriesName: entityName,
                    time: originalTime,
                    value,
                    isSelected: selectionArray.selectedSet.has(entityName),
                    color,
                    highlightFillColor: color,
                }
            })
            .filter(isPresent)
    }

    @computed private get seriesMap(): Map<SeriesName, ChoroplethSeries> {
        const map = new Map<SeriesName, ChoroplethSeries>()
        this.series.forEach((series) => {
            map.set(series.seriesName, series)
        })
        return map
    }

    @computed get colorScaleColumn(): CoreColumn {
        // Use the table before any transforms to collect all possible values over time.
        // Otherwise the legend changes as you slide the timeline handle.
        return this.mapColumnUntransformed
    }

    colorScale = new ColorScale(this)

    @computed get colorScaleConfig(): ColorScaleConfig {
        return (
            ColorScaleConfig.fromDSL(this.mapColumn.def) ??
            this.mapConfig.colorScale
        )
    }

    defaultBaseColorScheme = ColorSchemeName.BuGn
    hasNoDataBin = true

    componentDidMount(): void {
        if (!this.manager.disableIntroAnimation) {
            select(this.base.current)
                .selectAll(`.${CHOROPLETH_MAP_CLASSNAME} path`)
                .attr("data-fill", function () {
                    return (this as SVGPathElement).getAttribute("fill")
                })
                .attr("fill", this.colorScale.noDataColor)
                .transition()
                .duration(500)
                .ease(easeCubic)
                .attr("fill", function () {
                    return (this as SVGPathElement).getAttribute("data-fill")
                })
                .attr("data-fill", function () {
                    return (this as SVGPathElement).getAttribute("fill")
                })
        }
        exposeInstanceOnWindow(this)
    }

    @computed get legendData(): ColorScaleBin[] {
        return this.colorScale.legendBins
    }

    @computed get equalSizeBins(): boolean | undefined {
        return this.colorScale.config.equalSizeBins
    }

    @computed get focusValue(): string | number | undefined {
        return this.focusEntity?.series?.value
    }

    @computed get fontSize(): number {
        return this.manager.fontSize ?? BASE_FONT_SIZE
    }

    @computed get noDataColor(): Color {
        return this.colorScale.noDataColor
    }

    @computed get choroplethMapBounds(): Bounds {
        return this.bounds.padBottom(this.legendHeight + 4)
    }

    @computed get projection(): MapProjectionName {
        return this.mapConfig.projection
    }

    @computed get numericLegendData(): ColorScaleBin[] {
        if (
            this.hasCategorical ||
            !this.legendData.some(
                (bin) =>
                    (bin as CategoricalBin).value === "No data" && !bin.isHidden
            )
        )
            return this.legendData.filter(
                (bin) => bin instanceof NumericBin && !bin.isHidden
            )

        const bins: ColorScaleBin[] = this.legendData.filter(
            (bin) =>
                (bin instanceof NumericBin || bin.value === "No data") &&
                !bin.isHidden
        )
        for (const bin of bins)
            if (bin instanceof CategoricalBin && bin.value === "No data")
                bin.props = {
                    ...bin.props,
                    patternRef: Patterns.noDataPattern,
                }

        return [bins[bins.length - 1], ...bins.slice(0, -1)]
    }

    @computed get hasNumeric(): boolean {
        return this.numericLegendData.length > 1
    }

    @computed get categoricalLegendData(): CategoricalBin[] {
        const bins = this.legendData.filter(
            (bin): bin is CategoricalBin =>
                bin instanceof CategoricalBin && !bin.isHidden
        )
        for (const bin of bins)
            if (bin.value === "No data")
                bin.props = {
                    ...bin.props,
                    patternRef: Patterns.noDataPattern,
                }
        return bins
    }

    @computed get hasCategorical(): boolean {
        return this.categoricalLegendData.length > 1
    }

    @computed get numericFocusBracket(): ColorScaleBin | undefined {
        const { focusBracket, focusValue } = this
        const { numericLegendData } = this

        if (focusBracket) return focusBracket

        if (focusValue !== undefined)
            return numericLegendData.find((bin) => bin.contains(focusValue))

        return undefined
    }

    @computed get categoricalFocusBracket(): CategoricalBin | undefined {
        const { focusBracket, focusValue } = this
        const { categoricalLegendData } = this
        if (focusBracket && focusBracket instanceof CategoricalBin)
            return focusBracket

        if (focusValue !== undefined)
            return categoricalLegendData.find((bin) => bin.contains(focusValue))

        return undefined
    }

    @computed get categoricalBinStroke(): Color {
        return DEFAULT_STROKE_COLOR
    }

    @computed get legendMaxWidth(): number {
        // it seems nice to have just a little bit of
        // extra padding left and right
        return this.bounds.width * 0.95
    }

    @computed get legendX(): number {
        return this.bounds.x + (this.bounds.width - this.legendMaxWidth) / 2
    }

    @computed get legendHeight(): number {
        return this.categoryLegendHeight + this.numericLegendHeight + 10
    }

    @computed get numericLegendHeight(): number {
        return this.numericLegend ? this.numericLegend.height : 0
    }

    @computed get categoryLegendHeight(): number {
        return this.categoryLegend ? this.categoryLegend.height + 5 : 0
    }

    @computed get categoryLegend():
        | HorizontalCategoricalColorLegend
        | undefined {
        return this.categoricalLegendData.length > 1
            ? new HorizontalCategoricalColorLegend({ manager: this })
            : undefined
    }

    @computed get numericLegend(): HorizontalNumericColorLegend | undefined {
        return this.numericLegendData.length > 1
            ? new HorizontalNumericColorLegend({ manager: this })
            : undefined
    }

    @computed get categoryLegendY(): number {
        const { categoryLegend, bounds, categoryLegendHeight } = this

        if (categoryLegend) return bounds.bottom - categoryLegendHeight
        return 0
    }

    @computed get legendAlign(): HorizontalAlign {
        return HorizontalAlign.center
    }

    @computed get numericLegendY(): number {
        const {
            numericLegend,
            numericLegendHeight,
            bounds,
            categoryLegendHeight,
        } = this

        if (numericLegend)
            return (
                bounds.bottom - categoryLegendHeight - numericLegendHeight - 4
            )
        return 0
    }

    @computed get isStatic(): boolean {
        return this.manager.isStatic ?? false
    }

    @computed get renderUid(): number {
        return guid()
    }

    @computed get clipPath(): { id: string; element: React.ReactElement } {
        return makeClipPath(this.renderUid, this.choroplethMapBounds)
    }

    renderMapLegend(): React.ReactElement {
        const { numericLegend, categoryLegend } = this

        return (
            <>
                {numericLegend && (
                    <HorizontalNumericColorLegend manager={this} />
                )}
                {categoryLegend && (
                    <HorizontalCategoricalColorLegend manager={this} />
                )}
            </>
        )
    }

    renderStatic(): React.ReactElement {
        return (
            <>
                {/* Clipping the chart area is only necessary when the map is
                    zoomed in. If it isn't, then we don't add a clipping element
                    since it introduces noise in SVG editing programs like Figma. */}
                {this.projection === MapProjectionName.World ? (
                    <ChoroplethMap manager={this} />
                ) : (
                    <>
                        {this.clipPath.element}
                        <g clipPath={this.clipPath.id}>
                            <ChoroplethMap manager={this} />
                        </g>
                    </>
                )}
                {this.renderMapLegend()}
            </>
        )
    }

    renderInteractive(): React.ReactElement {
        const { tooltipState } = this

        const sparklineWidth = this.manager.shouldPinTooltipToBottom
            ? this.bounds.width + (GRAPHER_FRAME_PADDING_HORIZONTAL - 1) * 2
            : undefined

        return (
            <g
                ref={this.base}
                className="mapTab"
                onMouseMove={this.onMapMouseMove}
            >
                {this.clipPath.element}
                <g clipPath={this.clipPath.id}>
                    <ChoroplethMap manager={this} />
                </g>
                {this.renderMapLegend()}
                {tooltipState.target && (
                    <MapTooltip
                        tooltipState={tooltipState}
                        timeSeriesTable={this.inputTable}
                        formatValueIfCustom={this.formatTooltipValueIfCustom}
                        manager={this.manager}
                        colorScaleManager={this}
                        targetTime={this.targetTime}
                        sparklineWidth={sparklineWidth}
                    />
                )}
            </g>
        )
    }

    render(): React.ReactElement {
        if (this.failMessage)
            return (
                <NoDataModal
                    manager={this.manager}
                    bounds={this.props.bounds}
                    message={this.failMessage}
                />
            )

        return this.isStatic ? this.renderStatic() : this.renderInteractive()
    }
}

declare type SVGMouseEvent = React.MouseEvent<SVGElement>

@observer
class ChoroplethMap extends Component<{
    manager: ChoroplethMapManager
}> {
    base: React.RefObject<SVGGElement> = createRef()

    private focusStrokeColor = "#111"

    private defaultStrokeWidth = 0.3
    private focusStrokeWidth = 1.5
    private selectedStrokeWidth = 1
    private patternStrokeWidth = 0.7

    private blurFillOpacity = 0.2
    private blurStrokeOpacity = 0.5

    @computed private get manager(): ChoroplethMapManager {
        return this.props.manager
    }

    @computed.struct private get bounds(): Bounds {
        return this.manager.choroplethMapBounds
    }

    @computed.struct private get choroplethData(): Map<
        string,
        ChoroplethSeries
    > {
        return this.manager.choroplethData
    }

    @computed.struct private get defaultFill(): string {
        return this.manager.noDataColor
    }

    // Combine bounding boxes to get the extents of the entire map
    @computed private get mapBounds(): Bounds {
        return Bounds.merge(geoBoundsFor(this.manager.projection))
    }

    @computed private get focusBracket(): ColorScaleBin | undefined {
        return this.manager.focusBracket
    }

    @computed private get focusEntity(): MapEntity | undefined {
        return this.manager.focusEntity
    }

    // Check if a geo entity is currently focused, either directly or via the bracket
    private hasFocus(id: string): boolean {
        const { choroplethData, focusBracket, focusEntity } = this
        if (focusEntity && focusEntity.id === id) return true
        else if (!focusBracket) return false

        const datum = choroplethData.get(id) || null
        if (focusBracket.contains(datum?.value)) return true
        else return false
    }

    private isSelected(id: string): boolean | undefined {
        return this.choroplethData.get(id)!.isSelected
    }

    // Viewport for each projection, defined by center and width+height in fractional coordinates
    @computed private get viewport(): {
        x: number
        y: number
        width: number
        height: number
    } {
        const viewports = {
            World: { x: 0.565, y: 0.5, width: 1, height: 1 },
            Europe: { x: 0.53, y: 0.22, width: 0.2, height: 0.2 },
            Africa: { x: 0.49, y: 0.7, width: 0.21, height: 0.38 },
            NorthAmerica: { x: 0.49, y: 0.4, width: 0.19, height: 0.32 },
            SouthAmerica: { x: 0.52, y: 0.815, width: 0.1, height: 0.26 },
            Asia: { x: 0.74, y: 0.45, width: 0.36, height: 0.5 },
            Oceania: { x: 0.51, y: 0.75, width: 0.1, height: 0.2 },
        }

        return viewports[this.manager.projection]
    }

    // Calculate what scaling should be applied to the untransformed map to match the current viewport to the container
    @computed private get viewportScale(): number {
        const { bounds, viewport, mapBounds } = this
        const viewportWidth = viewport.width * mapBounds.width
        const viewportHeight = viewport.height * mapBounds.height
        return Math.min(
            bounds.width / viewportWidth,
            bounds.height / viewportHeight
        )
    }

    @computed private get matrixTransform(): string {
        const { bounds, mapBounds, viewport, viewportScale } = this

        // Calculate our reference dimensions. These values are independent of the current
        // map translation and scaling.
        const mapX = mapBounds.x + 1
        const mapY = mapBounds.y + 1

        // Work out how to center the map, accounting for the new scaling we've worked out
        const newWidth = mapBounds.width * viewportScale
        const newHeight = mapBounds.height * viewportScale
        const boundsCenterX = bounds.left + bounds.width / 2
        const boundsCenterY = bounds.top + bounds.height / 2
        const newCenterX =
            mapX + (viewportScale - 1) * mapBounds.x + viewport.x * newWidth
        const newCenterY =
            mapY + (viewportScale - 1) * mapBounds.y + viewport.y * newHeight
        const newOffsetX = boundsCenterX - newCenterX
        const newOffsetY = boundsCenterY - newCenterY

        const matrixStr = `matrix(${viewportScale},0,0,${viewportScale},${newOffsetX},${newOffsetY})`
        return matrixStr
    }

    // Features that aren't part of the current projection (e.g. India if we're showing Africa)
    @computed private get featuresOutsideProjection(): RenderFeature[] {
        return difference(
            renderFeaturesFor(this.manager.projection),
            this.featuresInProjection
        )
    }

    @computed private get featuresInProjection(): RenderFeature[] {
        const { projection } = this.manager
        const features = renderFeaturesFor(projection)
        if (projection === MapProjectionName.World) return features

        const countriesByProjection = getCountriesByProjection(projection)
        if (countriesByProjection === undefined) return []

        return features.filter((feature) =>
            countriesByProjection.has(feature.id)
        )
    }

    @computed private get featuresWithNoData(): RenderFeature[] {
        return difference(this.featuresInProjection, this.featuresWithData)
    }

    @computed private get featuresWithData(): RenderFeature[] {
        return this.featuresInProjection.filter((feature) =>
            this.choroplethData.has(feature.id)
        )
    }

    // Map uses a hybrid approach to mouseover
    // If mouse is inside an element, that is prioritized
    // Otherwise we do a quadtree search for the closest center point of a feature bounds,
    // so that we can hover very small countries without trouble

    @computed private get quadtree(): Quadtree<RenderFeature> {
        return quadtree<RenderFeature>()
            .x(({ center }) => center.x)
            .y(({ center }) => center.y)
            .addAll(this.featuresInProjection)
    }

    @observable private hoverEnterFeature?: RenderFeature
    @observable private hoverNearbyFeature?: RenderFeature
    @action.bound private onMouseMove(ev: React.MouseEvent<SVGGElement>): void {
        if (ev.shiftKey) this.showSelectedStyle = true // Turn on highlight selection. To turn off, user can switch tabs.
        if (this.hoverEnterFeature) return

        const subunits = this.base.current?.querySelector(".subunits")
        if (subunits) {
            const { x, y } = getRelativeMouse(subunits, ev)
            const distance = MAP_HOVER_TARGET_RANGE
            const feature = this.quadtree.find(x, y, distance)

            if (feature) {
                if (feature.id !== this.hoverNearbyFeature?.id) {
                    this.hoverNearbyFeature = feature
                    this.manager.onMapMouseOver(feature.geo)
                }
            } else if (this.hoverNearbyFeature) {
                this.hoverNearbyFeature = undefined
                this.manager.onMapMouseLeave()
            }
        } else console.error("subunits was falsy")
    }

    @action.bound private onMouseEnter(feature: RenderFeature): void {
        this.hoverEnterFeature = feature
        this.manager.onMapMouseOver(feature.geo)
    }

    @action.bound private onMouseLeave(): void {
        this.hoverEnterFeature = undefined
        this.manager.onMapMouseLeave()
    }

    @computed private get hoverFeature(): RenderFeature | undefined {
        return this.hoverEnterFeature || this.hoverNearbyFeature
    }

    @action.bound private onClick(ev: React.MouseEvent<SVGGElement>): void {
        if (this.hoverFeature !== undefined)
            this.manager.onClick(this.hoverFeature.geo, ev)
    }

    // If true selected countries will have an outline
    @observable private showSelectedStyle = false

    renderFeaturesOutsideProjection(): React.ReactElement | void {
        if (this.featuresOutsideProjection.length === 0) return

        const strokeWidth = this.defaultStrokeWidth / this.viewportScale

        return (
            <g
                id={makeIdForHumanConsumption("countries-outside-selection")}
                className="nonProjectionFeatures"
            >
                {this.featuresOutsideProjection.map((feature) => (
                    <path
                        key={feature.id}
                        id={makeIdForHumanConsumption(feature.id)}
                        d={feature.path}
                        strokeWidth={strokeWidth}
                        stroke="#aaa"
                        fill="#fff"
                    />
                ))}
            </g>
        )
    }

    renderFeaturesWithoutData(): React.ReactElement | void {
        if (this.featuresWithNoData.length === 0) return
        return (
            <g
                id={makeIdForHumanConsumption("countries-without-data")}
                className="noDataFeatures"
            >
                <defs>
                    <pattern
                        // Ids should be unique per document (!) not just a grapher instance -
                        // we disregard this for other patterns that are defined the same everywhere
                        // because id collisions there are benign but here the pattern will be different
                        // depending on the projection so we include this in the id
                        id={`${Patterns.noDataPatternForMapChart}-${this.manager.projection}`}
                        key={Patterns.noDataPatternForMapChart}
                        patternUnits="userSpaceOnUse"
                        width="4"
                        height="4"
                        patternTransform={`rotate(-45 2 2) scale(${
                            1 / this.viewportScale
                        })`} // <-- This scale here is crucial and map specific
                    >
                        <path
                            d="M -1,2 l 6,0"
                            stroke="#ccc"
                            strokeWidth={this.patternStrokeWidth}
                        />
                    </pattern>
                </defs>

                {this.featuresWithNoData.map((feature) => {
                    const isFocus = this.hasFocus(feature.id)
                    const outOfFocusBracket = !!this.focusBracket && !isFocus
                    const stroke = isFocus ? this.focusStrokeColor : "#aaa"
                    const fillOpacity = outOfFocusBracket
                        ? this.blurFillOpacity
                        : 1
                    const strokeOpacity = outOfFocusBracket
                        ? this.blurStrokeOpacity
                        : 1
                    const strokeWidth =
                        (isFocus
                            ? this.focusStrokeWidth
                            : this.defaultStrokeWidth) / this.viewportScale
                    return (
                        <path
                            key={feature.id}
                            id={makeIdForHumanConsumption(feature.id)}
                            d={feature.path}
                            strokeWidth={strokeWidth}
                            stroke={stroke}
                            strokeOpacity={strokeOpacity}
                            cursor="pointer"
                            fill={`url(#${Patterns.noDataPatternForMapChart}-${this.manager.projection})`}
                            fillOpacity={fillOpacity}
                            onClick={(ev: SVGMouseEvent): void =>
                                this.manager.onClick(feature.geo, ev)
                            }
                            onMouseEnter={(): void =>
                                this.onMouseEnter(feature)
                            }
                            onMouseLeave={this.onMouseLeave}
                        />
                    )
                })}
            </g>
        )
    }

    renderFeaturesWithData(): React.ReactElement | void {
        if (this.featuresWithData.length === 0) return

        return (
            <g id={makeIdForHumanConsumption("countries-with-data")}>
                {sortBy(
                    this.featuresWithData.map((feature) => {
                        const isFocus = this.hasFocus(feature.id)
                        const showSelectedStyle =
                            this.showSelectedStyle &&
                            this.isSelected(feature.id)
                        const outOfFocusBracket =
                            !!this.focusBracket && !isFocus
                        const series = this.choroplethData.get(
                            feature.id as string
                        )
                        const stroke =
                            isFocus || showSelectedStyle
                                ? this.focusStrokeColor
                                : DEFAULT_STROKE_COLOR
                        const fill = series ? series.color : this.defaultFill
                        const fillOpacity = outOfFocusBracket
                            ? this.blurFillOpacity
                            : 1
                        const strokeOpacity = outOfFocusBracket
                            ? this.blurStrokeOpacity
                            : 1
                        const strokeWidth =
                            (isFocus
                                ? this.focusStrokeWidth
                                : showSelectedStyle
                                  ? this.selectedStrokeWidth
                                  : this.defaultStrokeWidth) /
                            this.viewportScale

                        return (
                            <path
                                key={feature.id}
                                id={makeIdForHumanConsumption(feature.id)}
                                d={feature.path}
                                strokeWidth={strokeWidth}
                                stroke={stroke}
                                strokeOpacity={strokeOpacity}
                                cursor="pointer"
                                fill={fill}
                                fillOpacity={fillOpacity}
                                onClick={(ev: SVGMouseEvent): void =>
                                    this.manager.onClick(feature.geo, ev)
                                }
                                onMouseEnter={(): void =>
                                    this.onMouseEnter(feature)
                                }
                                onMouseLeave={this.onMouseLeave}
                            />
                        )
                    }),
                    (p) => p.props["strokeWidth"]
                )}
            </g>
        )
    }

    renderStatic(): React.ReactElement {
        return (
            <g
                id={makeIdForHumanConsumption("map")}
                transform={this.matrixTransform}
            >
                {this.renderFeaturesOutsideProjection()}
                {this.renderFeaturesWithoutData()}
                {this.renderFeaturesWithData()}
            </g>
        )
    }

    renderInteractive(): React.ReactElement {
        const { bounds, matrixTransform } = this

        // this needs to be referenced here or it will be recomputed on every mousemove
        const _cachedCentroids = this.quadtree

        // SVG layering is based on order of appearance in the element tree (later elements rendered on top)
        // The ordering here is quite careful
        return (
            <g
                ref={this.base}
                className={CHOROPLETH_MAP_CLASSNAME}
                onMouseDown={
                    (ev: SVGMouseEvent): void =>
                        ev.preventDefault() /* Without this, title may get selected while shift clicking */
                }
                onMouseMove={this.onMouseMove}
                onMouseLeave={this.onMouseLeave}
                style={this.hoverFeature ? { cursor: "pointer" } : {}}
            >
                <rect
                    x={bounds.x}
                    y={bounds.y}
                    width={bounds.width}
                    height={bounds.height}
                    fill="rgba(255,255,255,0)"
                    opacity={0}
                />
                <g className="subunits" transform={matrixTransform}>
                    {this.renderFeaturesOutsideProjection()}
                    {this.renderFeaturesWithoutData()}
                    {this.renderFeaturesWithData()}
                </g>
            </g>
        )
    }

    render(): React.ReactElement {
        return this.manager.isStatic
            ? this.renderStatic()
            : this.renderInteractive()
    }
}
