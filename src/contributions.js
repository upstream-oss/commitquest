const SOURCE = 'graphql'

export function normalizeContributions(collection) {
    if (!collection || typeof collection !== 'object') {
        throw new TypeError('Contributions must be an object')
    }

    const records = []
    const seen = new Set()

    for (const node of collection.issueContributions?.nodes || []) {
        pushRecord(records, seen, issueRecord(node))
    }

    for (const node of collection.pullRequestContributions?.nodes || []) {
        pushRecord(records, seen, pullRequestRecord(node))
    }

    for (const node of collection.pullRequestReviewContributions?.nodes || []) {
        pushRecord(records, seen, reviewRecord(node))
    }

    const commits = commitTotal(collection.commitContributionsByRepository)
    const calendarDays = calendarDayTotals(collection.contributionCalendar)

    return {
        records,
        coverage: {
            timezone: 'UTC',
            repositories: 'public',
            completeness: coverageCompleteness(collection, commits.partial),
            from: collection.startedAt || null,
            to: collection.endedAt || null,
            aggregates: {
                commits: commits.total,
                calendarDays
            }
        }
    }
}

function commitTotal(repositories) {
    if (repositories == null) return { total: null, partial: true }

    let total = 0
    for (const repository of repositories) {
        const connection = repository?.contributions
        if (!connection || connection.pageInfo?.hasNextPage) {
            return { total: null, partial: true }
        }

        for (const node of connection.nodes || []) {
            if (node?.isRestricted === true) continue
            if (!Number.isFinite(node?.commitCount) || node.commitCount < 0) continue
            total += node.commitCount
        }
    }

    return { total, partial: false }
}

function calendarDayTotals(calendar) {
    if (calendar == null) return null

    const days = []
    for (const week of calendar.weeks || []) {
        for (const day of week.contributionDays || []) {
            if (!day?.date || !Number.isFinite(day.contributionCount)) continue
            days.push({ date: day.date, contributionCount: day.contributionCount })
        }
    }
    return days
}

function coverageCompleteness(collection, commitsPartial) {
    if (collection.truncated) return 'incomplete'
    if (collection.errors?.length) return 'incomplete'
    if (collection.issueContributions == null) return 'incomplete'
    if (collection.pullRequestContributions == null) return 'incomplete'
    if (collection.pullRequestReviewContributions == null) return 'incomplete'
    if (collection.contributionCalendar == null) return 'incomplete'
    if (commitsPartial) return 'incomplete'
    return 'complete'
}

function pushRecord(records, seen, record) {
    if (!record || seen.has(record.id)) return
    seen.add(record.id)
    records.push(record)
}

function issueRecord(node) {
    return createRecord(
        node,
        node?.issue?.id,
        'issue',
        'issue_opened',
        node?.issue?.repository?.nameWithOwner,
        'author'
    )
}

function pullRequestRecord(node) {
    return createRecord(
        node,
        node?.pullRequest?.id,
        'pull_request',
        'pull_request_opened',
        node?.pullRequest?.repository?.nameWithOwner,
        'author'
    )
}

function reviewRecord(node) {
    return createRecord(
        node,
        node?.pullRequestReview?.id,
        'review',
        'pull_request_reviewed',
        node?.repository?.nameWithOwner,
        'reviewer'
    )
}

function createRecord(node, nodeId, idPrefix, kind, repository, attribution) {
    if (!node || node.isRestricted === true || !nodeId) return null

    const occurredAt = timestamp(node.occurredAt)
    if (!occurredAt) return null

    return {
        id: `${SOURCE}:${idPrefix}:${nodeId}`,
        kind,
        occurredAt,
        occurredOn: occurredAt.slice(0, 10),
        repository: repository || 'unknown',
        units: 1,
        attribution,
        source: SOURCE,
        valid: true
    }
}

function timestamp(value) {
    if (typeof value !== 'string') return null
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return null
    return date.toISOString()
}
