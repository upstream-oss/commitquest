const GITHUB_GRAPHQL_URL = 'https://api.github.com/graphql'
const PAGE_SIZE = 100
const MAX_PAGES = 10

const CONNECTIONS = [
    ['issue', 'issueContributions', 'issueCursor'],
    ['pullRequest', 'pullRequestContributions', 'pullRequestCursor'],
    ['review', 'pullRequestReviewContributions', 'reviewCursor']
]

const QUERY = `
query CommitQuestContributions(
    $login: String!
    $from: DateTime!
    $to: DateTime!
    $issueCursor: String
    $pullRequestCursor: String
    $reviewCursor: String
) {
    user(login: $login) {
        contributionsCollection(from: $from, to: $to) {
            startedAt
            endedAt
            commitContributionsByRepository(maxRepositories: 100) {
                contributions(first: ${PAGE_SIZE}) {
                    pageInfo { hasNextPage endCursor }
                    nodes { commitCount occurredAt isRestricted }
                }
            }
            contributionCalendar {
                weeks {
                    contributionDays { date contributionCount }
                }
            }
            issueContributions(first: ${PAGE_SIZE}, after: $issueCursor) {
                pageInfo { hasNextPage endCursor }
                nodes {
                    isRestricted
                    occurredAt
                    issue { id repository { nameWithOwner } }
                }
            }
            pullRequestContributions(first: ${PAGE_SIZE}, after: $pullRequestCursor) {
                pageInfo { hasNextPage endCursor }
                nodes {
                    isRestricted
                    occurredAt
                    pullRequest { id repository { nameWithOwner } }
                }
            }
            pullRequestReviewContributions(first: ${PAGE_SIZE}, after: $reviewCursor) {
                pageInfo { hasNextPage endCursor }
                nodes {
                    isRestricted
                    occurredAt
                    repository { nameWithOwner }
                    pullRequestReview { id }
                }
            }
        }
    }
}
`

export async function fetchContributions(username, options = {}) {
    if (!username) {
        throw new Error('A GitHub username is required')
    }

    const token = options.token || process.env.GITHUB_TOKEN
    if (!token) {
        throw new Error('A GitHub token is required for GraphQL. Set GITHUB_TOKEN.')
    }

    const window = contributionWindow(options.from, options.to)
    const fetchImpl = options.fetch || globalThis.fetch
    const cursors = {
        issueCursor: null,
        pullRequestCursor: null,
        reviewCursor: null
    }
    const done = {
        issue: false,
        pullRequest: false,
        review: false
    }
    const collected = {
        startedAt: null,
        endedAt: null,
        issueContributions: null,
        pullRequestContributions: null,
        pullRequestReviewContributions: null,
        commitContributionsByRepository: null,
        contributionCalendar: null,
        errors: [],
        truncated: false
    }

    for (let page = 0; page < MAX_PAGES && !finished(done); page++) {
        const payload = await request(fetchImpl, token, {
            login: username,
            from: window.from,
            to: window.to,
            ...cursors
        })
        const failure = failureFor(payload, username, token)
        if (failure) throw failure

        absorb(collected, payload.data.user.contributionsCollection, cursors, done)
        if (payload.errors?.length) {
            collected.errors.push(...payload.errors.map(error => scrubError(error, token)))
        }
    }

    if (!finished(done)) collected.truncated = true
    return collected
}

function contributionWindow(from, to) {
    if (!from || !to) {
        throw new Error('A contribution window requires from and to')
    }

    const start = new Date(from)
    const end = new Date(to)
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
        throw new Error('The contribution window is invalid')
    }
    if (exceedsOneYear(start, end)) {
        throw new Error('The contribution window must not exceed 1 year')
    }

    return { from, to }
}

function exceedsOneYear(start, end) {
    const limit = new Date(start.getTime())
    limit.setUTCFullYear(limit.getUTCFullYear() + 1)
    return end.getTime() > limit.getTime()
}

async function request(fetchImpl, token, variables) {
    const response = await fetchImpl(GITHUB_GRAPHQL_URL, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': 'commitquest',
            Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ query: QUERY, variables })
    })

    if (response.status === 401) {
        throw new Error('GitHub GraphQL authentication failed')
    }
    if (!response.ok) {
        throw new Error(`GitHub GraphQL error (${response.status})`)
    }

    try {
        return await response.json()
    } catch {
        throw new Error('GitHub GraphQL error')
    }
}

function scrubError(error, token) {
    if (!error || typeof error !== 'object') return error

    const copy = { ...error }
    for (const [key, value] of Object.entries(copy)) {
        if (typeof value === 'string' && value.includes(token)) {
            copy[key] = 'GitHub GraphQL error'
        }
    }
    return copy
}

function failureFor(payload, username, token) {
    if (payload?.data?.user?.contributionsCollection) return null

    const errors = payload?.errors || []
    const missingUser = payload?.data?.user === null || errors.some(error =>
        error?.type === 'NOT_FOUND' || /could not resolve to a user/i.test(error?.message || '')
    )
    if (missingUser) {
        return new Error(`GitHub user "${username}" not found`)
    }

    const message = errors[0]?.message
    if (message && !message.includes(token)) {
        return new Error(`GitHub GraphQL error: ${message}`)
    }
    return new Error('GitHub GraphQL error')
}

function absorb(collected, collection, cursors, done) {
    if (!collected.startedAt && collection.startedAt) collected.startedAt = collection.startedAt
    if (!collected.endedAt && collection.endedAt) collected.endedAt = collection.endedAt

    if (
        collected.commitContributionsByRepository == null &&
        collection.commitContributionsByRepository !== undefined
    ) {
        collected.commitContributionsByRepository = collection.commitContributionsByRepository
    }
    if (collected.contributionCalendar == null && collection.contributionCalendar !== undefined) {
        collected.contributionCalendar = collection.contributionCalendar
    }

    for (const [key, field, cursorKey] of CONNECTIONS) {
        if (done[key]) continue

        const connection = collection[field]
        if (connection == null) {
            if (collected[field] != null) collected.truncated = true
            done[key] = true
            continue
        }

        const nodes = Array.isArray(connection.nodes) ? connection.nodes : []
        if (collected[field] == null) {
            collected[field] = { nodes: [...nodes] }
        } else {
            collected[field].nodes.push(...nodes)
        }

        const pageInfo = connection.pageInfo || {}
        if (pageInfo.hasNextPage && pageInfo.endCursor) {
            cursors[cursorKey] = pageInfo.endCursor
            continue
        }
        if (pageInfo.hasNextPage) collected.truncated = true
        done[key] = true
    }
}

function finished(done) {
    return done.issue && done.pullRequest && done.review
}
