const GITHUB_API_BASE = 'https://api.github.com'
const MAX_PAGES = 10
const PER_PAGE = 30

export async function fetchEvents(username, options = {}) {
    if (!username) {
        throw new Error('A GitHub username is required')
    }

    const token = options.token || process.env.GITHUB_TOKEN
    const maxPages = Math.min(Math.max(options.pages || 3, 1), MAX_PAGES)

    const headers = {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'commitquest',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
    }

    const allEvents = []

    for (let page = 1; page <= maxPages; page++) {
        const url = `${GITHUB_API_BASE}/users/${encodeURIComponent(username)}/events/public?per_page=${PER_PAGE}&page=${page}`
        const response = await fetch(url, { headers })

        if (response.status === 404) {
            throw new Error(`GitHub user "${username}" not found`)
        }

        if (response.status === 403) {
            const remaining = response.headers.get('x-ratelimit-remaining')
            const resetTime = response.headers.get('x-ratelimit-reset')
            const resetDate = resetTime ? new Date(Number(resetTime) * 1000).toLocaleTimeString() : 'shortly'

            if (remaining === '0') {
                throw new Error(`GitHub API rate limit exceeded. Resets at ${resetDate}. Tip: set GITHUB_TOKEN for 5,000 req/hr.`)
            }
            throw new Error(`GitHub API forbidden: ${response.statusText}`)
        }

        if (!response.ok) {
            throw new Error(`GitHub API error (${response.status}): ${response.statusText}`)
        }

        const events = await response.json()

        if (!Array.isArray(events) || events.length === 0) {
            break
        }

        for (const event of events) {
            allEvents.push(parseEvent(event))
        }

        if (events.length < PER_PAGE) {
            break
        }
    }

    return allEvents
}

function parseEvent(event) {
    return {
        id: event.id,
        type: event.type,
        repo: event.repo?.name || 'unknown',
        createdAt: new Date(event.created_at),
        payload: extractPayloadDetails(event.type, event.payload || {})
    }
}

function extractPayloadDetails(type, payload) {
    switch (type) {
        case 'PushEvent':
            return {
                commitCount: payload.commits ? payload.commits.length : payload.size || 1,
                ref: payload.ref
            }
        case 'PullRequestEvent':
            return {
                action: payload.action,
                merged: Boolean(payload.pull_request?.merged),
                linesChanged: (payload.pull_request?.additions || 0) + (payload.pull_request?.deletions || 0)
            }
        case 'PullRequestReviewEvent':
            return {
                action: payload.action,
                state: payload.review?.state
            }
        case 'IssuesEvent':
            return {
                action: payload.action
            }
        default:
            return {}
    }
}
