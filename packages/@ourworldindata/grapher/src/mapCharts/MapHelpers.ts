import { Quadtree } from "d3-quadtree"
import { getRelativeMouse } from "@ourworldindata/utils"
import {
    GEO_FEATURES_CLASSNAME,
    MAP_HOVER_TARGET_RANGE,
    RenderFeature,
} from "./MapChartConstants"

export function detectNearbyFeature<Feature extends RenderFeature>({
    quadtree,
    element,
    event,
    distance = MAP_HOVER_TARGET_RANGE,
}: {
    quadtree: Quadtree<Feature>
    element: SVGGElement
    event: MouseEvent | TouchEvent
    distance?: number
}): Feature | undefined {
    const groupElement = element.querySelector(`.${GEO_FEATURES_CLASSNAME}`)
    if (!groupElement) {
        console.error(`.${GEO_FEATURES_CLASSNAME} doesn't exist`)
        return
    }

    const { x, y } = getRelativeMouse(groupElement, event)
    return quadtree.find(x, y, distance)
}

export const calculateDistance = (
    p1: [number, number],
    p2: [number, number]
): number => {
    return Math.sqrt(Math.pow(p2[0] - p1[0], 2) + Math.pow(p2[1] - p1[1], 2))
}
