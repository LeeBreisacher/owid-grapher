import { useState, useRef } from "react"
import {
    faCircleArrowRight,
    faCircleArrowLeft,
} from "@fortawesome/free-solid-svg-icons"
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome/index.js"

import { EnrichedBlockChartStory } from "@ourworldindata/utils"
import SpanElements from "./SpanElements.js"
import Chart from "./Chart.js"
import cx from "classnames"

export default function ChartStory({
    d,
    className = "",
}: {
    d: EnrichedBlockChartStory
    className?: string
}) {
    const { items } = d

    const [currentIndex, setCurrentIndex] = useState(0)
    const [currentSlide, setCurrentSlide] = useState(items[0])

    const showDetails = !!currentSlide.technical.length
    const maxSlide = items.length - 1

    const refChartContainer = useRef<HTMLDivElement>(null)

    return (
        <div className={cx(className, "chart-story grid grid-cols-8")}>
            <div
                className={
                    "chart-story__nav-hud span-cols-8 overline-black-caps align-center "
                }
            >
                {`Chart ${currentIndex + 1} of ${items.length}`}
            </div>
            <button
                aria-label="Go to previous slide"
                disabled={currentIndex === 0}
                className={
                    "chart-story__nav-arrow chart-story__nav-arrow--left span-cols-1 align-center "
                }
                onClick={() => {
                    setCurrentSlide(items[Math.max(0, currentIndex - 1)])
                    setCurrentIndex(Math.max(0, currentIndex - 1))
                }}
            >
                <FontAwesomeIcon icon={faCircleArrowLeft} />
            </button>
            <div
                className={
                    "chart-story__narrative-text span-cols-6 h3-bold align-center"
                }
            >
                <SpanElements spans={currentSlide.narrative.value} />
            </div>
            <button
                aria-label="Go to next slide"
                disabled={currentIndex === maxSlide}
                className={
                    "chart-story__nav-arrow chart-story__nav-arrow--right span-cols-1 col-start-8 align-center"
                }
                onClick={() => {
                    setCurrentSlide(items[Math.min(maxSlide, currentIndex + 1)])
                    setCurrentIndex(Math.min(maxSlide, currentIndex + 1))
                }}
            >
                <FontAwesomeIcon icon={faCircleArrowRight} />
            </button>

            <div
                className={"chart-story__chart span-cols-8"}
                ref={refChartContainer}
            >
                <Chart d={currentSlide.chart} />
            </div>
            {showDetails ? (
                <>
                    <div
                        className={
                            "chart-story__technical-text span-cols-8 overline-black-caps"
                        }
                    >
                        About this chart
                    </div>
                    <div
                        className={
                            "chart-story__technical-details span-cols-8 grid grid-cols-8"
                        }
                    >
                        <ul className="span-cols-6 col-start-2">
                            {currentSlide.technical.map((d: any, i: number) => {
                                return (
                                    <li className="body-3-medium" key={i}>
                                        <SpanElements spans={d.value} />
                                    </li>
                                )
                            })}
                        </ul>
                    </div>
                </>
            ) : null}
        </div>
    )
}
