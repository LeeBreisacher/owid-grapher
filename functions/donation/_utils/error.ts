import { stringifyUnknownError } from "@ourworldindata/utils"
import { Env } from "../../_common/env.js"

export const logError = async (error: string, filePath: string, env: Env) => {
    console.error(error)

    // Reporting to Slack
    await sendErrorMessageToSlack(
        `${stringifyUnknownError(error)} [${filePath}]`,
        env
    )
}

export const sendErrorMessageToSlack = async (message: string, env: Env) => {
    if (!env.SLACK_BOT_OAUTH_TOKEN || !env.SLACK_ERROR_CHANNEL_ID) {
        console.warn(
            "Missing SLACK_BOT_OAUTH_TOKEN or SLACK_ERROR_CHANNEL_ID. Continuing without logging errors to Slack."
        )
        return
    }

    const url = "https://slack.com/api/chat.postMessage"

    const data = {
        channel: env.SLACK_ERROR_CHANNEL_ID,
        text: message,
        username: "Cloudflare Pages function",
    }

    const fetchData = {
        method: "POST",
        body: JSON.stringify(data),
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.SLACK_BOT_OAUTH_TOKEN}`,
        },
    }

    const response = await fetch(url, fetchData)

    if (!response.ok) {
        throw new Error(
            `Slack API error: ${response.status} ${response.statusText}`
        )
    }
}
