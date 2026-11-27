import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeEvents } from '../src/activity.js'
import { calculateXP } from '../src/xp.js'

test('normalizes a push event into a UTC activity record', () => {
    const activity = normalizeEvents([
        {
            id: 'push-1',
            type: 'PushEvent',
            repo: 'octo/quest',
            createdAt: new Date('2026-11-06T23:30:00Z'),
            payload: {
                commitCount: 3,
                ref: 'refs/heads/main'
            }
        }
    ])

    assert.deepEqual(activity.records, [
        {
            id: 'rest-events:push-1',
            kind: 'push',
            occurredAt: '2026-11-06T23:30:00.000Z',
            occurredOn: '2026-11-06',
            repository: 'octo/quest',
            units: 3,
            attribution: 'actor',
            source: 'rest-events',
            valid: true
        }
    ])
})

test('calculates XP for commit units', () => {
    const result = calculateXP({
        records: [
            {
                id: 'rest-events:push-1',
                kind: 'push',
                occurredAt: '2026-11-06T23:30:00.000Z',
                occurredOn: '2026-11-06',
                repository: 'octo/quest',
                units: 3,
                attribution: 'actor',
                source: 'rest-events',
                valid: true
            }
        ],
        coverage: {
            from: '2026-11-06T00:00:00.000Z',
            to: '2026-11-07T00:00:00.000Z',
            timezone: 'UTC',
            repositories: 'public',
            completeness: 'incomplete'
        }
    }, {
        today: '2026-11-06'
    })

    assert.equal(result.totalXP, 30)
    assert.equal(result.level, 1)
    assert.equal(result.streak, 1)
    assert.deepEqual(result.breakdown, {
        commits: 30,
        pullRequestsOpened: 0,
        pullRequestsMerged: 0,
        reviewsGiven: 0,
        issuesOpened: 0,
        issuesClosed: 0
    })
})

test('normalizes supported semantic events and ignores unsupported actions', () => {
    const date = new Date('2026-11-06T12:00:00Z')
    const activity = normalizeEvents([
        {
            id: 'pr-opened',
            type: 'PullRequestEvent',
            repo: 'octo/quest',
            createdAt: date,
            payload: { action: 'opened' }
        },
        {
            id: 'pr-merged',
            type: 'PullRequestEvent',
            repo: 'octo/quest',
            createdAt: date,
            payload: { action: 'closed', merged: true }
        },
        {
            id: 'reviewed',
            type: 'PullRequestReviewEvent',
            repo: 'octo/quest',
            createdAt: date,
            payload: { action: 'submitted', state: 'approved' }
        },
        {
            id: 'issue-opened',
            type: 'IssuesEvent',
            repo: 'octo/quest',
            createdAt: date,
            payload: { action: 'opened' }
        },
        {
            id: 'issue-closed',
            type: 'IssuesEvent',
            repo: 'octo/quest',
            createdAt: date,
            payload: { action: 'closed' }
        },
        {
            id: 'review-edited',
            type: 'PullRequestReviewEvent',
            repo: 'octo/quest',
            createdAt: date,
            payload: { action: 'edited' }
        },
        {
            id: 'unknown',
            type: 'WatchEvent',
            repo: 'octo/quest',
            createdAt: date,
            payload: {}
        }
    ])

    assert.deepEqual(activity.records.map(record => record.kind), [
        'pull_request_opened',
        'pull_request_merged',
        'pull_request_reviewed',
        'issue_opened',
        'issue_closed'
    ])
    assert.deepEqual(activity.records.map(record => record.attribution), [
        'author',
        'merger',
        'reviewer',
        'author',
        'closer'
    ])
})

test('normalizes GitHub REST pull request and review actions', () => {
    const date = new Date('2026-11-06T12:00:00Z')
    const activity = normalizeEvents([
        {
            id: 'rest-pr-merged',
            type: 'PullRequestEvent',
            repo: 'octo/quest',
            createdAt: date,
            payload: {
                action: 'merged',
                merged: true,
                pull_request: { merged: true }
            }
        },
        {
            id: 'rest-review-created',
            type: 'PullRequestReviewEvent',
            repo: 'octo/quest',
            createdAt: date,
            payload: {
                action: 'created',
                review: { state: 'approved' }
            }
        },
        {
            id: 'rest-review-dismissed',
            type: 'PullRequestReviewEvent',
            repo: 'octo/quest',
            createdAt: date,
            payload: {
                action: 'dismissed',
                review: { state: 'dismissed' }
            }
        },
        {
            id: 'rest-review-updated',
            type: 'PullRequestReviewEvent',
            repo: 'octo/quest',
            createdAt: date,
            payload: {
                action: 'updated',
                review: { state: 'approved' }
            }
        }
    ])

    assert.deepEqual(activity.records.map(record => record.kind), [
        'pull_request_merged',
        'pull_request_reviewed'
    ])
})

