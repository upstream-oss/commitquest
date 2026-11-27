import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeContributions } from '../src/contributions.js'
import { fetchContributions } from '../src/graphql.js'
import { calculateXP } from '../src/xp.js'

test('normalizes opened issues, opened pull requests, and submitted reviews', () => {
    const activity = normalizeContributions({
        startedAt: '2026-01-01T00:00:00.000Z',
        endedAt: '2026-11-07T00:00:00.000Z',
        issueContributions: {
            nodes: [
                {
                    isRestricted: false,
                    occurredAt: '2026-11-06T12:00:00.000Z',
                    issue: {
                        id: 'ISSUE_1',
                        state: 'CLOSED',
                        repository: { nameWithOwner: 'octo/quest' }
                    }
                }
            ]
        },
        pullRequestContributions: {
            nodes: [
                {
                    isRestricted: false,
                    occurredAt: '2026-11-06T13:00:00.000Z',
                    pullRequest: {
                        id: 'PR_1',
                        merged: true,
                        repository: { nameWithOwner: 'octo/quest' }
                    }
                }
            ]
        },
        pullRequestReviewContributions: {
            nodes: [
                {
                    isRestricted: false,
                    occurredAt: '2026-11-06T14:00:00.000Z',
                    repository: { nameWithOwner: 'octo/quest' },
                    pullRequestReview: { id: 'REVIEW_1' }
                }
            ]
        },
        commitContributionsByRepository: [],
        contributionCalendar: { weeks: [] }
    })

    assert.deepEqual(activity.records, [
        {
            id: 'graphql:issue:ISSUE_1',
            kind: 'issue_opened',
            occurredAt: '2026-11-06T12:00:00.000Z',
            occurredOn: '2026-11-06',
            repository: 'octo/quest',
            units: 1,
            attribution: 'author',
            source: 'graphql',
            valid: true
        },
        {
            id: 'graphql:pull_request:PR_1',
            kind: 'pull_request_opened',
            occurredAt: '2026-11-06T13:00:00.000Z',
            occurredOn: '2026-11-06',
            repository: 'octo/quest',
            units: 1,
            attribution: 'author',
            source: 'graphql',
            valid: true
        },
        {
            id: 'graphql:review:REVIEW_1',
            kind: 'pull_request_reviewed',
            occurredAt: '2026-11-06T14:00:00.000Z',
            occurredOn: '2026-11-06',
            repository: 'octo/quest',
            units: 1,
            attribution: 'reviewer',
            source: 'graphql',
            valid: true
        }
    ])
})

test('drops restricted contributions and keeps a public sibling', () => {
    const activity = normalizeContributions(collection({
        issueContributions: {
            nodes: [
                {
                    isRestricted: true,
                    occurredAt: '2026-11-06T12:00:00.000Z',
                    issue: {
                        id: 'PRIVATE_ISSUE',
                        repository: { nameWithOwner: 'octo/private' }
                    }
                },
                {
                    isRestricted: false,
                    occurredAt: '2026-11-06T15:00:00.000Z',
                    issue: {
                        id: 'PUBLIC_ISSUE',
                        repository: { nameWithOwner: 'octo/quest' }
                    }
                }
            ]
        }
    }))

    assert.deepEqual(activity.records.map(record => record.id), ['graphql:issue:PUBLIC_ISSUE'])
})

test('keeps commit and calendar totals off the XP record list', () => {
    const activity = normalizeContributions(collection({
        commitContributionsByRepository: [
            {
                repository: { nameWithOwner: 'octo/quest' },
                contributions: {
                    nodes: [
                        { commitCount: 5, occurredAt: '2026-11-06T00:00:00.000Z', isRestricted: false },
                        { commitCount: 3, occurredAt: '2026-11-05T00:00:00.000Z', isRestricted: true }
                    ],
                    pageInfo: { hasNextPage: false }
                }
            }
        ],
        contributionCalendar: {
            weeks: [
                {
                    contributionDays: [
                        { date: '2026-11-06', contributionCount: 8 }
                    ]
                }
            ]
        }
    }))

    assert.deepEqual(activity.records, [])
    assert.equal(activity.coverage.aggregates.commits, 5)
    assert.deepEqual(activity.coverage.aggregates.calendarDays, [
        { date: '2026-11-06', contributionCount: 8 }
    ])

    const result = calculateXP(activity, { today: '2026-11-06' })
    assert.equal(result.streak, 0)
    assert.equal(result.totalXP, 0)
    assert.equal(result.breakdown.commits, 0)
})

