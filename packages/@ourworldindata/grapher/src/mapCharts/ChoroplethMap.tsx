import React from "react"
import {
    Bounds,
    difference,
    isTouchDevice,
    makeIdForHumanConsumption,
} from "@ourworldindata/utils"
import { computed, action, observable } from "mobx"
import { observer } from "mobx-react"
import { Quadtree, quadtree } from "d3-quadtree"
import {
    MapRenderFeature,
    SVGMouseEvent,
    GEO_FEATURES_CLASSNAME,
    ChoroplethMapManager,
    ChoroplethSeriesByName,
    CHOROPLETH_MAP_CLASSNAME,
} from "./MapChartConstants"
import { getGeoFeaturesForMap } from "./GeoFeatures"
import {
    CountryWithData,
    CountryWithNoData,
    NoDataPattern,
} from "./MapComponents"
import { Patterns } from "../core/GrapherConstants"
import {
    detectNearbyFeature,
    sortFeaturesByInteractionState,
} from "./MapHelpers"

@observer
export class ChoroplethMap extends React.Component<{
    manager: ChoroplethMapManager
}> {
    base: React.RefObject<SVGGElement> = React.createRef()

    @observable private hoverEnterFeature?: MapRenderFeature
    @observable private hoverNearbyFeature?: MapRenderFeature

    @computed private get isTouchDevice(): boolean {
        return isTouchDevice()
    }

    private viewport = { x: 0.565, y: 0.5, width: 1, height: 1 } as const

    @computed private get manager(): ChoroplethMapManager {
        return this.props.manager
    }

    @computed.struct private get bounds(): Bounds {
        return this.manager.choroplethMapBounds
    }

    @computed.struct private get choroplethData(): ChoroplethSeriesByName {
        return this.manager.choroplethData
    }

    @computed private get hoverFeature(): MapRenderFeature | undefined {
        return this.hoverEnterFeature || this.hoverNearbyFeature
    }

    // Combine bounding boxes to get the extents of the entire map
    @computed private get mapBounds(): Bounds {
        const allBounds = this.features.map((feature) => feature.bounds)
        return Bounds.merge(allBounds)
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

    @computed private get viewportScaleSqrt(): number {
        return Math.sqrt(this.viewportScale)
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

    @computed private get features(): MapRenderFeature[] {
        return getGeoFeaturesForMap()
    }

    @computed private get featuresWithData(): MapRenderFeature[] {
        const features = this.features.filter((feature) =>
            this.choroplethData.has(feature.id)
        )

        // sort features so that hovered or selected features are rendered last
        return sortFeaturesByInteractionState(features, {
            isHovered: (featureId: string) =>
                this.manager.getHoverState(featureId).active,
            isSelected: (featureId) => this.manager.isSelected(featureId),
        })
    }

    @computed private get featuresWithNoData(): MapRenderFeature[] {
        return difference(this.features, this.featuresWithData)
    }

    @computed private get quadtree(): Quadtree<MapRenderFeature> {
        return quadtree<MapRenderFeature>()
            .x((feature) => feature.center.x)
            .y((feature) => feature.center.y)
            .addAll(this.features)
    }

    // Map uses a hybrid approach to mouseover
    // If mouse is inside an element, that is prioritized
    // Otherwise we do a quadtree search for the closest center point of a feature bounds,
    // so that we can hover very small countries without trouble
    @action.bound private detectNearbyFeature(
        event: MouseEvent | TouchEvent
    ): MapRenderFeature | undefined {
        if (this.hoverEnterFeature || !this.base.current) return

        const nearbyFeature = detectNearbyFeature({
            quadtree: this.quadtree,
            element: this.base.current,
            event,
        })

        if (!nearbyFeature) {
            this.hoverNearbyFeature = undefined
            this.manager.onMapMouseLeave()
            return
        }

        if (nearbyFeature.id !== this.hoverNearbyFeature?.id) {
            this.hoverNearbyFeature = nearbyFeature
            this.manager.onMapMouseOver(nearbyFeature.geo)
        }

        return nearbyFeature
    }

    @action.bound private onMouseMove(event: MouseEvent): void {
        this.detectNearbyFeature(event)
    }

    @action.bound private onMouseEnter(feature: MapRenderFeature): void {
        this.setHoverEnterFeature(feature)
    }

    @action.bound private onMouseLeave(): void {
        // Fixes an issue where clicking on a country that overlaps with the
        // tooltip causes the tooltip to disappear shortly after being rendered
        if (this.isTouchDevice) return

        this.clearHoverEnterFeature()
    }

    @action.bound private setHoverEnterFeature(
        feature: MapRenderFeature
    ): void {
        if (this.hoverEnterFeature?.id === feature.id) return

        this.hoverEnterFeature = feature
        this.manager.onMapMouseOver(feature.geo)
    }

    @action.bound private clearHoverEnterFeature(): void {
        this.hoverEnterFeature = undefined
        this.manager.onMapMouseLeave()
    }

    @action.bound private onTouchStart(feature: MapRenderFeature): void {
        this.setHoverEnterFeature(feature)
    }

    @action.bound private onClick(feature: MapRenderFeature): void {
        this.setHoverEnterFeature(feature)

        // focus the country on the globe and select it
        this.manager.globeController?.focusOnCountry(feature.id)
        this.manager.mapConfig.selectedCountries.selectEntity(feature.id)
    }

    @action.bound private onDocumentClick(): void {
        if (this.hoverEnterFeature || this.hoverNearbyFeature) {
            this.hoverEnterFeature = undefined
            this.hoverNearbyFeature = undefined
            this.manager.onMapMouseLeave()
        }
    }

    renderFeaturesWithoutData(): React.ReactElement | void {
        if (this.featuresWithNoData.length === 0) return
        const patternId = Patterns.noDataPatternForMap

        return (
            <g
                id={makeIdForHumanConsumption("countries-without-data")}
                className="noDataFeatures"
            >
                <defs>
                    <NoDataPattern
                        patternId={patternId}
                        scale={1 / this.viewportScale} // The scale is crucial and projection specific
                    />
                </defs>

                {this.featuresWithNoData.map((feature) => (
                    <CountryWithNoData
                        key={feature.id}
                        feature={feature}
                        patternId={patternId}
                        isSelected={this.manager.isSelected(feature.id)}
                        hover={this.manager.getHoverState(feature.id)}
                        strokeScale={this.viewportScaleSqrt}
                        onClick={() => this.onClick(feature)}
                        onTouchStart={() => this.onTouchStart(feature)}
                        onMouseEnter={this.onMouseEnter}
                        onMouseLeave={this.onMouseLeave}
                    />
                ))}
            </g>
        )
    }

    renderFeaturesWithData(): React.ReactElement | void {
        if (this.featuresWithData.length === 0) return

        return (
            <g id={makeIdForHumanConsumption("countries-with-data")}>
                {this.featuresWithData.map((feature) => {
                    const series = this.choroplethData.get(feature.id)
                    if (!series) return null
                    return (
                        <CountryWithData
                            key={feature.id}
                            feature={feature}
                            series={series}
                            isSelected={this.manager.isSelected(feature.id)}
                            hover={this.manager.getHoverState(feature.id)}
                            strokeScale={this.viewportScaleSqrt}
                            onClick={() => this.onClick(feature)}
                            onTouchStart={() => this.onTouchStart(feature)}
                            onMouseEnter={this.onMouseEnter}
                            onMouseLeave={this.onMouseLeave}
                        />
                    )
                })}
            </g>
        )
    }

    renderStatic(): React.ReactElement {
        return (
            <g
                id={makeIdForHumanConsumption("map")}
                transform={this.matrixTransform}
            >
                {this.renderFeaturesWithoutData()}
                {this.renderFeaturesWithData()}
            </g>
        )
    }

    componentDidMount(): void {
        document.addEventListener("touchstart", this.onDocumentClick, true)
    }

    componentWillUnmount(): void {
        document.removeEventListener("touchstart", this.onDocumentClick, true)
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
                onMouseMove={(ev: SVGMouseEvent): void =>
                    this.onMouseMove(ev.nativeEvent)
                }
                onMouseLeave={this.onMouseLeave}
                style={{ cursor: this.hoverFeature ? "pointer" : undefined }}
            >
                <rect
                    x={bounds.x}
                    y={bounds.y}
                    width={bounds.width}
                    height={bounds.height}
                    fill="rgba(255,255,255,0)"
                    opacity={0}
                />
                <g
                    className={GEO_FEATURES_CLASSNAME}
                    transform={matrixTransform}
                >
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