test('deduplicates repeated event IDs but keeps distinct pushes on one UTC day', () => {
    const firstPush = {
        id: 'push-1',
        type: 'PushEvent',
        repo: 'octo/quest',
        createdAt: new Date('2026-11-06T01:00:00Z'),
        payload: { commitCount: 1 }
    }
    const activity = normalizeEvents([
        firstPush,
        firstPush,
        {
            ...firstPush,
            id: 'push-2',
            createdAt: new Date('2026-11-06T23:00:00Z')
        }
    ])

    assert.equal(activity.records.length, 2)
    assert.deepEqual(activity.records.map(record => record.occurredOn), [
        '2026-11-06',
        '2026-11-06'
    ])
})

test('ignores invalid commit counts and rejects non-array input', () => {
    const activity = normalizeEvents([
        {
            id: 'zero',
            type: 'PushEvent',
            repo: 'octo/quest',
            createdAt: new Date('2026-11-06T12:00:00Z'),
            payload: { commitCount: 0 }
        },
        {
            id: 'missing',
            type: 'PushEvent',
            repo: 'octo/quest',
            createdAt: new Date('2026-11-06T12:00:00Z'),
            payload: {}
        }
    ])

    assert.deepEqual(activity.records, [])
    assert.throws(() => normalizeEvents(null), TypeError)
})

function activityFor(records, completeness = 'complete') {
    return {
        records,
        coverage: {
            timezone: 'UTC',
            repositories: 'public',
            completeness
        }
    }
}

function push(id, day, units = 1) {
    return {
        id: `rest-events:${id}`,
        kind: 'push',
        occurredAt: `${day}T12:00:00.000Z`,
        occurredOn: day,
        repository: 'octo/quest',
        units,
        attribution: 'actor',
        source: 'rest-events',
        valid: true
    }
}

test('counts distinct push-event days once for a current streak', () => {
    const result = calculateXP(activityFor([
        push('three-a', '2026-11-06', 1),
        push('three-b', '2026-11-06', 2),
        push('two', '2026-11-05', 1),
        push('one', '2026-11-04', 1)
    ]), { today: '2026-11-06' })

    assert.equal(result.streak, 3)
    assert.equal(result.totalXP, 63)
})

test('breaks streaks at missing days and stale latest pushes', () => {
    const gap = calculateXP(activityFor([
        push('one', '2026-11-04'),
        push('three', '2026-11-06')
    ]), { today: '2026-11-06' })
    const stale = calculateXP(activityFor([push('old', '2026-11-04')]), {
        today: '2026-11-06'
    })

    assert.equal(gap.streak, 1)
    assert.equal(stale.streak, 0)
})

test('applies streak multiplier retroactively and preserves fractional XP until final rounding', () => {
    const records = [
        push('one', '2026-10-31'),
        push('two', '2026-11-01'),
        push('three', '2026-11-02'),
        push('four', '2026-11-03'),
        push('five', '2026-11-04'),
        push('six', '2026-11-05'),
        push('seven', '2026-11-06')
    ]
    const result = calculateXP(activityFor([
        ...records,
        {
            ...push('review', '2026-11-06'),
            kind: 'pull_request_reviewed',
            units: 1
        }
    ]), { today: '2026-11-06' })

    assert.equal(result.streak, 7)
    assert.equal(result.totalXP, 143)
    assert.equal(result.breakdown.commits, 105)
    assert.equal(result.breakdown.reviewsGiven, 37.5)
})

test('calculates all semantic XP categories and level 2 at 283 XP', () => {
    const result = calculateXP(activityFor([
        push('commits', '2026-11-06', 2),
        { ...push('opened', '2026-11-06'), kind: 'pull_request_opened' },
        { ...push('merged', '2026-11-06'), kind: 'pull_request_merged' },
        { ...push('reviewed', '2026-11-06'), kind: 'pull_request_reviewed' },
        { ...push('issue-opened', '2026-11-06'), kind: 'issue_opened' },
        { ...push('issue-closed', '2026-11-06'), kind: 'issue_closed' }
    ]), { today: '2026-11-06' })

    assert.equal(result.totalXP, 140)
    assert.deepEqual(result.breakdown, {
        commits: 20,
        pullRequestsOpened: 15,
        pullRequestsMerged: 50,
        reviewsGiven: 25,
        issuesOpened: 10,
        issuesClosed: 20
    })

    const belowLevelTwo = calculateXP(activityFor([
        push('below-level-two', '2026-11-06', 28)
    ]), { today: '2026-11-06' })
    const levelTwo = calculateXP(activityFor([
        push('level-two', '2026-11-06', 18),
        { ...push('merged-for-level', '2026-11-06'), kind: 'pull_request_merged' },
        { ...push('review-for-level', '2026-11-06'), kind: 'pull_request_reviewed' },
        { ...push('issue-opened-for-level', '2026-11-06'), kind: 'issue_opened' },
        { ...push('issue-closed-for-level', '2026-11-06'), kind: 'issue_closed' }
    ]), { today: '2026-11-06' })
    assert.equal(belowLevelTwo.totalXP, 280)
    assert.equal(belowLevelTwo.level, 1)
    assert.equal(levelTwo.totalXP, 285)
    assert.equal(levelTwo.level, 2)
})