test('reports a known empty window as complete zeros', () => {
    const activity = normalizeContributions(collection())

    assert.equal(activity.coverage.completeness, 'complete')
    assert.equal(activity.coverage.aggregates.commits, 0)
    assert.deepEqual(activity.coverage.aggregates.calendarDays, [])
    assert.equal(activity.coverage.repositories, 'public')
    assert.equal(activity.coverage.timezone, 'UTC')
})

test('leaves missing GraphQL data unknown instead of zero', () => {
    const activity = normalizeContributions(collection({
        errors: [{ message: 'timeout' }],
        pullRequestContributions: null,
        commitContributionsByRepository: null,
        contributionCalendar: null,
        issueContributions: {
            nodes: [
                {
                    isRestricted: false,
                    occurredAt: '2026-11-06T12:00:00.000Z',
                    issue: {
                        id: 'ISSUE_1',
                        repository: { nameWithOwner: 'octo/quest' }
                    }
                }
            ]
        }
    }))

    assert.equal(activity.coverage.completeness, 'incomplete')
    assert.equal(activity.coverage.aggregates.commits, null)
    assert.equal(activity.coverage.aggregates.calendarDays, null)
    assert.deepEqual(activity.records.map(record => record.kind), ['issue_opened'])

    const result = calculateXP(activity, { today: '2026-11-06' })
    assert.equal(result.totalXP, 10)
    assert.equal(result.streak, 0)
    assert.equal(result.breakdown.pullRequestsOpened, 0)
})

test('requires a GitHub token and does not call GraphQL without one', async (t) => {
    const previous = process.env.GITHUB_TOKEN
    delete process.env.GITHUB_TOKEN
    t.after(() => {
        if (previous === undefined) delete process.env.GITHUB_TOKEN
        else process.env.GITHUB_TOKEN = previous
    })

    let called = false
    await assert.rejects(
        () => fetchContributions('octocat', {
            from: '2026-01-01T00:00:00.000Z',
            to: '2026-06-01T00:00:00.000Z',
            fetch: async () => {
                called = true
                return new Response('{}', { status: 200 })
            }
        }),
        /token/i
    )
    assert.equal(called, false)
})

test('scores opened GraphQL contributions without a push-day streak', () => {
    const activity = normalizeContributions(collection({
        issueContributions: { nodes: [issueNode('ISSUE_1', '2026-11-06T12:00:00.000Z')] },
        pullRequestContributions: {
            nodes: [pullRequestNode('PR_1', '2026-11-06T13:00:00.000Z', { merged: true })]
        },
        pullRequestReviewContributions: {
            nodes: [reviewNode('REVIEW_1', '2026-11-06T14:00:00.000Z')]
        }
    }))

    const result = calculateXP(activity, { today: '2026-11-06' })

    assert.equal(result.streak, 0)
    assert.equal(result.totalXP, 50)
    assert.equal(result.breakdown.commits, 0)
    assert.equal(result.breakdown.issuesOpened, 10)
    assert.equal(result.breakdown.pullRequestsOpened, 15)
    assert.equal(result.breakdown.reviewsGiven, 25)
    assert.equal(result.breakdown.pullRequestsMerged, 0)
    assert.equal(result.breakdown.issuesClosed, 0)
    assert.equal(activity.records.some(record => record.kind === 'push'), false)
})

test('rejects a contribution window longer than one year before calling GraphQL', async () => {
    let called = false
    await assert.rejects(
        () => fetchContributions('octocat', {
            token: 'test-token',
            from: '2024-01-01T00:00:00.000Z',
            to: '2026-01-02T00:00:00.000Z',
            fetch: async () => {
                called = true
                return Response.json({})
            }
        }),
        /1 year/
    )
    assert.equal(called, false)
})

