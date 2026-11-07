const SOURCE = 'rest-events'

export function normalizeEvents(events) {
    if (!Array.isArray(events)) {
        throw new TypeError('Events must be an array')
    }

    const records = []
    const seen = new Set()

    for (const event of events) {
        const record = normalizeEvent(event)
        if (!record || seen.has(record.id)) continue

        seen.add(record.id)
        records.push(record)
    }

    return {
        records,
        coverage: {
            timezone: 'UTC',
            repositories: 'public',
            completeness: 'incomplete'
        }
    }
}

function normalizeEvent(event) {
    if (!event || !event.id || !(event.createdAt instanceof Date) || Number.isNaN(event.createdAt.getTime())) {
        return null
    }

    const occurredAt = event.createdAt.toISOString()
    const occurredOn = occurredAt.slice(0, 10)
    const repository = event.repo

    switch (event.type) {
        case 'PushEvent':
            return createRecord(event.id, 'push', occurredAt, occurredOn, repository, event.payload?.commitCount, 'actor')
        case 'PullRequestEvent':
            if (event.payload?.action === 'opened') {
                return createRecord(event.id, 'pull_request_opened', occurredAt, occurredOn, repository, 1, 'author')
            }
            if (event.payload?.action === 'closed' && event.payload?.merged === true) {
                return createRecord(event.id, 'pull_request_merged', occurredAt, occurredOn, repository, 1, 'merger')
            }
            return null
        case 'PullRequestReviewEvent':
            if (event.payload?.action === 'submitted') {
                return createRecord(event.id, 'pull_request_reviewed', occurredAt, occurredOn, repository, 1, 'reviewer')
            }
            return null
        case 'IssuesEvent':
            if (event.payload?.action === 'opened') {
                return createRecord(event.id, 'issue_opened', occurredAt, occurredOn, repository, 1, 'author')
            }
            if (event.payload?.action === 'closed') {
                return createRecord(event.id, 'issue_closed', occurredAt, occurredOn, repository, 1, 'closer')
            }
            return null
        default:
            return null
    }
}

function createRecord(id, kind, occurredAt, occurredOn, repository, units, attribution) {
    if (!Number.isFinite(units) || units <= 0) return null

    return {
        id: `${SOURCE}:${id}`,
        kind,
        occurredAt,
        occurredOn,
        repository: repository || 'unknown',
        units,
        attribution,
        source: SOURCE,
        valid: true
    }
}