test('valid records earn XP when historical coverage is incomplete', () => {
    const result = calculateXP(activityFor([push('known', '2026-11-06', 2)], 'incomplete'), {
        today: '2026-11-06'
    })

    assert.equal(result.totalXP, 20)
})

test('ignores invalid and duplicate records at the XP boundary', () => {
    const record = push('same', '2026-11-06')
    const result = calculateXP(activityFor([
        record,
        record,
        { ...record, id: 'invalid', valid: false },
        { ...record, id: 'bad-units', units: 0 }
    ]), { today: '2026-11-06' })

    assert.equal(result.totalXP, 10)
})

test('returns an empty result for empty activity', () => {
    const result = calculateXP(activityFor([]), { today: '2026-11-06' })

    assert.deepEqual(result, {
        totalXP: 0,
        level: 1,
        streak: 0,
        breakdown: {
            commits: 0,
            pullRequestsOpened: 0,
            pullRequestsMerged: 0,
            reviewsGiven: 0,
            issuesOpened: 0,
            issuesClosed: 0
        },
        coverage: {
            timezone: 'UTC',
            repositories: 'public',
            completeness: 'complete'
        }
    })
})

test('accepts raw fetched event arrays for Issue 9 compatibility', () => {
    const result = calculateXP([
        {
            id: 'raw-push',
            type: 'PushEvent',
            repo: 'octo/quest',
            createdAt: new Date('2026-11-07T00:00:00Z'),
            payload: { commitCount: 2 }
        }
    ], { today: '2026-11-07' })

    assert.equal(result.totalXP, 20)
})

test('exposes incomplete coverage in the result', () => {
    const coverage = {
        timezone: 'UTC',
        repositories: 'public',
        completeness: 'incomplete'
    }

    const result = calculateXP(activityFor([push('coverage', '2026-11-07')], 'incomplete'), {
        today: '2026-11-07'
    })

    assert.deepEqual(result.coverage, coverage)
})

test('applies multiplier transitions at every threshold', () => {
    const expected = [
        [2, 20, 1],
        [3, 38, 1.25],
        [6, 75, 1.25],
        [7, 105, 1.5],
        [13, 195, 1.5],
        [14, 280, 2],
        [29, 580, 2],
        [30, 900, 3]
    ]

    for (const [days, totalXP] of expected) {
        const records = Array.from({ length: days }, (_, index) =>
            push(`threshold-${days}-${index}`, dateAfter('2026-09-30', index)))
        const result = calculateXP(activityFor(records), {
            today: dateAfter('2026-09-30', days)
        })

        assert.equal(result.streak, days)
        assert.equal(result.totalXP, totalXP)
    }
})

function dateAfter(start, days) {
    const date = new Date(`${start}T00:00:00.000Z`)
    date.setUTCDate(date.getUTCDate() + days)
    return date.toISOString().slice(0, 10)
}

test('derives UTC dates at midnight boundaries', () => {
    const activity = normalizeEvents([
        {
            id: 'before-midnight',
            type: 'PushEvent',
            repo: 'octo/quest',
            createdAt: new Date('2026-11-06T23:59:59.999Z'),
            payload: { commitCount: 1 }
        },
        {
            id: 'at-midnight',
            type: 'PushEvent',
            repo: 'octo/quest',
            createdAt: new Date('2026-11-07T00:00:00.000Z'),
            payload: { commitCount: 1 }
        }
    ])

    assert.deepEqual(activity.records.map(record => record.occurredOn), [
        '2026-11-06',
        '2026-11-07'
    ])
})

test('ignores records with invalid or missing occurredOn values', () => {
    const result = calculateXP(activityFor([
        { ...push('missing-date', '2026-11-07'), occurredOn: undefined },
        { ...push('invalid-date', '2026-11-07'), occurredOn: 'not-a-date' }
    ]), { today: '2026-11-07' })

    assert.equal(result.totalXP, 0)
    assert.equal(result.streak, 0)
})

test('uses the agreed formula for higher level thresholds', () => {
    const belowLevelThree = calculateXP(activityFor([
        push('below-level-three', '2026-11-07', 51)
    ]), { today: '2026-11-07' })
    const levelThree = calculateXP(activityFor([
        push('level-three', '2026-11-07', 52)
    ]), { today: '2026-11-07' })

    assert.equal(belowLevelThree.totalXP, 510)
    assert.equal(belowLevelThree.level, 2)
    assert.equal(levelThree.totalXP, 520)
    assert.equal(levelThree.level, 3)
})