test('rejects an unauthorized GraphQL response without revealing the token', async () => {
    await assert.rejects(
        () => fetchContributions('octocat', {
            token: 'super-secret-token',
            from: '2026-01-01T00:00:00.000Z',
            to: '2026-06-01T00:00:00.000Z',
            fetch: async () => new Response(
                JSON.stringify({ message: 'Bad credentials super-secret-token' }),
                { status: 401 }
            )
        }),
        (error) => {
            assert.match(error.message, /authentication/i)
            assert.equal(error.message.includes('super-secret-token'), false)
            return true
        }
    )
})

test('paginates issue, pull request, and review connections inside one window', async () => {
    const bodies = []
    const collectionResult = await fetchContributions('octocat', {
        token: 'test-token',
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-11-01T00:00:00.000Z',
        fetch: async (url, init) => {
            const body = JSON.parse(init.body)
            bodies.push({ url, init, variables: body.variables })
            const first = !JSON.stringify(body.variables).includes('issue-1')
            return Response.json({
                data: {
                    user: {
                        contributionsCollection: first ? firstContributionPage() : secondContributionPage()
                    }
                }
            })
        }
    })

    assert.equal(bodies.length, 2)
    assert.equal(bodies[0].url, 'https://api.github.com/graphql')
    assert.equal(bodies[0].init.method, 'POST')
    assert.equal(bodies[0].init.headers.Authorization, 'Bearer test-token')
    assert.equal(bodies[0].init.body.includes('test-token'), false)
    assert.equal(bodies[0].variables.login, 'octocat')
    assert.equal(bodies[0].variables.from, '2026-01-01T00:00:00.000Z')
    assert.equal(bodies[1].variables.from, '2026-01-01T00:00:00.000Z')
    assert.equal(bodies[1].variables.to, '2026-11-01T00:00:00.000Z')
    assert.equal(JSON.stringify(bodies[1].variables).includes('issue-1'), true)
    assert.equal(JSON.stringify(bodies[1].variables).includes('pr-1'), true)
    assert.equal(JSON.stringify(bodies[1].variables).includes('review-1'), true)
    assert.deepEqual(collectionResult.issueContributions.nodes.map(node => node.issue.id), ['ISSUE_1', 'ISSUE_2'])
    assert.deepEqual(collectionResult.pullRequestContributions.nodes.map(node => node.pullRequest.id), ['PR_1', 'PR_2'])
    assert.deepEqual(
        collectionResult.pullRequestReviewContributions.nodes.map(node => node.pullRequestReview.id),
        ['REVIEW_1', 'REVIEW_2']
    )
    assert.equal(collectionResult.commitContributionsByRepository.length, 1)
    assert.equal(collectionResult.truncated, false)

    const activity = normalizeContributions(collectionResult)
    const result = calculateXP(activity, { today: '2026-11-06' })
    assert.equal(result.streak, 0)
    assert.equal(activity.records.some(record => record.kind === 'push'), false)
})

test('returns partial GraphQL data and keeps the missing count unknown', async () => {
    const fetched = await fetchContributions('octocat', {
        token: 'test-token',
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-06-01T00:00:00.000Z',
        fetch: async () => Response.json({
            data: {
                user: {
                    contributionsCollection: {
                        startedAt: '2026-01-01T00:00:00.000Z',
                        endedAt: '2026-06-01T00:00:00.000Z',
                        issueContributions: {
                            nodes: [issueNode('ISSUE_1', '2026-11-06T12:00:00.000Z')],
                            pageInfo: { hasNextPage: false, endCursor: null }
                        },
                        pullRequestContributions: null,
                        pullRequestReviewContributions: {
                            nodes: [],
                            pageInfo: { hasNextPage: false, endCursor: null }
                        },
                        commitContributionsByRepository: null,
                        contributionCalendar: null
                    }
                }
            },
            errors: [{
                message: 'timeout',
                path: ['user', 'contributionsCollection', 'pullRequestContributions']
            }]
        })
    })

    assert.equal(fetched.pullRequestContributions, null)
    assert.equal(fetched.commitContributionsByRepository, null)
    assert.equal(fetched.errors[0].message, 'timeout')

    const activity = normalizeContributions(fetched)
    assert.equal(activity.coverage.completeness, 'incomplete')
    assert.equal(activity.coverage.aggregates.commits, null)
    assert.equal(activity.coverage.aggregates.calendarDays, null)
    assert.deepEqual(activity.records.map(record => record.kind), ['issue_opened'])
})

