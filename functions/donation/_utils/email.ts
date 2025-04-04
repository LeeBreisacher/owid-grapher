import * as Sentry from "@sentry/cloudflare"
import { Env } from "../../_common/env.js"

export interface EmailParams {
    from: string
    to: string
    subject: string
    text: string
    html?: string
    cc?: string
    bcc?: string
    "h-Reply-To"?: string
    "o:testmode"?: boolean
}

export const hasMailgunEnvVars = (env: Env) => {
    return (
        typeof env === "object" &&
        "MAILGUN_SENDING_KEY" in env &&
        "MAILGUN_DOMAIN" in env &&
        !!env.MAILGUN_SENDING_KEY &&
        !!env.MAILGUN_DOMAIN
    )
}

// Inspired by
// https://github.com/owid/cloudflare-workers/blob/main/workers/owid-feedback/src/worker.ts
// https://dev.to/gzuidhof/sending-e-mails-from-cloudflare-workers-2abl

// Neither nodemailer nor mailgun.js work in Cloudflare Workers, so we have to
// use the Mailgun API directly
export const sendMail = async (data: EmailParams, env: Env): Promise<void> => {
    if (!hasMailgunEnvVars(env)) {
        const message =
            "Missing environment variables. Please check that MAILGUN_API_KEY and MAILGUN_DOMAIN are set."
        console.error(message, data)
        Sentry.captureMessage(message, { level: "error" })
        return
    }

    // Convert `email` into a URLSearchParams object, skipping any undefined fields
    const bodySearchParams = new URLSearchParams()
    for (const [key, value] of Object.entries(data)) {
        if (value) bodySearchParams.set(key, value)
    }
    const body = bodySearchParams.toString()
    const response = await fetch(
        `https://api.mailgun.net/v3/${env.MAILGUN_DOMAIN}/messages`,
        {
            method: "POST",
            body,
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "Content-Length": body.length.toString(),
                // Using a "Domain Sending key" (instead of a more permissive "API key")
                // https://documentation.mailgun.com/en/latest/api-intro.html#authentication
                Authorization: `Basic ${btoa(
                    `api:${env.MAILGUN_SENDING_KEY}`
                )}`,
            },
        }
    )
    if (!response.ok) {
        const data = await response.json()
        console.error("Failed to send email", data)
        Sentry.captureMessage("Failed to send email", {
            level: "error",
            extra: { response: data },
        })
    }
}