test('stops after ten GraphQL pages and marks the unread remainder incomplete', async () => {
    let calls = 0
    const fetched = await fetchContributions('octocat', {
        token: 'test-token',
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-06-01T00:00:00.000Z',
        fetch: async () => {
            calls += 1
            return Response.json({
                data: {
                    user: {
                        contributionsCollection: {
                            startedAt: '2026-01-01T00:00:00.000Z',
                            endedAt: '2026-06-01T00:00:00.000Z',
                            issueContributions: {
                                nodes: [issueNode(`ISSUE_${calls}`, '2026-11-06T12:00:00.000Z')],
                                pageInfo: { hasNextPage: true, endCursor: `issue-${calls}` }
                            },
                            pullRequestContributions: {
                                nodes: [],
                                pageInfo: { hasNextPage: false, endCursor: null }
                            },
                            pullRequestReviewContributions: {
                                nodes: [],
                                pageInfo: { hasNextPage: false, endCursor: null }
                            },
                            commitContributionsByRepository: [],
                            contributionCalendar: { weeks: [] }
                        }
                    }
                }
            })
        }
    })

    assert.equal(calls, 10)
    assert.equal(fetched.truncated, true)
    assert.equal(normalizeContributions(fetched).coverage.completeness, 'incomplete')
})

test('skips contributions that have no id or timestamp', () => {
    const activity = normalizeContributions(collection({
        issueContributions: {
            nodes: [
                {
                    isRestricted: false,
                    occurredAt: '2026-11-06T12:00:00.000Z',
                    issue: { repository: { nameWithOwner: 'octo/quest' } }
                },
                {
                    isRestricted: false,
                    issue: { id: 'ISSUE_1', repository: { nameWithOwner: 'octo/quest' } }
                },
                {
                    isRestricted: false,
                    occurredAt: 'not-a-date',
                    issue: { id: 'ISSUE_2', repository: { nameWithOwner: 'octo/quest' } }
                }
            ]
        }
    }))

    assert.deepEqual(activity.records, [])
})

test('keeps an unfinished commit page unknown', () => {
    const activity = normalizeContributions(collection({
        commitContributionsByRepository: [
            {
                contributions: {
                    nodes: [
                        { commitCount: 4, occurredAt: '2026-11-06T00:00:00.000Z', isRestricted: false }
                    ],
                    pageInfo: { hasNextPage: true, endCursor: 'more-commits' }
                }
            }
        ]
    }))

    assert.equal(activity.records.length, 0)
    assert.equal(activity.coverage.aggregates.commits, null)
    assert.equal(activity.coverage.completeness, 'incomplete')
})

test('marks a missing later page incomplete instead of treating the first page as the full result', async () => {
    let calls = 0
    const fetched = await fetchContributions('octocat', {
        token: 'test-token',
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-06-01T00:00:00.000Z',
        fetch: async () => {
            calls += 1
            if (calls === 1) {
                return Response.json({
                    data: {
                        user: {
                            contributionsCollection: {
                                startedAt: '2026-01-01T00:00:00.000Z',
                                endedAt: '2026-06-01T00:00:00.000Z',
                                issueContributions: {
                                    nodes: [issueNode('ISSUE_1', '2026-11-06T12:00:00.000Z')],
                                    pageInfo: { hasNextPage: true, endCursor: 'issue-1' }
                                },
                                pullRequestContributions: {
                                    nodes: [],
                                    pageInfo: { hasNextPage: false, endCursor: null }
                                },
                                pullRequestReviewContributions: {
                                    nodes: [],
                                    pageInfo: { hasNextPage: false, endCursor: null }
                                },
                                commitContributionsByRepository: [],
                                contributionCalendar: { weeks: [] }
                            }
                        }
                    }
                })
            }

            return Response.json({
                data: {
                    user: {
                        contributionsCollection: {
                            issueContributions: null,
                            pullRequestContributions: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
                            pullRequestReviewContributions: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
                            commitContributionsByRepository: [],
                            contributionCalendar: { weeks: [] }
                        }
                    }
                }
            })
        }
    })

    assert.equal(calls, 2)
    assert.equal(fetched.truncated, true)
    assert.equal(fetched.issueContributions.nodes.map(node => node.issue.id).join(','), 'ISSUE_1')
    assert.equal(normalizeContributions(fetched).coverage.completeness, 'incomplete')
})

test('does not return the GitHub token in a partial GraphQL error', async () => {
    const fetched = await fetchContributions('octocat', {
        token: 'super-secret-token',
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-06-01T00:00:00.000Z',
        fetch: async () => Response.json({
            data: {
                user: {
                    contributionsCollection: {
                        startedAt: '2026-01-01T00:00:00.000Z',
                        endedAt: '2026-06-01T00:00:00.000Z',
                        issueContributions: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
                        pullRequestContributions: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
                        pullRequestReviewContributions: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
                        commitContributionsByRepository: [],
                        contributionCalendar: { weeks: [] }
                    }
                }
            },
            errors: [{ message: 'failed for super-secret-token' }]
        })
    })

    assert.equal(JSON.stringify(fetched).includes('super-secret-token'), false)
    assert.equal(fetched.errors[0].message, 'GitHub GraphQL error')
})

function issueNode(id, occurredAt, extra = {}) {
    return {
        isRestricted: false,
        occurredAt,
        issue: {
            id,
            repository: { nameWithOwner: 'octo/quest' },
            ...extra
        }
    }
}

function pullRequestNode(id, occurredAt, extra = {}) {
    return {
        isRestricted: false,
        occurredAt,
        pullRequest: {
            id,
            repository: { nameWithOwner: 'octo/quest' },
            ...extra
        }
    }
}

function reviewNode(id, occurredAt) {
    return {
        isRestricted: false,
        occurredAt,
        repository: { nameWithOwner: 'octo/quest' },
        pullRequestReview: { id }
    }
}

function firstContributionPage() {
    return {
        startedAt: '2026-01-01T00:00:00.000Z',
        endedAt: '2026-11-01T00:00:00.000Z',
        issueContributions: {
            nodes: [issueNode('ISSUE_1', '2026-11-06T12:00:00.000Z')],
            pageInfo: { hasNextPage: true, endCursor: 'issue-1' }
        },
        pullRequestContributions: {
            nodes: [pullRequestNode('PR_1', '2026-11-06T13:00:00.000Z')],
            pageInfo: { hasNextPage: true, endCursor: 'pr-1' }
        },
        pullRequestReviewContributions: {
            nodes: [reviewNode('REVIEW_1', '2026-11-06T14:00:00.000Z')],
            pageInfo: { hasNextPage: true, endCursor: 'review-1' }
        },
        commitContributionsByRepository: [
            {
                contributions: {
                    nodes: [{ commitCount: 2, occurredAt: '2026-11-06T00:00:00.000Z', isRestricted: false }],
                    pageInfo: { hasNextPage: false, endCursor: null }
                }
            }
        ],
        contributionCalendar: {
            weeks: [{ contributionDays: [{ date: '2026-11-06', contributionCount: 2 }] }]
        }
    }
}

function secondContributionPage() {
    return {
        startedAt: '2026-01-01T00:00:00.000Z',
        endedAt: '2026-11-01T00:00:00.000Z',
        issueContributions: {
            nodes: [issueNode('ISSUE_2', '2026-11-06T15:00:00.000Z')],
            pageInfo: { hasNextPage: false, endCursor: null }
        },
        pullRequestContributions: {
            nodes: [pullRequestNode('PR_2', '2026-11-06T16:00:00.000Z')],
            pageInfo: { hasNextPage: false, endCursor: null }
        },
        pullRequestReviewContributions: {
            nodes: [reviewNode('REVIEW_2', '2026-11-06T17:00:00.000Z')],
            pageInfo: { hasNextPage: false, endCursor: null }
        },
        commitContributionsByRepository: [],
        contributionCalendar: { weeks: [] }
    }
}

function collection(overrides = {}) {
    return {
        startedAt: '2026-01-01T00:00:00.000Z',
        endedAt: '2026-11-07T00:00:00.000Z',
        issueContributions: { nodes: [] },
        pullRequestContributions: { nodes: [] },
        pullRequestReviewContributions: { nodes: [] },
        commitContributionsByRepository: [],
        contributionCalendar: { weeks: [] },
        ...overrides
    }
}
